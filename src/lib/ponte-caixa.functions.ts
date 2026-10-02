import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  prepararEnvio,
  EMPRESA_BBH,
  UNIDADE_FILIAL,
  type BahTransaction,
  type ResumoEnvio,
} from "@/lib/ponte-caixa";

const periodoSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Resposta da edge function `caixa-import` do BBH. */
type CaixaImportResult = {
  ok: boolean;
  criados: number;
  ignoradas_duplicadas: number;
  total_entradas: number;
  total_saidas: number;
  erros: string[];
};

/**
 * Carrega as transactions candidatas do período (unidades mapeadas, não
 * estornadas) e as prepara. O `prepararEnvio` ainda aplica categoria, data de
 * corte e valor — a query aqui só reduz o volume.
 */
async function carregarResumo(de: string, ate: string): Promise<ResumoEnvio> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const unitIds = Object.keys(UNIDADE_FILIAL);
  const inicio = `${de}T00:00:00.000Z`;
  const fim = `${ate}T23:59:59.999Z`;

  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select(
      "id, unit_id, transaction_type, category, payment_method, amount, client_name, description, created_at, reversed_at, reverses_transaction_id",
    )
    .in("unit_id", unitIds)
    .in("transaction_type", ["income", "expense"])
    .is("reversed_at", null)
    .is("reverses_transaction_id", null)
    .gte("created_at", inicio)
    .lte("created_at", fim)
    .order("created_at");
  if (error) throw error;

  return prepararEnvio((data ?? []) as unknown as BahTransaction[]);
}

/** Pré-visualiza o que iria para o BBH no período — somente leitura. */
export const previewCaixaBbh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => periodoSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isAuditor, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (roleError) throw roleError;
    if (!isAuditor) throw new Error("Somente o login master pode enviar o caixa ao Business Hub.");

    const resumo = await carregarResumo(data.de, data.ate);
    return {
      qtd: resumo.movimentos.length,
      totalEntradas: resumo.totalEntradas,
      totalSaidas: resumo.totalSaidas,
      porUnidade: resumo.porUnidade,
    };
  });

/** Envia o caixa do período ao BBH (edge function `caixa-import`). Idempotente. */
export const enviarCaixaBbh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => periodoSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { data: isAuditor, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "auditor",
    });
    if (roleError) throw roleError;
    if (!isAuditor) throw new Error("Somente o login master pode enviar o caixa ao Business Hub.");

    const key = process.env["PONTE_API_KEY"];
    const url = process.env["BBH_CAIXA_IMPORT_URL"];
    if (!key || !url) {
      throw new Error(
        "Ponte não configurada: defina PONTE_API_KEY e BBH_CAIXA_IMPORT_URL no ambiente do servidor.",
      );
    }

    const resumo = await carregarResumo(data.de, data.ate);
    if (resumo.movimentos.length === 0) {
      return { ok: true, enviados: 0, resultado: null as CaixaImportResult | null, resumo };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "x-ponte-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ empresa_id: EMPRESA_BBH, movimentos: resumo.movimentos }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Business-Hub respondeu ${res.status}: ${body.slice(0, 300)}`);
    }
    const resultado = (await res.json()) as CaixaImportResult;
    return { ok: true, enviados: resumo.movimentos.length, resultado, resumo };
  });
