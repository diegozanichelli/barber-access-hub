import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PeriodFilter, periodCutoff, type PeriodDays } from "@/components/period-filter";
import { DENOMINATIONS, formatBRL } from "@/lib/cash";
import { differenceReason } from "@/lib/divergences";
import { supabase } from "@/integrations/supabase/client";
import { useAuditorReferences, type CashCountRow, type ShiftRow } from "@/hooks/use-auditor-data";

const PAGE_SIZE = 20;

type ShiftView = {
  shift: ShiftRow;
  diff: number;
  shiftDiff: number | null;
  handoverDiff: number | null;
  handoverCount: CashCountRow | undefined;
  resolved: boolean;
  hasDifference: boolean;
  bad: boolean;
  reason: string;
};

function buildShiftView(s: ShiftRow, pageCounts: CashCountRow[]): ShiftView {
  const diff =
    Math.round((Number(s.actual_opening_total) - Number(s.expected_opening_total)) * 100) / 100;
  const hasClosing = s.expected_closing_total !== null && s.closing_total !== null;
  const shiftDiff = hasClosing
    ? Math.round((Number(s.closing_total) - Number(s.expected_closing_total)) * 100) / 100
    : null;
  const shiftBad = shiftDiff !== null && Math.abs(shiftDiff) >= 0.01;
  const openingBad = Math.abs(diff) >= 0.01;
  const handoverCounts = pageCounts.filter(
    (cashCount) => cashCount.shift_id === s.id && cashCount.count_type === "handover",
  );
  const handoverCount = handoverCounts[handoverCounts.length - 1];
  const handoverDiff = handoverCount
    ? Math.round((Number(handoverCount.total_calculated) - Number(s.closing_total ?? 0)) * 100) /
      100
    : null;
  const handoverBad = handoverDiff !== null && Math.abs(handoverDiff) >= 0.01;
  // A diferença registrada nunca some — é o histórico do que foi contado.
  // O que muda ao encerrar é o alarme: divergência tratada não segue vermelha.
  const resolved = Boolean(s.resolved_at);
  const hasDifference = openingBad || shiftBad || handoverBad || s.status === "disputed";
  const bad = hasDifference && !resolved;
  const reason = handoverBad
    ? `${differenceReason(handoverDiff)} de ${formatBRL(Math.abs(handoverDiff!))} no recebimento`
    : shiftBad
      ? `${differenceReason(shiftDiff)} de ${formatBRL(Math.abs(shiftDiff!))} no fechamento`
      : openingBad
        ? `${differenceReason(diff)} de ${formatBRL(Math.abs(diff))} na abertura`
        : s.status === "disputed"
          ? "Sem diferença matemática — revisar status"
          : "Sem divergência";
  return { shift: s, diff, shiftDiff, handoverDiff, handoverCount, resolved, hasDifference, bad, reason };
}

function statusLabel(s: ShiftRow, resolved: boolean, hasDifference: boolean): string {
  if (s.status === "open") return "Aberto";
  if (s.status === "disputed") return "Com divergência";
  if (resolved && hasDifference) return "Divergência encerrada";
  return "Fechado";
}
const COUNT_LABELS: Record<string, string> = {
  opening: "Abertura",
  closing: "Fechamento",
  handover: "Recebimento do repasse",
};

export function ShiftHistory() {
  const { data: references } = useAuditorReferences();
  const [detail, setDetail] = useState<ShiftRow | null>(null);
  const [page, setPage] = useState(0);

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["audit-shift-history", page],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [historyResult, openCountResult] = await Promise.all([
        supabase
          .from("shifts")
          .select("*", { count: "exact" })
          .in("status", ["open", "closed", "disputed"])
          .order("opened_at", { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
        supabase.from("shifts").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      if (historyResult.error) throw historyResult.error;
      if (openCountResult.error) throw openCountResult.error;
      return {
        rows: (historyResult.data ?? []) as ShiftRow[],
        count: historyResult.count ?? 0,
        openCount: openCountResult.count ?? 0,
      };
    },
  });

  const pageShiftIds = (pageData?.rows ?? []).map((shift) => shift.id);
  const { data: pageCounts = [], isLoading: isLoadingPageCounts } = useQuery({
    queryKey: ["audit-shift-page-counts", pageShiftIds],
    enabled: pageShiftIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_counts")
        .select("*")
        .in("shift_id", pageShiftIds)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CashCountRow[];
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

  if (isLoading || isLoadingPageCounts || !references) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const shifts = pageData?.rows ?? [];
  const count = pageData?.count ?? 0;
  const openCount = pageData?.openCount ?? 0;

  return (
    <section className="surface-panel p-5">
      <h2 className="text-lg">Histórico de turnos e divergências</h2>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <Clock3 className="size-4 text-primary" aria-hidden />
        <span>
          <strong>{openCount}</strong> {openCount === 1 ? "turno aberto" : "turnos abertos"} em toda
          a rede. Turnos abertos, fechados e divergentes aparecem juntos abaixo.
        </span>
      </div>
      <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <strong>Como ler:</strong> “Diferença do turno” compara o esperado pelo sistema com o valor
        entregue no fechamento. “Diferença do repasse” compara o valor entregue com o que o próximo
        colaborador contou ao receber. Portanto, dois valores de fechamento iguais não descartam uma
        divergência no recebimento.
      </p>

      {shifts.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum turno registrado ainda.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Unidade</th>
                <th className="py-2 pr-3">Situação</th>
                <th className="py-2 pr-3">Onde está a diferença?</th>
                <th className="py-2 pr-3">Abertura</th>
                <th className="py-2 pr-3">Esperado (abertura)</th>
                <th className="py-2 pr-3">Contado (abertura)</th>
                <th className="py-2 pr-3">Diferença abertura</th>
                <th className="py-2 pr-3">Esperado no Fechamento</th>
                <th className="py-2 pr-3">Entregue no fechamento</th>
                <th className="py-2 pr-3">Diferença do Turno</th>
                <th className="py-2 pr-3">Contado no recebimento</th>
                <th className="py-2 pr-3">Diferença do repasse</th>
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
                const handoverCounts = pageCounts.filter(
                  (cashCount) => cashCount.shift_id === s.id && cashCount.count_type === "handover",
                );
                const handoverCount = handoverCounts[handoverCounts.length - 1];
                const handoverDiff = handoverCount
                  ? Math.round(
                      (Number(handoverCount.total_calculated) - Number(s.closing_total ?? 0)) * 100,
                    ) / 100
                  : null;
                const handoverBad = handoverDiff !== null && Math.abs(handoverDiff) >= 0.01;
                // A diferença registrada nunca some — é o histórico do que foi
                // contado. O que muda ao encerrar é o alarme: uma divergência já
                // tratada não deve seguir vermelha como se fosse pendência.
                const resolved = Boolean(s.resolved_at);
                const hasDifference =
                  openingBad || shiftBad || handoverBad || s.status === "disputed";
                const bad = hasDifference && !resolved;
                const reason = handoverBad
                  ? `${differenceReason(handoverDiff)} de ${formatBRL(Math.abs(handoverDiff!))} no recebimento`
                  : shiftBad
                    ? `${differenceReason(shiftDiff)} de ${formatBRL(Math.abs(shiftDiff!))} no fechamento`
                    : openingBad
                      ? `${differenceReason(diff)} de ${formatBRL(Math.abs(diff))} na abertura`
                      : s.status === "disputed"
                        ? "Sem diferença matemática — revisar status"
                        : "Sem divergência";
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
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          s.status === "open"
                            ? "bg-primary/15 text-primary"
                            : s.status === "disputed"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {s.status === "open"
                          ? "Aberto"
                          : s.status === "disputed"
                            ? "Com divergência"
                            : resolved && hasDifference
                              ? "Divergência encerrada"
                              : "Fechado"}
                      </span>
                    </td>
                    <td
                      className={`py-3 pr-3 text-xs font-semibold ${bad ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {reason}
                      {resolved && hasDifference ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          Encerrada
                          {s.resolved_at
                            ? ` em ${new Date(s.resolved_at).toLocaleString("pt-BR")}`
                            : ""}
                          {s.resolution_note ? `: ${s.resolution_note}` : ""}
                        </span>
                      ) : null}
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
                    <td className="py-3 pr-3">
                      {handoverCount ? formatBRL(handoverCount.total_calculated) : "—"}
                      {handoverCount ? (
                        <span className="block text-xs text-muted-foreground">
                          {references.names[handoverCount.counted_by] ?? "Usuário"}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`py-3 pr-3 font-semibold ${handoverBad ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {handoverDiff === null ? (
                        "—"
                      ) : (
                        <>
                          {handoverDiff > 0 ? "+" : ""}
                          {formatBRL(handoverDiff)}
                          {handoverBad ? (
                            <span className="block text-xs">{differenceReason(handoverDiff)}</span>
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
                  {COUNT_LABELS[c.count_type] ?? c.count_type} ·{" "}
                  {references.names[c.counted_by] ?? "Usuário"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString("pt-BR")}
                </p>
                {c.notes ? (
                  <p className="mt-2 rounded-md border border-border/60 bg-muted/50 p-2 text-xs text-muted-foreground">
                    <strong>Observação:</strong> {c.notes}
                  </p>
                ) : null}
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
