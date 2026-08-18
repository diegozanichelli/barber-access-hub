import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuditorReferences, type TransactionRow } from "@/hooks/use-auditor-data";

const ALL = "__all__";
const CATEGORIES = ["Bebida", "Assinatura Nova", "Renovação", "Despesa", "Sangria"];
const PAGE_SIZE = 25;

export function AuditFeed() {
  const { data: references } = useAuditorReferences();
  const [unitId, setUnitId] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [unitId, type, category, order]);

  const { data: pageData, isLoading } = useQuery({
    queryKey: ["audit-transactions", page, unitId, type, category, order],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: order === "asc" })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (unitId !== ALL) query = query.eq("unit_id", unitId);
      if (type !== ALL) query = query.eq("transaction_type", type);
      if (category !== ALL) query = query.eq("category", category as TransactionRow["category"]);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as TransactionRow[], count: count ?? 0 };
    },
  });
  const rows = pageData?.rows ?? [];
  const count = pageData?.count ?? 0;

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
        references?.unitNames[t.unit_id] ?? "",
        t.transaction_type === "income"
          ? "Entrada"
          : t.category === "Sangria"
            ? "Sangria (cofre)"
            : "Despesa",
        t.category,
        t.client_name ?? "",
        t.payment_method ?? "",
        Number(t.amount).toFixed(2).replace(".", ","),
        t.description ?? "",
        references?.names[t.user_id] ?? "",
        t.photo_url ? "Sim" : "Não",
      ]),
    );
    downloadCSV(`lancamentos-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (isLoading || !references) {
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
          Exportar página CSV
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger aria-label="Filtrar por unidade">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {references.units.map((u) => (
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
            <SelectItem value="expense">Somente saídas</SelectItem>
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
            const safeDrop = t.category === "Sangria";
            return (
              <li key={t.id} className="flex items-start gap-3 py-4">
                <ReceiptThumb
                  path={t.photo_url}
                  alt={`Comprovante · ${t.category} · ${formatBRL(t.amount)}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 truncate font-medium">
                      {safeDrop ? (
                        <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
                          Sangria · Cofre
                        </span>
                      ) : null}
                      <span className="truncate">
                        {t.category}
                        {t.client_name ? ` · ${t.client_name}` : ""}
                      </span>
                    </p>
                    <span
                      className={`shrink-0 font-semibold ${income ? "text-primary" : safeDrop ? "text-warning" : "text-destructive"}`}
                    >
                      {income ? "+" : "-"}
                      {formatBRL(t.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {references.unitNames[t.unit_id] ?? "Unidade"} ·{" "}
                    {t.payment_method ?? (safeDrop ? "Transferência para o cofre" : "Despesa")} ·{" "}
                    {references.names[t.user_id] ?? "Usuário"} ·{" "}
                    {new Date(t.created_at).toLocaleString("pt-BR")}
                  </p>
                  {t.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                  ) : null}
                  {!t.photo_url && !safeDrop ? (
                    <p className="mt-1 text-xs font-semibold text-destructive">Sem comprovante</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground">
          {count === 0
            ? "0 resultados"
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} de ${count}`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={(page + 1) * PAGE_SIZE >= count}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
