import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/errors";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/cash";
import { computeRunningCash, isOverLimit } from "@/lib/running-cash";
import { differenceReason, explainShiftDivergence } from "@/lib/divergences";
import { useAuditorData } from "@/hooks/use-auditor-data";

/** O que está sendo encerrado: um turno em divergência ou uma retirada contestada. */
type DisputeTarget = { kind: "shift" | "withdrawal"; id: string; label: string };

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  pending_handover: "Pendente de repasse",
  disputed: "Repasse divergente",
  closed: "Fechado",
};

export function AuditorOverview({
  onViewTransactions,
  onViewShifts,
}: {
  onViewTransactions?: (unitId: string) => void;
  onViewShifts?: () => void;
}) {
  const { data, isLoading } = useAuditorData();
  const queryClient = useQueryClient();
  const [dispute, setDispute] = useState<DisputeTarget | null>(null);
  const [note, setNote] = useState("");

  // Um turno vira 'disputed' no receive_handover e continua assim para sempre:
  // corrigir lançamentos não mexe no status, e só estas RPCs o encerram.
  const resolveDispute = useMutation({
    mutationFn: async ({ kind, id, reason }: DisputeTarget & { reason: string }) => {
      const { error } =
        kind === "shift"
          ? await supabase.rpc("resolve_shift_dispute", { _shift_id: id, _note: reason })
          : await supabase.rpc("resolve_withdrawal_dispute", {
              _withdrawal_id: id,
              _note: reason,
            });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
      toast.success("Divergência encerrada", {
        description: "A justificativa ficou registrada no histórico de auditoria.",
      });
      setDispute(null);
      setNote("");
    },
    onError: (error: Error) =>
      toast.error("Erro ao encerrar a divergência", { description: friendlyError(error) }),
  });

  if (isLoading || !data) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const cards = data.units.map((unit) => {
    const unitShifts = data.shifts.filter((s) => s.unit_id === unit.id);
    const active =
      unitShifts.find((s) => s.status === "open") ??
      unitShifts.find((s) => s.status === "pending_handover") ??
      null;

    const disputedShift = unitShifts.some((s) => s.status === "disputed");
    const disputedRecord = unitShifts.find((s) => s.status === "disputed");
    const handoverCount = disputedRecord
      ? data.cashCounts.find(
          (count) => count.shift_id === disputedRecord.id && count.count_type === "handover",
        )
      : null;
    const handoverDifference =
      disputedRecord?.closing_total !== null &&
      disputedRecord?.closing_total !== undefined &&
      handoverCount
        ? Math.round(
            (Number(handoverCount.total_calculated) - Number(disputedRecord.closing_total)) * 100,
          ) / 100
        : null;
    const disputedWithdrawal = data.withdrawals.some(
      (w) => w.unit_id === unit.id && w.status === "disputed",
    );

    const running = active
      ? computeRunningCash(
          active.actual_opening_total,
          data.transactions.filter((t) => t.shift_id === active.id),
        )
      : 0;

    const safe = data.safeBalances[unit.id] ?? 0;

    return {
      unit,
      active,
      running,
      safe,
      disputed: disputedShift || disputedWithdrawal,
      over: Boolean(active) && isOverLimit(running),
      openedBy: active ? (data.names[active.opened_by] ?? "Usuário") : null,
      disputeHint:
        handoverDifference !== null && Math.abs(handoverDifference) >= 0.01
          ? `${handoverDifference > 0 ? "Sobra" : "Falta"} de ${formatBRL(Math.abs(handoverDifference))} no recebimento`
          : disputedShift
            ? "Divergência no fechamento — veja o detalhamento acima"
            : disputedWithdrawal
              ? "Retirada contestada"
              : null,
    };
  });

  const overLimit = cards.filter((c) => c.over);
  const disputes = cards.filter((c) => c.disputed);
  const disputedShifts = data.shifts
    .filter((shift) => shift.status === "disputed")
    .map((shift) => {
      const handover = data.cashCounts.find(
        (count) => count.shift_id === shift.id && count.count_type === "handover",
      );
      return {
        shift,
        handover,
        explanation: explainShiftDivergence({
          expectedClosingTotal:
            shift.expected_closing_total === null ? null : Number(shift.expected_closing_total),
          closingTotal: shift.closing_total === null ? null : Number(shift.closing_total),
          handoverTotal: handover ? Number(handover.total_calculated) : null,
        }),
      };
    });

  return (
    <>
      {overLimit.length > 0 ? (
        <div
          role="alert"
          className="sticky top-0 z-40 -mx-4 border-b border-destructive/60 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-sm font-semibold leading-snug">
              ⚠️ Limite de Segurança Excedido (Caixa &gt; R$ 1.000). Realizar Sangria imediatamente.
              <span className="mt-0.5 block text-xs font-normal opacity-90">
                {overLimit.map((c) => `${c.unit.name}: ${formatBRL(c.running)}`).join(" · ")}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {disputes.length > 0 ? (
        <section className="rounded-xl border border-destructive/60 bg-destructive/10 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden />
            <h2 className="text-lg font-semibold">Divergências ativas</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Veja abaixo em qual etapa o valor mudou: fechamento do turno ou recebimento do repasse.
          </p>
          <div className="mt-4 space-y-3">
            {disputedShifts.map(({ shift, handover, explanation }) => {
              const closingReason = differenceReason(explanation.closingDifference);
              const handoverReason = differenceReason(explanation.handoverDifference);
              return (
                <article
                  key={shift.id}
                  className="rounded-lg border border-destructive/40 bg-background/50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {data.unitNames[shift.unit_id] ?? "Unidade"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Turno de {data.names[shift.opened_by] ?? "Usuário"} · fechado por{" "}
                        {shift.closed_by ? (data.names[shift.closed_by] ?? "Usuário") : "Usuário"} ·{" "}
                        {new Date(shift.closed_at ?? shift.opened_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <span className="rounded-full bg-destructive px-2 py-1 text-xs font-semibold text-destructive-foreground">
                      {handoverReason !== "Sem diferença"
                        ? `${handoverReason} no repasse`
                        : `${closingReason} no fechamento`}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
                    <div className="rounded-md bg-muted/60 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                        Sistema esperava
                      </p>
                      <p className="text-lg font-semibold">
                        {explanation.expectedAtClosing === null
                          ? "—"
                          : formatBRL(explanation.expectedAtClosing)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Saldo calculado pelos lançamentos
                      </p>
                    </div>
                    <ArrowRight
                      className="hidden size-4 text-muted-foreground md:block"
                      aria-hidden
                    />
                    <div className="rounded-md bg-muted/60 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                        Entregue no fechamento
                      </p>
                      <p className="text-lg font-semibold">
                        {explanation.declaredBySender === null
                          ? "—"
                          : formatBRL(explanation.declaredBySender)}
                      </p>
                      <p
                        className={`text-xs font-semibold ${closingReason === "Sem diferença" ? "text-muted-foreground" : "text-destructive"}`}
                      >
                        {closingReason}
                        {explanation.closingDifference !== null && closingReason !== "Sem diferença"
                          ? ` de ${formatBRL(Math.abs(explanation.closingDifference))}`
                          : ""}
                      </p>
                    </div>
                    <ArrowRight
                      className="hidden size-4 text-muted-foreground md:block"
                      aria-hidden
                    />
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                        Recebido e contado
                      </p>
                      <p className="text-lg font-semibold">
                        {explanation.countedByReceiver === null
                          ? "—"
                          : formatBRL(explanation.countedByReceiver)}
                      </p>
                      <p
                        className={`text-xs font-semibold ${handoverReason === "Sem diferença" ? "text-muted-foreground" : "text-destructive"}`}
                      >
                        {handoverReason}
                        {explanation.handoverDifference !== null &&
                        handoverReason !== "Sem diferença"
                          ? ` de ${formatBRL(Math.abs(explanation.handoverDifference))}`
                          : ""}
                        {handover
                          ? ` · por ${data.names[handover.counted_by] ?? "Usuário"}`
                          : " · contagem não encontrada"}
                      </p>
                    </div>
                  </div>
                  {handover?.notes ? (
                    <p className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                      <strong>Observação do recebimento:</strong> {handover.notes}
                    </p>
                  ) : null}
                </article>
              );
            })}
            {data.withdrawals
              .filter((w) => w.status === "disputed")
              .map((w) => (
                <div
                  key={w.id}
                  className="rounded-lg border border-destructive/40 bg-background/50 p-3 text-sm"
                >
                  Retirada contestada · {data.unitNames[w.unit_id] ?? "Unidade"} ·{" "}
                  {formatBRL(w.amount)} · {data.names[w.partner_id] ?? "Sócio"} ·{" "}
                  {new Date(w.created_at).toLocaleString("pt-BR")}
                </div>
              ))}
          </div>
          {onViewShifts ? (
            <Button className="mt-4" variant="destructive" size="sm" onClick={onViewShifts}>
              Ver histórico e contagens por cédula
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="surface-panel p-5">
        <h2 className="text-lg">Visão geral das unidades</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <article
              key={c.unit.id}
              className={`rounded-xl border p-4 ${
                c.disputed || c.over
                  ? "border-destructive bg-destructive/10"
                  : "border-border/60 bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{c.unit.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {c.active
                      ? `${STATUS_LABEL[c.active.status] ?? c.active.status} por ${c.openedBy}`
                      : "Fechado"}
                  </p>
                </div>
                {c.disputed ? (
                  <span className="flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground">
                    <AlertTriangle className="size-3" aria-hidden /> Divergência
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Caixa em gaveta
                  </p>
                  <p
                    className={`text-2xl font-semibold ${
                      c.over
                        ? "text-destructive"
                        : c.active
                          ? "text-primary"
                          : "text-muted-foreground"
                    }`}
                  >
                    {c.active ? formatBRL(c.running) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Cofre da unidade
                  </p>
                  <p
                    className={`text-2xl font-semibold ${
                      c.safe < 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {formatBRL(c.safe)}
                  </p>
                </div>
              </div>
              {c.over ? (
                <p className="mt-1 text-xs font-semibold text-destructive">
                  Acima do limite de R$ 1.000 — solicitar sangria.
                </p>
              ) : null}
              {c.disputeHint ? (
                <p className="mt-2 rounded-md bg-destructive/10 p-2 text-xs font-semibold text-destructive">
                  Motivo: {c.disputeHint}
                </p>
              ) : null}
              {onViewTransactions ? (
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  variant="secondary"
                  onClick={() => onViewTransactions(c.unit.id)}
                >
                  Ver lançamentos
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <Dialog
        open={Boolean(dispute)}
        onOpenChange={(open) => {
          if (!open && !resolveDispute.isPending) {
            setDispute(null);
            setNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar divergência?</DialogTitle>
            <DialogDescription>
              As contagens registradas não mudam — elas são o histórico do que foi contado. Isto
              apenas marca a divergência como tratada e guarda a sua justificativa na auditoria.
            </DialogDescription>
          </DialogHeader>
          {dispute ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold">{dispute.label}</p>
            </div>
          ) : null}
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Explique como a diferença foi apurada e resolvida"
            aria-label="Como a divergência foi resolvida"
            disabled={resolveDispute.isPending}
          />
          {note.length > 0 && note.trim().length < 5 ? (
            <p className="text-xs font-semibold text-destructive">
              Informe pelo menos 5 caracteres.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setDispute(null);
                setNote("");
              }}
              disabled={resolveDispute.isPending}
            >
              Cancelar
            </Button>
            <Button
              disabled={note.trim().length < 5 || resolveDispute.isPending}
              onClick={() => {
                if (!dispute) return;
                resolveDispute.mutate({ ...dispute, reason: note.trim() });
              }}
            >
              {resolveDispute.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Encerrar divergência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
