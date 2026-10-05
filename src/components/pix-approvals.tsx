import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ReceiptThumb } from "@/components/receipt-thumb";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import { useAuditorReferences } from "@/hooks/use-auditor-data";

type PendingPix = {
  id: string;
  unit_id: string;
  user_id: string;
  amount: number;
  category: string;
  client_name: string | null;
  description: string | null;
  photo_url: string | null;
  created_at: string;
  transaction_type: string;
};

/** Dia local (YYYY-MM-DD) de uma data ISO, para filtrar e agrupar por dia. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fila de conferência: todo Pix registrado fica aqui até o gestor confirmar. */
export function PixApprovals({ unitId }: { unitId?: string }) {
  const queryClient = useQueryClient();
  const { data: references } = useAuditorReferences();
  const [day, setDay] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: pending, isLoading } = useQuery({
    queryKey: ["pix-approvals", unitId ?? "all"],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select(
          "id, unit_id, user_id, amount, category, client_name, description, photo_url, created_at, transaction_type",
        )
        .eq("payment_method", "Pix")
        .eq("pix_status", "pending")
        .is("reversed_at", null)
        .order("created_at", { ascending: false });
      if (unitId) query = query.eq("unit_id", unitId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PendingPix[];
    },
  });

  const filtered = useMemo(() => {
    const list = pending ?? [];
    return day ? list.filter((tx) => localDay(tx.created_at) === day) : list;
  }, [pending, day]);
  const selectedVisible = filtered.filter((tx) => selected.has(tx.id));
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const tx of filtered) {
        if (on) next.add(tx.id);
        else next.delete(tx.id);
      }
      return next;
    });
  }

  const confirm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("review_pix_transaction", { _transaction_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pix confirmado como pago");
      void queryClient.invalidateQueries({ queryKey: ["pix-approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
    },
    onError: (err: Error) =>
      toast.error("Não foi possível confirmar", { description: friendlyError(err) }),
  });

  const bulkConfirm = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => supabase.rpc("review_pix_transaction", { _transaction_id: id })),
      );
      let ok = 0;
      let failMessage: string | null = null;
      results.forEach((r) => {
        if (r.status === "fulfilled" && !r.value.error) ok += 1;
        else if (r.status === "fulfilled" && r.value.error) failMessage = r.value.error.message;
        else if (r.status === "rejected")
          failMessage = r.reason instanceof Error ? r.reason.message : String(r.reason);
      });
      return { ok, fail: ids.length - ok, failMessage };
    },
    onSuccess: ({ ok, fail, failMessage }) => {
      if (ok > 0)
        toast.success(`${ok} ${ok === 1 ? "Pix confirmado" : "Pix confirmados"} como pago`);
      if (fail > 0)
        toast.error(`${fail} não pôde ser confirmado`, {
          description: failMessage ? friendlyError(new Error(failMessage)) : undefined,
        });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["pix-approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
    },
    onError: (err: Error) =>
      toast.error("Não foi possível confirmar", { description: friendlyError(err) }),
  });

  const busy = confirm.isPending || bulkConfirm.isPending;

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center gap-2">
        <QrCode className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg">Pix aguardando aprovação</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Abra o comprovante, confira se o valor caiu na conta e marque como pago. Dá para marcar
        vários de uma vez e filtrar por dia.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="pix-day" className="text-xs font-medium text-muted-foreground">
            Filtrar por dia
          </label>
          <Input
            id="pix-day"
            type="date"
            className="h-10 w-[11rem]"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => setDay(localDay(new Date().toISOString()))}
        >
          Hoje
        </Button>
        {day ? (
          <Button type="button" variant="ghost" className="h-10" onClick={() => setDay("")}>
            Limpar filtro
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden />
          {day
            ? "Nenhum Pix aguardando conferência nesse dia."
            : "Nenhum Pix aguardando conferência."}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label="Selecionar todos"
              />
              Selecionar todos ({filtered.length})
            </label>
            <Button
              size="sm"
              disabled={busy || selectedVisible.length === 0}
              onClick={() => bulkConfirm.mutate(selectedVisible.map((tx) => tx.id))}
            >
              {bulkConfirm.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Marcar {selectedVisible.length} como pago
            </Button>
          </div>

          <ul className="mt-3 space-y-3">
            {filtered.map((tx) => (
              <li key={tx.id} className="flex gap-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-start pt-1">
                  <Checkbox
                    checked={selected.has(tx.id)}
                    onCheckedChange={(v) => toggle(tx.id, v === true)}
                    aria-label={`Selecionar Pix ${formatBRL(Number(tx.amount))}`}
                  />
                </div>
                <ReceiptThumb path={tx.photo_url} alt={`Comprovante Pix ${formatBRL(tx.amount)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-primary">
                    {formatBRL(Number(tx.amount))}
                  </p>
                  <p className="truncate text-sm">
                    {tx.category}
                    {tx.client_name ? ` · ${tx.client_name}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {references?.unitNames[tx.unit_id] ?? "Unidade"} ·{" "}
                    {references?.names[tx.user_id] ?? "Colaborador"} ·{" "}
                    {new Date(tx.created_at).toLocaleString("pt-BR")}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => confirm.mutate(tx.id)}
                  >
                    {confirm.isPending && confirm.variables === tx.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    Pago
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
