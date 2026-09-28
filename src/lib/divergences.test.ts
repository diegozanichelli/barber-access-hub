import { describe, expect, test } from "bun:test";
import { differenceReason, explainShiftDivergence } from "./divergences";

describe("shift divergence explanation", () => {
  test("separates closing and handover differences", () => {
    const result = explainShiftDivergence({
      expectedClosingTotal: 220,
      closingTotal: 215,
      handoverTotal: 235,
    });

    expect(result.closingDifference).toBe(-5);
    expect(result.handoverDifference).toBe(20);
    expect(differenceReason(result.closingDifference)).toBe("Falta");
    expect(differenceReason(result.handoverDifference)).toBe("Sobra");
  });
});
