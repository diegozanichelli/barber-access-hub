import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import {
  listChangeRequestsOnServer,
  type ChangeRequestRecord,
} from "@/lib/change-requests.functions";

export function ChangeRequests() {
  const client = useQueryClient();
  const listOnServer = useServerFn(listChangeRequestsOnServer);
  const [busyId, setBusyId] = useState<string>();
  const {
    data = [],
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["transaction-change-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_transaction_change_requests");
      if (error?.code === "PGRST202" || error?.message.includes("schema cache")) {
        return listOnServer();
      }
      if (error) throw error;
      return { requests: (data ?? []) as ChangeRequestRecord[], available: true };
    },
  });
  const decision = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      setBusyId(id);
      const { error } = await supabase.rpc("decide_transaction_change_request", {
        _request_id: id,
        _approve: approve,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["transaction-change-requests"] }),
        client.invalidateQueries({ queryKey: ["audit-transactions"] }),
        client.invalidateQueries({ queryKey: ["auditor-data"] }),
      ]);
      toast.success("Solicitação processada");
      setBusyId(undefined);
    },
    onError: (error) => {
      toast.error("Erro ao decidir", { description: friendlyError(error) });
      setBusyId(undefined);
    },
  });
  if (isLoading)
    return (
      <div className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  if (isError)
    return (
      <section className="surface-panel p-5" role="alert">
        <div className="flex items-start gap-3 text-destructive">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-semibold">Não foi possível carregar as solicitações</h2>
            <p className="mt-1 text-sm text-muted-foreground">{friendlyError(error)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Se a mensagem mencionar schema cache ou função inexistente, aplique as migrações do
              Supabase antes de tentar novamente.
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Tentar novamente
            </Button>
          </div>
        </div>
      </section>
    );
  const requests = data.requests ?? [];
  return (
    <section className="surface-panel p-5">
      <h2 className="text-lg">Solicitações de edição e exclusão</h2>
      {!data.available ? (
        <div className="mt-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          <p className="font-semibold text-warning">Fluxo de solicitações aguardando publicação</p>
          <p className="mt-1 text-muted-foreground">
            Ainda não existem solicitações armazenadas. A migração do banco precisa ser publicada
            para liberar pedidos de edição e exclusão aos colaboradores.
          </p>
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma solicitação.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {requests.map((r) => {
            const snapshot = r.transaction_snapshot as {
              amount?: number;
              category?: string;
            };
            return (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {r.action === "delete" ? "Excluir" : "Editar"} ·{" "}
                      {snapshot.category ?? "Lançamento"} · {formatBRL(snapshot.amount ?? 0)}
                    </p>
                    <p className="text-sm text-muted-foreground">Motivo: {r.reason}</p>
                    {r.action === "edit" ? (
                      <p className="text-sm">
                        Novo valor: {formatBRL(r.proposed_amount ?? 0)}
                        {r.proposed_description ? ` · ${r.proposed_description}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-xs uppercase text-muted-foreground">{r.status}</span>
                </div>
                {r.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => decision.mutate({ id: r.id, approve: true })}
                      disabled={busyId === r.id}
                    >
                      <Check className="size-4" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => decision.mutate({ id: r.id, approve: false })}
                      disabled={busyId === r.id}
                    >
                      <X className="size-4" /> Recusar
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
