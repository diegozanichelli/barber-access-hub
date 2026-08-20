import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, PackageCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuditorReferences } from "@/hooks/use-auditor-data";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { downloadCSV, toCSV } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import {
  emptyUnitSalesSummary,
  SALES_REPORT_CATEGORIES,
  summarizeSalesByUnit,
  type SalesReportTransaction,
} from "@/lib/sales-report";
import { displayedIncomeCategory } from "@/lib/transactions";

const PAGE_SIZE = 1000;

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialPeriod() {
  const today = new Date();
  return {
    start: dateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateValue(today),
  };
}

async function fetchSales(start: string, end: string): Promise<SalesReportTransaction[]> {
  if (!start || !end || start > end) throw new Error("Selecione um período válido.");

  const rows: SalesReportTransaction[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("unit_id, category, amount, description")
      .eq("transaction_type", "income")
      .gte("created_at", `${start}T00:00:00-03:00`)
      .lte("created_at", `${end}T23:59:59.999-03:00`)
      .is("reversed_at", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = data ?? [];
    rows.push(
      ...page.flatMap((transaction) => {
        const category = displayedIncomeCategory(transaction.category, transaction.description);
        return SALES_REPORT_CATEGORIES.includes(
          category as (typeof SALES_REPORT_CATEGORIES)[number],
        )
          ? [
              {
                unit_id: transaction.unit_id,
                category: category as SalesReportTransaction["category"],
                amount: transaction.amount,
              },
            ]
          : [];
      }),
    );
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export function SalesReport() {
  const defaults = useMemo(initialPeriod, []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const references = useAuditorReferences();
  const report = useQuery({
    queryKey: ["sales-report", start, end],
    queryFn: () => fetchSales(start, end),
    enabled: Boolean(start && end && start <= end),
  });

  const summaries = summarizeSalesByUnit(report.data ?? []);
  const units = (references.data?.units ?? []).map((unit) => ({
    ...unit,
    sales: summaries[unit.id] ?? emptyUnitSalesSummary(unit.id),
  }));
  const network = units.reduce(
    (total, unit) => {
      for (const category of SALES_REPORT_CATEGORIES) {
        total[category].count += unit.sales.categories[category].count;
        total[category].amount += unit.sales.categories[category].amount;
      }
      total.all.count += unit.sales.total.count;
      total.all.amount += unit.sales.total.amount;
      return total;
    },
    {
      Bebida: { count: 0, amount: 0 },
      "Assinatura Nova": { count: 0, amount: 0 },
      Renovação: { count: 0, amount: 0 },
      Upgrade: { count: 0, amount: 0 },
      all: { count: 0, amount: 0 },
    },
  );

  function exportReport() {
    const rows = units.map((unit) => [
      unit.name,
      unit.sales.categories.Bebida.count,
      unit.sales.categories.Bebida.amount.toFixed(2),
      unit.sales.categories["Assinatura Nova"].count,
      unit.sales.categories["Assinatura Nova"].amount.toFixed(2),
      unit.sales.categories.Renovação.count,
      unit.sales.categories.Renovação.amount.toFixed(2),
      unit.sales.categories.Upgrade.count,
      unit.sales.categories.Upgrade.amount.toFixed(2),
      unit.sales.total.count,
      unit.sales.total.amount.toFixed(2),
    ]);
    rows.push([
      "TOTAL DA REDE",
      network.Bebida.count,
      network.Bebida.amount.toFixed(2),
      network["Assinatura Nova"].count,
      network["Assinatura Nova"].amount.toFixed(2),
      network.Renovação.count,
      network.Renovação.amount.toFixed(2),
      network.Upgrade.count,
      network.Upgrade.amount.toFixed(2),
      network.all.count,
      network.all.amount.toFixed(2),
    ]);
    downloadCSV(
      `vendas-por-unidade-${start}-a-${end}.csv`,
      toCSV(
        [
          "Unidade",
          "Bebidas (lançamentos)",
          "Bebidas (valor)",
          "Novas assinaturas (lançamentos)",
          "Novas assinaturas (valor)",
          "Renovações (lançamentos)",
          "Renovações (valor)",
          "Upgrades (lançamentos)",
          "Upgrades (valor)",
          "Total (lançamentos)",
          "Total (valor)",
        ],
        rows,
      ),
    );
  }

  const loading = report.isLoading || references.isLoading;
  const error = report.error ?? references.error;

  return (
    <section className="surface-panel space-y-5 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <PackageCheck className="size-5 text-primary" aria-hidden />
            <h2 className="font-display text-xl uppercase">Vendas por unidade</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare bebidas, novas assinaturas, renovações e upgrades no período selecionado.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="sales-start">Data inicial</Label>
            <Input
              id="sales-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sales-end">Data final</Label>
            <Input
              id="sales-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => void report.refetch()}
            disabled={loading || start > end}
          >
            <RefreshCw className={report.isFetching ? "animate-spin" : ""} /> Atualizar
          </Button>
          <Button onClick={exportReport} disabled={loading || Boolean(error)}>
            <Download /> Exportar CSV
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          Não foi possível carregar o relatório. {friendlyError(error)}
        </div>
      ) : loading ? (
        <div className="flex min-h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Carregando vendas…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {SALES_REPORT_CATEGORIES.map((category) => (
              <div key={category} className="rounded-xl border bg-card p-4">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{category}</p>
                <p className="mt-2 text-2xl font-bold text-primary">
                  {formatBRL(network[category].amount)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {network[category].count} lançamentos
                </p>
              </div>
            ))}
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Total da rede</p>
              <p className="mt-2 text-2xl font-bold text-primary">
                {formatBRL(network.all.amount)}
              </p>
              <p className="text-sm text-muted-foreground">{network.all.count} lançamentos</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Unidade</th>
                  {SALES_REPORT_CATEGORIES.map((category) => (
                    <th key={category} className="px-4 py-3">
                      {category}
                    </th>
                  ))}
                  <th className="px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-t">
                    <td className="px-4 py-3 font-semibold">{unit.name}</td>
                    {SALES_REPORT_CATEGORIES.map((category) => (
                      <td key={category} className="px-4 py-3">
                        <span className="font-medium">
                          {formatBRL(unit.sales.categories[category].amount)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {unit.sales.categories[category].count} lançamentos
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 font-semibold text-primary">
                      {formatBRL(unit.sales.total.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong>Conferência de estoque:</strong> a quantidade de bebidas representa o número de
        lançamentos, pois o cadastro atual não informa quantas unidades do produto foram vendidas em
        cada lançamento. O CSV permite conferir os lançamentos e valores; para controle por item,
        será necessário registrar produto e quantidade na venda.
      </p>
    </section>
  );
}
