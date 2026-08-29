import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { parseAmount } from "@/lib/transactions";

export function TransactionChangeRequestDialog({
  transactionId,
  open,
  onOpenChange,
}: {
  transactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [action, setAction] = useState<"edit" | "delete">("delete");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");

  function resetForm() {
    setAction("delete");
    setAmount("");
    setDescription("");
    setReason("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!transactionId) return;
      const proposed = action === "edit" ? parseAmount(amount) : null;
      if (reason.trim().length < 5)
        throw new Error("Informe o motivo com pelo menos 5 caracteres.");
      if (action === "edit" && (!Number.isFinite(proposed) || proposed! <= 0))
        throw new Error("Informe o novo valor.");
      const { error } = await supabase.rpc("request_transaction_change", {
        _transaction_id: transactionId,
        _action: action,
        _reason: reason.trim(),
        ...(proposed !== null ? { _proposed_amount: proposed } : {}),
        ...(description.trim() ? { _proposed_description: description.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["transaction-change-requests"] });
      toast.success("Solicitação enviada ao login master");
      resetForm();
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error("Erro ao solicitar alteração", { description: friendlyError(error) }),
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !mutation.isPending) resetForm();
    onOpenChange(nextOpen);
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar alteração</DialogTitle>
          <DialogDescription>
            Somente o login master pode aprovar a edição ou exclusão.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={action === "delete" ? "destructive" : "secondary"}
            onClick={() => setAction("delete")}
          >
            Excluir
          </Button>
          <Button
            variant={action === "edit" ? "default" : "secondary"}
            onClick={() => setAction("edit")}
          >
            Editar
          </Button>
        </div>
        {action === "edit" ? (
          <>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Novo valor (ex.: 125,50)"
              inputMode="decimal"
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nova descrição (opcional)"
            />
          </>
        ) : null}
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo da solicitação"
        />
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Enviar ao
            master
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
