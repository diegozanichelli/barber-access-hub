import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculateTotal, formatBRL, type CashQuantities } from "@/lib/cash";

const quantity = z.number().int().min(0).max(1_000_000);
const quantitiesSchema = z.object({
  notes_200: quantity,
  notes_100: quantity,
  notes_50: quantity,
  notes_20: quantity,
  notes_10: quantity,
  notes_5: quantity,
  notes_2: quantity,
  coins_1: quantity,
  coins_050: quantity,
  coins_025: quantity,
  coins_010: quantity,
  coins_005: quantity,
});

const archiveOpeningSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

const correctOpeningSchema = z.object({
  shiftId: z.string().uuid(),
  quantities: quantitiesSchema,
  reason: z.string().trim().min(5).max(500),
});

async function assertMaster(context: {
  userId: string;
  supabase: {
    rpc: (
      name: "has_role",
      args: { _user_id: string; _role: "auditor" },
    ) => PromiseLike<{ data: boolean | null; error: Error | null }>;
  };
}) {
  const { data: isMaster, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "auditor",
  });
  if (error) throw error;
  if (!isMaster) throw new Error("Somente o login master pode alterar uma abertura.");
}

/** Compatibility path for correcting an opening before the RPC is published. */
export const correctOpeningOnServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => correctOpeningSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: shift, error: shiftError } = await supabaseAdmin
      .from("shifts")
      .select("id, status, actual_opening_total, unit_id, opened_at")
      .eq("id", data.shiftId)
      .maybeSingle();
    if (shiftError) throw shiftError;
    if (!shift || shift.status !== "open") throw new Error("Abertura ativa não encontrada.");

    const { data: count, error: countError } = await supabaseAdmin
      .from("cash_counts")
      .select("*")
      .eq("shift_id", data.shiftId)
      .eq("count_type", "opening")
      .maybeSingle();
    if (countError) throw countError;
    if (!count) throw new Error("Contagem de abertura não encontrada.");

    const total = calculateTotal(data.quantities as CashQuantities);
    const previousQuantities = {
      notes_200: count.notes_200,
      notes_100: count.notes_100,
      notes_50: count.notes_50,
      notes_20: count.notes_20,
      notes_10: count.notes_10,
      notes_5: count.notes_5,
      notes_2: count.notes_2,
      coins_1: count.coins_1,
      coins_050: count.coins_050,
      coins_025: count.coins_025,
      coins_010: count.coins_010,
      coins_005: count.coins_005,
    };
    const auditNote = [
      count.notes?.trim(),
      `Correção pelo master (${context.userId}): ${data.reason}`,
      `Valor anterior: ${count.total_calculated}; quantidades anteriores: ${JSON.stringify(previousQuantities)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const { error: updateCountError } = await supabaseAdmin
      .from("cash_counts")
      .update({ ...data.quantities, total_calculated: total, notes: auditNote })
      .eq("id", count.id);
    if (updateCountError) throw updateCountError;

    const { data: updatedShift, error: updateShiftError } = await supabaseAdmin
      .from("shifts")
      .update({ actual_opening_total: total })
      .eq("id", data.shiftId)
      .eq("status", "open")
      .eq("actual_opening_total", shift.actual_opening_total)
      .select("id")
      .maybeSingle();
    if (updateShiftError || !updatedShift) {
      await supabaseAdmin
        .from("cash_counts")
        .update({
          ...previousQuantities,
          total_calculated: count.total_calculated,
          notes: count.notes,
        })
        .eq("id", count.id);
      if (updateShiftError) throw updateShiftError;
      throw new Error("A abertura mudou durante a correção. Atualize e tente novamente.");
    }

    // Mesma regra da RPC correct_opening_cash_count (migration 20260821140000):
    // encerra a divergência que originou esta abertura, que é a do turno da
    // mesma unidade fechado imediatamente antes dela. As contagens registradas
    // não são tocadas — são o histórico do que foi contado.
    const { data: disputed, error: disputedError } = await supabaseAdmin
      .from("shifts")
      .select("id")
      .eq("unit_id", shift.unit_id)
      .eq("status", "disputed")
      .lte("closed_at", shift.opened_at)
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (disputedError) throw disputedError;

    let resolvedDispute = false;
    if (disputed) {
      const { error: resolveError } = await supabaseAdmin
        .from("shifts")
        .update({
          status: "closed",
          resolved_by: context.userId,
          resolved_at: new Date().toISOString(),
          resolution_note: `Abertura corrigida de ${formatBRL(count.total_calculated)} para ${formatBRL(total)} pelo master. Motivo: ${data.reason}`,
        })
        .eq("id", disputed.id)
        .eq("status", "disputed");
      if (resolveError) throw resolveError;
      resolvedDispute = true;
    }

    return { total, resolvedDispute, mode: "compatibility" as const };
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
    await assertMaster(context);

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
