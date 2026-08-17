import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const INCOME_CATEGORIES = ["Bebida", "Assinatura Nova", "Renovação"] as const;
export const PAYMENT_METHODS = ["Pix", "Crédito", "Débito", "Dinheiro"] as const;

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

/** Photo is mandatory for subscriptions (new/renewal) and for every Pix payment. */
export function incomePhotoRequired(category: string, paymentMethod: string): boolean {
  return category === "Assinatura Nova" || category === "Renovação" || paymentMethod === "Pix";
}

export function parseAmount(raw: string): number {
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

export async function uploadReceipt(file: File, unitId: string, shiftId: string): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
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
