import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptThumb } from "@/components/receipt-thumb";
import { formatBRL } from "@/lib/cash";
import { downloadCSV, toCSV } from "@/lib/csv";
import { useAuditorData } from "@/hooks/use-auditor-data";

const ALL = "__all__";
const CATEGORIES = ["Bebida", "Assinatura Nova", "Renovação", "Despesa"];

export function AuditFeed() {
  const { data, isLoading } = useAuditorData();
  const [unitId, setUnitId] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [order, setOrder] = useState<"desc" | "asc">("desc");

  const rows = useMemo(() => {
    const list = (data?.transactions ?? []).filter(
      (t) =>
        (unitId === ALL || t.unit_id === unitId) &&
        (type === ALL || t.transaction_type === type) &&
        (category === ALL || t.category === category),
    );
    return [...list].sort((a, b) =>
      order === "desc"
        ? b.created_at.localeCompare(a.created_at)
        : a.created_at.localeCompare(b.created_at),
    );
  }, [data, unitId, type, category, order]);

  function handleExport() {
    const csv = toCSV(
      [
        "Data",
        "Unidade",
        "Tipo",
        "Categoria",
        "Cliente",
        "Pagamento",
        "Valor",
        "Descrição",
        "Registrado por",
        "Comprovante",
      ],
      rows.map((t) => [
        new Date(t.created_at).toLocaleString("pt-BR"),
        data?.unitNames[t.unit_id] ?? "",
        t.transaction_type === "income" ? "Entrada" : "Despesa",
        t.category,
        t.client_name ?? "",
        t.payment_method ?? "",
        Number(t.amount).toFixed(2).replace(".", ","),
        t.description ?? "",
        data?.names[t.user_id] ?? "",
        t.photo_url ? "Sim" : "Não",
      ]),
    );
    downloadCSV(`lancamentos-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (isLoading || !data) {
    return (
      <section className="surface-panel flex justify-center p-5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg">Feed de lançamentos e provas</h2>
        <Button size="sm" variant="secondary" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="size-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger aria-label="Filtrar por unidade">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {data.units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Filtrar por tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Entradas e despesas</SelectItem>
            <SelectItem value="income">Somente entradas</SelectItem>
            <SelectItem value="expense">Somente despesas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Filtrar por categoria">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={order} onValueChange={(v) => setOrder(v as "desc" | "asc")}>
          <SelectTrigger aria-label="Ordenar por data">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Mais recentes primeiro</SelectItem>
            <SelectItem value="asc">Mais antigos primeiro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {rows.map((t) => {
            const income = t.transaction_type === "income";
            return (
              <li key={t.id} className="flex items-start gap-3 py-4">
                <ReceiptThumb
                  path={t.photo_url}
                  alt={`Comprovante · ${t.category} · ${formatBRL(t.amount)}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-medium">
                      {t.category}
                      {t.client_name ? ` · ${t.client_name}` : ""}
                    </p>
                    <span
                      className={`shrink-0 font-semibold ${income ? "text-primary" : "text-destructive"}`}
                    >
                      {income ? "+" : "-"}
                      {formatBRL(t.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {data.unitNames[t.unit_id] ?? "Unidade"} · {t.payment_method ?? "Despesa"} ·{" "}
                    {data.names[t.user_id] ?? "Usuário"} ·{" "}
                    {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                  {t.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                  ) : null}
                  {!t.photo_url ? (
                    <p className="mt-1 text-xs font-semibold text-destructive">Sem comprovante</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
