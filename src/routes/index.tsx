import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_ROUTES, type AppRole } from "@/lib/roles";

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
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile && profile.status !== "approved") {
        navigate({ to: "/pendente", replace: true });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      const role = roles?.[0]?.role as AppRole | undefined;
      navigate({ to: role ? ROLE_ROUTES[role] : "/pendente", replace: true });
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Scissors className="size-8 text-primary" aria-hidden />
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="sr-only">Carregando Caixa Grupo Roots</p>
    </div>
  );
}
