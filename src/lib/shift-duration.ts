/** A partir de quanto tempo aberto um turno é sinalizado no relatório. */
export const LONG_SHIFT_MS = 24 * 60 * 60 * 1000;

/**
 * Quanto tempo o turno ficou (ou está) aberto: da abertura até o fechamento,
 * ou até agora se ainda não fechou.
 */
export function shiftDurationMs(
  openedAt: string,
  closedAt: string | null,
  now: Date = new Date(),
): number {
  const end = closedAt ? new Date(closedAt).getTime() : now.getTime();
  return Math.max(0, end - new Date(openedAt).getTime());
}

export function isLongShift(durationMs: number): boolean {
  return durationMs > LONG_SHIFT_MS;
}

/** "2 dias e 3 h", "1 dia", "5 h e 20 min", "40 min". */
export function formatShiftDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    const d = `${days} ${days === 1 ? "dia" : "dias"}`;
    return hours > 0 ? `${d} e ${hours} h` : d;
  }
  if (hours > 0) return minutes > 0 ? `${hours} h e ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}
