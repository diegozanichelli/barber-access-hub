import { describe, expect, test } from "bun:test";
import {
  displayedIncomeCategory,
  incomePhotoRequired,
  isMissingIncomeCategoryEnum,
  isRoundAmount,
  parseAmount,
} from "./transactions";

describe("transaction rules", () => {
  test("preserves Upgrade while the database enum is being rolled out", () => {
    expect(displayedIncomeCategory("Renovação", "__upgrade__")).toBe("Upgrade");
    expect(
      isMissingIncomeCategoryEnum(
        { message: 'invalid input value for enum transaction_category: "Upgrade"' },
        "Upgrade",
      ),
    ).toBe(true);
    expect(displayedIncomeCategory("Bebida", "__products__")).toBe("Produtos");
    expect(
      isMissingIncomeCategoryEnum(
        { message: 'invalid input value for enum transaction_category: "Produtos"' },
        "Produtos",
      ),
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
