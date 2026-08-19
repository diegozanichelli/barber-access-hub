import { describe, expect, test } from "bun:test";
import { incomePhotoRequired, isRoundAmount, parseAmount } from "./transactions";

describe("transaction rules", () => {
  test("requires proof for subscriptions and Pix", () => {
    expect(incomePhotoRequired("Bebida", "Dinheiro")).toBe(false);
    expect(incomePhotoRequired("Bebida", "Pix")).toBe(true);
    expect(incomePhotoRequired("Renovação", "Dinheiro")).toBe(true);
  });

  test.each([
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
