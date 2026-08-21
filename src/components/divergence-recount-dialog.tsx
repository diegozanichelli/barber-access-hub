import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIN_JUSTIFICATION = 10;

type Props = {
  open: boolean;
  attempts: number;
  submitting?: boolean;
  onRecount: () => void;
  onConfirm: (justification: string) => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * Alerta de divergência exibido ANTES de gravar a contagem.
 * Nenhum valor é revelado: a contagem segue cega, o operador só sabe que não bate.
 */
export function DivergenceRecountDialog({
  open,
  attempts,
  submitting,
  onRecount,
  onConfirm,
  onOpenChange,
}: Props) {
  const [justifying, setJustifying] = useState(false);
  const [justification, setJustification] = useState("");

  function reset() {
    setJustifying(false);
    setJustification("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-6 shrink-0" aria-hidden />
            <DialogTitle className="text-destructive">
              A contagem não confere com o esperado
            </DialogTitle>
          </div>
          <DialogDescription>
            Reconte o dinheiro com calma, cédula por cédula e moeda por moeda. Na maioria das vezes é
            só um erro simples de contagem.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Por segurança, o sistema não mostra o valor esperado nem a diferença. Nada foi gravado
          ainda.
          {attempts > 1 ? (
            <span className="mt-1 block text-xs font-semibold">
              Tentativas de contagem até agora: {attempts}
            </span>
          ) : null}
        </div>

        {justifying ? (
          <div className="space-y-2">
            <Label htmlFor="divergence-justification">
              Justificativa da diferença (obrigatória)
            </Label>
            <Textarea
              id="divergence-justification"
              rows={3}
              placeholder="Ex.: recontei três vezes e continua faltando; possível troco entregue a mais."
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Mínimo de {MIN_JUSTIFICATION} caracteres. A auditoria será notificada com esta
              justificativa.
            </p>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Button
            className="min-h-12 w-full"
            disabled={submitting}
            onClick={() => {
              reset();
              onRecount();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            Recontar o dinheiro
          </Button>
          <Button
            variant="destructive"
            className="min-h-12 w-full"
            disabled={
              submitting || (justifying && justification.trim().length < MIN_JUSTIFICATION)
            }
            onClick={() => {
              if (!justifying) {
                setJustifying(true);
                return;
              }
              onConfirm(justification.trim());
            }}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {justifying ? "Registrar divergência e continuar" : "Confirmar mesmo assim"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
