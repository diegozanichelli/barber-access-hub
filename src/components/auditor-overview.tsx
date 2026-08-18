import { AlertTriangle, Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/cash";
import { computeRunningCash, computeSafeBalance, isOverLimit } from "@/lib/running-cash";
import { useAuditorData } from "@/hooks/use-auditor-data";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  pending_handover: "Pendente de repasse",
  disputed: "Repasse divergente",
  closed: "Fechado",
};

export function AuditorOverview() {
  const { data, isLoading } = useAuditorData();

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
    const disputedWithdrawal = data.withdrawals.some(
      (w) => w.unit_id === unit.id && w.status === "disputed",
    );

    const running = active
      ? computeRunningCash(
          active.actual_opening_total,
          data.transactions.filter((t) => t.shift_id === active.id),
        )
      : 0;

    // O cofre é acumulado por unidade: soma todas as sangrias e retiradas da unidade.
    const safe = computeSafeBalance(
      data.transactions.filter((t) => t.unit_id === unit.id),
      data.withdrawals.filter((w) => w.unit_id === unit.id),
    );



    return {
      unit,
      active,
      running,
      safe,
      disputed: disputedShift || disputedWithdrawal,
      over: Boolean(active) && isOverLimit(running),
      openedBy: active ? (data.names[active.opened_by] ?? "Usuário") : null,
    };

  });

  const overLimit = cards.filter((c) => c.over);
  const disputes = cards.filter((c) => c.disputed);

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
          <ul className="mt-3 space-y-2 text-sm">
            {data.shifts
              .filter((s) => s.status === "disputed")
              .map((s) => (
                <li key={s.id}>
                  Repasse divergente · {data.unitNames[s.unit_id] ?? "Unidade"} · repassado{" "}
                  {formatBRL(s.closing_total)} ·{" "}
                  {new Date(s.closed_at ?? s.opened_at).toLocaleString("pt-BR")}
                </li>
              ))}
            {data.withdrawals
              .filter((w) => w.status === "disputed")
              .map((w) => (
                <li key={w.id}>
                  Retirada contestada · {data.unitNames[w.unit_id] ?? "Unidade"} ·{" "}
                  {formatBRL(w.amount)} · {data.names[w.partner_id] ?? "Sócio"} ·{" "}
                  {new Date(w.created_at).toLocaleString("pt-BR")}
                </li>
              ))}
          </ul>
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
            </article>

          ))}
        </div>
      </section>
    </>
  );
}
