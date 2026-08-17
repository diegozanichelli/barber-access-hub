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
};

export function WithdrawalDialog({ open, onOpenChange, shiftId, unitId, userId }: Props) {
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

  const valid = partnerId !== "" && Number.isFinite(value) && value > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirada de Sócio</DialogTitle>
          <DialogDescription>
            A retirada fica pendente até a confirmação do sócio e já sai do caixa.
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
            {valid ? (
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
