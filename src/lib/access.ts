import { supabase } from "@/integrations/supabase/client";
import { ROLE_ROUTES, type AppRole } from "@/lib/roles";

export type AccessState =
  | { kind: "anonymous" }
  | { kind: "pending"; requestedRole: AppRole | null }
  | { kind: "rejected"; requestedRole: AppRole | null }
  | { kind: "approved"; role: AppRole; route: string }
  | { kind: "misconfigured"; message: string };

const APP_ROLES = new Set<AppRole>(["atendente", "supervisor", "socio", "auditor"]);

type AccessProfile = { status: string; requested_role: string | null } | null;

const ACCESS_TIMEOUT_MS = 12_000;

async function withAccessTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Tempo esgotado ao verificar seu acesso. Tente novamente.")),
          ACCESS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function classifyAuthenticatedAccess(
  profile: AccessProfile,
  rawRoles: string[],
): Exclude<AccessState, { kind: "anonymous" }> {
  if (!profile) {
    return {
      kind: "misconfigured",
      message: "Seu perfil não foi criado. Peça ao administrador para revisar sua conta.",
    };
  }

  const requestedRole = APP_ROLES.has(profile.requested_role as AppRole)
    ? (profile.requested_role as AppRole)
    : null;
  if (profile.status === "pending") return { kind: "pending", requestedRole };
  if (profile.status === "rejected") return { kind: "rejected", requestedRole };
  if (profile.status !== "approved") {
    return { kind: "misconfigured", message: "Seu cadastro possui um status inválido." };
  }

  const validRoles = rawRoles.filter((role): role is AppRole => APP_ROLES.has(role as AppRole));
  if (validRoles.length !== 1) {
    return {
      kind: "misconfigured",
      message:
        validRoles.length === 0
          ? "Seu cadastro foi aprovado, mas ainda não possui um papel de acesso."
          : "Seu cadastro possui mais de um papel de acesso.",
    };
  }

  const role = validRoles[0]!;
  return { kind: "approved", role, route: ROLE_ROUTES[role] };
}

/** Single source of truth for post-authentication access and routing. */
export async function resolveAccessState(): Promise<AccessState> {
  const { data: userData, error: userError } = await withAccessTimeout(supabase.auth.getUser());
  if (userError) throw userError;
  if (!userData.user) return { kind: "anonymous" };

  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
    await withAccessTimeout(
      Promise.all([
        supabase
          .from("profiles")
          .select("status, requested_role")
          .eq("id", userData.user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userData.user.id),
      ]),
    );

  if (profileError) throw profileError;
  if (rolesError) throw rolesError;
  return classifyAuthenticatedAccess(
    profile,
    (roles ?? []).map((row) => row.role),
  );
}

export function destinationForAccess(state: AccessState): string {
  if (state.kind === "anonymous") return "/auth";
  if (state.kind === "approved") return state.route;
  return "/pendente";
}
