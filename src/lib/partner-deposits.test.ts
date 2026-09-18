import { describe, expect, test } from "bun:test";
import { canDepositAmount, depositAuthorLabel } from "./partner-deposits";

describe("canDepositAmount", () => {
  test("permite depósito total", () => {
    expect(canDepositAmount(3500, 3500)).toBe(true);
  });

  test("permite depósito parcial", () => {
    expect(canDepositAmount(3000, 4200)).toBe(true);
  });

  test("recusa acima do que está em posse", () => {
    expect(canDepositAmount(4300, 4200)).toBe(false);
  });

  test("tolera arredondamento de centavo", () => {
    expect(canDepositAmount(4200.004, 4200)).toBe(true);
    expect(canDepositAmount(4200.01, 4200)).toBe(false);
  });

  test("recusa valor não positivo ou saldo zerado", () => {
    expect(canDepositAmount(0, 4200)).toBe(false);
    expect(canDepositAmount(-10, 4200)).toBe(false);
    expect(canDepositAmount(100, 0)).toBe(false);
  });
});

describe("depositAuthorLabel", () => {
  test("distingue o próprio sócio do administrador", () => {
    expect(depositAuthorLabel("p1", "p1")).toBe("pelo próprio sócio");
    expect(depositAuthorLabel("admin1", "p1")).toBe("por um administrador");
  });
});
