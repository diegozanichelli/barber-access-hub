import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Clock3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { enablePushNotifications, inspectPushSupport } from "@/lib/push-notifications";

const DEFAULT_HOURS = 10;

/**
 * Avisa que o turno passou do tempo e oferece ativar o lembrete no celular.
 *
 * Esta é a camada que não depende de nada: mesmo sem push configurado, sem
 * permissão ou sem service worker, quem abrir o app vê o aviso. O push cobre
 * quem já foi embora; este banner cobre quem ainda está com a tela aberta.
 */
export function ShiftReminderBanner({ openedAt, userId }: { openedAt: string; userId: string }) {
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const { data: thresholdHours = DEFAULT_HOURS } = useQuery({
    queryKey: ["shift-reminder-threshold"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "shift_reminder_after_hours")
        .maybeSingle();
      // Sem a linha (migration ainda não aplicada) o padrão vale; o aviso não
      // deve sumir por causa de configuração ausente.
      if (error) return DEFAULT_HOURS;
      return Number(data?.value ?? DEFAULT_HOURS);
    },
  });

  const hoursOpen = (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hoursOpen) || hoursOpen < thresholdHours) return null;

  const support = inspectPushSupport();
  const alreadyGranted = support.supported && support.permission === "granted";

  async function handleEnable() {
    setEnabling(true);
    try {
      await enablePushNotifications(userId);
      setEnabled(true);
      toast.success("Lembretes ativados neste aparelho", {
        description: "Você será avisado quando um caixa ficar aberto tempo demais.",
      });
    } catch (error) {
      toast.error("Não foi possível ativar os lembretes", {
        description: friendlyError(error),
      });
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div
      role="alert"
      className="rounded-xl border border-warning/60 bg-warning/15 p-4 text-warning-foreground"
    >
      <div className="flex items-start gap-2">
        <Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">
            Este caixa está aberto há {Math.floor(hoursOpen)} horas.
          </p>
          <p className="mt-1 text-xs leading-snug opacity-90">
            Faça o fechamento e o repasse. Enquanto o turno continua aberto, as vendas de hoje são
            registradas no turno de ontem, e a conferência dos dois dias deixa de fechar.
          </p>

          {enabled || alreadyGranted ? (
            <p className="mt-2 text-xs font-medium opacity-90">
              Lembretes ativados neste aparelho.
            </p>
          ) : support.supported ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              disabled={enabling}
              onClick={() => void handleEnable()}
            >
              {enabling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Avisar no meu celular
            </Button>
          ) : (
            <p className="mt-2 text-xs opacity-80">{support.reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
