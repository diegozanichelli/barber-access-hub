import { describe, expect, test } from "bun:test";
import { summarizeSalesByUnit } from "./sales-report";

describe("summarizeSalesByUnit", () => {
  test("soma quantidade e valor por categoria e unidade", () => {
    const report = summarizeSalesByUnit([
      { unit_id: "parque-10", category: "Bebida", amount: 8 },
      { unit_id: "parque-10", category: "Bebida", amount: 12 },
      { unit_id: "parque-10", category: "Produtos", amount: 30 },
      { unit_id: "parque-10", category: "Renovação", amount: 100 },
      { unit_id: "parque-10", category: "Upgrade", amount: 50 },
      { unit_id: "adrianopolis", category: "Assinatura Nova", amount: 150 },
    ]);

    expect(report["parque-10"]?.categories.Bebida).toEqual({ count: 2, amount: 20 });
    expect(report["parque-10"]?.categories.Upgrade).toEqual({ count: 1, amount: 50 });
    expect(report["parque-10"]?.categories.Produtos).toEqual({ count: 1, amount: 30 });
    expect(report["parque-10"]?.total).toEqual({ count: 5, amount: 200 });
    expect(report["adrianopolis"]?.categories["Assinatura Nova"]).toEqual({
      count: 1,
      amount: 150,
    });
  });
});
