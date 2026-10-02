import { describe, expect, test } from "bun:test";
import { parseSubscriptionCSV, reconcile } from "./subscription-reconciliation";

const CSV = `\uFEFF"ID da comanda","Filial","Profissional","Cliente","Tipo","Pagamento externo","Valor comanda fechada / assinatura","Data e hora"
"N/A","N/A","N/A","Romulo Matos","Assinatura","Não","59,90","01/10/2026 18:09"
"N/A","N/A","N/A","Apollo Barreto","Assinatura","Não","119,90","01/10/2026 16:25"
"N/A","N/A","N/A","Anibal Algusto","Assinatura","Não","147,00","01/10/2026 14:27"
"Totalizado assinatura","","","","","","","1.060,30"`;

describe("subscription reconciliation", () => {
  test("parses PT-BR CSV and skips total row", () => {
    const rows = parseSubscriptionCSV(CSV);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ client: "Romulo Matos", branch: null, amount: 59.9, date: "2026-10-01", time: "18:09" });
  });

  test("classifies rows", () => {
    const ext = parseSubscriptionCSV(CSV);
    const base = { unit_id: "u", category: "Renovação", created_at: "" };
    const res = reconcile(ext, [
      { ...base, id: "1", client_name: "rômulo  matos", amount: 59.9 },
      { ...base, id: "2", client_name: "Apollo Barreto", amount: 100 },
      { ...base, id: "3", client_name: "Fulano", amount: 50 },
    ]);
    const s = res.map((r) => r.status).sort();
    expect(s).toEqual(["amount_mismatch", "extra_in_cash", "matched", "missing_in_cash"]);
  });
});
