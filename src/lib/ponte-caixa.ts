/**
 * Ponte Barber Access Hub (Caixa Grupo Roots) -> Business-Hub.
 *
 * O BAH é a fonte da verdade do caixa operacional. Este módulo traduz uma
 * `transaction` do BAH no `Movimento` que o BBH recebe (edge function
 * `caixa-import`). É puro e testável — sem React, sem banco, sem rede.
 *
 * Fase 1 (teste): envio opt-in, só as unidades mapeadas abaixo, só a partir da
 * DATA_CORTE, e só receita/despesa. Sangria/Troco e unidades fora do de-para
 * são ignoradas de propósito (sangria/cofre são transferências da Fase 2).
 */

export const EMPRESA_BBH = "0bd0c649-740d-4370-a727-1f5ef52475a1";

/** O caixa só é enviado a partir desta data (evita colidir com o que já foi
 * digitado à mão no BBH antes da virada para o BAH como fonte). */
export const DATA_CORTE = "2026-10-01";

/**
 * De-para unidade (BAH) -> filial (BBH). Só as unidades aqui sincronizam; as
 * demais (ex.: Basic - Cidade Nova) seguem 100% manuais no BBH.
 */
export const UNIDADE_FILIAL: Record<string, string> = {
  "03dfe076-e537-4473-8ca7-2123efc3704b": "a76992e5-dd3e-4e7a-887e-7db0b0032eba", // Adrianópolis
  "14f24788-1520-4083-af42-f3ec3ad111c1": "b11e1143-828a-4dff-83b9-4efa35535fd7", // Coronel Texeira
  "e909811d-33bb-4302-bdc8-0b014d3dde12": "2d2a4f31-1e41-40c1-8c2e-5ba8db06d19b", // Parque 10
  "936d1a86-cb78-4f16-ac8e-ffb7359f6c9a": "4ba32280-cf7d-4116-b59f-290ec9520642", // Ponta Negra
  // "704be1c6-...": Basic - Cidade Nova — fora da Fase 1 de propósito.
};

/** Nome legível da filial do BBH, só para exibir o resumo do envio. */
export const FILIAL_NOME: Record<string, string> = {
  "a76992e5-dd3e-4e7a-887e-7db0b0032eba": "Adrianópolis",
  "b11e1143-828a-4dff-83b9-4efa35535fd7": "Coronel Texeira",
  "2d2a4f31-1e41-40c1-8c2e-5ba8db06d19b": "Parque 10",
  "4ba32280-cf7d-4116-b59f-290ec9520642": "Ponta Negra",
};

export type CategoriaDestino = {
  tipo: "entrada" | "saida";
  categoria_id: string;
  categoria_nome: string;
};

/**
 * De-para categoria (BAH) -> categoria (BBH). O que não está aqui é ignorado:
 * `Sangria` (transferência, Fase 2) e `Troco` (não é receita).
 */
export const CATEGORIA_MAP: Record<string, CategoriaDestino> = {
  Renovação: {
    tipo: "entrada",
    categoria_id: "07c215e7-c019-42fd-a90d-ddca2a4932b9",
    categoria_nome: "Clube de Assinatura",
  },
  "Assinatura Nova": {
    tipo: "entrada",
    categoria_id: "07c215e7-c019-42fd-a90d-ddca2a4932b9",
    categoria_nome: "Clube de Assinatura",
  },
  Upgrade: {
    tipo: "entrada",
    categoria_id: "07c215e7-c019-42fd-a90d-ddca2a4932b9",
    categoria_nome: "Clube de Assinatura",
  },
  Serviços: {
    tipo: "entrada",
    categoria_id: "f7ecf7e3-3390-4246-83af-d9bb34d41036",
    categoria_nome: "Serviços Avulsos",
  },
  Bebida: {
    tipo: "entrada",
    categoria_id: "bd9c822e-6b88-4cc1-b8cc-d5f16badb3ae",
    categoria_nome: "Consumo/Bar",
  },
  Produtos: {
    tipo: "entrada",
    categoria_id: "9bfb88e6-0e0b-4f5b-9120-b9b33f88de56",
    categoria_nome: "Venda de Produtos",
  },
  // BAH só tem a categoria genérica "Despesa"; cai em "Outros" e pode ser
  // reclassificada no BBH depois.
  Despesa: {
    tipo: "saida",
    categoria_id: "29e3b10c-27f9-4857-a7ef-25419a076dca",
    categoria_nome: "Outros",
  },
};

/** De-para forma de pagamento (BAH) -> enum do BBH. */
export const FORMA_PAGAMENTO_MAP: Record<string, string> = {
  Dinheiro: "dinheiro",
  Pix: "pix",
  Débito: "debito",
  Crédito: "credito_vista",
  Cellcoins: "outros",
};

/** Uma transaction do BAH, reduzida ao que a ponte precisa. */
export type BahTransaction = {
  id: string;
  unit_id: string;
  transaction_type: string; // "income" | "expense"
  category: string;
  payment_method: string | null;
  amount: number | string;
  client_name: string | null;
  description: string | null;
  created_at: string; // ISO timestamp
  reversed_at: string | null;
  reverses_transaction_id: string | null;
};

/** O formato que a edge function `caixa-import` do BBH espera. */
export type Movimento = {
  origem_id: string;
  filial_id: string;
  data: string; // YYYY-MM-DD
  tipo: "entrada" | "saida";
  categoria_id: string | null;
  categoria_nome: string;
  valor: number;
  forma_pagamento: string | null;
  descricao: string;
};

const dataDoCaixa = (iso: string) => iso.slice(0, 10);

/**
 * Traduz uma transaction do BAH para um Movimento do BBH, ou `null` quando ela
 * não deve ir: estorno (ou linha estornada), unidade não mapeada, categoria
 * ignorada (Sangria/Troco/desconhecida), valor zero, ou antes da data de corte.
 */
export function mapMovimento(tx: BahTransaction): Movimento | null {
  // Estornos e linhas estornadas não vão — o envio leva só o caixa líquido.
  if (tx.reversed_at || tx.reverses_transaction_id) return null;

  const filial_id = UNIDADE_FILIAL[tx.unit_id];
  if (!filial_id) return null;

  const cat = CATEGORIA_MAP[tx.category];
  if (!cat) return null;

  const valor = Math.abs(Number(tx.amount) || 0);
  if (!valor) return null;

  const data = dataDoCaixa(tx.created_at);
  if (data < DATA_CORTE) return null;

  const forma = tx.payment_method ? (FORMA_PAGAMENTO_MAP[tx.payment_method] ?? "outros") : null;
  const descricao = [tx.category, tx.client_name?.trim() || null]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 500);

  return {
    origem_id: tx.id,
    filial_id,
    data,
    tipo: cat.tipo,
    categoria_id: cat.categoria_id,
    categoria_nome: cat.categoria_nome,
    valor,
    forma_pagamento: forma,
    descricao,
  };
}

export type ResumoEnvio = {
  movimentos: Movimento[];
  totalEntradas: number;
  totalSaidas: number;
  porUnidade: { filial_id: string; entradas: number; saidas: number; qtd: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Prepara o lote a enviar: mapeia, descarta os `null` e resume por unidade. */
export function prepararEnvio(transacoes: BahTransaction[]): ResumoEnvio {
  const movimentos = transacoes.map(mapMovimento).filter((m): m is Movimento => m !== null);

  const porFilial = new Map<string, { entradas: number; saidas: number; qtd: number }>();
  let totalEntradas = 0;
  let totalSaidas = 0;
  for (const m of movimentos) {
    const acc = porFilial.get(m.filial_id) ?? { entradas: 0, saidas: 0, qtd: 0 };
    acc.qtd += 1;
    if (m.tipo === "entrada") {
      acc.entradas += m.valor;
      totalEntradas += m.valor;
    } else {
      acc.saidas += m.valor;
      totalSaidas += m.valor;
    }
    porFilial.set(m.filial_id, acc);
  }

  return {
    movimentos,
    totalEntradas: round2(totalEntradas),
    totalSaidas: round2(totalSaidas),
    porUnidade: [...porFilial.entries()].map(([filial_id, v]) => ({
      filial_id,
      entradas: round2(v.entradas),
      saidas: round2(v.saidas),
      qtd: v.qtd,
    })),
  };
}
