import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/cash";
import { DATA_CORTE, FILIAL_NOME, hojeManaus } from "@/lib/ponte-caixa";
import { enviarCaixaBbh, previewCaixaBbh } from "@/lib/ponte-caixa.functions";

type Resumo = {
  qtd: number;
  totalEntradas: number;
  totalSaidas: number;
  porUnidade: { filial_id: string; entradas: number; saidas: number; qtd: number }[];
};

export function EnviarCaixaBbh() {
  const preview = useServerFn(previewCaixaBbh);
  const enviar = useServerFn(enviarCaixaBbh);
  const [de, setDe] = useState(DATA_CORTE);
  const [ate, setAte] = useState(hojeManaus());
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => preview({ data: { de, ate } }),
    onSuccess: (r) => setResumo(r as Resumo),
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarMutation = useMutation({
    mutationFn: () => enviar({ data: { de, ate } }),
    onSuccess: (r) => {
      const res = r as {
        enviados: number;
        resultado: { criados?: number; ignoradas_duplicadas?: number } | null;
      };
      const criados = res.resultado?.criados ?? 0;
      const dup = res.resultado?.ignoradas_duplicadas ?? 0;
      toast.success(
        res.enviados === 0
          ? "Nada a enviar no período."
          : `Enviado ao Business Hub: ${criados} lançamento(s) criado(s)${dup ? `, ${dup} já existiam` : ""}.`,
      );
      previewMutation.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = previewMutation.isPending || enviarMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar caixa ao Business Hub</CardTitle>
        <CardDescription>
          Envia as entradas e saídas das unidades sincronizadas para o DRE do Business Hub, sem
          redigitar. Sangria, cofre e depósitos não entram aqui (são transferências). O envio é
          idempotente: reenviar o mesmo período nunca duplica. A partir de {DATA_CORTE}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="de">De</Label>
            <Input
              id="de"
              type="date"
              min={DATA_CORTE}
              value={de}
              onChange={(e) => setDe(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ate">Até</Label>
            <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={pending}>
            Pré-visualizar
          </Button>
          <Button
            onClick={() => enviarMutation.mutate()}
            disabled={pending || !resumo || resumo.qtd === 0}
          >
            Enviar ao Business Hub
          </Button>
        </div>

        {resumo && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <strong>{resumo.qtd}</strong> lançamento(s)
              </span>
              <span className="text-emerald-600">
                Entradas <strong>{formatBRL(resumo.totalEntradas)}</strong>
              </span>
              <span className="text-rose-600">
                Saídas <strong>{formatBRL(resumo.totalSaidas)}</strong>
              </span>
            </div>

            {resumo.porUnidade.length > 0 && (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead className="text-right">Entradas</TableHead>
                      <TableHead className="text-right">Saídas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumo.porUnidade.map((u) => (
                      <TableRow key={u.filial_id}>
                        <TableCell>{FILIAL_NOME[u.filial_id] ?? u.filial_id}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.qtd}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(u.entradas)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(u.saidas)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {resumo.qtd === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum lançamento a enviar neste período.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
