import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

/** Fila de conferência: todo Pix registrado fica aqui até o gestor confirmar. */
export function PixApprovals({ unitId }: { unitId?: string }) {
  const queryClient = useQueryClient();
  const { data: references } = useAuditorReferences();

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
    onError: (err: Error) => toast.error("Não foi possível confirmar", { description: friendlyError(err) }),
  });

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center gap-2">
        <QrCode className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg">Pix aguardando aprovação</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Abra o comprovante, confira se o valor caiu na conta e marque como pago.
      </p>

      {isLoading ? (
        <div className="mt-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (pending ?? []).length === 0 ? (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden />
          Nenhum Pix aguardando conferência.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {(pending ?? []).map((tx) => (
            <li
              key={tx.id}
              className="flex gap-3 rounded-lg border border-border/60 p-3"
            >
              <ReceiptThumb path={tx.photo_url} alt={`Comprovante Pix ${formatBRL(tx.amount)}`} />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-primary">{formatBRL(Number(tx.amount))}</p>
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
                  disabled={confirm.isPending}
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
      )}
    </section>
  );
}
