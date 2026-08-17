import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, Unlock } from "lucide-react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/dashboard-shell";
import { BlindCalculator } from "@/components/blind-calculator";
import { Button } from "@/components/ui/button";
import { useSessionProfile } from "@/hooks/use-session-profile";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, type CashQuantities } from "@/lib/cash";

export const Route = createFileRoute("/_authenticated/atendente")({
  head: () => ({
    meta: [
      { title: "Painel do Atendente | Caixa Barber" },
      { name: "description", content: "Abra e feche o caixa da sua unidade com contagem cega." },
      { property: "og:title", content: "Painel do Atendente | Caixa Barber" },
      { property: "og:description", content: "Abertura e fechamento de caixa com contagem cega." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AttendantDashboard,
});

type Mode = "opening" | "closing" | null;

function AttendantDashboard() {
  const { data: profile, isLoading } = useSessionProfile();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [lastResult, setLastResult] = useState<{ label: string; total: number } | null>(null);

  const unitId = profile?.unitId ?? null;

  const { data: openShift } = useQuery({
    queryKey: ["open-shift", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("unit_id", unitId!)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const openMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!unitId || !profile) throw new Error("Você não está atribuído a uma unidade.");

      const { data: lastClosed, error: lastError } = await supabase
        .from("shifts")
        .select("closing_total")
        .eq("unit_id", unitId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw lastError;

      const expected = Number(lastClosed?.closing_total ?? 0);

      const { data: shift, error: shiftError } = await supabase
        .from("shifts")
        .insert({
          unit_id: unitId,
          opened_by: profile.userId,
          expected_opening_total: expected,
          actual_opening_total: payload.total,
          status: "open",
        })
        .select()
        .single();
      if (shiftError) throw shiftError;

      const { error: countError } = await supabase.from("cash_counts").insert({
        shift_id: shift.id,
        count_type: "opening",
        counted_by: profile.userId,
        ...payload.quantities,
        total_calculated: payload.total,
        notes: payload.notes || null,
      });
      if (countError) throw countError;

      return payload.total;
    },
    onSuccess: (total) => {
      setMode(null);
      setLastResult({ label: "Caixa aberto com", total });
      toast.success("Caixa aberto", { description: `Total contado: ${formatBRL(total)}` });
      void queryClient.invalidateQueries({ queryKey: ["open-shift"] });
    },
    onError: (error: Error) => toast.error("Erro ao abrir o caixa", { description: error.message }),
  });

  const closeMutation = useMutation({
    mutationFn: async (payload: { quantities: CashQuantities; total: number; notes: string }) => {
      if (!openShift || !profile) throw new Error("Nenhum caixa aberto.");

      const { error: countError } = await supabase.from("cash_counts").insert({
        shift_id: openShift.id,
        count_type: "closing",
        counted_by: profile.userId,
        ...payload.quantities,
        total_calculated: payload.total,
        notes: payload.notes || null,
      });
      if (countError) throw countError;

      const { error: shiftError } = await supabase
        .from("shifts")
        .update({
          status: "closed",
          closing_total: payload.total,
          closed_by: profile.userId,
          closed_at: new Date().toISOString(),
        })
        .eq("id", openShift.id);
      if (shiftError) throw shiftError;

      return payload.total;
    },
    onSuccess: (total) => {
      setMode(null);
      setLastResult({ label: "Caixa fechado com", total });
      toast.success("Caixa fechado", { description: `Total contado: ${formatBRL(total)}` });
      void queryClient.invalidateQueries({ queryKey: ["open-shift"] });
    },
    onError: (error: Error) =>
      toast.error("Erro ao fechar o caixa", { description: error.message }),
  });

  return (
    <DashboardShell
      eyebrow="Atendente"
      title={isLoading ? "Carregando..." : `Bem-vindo ${profile?.fullName ?? ""}`}
      subtitle={profile?.unitName ? `Unidade ${profile.unitName}` : "Unidade não atribuída"}
    >
      {lastResult ? (
        <section className="surface-panel p-5">
          <p className="text-sm text-muted-foreground">{lastResult.label}</p>
          <p className="mt-1 text-3xl font-semibold text-primary">{formatBRL(lastResult.total)}</p>
        </section>
      ) : null}

      <section className="surface-panel p-5">
        <h2 className="text-lg">Turno</h2>
        {!unitId ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Peça ao auditor para atribuir sua unidade antes de operar o caixa.
          </p>
        ) : openShift ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Caixa aberto em {new Date(openShift.opened_at).toLocaleString("pt-BR")}.
            </p>
            <Button className="mt-4 w-full" onClick={() => setMode("closing")}>
              <LockKeyhole className="size-4" />
              Fechar Caixa
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Nenhum caixa aberto nesta unidade.
            </p>
            <Button className="mt-4 w-full" onClick={() => setMode("opening")}>
              <Unlock className="size-4" />
              Abrir Caixa
            </Button>
          </>
        )}
      </section>

      <BlindCalculator
        open={mode === "opening"}
        onOpenChange={(o) => setMode(o ? "opening" : null)}
        title="Abrir Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar abertura"
        submitting={openMutation.isPending}
        onSubmit={(payload) => openMutation.mutate(payload)}
      />

      <BlindCalculator
        open={mode === "closing"}
        onOpenChange={(o) => setMode(o ? "closing" : null)}
        title="Fechar Caixa"
        description="Informe apenas as quantidades de cada cédula e moeda. O sistema calcula o total."
        submitLabel="Confirmar fechamento"
        submitting={closeMutation.isPending}
        onSubmit={(payload) => closeMutation.mutate(payload)}
      />
    </DashboardShell>
  );
}
