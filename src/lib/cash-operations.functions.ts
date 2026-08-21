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

const closeShiftSchema = z.object({
  shiftId: z.string().uuid(),
  quantities: quantitiesSchema,
  notes: z.string().trim().max(500),
});

const receiveHandoverSchema = z.object({
  pendingShiftId: z.string().uuid(),
  quantities: quantitiesSchema,
  notes: z.string().trim().max(500),
});

const divergenceCheckSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("opening"),
    unitId: z.string().uuid(),
    quantities: quantitiesSchema,
  }),
  z.object({
    mode: z.literal("closing"),
    shiftId: z.string().uuid(),
    quantities: quantitiesSchema,
  }),
  z.object({
    mode: z.literal("handover"),
    pendingShiftId: z.string().uuid(),
    quantities: quantitiesSchema,
  }),
]);

/**
 * Contagem cega: devolve apenas se o valor contado bate com o esperado.
 * Nunca expõe o valor esperado nem a diferença ao operador.
 */
export const checkCountDivergence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => divergenceCheckSchema.parse(data))
  .handler(async ({ context, data }) => {
    const total = calculateTotal(data.quantities as CashQuantities);
    let expected: number | null = null;

    if (data.mode === "closing") {
      const { data: value, error } = await context.supabase.rpc("shift_expected_cash", {
        _shift_id: data.shiftId,
      });
      if (error) return { matches: true, hasExpectation: false };
      expected = Number(value ?? 0);
    } else if (data.mode === "handover") {
      const { data: pending, error } = await context.supabase
        .from("shifts")
        .select("closing_total")
        .eq("id", data.pendingShiftId)
        .maybeSingle();
      if (error) throw error;
      expected = pending?.closing_total === null ? null : Number(pending?.closing_total ?? 0);
    } else {
      const { data: previous, error } = await context.supabase
        .from("shifts")
        .select("closing_total")
        .eq("unit_id", data.unitId)
        .eq("status", "closed")
        .not("closing_total", "is", null)
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      expected = previous ? Number(previous.closing_total) : null;
    }

    if (expected === null) return { matches: true, hasExpectation: false };
    return { matches: Math.abs(total - expected) < 0.005, hasExpectation: true };
  });

type RpcResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message: string } | null;
}>;

function isMissingRpc(error: { code?: string; message: string } | null) {
  return error?.code === "PGRST202" || Boolean(error?.message.includes("schema cache"));
}

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

/**
 * Closes through the authoritative RPC when available. While a connected
 * Lovable database still exposes the legacy signature, values are recomputed
 * on the authenticated server before calling that compatibility overload.
 */
export const closeShiftOnServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => closeShiftSchema.parse(data))
  .handler(async ({ context, data }) => {
    const current = await context.supabase.rpc("close_shift", {
      _shift_id: data.shiftId,
      _quantities: data.quantities,
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (!current.error) {
      const result = (current.data ?? {}) as {
        total?: number;
        expected?: number;
        difference?: number;
      };
      return {
        total: Number(result.total ?? calculateTotal(data.quantities as CashQuantities)),
        expected: Number(result.expected ?? 0),
        difference: Number(result.difference ?? 0),
        mode: "current" as const,
      };
    }
    if (!isMissingRpc(current.error)) throw current.error;

    const [{ data: shift, error: shiftError }, { data: transactions, error: txError }] =
      await Promise.all([
        context.supabase
          .from("shifts")
          .select("id, status, actual_opening_total")
          .eq("id", data.shiftId)
          .maybeSingle(),
        context.supabase
          .from("transactions")
          .select("transaction_type, payment_method, amount, reverses_transaction_id, reversed_at")
          .eq("shift_id", data.shiftId),
      ]);
    if (shiftError) throw shiftError;
    if (txError) throw txError;
    if (!shift || shift.status !== "open")
      throw new Error("Este turno já foi fechado. Atualize a tela.");

    const total = calculateTotal(data.quantities as CashQuantities);
    const expected =
      Math.round(
        ((transactions ?? []).reduce((running, transaction) => {
          if (transaction.reverses_transaction_id || transaction.reversed_at) return running;
          const amount = Number(transaction.amount);
          if (
            transaction.transaction_type === "income" &&
            transaction.payment_method === "Dinheiro"
          ) {
            return running + amount;
          }
          return transaction.transaction_type === "income" ? running : running - amount;
        }, Number(shift.actual_opening_total)) +
          Number.EPSILON) *
          100,
      ) / 100;

    const legacyClient = context.supabase as unknown as {
      rpc: (name: "close_shift", args: Record<string, unknown>) => RpcResult;
    };
    const legacy = await legacyClient.rpc("close_shift", {
      _shift_id: data.shiftId,
      _quantities: data.quantities,
      _total: total,
      _expected_closing: expected,
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (legacy.error) throw legacy.error;

    return {
      total,
      expected,
      difference: Math.round((total - expected + Number.EPSILON) * 100) / 100,
      mode: "legacy" as const,
    };
  });

/** Compatibility dispatcher for current and legacy receive_handover RPCs. */
export const receiveHandoverOnServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => receiveHandoverSchema.parse(data))
  .handler(async ({ context, data }) => {
    const current = await context.supabase.rpc("receive_handover", {
      _pending_shift_id: data.pendingShiftId,
      _quantities: data.quantities,
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (!current.error) {
      const result = (current.data ?? {}) as {
        shift_id?: string;
        matches?: boolean;
        expected?: number;
        total?: number;
      };
      return {
        shiftId: result.shift_id,
        total: Number(result.total ?? calculateTotal(data.quantities as CashQuantities)),
        expected: Number(result.expected ?? 0),
        matches: Boolean(result.matches),
        mode: "current" as const,
      };
    }
    if (!isMissingRpc(current.error)) throw current.error;

    const { data: pending, error: pendingError } = await context.supabase
      .from("shifts")
      .select("id, status, closing_total")
      .eq("id", data.pendingShiftId)
      .maybeSingle();
    if (pendingError) throw pendingError;
    if (!pending || pending.status !== "pending_handover") {
      throw new Error("Este repasse já foi recebido. Atualize a tela.");
    }

    const total = calculateTotal(data.quantities as CashQuantities);
    const expected = Number(pending.closing_total ?? 0);
    const legacyClient = context.supabase as unknown as {
      rpc: (name: "receive_handover", args: Record<string, unknown>) => RpcResult;
    };
    const legacy = await legacyClient.rpc("receive_handover", {
      _pending_shift_id: data.pendingShiftId,
      _quantities: data.quantities,
      _total: total,
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (legacy.error) throw legacy.error;
    const result = (legacy.data ?? {}) as {
      shift_id?: string;
      matches?: boolean;
      expected?: number;
    };

    return {
      shiftId: result.shift_id,
      total,
      expected: Number(result.expected ?? expected),
      matches: result.matches ?? Math.abs(expected - total) < 0.005,
      mode: "legacy" as const,
    };
  });
