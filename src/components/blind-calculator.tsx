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
import {
  DENOMINATIONS,
  EMPTY_QUANTITIES,
  calculateTotal,
  type CashQuantities,
} from "@/lib/cash";

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

  const total = useMemo(() => calculateTotal(quantities), [quantities]);

  function setField(field: keyof CashQuantities, raw: string) {
    const parsed = Math.max(0, Math.floor(Number(raw.replace(/\D/g, "")) || 0));
    setQuantities((prev) => ({ ...prev, [field]: parsed }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuantities({ ...EMPTY_QUANTITIES });
          setNotes("");
        }
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
        </div>

        <DialogFooter>
          <Button
            className="w-full"
            disabled={submitting}
            onClick={() => onSubmit({ quantities, total, notes })}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
