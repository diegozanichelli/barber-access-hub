import { AlertTriangle } from "lucide-react";
import { formatBRL } from "@/lib/cash";

export function CashLimitBanner({ runningCash }: { runningCash: number }) {
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 -mx-4 mb-2 border-b border-destructive/60 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-sm font-semibold leading-snug">
          ⚠️ Limite de Segurança Excedido (Caixa &gt; R$ 1.000). Realizar Sangria imediatamente.
          <span className="mt-0.5 block text-xs font-normal opacity-90">
            Caixa atual: {formatBRL(runningCash)}
          </span>
        </p>
      </div>
    </div>
  );
}
