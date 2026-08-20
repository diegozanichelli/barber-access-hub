import { useMemo, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
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
  formatBRL,
  type CashQuantities,
} from "@/lib/cash";

const NOTE_COLORS: Record<string, string> = {
  notes_200: "from-slate-500 to-slate-700",
  notes_100: "from-cyan-600 to-cyan-800",
  notes_50: "from-amber-500 to-amber-700",
  notes_20: "from-yellow-500 to-orange-600",
  notes_10: "from-rose-500 to-rose-700",
  notes_5: "from-violet-500 to-violet-700",
  notes_2: "from-sky-500 to-sky-700",
};

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

  function changeQuantity(field: keyof CashQuantities, amount: number) {
    setConfirmZero(false);
    setQuantities((previous) => ({
      ...previous,
      [field]: Math.max(0, previous[field] + amount),
    }));
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-primary/30 bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total contado
          </p>
          <p className="text-2xl font-bold text-primary" aria-live="polite">
            {formatBRL(total)}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cédulas</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {DENOMINATIONS.filter((denomination) => denomination.field.startsWith("notes_")).map(
                (denomination) => (
                  <DenominationField
                    key={denomination.field}
                    denomination={denomination}
                    quantity={quantities[denomination.field]}
                    onChange={(raw) => setField(denomination.field, raw)}
                    onStep={(amount) => changeQuantity(denomination.field, amount)}
                  />
                ),
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Moedas</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {DENOMINATIONS.filter((denomination) => denomination.field.startsWith("coins_")).map(
                (denomination) => (
                  <DenominationField
                    key={denomination.field}
                    denomination={denomination}
                    quantity={quantities[denomination.field]}
                    onChange={(raw) => setField(denomination.field, raw)}
                    onStep={(amount) => changeQuantity(denomination.field, amount)}
                  />
                ),
              )}
            </div>
          </div>

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

type Denomination = (typeof DENOMINATIONS)[number];

function DenominationField({
  denomination,
  quantity,
  onChange,
  onStep,
}: {
  denomination: Denomination;
  quantity: number;
  onChange: (raw: string) => void;
  onStep: (amount: number) => void;
}) {
  const isNote = denomination.field.startsWith("notes_");
  const displayValue = denomination.value.toLocaleString("pt-BR", {
    minimumFractionDigits: denomination.value < 2 ? 2 : 0,
  });

  return (
    <div className="rounded-xl border border-border/70 bg-muted/15 p-3 transition-colors focus-within:border-primary/60">
      <div className="flex items-center gap-3">
        <div
          className={
            isNote
              ? `relative flex h-10 w-[4.75rem] shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/20 bg-gradient-to-br ${NOTE_COLORS[denomination.field]} text-sm font-black text-white shadow-sm`
              : "flex size-11 shrink-0 items-center justify-center rounded-full border-4 border-amber-300 bg-gradient-to-br from-amber-100 to-amber-500 text-[11px] font-black text-amber-950 shadow-sm"
          }
          aria-hidden
        >
          {isNote ? <span className="absolute inset-1 rounded border border-white/30" /> : null}
          <span className="relative">R$ {displayValue}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Label htmlFor={denomination.field} className="block truncate text-sm font-medium">
            {denomination.label}
          </Label>
          <p className="text-xs text-muted-foreground">
            Subtotal: {formatBRL(quantity * denomination.value)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[2.5rem_1fr_2.5rem] gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Diminuir ${denomination.label.toLowerCase()}`}
          disabled={quantity === 0}
          onClick={() => onStep(-1)}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <Input
          id={denomination.field}
          inputMode="numeric"
          className="h-10 text-center text-base font-semibold"
          value={quantity === 0 ? "" : String(quantity)}
          placeholder="0"
          aria-label={`Quantidade de ${denomination.label.toLowerCase()}`}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Adicionar ${denomination.label.toLowerCase()}`}
          onClick={() => onStep(1)}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
