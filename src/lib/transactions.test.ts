import { describe, expect, test } from "bun:test";
import {
  allocateComandaRows,
  displayedIncomeCategory,
  incomePhotoRequired,
  isMissingUpgradeEnum,
  isRoundAmount,
  parseAmount,
  type ComandaItem,
  type ComandaPayment,
} from "./transactions";

/** Soma auxiliar em centavos para checar invariantes sem erro de float. */
const cents = (n: number) => Math.round(n * 100);

describe("transaction rules", () => {
  test("preserves Upgrade while the database enum is being rolled out", () => {
    expect(displayedIncomeCategory("Renovação", "__upgrade__")).toBe("Upgrade");
    expect(
      isMissingUpgradeEnum({
        message: 'invalid input value for enum transaction_category: "Upgrade"',
      }),
    ).toBe(true);
  });

  test("requires proof only for Pix income", () => {
    expect(incomePhotoRequired("Bebida", "Dinheiro")).toBe(false);
    expect(incomePhotoRequired("Bebida", "Pix")).toBe(true);
    expect(incomePhotoRequired("Renovação", "Dinheiro")).toBe(false);
    expect(incomePhotoRequired("Assinatura Nova", "Cellcoins")).toBe(false);
  });

  test.each<[string, number]>([
    ["1.234,56", 1234.56],
    ["1234.56", 1234.56],
    ["1.500", 1500],
    ["R$ 12,50", 12.5],
  ])("parses %s as %d", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  test("detects positive values without cents", () => {
    expect(isRoundAmount(38)).toBe(true);
    expect(isRoundAmount(38.5)).toBe(false);
    expect(isRoundAmount(0)).toBe(false);
  });
});

describe("allocateComandaRows", () => {
  test("um item, um pagamento: uma linha", () => {
    const items: ComandaItem[] = [{ category: "Produtos", amount: 30 }];
    const payments: ComandaPayment[] = [{ method: "Pix", amount: 30 }];
    expect(allocateComandaRows(items, payments)).toEqual([
      { category: "Produtos", paymentMethod: "Pix", amount: 30 },
    ]);
  });

  test("produto + assinatura pagos num Pix só: cada item na sua categoria", () => {
    const items: ComandaItem[] = [
      { category: "Produtos", amount: 30 },
      { category: "Assinatura Nova", amount: 100 },
    ];
    const payments: ComandaPayment[] = [{ method: "Pix", amount: 130 }];
    expect(allocateComandaRows(items, payments)).toEqual([
      { category: "Produtos", paymentMethod: "Pix", amount: 30 },
      { category: "Assinatura Nova", paymentMethod: "Pix", amount: 100 },
    ]);
  });

  test("pagamento misto: preserva total por categoria e por método", () => {
    const items: ComandaItem[] = [
      { category: "Produtos", amount: 30 },
      { category: "Assinatura Nova", amount: 100 },
    ];
    const payments: ComandaPayment[] = [
      { method: "Pix", amount: 100 },
      { method: "Dinheiro", amount: 30 },
    ];
    const rows = allocateComandaRows(items, payments);

    const byCategory = (c: string) =>
      rows.filter((r) => r.category === c).reduce((s, r) => s + cents(r.amount), 0);
    const byMethod = (m: string) =>
      rows.filter((r) => r.paymentMethod === m).reduce((s, r) => s + cents(r.amount), 0);

    expect(byCategory("Produtos")).toBe(cents(30));
    expect(byCategory("Assinatura Nova")).toBe(cents(100));
    expect(byMethod("Pix")).toBe(cents(100));
    expect(byMethod("Dinheiro")).toBe(cents(30));
    // Total geral bate.
    expect(rows.reduce((s, r) => s + cents(r.amount), 0)).toBe(cents(130));
  });

  test("valores quebrados não acumulam erro de centavo", () => {
    const items: ComandaItem[] = [
      { category: "Serviços", amount: 33.33 },
      { category: "Bebida", amount: 6.67 },
    ];
    const payments: ComandaPayment[] = [
      { method: "Débito", amount: 20 },
      { method: "Dinheiro", amount: 20 },
    ];
    const rows = allocateComandaRows(items, payments);
    expect(rows.reduce((s, r) => s + cents(r.amount), 0)).toBe(cents(40));
    expect(
      rows.filter((r) => r.category === "Serviços").reduce((s, r) => s + cents(r.amount), 0),
    ).toBe(cents(33.33));
    expect(rows.every((r) => r.amount > 0)).toBe(true);
  });
});
