import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["atendente", "supervisor", "socio", "auditor"]);

export type ManagedUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: string | null;
  unitId: string | null;
  createdAt: string;
};

export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    const { data: isAuditor } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (!isAuditor) throw new Error("Acesso restrito ao auditor.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, unit_id"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);

    return authUsers.users.map((u) => {
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

export const updateManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: roleSchema,
        unitId: z.string().uuid().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { data: isAuditor } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (!isAuditor) throw new Error("Acesso restrito ao auditor.");

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
      .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    if (roleError) throw roleError;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ unit_id: data.unitId })
      .eq("id", data.userId);
    if (profileError) throw profileError;

    return { ok: true };
  });
