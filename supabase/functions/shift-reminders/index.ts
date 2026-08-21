/*
 * Envia lembrete de fechamento para turnos esquecidos em aberto.
 *
 * Roda no agendador (pg_cron), não a pedido do usuário. Usa a service role,
 * então ignora RLS de propósito: precisa ler inscrições de push de outras
 * pessoas para poder avisá-las.
 *
 * Só envia aviso. Não altera turno, lançamento nem valor nenhum.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type StaleShift = {
  shift_id: string;
  unit_id: string;
  unit_name: string;
  opened_by: string;
  opened_at: string;
  hours_open: number;
  reminders_sent: number;
  last_reminder_at: string | null;
};

type Subscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
// Precisa ser mailto: ou uma URL — é o contato que o serviço de push usa se
// houver problema com os envios.
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

function hoursLabel(hours: number): string {
  const rounded = Math.floor(hours);
  return rounded === 1 ? "1 hora" : `${rounded} horas`;
}

Deno.serve(async (request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return Response.json({ error: "Supabase não configurado." }, { status: 500 });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return Response.json(
      { error: "VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY não configuradas." },
      { status: 500 },
    );
  }

  // O agendador chama com a service role no Authorization; qualquer outra
  // origem não deve conseguir disparar notificações para a rede toda.
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [{ data: stale, error: staleError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase.rpc("stale_open_shifts"),
      supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["shift_reminder_repeat_hours", "shift_reminder_max_count"]),
    ]);
  if (staleError) return Response.json({ error: staleError.message }, { status: 500 });
  if (settingsError) return Response.json({ error: settingsError.message }, { status: 500 });

  const setting = (key: string, fallback: number) =>
    Number((settings ?? []).find((row) => row.key === key)?.value ?? fallback);
  const repeatHours = setting("shift_reminder_repeat_hours", 4);
  const maxCount = setting("shift_reminder_max_count", 3);

  const due = ((stale ?? []) as StaleShift[]).filter((shift) => {
    if (shift.reminders_sent >= maxCount) return false;
    if (!shift.last_reminder_at) return true;
    const elapsedHours = (Date.now() - new Date(shift.last_reminder_at).getTime()) / 3_600_000;
    return elapsedHours >= repeatHours;
  });

  let notified = 0;
  const gone: string[] = [];

  for (const shift of due) {
    // Quem abriu o turno, mais os supervisores e o atendente daquela unidade:
    // se quem abriu já foi embora, alguém presente ainda recebe.
    const { data: unitProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id")
      .eq("unit_id", shift.unit_id)
      .eq("status", "approved");
    if (profilesError) continue;

    const targets = new Set<string>([shift.opened_by, ...(unitProfiles ?? []).map((p) => p.id)]);
    const { data: subscriptions, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", [...targets]);
    if (subsError) continue;

    const payload = JSON.stringify({
      title: `Caixa aberto há ${hoursLabel(shift.hours_open)}`,
      body: `${shift.unit_name}: faça o fechamento e o repasse do caixa. Enquanto o turno fica aberto, as vendas de hoje entram no turno de ontem.`,
      tag: `shift-${shift.shift_id}`,
      url: "/",
    });

    let sentForShift = 0;
    for (const sub of (subscriptions ?? []) as Subscription[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sentForShift += 1;
        notified += 1;
      } catch (error) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada).
        // Guardar para apagar, senão o job tenta para sempre.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(sub.id);
      }
    }

    if (sentForShift > 0) {
      await supabase
        .from("shift_reminders")
        .insert({ shift_id: shift.shift_id, recipients: sentForShift });
    }
  }

  if (gone.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", gone);
  }

  return Response.json({
    stale: (stale ?? []).length,
    due: due.length,
    notified,
    removedSubscriptions: gone.length,
  });
});
