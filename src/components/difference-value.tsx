import { formatBRL } from "@/lib/cash";
import { differenceReason } from "@/lib/divergences";

type DifferenceValueProps = {
  value: number | null;
  isBad: boolean;
};

/** Displays a signed cash difference and its human-readable reason. */
export function DifferenceValue({ value, isBad }: DifferenceValueProps) {
  if (value === null) return <span>—</span>;

  return (
    <span>
      {value > 0 ? "+" : ""}
      {formatBRL(value)}
      {isBad ? <span className="block text-xs">{differenceReason(value)}</span> : null}
    </span>
  );
}
