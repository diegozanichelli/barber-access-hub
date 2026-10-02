import { useMemo, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuditorReferences } from "@/hooks/use-auditor-data";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/cash";
import { friendlyError } from "@/lib/errors";
import {
  normalizeName,
  parseSubscriptionCSV,
  reconcile,
  type CashSubscription,
  type ExternalSubscription,
  type ReconciliationRow,
  type ReconciliationStatus,
} from "@/lib/subscription-reconciliation";

const SUB_CATEGORIES = ["Assinatura Nova", "Renovação", "Upgrade"] as const;

const STATUS: Record<ReconciliationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  matched: { label: "Conciliado", variant: "secondary" },
  amount_mismatch: { label: "Valor diferente", variant: "outline" },
  missing_in_cash: { label: "Faltando no caixa", variant: "destructive" },
  extra_in_cash: { label: "Lançado sem correspondência", variant: "outline" },
};

type Filter = "all" | "issues" | "matched";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SubscriptionReconciliation() {
  const { data: refs } = useAuditorReferences();
  const units = refs?.units ?? [];
  const [unitId, setUnitId] = useState("");
  const [date, setDate] = useState(today());
  const [external, setExternal] = useState<ExternalSubscription[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("issues");

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseSubscriptionCSV(await file.text());
      if (parsed.length === 0) throw new Error("Nenhuma assinatura encontrada no arquivo.");
      setExternal(parsed);
      setFileName(file.name);
      setRows(null);
      const first = parsed.find((r) => r.date)?.date;
      if (first) setDate(first);
      const branch = parsed.find((r) => r.branch)?.branch;
      if (branch) {
        const u = units.find((x) => normalizeName(x.name) === normalizeName(branch));
        if (u) setUnitId(u.id);
      }
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function run() {
    if (!external) return toast.error("Importe o arquivo CSV primeiro.");
    if (!unitId) return toast.error("Selecione a unidade.");
    setLoading(true);
    try {
      const ext = external.filter((r) => !r.date || r.date === date);
      const { data, error } = await supabase
        .from("transactions")
        .select("id, client_name, amount, unit_id, category, description, created_at")
        .eq("transaction_type", "income")
        .eq("unit_id", unitId)
        .in("category", [...SUB_CATEGORIES])
        .is("reversed_at", null)
        .gte("created_at", `${date}T00:00:00-04:00`)
        .lte("created_at", `${date}T23:59:59.999-04:00`);
      if (error) throw error;
      setRows(reconcile(ext, (data ?? []) as CashSubscription[]));
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    if (!rows) return null;
    const ext = rows.reduce((s, r) => s + (r.external?.amount ?? 0), 0);
    const cash = rows.reduce((s, r) => s + (r.cash?.amount ?? 0), 0);
    const matched = rows.filter((r) => r.status === "matched").length;
    const extCount = rows.filter((r) => r.external).length;
    return { ext, cash, diff: cash - ext, rate: extCount ? Math.round((matched / extCount) * 100) : 0 };
  }, [rows]);

  const visible = (rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "matched" ? r.status === "matched" : r.status !== "matched",
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">Conciliação de assinaturas</h2>
        <p className="text-sm text-muted-foreground">
          Importe o relatório CSV de assinaturas e compare com o que foi lançado no caixa (por cliente e valor).
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Arquivo CSV</Label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <Upload className="h-4 w-4" />
              <span className="truncate">{fileName || "Selecionar arquivo"}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <div className="space-y-1">
            <Label>Unidade</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={run} disabled={loading || !external}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Conferir assinaturas
            </Button>
          </div>
        </div>
        {external && (
          <p className="mt-2 text-xs text-muted-foreground">
            {external.length} assinaturas no arquivo · {formatBRL(external.reduce((s, r) => s + r.amount, 0))}
          </p>
        )}
      </div>

      {totals && (
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Total no relatório", formatBRL(totals.ext)],
            ["Total no caixa", formatBRL(totals.cash)],
            ["Diferença", formatBRL(totals.diff)],
            ["Conciliação", `${totals.rate}%`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className="text-xl font-semibold">{v}</p>
            </div>
          ))}
        </div>
      )}

      {rows && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex gap-2">
            {(["issues", "matched", "all"] as Filter[]).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "issues" ? "Divergências" : f === "matched" ? "Conciliados" : "Todos"}
              </Button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada para mostrar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2">Status</th>
                    <th>Cliente (relatório)</th>
                    <th>Valor relatório</th>
                    <th>Cliente (caixa)</th>
                    <th>Valor caixa</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2"><Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge></td>
                      <td>{r.external ? `${r.external.client}${r.external.time ? ` · ${r.external.time}` : ""}` : "—"}</td>
                      <td>{r.external ? formatBRL(r.external.amount) : "—"}</td>
                      <td>{r.cash ? `${r.cash.client_name ?? "(sem nome)"} · ${r.cash.category}` : "—"}</td>
                      <td>{r.cash ? formatBRL(r.cash.amount) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
