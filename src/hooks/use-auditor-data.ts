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

export type AuditorData = {
  units: UnitRow[];
  shifts: ShiftRow[];
  transactions: TransactionRow[];
  withdrawals: WithdrawalRow[];
  cashCounts: CashCountRow[];
  names: Record<string, string>;
  unitNames: Record<string, string>;
};

export function useAuditorData() {
  return useQuery<AuditorData>({
    queryKey: ["auditor-data"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [unitsRes, shiftsRes, txRes, wdRes, ccRes, profRes] = await Promise.all([
        supabase.from("units").select("id, name").order("name"),
        supabase.from("shifts").select("*").order("opened_at", { ascending: false }),
        supabase.from("transactions").select("*").order("created_at", { ascending: false }),
        supabase.from("partner_withdrawals").select("*").order("created_at", { ascending: false }),
        supabase.from("cash_counts").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name"),
      ]);

      const firstError =
        unitsRes.error || shiftsRes.error || txRes.error || wdRes.error || ccRes.error;
      if (firstError) throw firstError;

      const names: Record<string, string> = {};
      for (const p of profRes.data ?? []) {
        names[p.id] = (p.full_name || "").trim() || "Usuário";
      }
      const unitNames: Record<string, string> = {};
      for (const u of unitsRes.data ?? []) unitNames[u.id] = u.name;

      return {
        units: (unitsRes.data ?? []) as UnitRow[],
        shifts: (shiftsRes.data ?? []) as ShiftRow[],
        transactions: (txRes.data ?? []) as TransactionRow[],
        withdrawals: (wdRes.data ?? []) as WithdrawalRow[],
        cashCounts: (ccRes.data ?? []) as CashCountRow[],
        names,
        unitNames,
      };
    },
  });
}
