import { describe, expect, test } from "bun:test";
import { calculateTotal, countMatchesExpected, EMPTY_QUANTITIES } from "./cash";

describe("calculateTotal", () => {
  test("sums Brazilian notes and coins without floating-point residue", () => {
    expect(
      calculateTotal({
        ...EMPTY_QUANTITIES,
        notes_100: 2,
        notes_20: 1,
        coins_050: 3,
        coins_005: 1,
      }),
    ).toBe(221.55);
  });

  test("treats missing or invalid quantities as zero", () => {
    expect(calculateTotal({ ...EMPTY_QUANTITIES, notes_50: Number.NaN })).toBe(0);
  });
});

describe("countMatchesExpected", () => {
  test("returns only whether the blind count matches", () => {
    const quantities = { ...EMPTY_QUANTITIES, notes_100: 2, notes_10: 1, coins_1: 5 };
    expect(countMatchesExpected(quantities, 215)).toBe(true);
    expect(countMatchesExpected(quantities, 235)).toBe(false);
  });

  test("tolera diferença de até 5 centavos (arredondamento de moeda)", () => {
    // Contado 215,00 (múltiplo de 0,05) contra esperados em centavos quebrados.
    const quantities = { ...EMPTY_QUANTITIES, notes_100: 2, notes_10: 1, coins_1: 5 };
    expect(countMatchesExpected(quantities, 214.99)).toBe(true); // 1 centavo
    expect(countMatchesExpected(quantities, 215.05)).toBe(true); // 5 centavos (limite)
    expect(countMatchesExpected(quantities, 214.95)).toBe(true); // 5 centavos (limite)
    expect(countMatchesExpected(quantities, 215.06)).toBe(false); // 6 centavos, não passa
    expect(countMatchesExpected(quantities, 214.94)).toBe(false); // 6 centavos, não passa
  });
});
