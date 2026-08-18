import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { approveUser, listPendingUsers, rejectUser } from "@/lib/admin-users.functions";
import { ROLE_LABELS, ROLE_ORDER, type AppRole } from "@/lib/roles";

const NO_UNIT = "__none__";

export function UserApprovals() {
  const queryClient = useQueryClient();
  const fetchPending = useServerFn(listPendingUsers);
  const approve = useServerFn(approveUser);
  const reject = useServerFn(rejectUser);
  const [drafts, setDrafts] = useState<Record<string, { role: AppRole; unitId: string }>>({});

  const { data: pending, isLoading } = useQuery({
    queryKey: ["pending-users"],
    queryFn: () => fetchPending(),
  });

  const { data: units } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("id, name").order("name");
      return data ?? [];
    },
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    void queryClient.invalidateQueries({ queryKey: ["managed-users"] });
  }

  const approveMutation = useMutation({
    mutationFn: (vars: { userId: string; role: AppRole; unitId: string | null }) =>
      approve({ data: vars }),
    onSuccess: () => {
      toast.success("Cadastro aprovado");
      refresh();
    },
    onError: (e: Error) => toast.error("Erro ao aprovar", { description: e.message }),
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: string) => reject({ data: { userId } }),
    onSuccess: () => {
      toast.success("Cadastro recusado");
      refresh();
    },
    onError: (e: Error) => toast.error("Erro ao recusar", { description: e.message }),
  });

  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center gap-2">
        <UserPlus className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg">Aprovações de cadastro</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Revise a função e a unidade antes de liberar o acesso.
      </p>

      {isLoading ? (
        <div className="mt-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (pending ?? []).length === 0 ? (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden />
          Nenhum cadastro aguardando aprovação.
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {(pending ?? []).map((user) => {
            const draft = drafts[user.id] ?? {
              role: (user.requestedRole as AppRole | null) ?? "atendente",
              unitId: user.unitId ?? NO_UNIT,
            };
            return (
              <li key={user.id} className="rounded-lg border border-border/60 p-4">
                <p className="font-medium">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Solicitou:{" "}
                  {user.requestedRole
                    ? ROLE_LABELS[user.requestedRole as AppRole]
                    : "não informado"}
                </p>

                <div className="mt-3 grid gap-3">
                  <Select
                    value={draft.role}
                    onValueChange={(role) =>
                      setDrafts((p) => ({
                        ...p,
                        [user.id]: {
                          role: role as AppRole,
                          unitId: role === "auditor" ? NO_UNIT : draft.unitId,
                        },
                      }))
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

                  {draft.role === "auditor" ? (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      Acesso a todas as unidades
                    </div>
                  ) : (
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
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        approveMutation.mutate({
                          userId: user.id,
                          role: draft.role,
                          unitId: draft.unitId === NO_UNIT ? null : draft.unitId,
                        })
                      }
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => rejectMutation.mutate(user.id)}
                    >
                      Recusar
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
