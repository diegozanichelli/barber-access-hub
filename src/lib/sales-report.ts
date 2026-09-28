export const SALES_REPORT_CATEGORIES = [
  "Bebida",
  "Produtos",
  "Assinatura Nova",
  "Renovação",
  "Upgrade",
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
  return {
    unitId,
    categories: {
      Bebida: emptyMetric(),
      Produtos: emptyMetric(),
      "Assinatura Nova": emptyMetric(),
      Renovação: emptyMetric(),
      Upgrade: emptyMetric(),
    },
    total: emptyMetric(),
  };
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
