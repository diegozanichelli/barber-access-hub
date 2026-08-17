export const CASH_LIMIT = 1000;

export type CashTransaction = {
  transaction_type: string;
  payment_method: string | null;
  amount: number | string;
  category?: string | null;
};

export type CashWithdrawal = {
  status: string;
  amount: number | string;
};

/**
 * Running physical cash in the drawer:
 * actual counted opening + cash incomes - expenses - safe drops (sangrias).
 *
 * Partner withdrawals are NOT subtracted here: the money already left the
 * drawer as a safe drop, and the partner takes it from the safe.
 */
export function computeRunningCash(
  actualOpeningTotal: number | string | null | undefined,
  transactions: CashTransaction[] = [],
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

  return Math.round(total * 100) / 100;
}

/** Theoretical cash that should be in the drawer at closing time. */
export const computeExpectedClosing = computeRunningCash;

/**
 * Money held in the safe for this shift: safe drops (sangrias) minus partner
 * withdrawals in every status (pending, approved and disputed) — the money
 * physically left the safe; "disputed" is an auditor alert, not a refund.
 */
export function computeSafeBalance(
  transactions: CashTransaction[] = [],
  withdrawals: CashWithdrawal[] = [],
): number {
  let total = 0;

  for (const t of transactions) {
    if (t.transaction_type !== "income" && t.category === "Sangria") {
      total += Number(t.amount ?? 0);
    }
  }

  for (const w of withdrawals) {
    total -= Number(w.amount ?? 0);
  }

  return Math.round(total * 100) / 100;
}

export function isOverLimit(runningCash: number): boolean {
  return runningCash > CASH_LIMIT;
}
