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
  /** 'drawer' = saiu da gaveta; 'safe' = saiu do cofre. Ausente = 'safe'. */
  source?: string | null;
};

/**
 * Running physical cash in the drawer:
 * actual counted opening + cash incomes - expenses - safe drops (sangrias)
 * - partner withdrawals taken straight from the drawer (source='drawer').
 *
 * Partner withdrawals from the safe (source='safe') are NOT subtracted here:
 * that money already left the drawer as a safe drop, and the partner takes it
 * from the safe.
 */
export function computeRunningCash(
  actualOpeningTotal: number | string | null | undefined,
  transactions: CashTransaction[] = [],
  withdrawals: CashWithdrawal[] = [],
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
    } else if (t.category === "Troco") {
      // Troco em dinheiro já está embutido na venda (a venda foi lançada pelo
      // valor real). Troco devolvido via Pix deixa a sobra em espécie na gaveta.
      if (t.payment_method === "Pix") total += amount;
    } else {
      total -= amount;
    }
  }

  // Retiradas de sócio que saíram da gaveta reduzem o caixa físico.
  for (const w of withdrawals) {
    if (w.source === "drawer") total -= Number(w.amount ?? 0);
  }

  return Math.round(total * 100) / 100;
}

/** Theoretical cash that should be in the drawer at closing time. */
export const computeExpectedClosing = computeRunningCash;

/**
 * Saldo do cofre: sangrias menos retiradas de sócio que saíram DO COFRE
 * (source='safe'; linhas antigas sem source contam como 'safe'), em qualquer
 * status (pendente, confirmada e contestada) — o dinheiro saiu fisicamente do
 * cofre; "contestada" é um alerta para a auditoria, não um estorno. Retiradas
 * da gaveta (source='drawer') não tocam o cofre.
 *
 * O cofre é acumulado por UNIDADE (não zera a cada turno): passe todos os
 * lançamentos e retiradas da unidade, não apenas os do turno aberto.
 *
 * ATENÇÃO: as telas usam a RPC `unit_safe_balance`, que é a fonte autoritativa.
 * Esta função existe para cobrir a mesma regra em teste; ao mudar uma das duas,
 * mude a outra, senão o teste continua verde sobre uma regra que não roda.
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
    if ((w.source ?? "safe") === "safe") total -= Number(w.amount ?? 0);
  }

  return Math.round(total * 100) / 100;
}

export function isOverLimit(runningCash: number): boolean {
  return runningCash > CASH_LIMIT;
}
