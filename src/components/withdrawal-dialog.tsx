import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReceiptUpload } from "@/components/receipt-upload";
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
import { parseAmount, uploadReceipt } from "@/lib/transactions";
import { friendlyError } from "@/lib/errors";

type WithdrawalSource = "safe" | "drawer";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  unitId: string;
  safeBalance: number;
  drawerBalance: number;
};

export function WithdrawalDialog({
  open,
  onOpenChange,
  shiftId,
  unitId,
  safeBalance,
  drawerBalance,
}: Props) {
  const queryClient = useQueryClient();
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [source, setSource] = useState<WithdrawalSource>("safe");
  const [confirming, setConfirming] = useState(false);

  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_partners");
      if (error) throw error;
      return data ?? [];
    },
  });

  const value = parseAmount(amount);
  const partnerName = (partners ?? []).find((p) => p.id === partnerId)?.full_name || "Sócio";
  const sourceBalance = source === "safe" ? safeBalance : drawerBalance;
  const sourceLabel = source === "safe" ? "o cofre da unidade" : "a gaveta do caixa";

  const mutation = useMutation({
    mutationFn: async () => {
      let photoPath: string | null = null;
      if (photo) photoPath = await uploadReceipt(photo, unitId, shiftId);
      const { error } = await supabase.rpc("create_partner_withdrawal", {
        _shift_id: shiftId,
        _partner_id: partnerId,
        _amount: value,
        _source: source,
        ...(note.trim() ? { _note: note.trim() } : {}),
        ...(photoPath ? { _photo_url: photoPath } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Retirada registrada", { description: "Aguardando confirmação do sócio." });
      reset();
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["shift-withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["shift-transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["unit-safe-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
    },
    onError: (error: Error) =>
      toast.error("Erro ao registrar retirada", { description: friendlyError(error) }),
  });

  function reset() {
    setPartnerId("");
    setAmount("");
    setNote("");
    setPhoto(null);
    setSource("safe");
    setConfirming(false);
  }

  const exceeds = Number.isFinite(value) && value > sourceBalance;
  const valid = partnerId !== "" && Number.isFinite(value) && value > 0 && !exceeds;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirmar retirada</DialogTitle>
              <DialogDescription>
                Confira os dados antes de registrar. O valor sai {sourceLabel}.
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Sócio</dt>
                <dd className="font-medium">{partnerName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Valor</dt>
                <dd className="text-base font-semibold text-primary">{formatBRL(value)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Saiu de</dt>
                <dd className="font-medium">
                  {source === "safe" ? "Cofre da unidade" : "Gaveta do caixa"}
                </dd>
              </div>
              {note.trim() ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Observação</dt>
                  <dd className="text-right">{note.trim()}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Comprovante</dt>
                <dd>{photo ? "Foto anexada" : "Sem foto"}</dd>
              </div>
            </dl>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setConfirming(false)}
              >
                <ArrowLeft className="size-4" />
                Voltar e corrigir
              </Button>
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Confirmar retirada de {formatBRL(value)}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Retirada de Sócio</DialogTitle>
              <DialogDescription>
                Registre uma retirada de sócio. Escolha de onde o dinheiro saiu; fica pendente até a
                confirmação do sócio.
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
              </div>

              <div className="space-y-2">
                <Label>De onde saiu o dinheiro?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={source === "drawer" ? "default" : "outline"}
                    className="h-auto flex-col items-start gap-0.5 py-2"
                    aria-pressed={source === "drawer"}
                    onClick={() => setSource("drawer")}
                  >
                    <span className="text-sm font-semibold">💵 Gaveta do caixa</span>
                    <span className="text-xs opacity-80">Em caixa: {formatBRL(drawerBalance)}</span>
                  </Button>
                  <Button
                    type="button"
                    variant={source === "safe" ? "default" : "outline"}
                    className="h-auto flex-col items-start gap-0.5 py-2"
                    aria-pressed={source === "safe"}
                    onClick={() => setSource("safe")}
                  >
                    <span className="text-sm font-semibold">🏦 Cofre da unidade</span>
                    <span className="text-xs opacity-80">No cofre: {formatBRL(safeBalance)}</span>
                  </Button>
                </div>
                {exceeds ? (
                  <p className="text-xs font-semibold text-destructive">
                    Valor acima do disponível em {sourceLabel} ({formatBRL(sourceBalance)}). Escolha
                    outra origem ou um valor menor.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Vai descontar de {sourceLabel} — disponível: {formatBRL(sourceBalance)}.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="withdrawal-note">Observação (opcional)</Label>
                <Textarea
                  id="withdrawal-note"
                  placeholder="Ex.: entrega em mãos no Parque 10"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <ReceiptUpload
                file={photo}
                onChange={setPhoto}
                required={false}
                label="Foto do comprovante de entrega"
              />
            </div>

            <DialogFooter>
              <Button className="w-full" disabled={!valid} onClick={() => setConfirming(true)}>
                Revisar retirada de {Number.isFinite(value) && value > 0 ? formatBRL(value) : "…"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
