export const SALES_REPORT_CATEGORIES = [
  "Bebida",
  "Assinatura Nova",
  "Renovação",
  "Upgrade",
  "Serviços",
  "Produtos",
] as const;

export type SalesReportCategory = (typeof SALES_REPORT_CATEGORIES)[number];

export type SalesReportTransaction = {
  unit_id: string;
  category: SalesReportCategory;
  amount: number;
};

export type SalesMetric = { count: number; amount: number };

export type UnitSalesSummary = {
  unitId: string;
  categories: Record<SalesReportCategory, SalesMetric>;
  total: SalesMetric;
};

function emptyMetric(): SalesMetric {
  return { count: 0, amount: 0 };
}

export function emptyUnitSalesSummary(unitId: string): UnitSalesSummary {
  // Derivado de SALES_REPORT_CATEGORIES: acrescentar uma categoria à lista
  // passa a contá-la aqui automaticamente, sem uma linha esquecida deixar a
  // receita dela fora do relatório.
  const categories = Object.fromEntries(
    SALES_REPORT_CATEGORIES.map((category) => [category, emptyMetric()]),
  ) as Record<SalesReportCategory, SalesMetric>;
  return { unitId, categories, total: emptyMetric() };
}

export function summarizeSalesByUnit(
  transactions: SalesReportTransaction[],
): Record<string, UnitSalesSummary> {
  const summaries: Record<string, UnitSalesSummary> = {};

  for (const transaction of transactions) {
    const summary = (summaries[transaction.unit_id] ??= emptyUnitSalesSummary(transaction.unit_id));
    const amount = Number(transaction.amount) || 0;
    summary.categories[transaction.category].count += 1;
    summary.categories[transaction.category].amount += amount;
    summary.total.count += 1;
    summary.total.amount += amount;
  }

  return summaries;
}
