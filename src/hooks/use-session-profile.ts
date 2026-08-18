import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";

export type SessionProfile = {
  userId: string;
  email: string | null;
  fullName: string;
  role: AppRole | null;
  unitName: string | null;
  unitId: string | null;
  status: "pending" | "approved" | "rejected";
};

export function useSessionProfile() {
  return useQuery<SessionProfile | null>({
    queryKey: ["session-profile"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;

      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, unit_id, units ( name )")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      const unit = (profile as { units?: { name: string } | null } | null)?.units ?? null;

      return {
        userId: user.id,
        email: user.email ?? null,
        fullName: profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuário",
        role: (roles?.[0]?.role as AppRole | undefined) ?? null,
        unitName: unit?.name ?? null,
        unitId: profile?.unit_id ?? null,
      };
    },
  });
}
