import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { parseAmount } from "@/lib/transactions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  unitId: string;
  userId: string;
  safeBalance: number;
};

export function WithdrawalDialog({
  open,
  onOpenChange,
  shiftId,
  unitId,
  userId,
  safeBalance,
}: Props) {
  const queryClient = useQueryClient();
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");

  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_partners");
      if (error) throw error;
      return data ?? [];
    },
  });

  const value = parseAmount(amount);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("partner_withdrawals").insert({
        shift_id: shiftId,
        unit_id: unitId,
        partner_id: partnerId,
        created_by: userId,
        amount: value,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Retirada registrada", { description: "Aguardando confirmação do sócio." });
      setPartnerId("");
      setAmount("");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["shift-withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
    },
    onError: (error: Error) =>
      toast.error("Erro ao registrar retirada", { description: error.message }),
  });

  const exceedsSafe = Number.isFinite(value) && value > safeBalance;
  const valid = partnerId !== "" && Number.isFinite(value) && value > 0 && !exceedsSafe;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirada de Sócio</DialogTitle>
          <DialogDescription>
            A retirada sai do cofre (dinheiro já separado por sangria), não da gaveta, e fica
            pendente até a confirmação do sócio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Qual sócio?</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger aria-label="Sócio">
                <SelectValue placeholder="Selecione o sócio" />
              </SelectTrigger>
              <SelectContent>
                {(partners ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || "Sócio"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="withdrawal-amount">Valor (R$)</Label>
            <Input
              id="withdrawal-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Disponível no cofre: {formatBRL(safeBalance)}
            </p>
            {exceedsSafe ? (
              <p className="text-xs font-semibold text-destructive">
                Valor acima do saldo do cofre. Faça uma sangria antes de retirar esse valor.
              </p>
            ) : Number.isFinite(value) && value > 0 ? (
              <p className="text-xs text-muted-foreground">{formatBRL(value)}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            className="w-full"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Registrar retirada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
