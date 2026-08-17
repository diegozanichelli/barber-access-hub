export type CashField =
  | "notes_200"
  | "notes_100"
  | "notes_50"
  | "notes_20"
  | "notes_10"
  | "notes_5"
  | "notes_2"
  | "coins_1"
  | "coins_050"
  | "coins_025"
  | "coins_010"
  | "coins_005";

export const DENOMINATIONS: { field: CashField; label: string; value: number }[] = [
  { field: "notes_100", label: "Notas de R$ 100", value: 100 },
  { field: "notes_50", label: "Notas de R$ 50", value: 50 },
  { field: "notes_20", label: "Notas de R$ 20", value: 20 },
  { field: "notes_10", label: "Notas de R$ 10", value: 10 },
  { field: "notes_5", label: "Notas de R$ 5", value: 5 },
  { field: "notes_2", label: "Notas de R$ 2", value: 2 },
  { field: "coins_1", label: "Moedas de R$ 1,00", value: 1 },
  { field: "coins_050", label: "Moedas de R$ 0,50", value: 0.5 },
  { field: "coins_025", label: "Moedas de R$ 0,25", value: 0.25 },
  { field: "coins_010", label: "Moedas de R$ 0,10", value: 0.1 },
  { field: "coins_005", label: "Moedas de R$ 0,05", value: 0.05 },
];

export type CashQuantities = Record<CashField, number>;

export const EMPTY_QUANTITIES: CashQuantities = DENOMINATIONS.reduce((acc, d) => {
  acc[d.field] = 0;
  return acc;
}, {} as CashQuantities);

export function calculateTotal(quantities: CashQuantities): number {
  const total = DENOMINATIONS.reduce(
    (sum, d) => sum + (Number(quantities[d.field]) || 0) * d.value,
    0,
  );
  return Math.round(total * 100) / 100;
}

export function formatBRL(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
