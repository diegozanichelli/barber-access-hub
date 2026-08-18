import { createFileRoute } from "@tanstack/react-router";
import { AuditFeed } from "@/components/audit-feed";
import { AuditorOverview } from "@/components/auditor-overview";
import { ShiftHistory } from "@/components/shift-history";
import { DashboardShell } from "@/components/dashboard-shell";
import { UnitManager } from "@/components/unit-manager";
import { UserApprovals } from "@/components/user-approvals";
import { UserManager } from "@/components/user-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { requireDashboardRole } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated/auditor")({
  beforeLoad: () => requireDashboardRole("auditor"),
  head: () => ({
    meta: [
      { title: "Painel do Auditor | Caixa Grupo Roots" },
      { name: "description", content: "Gerencie usuários, papéis e unidades da rede." },
      { property: "og:title", content: "Painel do Auditor | Caixa Grupo Roots" },
      { property: "og:description", content: "Gestão de usuários e auditoria de caixa da rede." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditorDashboard,
});

function AuditorDashboard() {
  const { data: profile } = useSessionProfile();

  return (
    <DashboardShell
      eyebrow="Auditor"
      title="Bem-vindo Admin"
      subtitle={`${profile?.fullName ?? ""} · Acesso a todas as unidades`.trim()}
      wide
    >
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="feed">Lançamentos</TabsTrigger>
          <TabsTrigger value="history">Turnos</TabsTrigger>
          <TabsTrigger value="units">Unidades</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <UnitManager />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <AuditorOverview />
        </TabsContent>

        <TabsContent value="feed">
          <AuditFeed />
        </TabsContent>

        <TabsContent value="history">
          <ShiftHistory />
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UserApprovals />
          <UserManager />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}
