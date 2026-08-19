import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Download, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptThumb } from "@/components/receipt-thumb";
import { BlindCalculator } from "@/components/blind-calculator";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "@/lib/cash";
import { downloadCSV, toCSV } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import { archiveEmptyOpening, correctOpeningOnServer } from "@/lib/opening-admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuditorReferences, type TransactionRow } from "@/hooks/use-auditor-data";
import type { CashQuantities } from "@/lib/cash";

const ALL = "__all__";
const CATEGORIES = ["Bebida", "Assinatura Nova", "Renovação", "Despesa", "Sangria"];
const PAGE_SIZE = 25;

export function AuditFeed({ selectedUnitId }: { selectedUnitId?: string }) {
  const queryClient = useQueryClient();
  const archiveEmptyOpeningOnServer = useServerFn(archiveEmptyOpening);
  const correctOpeningCompatibility = useServerFn(correctOpeningOnServer);
  const { data: references } = useAuditorReferences();
  const [unitId, setUnitId] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const [pendingReversal, setPendingReversal] = useState<TransactionRow | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "opening"; id: string; label: string; amount: number; createdAt: string }
    | { kind: "transaction"; id: string; label: string; amount: number; createdAt: string }
    | null
  >(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [openingToCorrect, setOpeningToCorrect] = useState<{
    id: string;
    unitId: string;
    total: number;
    openedAt: string;
  } | null>(null);

  useEffect(() => setPage(0), [unitId, type, category, order]);
  useEffect(() => {
    if (selectedUnitId) setUnitId(selectedUnitId);
  }, [selectedUnitId]);

  const reverseMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("reverse_transaction", {
        _transaction_id: id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["audit-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["auditor-data"] }),
        queryClient.invalidateQueries({ queryKey: ["shift-transactions"] }),
      ]);
      toast.success("Lançamento estornado", {
        description:
          "O valor incorreto foi neutralizado e o histórico de auditoria foi preservado.",
      });
      setPendingReversal(null);
      setReversalReason("");
    },
    onError: (error) =>
      toast.error("Erro ao estornar lançamento", { description: friendlyError(error) }),
  });

  const { data: openings = [] } = useQuery({
    queryKey: ["audit-active-openings", unitId],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("shifts")
        .select("id, unit_id, actual_opening_total, opened_at")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (unitId !== ALL) query = query.eq("unit_id", unitId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const correctOpeningMutation = useMutation({
    mutationFn: async ({
      shiftId,
      quantities,
      reason,
    }: {
      shiftId: string;
      quantities: CashQuantities;
      reason: string;
    }) => {
      const { error } = await supabase.rpc("correct_opening_cash_count", {
        _shift_id: shiftId,
        _quantities: quantities,
        _reason: reason,
      });
      if (error?.code === "PGRST202" || error?.message.includes("schema cache")) {
        return correctOpeningCompatibility({
          data: { shiftId, quantities, reason },
        });
      }
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["audit-active-openings"] }),
        queryClient.invalidateQueries({ queryKey: ["auditor-data"] }),
        queryClient.invalidateQueries({ queryKey: ["audit-shift"] }),
      ]);
      toast.success("Abertura corrigida", {
        description: "O caixa foi recalculado e a alteração ficou registrada na auditoria.",
      });
      setOpeningToCorrect(null);
    },
    onError: (error) =>
      toast.error("Erro ao corrigir abertura", { description: friendlyError(error) }),
  });
  const deleteOpeningMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("delete_empty_open_shift", {
        _shift_id: id,
        _reason: reason,
      });
      if (error?.code === "PGRST202" || error?.message.includes("schema cache")) {
        return archiveEmptyOpeningOnServer({ data: { shiftId: id, reason } });
      }
      if (error) throw error;
      return { mode: "deleted" as const };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["audit-active-openings"] }),
        queryClient.invalidateQueries({ queryKey: ["auditor-data"] }),
      ]);
      toast.success("Abertura removida", {
        description:
          result.mode === "archived"
            ? "A RPC ainda não estava publicada; a abertura foi retirada do caixa ativo e preservada no histórico."
            : "A cópia de auditoria foi preservada.",
      });
      setDeleteTarget(null);
      setDeleteReason("");
    },
    onError: (error) =>
      toast.error("Erro ao excluir abertura", { description: friendlyError(error) }),
  });
  const masterDeleteTransaction = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("master_delete_transaction", {
        _transaction_id: id,
        _reason: reason,
      });
      if (error?.code === "PGRST202" || error?.message.includes("schema cache")) {
        throw new Error(
          "Atualização do banco pendente. A exclusão foi bloqueada. Aplique a migração 20260819120000 e tente novamente.",
        );
      }
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["audit-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["auditor-data"] }),
        queryClient.invalidateQueries({ queryKey: ["transaction-change-requests"] }),
      ]);
      toast.success("Lançamento excluído", {
        description: "A cópia para auditoria foi preservada.",
      });
      setDeleteTarget(null);
      setDeleteReason("");
    },
    onError: (error) =>
      toast.error("Erro ao excluir lançamento", { description: friendlyError(error) }),
  });

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["audit-transactions", page, unitId, type, category, order],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: order === "asc" })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (unitId !== ALL) query = query.eq("unit_id", unitId);
      if (type !== ALL) query = query.eq("transaction_type", type);
      if (category !== ALL) query = query.eq("category", category as TransactionRow["category"]);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as TransactionRow[], count: count ?? 0 };
    },
  });
  const rows = pageData?.rows ?? [];
  const count = pageData?.count ?? 0;

  function handleExport() {
    const csv = toCSV(
      [
        "Data",
        "Unidade",
        "Tipo",
        "Categoria",
        "Cliente",
        "Pagamento",
        "Valor",
        "Descrição",
        "Registrado por",
        "Comprovante",
      ],
      rows.map((t) => [
        new Date(t.created_at).toLocaleString("pt-BR"),
        references?.unitNames[t.unit_id] ?? "",
        t.transaction_type === "income"
          ? "Entrada"
          : t.category === "Sangria"
            ? "Sangria (cofre)"
            : "Despesa",
        t.category,
        t.client_name ?? "",
        t.payment_method ?? "",
        Number(t.amount).toFixed(2).replace(".", ","),
        t.description ?? "",
        references?.names[t.user_id] ?? "",
        t.photo_url ? "Sim" : "Não",
      ]),
    );
    downloadCSV(`lancamentos-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (isLoading || !references) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg">Feed de lançamentos e provas</h2>
        <Button size="sm" variant="secondary" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="size-4" />
          Exportar página CSV
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger aria-label="Filtrar por unidade">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {references.units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Filtrar por tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Entradas e despesas</SelectItem>
            <SelectItem value="income">Somente entradas</SelectItem>
            <SelectItem value="expense">Somente saídas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Filtrar por categoria">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={order} onValueChange={(v) => setOrder(v as "desc" | "asc")}>
          <SelectTrigger aria-label="Ordenar por data">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Mais recentes primeiro</SelectItem>
            <SelectItem value="asc">Mais antigos primeiro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {openings.length > 0 ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">Aberturas de caixa ativas</h3>
          {openings.map((opening) => (
            <div
              key={opening.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card p-3"
            >
              <div>
                <p className="font-medium">
                  Abertura · {references.unitNames[opening.unit_id] ?? "Unidade"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(opening.opened_at).toLocaleString("pt-BR")} · Valor contado{" "}
                  {formatBRL(opening.actual_opening_total)}
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  setOpeningToCorrect({
                    id: opening.id,
                    unitId: opening.unit_id,
                    total: opening.actual_opening_total,
                    openedAt: opening.opened_at,
                  })
                }
              >
                Corrigir abertura
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  setDeleteTarget({
                    kind: "opening",
                    id: opening.id,
                    label: `Abertura · ${references.unitNames[opening.unit_id] ?? "Unidade"}`,
                    amount: opening.actual_opening_total,
                    createdAt: opening.opened_at,
                  })
                }
              >
                Excluir abertura
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {rows.map((t) => {
            const income = t.transaction_type === "income";
            const safeDrop = t.category === "Sangria";
            const isReversal = Boolean(t.reverses_transaction_id);
            const wasReversed = Boolean(t.reversed_at);
            return (
              <li key={t.id} className="flex items-start gap-3 py-4">
                <ReceiptThumb
                  path={t.photo_url}
                  alt={`Comprovante · ${t.category} · ${formatBRL(t.amount)}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 truncate font-medium">
                      {safeDrop ? (
                        <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
                          Sangria · Cofre
                        </span>
                      ) : null}
                      {isReversal || wasReversed ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {isReversal ? "Estorno" : "Estornado"}
                        </span>
                      ) : null}
                      <span className="truncate">
                        {t.category}
                        {t.client_name ? ` · ${t.client_name}` : ""}
                      </span>
                    </p>
                    <span
                      className={`shrink-0 font-semibold ${income ? "text-primary" : safeDrop ? "text-warning" : "text-destructive"}`}
                    >
                      {income ? "+" : "-"}
                      {formatBRL(t.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {references.unitNames[t.unit_id] ?? "Unidade"} ·{" "}
                    {t.payment_method ?? (safeDrop ? "Transferência para o cofre" : "Despesa")} ·{" "}
                    {references.names[t.user_id] ?? "Usuário"} ·{" "}
                    {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                  {t.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                  ) : null}
                  {!t.photo_url && !safeDrop ? (
                    <p className="mt-1 text-xs font-semibold text-destructive">Sem comprovante</p>
                  ) : null}
                  {!isReversal && !wasReversed ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPendingReversal(t)}>
                        <Undo2 className="size-4" /> Estornar erro
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "transaction",
                            id: t.id,
                            label: `${t.category}${t.client_name ? ` · ${t.client_name}` : ""}`,
                            amount: t.amount,
                            createdAt: t.created_at,
                          })
                        }
                      >
                        Excluir definitivamente
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground">
          {count === 0
            ? "0 resultados"
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} de ${count}`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={(page + 1) * PAGE_SIZE >= count}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog
        open={Boolean(pendingReversal)}
        onOpenChange={(open) => {
          if (!open && !reverseMutation.isPending) {
            setPendingReversal(null);
            setReversalReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estornar lançamento incorreto?</DialogTitle>
            <DialogDescription>
              O registro não será apagado: um estorno compensatório será criado para corrigir o
              caixa sem perder o histórico da auditoria.
            </DialogDescription>
          </DialogHeader>
          {pendingReversal ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {pendingReversal.category} · {formatBRL(pendingReversal.amount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {references.unitNames[pendingReversal.unit_id] ?? "Unidade"} ·{" "}
                {new Date(pendingReversal.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
          ) : null}
          <Textarea
            value={reversalReason}
            onChange={(event) => setReversalReason(event.target.value)}
            placeholder="Informe o motivo da correção"
            aria-label="Motivo do estorno"
            disabled={reverseMutation.isPending}
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPendingReversal(null)}
              disabled={reverseMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={reversalReason.trim().length < 5 || reverseMutation.isPending}
              onClick={() => {
                if (!pendingReversal) return;
                reverseMutation.mutate({ id: pendingReversal.id, reason: reversalReason.trim() });
              }}
            >
              {reverseMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleteOpeningMutation.isPending && !masterDeleteTransaction.isPending) {
            setDeleteTarget(null);
            setDeleteReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar exclusão definitiva?</DialogTitle>
            <DialogDescription>
              Esta ação remove o registro operacional. Uma cópia completa permanecerá na auditoria.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold">{deleteTarget.label}</p>
              <p className="text-muted-foreground">
                {formatBRL(deleteTarget.amount)} ·{" "}
                {new Date(deleteTarget.createdAt).toLocaleString("pt-BR")}
              </p>
            </div>
          ) : null}
          <Textarea
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Informe o motivo da exclusão"
            aria-label="Motivo da exclusão definitiva"
            disabled={deleteOpeningMutation.isPending || masterDeleteTransaction.isPending}
          />
          {deleteReason.length > 0 && deleteReason.trim().length < 5 ? (
            <p className="text-xs font-semibold text-destructive">
              Informe pelo menos 5 caracteres.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteReason("");
              }}
              disabled={deleteOpeningMutation.isPending || masterDeleteTransaction.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleteReason.trim().length < 5 ||
                deleteOpeningMutation.isPending ||
                masterDeleteTransaction.isPending
              }
              onClick={() => {
                if (!deleteTarget) return;
                const payload = { id: deleteTarget.id, reason: deleteReason.trim() };
                if (deleteTarget.kind === "opening") deleteOpeningMutation.mutate(payload);
                else masterDeleteTransaction.mutate(payload);
              }}
            >
              {deleteOpeningMutation.isPending || masterDeleteTransaction.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BlindCalculator
        open={Boolean(openingToCorrect)}
        onOpenChange={(open) => !open && setOpeningToCorrect(null)}
        title="Corrigir contagem de abertura"
        description={`Refaça a contagem física. O valor atual é ${formatBRL(openingToCorrect?.total ?? 0)}. Informe o motivo no campo de observações.`}
        submitLabel="Salvar correção"
        submitting={correctOpeningMutation.isPending}
        onSubmit={({ quantities, notes }) => {
          if (!openingToCorrect) return;
          if (notes.trim().length < 5) {
            toast.error("Informe o motivo da correção", {
              description: "Use pelo menos 5 caracteres no campo de observações.",
            });
            return;
          }
          correctOpeningMutation.mutate({
            shiftId: openingToCorrect.id,
            quantities,
            reason: notes.trim(),
          });
        }}
      />
    </section>
  );
}
