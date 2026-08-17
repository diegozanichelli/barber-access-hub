import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell, PlaceholderPanel } from "@/components/dashboard-shell";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({
    meta: [
      { title: "Painel do Supervisor | Caixa Barber" },
      { name: "description", content: "Painel do supervisor para acompanhar caixas das unidades." },
      { property: "og:title", content: "Painel do Supervisor | Caixa Barber" },
      { property: "og:description", content: "Acompanhamento de caixas por unidade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SupervisorDashboard,
});

function SupervisorDashboard() {
  const { data, isLoading } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Supervisor"
      title={isLoading ? "Carregando..." : `Bem-vindo Supervisor ${data?.fullName ?? ""}`}
      subtitle={data?.unitName ? `Unidade ${data.unitName}` : undefined}
    >
      <PlaceholderPanel
        title="Conferências"
        description="Espaço reservado para conferência de caixas e turnos (etapa 2)."
      />
    </DashboardShell>
  );
}
