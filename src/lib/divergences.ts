export type ShiftDivergence = {
  expectedAtClosing: number | null;
  declaredBySender: number | null;
  countedByReceiver: number | null;
  closingDifference: number | null;
  handoverDifference: number | null;
};

function roundedDifference(actual: number | null, expected: number | null): number | null {
  if (actual === null || expected === null) return null;
  return Math.round((actual - expected) * 100) / 100;
}

export function explainShiftDivergence(input: {
  expectedClosingTotal: number | null;
  closingTotal: number | null;
  handoverTotal: number | null;
}): ShiftDivergence {
  return {
    expectedAtClosing: input.expectedClosingTotal,
    declaredBySender: input.closingTotal,
    countedByReceiver: input.handoverTotal,
    closingDifference: roundedDifference(input.closingTotal, input.expectedClosingTotal),
    handoverDifference: roundedDifference(input.handoverTotal, input.closingTotal),
  };
}

export function differenceReason(difference: number | null): string {
  if (difference === null) return "Não foi possível calcular";
  if (Math.abs(difference) < 0.01) return "Sem diferença";
  return difference > 0 ? "Sobra" : "Falta";
}
