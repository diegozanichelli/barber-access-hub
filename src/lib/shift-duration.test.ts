import { describe, expect, test } from "bun:test";
import { formatShiftDuration, isLongShift, shiftDurationMs } from "./shift-duration";

const HOUR = 60 * 60 * 1000;

describe("shiftDurationMs", () => {
  test("turno fechado: da abertura ao fechamento", () => {
    expect(shiftDurationMs("2026-10-15T12:00:00Z", "2026-10-15T21:30:00Z")).toBe(9.5 * HOUR);
  });

  test("turno aberto: da abertura até agora", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(shiftDurationMs("2026-10-15T12:00:00Z", null, now)).toBe(48 * HOUR);
  });
});

describe("isLongShift", () => {
  test("só sinaliza acima de 24 h", () => {
    expect(isLongShift(24 * HOUR)).toBe(false);
    expect(isLongShift(24 * HOUR + 60_000)).toBe(true);
  });
});

describe("formatShiftDuration", () => {
  test("formata dias, horas e minutos", () => {
    expect(formatShiftDuration(40 * 60_000)).toBe("40 min");
    expect(formatShiftDuration(5 * HOUR)).toBe("5 h");
    expect(formatShiftDuration(5 * HOUR + 20 * 60_000)).toBe("5 h e 20 min");
    expect(formatShiftDuration(24 * HOUR)).toBe("1 dia");
    expect(formatShiftDuration(51 * HOUR)).toBe("2 dias e 3 h");
  });
});
