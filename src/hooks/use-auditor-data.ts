import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type UnitRow = { id: string; name: string };
export type ShiftRow = {
  id: string;
  unit_id: string;
  opened_by: string;
  closed_by: string | null;
  expected_opening_total: number;
  actual_opening_total: number;
  closing_total: number | null;
  expected_closing_total: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
};
export type TransactionRow = {
  id: string;
  shift_id: string;
  unit_id: string;
  user_id: string;
  transaction_type: string;
  category: string;
  client_name: string | null;
  payment_method: string | null;
  amount: number;
  description: string | null;
  photo_url: string | null;
  created_at: string;
  reversed_at: string | null;
  reverses_transaction_id: string | null;
};
export type WithdrawalRow = {
  id: string;
  shift_id: string;
  unit_id: string;
  partner_id: string;
  amount: number;
  status: string;
  created_at: string;
};
export type CashCountRow = {
  id: string;
  shift_id: string;
  count_type: string;
  counted_by: string;
  total_calculated: number;
  created_at: string;
  notes: string | null;
  notes_200: number;
  notes_100: number;
  notes_50: number;
  notes_20: number;
  notes_10: number;
  notes_5: number;
  notes_2: number;
  coins_1: number;
  coins_050: number;
  coins_025: number;
  coins_010: number;
  coins_005: number;
};

export type AuditorReferences = {
  units: UnitRow[];
  names: Record<string, string>;
  unitNames: Record<string, string>;
};

export function useAuditorReferences() {
  return useQuery<AuditorReferences>({
    queryKey: ["auditor-references"],
    staleTime: 60_000,
    queryFn: async () => {
      const [unitsRes, profilesRes] = await Promise.all([
        supabase.from("units").select("id, name").order("name"),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (unitsRes.error) throw unitsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      const units = (unitsRes.data ?? []) as UnitRow[];
      return {
        units,
        names: Object.fromEntries(
          (profilesRes.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Usuário"]),
        ),
        unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
      };
    },
  });
}

export type AuditorData = AuditorReferences & {
  shifts: ShiftRow[];
  transactions: TransactionRow[];
  withdrawals: WithdrawalRow[];
  cashCounts: CashCountRow[];
  safeBalances: Record<string, number>;
};

/** Overview fetches only active/disputed records; historical lists are paginated separately. */
export function useAuditorData() {
  return useQuery<AuditorData>({
    queryKey: ["auditor-data"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [unitsRes, shiftsRes, withdrawalsRes, profilesRes] = await Promise.all([
        supabase.from("units").select("id, name").order("name"),
        supabase
          .from("shifts")
          .select("*")
          .in("status", ["open", "pending_handover", "disputed"])
          .order("opened_at", { ascending: false }),
        supabase
          .from("partner_withdrawals")
          .select("*")
          .eq("status", "disputed")
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name"),
      ]);
      const firstError =
        unitsRes.error || shiftsRes.error || withdrawalsRes.error || profilesRes.error;
      if (firstError) throw firstError;

      const units = (unitsRes.data ?? []) as UnitRow[];
      const shifts = (shiftsRes.data ?? []) as ShiftRow[];
      const activeIds = shifts
        .filter((shift) => shift.status === "open" || shift.status === "pending_handover")
        .map((shift) => shift.id);
      const disputedIds = shifts
        .filter((shift) => shift.status === "disputed")
        .map((shift) => shift.id);
      const transactionsRes = activeIds.length
        ? await supabase.from("transactions").select("*").in("shift_id", activeIds)
        : { data: [], error: null };
      if (transactionsRes.error) throw transactionsRes.error;
      const cashCountsRes = disputedIds.length
        ? await supabase
            .from("cash_counts")
            .select("*")
            .in("shift_id", disputedIds)
            .order("created_at", { ascending: true })
        : { data: [], error: null };
      if (cashCountsRes.error) throw cashCountsRes.error;

      const balances = await Promise.all(
        units.map(async (unit) => {
          const { data, error } = await supabase.rpc("unit_safe_balance", { _unit_id: unit.id });
          if (error) throw error;
          return [unit.id, Number(data ?? 0)] as const;
        }),
      );

      return {
        units,
        shifts,
        transactions: (transactionsRes.data ?? []) as TransactionRow[],
        withdrawals: (withdrawalsRes.data ?? []) as WithdrawalRow[],
        cashCounts: (cashCountsRes.data ?? []) as CashCountRow[],
        safeBalances: Object.fromEntries(balances),
        names: Object.fromEntries(
          (profilesRes.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Usuário"]),
        ),
        unitNames: Object.fromEntries(units.map((unit) => [unit.id, unit.name])),
      };
    },
  });
}
