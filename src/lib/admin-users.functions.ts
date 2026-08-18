import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const roleSchema = z.enum(["atendente", "supervisor", "socio", "auditor"]);

export type ManagedUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: string | null;
  unitId: string | null;
  createdAt: string;
};

export type PendingUser = {
  id: string;
  email: string | null;
  fullName: string;
  requestedRole: string | null;
  unitId: string | null;
  createdAt: string;
};

async function assertAuditor(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: isAuditor } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "auditor",
  });
  if (!isAuditor) throw new Error("Acesso restrito ao auditor.");
}

export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    await assertAuditor(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, unit_id, status"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);

    return authUsers.users
      .filter((u) => (profiles?.find((p) => p.id === u.id)?.status ?? "approved") === "approved")
      .map((u) => {
        const profile = profiles?.find((p) => p.id === u.id);
        const role = roles?.find((r) => r.user_id === u.id);
        return {
          id: u.id,
          email: u.email ?? null,
          fullName: profile?.full_name?.trim() || u.email?.split("@")[0] || "Usuário",
          role: role?.role ?? null,
          unitId: profile?.unit_id ?? null,
          createdAt: u.created_at,
        };
      });
  });

export const listPendingUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingUser[]> => {
    await assertAuditor(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, unit_id, requested_role, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });

    return (profiles ?? []).map((p) => {
      const u = authUsers?.users.find((x) => x.id === p.id);
      return {
        id: p.id,
        email: u?.email ?? null,
        fullName: p.full_name?.trim() || u?.email?.split("@")[0] || "Usuário",
        requestedRole: p.requested_role ?? null,
        unitId: p.unit_id ?? null,
        createdAt: p.created_at,
      };
    });
  });

export const approveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: roleSchema,
        unitId: z.string().uuid().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAuditor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .neq("role", data.role);
    if (delError) throw delError;

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id" });
    if (roleError) throw roleError;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        status: "approved",
        unit_id: data.role === "auditor" ? null : data.unitId,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.userId);
    if (profileError) throw profileError;

    return { ok: true };
  });

export const rejectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAuditor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        status: "rejected",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.userId);
    if (error) throw error;

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    return { ok: true };
  });

export const updateManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: roleSchema,
        unitId: z.string().uuid().nullable(),
        fullName: z.string().trim().min(2, "Informe o nome completo.").max(120),
        email: z.string().trim().email("E-mail inválido.").max(255),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAuditor(context);

    if (data.userId === context.userId && data.role !== "auditor") {
      throw new Error("Você não pode remover seu próprio acesso de Auditor.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .neq("role", data.role);
    if (delError) throw delError;

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id" });
    if (roleError) throw roleError;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ unit_id: data.unitId, full_name: data.fullName })
      .eq("id", data.userId);
    if (profileError) throw profileError;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: data.email,
      email_confirm: true,
    });
    if (authError) throw authError;

    return { ok: true };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        password: z.string().min(6, "A senha deve ter ao menos 6 caracteres.").max(72),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAuditor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw error;
    return { ok: true };
  });
