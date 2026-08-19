import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const archiveOpeningSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

/**
 * Compatibility path for projects where the new deletion RPC has not been
 * deployed yet. It never deletes rows: the empty opening is closed at zero and
 * its original shift/count remain available in the audit history.
 */
export const archiveEmptyOpening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => archiveOpeningSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isMaster, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (roleError) throw roleError;
    if (!isMaster) throw new Error("Somente o login master pode remover uma abertura.");

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
        "Este turno possui movimentações. Corrija os lançamentos antes de remover a abertura.",
      );
    }

    const { data: openingCount, error: countError } = await supabaseAdmin
      .from("cash_counts")
      .select("id, notes")
      .eq("shift_id", data.shiftId)
      .eq("count_type", "opening")
      .maybeSingle();
    if (countError) throw countError;
    if (openingCount) {
      const auditNote = [
        openingCount.notes?.trim(),
        `Abertura removida pelo master (${context.userId}): ${data.reason}`,
      ]
        .filter(Boolean)
        .join("\n");
      const { error } = await supabaseAdmin
        .from("cash_counts")
        .update({ notes: auditNote })
        .eq("id", openingCount.id);
      if (error) throw error;
    }

    const now = new Date().toISOString();
    const { data: archived, error: archiveError } = await supabaseAdmin
      .from("shifts")
      .update({
        status: "closed",
        closed_by: context.userId,
        closed_at: now,
        closing_total: 0,
        expected_closing_total: 0,
      })
      .eq("id", data.shiftId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (archiveError) throw archiveError;
    if (!archived)
      throw new Error("A abertura mudou durante a operação. Atualize e tente novamente.");

    return { mode: "archived" as const };
  });
