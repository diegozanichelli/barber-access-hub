import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell, PlaceholderPanel } from "@/components/dashboard-shell";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/socio")({
  head: () => ({
    meta: [
      { title: "Painel do Sócio | Caixa Barber" },
      { name: "description", content: "Painel do sócio com aprovações pendentes da rede." },
      { property: "og:title", content: "Painel do Sócio | Caixa Barber" },
      { property: "og:description", content: "Aprovações e visão geral da rede para sócios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PartnerDashboard,
});

function PartnerDashboard() {
  const { data, isLoading } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Sócio"
      title={isLoading ? "Carregando..." : `Bem-vindo Sócio ${data?.fullName ?? ""}`}
      subtitle="Visão geral da rede"
    >
      <PlaceholderPanel
        title="Aprovações pendentes"
        description="Espaço reservado para aprovações pendentes (etapa 2)."
      />
    </DashboardShell>
  );
}
