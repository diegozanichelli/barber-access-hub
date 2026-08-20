import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const INCOME_CATEGORIES = ["Bebida", "Assinatura Nova", "Renovação"] as const;
export const PAYMENT_METHODS = ["Pix", "Crédito", "Débito", "Dinheiro", "Cellcoins"] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const incomeSchema = z.object({
  category: z.enum(INCOME_CATEGORIES),
  clientName: z.string().trim().min(3, "Informe nome e sobrenome do cliente").max(120),
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
  paymentMethod: z.enum(PAYMENT_METHODS),
});

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
