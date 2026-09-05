import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuditFeed } from "@/components/audit-feed";
import { ChangeRequests } from "@/components/change-requests";
import { PixApprovals } from "@/components/pix-approvals";
import { AuditorOverview } from "@/components/auditor-overview";
import { ShiftHistory } from "@/components/shift-history";
import { SalesReport } from "@/components/sales-report";
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
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedUnitId, setSelectedUnitId] = useState<string>();

  function viewUnitTransactions(unitId: string) {
    setSelectedUnitId(unitId);
    setActiveTab("feed");
  }

  function viewShiftHistory() {
    setActiveTab("history");
  }

  return (
    <DashboardShell
      eyebrow="Auditor"
      title="Bem-vindo Admin"
      subtitle={`${profile?.fullName ?? ""} · Acesso a todas as unidades`.trim()}
      wide
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="feed">Lançamentos</TabsTrigger>
          <TabsTrigger value="pix">Pix</TabsTrigger>
          <TabsTrigger value="history">Turnos</TabsTrigger>
          <TabsTrigger value="units">Unidades</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="requests">Solicitações</TabsTrigger>
          <TabsTrigger value="sales">Vendas</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <UnitManager />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <AuditorOverview
            onViewTransactions={viewUnitTransactions}
            onViewShifts={viewShiftHistory}
          />
        </TabsContent>

        <TabsContent value="feed">
          <AuditFeed {...(selectedUnitId ? { selectedUnitId } : {})} />
        </TabsContent>

        <TabsContent value="pix">
          <PixApprovals />
        </TabsContent>

        <TabsContent value="history">
          <ShiftHistory />
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UserApprovals />
          <UserManager />
        </TabsContent>
        <TabsContent value="requests">
          <ChangeRequests />
        </TabsContent>
        <TabsContent value="sales">
          <SalesReport />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}
