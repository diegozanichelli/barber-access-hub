import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, ImageIcon, LockKeyhole, Unlock } from "lucide-react";
import { toast } from "sonner";
import { BlindCalculator } from "@/components/blind-calculator";
import { TransactionDialog } from "@/components/transaction-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, type CashQuantities } from "@/lib/cash";
import { getReceiptUrl } from "@/lib/transactions";

type Props = {
  userId: string;
  unitId: string | null;
};

type CalcMode = "opening" | "closing" | null;

export function ShiftPanel({ userId, unitId }: Props) {
  const queryClient = useQueryClient();
  const [calcMode, setCalcMode] = useState<CalcMode>(null);
  const [txType, setTxType] = useState<"income" | "expense" | null>(null);
  const [lastResult, setLastResult] = useState<{ label: string; total: number } | null>(null);

  const { data: openShift } = useQuery({
    queryKey: ["open-shift", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("unit_id", unitId!)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

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
      return data;
    },
  });

  const openMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!unitId) throw new Error("Você não está atribuído a uma unidade.");

      const { data: lastClosed, error: lastError } = await supabase
        .from("shifts")
        .select("closing_total")
        .eq("unit_id", unitId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw lastError;

      const expected = Number(lastClosed?.closing_total ?? 0);

      const { data: shift, error: shiftError } = await supabase
        .from("shifts")
        .insert({
          unit_id: unitId,
          opened_by: userId,
          expected_opening_total: expected,
          actual_opening_total: payload.total,
          status: "open",
        })
        .select()
        .single();
      if (shiftError) throw shiftError;

      const { error: countError } = await supabase.from("cash_counts").insert({
        shift_id: shift.id,
        count_type: "opening",
        counted_by: userId,
        ...payload.quantities,
        total_calculated: payload.total,
        notes: payload.notes || null,
      });
      if (countError) throw countError;

      return payload.total;
    },
    onSuccess: (total) => {
      setCalcMode(null);
      setLastResult({ label: "Caixa aberto com", total });
      toast.success("Caixa aberto", { description: `Total contado: ${formatBRL(total)}` });
      void queryClient.invalidateQueries({ queryKey: ["open-shift"] });
    },
    onError: (error: Error) => toast.error("Erro ao abrir o caixa", { description: error.message }),
  });

  const closeMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!openShift) throw new Error("Nenhum caixa aberto.");

      const { error: countError } = await supabase.from("cash_counts").insert({
        shift_id: openShift.id,
        count_type: "closing",
        counted_by: userId,
        ...payload.quantities,
        total_calculated: payload.total,
        notes: payload.notes || null,
      });
      if (countError) throw countError;

      const { error: shiftError } = await supabase
        .from("shifts")
        .update({
          status: "closed",
          closing_total: payload.total,
          closed_by: userId,
          closed_at: new Date().toISOString(),
        })
        .eq("id", openShift.id);
      if (shiftError) throw shiftError;

      return payload.total;
    },
    onSuccess: (total) => {
      setCalcMode(null);
      setLastResult({ label: "Caixa fechado com", total });
      toast.success("Caixa fechado", { description: `Total contado: ${formatBRL(total)}` });
      void queryClient.invalidateQueries({ queryKey: ["open-shift"] });
    },
    onError: (error: Error) =>
      toast.error("Erro ao fechar o caixa", { description: error.message }),
  });

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

  return (
    <>
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
              <Button variant="outline" className="h-12 w-full" onClick={() => setCalcMode("closing")}>
                <LockKeyhole className="size-4" />
                Fechar Caixa
              </Button>
            </div>
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

      {openShift ? (
        <section className="surface-panel p-5">
          <h2 className="text-lg">Movimentações do turno</h2>
          {(transactions ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60">
              {(transactions ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {t.transaction_type === "income"
                        ? `${t.category} · ${t.client_name ?? ""}`
                        : (t.description ?? "Despesa")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.payment_method ? `${t.payment_method} · ` : ""}
                      {new Date(t.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
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
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <BlindCalculator
        open={calcMode === "opening"}
        onOpenChange={(o) => setCalcMode(o ? "opening" : null)}
        title="Abrir Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar abertura"
        submitting={openMutation.isPending}
        onSubmit={(payload) => openMutation.mutate(payload)}
      />

      <BlindCalculator
        open={calcMode === "closing"}
        onOpenChange={(o) => setCalcMode(o ? "closing" : null)}
        title="Fechar Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar fechamento"
        submitting={closeMutation.isPending}
        onSubmit={(payload) => closeMutation.mutate(payload)}
      />

      {openShift ? (
        <TransactionDialog
          type={txType}
          onOpenChange={(o) => setTxType(o ? txType : null)}
          shiftId={openShift.id}
          unitId={unitId}
          userId={userId}
        />
      ) : null}
    </>
  );
}
