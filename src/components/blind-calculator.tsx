import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DENOMINATIONS, EMPTY_QUANTITIES, calculateTotal, type CashQuantities } from "@/lib/cash";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (payload: { quantities: CashQuantities; total: number; notes: string }) => void;
};

export function BlindCalculator({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submitting,
  onSubmit,
}: Props) {
  const [quantities, setQuantities] = useState<CashQuantities>({ ...EMPTY_QUANTITIES });
  const [notes, setNotes] = useState("");
  const [confirmZero, setConfirmZero] = useState(false);

  const total = useMemo(() => calculateTotal(quantities), [quantities]);
  const isZero = total === 0;

  function setField(field: keyof CashQuantities, raw: string) {
    const parsed = Math.max(0, Math.floor(Number(raw.replace(/\D/g, "")) || 0));
    setConfirmZero(false);
    setQuantities((prev) => ({ ...prev, [field]: parsed }));
  }

  function reset() {
    setQuantities({ ...EMPTY_QUANTITIES });
    setNotes("");
    setConfirmZero(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {DENOMINATIONS.map((d) => (
            <div key={d.field} className="flex items-center justify-between gap-3">
              <Label htmlFor={d.field} className="text-sm font-normal">
                Quantas {d.label.toLowerCase()}?
              </Label>
              <Input
                id={d.field}
                inputMode="numeric"
                className="w-20 text-center"
                value={quantities[d.field] === 0 ? "" : String(quantities[d.field])}
                placeholder="0"
                onChange={(e) => setField(d.field, e.target.value)}
              />
            </div>
          ))}

          <div className="space-y-2 pt-2">
            <Label htmlFor="cash-notes" className="text-sm font-normal">
              Observações (opcional)
            </Label>
            <Textarea
              id="cash-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {isZero && confirmZero ? (
            <p className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              Você não preencheu nenhuma quantidade. Isso registra a contagem como R$ 0,00. Toque
              novamente para confirmar que a gaveta está realmente vazia.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            className="w-full"
            disabled={submitting}
            onClick={() => {
              if (isZero && !confirmZero) {
                setConfirmZero(true);
                return;
              }
              onSubmit({ quantities, total, notes });
            }}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {isZero && confirmZero ? "Confirmar caixa vazio (R$ 0,00)" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
