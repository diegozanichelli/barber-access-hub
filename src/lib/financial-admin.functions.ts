import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const deleteOpeningSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

/**
 * Server-side fallback for deployments whose PostgREST schema cache has not
 * published delete_empty_open_shift yet. Authorization is checked with the
 * caller client, while the actual delete uses the service-role client.
 */
export const deleteEmptyOpening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => deleteOpeningSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isMaster, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (roleError) throw roleError;
    if (!isMaster) throw new Error("Somente o login master pode excluir uma abertura.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: shift, error: shiftError } = await supabaseAdmin
      .from("shifts")
      .select("id, status")
      .eq("id", data.shiftId)
      .maybeSingle();
    if (shiftError) throw shiftError;
    if (!shift || shift.status !== "open") throw new Error("Abertura ativa não encontrada.");

    const [{ count: transactions, error: txError }, { count: withdrawals, error: wdError }] =
      await Promise.all([
        supabaseAdmin
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("shift_id", data.shiftId),
        supabaseAdmin
          .from("partner_withdrawals")
          .select("id", { count: "exact", head: true })
          .eq("shift_id", data.shiftId),
      ]);
    if (txError) throw txError;
    if (wdError) throw wdError;
    if ((transactions ?? 0) > 0 || (withdrawals ?? 0) > 0) {
      throw new Error(
        "Este turno possui movimentações. Corrija os lançamentos antes de excluir a abertura.",
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("shifts")
      .delete()
      .eq("id", data.shiftId);
    if (deleteError) throw deleteError;

    return { ok: true, reason: data.reason };
  });
