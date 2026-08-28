import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o histórico" },
] as const;

export type PeriodDays = (typeof PERIOD_OPTIONS)[number]["value"];

/** Data de corte ISO para o período, ou null quando é "todo o histórico". */
export function periodCutoff(days: PeriodDays): string | null {
  if (days === "all") return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));
  return cutoff.toISOString();
}

export function PeriodFilter({
  value,
  onChange,
}: {
  value: PeriodDays;
  onChange: (value: PeriodDays) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PeriodDays)}>
      <SelectTrigger aria-label="Filtrar por período">
        <SelectValue placeholder="Período" />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
