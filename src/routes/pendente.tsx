import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, Loader2, Scissors, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, ROLE_ROUTES, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/pendente")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cadastro em análise | Caixa Grupo Roots" },
      {
        name: "description",
        content: "Seu cadastro no Caixa Grupo Roots aguarda aprovação do administrador da rede.",
      },
      { property: "og:title", content: "Cadastro em análise | Caixa Grupo Roots" },
      {
        property: "og:description",
        content: "Aguardando aprovação do administrador para liberar o acesso ao painel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<{
    loading: boolean;
    status: "pending" | "rejected" | null;
    requestedRole: AppRole | null;
  }>({ loading: true, status: null, requestedRole: null });

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("status, requested_role")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (!profile || profile.status === "approved") {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userData.user.id);
        const role = roles?.[0]?.role as AppRole | undefined;
        navigate({ to: role ? ROLE_ROUTES[role] : "/atendente", replace: true });
        return;
      }

      setState({
        loading: false,
        status: profile.status as "pending" | "rejected",
        requestedRole: (profile.requested_role as AppRole | null) ?? null,
      });
    })();
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const rejected = state.status === "rejected";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="barber-stripes h-2 w-full" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/15">
          <Scissors className="size-7 text-primary" aria-hidden />
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">
          {rejected ? "Cadastro não aprovado" : "Cadastro em análise"}
        </h1>

        <div className="surface-panel mt-6 space-y-3 p-5 text-left">
          <div className="flex items-center gap-2">
            {rejected ? (
              <XCircle className="size-5 text-destructive" aria-hidden />
            ) : (
              <Clock className="size-5 text-primary" aria-hidden />
            )}
            <p className="font-medium">
              {rejected ? "Acesso recusado pelo administrador" : "Aguardando aprovação"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {rejected
              ? "Fale com o administrador da rede para revisar seu cadastro."
              : "Seu cadastro foi enviado e será liberado assim que o administrador aprovar o acesso."}
          </p>
          {state.requestedRole ? (
            <p className="text-sm text-muted-foreground">
              Função solicitada:{" "}
              <span className="font-medium text-foreground">
                {ROLE_LABELS[state.requestedRole]}
              </span>
            </p>
          ) : null}
        </div>

        <Button variant="secondary" className="mt-6" onClick={signOut}>
          Sair
        </Button>
      </main>
    </div>
  );
}
