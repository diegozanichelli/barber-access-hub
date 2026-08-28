import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import { getReceiptUrl } from "@/lib/transactions";
import { requireDashboardRole } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated/socio")({
  beforeLoad: () => requireDashboardRole("socio"),
  head: () => ({
    meta: [
      { title: "Painel do Sócio | Caixa Grupo Roots" },
      { name: "description", content: "Confirme ou conteste retiradas de sócio da rede." },
      { property: "og:title", content: "Painel do Sócio | Caixa Grupo Roots" },
      { property: "og:description", content: "Aprovações de retiradas e visão geral da rede." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PartnerDashboard,
});

function PartnerDashboard() {
  const { data: profile, isLoading } = useSessionProfile();
  const queryClient = useQueryClient();
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ["partner-withdrawal-history", profile?.userId],
    enabled: !!profile?.userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_withdrawals")
        .select("*, units ( name )")
        .eq("partner_id", profile!.userId)
        .neq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: withdrawals, isLoading: loadingWithdrawals } = useQuery({
    queryKey: ["partner-withdrawals", profile?.userId],
    enabled: !!profile?.userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_withdrawals")
        .select("*, units ( name )")
        .eq("partner_id", profile!.userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const creatorIds = [...new Set((withdrawals ?? []).map((w) => w.created_by))];
  const { data: creators } = useQuery({
    queryKey: ["withdrawal-creators", creatorIds.join(",")],
    enabled: creatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", creatorIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function openReceipt(path: string) {
    const url = await getReceiptUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Não foi possível abrir o comprovante");
  }

  const mutation = useMutation({
    mutationFn: async (vars: { id: string; status: "approved" | "disputed" }) => {
      const { error } = await supabase.rpc("respond_partner_withdrawal", {
        _withdrawal_id: vars.id,
        _decision: vars.status,
      });
      if (error) throw error;
      return vars.status;
    },
    onSuccess: (status) => {
      toast[status === "approved" ? "success" : "error"](
        status === "approved" ? "Retirada confirmada" : "Retirada contestada",
        {
          description:
            status === "approved" ? undefined : "A Auditoria foi notificada da contestação.",
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["partner-withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["shift-withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["shift-transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["unit-shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
    },
    onError: (error: Error) =>
      toast.error("Erro ao atualizar", { description: friendlyError(error) }),
  });

  return (
    <DashboardShell
      eyebrow="Sócio"
      title={isLoading ? "Carregando..." : `Bem-vindo Sócio ${profile?.fullName ?? ""}`}
      subtitle="Visão geral da rede"
    >
      <section className="surface-panel p-5">
        <h2 className="text-lg">Retiradas pendentes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirme somente o que você realmente retirou do caixa.
        </p>

        {loadingWithdrawals ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (withdrawals ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma retirada pendente.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {(withdrawals ?? []).map((w) => {
              const unit = (w as { units?: { name: string } | null }).units;
              const author = (creators ?? []).find((c) => c.id === w.created_by);
              return (
                <li key={w.id} className="rounded-lg border border-border/60 p-4">
                  <p className="text-2xl font-semibold text-primary">{formatBRL(w.amount)}</p>
                  <p className="mt-1 text-sm">{unit?.name ?? "Unidade"}</p>
                  <p className="text-xs text-muted-foreground">
                    Registrada por {author?.full_name || "Atendente"} ·{" "}
                    {new Date(w.created_at).toLocaleString("pt-BR")}
                  </p>
                  {w.note ? (
                    <p className="mt-2 rounded-md border border-border/60 bg-muted/50 p-2 text-xs text-muted-foreground">
                      <strong>Observação:</strong> {w.note}
                    </p>
                  ) : null}
                  {w.photo_url ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => void openReceipt(w.photo_url!)}
                    >
                      <ImageIcon className="size-4" />
                      Ver comprovante de entrega
                    </Button>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Button
                      className="h-12"
                      disabled={mutation.isPending}
                      onClick={() => {
                        if (approveId !== w.id) {
                          setApproveId(w.id);
                          return;
                        }
                        setApproveId(null);
                        mutation.mutate({ id: w.id, status: "approved" });
                      }}
                    >
                      <Check className="size-4" />
                      {approveId === w.id ? `Confirmar ${formatBRL(w.amount)}` : "Confirmar"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-12"
                      disabled={mutation.isPending}
                      onClick={() => {
                        if (disputeId !== w.id) {
                          setDisputeId(w.id);
                          return;
                        }
                        setDisputeId(null);
                        mutation.mutate({ id: w.id, status: "disputed" });
                      }}
                    >
                      <X className="size-4" />
                      {disputeId === w.id ? "Confirmar contestação" : "Contestar"}
                    </Button>
                  </div>
                  {disputeId === w.id ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Contestar aciona a Auditoria. Toque de novo para confirmar ou{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setDisputeId(null)}
                      >
                        cancelar
                      </button>
                      .
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="surface-panel p-5">
        <h2 className="text-lg">Histórico de retiradas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Suas últimas retiradas já confirmadas ou contestadas.
        </p>
        {loadingHistory ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (history ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma retirada registrada ainda.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {(history ?? []).map((w) => {
              const unit = (w as { units?: { name: string } | null }).units;
              return (
                <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatBRL(w.amount)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {unit?.name ?? "Unidade"} · {new Date(w.created_at).toLocaleString("pt-BR")}
                    </p>
                    {w.note ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <strong>Observação:</strong> {w.note}
                      </p>
                    ) : null}
                    {w.photo_url ? (
                      <button
                        type="button"
                        className="mt-1 flex items-center gap-1 text-xs text-primary underline"
                        onClick={() => void openReceipt(w.photo_url!)}
                      >
                        <ImageIcon className="size-3.5" />
                        Ver comprovante de entrega
                      </button>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      w.status === "disputed" ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {w.status === "disputed" ? "Contestada" : "Confirmada"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
