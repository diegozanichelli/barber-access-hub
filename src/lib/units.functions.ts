import { createServerFn } from "@tanstack/react-start";

export type PublicUnit = { id: string; name: string };

/**
 * Unit names are needed by the sign-up screen before a session exists.
 * The `units` table is no longer readable by anonymous clients; this server
 * function exposes only the id/name pair required to pick a unit.
 */
export const listSignupUnits = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicUnit[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("units").select("id, name").order("name");
    if (error) throw error;
    return (data ?? []).map((unit) => ({ id: unit.id, name: unit.name }));
  },
);
