import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  attempts: number;
  submitting?: boolean;
  onRecount: () => void;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export function DivergenceRecountDialog({
  open,
  attempts,
  submitting,
  onRecount,
  onConfirm,
  onCancel,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const validReason = reason.trim().length >= 10;

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setReason("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onCancel()}>
      <DialogContent className="border-destructive/70 sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="size-6" aria-hidden />
          </div>
          <DialogTitle className="text-destructive">A contagem não confere</DialogTitle>
          <DialogDescription>
            Conte novamente todas as cédulas e moedas. Por segurança, o valor esperado e a diferença
            não são exibidos durante a contagem cega.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong>Tentativa {attempts}</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            Nenhum valor foi gravado. Você pode recontar quantas vezes precisar.
          </p>
        </div>

        {confirming ? (
          <div className="space-y-2">
            <Label htmlFor="divergence-reason">Justificativa obrigatória</Label>
            <Textarea
              id="divergence-reason"
              autoFocus
              maxLength={350}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explique por que a contagem divergente deve ser confirmada…"
            />
            <p
              className={validReason ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
            >
              Mínimo de 10 caracteres · {reason.trim().length}/350
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={submitting} onClick={onRecount}>
            <RefreshCw /> Recontar o dinheiro
          </Button>
          {confirming ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!validReason || submitting}
              onClick={() => onConfirm(reason.trim())}
            >
              Confirmar divergência
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={submitting}
              onClick={() => setConfirming(true)}
            >
              Confirmar mesmo assim
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
