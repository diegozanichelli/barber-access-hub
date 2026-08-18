import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_ROUTES, type AppRole } from "@/lib/roles";

/**
 * Authorizes a role-specific dashboard and redirects an authenticated user to
 * the only dashboard their approved role may access.
 *
 * Database RLS remains the security boundary for data access; this guard keeps
 * users out of unrelated dashboard UIs and provides defense in depth.
 */
export async function requireDashboardRole(expectedRole: AppRole) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw redirect({ to: "/auth" });

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id),
  ]);

  if (profile?.status !== "approved") throw redirect({ to: "/pendente" });

  const role = roles?.[0]?.role as AppRole | undefined;
  if (!role) throw redirect({ to: "/pendente" });
  if (role !== expectedRole) throw redirect({ to: ROLE_ROUTES[role] });
}
