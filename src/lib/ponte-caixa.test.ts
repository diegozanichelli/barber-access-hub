import { describe, expect, test } from "bun:test";
import { mapMovimento, prepararEnvio, type BahTransaction, type Movimento } from "./ponte-caixa";

const base: BahTransaction = {
  id: "11111111-1111-4111-8111-111111111111",
  unit_id: "936d1a86-cb78-4f16-ac8e-ffb7359f6c9a", // Ponta Negra
  transaction_type: "income",
  category: "Serviços",
  payment_method: "Pix",
  amount: 50,
  client_name: "Fulano de Tal",
  description: null,
  created_at: "2026-10-05T13:00:00Z",
  reversed_at: null,
  reverses_transaction_id: null,
};

const exigir = (m: Movimento | null): Movimento => {
  if (!m) throw new Error("esperava um movimento, veio null");
  return m;
};

describe("mapMovimento", () => {
  test("mapeia receita com unidade→filial, categoria→BBH e forma de pagamento", () => {
    const m = exigir(mapMovimento(base));
    expect(m.filial_id).toBe("4ba32280-cf7d-4116-b59f-290ec9520642");
    expect(m.tipo).toBe("entrada");
    expect(m.categoria_nome).toBe("Serviços Avulsos");
    expect(m.forma_pagamento).toBe("pix");
    expect(m.valor).toBe(50);
    expect(m.data).toBe("2026-10-05");
    expect(m.descricao).toBe("Serviços — Fulano de Tal");
  });

  test("despesa vira saída na categoria Outros", () => {
    const m = exigir(mapMovimento({ ...base, transaction_type: "expense", category: "Despesa" }));
    expect(m.tipo).toBe("saida");
    expect(m.categoria_nome).toBe("Outros");
  });

  test("ignora Sangria e Troco (não são receita/despesa)", () => {
    expect(mapMovimento({ ...base, category: "Sangria" })).toBe(null);
    expect(mapMovimento({ ...base, category: "Troco" })).toBe(null);
  });

  test("ignora unidade fora do de-para (ex.: Basic - Cidade Nova)", () => {
    expect(mapMovimento({ ...base, unit_id: "704be1c6-3bd9-40c0-82e7-810b392f8d62" })).toBe(null);
  });

  test("ignora estorno e linha estornada", () => {
    expect(mapMovimento({ ...base, reversed_at: "2026-10-06T00:00:00Z" })).toBe(null);
    expect(
      mapMovimento({ ...base, reverses_transaction_id: "22222222-2222-4222-8222-222222222222" }),
    ).toBe(null);
  });

  test("ignora lançamentos antes da data de corte", () => {
    expect(mapMovimento({ ...base, created_at: "2026-09-30T23:00:00Z" })).toBe(null);
    expect(mapMovimento({ ...base, created_at: "2026-10-01T08:00:00Z" }) !== null).toBe(true);
  });

  test("valor zero não vai", () => {
    expect(mapMovimento({ ...base, amount: 0 })).toBe(null);
  });
});

describe("prepararEnvio", () => {
  test("mapeia o lote, descarta o que não vai e resume por unidade", () => {
    const coronel = "14f24788-1520-4083-af42-f3ec3ad111c1";
    const r = prepararEnvio([
      base, // PN entrada 50
      { ...base, id: "aaaaaaaa-1111-4111-8111-111111111111", amount: 30, category: "Bebida" }, // PN entrada 30
      {
        ...base,
        id: "bbbbbbbb-1111-4111-8111-111111111111",
        unit_id: coronel,
        transaction_type: "expense",
        category: "Despesa",
        amount: 20,
      }, // Coronel saída 20
      { ...base, id: "cccccccc-1111-4111-8111-111111111111", category: "Sangria" }, // ignorado
    ]);
    expect(r.movimentos.length).toBe(3);
    expect(r.totalEntradas).toBe(80);
    expect(r.totalSaidas).toBe(20);
    const pn = r.porUnidade.find((u) => u.filial_id === "4ba32280-cf7d-4116-b59f-290ec9520642");
    expect(pn !== undefined).toBe(true);
    expect(pn?.entradas).toBe(80);
    expect(pn?.saidas).toBe(0);
    expect(pn?.qtd).toBe(2);
  });
});
