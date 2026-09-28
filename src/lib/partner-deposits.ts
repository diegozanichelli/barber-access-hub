import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/** Saldo de um sócio (geral, todas as unidades). Vem de partner_cash_balances(). */
export type PartnerBalance = {
  partner_id: string;
  full_name: string;
  /** Em posse: retiradas confirmadas menos o que já foi depositado. */
  held: number;
  /** Aguardando confirmação do sócio (retiradas ainda pendentes). */
  waiting: number;
};

export const depositSchema = z.object({
  amount: z.number().positive("Informe um valor maior que zero").max(1_000_000),
  note: z.string().trim().max(300).optional(),
});

/**
 * O depósito não pode passar do que o sócio tem em posse. Aceita parcial e
 * tolera arredondamento de centavo. Um saldo zero/negativo não permite depósito.
 */
export function canDepositAmount(amount: number, held: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (held <= 0) return false;
  return amount <= held + 0.005;
}

/** Rótulo de quem registrou: o próprio sócio ou um admin/auditor. */
export function depositAuthorLabel(createdBy: string, partnerId: string): string {
  return createdBy === partnerId ? "pelo próprio sócio" : "por um administrador";
}

/** Comprovante do depósito vai para deposits/<partner_id>/arquivo no bucket receipts. */
export async function uploadDepositReceipt(file: File, partnerId: string): Promise<string> {
  const ext =
    (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `deposits/${partnerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}
