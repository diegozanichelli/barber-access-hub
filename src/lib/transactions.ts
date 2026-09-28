import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const INCOME_CATEGORIES = [
  "Bebida",
  "Produtos",
  "Assinatura Nova",
  "Renovação",
  "Upgrade",
] as const;
export const PAYMENT_METHODS = ["Pix", "Crédito", "Débito", "Dinheiro", "Cellcoins"] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Compatibility marker for databases whose enum has not received Upgrade yet. */
export const UPGRADE_DESCRIPTION_MARKER = "__upgrade__";
export const PRODUCTS_DESCRIPTION_MARKER = "__products__";

export function displayedIncomeCategory(category: string, description: string | null): string {
  if (description === UPGRADE_DESCRIPTION_MARKER) return "Upgrade";
  if (description === PRODUCTS_DESCRIPTION_MARKER) return "Produtos";
  return category;
}

export function isMissingIncomeCategoryEnum(
  error: { message?: string } | null,
  category: "Upgrade" | "Produtos",
): boolean {
  return Boolean(
    error?.message?.includes("invalid input value for enum transaction_category") &&
    error.message.includes(category),
  );
}

export const incomeSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  clientName: z.string().trim().min(3, "Informe nome e sobrenome do cliente").max(120),
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
  paymentMethod: z.enum(PAYMENT_METHODS),
});

/** Nome do cliente de uma comanda (usado uma vez para todos os itens). */
export const clientNameSchema = z
  .string()
  .trim()
  .min(3, "Informe nome e sobrenome do cliente")
  .max(120);

/** Um item da comanda: uma categoria e um valor. */
export const comandaItemSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
});

/** Uma forma de pagamento da comanda: um método e um valor. */
export const comandaPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
});

export type ComandaItem = z.infer<typeof comandaItemSchema>;
export type ComandaPayment = z.infer<typeof comandaPaymentSchema>;
export type AllocatedRow = {
  category: IncomeCategory;
  paymentMethod: PaymentMethod;
  amount: number;
};

/**
 * A comanda tem duas dimensões independentes: itens (cada um com sua categoria)
 * e formas de pagamento (cada uma com seu valor). Uma transação, porém, guarda
 * uma categoria e um método por linha. Esta função reconcilia as duas: distribui
 * o valor de cada item entre as formas de pagamento, em ordem, gerando as linhas
 * a gravar.
 *
 * O resultado preserva os dois totais que o sistema realmente usa — soma por
 * categoria (relatório de vendas) e soma por método, inclusive Dinheiro
 * (conferência do caixa). O pareamento categoria↔método de uma linha específica
 * é arbitrário quando há pagamento misto, mas os agregados ficam exatos.
 *
 * Trabalha em centavos inteiros para não acumular erro de ponto flutuante.
 * Pressupõe que a soma dos itens é igual à soma dos pagamentos (validado antes).
 */
export function allocateComandaRows(
  items: ComandaItem[],
  payments: ComandaPayment[],
): AllocatedRow[] {
  const pending = payments.map((p) => ({
    method: p.method,
    cents: Math.round(p.amount * 100),
  }));
  const rows: AllocatedRow[] = [];
  let p = 0;

  for (const item of items) {
    let remaining = Math.round(item.amount * 100);
    while (remaining > 0 && p < pending.length) {
      if (pending[p]!.cents <= 0) {
        p += 1;
        continue;
      }
      const take = Math.min(remaining, pending[p]!.cents);
      rows.push({
        category: item.category,
        paymentMethod: pending[p]!.method,
        amount: take / 100,
      });
      remaining -= take;
      pending[p]!.cents -= take;
    }
  }

  return rows;
}

export const expenseSchema = z.object({
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
  description: z.string().trim().min(3, "Descreva o que foi comprado").max(500),
});

export const safeDropSchema = z.object({
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
  description: z.string().trim().max(200).optional(),
});

/** For incoming payments, proof is mandatory only for Pix. */
export function incomePhotoRequired(_category: string, paymentMethod: string): boolean {
  return paymentMethod === "Pix";
}

/** True when the amount has no cents (e.g. 38,00) — likely an incorrect rounding. */
export function isRoundAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Math.round(value * 100) % 100 === 0;
}

/**
 * Aceita "1.234,56", "1234,56", "1234.56" e "1.500".
 * O ponto só é tratado como separador de milhar quando vem seguido de 3 dígitos.
 */
export function parseAmount(raw: string): number {
  let s = (raw ?? "").replace(/\s|R\$/gi, "");
  if (!s) return NaN;

  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = s.split(".");
    if (parts.length > 1) {
      const last = parts[parts.length - 1] ?? "";
      // "1.500" ou "1.234.567" → milhares; "12.5" / "12.50" → decimal
      s = last.length === 3 ? parts.join("") : parts.slice(0, -1).join("") + "." + last;
    }
  }

  const value = Number(s);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

export async function uploadReceipt(file: File, unitId: string, shiftId: string): Promise<string> {
  const ext =
    (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${unitId}/${shiftId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getReceiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Formas possíveis de devolver o troco ao cliente. */
export const CHANGE_METHODS = ["Dinheiro", "Pix"] as const;
export type ChangeMethod = (typeof CHANGE_METHODS)[number];

/**
 * Troco = o que o cliente entregou em espécie menos o valor da venda pago em
 * dinheiro. Valores inválidos ou sem sobra resultam em 0.
 */
export function computeChange(received: number, cashAmount: number): number {
  if (!Number.isFinite(received) || !Number.isFinite(cashAmount)) return 0;
  const diff = Math.round((received - cashAmount) * 100) / 100;
  return diff > 0 ? diff : 0;
}
