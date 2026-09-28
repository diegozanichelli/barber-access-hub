import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  HandCoins,
  ImageIcon,
  Inbox,
  Landmark,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { BlindCalculator } from "@/components/blind-calculator";
import { DivergenceRecountDialog } from "@/components/divergence-recount-dialog";
import { CashLimitBanner } from "@/components/cash-limit-banner";
import { TransactionDialog, type TransactionDialogType } from "@/components/transaction-dialog";
import { TransactionChangeRequestDialog } from "@/components/transaction-change-request-dialog";
import { WithdrawalDialog } from "@/components/withdrawal-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, type CashQuantities } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import {
  closeShiftOnServer,
  checkCountDivergence,
  openShiftOnServer,
  receiveHandoverOnServer,
} from "@/lib/cash-operations.functions";
import { computeRunningCash, isOverLimit } from "@/lib/running-cash";

import { getReceiptUrl } from "@/lib/transactions";

type Props = {
  userId: string;
  unitId: string | null;
};

type CalcMode = "opening" | "closing" | "handover" | null;
type CountMode = Exclude<CalcMode, null>;
type CountPayload = { quantities: CashQuantities; total: number; notes: string };

const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  approved: "Confirmada",
  disputed: "Contestada",
};

export function ShiftPanel({ userId, unitId }: Props) {
  const queryClient = useQueryClient();
  const openShiftCompatibility = useServerFn(openShiftOnServer);
  const closeShiftCompatibility = useServerFn(closeShiftOnServer);
  const receiveHandoverCompatibility = useServerFn(receiveHandoverOnServer);
  const checkDivergence = useServerFn(checkCountDivergence);
  const [calcMode, setCalcMode] = useState<CalcMode>(null);
  const [txType, setTxType] = useState<TransactionDialogType>(null);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [changeRequestId, setChangeRequestId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ label: string; total: number } | null>(null);
  const [checkingCount, setCheckingCount] = useState(false);
  const [countFormVersion, setCountFormVersion] = useState(0);
  const [attempts, setAttempts] = useState<Record<CountMode, number>>({
    opening: 0,
    closing: 0,
    handover: 0,
  });
  const [pendingDivergence, setPendingDivergence] = useState<{
    mode: CountMode;
    payload: CountPayload;
    attempts: number;
  } | null>(null);

  const shiftsQuery = useQuery({
    queryKey: ["unit-shifts", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("unit_id", unitId!)
        .in("status", ["open", "pending_handover"])
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const shifts = shiftsQuery.data;
  const openShift = (shifts ?? []).find((s) => s.status === "open") ?? null;
  const pendingShift = (shifts ?? []).find((s) => s.status === "pending_handover") ?? null;

  const { data: transactions } = useQuery({
    queryKey: ["shift-transactions", openShift?.id],
    enabled: !!openShift?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("shift_id", openShift!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: withdrawals } = useQuery({
    queryKey: ["shift-withdrawals", openShift?.id],
    enabled: !!openShift?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_withdrawals")
        .select("*")
        .eq("shift_id", openShift!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Saldo do cofre é acumulado por unidade — não zera a cada turno. */
  const { data: safeBalance = 0 } = useQuery({
    queryKey: ["unit-safe-balance", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("unit_safe_balance", { _unit_id: unitId! });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  const runningCash = useMemo(
    () => (openShift ? computeRunningCash(openShift.actual_opening_total, transactions ?? []) : 0),
    [openShift, transactions],
  );

  function invalidateShift() {
    void queryClient.invalidateQueries({ queryKey: ["unit-shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["shift-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["shift-withdrawals"] });
    void queryClient.invalidateQueries({ queryKey: ["unit-safe-balance"] });
    void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
  }

  function finishCount(mode: CountMode) {
    setPendingDivergence(null);
    setAttempts((current) => ({ ...current, [mode]: 0 }));
  }

  const openMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!unitId) throw new Error("Você não está atribuído a uma unidade.");
      const { error } = await supabase.rpc("open_shift", {
        _unit_id: unitId,
        _quantities: payload.quantities,
        ...(payload.notes ? { _notes: payload.notes } : {}),
      });
      if (error?.code === "PGRST202" || error?.message.includes("schema cache")) {
        const result = await openShiftCompatibility({
          data: { unitId, quantities: payload.quantities, notes: payload.notes },
        });
        return result.total;
      }
      if (error) throw error;
      return payload.total;
    },
    onSuccess: (total) => {
      finishCount("opening");
      setCalcMode(null);
      setLastResult({ label: "Caixa aberto com", total });
      toast.success("Caixa aberto", { description: `Total contado: ${formatBRL(total)}` });
      invalidateShift();
    },
    onError: (error: Error) =>
      toast.error("Erro ao abrir o caixa", { description: friendlyError(error) }),
  });

  const closeMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!openShift) throw new Error("Nenhum caixa aberto.");

      const result = await closeShiftCompatibility({
        data: {
          shiftId: openShift.id,
          quantities: payload.quantities,
          notes: payload.notes,
        },
      });
      return {
        total: Number(result.total ?? payload.total),
        expectedClosing: Number(result.expected),
        diff: Number(result.difference ?? 0),
      };
    },
    onSuccess: ({ total, expectedClosing, diff }) => {
      finishCount("closing");
      setCalcMode(null);
      setConfirmClose(false);
      setLastResult({ label: "Turno enviado para repasse com", total });
      const detail = `Esperado: ${formatBRL(expectedClosing)} · Contado: ${formatBRL(total)}`;
      if (Math.abs(diff) < 0.005) {
        toast.success("Turno aguardando repasse — caixa confere", { description: detail });
      } else {
        toast.error(
          diff > 0
            ? `Sobra de ${formatBRL(diff)} no fechamento`
            : `Falta de ${formatBRL(Math.abs(diff))} no fechamento`,
          { description: `${detail}. A Auditoria foi notificada.`, duration: 10000 },
        );
      }
      invalidateShift();
    },
    onError: (error: Error) =>
      toast.error("Erro ao fechar o caixa", { description: friendlyError(error) }),
  });

  const handoverMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!pendingShift) throw new Error("Nenhum turno pendente de repasse.");

      const result = await receiveHandoverCompatibility({
        data: {
          pendingShiftId: pendingShift.id,
          quantities: payload.quantities,
          notes: payload.notes,
        },
      });
      return {
        total: Number(result.total ?? payload.total),
        matches: Boolean(result.matches),
        expected: Number(result.expected),
      };
    },
    onSuccess: ({ total, matches, expected }) => {
      finishCount("handover");
      setCalcMode(null);
      setLastResult({ label: "Turno recebido com", total });
      if (matches) {
        toast.success("Repasse confirmado", {
          description: `Total conferido: ${formatBRL(total)}`,
        });
      } else {
        toast.error("Divergência detectada! A Auditoria foi notificada.", {
          description: `Repassado: ${formatBRL(expected)} · Contado: ${formatBRL(total)}`,
          duration: 10000,
        });
      }
      invalidateShift();
    },
    onError: (error: Error) =>
      toast.error("Erro ao receber o turno", { description: friendlyError(error) }),
  });

  function persistCount(mode: CountMode, payload: CountPayload) {
    if (mode === "opening") openMutation.mutate(payload);
    else if (mode === "closing") closeMutation.mutate(payload);
    else handoverMutation.mutate(payload);
  }

  async function checkThenPersist(mode: CountMode, payload: CountPayload) {
    if (!unitId) return;
    const attempt = attempts[mode] + 1;
    setAttempts((current) => ({ ...current, [mode]: attempt }));
    setCheckingCount(true);
    try {
      const result = await checkDivergence({
        data:
          mode === "opening"
            ? { mode, unitId, quantities: payload.quantities }
            : mode === "closing" && openShift
              ? { mode, shiftId: openShift.id, quantities: payload.quantities }
              : mode === "handover" && pendingShift
                ? { mode, pendingShiftId: pendingShift.id, quantities: payload.quantities }
                : (() => {
                    throw new Error("O turno mudou. Atualize a tela e tente novamente.");
                  })(),
      });
      if (result.matches) {
        persistCount(mode, payload);
      } else {
        setCalcMode(null);
        setPendingDivergence({ mode, payload, attempts: attempt });
      }
    } catch (error) {
      toast.error("Não foi possível conferir a contagem", { description: friendlyError(error) });
    } finally {
      setCheckingCount(false);
    }
  }

  function confirmDivergence(reason: string) {
    if (!pendingDivergence) return;
    const { mode, payload, attempts: attemptCount } = pendingDivergence;
    const auditNote = [
      `DIVERGÊNCIA CONFIRMADA APÓS ${attemptCount} TENTATIVA(S). Justificativa: ${reason}`,
      payload.notes.trim() ? `Observação da contagem: ${payload.notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);
    persistCount(mode, { ...payload, notes: auditNote });
  }

  async function openReceipt(path: string) {
    const url = await getReceiptUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Não foi possível abrir o comprovante");
  }

  if (!unitId) {
    return (
      <section className="surface-panel p-5">
        <h2 className="text-lg">Turno</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Peça ao auditor para atribuir sua unidade antes de operar o caixa.
        </p>
      </section>
    );
  }

  if (shiftsQuery.isLoading) {
    return (
      <section className="surface-panel flex items-center justify-center gap-2 p-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Carregando o turno da unidade...</span>
      </section>
    );
  }

  if (shiftsQuery.isError) {
    return (
      <section className="surface-panel p-5">
        <div className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold">Não foi possível carregar o turno</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {friendlyError(shiftsQuery.error)} Não abra um novo caixa antes de conseguir carregar
              esta tela — pode haver um turno já aberto.
            </p>
          </div>
        </div>
        <Button className="mt-4 h-12 w-full" onClick={() => void shiftsQuery.refetch()}>
          <RefreshCw className="size-4" />
          Tentar de novo
        </Button>
      </section>
    );
  }

  return (
    <>
      {openShift && isOverLimit(runningCash) ? <CashLimitBanner runningCash={runningCash} /> : null}

      {lastResult ? (
        <section className="surface-panel p-5">
          <p className="text-sm text-muted-foreground">{lastResult.label}</p>
          <p className="mt-1 text-3xl font-semibold text-primary">{formatBRL(lastResult.total)}</p>
        </section>
      ) : null}

      <section className="surface-panel p-5">
        <h2 className="text-lg">Turno</h2>
        {openShift ? (
          <>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Aberto em</dt>
                <dd>{new Date(openShift.opened_at).toLocaleString("pt-BR")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Abertura contada</dt>
                <dd>{formatBRL(openShift.actual_opening_total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Abertura esperada</dt>
                <dd>{formatBRL(openShift.expected_opening_total)}</dd>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">Dinheiro em caixa agora</dt>
                <dd
                  className={
                    isOverLimit(runningCash)
                      ? "font-semibold text-destructive"
                      : "font-semibold text-primary"
                  }
                >
                  {formatBRL(runningCash)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cofre da unidade (acumulado)</dt>
                <dd className={safeBalance > 0 ? "font-semibold" : "text-muted-foreground"}>
                  {formatBRL(safeBalance)}
                </dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-3">
              <Button className="h-14 w-full text-base" onClick={() => setTxType("income")}>
                <ArrowUpCircle className="size-5" />
                Registrar Entrada
              </Button>
              <Button
                variant="secondary"
                className="h-14 w-full text-base"
                onClick={() => setTxType("expense")}
              >
                <ArrowDownCircle className="size-5" />
                Registrar Despesa
              </Button>
              <Button
                variant="secondary"
                className="h-14 w-full text-base"
                onClick={() => setTxType("safe_drop")}
              >
                <Landmark className="size-5" />
                Fazer Sangria (Cofre)
              </Button>
              <Button
                variant="secondary"
                className="h-14 w-full text-base"
                disabled={safeBalance <= 0}
                onClick={() => setWithdrawalOpen(true)}
              >
                <HandCoins className="size-5" />
                Retirada de Sócio
              </Button>
              {safeBalance <= 0 ? (
                <p className="-mt-1 text-xs text-muted-foreground">
                  Faça uma sangria para o cofre antes de registrar uma retirada de sócio.
                </p>
              ) : null}

              <Button
                variant={confirmClose ? "destructive" : "outline"}
                className="h-12 w-full"
                onClick={() => {
                  if (!confirmClose) {
                    setConfirmClose(true);
                    return;
                  }
                  setConfirmClose(false);
                  setCalcMode("closing");
                }}
              >
                <LockKeyhole className="size-4" />
                {confirmClose ? "Confirmar: fechar o caixa agora" : "Fechar Caixa"}
              </Button>
              {confirmClose ? (
                <p className="-mt-1 text-xs text-muted-foreground">
                  Depois de fechar não é possível registrar mais lançamentos neste turno.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setConfirmClose(false)}
                  >
                    Cancelar
                  </button>
                </p>
              ) : null}
            </div>
          </>
        ) : pendingShift ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Há um turno aguardando repasse nesta unidade. Faça sua própria contagem cega para
              receber o caixa.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Fechado em{" "}
              {new Date(pendingShift.closed_at ?? pendingShift.opened_at).toLocaleString("pt-BR")}
            </p>
            <Button className="mt-4 h-14 w-full text-base" onClick={() => setCalcMode("handover")}>
              <Inbox className="size-5" />
              Receber Turno Pendente
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Nenhum caixa aberto nesta unidade.</p>
            <Button className="mt-4 h-14 w-full text-base" onClick={() => setCalcMode("opening")}>
              <Unlock className="size-5" />
              Abrir Caixa
            </Button>
          </>
        )}
      </section>

      {openShift && (withdrawals ?? []).length > 0 ? (
        <section className="surface-panel p-5">
          <h2 className="text-lg">Retiradas de sócio</h2>
          <ul className="mt-3 divide-y divide-border/60">
            {(withdrawals ?? []).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{formatBRL(w.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(w.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {w.note ? ` · ${w.note}` : ""}
                  </p>
                </div>
                <span
                  className={
                    w.status === "disputed"
                      ? "text-xs font-semibold text-destructive"
                      : w.status === "approved"
                        ? "text-xs font-semibold text-primary"
                        : "text-xs font-semibold text-muted-foreground"
                  }
                >
                  {WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openShift ? (
        <section className="surface-panel p-5">
          <h2 className="text-lg">Movimentações do turno</h2>
          {(transactions ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60">
              {(transactions ?? []).map((t) => {
                const isReversal = Boolean(t.reverses_transaction_id);
                const reversed = Boolean(t.reversed_at);
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-medium ${reversed ? "text-muted-foreground line-through" : ""}`}
                      >
                        {t.transaction_type === "income"
                          ? `${t.category} · ${t.client_name ?? ""}`
                          : t.category === "Sangria"
                            ? `Sangria (cofre)${t.description ? ` · ${t.description}` : ""}`
                            : (t.description ?? "Despesa")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isReversal ? "Estorno · " : reversed ? "Estornado · " : ""}
                        {t.payment_method ? `${t.payment_method} · ` : ""}
                        {new Date(t.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isReversal && !reversed ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setChangeRequestId(t.id)}
                        >
                          Solicitar alteração
                        </Button>
                      ) : null}
                      {t.photo_url ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Ver comprovante"
                          onClick={() => void openReceipt(t.photo_url!)}
                        >
                          <ImageIcon className="size-4" />
                        </Button>
                      ) : null}
                      <span
                        className={
                          t.transaction_type === "income"
                            ? "text-sm font-semibold text-primary"
                            : "text-sm font-semibold text-destructive"
                        }
                      >
                        {t.transaction_type === "income" ? "+" : "-"}
                        {formatBRL(t.amount)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <BlindCalculator
        key={`opening-${countFormVersion}`}
        open={calcMode === "opening"}
        onOpenChange={(o) => setCalcMode(o ? "opening" : null)}
        title="Abrir Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar abertura"
        submitting={openMutation.isPending || checkingCount}
        onSubmit={(payload) => void checkThenPersist("opening", payload)}
      />

      <BlindCalculator
        key={`closing-${countFormVersion}`}
        open={calcMode === "closing"}
        onOpenChange={(o) => setCalcMode(o ? "closing" : null)}
        title="Fechar Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar fechamento"
        submitting={closeMutation.isPending || checkingCount}
        onSubmit={(payload) => void checkThenPersist("closing", payload)}
      />

      <BlindCalculator
        key={`handover-${countFormVersion}`}
        open={calcMode === "handover"}
        onOpenChange={(o) => setCalcMode(o ? "handover" : null)}
        title="Receber Turno Pendente"
        description="Conte o caixa recebido. Informe apenas as quantidades; o sistema compara com o repasse."
        submitLabel="Confirmar recebimento"
        submitting={handoverMutation.isPending || checkingCount}
        onSubmit={(payload) => void checkThenPersist("handover", payload)}
      />

      <DivergenceRecountDialog
        open={Boolean(pendingDivergence)}
        attempts={pendingDivergence?.attempts ?? 0}
        submitting={openMutation.isPending || closeMutation.isPending || handoverMutation.isPending}
        onRecount={() => {
          if (!pendingDivergence) return;
          const mode = pendingDivergence.mode;
          setPendingDivergence(null);
          setCountFormVersion((version) => version + 1);
          setCalcMode(mode);
        }}
        onConfirm={confirmDivergence}
        onCancel={() => {
          if (pendingDivergence) finishCount(pendingDivergence.mode);
        }}
      />

      {openShift ? (
        <>
          <TransactionDialog
            type={txType}
            onOpenChange={(o) => setTxType(o ? txType : null)}
            shiftId={openShift.id}
            unitId={unitId}
            userId={userId}
          />
          <WithdrawalDialog
            open={withdrawalOpen}
            onOpenChange={setWithdrawalOpen}
            shiftId={openShift.id}
            safeBalance={safeBalance}
          />
        </>
      ) : null}
      <TransactionChangeRequestDialog
        transactionId={changeRequestId}
        open={Boolean(changeRequestId)}
        onOpenChange={(open) => !open && setChangeRequestId(null)}
      />
    </>
  );
}
