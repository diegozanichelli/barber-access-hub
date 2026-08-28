import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { friendlyError } from "@/lib/errors";
import {
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  expenseSchema,
  incomePhotoRequired,
  incomeSchema,
  isMissingCategoryEnum,
  isMissingUpgradeEnum,
  isRoundAmount,
  parseAmount,
  safeDropSchema,
  uploadReceipt,
  UPGRADE_DESCRIPTION_MARKER,
  type IncomeCategory,
  type PaymentMethod,
} from "@/lib/transactions";

export type TransactionDialogType = "income" | "expense" | "safe_drop" | null;

type Props = {
  type: TransactionDialogType;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  unitId: string;
  userId: string;
};

type PaymentRow = { id: string; method: PaymentMethod | ""; amount: string };

function newRow(): PaymentRow {
  return { id: crypto.randomUUID(), method: "", amount: "" };
}

export function TransactionDialog({ type, onOpenChange, shiftId, unitId, userId }: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<IncomeCategory | "">("");
  const [clientName, setClientName] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([newRow()]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isIncome = type === "income";
  const isExpense = type === "expense";
  const isSafeDrop = type === "safe_drop";

  const parsedPayments = payments.map((p) => ({ ...p, value: parseAmount(p.amount) }));
  const splitTotal = parsedPayments.reduce(
    (sum, p) => sum + (Number.isFinite(p.value) ? p.value : 0),
    0,
  );
  const hasCash = payments.some((p) => p.method === "Dinheiro");
  const hasPix = payments.some((p) => p.method === "Pix");
  const photoRequired = isIncome ? hasPix : true;

  const expenseValue = parseAmount(amount);
  const showRoundWarning = isExpense && isRoundAmount(expenseValue);

  function reset() {
    setCategory("");
    setClientName("");
    setPayments([newRow()]);
    setAmount("");
    setDescription("");
    setFile(null);
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (isIncome) {
        const rows = parsedPayments.filter((p) => p.method !== "" || p.amount.trim() !== "");
        if (rows.length === 0) throw new Error("Informe ao menos uma forma de pagamento.");

        const methods = rows.map((p) => p.method);
        if (new Set(methods).size !== methods.length) {
          throw new Error(
            "Você repetiu a mesma forma de pagamento. Some os valores em uma única linha.",
          );
        }

        const parsedRows = rows.map((p) => {
          const parsed = incomeSchema.safeParse({
            category,
            clientName,
            amount: p.value,
            paymentMethod: p.method,
          });
          if (!parsed.success)
            throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
          return parsed.data;
        });

        if (photoRequired && !file) {
          throw new Error("O comprovante é obrigatório para pagamentos via Pix.");
        }

        const photoPath = file ? await uploadReceipt(file, unitId, shiftId) : null;
        const transactionRows = parsedRows.map((r) => ({
          shift_id: shiftId,
          unit_id: unitId,
          user_id: userId,
          transaction_type: "income",
          category: r.category,
          description: r.category === "Upgrade" ? UPGRADE_DESCRIPTION_MARKER : null,
          client_name: r.clientName,
          payment_method: r.paymentMethod,
          amount: r.amount,
          photo_url: photoPath,
        }));
        const { error: insertError } = await supabase.from("transactions").insert(transactionRows);
        if (insertError && category === "Upgrade" && isMissingUpgradeEnum(insertError)) {
          const { error: fallbackError } = await supabase.from("transactions").insert(
            transactionRows.map((row) => ({
              ...row,
              category: "Renovação" as const,
              description: UPGRADE_DESCRIPTION_MARKER,
            })),
          );
          if (fallbackError) throw fallbackError;
        } else if (insertError && isMissingCategoryEnum(insertError, "Serviços")) {
          throw new Error(
            "A categoria Serviços ainda não foi publicada no banco. Aplique as migrations pendentes e tente de novo.",
          );
        } else if (insertError) {
          throw insertError;
        }
        return parsedRows.reduce((s, r) => s + r.amount, 0);
      }

      if (isSafeDrop) {
        const parsed = safeDropSchema.safeParse({
          amount: expenseValue,
          description: description.trim() || undefined,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");

        const photoPath = file ? await uploadReceipt(file, unitId, shiftId) : null;
        const { error: insertError } = await supabase.from("transactions").insert({
          shift_id: shiftId,
          unit_id: unitId,
          user_id: userId,
          transaction_type: "expense",
          category: "Sangria",
          amount: parsed.data.amount,
          description: parsed.data.description ?? null,
          photo_url: photoPath,
        });
        if (insertError) throw insertError;
        return parsed.data.amount;
      }

      const parsed = expenseSchema.safeParse({ amount: expenseValue, description });
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
      toast.success(
        isIncome ? "Entrada registrada" : isSafeDrop ? "Sangria registrada" : "Despesa registrada",
        { description: formatBRL(value) },
      );
      void queryClient.invalidateQueries({ queryKey: ["shift-transactions", shiftId] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(friendlyError(err)),
  });

  const blocked = photoRequired && !file;

  const title = isIncome
    ? "Registrar Entrada"
    : isSafeDrop
      ? "Fazer Sangria (Cofre)"
      : "Registrar Despesa";

  const descriptionText = isIncome
    ? "Registre uma venda ou assinatura do caixa aberto. Aceita pagamento misto."
    : isSafeDrop
      ? "Retirada de dinheiro da gaveta para o cofre. Não é despesa da loja."
      : "Registre uma compra para a loja. A nota fiscal é obrigatória.";

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
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
                <Select value={category} onValueChange={(v) => setCategory(v as IncomeCategory)}>
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

              <div className="space-y-3">
                <Label>Formas de pagamento</Label>
                {payments.map((row, index) => (
                  <div key={row.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Pagamento {index + 1}
                      </span>
                      {payments.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover pagamento ${index + 1}`}
                          onClick={() => setPayments((prev) => prev.filter((p) => p.id !== row.id))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2">
                      <Select
                        value={row.method}
                        onValueChange={(v) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === row.id ? { ...p, method: v as PaymentMethod } : p,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          className="h-12"
                          aria-label={`Forma de pagamento ${index + 1}`}
                        >
                          <SelectValue placeholder="Forma de pagamento" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-12 text-lg"
                        inputMode="decimal"
                        aria-label={`Valor do pagamento ${index + 1}`}
                        value={row.amount}
                        onChange={(e) =>
                          setPayments((prev) =>
                            prev.map((p) =>
                              p.id === row.id ? { ...p, amount: e.target.value } : p,
                            ),
                          )
                        }
                        placeholder="0,00"
                      />
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full"
                  onClick={() => setPayments((prev) => [...prev, newRow()])}
                >
                  <Plus className="size-4" />
                  Adicionar outra forma de pagamento
                </Button>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Total do atendimento</span>
                  <span className="text-lg font-semibold text-primary">
                    {formatBRL(splitTotal)}
                  </span>
                </div>

                {hasCash ? (
                  <p className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                    🚨 ATENÇÃO: Digite aqui EXATAMENTE o valor em dinheiro que VAI FICAR NA GAVETA
                    física. Não misture dinheiro pessoal para troco.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
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
                {Number.isFinite(expenseValue) && expenseValue > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Valor que será registrado: {formatBRL(expenseValue)}
                  </p>
                ) : amount.trim() !== "" ? (
                  <p className="text-xs font-semibold text-destructive">
                    Valor inválido. Use vírgula para os centavos (ex: 37,97).
                  </p>
                ) : null}

                {showRoundWarning ? (
                  <p className="rounded-lg border border-warning/60 bg-warning/15 p-3 text-xs font-semibold text-warning-foreground">
                    ⚠️ Atenção: O valor é redondo mesmo? Digite os centavos exatos que estão no
                    comprovante fiscal (ex: 37,97).
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx-description">
                  {isSafeDrop ? "Identificação (opcional)" : "O que foi comprado?"}
                </Label>
                <Textarea
                  id="tx-description"
                  maxLength={isSafeDrop ? 200 : 500}
                  rows={isSafeDrop ? 2 : 3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isSafeDrop ? "Ex.: Malote 1" : "Ex.: café e água para a loja (supermercado)"
                  }
                />
              </div>
            </>
          )}

          <ReceiptUpload
            file={file}
            onChange={setFile}
            required={photoRequired}
            label={
              isSafeDrop
                ? "Foto do comprovante da retirada"
                : isIncome
                  ? "Foto do comprovante"
                  : "Foto da nota fiscal"
            }
          />

          {isIncome && photoRequired ? (
            <p className="text-xs text-muted-foreground">
              Pagamentos via Pix exigem comprovante. Nas demais modalidades a foto é opcional.
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
