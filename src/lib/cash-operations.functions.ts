import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculateTotal, type CashQuantities } from "@/lib/cash";

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

const openShiftSchema = z.object({
  unitId: z.string().uuid(),
  quantities: quantitiesSchema,
  notes: z.string().trim().max(500),
});

/** Compatibility path used only while the authoritative open_shift RPC is absent. */
export const openShiftOnServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => openShiftSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("status, unit_id")
          .eq("id", context.userId)
          .maybeSingle(),
        supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      ]);
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;
    if (profile?.status !== "approved") throw new Error("Cadastro não aprovado.");

    const roleSet = new Set((roles ?? []).map((row) => row.role));
    const isAuditor = roleSet.has("auditor");
    if (!isAuditor && !roleSet.has("atendente") && !roleSet.has("supervisor")) {
      throw new Error("Você não tem permissão para abrir o caixa.");
    }
    if (!isAuditor && profile.unit_id !== data.unitId) {
      throw new Error("Você não tem permissão nesta unidade.");
    }

    const { data: active, error: activeError } = await supabaseAdmin
      .from("shifts")
      .select("id, status")
      .eq("unit_id", data.unitId)
      .in("status", ["open", "pending_handover"])
      .limit(1);
    if (activeError) throw activeError;
    if (active?.some((shift) => shift.status === "open")) {
      throw new Error("Já existe um caixa aberto nesta unidade.");
    }
    if (active?.some((shift) => shift.status === "pending_handover")) {
      throw new Error("Há um turno aguardando repasse. Receba o turno pendente.");
    }

    const { data: previous, error: previousError } = await supabaseAdmin
      .from("shifts")
      .select("closing_total")
      .eq("unit_id", data.unitId)
      .eq("status", "closed")
      .not("closing_total", "is", null)
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw previousError;

    const total = calculateTotal(data.quantities as CashQuantities);
    const { data: shift, error: shiftError } = await supabaseAdmin
      .from("shifts")
      .insert({
        unit_id: data.unitId,
        opened_by: context.userId,
        expected_opening_total: Number(previous?.closing_total ?? 0),
        actual_opening_total: total,
        status: "open",
      })
      .select("id")
      .single();
    if (shiftError) {
      if (shiftError.code === "23505") throw new Error("Outro usuário já abriu o caixa.");
      throw shiftError;
    }

    const { error: countError } = await supabaseAdmin.from("cash_counts").insert({
      shift_id: shift.id,
      count_type: "opening",
      counted_by: context.userId,
      ...data.quantities,
      total_calculated: total,
      notes: data.notes || null,
    });
    if (countError) {
      await supabaseAdmin.from("shifts").delete().eq("id", shift.id);
      throw countError;
    }

    return { shiftId: shift.id, total, mode: "compatibility" as const };
  });
