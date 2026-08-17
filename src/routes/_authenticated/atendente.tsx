import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell, PlaceholderPanel } from "@/components/dashboard-shell";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/atendente")({
  head: () => ({
    meta: [
      { title: "Painel do Atendente | Caixa Barber" },
      { name: "description", content: "Painel do atendente com turnos e caixa da sua unidade." },
      { property: "og:title", content: "Painel do Atendente | Caixa Barber" },
      { property: "og:description", content: "Turnos e caixa da unidade do atendente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AttendantDashboard,
});

function AttendantDashboard() {
  const { data, isLoading } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Atendente"
      title={isLoading ? "Carregando..." : `Bem-vindo ${data?.fullName ?? ""}`}
      subtitle={data?.unitName ? `Unidade ${data.unitName}` : "Unidade não atribuída"}
    >
      <PlaceholderPanel
        title="Turnos"
        description="Espaço reservado para abrir e fechar turno (etapa 2)."
      />
    </DashboardShell>
  );
}
