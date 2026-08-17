import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/dashboard-shell";
import { ShiftPanel } from "@/components/shift-panel";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/atendente")({
  head: () => ({
    meta: [
      { title: "Painel do Atendente | Caixa Grupo Roots" },
      {
        name: "description",
        content: "Abra o caixa, registre entradas e despesas com comprovante na sua unidade.",
      },
      { property: "og:title", content: "Painel do Atendente | Caixa Grupo Roots" },
      {
        property: "og:description",
        content: "Contagem cega de caixa e registro de entradas e despesas com foto.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AttendantDashboard,
});

function AttendantDashboard() {
  const { data: profile, isLoading } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Atendente"
      title={isLoading ? "Carregando..." : `Bem-vindo ${profile?.fullName ?? ""}`}
      subtitle={profile?.unitName ? `Unidade ${profile.unitName}` : "Unidade não atribuída"}
    >
      {profile ? <ShiftPanel userId={profile.userId} unitId={profile.unitId} /> : null}
    </DashboardShell>
  );
}
