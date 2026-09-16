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
  CHANGE_METHODS,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  allocateComandaRows,
  clientNameSchema,
  comandaItemSchema,
  comandaPaymentSchema,
  computeChange,
  expenseSchema,
  isMissingCategoryEnum,
  isMissingUpgradeEnum,
  isRoundAmount,
  parseAmount,
  safeDropSchema,
  uploadReceipt,
  UPGRADE_DESCRIPTION_MARKER,
  type ChangeMethod,
  type ComandaItem,
  type ComandaPayment,
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
type ItemRow = { id: string; category: IncomeCategory | ""; amount: string };

function newRow(): PaymentRow {
  return { id: crypto.randomUUID(), method: "", amount: "" };
}

function newItem(): ItemRow {
  return { id: crypto.randomUUID(), category: "", amount: "" };
}

export function TransactionDialog({ type, onOpenChange, shiftId, unitId, userId }: Props) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<ItemRow[]>([newItem()]);
  const [clientName, setClientName] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([newRow()]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [cashReceived, setCashReceived] = useState("");
  const [changeMethod, setChangeMethod] = useState<ChangeMethod>("Dinheiro");
  const [error, setError] = useState<string | null>(null);

  const isIncome = type === "income";
  const isExpense = type === "expense";
  const isSafeDrop = type === "safe_drop";

  const parsedItems = items.map((i) => ({ ...i, value: parseAmount(i.amount) }));
  const itemsTotal = parsedItems.reduce(
    (sum, i) => sum + (Number.isFinite(i.value) ? i.value : 0),
    0,
  );
  const hasValidItems = parsedItems.some(
    (i) => i.category !== "" && Number.isFinite(i.value) && i.value > 0,
  );

  const parsedPayments = payments.map((p) => ({ ...p, value: parseAmount(p.amount) }));
  const paidTotal = parsedPayments.reduce(
    (sum, p) => sum + (Number.isFinite(p.value) ? p.value : 0),
    0,
  );
  const hasCash = payments.some((p) => p.method === "Dinheiro");
  const hasPix = payments.some((p) => p.method === "Pix");
  const cashAmount = parsedPayments
    .filter((p) => p.method === "Dinheiro" && Number.isFinite(p.value))
    .reduce((sum, p) => sum + p.value, 0);
  const receivedValue = parseAmount(cashReceived);
  const changeValue = computeChange(receivedValue, cashAmount);
  const changeInvalid =
    isIncome &&
    hasCash &&
    cashReceived.trim() !== "" &&
    (!Number.isFinite(receivedValue) || receivedValue < cashAmount);
  const changeIsPix = isIncome && changeValue > 0 && changeMethod === "Pix";
  // O troco em Pix reaproveita o comprovante principal — sem segunda caixa de foto.
  const photoRequired = isIncome ? hasPix || changeIsPix : true;

  // O pagamento precisa fechar com o total da comanda (soma dos itens).
  const paymentsMatch = Math.abs(paidTotal - itemsTotal) < 0.005;
  const paymentDiff = Math.round((paidTotal - itemsTotal) * 100) / 100;

  const expenseValue = parseAmount(amount);
  const showRoundWarning = isExpense && isRoundAmount(expenseValue);

  function reset() {
    setItems([newItem()]);
    setClientName("");
    setPayments([newRow()]);
    setAmount("");
    setDescription("");
    setFile(null);
    setCashReceived("");
    setChangeMethod("Dinheiro");
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (isIncome) {
        const nameParsed = clientNameSchema.safeParse(clientName);
        if (!nameParsed.success) {
          throw new Error(nameParsed.error.issues[0]?.message ?? "Informe o nome do cliente.");
        }

        const filledItems = parsedItems.filter((i) => i.category !== "" || i.amount.trim() !== "");
        if (filledItems.length === 0) {
          throw new Error("Adicione ao menos um item à comanda.");
        }
        const validItems: ComandaItem[] = filledItems.map((i) => {
          if (i.category === "") throw new Error("Selecione a categoria de cada item.");
          const parsed = comandaItemSchema.safeParse({ category: i.category, amount: i.value });
          if (!parsed.success) {
            throw new Error(
              parsed.error.issues[0]?.message ?? "Informe um valor válido para o item.",
            );
          }
          return parsed.data;
        });

        const paymentRows = parsedPayments.filter((p) => p.method !== "" || p.amount.trim() !== "");
        if (paymentRows.length === 0) {
          throw new Error("Informe ao menos uma forma de pagamento.");
        }
        const methods = paymentRows.map((p) => p.method);
        if (new Set(methods).size !== methods.length) {
          throw new Error(
            "Você repetiu a mesma forma de pagamento. Some os valores em uma única linha.",
          );
        }
        const validPayments: ComandaPayment[] = paymentRows.map((p) => {
          if (p.method === "") throw new Error("Selecione a forma de cada pagamento.");
          const parsed = comandaPaymentSchema.safeParse({ method: p.method, amount: p.value });
          if (!parsed.success) {
            throw new Error(
              parsed.error.issues[0]?.message ?? "Informe um valor válido para o pagamento.",
            );
          }
          return parsed.data;
        });

        const itemsSum = validItems.reduce((s, i) => s + i.amount, 0);
        const paySum = validPayments.reduce((s, p) => s + p.amount, 0);
        if (Math.abs(itemsSum - paySum) >= 0.005) {
          throw new Error(
            `O pagamento (${formatBRL(paySum)}) não confere com o total da comanda (${formatBRL(itemsSum)}).`,
          );
        }

        if (photoRequired && !file) {
          throw new Error("O comprovante é obrigatório para pagamentos e trocos via Pix.");
        }

        const photoPath = file ? await uploadReceipt(file, unitId, shiftId) : null;
        const allocated = allocateComandaRows(validItems, validPayments);
        const transactionRows = allocated.map((r) => ({
          shift_id: shiftId,
          unit_id: unitId,
          user_id: userId,
          transaction_type: "income",
          category: r.category,
          description: r.category === "Upgrade" ? UPGRADE_DESCRIPTION_MARKER : null,
          client_name: nameParsed.data,
          payment_method: r.paymentMethod,
          amount: r.amount,
          photo_url: photoPath,
        }));

        const { error: insertError } = await supabase.from("transactions").insert(transactionRows);
        if (insertError) {
          const usesUpgrade = allocated.some((r) => r.category === "Upgrade");
          if (usesUpgrade && isMissingUpgradeEnum(insertError)) {
            // O banco ainda não tem o enum Upgrade: grava como Renovação com o
            // marcador, sem falsear as demais categorias.
            const fallbackRows = transactionRows.map((row) =>
              row.category === "Upgrade"
                ? {
                    ...row,
                    category: "Renovação" as const,
                    description: UPGRADE_DESCRIPTION_MARKER,
                  }
                : row,
            );
            const { error: fallbackError } = await supabase
              .from("transactions")
              .insert(fallbackRows);
            if (fallbackError) throw fallbackError;
          } else {
            const missing = (["Serviços", "Produtos"] as const).find(
              (c) =>
                allocated.some((r) => r.category === c) && isMissingCategoryEnum(insertError, c),
            );
            if (missing) {
              throw new Error(
                `A categoria ${missing} ainda não foi publicada no banco. Aplique as migrations pendentes e tente de novo.`,
              );
            }
            throw insertError;
          }
        }

        if (changeValue > 0) {
          const { error: changeError } = await supabase.from("transactions").insert({
            shift_id: shiftId,
            unit_id: unitId,
            user_id: userId,
            transaction_type: "expense",
            category: "Troco",
            payment_method: changeMethod,
            client_name: nameParsed.data,
            amount: changeValue,
            description: `Troco de ${formatBRL(changeValue)} (recebido ${formatBRL(receivedValue)} em dinheiro)`,
            // Troco em Pix reaproveita o comprovante principal já enviado acima.
            photo_url: changeMethod === "Pix" ? photoPath : null,
            // O troco por Pix é uma saída da conta, não uma entrada a conferir.
            pix_status: "paid",
          });
          if (changeError) throw changeError;
        }
        return itemsSum;
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
        isIncome ? "Comanda registrada" : isSafeDrop ? "Sangria registrada" : "Despesa registrada",
        { description: formatBRL(value) },
      );
      void queryClient.invalidateQueries({ queryKey: ["shift-transactions", shiftId] });
      void queryClient.invalidateQueries({ queryKey: ["auditor-data"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(friendlyError(err)),
  });

  const incomeBlocked =
    isIncome && ((photoRequired && !file) || changeInvalid || !hasValidItems || !paymentsMatch);
  const blocked = isIncome ? incomeBlocked : photoRequired && !file;

  const saveLabel = !isIncome
    ? blocked
      ? "Foto obrigatória"
      : "Salvar"
    : !hasValidItems
      ? "Adicione um item"
      : !paymentsMatch
        ? "Pagamento não confere"
        : changeInvalid
          ? "Confira o troco"
          : photoRequired && !file
            ? "Foto obrigatória"
            : "Salvar comanda";

  const title = isIncome
    ? "Registrar Entrada"
    : isSafeDrop
      ? "Fazer Sangria (Cofre)"
      : "Registrar Despesa";

  const descriptionText = isIncome
    ? "Registre a comanda do cliente no caixa aberto. Vários itens e pagamento misto são aceitos."
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
                <div className="flex items-baseline justify-between">
                  <Label>Itens da comanda</Label>
                  <span className="text-xs text-muted-foreground">
                    {items.length === 1 ? "1 item" : `${items.length} itens`}
                  </span>
                </div>
                {items.map((row, index) => (
                  <div key={row.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Item {index + 1}
                      </span>
                      {items.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover item ${index + 1}`}
                          onClick={() => setItems((prev) => prev.filter((i) => i.id !== row.id))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2">
                      <Select
                        value={row.category}
                        onValueChange={(v) =>
                          setItems((prev) =>
                            prev.map((i) =>
                              i.id === row.id ? { ...i, category: v as IncomeCategory } : i,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          className="h-12"
                          aria-label={`Categoria do item ${index + 1}`}
                        >
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
                      <Input
                        className="h-12 text-lg"
                        inputMode="decimal"
                        aria-label={`Valor do item ${index + 1}`}
                        value={row.amount}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((i) =>
                              i.id === row.id ? { ...i, amount: e.target.value } : i,
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
                  onClick={() => setItems((prev) => [...prev, newItem()])}
                >
                  <Plus className="size-4" />
                  Adicionar item
                </Button>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Total da comanda</span>
                  <span className="text-lg font-semibold text-primary">
                    {formatBRL(itemsTotal)}
                  </span>
                </div>
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
                  <span className="text-sm text-muted-foreground">Pago</span>
                  {itemsTotal > 0 && paymentsMatch ? (
                    <span className="text-sm font-semibold text-primary">
                      ✓ confere · {formatBRL(paidTotal)}
                    </span>
                  ) : itemsTotal > 0 && paymentDiff < 0 ? (
                    <span className="text-sm font-semibold text-destructive">
                      faltam {formatBRL(-paymentDiff)}
                    </span>
                  ) : itemsTotal > 0 && paymentDiff > 0 ? (
                    <span className="text-sm font-semibold text-destructive">
                      sobram {formatBRL(paymentDiff)}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold">{formatBRL(paidTotal)}</span>
                  )}
                </div>

                {hasCash ? (
                  <>
                    <p className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                      🚨 ATENÇÃO: No valor do pagamento em dinheiro digite EXATAMENTE o que entra no
                      caixa. Se o cliente pagou com nota maior, informe abaixo quanto ele entregou.
                    </p>

                    <div className="space-y-2 rounded-lg border border-border/60 p-3">
                      <Label htmlFor="tx-received">
                        Quanto o cliente entregou em dinheiro? (opcional)
                      </Label>
                      <Input
                        id="tx-received"
                        className="h-12 text-lg"
                        inputMode="decimal"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        placeholder="0,00"
                      />
                      {changeInvalid ? (
                        <p className="text-xs font-semibold text-destructive">
                          O valor entregue não pode ser menor que {formatBRL(cashAmount)}.
                        </p>
                      ) : changeValue > 0 ? (
                        <>
                          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                            <span className="text-sm text-muted-foreground">Troco a devolver</span>
                            <span className="text-lg font-semibold">{formatBRL(changeValue)}</span>
                          </div>
                          <Label htmlFor="tx-change-method">Como o troco foi devolvido?</Label>
                          <Select
                            value={changeMethod}
                            onValueChange={(v) => setChangeMethod(v as ChangeMethod)}
                          >
                            <SelectTrigger id="tx-change-method" className="h-12">
                              <SelectValue placeholder="Forma do troco" />
                            </SelectTrigger>
                            <SelectContent>
                              {CHANGE_METHODS.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {changeMethod === "Pix"
                              ? "Anexe abaixo o comprovante do Pix do troco (obrigatório) — é a mesma foto do comprovante da venda."
                              : "O troco em dinheiro sai da gaveta: fica registrado, mas o saldo esperado continua o valor da venda."}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </>
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
            {saveLabel}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
