import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, Loader2, Scissors, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { resolveAccessState, type AccessState } from "@/lib/access";
import { ROLE_LABELS } from "@/lib/roles";

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
  const [state, setState] = useState<AccessState | null>(null);

  useEffect(() => {
    void resolveAccessState().then((access) => {
      if (access.kind === "anonymous") {
        navigate({ to: "/auth", replace: true });
        return;
      }
      if (access.kind === "approved") {
        navigate({ to: access.route, replace: true });
        return;
      }
      setState(access);
    });
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const rejected = state.kind === "rejected";
  const misconfigured = state.kind === "misconfigured";
  const requestedRole = "requestedRole" in state ? state.requestedRole : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="barber-stripes h-2 w-full" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/15">
          <Scissors className="size-7 text-primary" aria-hidden />
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">
          {misconfigured
            ? "Acesso não configurado"
            : rejected
              ? "Cadastro não aprovado"
              : "Cadastro em análise"}
        </h1>

        <div className="surface-panel mt-6 space-y-3 p-5 text-left">
          <div className="flex items-center gap-2">
            {rejected || misconfigured ? (
              <XCircle className="size-5 text-destructive" aria-hidden />
            ) : (
              <Clock className="size-5 text-primary" aria-hidden />
            )}
            <p className="font-medium">
              {misconfigured
                ? "Configuração administrativa necessária"
                : rejected
                  ? "Acesso recusado pelo administrador"
                  : "Aguardando aprovação"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {misconfigured
              ? state.message
              : rejected
                ? "Fale com o administrador da rede para revisar seu cadastro."
                : "Seu cadastro foi enviado e será liberado assim que o administrador aprovar o acesso."}
          </p>
          {requestedRole ? (
            <p className="text-sm text-muted-foreground">
              Função solicitada:{" "}
              <span className="font-medium text-foreground">{ROLE_LABELS[requestedRole]}</span>
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
