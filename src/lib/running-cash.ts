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
 * actual counted opening + cash incomes - expenses - partner withdrawals.
 *
 * Withdrawals are subtracted in every status (pending, approved and disputed):
 * the money physically left the drawer. "disputed" is an auditor alert state,
 * never an automatic refund.
 */
export function computeRunningCash(
  actualOpeningTotal: number | string | null | undefined,
  transactions: CashTransaction[] = [],
  withdrawals: CashWithdrawal[] = [],
): number {
  let total = Number(actualOpeningTotal ?? 0);

  for (const t of transactions) {
    const amount = Number(t.amount ?? 0);
    if (t.transaction_type === "income") {
      if (t.payment_method === "Dinheiro") total += amount;
    } else {
      total -= amount;
    }
  }

  for (const w of withdrawals) {
    total -= Number(w.amount ?? 0);
  }

  return Math.round(total * 100) / 100;
}

/** Theoretical cash that should be in the drawer at closing time. */
export const computeExpectedClosing = computeRunningCash;


export function isOverLimit(runningCash: number): boolean {
  return runningCash > CASH_LIMIT;
}
