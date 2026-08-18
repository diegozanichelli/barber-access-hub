import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Scissors } from "lucide-react";
import { destinationForAccess, resolveAccessState } from "@/lib/access";

export const Route = createFileRoute("/")({
  ssr: false,
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

  useEffect(() => {
    void resolveAccessState().then((access) => {
      navigate({ to: destinationForAccess(access), replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Scissors className="size-8 text-primary" aria-hidden />
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="sr-only">Carregando Caixa Grupo Roots</p>
    </div>
  );
}
