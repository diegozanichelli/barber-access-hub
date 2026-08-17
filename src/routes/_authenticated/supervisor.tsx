import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/dashboard-shell";
import { ShiftPanel } from "@/components/shift-panel";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({
    meta: [
      { title: "Painel do Supervisor | Caixa Barber" },
      {
        name: "description",
        content: "Acompanhe o caixa aberto e registre entradas e despesas da unidade.",
      },
      { property: "og:title", content: "Painel do Supervisor | Caixa Barber" },
      {
        property: "og:description",
        content: "Turno ativo, entradas e despesas com comprovante por unidade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SupervisorDashboard,
});

function SupervisorDashboard() {
  const { data: profile, isLoading } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Supervisor"
      title={isLoading ? "Carregando..." : `Bem-vindo Supervisor ${profile?.fullName ?? ""}`}
      subtitle={profile?.unitName ? `Unidade ${profile.unitName}` : "Unidade não atribuída"}
    >
      {profile ? <ShiftPanel userId={profile.userId} unitId={profile.unitId} /> : null}
    </DashboardShell>
  );
}
