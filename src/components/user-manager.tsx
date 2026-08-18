import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  listManagedUsers,
  resetUserPassword,
  updateManagedUser,
} from "@/lib/admin-users.functions";
import { ROLE_LABELS, ROLE_ORDER, type AppRole } from "@/lib/roles";

const NO_UNIT = "__none__";

type Draft = { role: AppRole; unitId: string; fullName: string; email: string };

export function UserManager() {
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listManagedUsers);
  const saveUser = useServerFn(updateManagedUser);
  const setPassword = useServerFn(resetUserPassword);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});

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
    mutationFn: (vars: {
      userId: string;
      role: AppRole;
      unitId: string | null;
      fullName: string;
      email: string;
    }) => saveUser({ data: vars }),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      void queryClient.invalidateQueries({ queryKey: ["managed-users"] });
    },
    onError: (error: Error) => toast.error("Erro ao salvar", { description: error.message }),
  });

  const passwordMutation = useMutation({
    mutationFn: (vars: { userId: string; password: string }) => setPassword({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success("Senha redefinida");
      setPasswords((p) => ({ ...p, [vars.userId]: "" }));
    },
    onError: (error: Error) =>
      toast.error("Erro ao redefinir senha", { description: error.message }),
  });

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg">Gerenciar usuários</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Edite nome, e-mail, papel, unidade e senha de cada usuário da rede.
      </p>

      {isLoading ? (
        <div className="mt-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {(users ?? []).map((user) => {
            const base: Draft = {
              role: (user.role as AppRole | null) ?? "atendente",
              unitId: user.unitId ?? NO_UNIT,
              fullName: user.fullName,
              email: user.email ?? "",
            };
            const draft = drafts[user.id] ?? base;
            const dirty =
              draft.role !== base.role ||
              draft.unitId !== base.unitId ||
              draft.fullName.trim() !== base.fullName ||
              draft.email.trim() !== base.email;
            const password = passwords[user.id] ?? "";

            const patch = (values: Partial<Draft>) =>
              setDrafts((p) => ({ ...p, [user.id]: { ...draft, ...values } }));

            return (
              <li key={user.id} className="space-y-3 rounded-lg border border-border/60 p-4">
                <div className="grid gap-2">
                  <Label htmlFor={`name-${user.id}`}>Nome completo</Label>
                  <Input
                    id={`name-${user.id}`}
                    value={draft.fullName}
                    onChange={(e) => patch({ fullName: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`email-${user.id}`}>E-mail</Label>
                  <Input
                    id={`email-${user.id}`}
                    type="email"
                    inputMode="email"
                    value={draft.email}
                    onChange={(e) => patch({ email: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Papel</Label>
                  <Select
                    value={draft.role}
                    onValueChange={(role) =>
                      patch({
                        role: role as AppRole,
                        unitId: role === "auditor" ? NO_UNIT : draft.unitId,
                      })
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
                </div>

                {draft.role === "auditor" ? (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Acesso a todas as unidades
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label>Unidade</Label>
                    <Select value={draft.unitId} onValueChange={(unitId) => patch({ unitId })}>
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
                  </div>
                )}

                <Button
                  size="sm"
                  disabled={!dirty || mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      userId: user.id,
                      role: draft.role,
                      unitId: draft.unitId === NO_UNIT ? null : draft.unitId,
                      fullName: draft.fullName.trim(),
                      email: draft.email.trim(),
                    })
                  }
                >
                  Salvar alterações
                </Button>

                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 text-primary" aria-hidden />
                    <p className="text-sm font-medium">Redefinir senha</p>
                  </div>
                  <div className="mt-2 grid gap-2">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Nova senha (mín. 6 caracteres)"
                      aria-label={`Nova senha de ${user.fullName}`}
                      value={password}
                      onChange={(e) => setPasswords((p) => ({ ...p, [user.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={password.length < 6 || passwordMutation.isPending}
                      onClick={() => {
                        if (!window.confirm(`Definir uma nova senha para ${user.fullName}?`))
                          return;
                        passwordMutation.mutate({ userId: user.id, password });
                      }}
                    >
                      Definir nova senha
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
