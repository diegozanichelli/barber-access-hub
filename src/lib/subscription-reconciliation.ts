export interface ExternalSubscription {
  client: string;
  branch: string | null;
  amount: number;
  date: string | null; // YYYY-MM-DD
  time: string | null;
}

export interface CashSubscription {
  id: string;
  client_name: string | null;
  amount: number;
  unit_id: string;
  category: string;
  created_at: string;
}

export type ReconciliationStatus = "matched" | "amount_mismatch" | "missing_in_cash" | "extra_in_cash";

export interface ReconciliationRow {
  status: ReconciliationStatus;
  external: ExternalSubscription | null;
  cash: CashSubscription | null;
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseBRLNumber(value: string): number | null {
  const clean = value.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNA(v: string | undefined) {
  return !v || v.toUpperCase() === "N/A";
}

export function parseSubscriptionCSV(text: string): ExternalSubscription[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = parseCSVLine(lines[0]!).map(normalizeName);
  const idx = (pred: (h: string) => boolean) => header.findIndex(pred);
  const iClient = idx((h) => h === "cliente");
  const iBranch = idx((h) => h === "filial");
  const iValue = idx((h) => h.startsWith("valor"));
  const iDate = idx((h) => h.startsWith("data"));
  const iId = idx((h) => h.startsWith("id"));
  if (iClient < 0 || iValue < 0) {
    throw new Error("Arquivo inválido: não encontrei as colunas Cliente e Valor.");
  }
  const rows: ExternalSubscription[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line);
    if (iId >= 0 && normalizeName(cols[iId] ?? "").startsWith("totalizado")) continue;
    const client = cols[iClient] ?? "";
    const amount = parseBRLNumber(cols[iValue] ?? "");
    if (!client || amount === null) continue;
    let date: string | null = null;
    let time: string | null = null;
    const m = (cols[iDate] ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/);
    if (m) {
      date = `${m[3]}-${m[2]}-${m[1]}`;
      time = m[4] ?? null;
    }
    const branch = iBranch >= 0 && !isNA(cols[iBranch]) ? cols[iBranch]! : null;
    rows.push({ client, branch, amount, date, time });
  }
  return rows;
}

export function reconcile(
  external: ExternalSubscription[],
  cash: CashSubscription[],
): ReconciliationRow[] {
  const remaining = [...cash];
  const result: ReconciliationRow[] = [];
  const pending: ExternalSubscription[] = [];

  const take = (pred: (c: CashSubscription) => boolean) => {
    const i = remaining.findIndex(pred);
    return i >= 0 ? remaining.splice(i, 1)[0]! : null;
  };

  // pass 1: exact name + amount
  for (const ext of external) {
    const n = normalizeName(ext.client);
    const hit = take(
      (c) => normalizeName(c.client_name ?? "") === n && Math.abs(c.amount - ext.amount) < 0.005,
    );
    if (hit) result.push({ status: "matched", external: ext, cash: hit });
    else pending.push(ext);
  }
  // pass 2: same name, different amount
  for (const ext of pending) {
    const n = normalizeName(ext.client);
    const hit = take((c) => normalizeName(c.client_name ?? "") === n);
    result.push(
      hit
        ? { status: "amount_mismatch", external: ext, cash: hit }
        : { status: "missing_in_cash", external: ext, cash: null },
    );
  }
  for (const c of remaining) result.push({ status: "extra_in_cash", external: null, cash: c });
  return result;
}
