import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DENOMINATIONS, formatBRL } from "@/lib/cash";
import { supabase } from "@/integrations/supabase/client";
import { useAuditorReferences, type CashCountRow, type ShiftRow } from "@/hooks/use-auditor-data";

const PAGE_SIZE = 20;

export function ShiftHistory() {
  const { data: references } = useAuditorReferences();
  const [detail, setDetail] = useState<ShiftRow | null>(null);
  const [page, setPage] = useState(0);

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["audit-shift-history", page],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("shifts")
        .select("*", { count: "exact" })
        .in("status", ["closed", "disputed"])
        .order("opened_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as ShiftRow[], count: count ?? 0 };
    },
  });

  const { data: counts = [] } = useQuery({
    queryKey: ["audit-shift-counts", detail?.id],
    enabled: Boolean(detail?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_counts")
        .select("*")
        .eq("shift_id", detail!.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as CashCountRow[];
    },
  });

  if (isLoading || !references) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const shifts = pageData?.rows ?? [];
  const count = pageData?.count ?? 0;

  return (
    <section className="surface-panel p-5">
      <h2 className="text-lg">Histórico de turnos e divergências</h2>

      {shifts.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum turno fechado ainda.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Unidade</th>
                <th className="py-2 pr-3">Abertura</th>
                <th className="py-2 pr-3">Esperado (abertura)</th>
                <th className="py-2 pr-3">Contado (abertura)</th>
                <th className="py-2 pr-3">Diferença abertura</th>
                <th className="py-2 pr-3">Esperado no Fechamento</th>
                <th className="py-2 pr-3">Contado/Repassado</th>
                <th className="py-2 pr-3">Diferença do Turno</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const diff =
                  Math.round(
                    (Number(s.actual_opening_total) - Number(s.expected_opening_total)) * 100,
                  ) / 100;
                const hasClosing = s.expected_closing_total !== null && s.closing_total !== null;
                const shiftDiff = hasClosing
                  ? Math.round((Number(s.closing_total) - Number(s.expected_closing_total)) * 100) /
                    100
                  : null;
                const shiftBad = shiftDiff !== null && Math.abs(shiftDiff) >= 0.01;
                const openingBad = Math.abs(diff) >= 0.01;
                const bad = openingBad || shiftBad || s.status === "disputed";
                return (
                  <tr
                    key={s.id}
                    className={`border-t border-border/60 ${bad ? "bg-destructive/10" : ""}`}
                  >
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-1">
                        {bad ? (
                          <AlertTriangle className="size-4 text-destructive" aria-hidden />
                        ) : null}
                        {references.unitNames[s.unit_id] ?? "Unidade"}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {new Date(s.opened_at).toLocaleString("pt-BR")}
                      <span className="block text-xs">
                        {references.names[s.opened_by] ?? "Usuário"}
                      </span>
                    </td>
                    <td className="py-3 pr-3">{formatBRL(s.expected_opening_total)}</td>
                    <td className="py-3 pr-3">{formatBRL(s.actual_opening_total)}</td>
                    <td
                      className={`py-3 pr-3 font-semibold ${openingBad ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {diff > 0 ? "+" : ""}
                      {formatBRL(diff)}
                    </td>
                    <td className="py-3 pr-3">
                      {s.expected_closing_total === null
                        ? "—"
                        : formatBRL(s.expected_closing_total)}
                    </td>
                    <td className="py-3 pr-3">
                      {s.closing_total === null ? "—" : formatBRL(s.closing_total)}
                      {s.status === "disputed" ? (
                        <span className="block text-xs font-semibold text-destructive">
                          Repasse divergente
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`py-3 pr-3 font-semibold ${shiftBad ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {shiftDiff === null ? (
                        "—"
                      ) : (
                        <>
                          {shiftDiff > 0 ? "+" : ""}
                          {formatBRL(shiftDiff)}
                          {shiftBad ? (
                            <span className="block text-xs">
                              {shiftDiff > 0 ? "Sobra" : "Falta"}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="py-3">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(s)}>
                        Ver contagem
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground">
          {count === 0
            ? "0 turnos"
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} de ${count}`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={(page + 1) * PAGE_SIZE >= count}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>
            Contagem detalhada · {detail ? (references.unitNames[detail.unit_id] ?? "Unidade") : ""}
          </DialogTitle>
          {counts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma contagem registrada.</p>
          ) : (
            counts.map((c: CashCountRow) => (
              <div key={c.id} className="rounded-lg border border-border/60 p-4">
                <p className="text-sm font-semibold">
                  {c.count_type === "opening" ? "Abertura" : "Fechamento"} ·{" "}
                  {references.names[c.counted_by] ?? "Usuário"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString("pt-BR")}
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {DENOMINATIONS.map((d) => (
                    <li key={d.field} className="flex justify-between">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span>
                        {c[d.field]} × {formatBRL(d.value)} = {formatBRL(c[d.field] * d.value)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-border/60 pt-2 font-semibold">
                  <span>Total contado</span>
                  <span>{formatBRL(c.total_calculated)}</span>
                </p>
              </div>
            ))
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
