import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ReceiptUpload } from "@/components/receipt-upload";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import {
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  expenseSchema,
  incomePhotoRequired,
  incomeSchema,
  parseAmount,
  uploadReceipt,
  type IncomeCategory,
  type PaymentMethod,
} from "@/lib/transactions";

type Props = {
  type: "income" | "expense" | null;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  unitId: string;
  userId: string;
};

export function TransactionDialog({ type, onOpenChange, shiftId, unitId, userId }: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<IncomeCategory | "">("");
  const [clientName, setClientName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isIncome = type === "income";
  const photoRequired = isIncome ? incomePhotoRequired(category, paymentMethod) : true;

  function reset() {
    setCategory("");
    setClientName("");
    setPaymentMethod("");
    setAmount("");
    setDescription("");
    setFile(null);
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const value = parseAmount(amount);

      if (isIncome) {
        const parsed = incomeSchema.safeParse({
          category,
          clientName,
          amount: value,
          paymentMethod,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
        if (incomePhotoRequired(parsed.data.category, parsed.data.paymentMethod) && !file) {
          throw new Error(
            "Foto obrigatória para assinaturas (nova/renovação) e para pagamentos via Pix.",
          );
        }

        const photoPath = file ? await uploadReceipt(file, unitId, shiftId) : null;
        const { error: insertError } = await supabase.from("transactions").insert({
          shift_id: shiftId,
          unit_id: unitId,
          user_id: userId,
          transaction_type: "income",
          category: parsed.data.category,
          client_name: parsed.data.clientName,
          payment_method: parsed.data.paymentMethod,
          amount: parsed.data.amount,
          photo_url: photoPath,
        });
        if (insertError) throw insertError;
        return parsed.data.amount;
      }

      const parsed = expenseSchema.safeParse({ amount: value, description });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      if (!file) throw new Error("A foto da nota fiscal é obrigatória para toda despesa.");

      const photoPath = await uploadReceipt(file, unitId, shiftId);
      const { error: insertError } = await supabase.from("transactions").insert({
        shift_id: shiftId,
        unit_id: unitId,
        user_id: userId,
        transaction_type: "expense",
        category: "Despesa",
        amount: parsed.data.amount,
        description: parsed.data.description,
        photo_url: photoPath,
      });
      if (insertError) throw insertError;
      return parsed.data.amount;
    },
    onSuccess: (value) => {
      toast.success(isIncome ? "Entrada registrada" : "Despesa registrada", {
        description: formatBRL(value),
      });
      void queryClient.invalidateQueries({ queryKey: ["shift-transactions", shiftId] });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const blocked = photoRequired && !file;

  return (
    <Dialog
      open={type !== null}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isIncome ? "Registrar Entrada" : "Registrar Despesa"}</DialogTitle>
          <DialogDescription>
            {isIncome
              ? "Registre uma venda ou assinatura do caixa aberto."
              : "Registre uma compra para a loja. A nota fiscal é obrigatória."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          {isIncome ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="tx-category">Categoria</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as IncomeCategory)}
                >
                  <SelectTrigger id="tx-category" className="h-12">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCOME_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-client">Nome e Sobrenome do Cliente</Label>
                <Input
                  id="tx-client"
                  className="h-12"
                  maxLength={120}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="João Souza"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-method">Forma de pagamento</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                >
                  <SelectTrigger id="tx-method" className="h-12">
                    <SelectValue placeholder="Selecione a forma de pagamento" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tx-amount">Valor (R$)</Label>
            <Input
              id="tx-amount"
              className="h-12 text-lg"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>

          {!isIncome ? (
            <div className="space-y-2">
              <Label htmlFor="tx-description">O que foi comprado?</Label>
              <Textarea
                id="tx-description"
                maxLength={500}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: café e água para a loja (supermercado)"
              />
            </div>
          ) : null}

          <ReceiptUpload
            file={file}
            onChange={setFile}
            required={photoRequired}
            label={isIncome ? "Foto do comprovante" : "Foto da nota fiscal"}
          />

          {isIncome && photoRequired ? (
            <p className="text-xs text-muted-foreground">
              Assinaturas (nova ou renovação) e pagamentos via Pix exigem comprovante.
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="h-12 w-full" disabled={blocked || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {blocked ? "Foto obrigatória" : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
