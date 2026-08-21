import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { destinationForAccess, resolveAccessState } from "@/lib/access";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Caixa Grupo Roots | Auditoria de Caixa para Barbearias" },
      {
        name: "description",
        content:
          "Plataforma de auditoria de caixa para redes de barbearia, com painéis para atendentes, supervisores, sócios e auditores.",
      },
      { property: "og:title", content: "Caixa Grupo Roots | Auditoria de Caixa" },
      {
        property: "og:description",
        content: "Controle e auditoria de caixa por unidade, com acesso por perfil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const accessQuery = useQuery({
    queryKey: ["access-state"],
    queryFn: resolveAccessState,
    retry: 1,
  });

  useEffect(() => {
    if (accessQuery.data) {
      navigate({ to: destinationForAccess(accessQuery.data), replace: true });
    }
  }, [accessQuery.data, navigate]);

  if (accessQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="surface-panel w-full max-w-md p-6 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" aria-hidden />
          <h1 className="mt-3 text-2xl">Não foi possível verificar seu acesso</h1>
          <p className="mt-2 text-sm text-muted-foreground">{friendlyError(accessQuery.error)}</p>
          <Button className="mt-5" onClick={() => void accessQuery.refetch()}>
            <RefreshCw className="size-4" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Scissors className="size-8 text-primary" aria-hidden />
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="sr-only">Carregando Caixa Grupo Roots</p>
    </div>
  );
}
