-- Lembrete de fechamento e repasse para turnos esquecidos em aberto.
--
-- O problema: quando ninguém fecha o caixa, o turno continua aberto e os
-- lançamentos do dia seguinte caem nele, porque a RLS aceita (o turno está
-- 'open') e o índice único impede abrir outro. Ninguém percebe até a
-- conferência não bater — e aí os dois dias já estão misturados.
--
-- Nada aqui bloqueia lançamento nem altera valor: é só aviso.

-- 1. Parâmetros ajustáveis sem deploy -----------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

DROP POLICY IF EXISTS app_settings_read ON public.app_settings;
CREATE POLICY app_settings_read ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

INSERT INTO public.app_settings (key, value, description) VALUES
  ('shift_reminder_after_hours', 10,
   'Horas de turno aberto antes do primeiro lembrete de fechamento.'),
  ('shift_reminder_repeat_hours', 4,
   'Intervalo mínimo entre lembretes do mesmo turno.'),
  ('shift_reminder_max_count', 3,
   'Quantos lembretes no máximo por turno, para não virar spam.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_setting(_key text, _fallback numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT s.value FROM public.app_settings s WHERE s.key = _key), _fallback);
$$;

-- 2. Inscrições de push por usuário -------------------------------------------
-- Um usuário pode ter vários dispositivos; o endpoint identifica cada um.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
-- UPDATE é necessário porque reinscrever o mesmo aparelho faz upsert por
-- endpoint em vez de duplicar linha.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- Cada um enxerga e mexe apenas nas próprias inscrições. O envio é feito pelo
-- service_role, que ignora RLS.
DROP POLICY IF EXISTS push_subscriptions_own_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_insert ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_approved(auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_own_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_approved(auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_own_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 3. Registro do que já foi enviado -------------------------------------------
-- Sem isto o job reenviaria o mesmo lembrete a cada execução.
CREATE TABLE IF NOT EXISTS public.shift_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipients integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS shift_reminders_shift ON public.shift_reminders (shift_id, sent_at DESC);

ALTER TABLE public.shift_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shift_reminders TO authenticated;
GRANT ALL ON public.shift_reminders TO service_role;

DROP POLICY IF EXISTS shift_reminders_auditor_select ON public.shift_reminders;
CREATE POLICY shift_reminders_auditor_select ON public.shift_reminders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'auditor'));

-- 4. Quais turnos estão vencidos ----------------------------------------------
-- Usada tanto pelo job de envio quanto pela tela, para que aviso na tela e
-- lembrete no celular concordem sobre o que é "vencido".
CREATE OR REPLACE FUNCTION public.stale_open_shifts()
RETURNS TABLE (
  shift_id uuid,
  unit_id uuid,
  unit_name text,
  opened_by uuid,
  opened_at timestamptz,
  hours_open numeric,
  reminders_sent integer,
  last_reminder_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    s.id,
    s.unit_id,
    u.name,
    s.opened_by,
    s.opened_at,
    ROUND(EXTRACT(EPOCH FROM (now() - s.opened_at)) / 3600.0, 2),
    (SELECT COUNT(*)::integer FROM public.shift_reminders r WHERE r.shift_id = s.id),
    (SELECT MAX(r.sent_at) FROM public.shift_reminders r WHERE r.shift_id = s.id)
  FROM public.shifts s
  JOIN public.units u ON u.id = s.unit_id
  WHERE s.status = 'open'
    AND s.opened_at <= now() - make_interval(
      hours => public.app_setting('shift_reminder_after_hours', 10)::integer
    )
  ORDER BY s.opened_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.app_setting(text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stale_open_shifts() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
