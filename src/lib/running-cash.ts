export const CASH_LIMIT = 1000;

export type CashTransaction = {
  transaction_type: string;
  payment_method: string | null;
  amount: number | string;
  category?: string | null;
  reverses_transaction_id?: string | null;
  reversed_at?: string | null;
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
    // A reversed original and its compensating audit row have no active
    // physical effect. This also handles non-cash income and safe-drop
    // reversals without treating them as drawer expenses/income.
    if (t.reversed_at || t.reverses_transaction_id) continue;
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
 * Saldo do cofre: sangrias menos retiradas de sócio em qualquer status
 * (pendente, confirmada e contestada) — o dinheiro saiu fisicamente do cofre;
 * "contestada" é um alerta para a auditoria, não um estorno.
 *
 * O cofre é acumulado por UNIDADE (não zera a cada turno): passe todos os
 * lançamentos e retiradas da unidade, não apenas os do turno aberto.
 */
export function computeSafeBalance(
  transactions: CashTransaction[] = [],
  withdrawals: CashWithdrawal[] = [],
): number {
  let total = 0;

  for (const t of transactions) {
    if (t.reverses_transaction_id || t.reversed_at) continue;
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
