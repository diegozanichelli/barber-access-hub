import { describe, expect, test } from "bun:test";
import { computeRunningCash, computeSafeBalance, isOverLimit } from "./running-cash";

describe("computeRunningCash", () => {
  test("only adds cash income and subtracts drawer outflows", () => {
    expect(
      computeRunningCash(100, [
        { transaction_type: "income", payment_method: "Dinheiro", amount: 80 },
        { transaction_type: "income", payment_method: "Pix", amount: 200 },
        { transaction_type: "expense", payment_method: null, amount: 25 },
      ]),
    ).toBe(155);
  });

  test("removes both sides of a reversal from the physical drawer", () => {
    expect(
      computeRunningCash(100, [
        {
          transaction_type: "income",
          payment_method: "Pix",
          amount: 200,
          reversed_at: "2026-08-18T12:00:00Z",
        },
        {
          transaction_type: "expense",
          payment_method: "Pix",
          amount: 200,
          reverses_transaction_id: "original-pix",
        },
        {
          transaction_type: "expense",
          payment_method: null,
          category: "Sangria",
          amount: 80,
          reversed_at: "2026-08-18T12:01:00Z",
        },
        {
          transaction_type: "income",
          payment_method: null,
          category: "Sangria",
          amount: 80,
          reverses_transaction_id: "original-safe-drop",
        },
      ]),
    ).toBe(100);
  });
});

describe("computeSafeBalance", () => {
  test("accumulates active safe drops and subtracts every physical withdrawal", () => {
    expect(
      computeSafeBalance(
        [
          {
            transaction_type: "expense",
            category: "Sangria",
            payment_method: null,
            amount: 500,
          },
          {
            transaction_type: "expense",
            category: "Sangria",
            payment_method: null,
            amount: 100,
            reversed_at: "2026-08-18T00:00:00Z",
          },
        ],
        [
          { status: "approved", amount: 150 },
          { status: "disputed", amount: 50 },
        ],
      ),
    ).toBe(300);
  });
});

describe("isOverLimit", () => {
  test("warns only above the R$ 1,000 threshold", () => {
    expect(isOverLimit(1000)).toBe(false);
    expect(isOverLimit(1000.01)).toBe(true);
  });
});
