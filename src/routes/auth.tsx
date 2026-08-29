import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { destinationForAccess, resolveAccessState } from "@/lib/access";
import { friendlyError } from "@/lib/errors";
import { ROLE_LABELS, roleRequiresUnit, type AppRole } from "@/lib/roles";
import { listSignupUnits } from "@/lib/units.functions";

const SIGNUP_ROLES: AppRole[] = ["atendente", "supervisor", "socio"];

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar | Caixa Grupo Roots - Auditoria de Caixa" },
      {
        name: "description",
        content:
          "Acesse o painel de auditoria de caixa do Grupo Roots: atendentes, supervisores, sócios e auditores.",
      },
      { property: "og:title", content: "Entrar | Caixa Grupo Roots" },
      {
        property: "og:description",
        content: "Login seguro para atendentes, supervisores, sócios e auditores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

async function routeForCurrentUser(): Promise<string | null> {
  const access = await resolveAccessState();
  return access.kind === "anonymous" ? null : destinationForAccess(access);
}

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [unitId, setUnitId] = useState<string>("");
  const [requestedRole, setRequestedRole] = useState<AppRole>("atendente");

  const { data: units } = useQuery({
    queryKey: ["units-public"],
    queryFn: () => listSignupUnits(),
  });

  useEffect(() => {
    void routeForCurrentUser()
      .then((to) => {
        if (to) navigate({ to, replace: true });
      })
      .catch((error: unknown) => {
        toast.error("Não foi possível verificar a sessão", { description: friendlyError(error) });
      });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    try {
      const to = (await routeForCurrentUser()) ?? "/pendente";
      navigate({ to, replace: true });
    } catch (accessError) {
      toast.error("Não foi possível verificar seu acesso", {
        description: friendlyError(accessError),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (roleRequiresUnit(requestedRole) && !unitId) {
      toast.error("Selecione a unidade", {
        description: "Atendentes e supervisores precisam estar vinculados a uma unidade.",
      });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
          unit_id: roleRequiresUnit(requestedRole) ? unitId : null,
          role: requestedRole,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível criar a conta", { description: error.message });
      return;
    }
    toast.success("Cadastro enviado", {
      description: "Aguarde a aprovação do administrador para acessar o painel.",
    });
    navigate({ to: "/pendente", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="barber-stripes h-2 w-full" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/15">
            <Scissors className="size-7 text-primary" aria-hidden />
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Caixa Grupo Roots</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditoria de caixa para redes de barbearia
          </p>
        </div>

        <Tabs defaultValue="signin" className="surface-panel p-5">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@barbearia.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                Entrar
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Seu perfil (Atendente, Supervisor, Sócio ou Auditor) define o painel exibido após o
                login.
              </p>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <Input
                  id="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Maria Silva"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-role">Função desejada</Label>
                <Select
                  value={requestedRole}
                  onValueChange={(value) => {
                    const role = value as AppRole;
                    setRequestedRole(role);
                    if (!roleRequiresUnit(role)) setUnitId("");
                  }}
                >
                  <SelectTrigger id="signup-role">
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNUP_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {roleRequiresUnit(requestedRole) ? (
                <div className="space-y-2">
                  <Label htmlFor="unit">Unidade</Label>
                  <Select value={unitId} onValueChange={setUnitId}>
                    <SelectTrigger id="unit">
                      <SelectValue placeholder="Selecione a unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {(units ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                  Sócios têm acesso às retiradas de todas as unidades da rede.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="signup-email">E-mail</Label>
                <Input
                  id="signup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Senha</Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                Criar conta
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                O cadastro fica em análise: o acesso é liberado após a aprovação do administrador.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
