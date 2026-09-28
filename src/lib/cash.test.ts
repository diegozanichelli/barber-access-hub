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
});
