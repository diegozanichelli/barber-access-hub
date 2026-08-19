import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type ChangeRequestRecord = {
  id: string;
  action: "edit" | "delete";
  reason: string;
  proposed_amount: number | null;
  proposed_description: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  transaction_snapshot: Json;
};

export type ChangeRequestsResult = {
  requests: ChangeRequestRecord[];
  available: boolean;
};

/** Reads requests without depending on the list RPC being present in PostgREST's cache. */
export const listChangeRequestsOnServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChangeRequestsResult> => {
    const { data: isMaster, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (roleError) throw roleError;
    if (!isMaster) throw new Error("Acesso restrito ao login master.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("transaction_change_requests")
      .select(
        "id, action, reason, proposed_amount, proposed_description, status, created_at, transaction_snapshot",
      )
      .order("created_at", { ascending: false });

    if (error?.code === "PGRST205" || error?.code === "42P01") {
      return { requests: [], available: false };
    }
    if (error) throw error;
    return { requests: (data ?? []) as ChangeRequestRecord[], available: true };
  });
