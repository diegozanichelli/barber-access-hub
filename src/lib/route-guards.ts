import { redirect } from "@tanstack/react-router";
import { destinationForAccess, resolveAccessState } from "@/lib/access";
import type { AppRole } from "@/lib/roles";

/** Defense-in-depth UI authorization; PostgreSQL RLS remains authoritative. */
export async function requireDashboardRole(expectedRole: AppRole) {
  const access = await resolveAccessState();
  if (access.kind !== "approved" || access.role !== expectedRole) {
    throw redirect({ to: destinationForAccess(access) });
  }
}
