import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { AuditorOverview } from "@/components/auditor-overview";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { supabase } from "@/integrations/supabase/client";
import { listManagedUsers, updateManagedUser } from "@/lib/admin-users.functions";
import { ROLE_LABELS, ROLE_ORDER, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/auditor")({
  head: () => ({
    meta: [
      { title: "Painel do Auditor | Caixa Barber" },
      { name: "description", content: "Gerencie usuários, papéis e unidades da rede." },
      { property: "og:title", content: "Painel do Auditor | Caixa Barber" },
      { property: "og:description", content: "Gestão de usuários e auditoria de caixa da rede." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditorDashboard,
});

const NO_UNIT = "__none__";

function AuditorDashboard() {
  const { data: profile } = useSessionProfile();
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listManagedUsers);
  const saveUser = useServerFn(updateManagedUser);
  const [drafts, setDrafts] = useState<Record<string, { role: AppRole; unitId: string }>>({});

  const { data: users, isLoading } = useQuery({
    queryKey: ["managed-users"],
    queryFn: () => fetchUsers(),
  });

  const { data: units } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("id, name").order("name");
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: (vars: { userId: string; role: AppRole; unitId: string | null }) =>
      saveUser({ data: vars }),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      void queryClient.invalidateQueries({ queryKey: ["managed-users"] });
    },
    onError: (error: Error) => toast.error("Erro ao salvar", { description: error.message }),
  });

  return (
    <DashboardShell
      eyebrow="Auditor"
      title="Bem-vindo Admin"
      subtitle={profile?.fullName ?? undefined}
    >
      <AuditorOverview />

      <section className="surface-panel p-5">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-primary" aria-hidden />
          <h2 className="text-lg">Gerenciar usuários</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Defina o papel e a unidade de cada usuário da rede.
        </p>

        {isLoading ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {(users ?? []).map((user) => {
              const draft = drafts[user.id] ?? {
                role: (user.role as AppRole | null) ?? "atendente",
                unitId: user.unitId ?? NO_UNIT,
              };
              const dirty =
                draft.role !== ((user.role as AppRole | null) ?? "atendente") ||
                draft.unitId !== (user.unitId ?? NO_UNIT);

              return (
                <li key={user.id} className="rounded-lg border border-border/60 p-4">
                  <p className="font-medium">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>

                  <div className="mt-3 grid gap-3">
                    <Select
                      value={draft.role}
                      onValueChange={(role) =>
                        setDrafts((p) => ({ ...p, [user.id]: { ...draft, role: role as AppRole } }))
                      }
                    >
                      <SelectTrigger aria-label={`Papel de ${user.fullName}`}>
                        <SelectValue placeholder="Papel" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_ORDER.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={draft.unitId}
                      onValueChange={(unitId) =>
                        setDrafts((p) => ({ ...p, [user.id]: { ...draft, unitId } }))
                      }
                    >
                      <SelectTrigger aria-label={`Unidade de ${user.fullName}`}>
                        <SelectValue placeholder="Unidade" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_UNIT}>Sem unidade</SelectItem>
                        {(units ?? []).map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      disabled={!dirty || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          userId: user.id,
                          role: draft.role,
                          unitId: draft.unitId === NO_UNIT ? null : draft.unitId,
                        })
                      }
                    >
                      Salvar alterações
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
