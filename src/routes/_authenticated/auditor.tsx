import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell, PlaceholderPanel } from "@/components/dashboard-shell";
import { useSessionProfile } from "@/hooks/use-session-profile";

export const Route = createFileRoute("/_authenticated/auditor")({
  head: () => ({
    meta: [
      { title: "Painel do Auditor | Caixa Barber" },
      { name: "description", content: "Painel administrativo de auditoria de caixa da rede." },
      { property: "og:title", content: "Painel do Auditor | Caixa Barber" },
      { property: "og:description", content: "Administração e auditoria de caixa da rede." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditorDashboard,
});

function AuditorDashboard() {
  const { data } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Auditor"
      title="Bem-vindo Admin"
      subtitle={data?.fullName ? data.fullName : undefined}
    >
      <PlaceholderPanel
        title="Auditoria"
        description="Espaço reservado para auditoria de caixas, unidades e usuários (etapa 2)."
      />
    </DashboardShell>
  );
}
