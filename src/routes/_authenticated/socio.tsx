import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";

export const Route = createFileRoute("/_authenticated/socio")({
  head: () => ({
    meta: [
      { title: "Painel do Sócio | Caixa Barber" },
      { name: "description", content: "Confirme ou conteste retiradas de sócio da rede." },
      { property: "og:title", content: "Painel do Sócio | Caixa Barber" },
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

  const mutation = useMutation({
    mutationFn: async (vars: { id: string; status: "approved" | "disputed" }) => {
      const { error } = await supabase
        .from("partner_withdrawals")
        .update({ status: vars.status })
        .eq("id", vars.id);
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
    },
    onError: (error: Error) => toast.error("Erro ao atualizar", { description: error.message }),
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
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Button
                      className="h-12"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: w.id, status: "approved" })}
                    >
                      <Check className="size-4" />
                      Confirmar
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-12"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: w.id, status: "disputed" })}
                    >
                      <X className="size-4" />
                      Contestar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DashboardShell>
  );
}
