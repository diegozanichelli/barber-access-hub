import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { computeRunningCash, isOverLimit } from "@/lib/running-cash";

export function AuditorOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["auditor-overview"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [shiftsRes, txRes, wdRes] = await Promise.all([
        supabase
          .from("shifts")
          .select("*, units ( name )")
          .in("status", ["open", "pending_handover", "disputed"])
          .order("opened_at", { ascending: false }),
        supabase.from("transactions").select("shift_id, transaction_type, payment_method, amount"),
        supabase.from("partner_withdrawals").select("*, units ( name )"),
      ]);
      if (shiftsRes.error) throw shiftsRes.error;
      if (txRes.error) throw txRes.error;
      if (wdRes.error) throw wdRes.error;
      return {
        shifts: shiftsRes.data ?? [],
        transactions: txRes.data ?? [],
        withdrawals: wdRes.data ?? [],
      };
    },
  });

  if (isLoading) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const shifts = data?.shifts ?? [];
  const openShifts = shifts.filter((s) => s.status === "open");
  const disputedShifts = shifts.filter((s) => s.status === "disputed");
  const pendingHandovers = shifts.filter((s) => s.status === "pending_handover");
  const disputedWithdrawals = (data?.withdrawals ?? []).filter((w) => w.status === "disputed");

  const rows = openShifts.map((s) => {
    const unitName = (s as { units?: { name: string } | null }).units?.name ?? "Unidade";
    const running = computeRunningCash(
      s.expected_opening_total,
      (data?.transactions ?? []).filter((t) => t.shift_id === s.id),
      (data?.withdrawals ?? []).filter((w) => w.shift_id === s.id),
    );
    return { id: s.id, unitName, running };
  });

  const overLimit = rows.filter((r) => isOverLimit(r.running));

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
                {overLimit.map((r) => `${r.unitName}: ${formatBRL(r.running)}`).join(" · ")}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {disputedShifts.length > 0 || disputedWithdrawals.length > 0 ? (
        <section className="rounded-xl border border-destructive/60 bg-destructive/10 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden />
            <h2 className="text-lg font-semibold">Divergências</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {disputedShifts.map((s) => (
              <li key={s.id}>
                Repasse divergente ·{" "}
                {(s as { units?: { name: string } | null }).units?.name ?? "Unidade"} · repassado{" "}
                {formatBRL(s.closing_total)} ·{" "}
                {new Date(s.closed_at ?? s.opened_at).toLocaleString("pt-BR")}
              </li>
            ))}
            {disputedWithdrawals.map((w) => (
              <li key={w.id}>
                Retirada contestada ·{" "}
                {(w as { units?: { name: string } | null }).units?.name ?? "Unidade"} ·{" "}
                {formatBRL(w.amount)} · {new Date(w.created_at).toLocaleString("pt-BR")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="surface-panel p-5">
        <h2 className="text-lg">Caixas em operação</h2>
        {rows.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nenhum caixa aberto agora.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-3">
                <span className="text-sm">{r.unitName}</span>
                <span
                  className={
                    isOverLimit(r.running)
                      ? "text-sm font-semibold text-destructive"
                      : "text-sm font-semibold text-primary"
                  }
                >
                  {formatBRL(r.running)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pendingHandovers.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {pendingHandovers.length} turno(s) aguardando repasse.
          </p>
        ) : null}
      </section>
    </>
  );
}
