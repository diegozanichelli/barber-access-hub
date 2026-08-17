export const CASH_LIMIT = 1000;

export type CashTransaction = {
  transaction_type: string;
  payment_method: string | null;
  amount: number | string;
};

export type CashWithdrawal = {
  status: string;
  amount: number | string;
};

/**
 * Running physical cash in the drawer:
 * expected opening + cash incomes - expenses - partner withdrawals (not disputed).
 */
export function computeRunningCash(
  expectedOpeningTotal: number | string | null | undefined,
  transactions: CashTransaction[] = [],
  withdrawals: CashWithdrawal[] = [],
): number {
  let total = Number(expectedOpeningTotal ?? 0);

  for (const t of transactions) {
    const amount = Number(t.amount ?? 0);
    if (t.transaction_type === "income") {
      if (t.payment_method === "Dinheiro") total += amount;
    } else {
      total -= amount;
    }
  }

  for (const w of withdrawals) {
    if (w.status !== "disputed") total -= Number(w.amount ?? 0);
  }

  return Math.round(total * 100) / 100;
}

export function isOverLimit(runningCash: number): boolean {
  return runningCash > CASH_LIMIT;
}
