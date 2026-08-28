-- Corrigir uma abertura errada e encerrar a divergência que a originou eram
-- duas ações separadas, e só a primeira existia na interface. O resultado é o
-- caso real do Parque 10: a supervisora digitou 235 no repasse quando havia
-- 215, o receive_handover marcou o turno anterior como 'disputed' e abriu o
-- novo com 235, o master corrigiu a abertura para 215 — e o alerta vermelho
-- ficou na tela para sempre, porque nada nunca mexia no status do turno
-- anterior.
--
-- A correção de abertura passa a encerrar essa divergência junto, gravando a
-- justificativa automaticamente. As contagens registradas continuam
-- intocadas: o que a supervisora contou na hora é histórico de auditoria, e
-- resolved_by/resolved_at/resolution_note registram quem encerrou e por quê.
CREATE OR REPLACE FUNCTION public.correct_opening_cash_count(
  _shift_id uuid,
  _quantities jsonb,
  _reason text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _count public.cash_counts%ROWTYPE;
  _status text;
  _unit uuid;
  _opened_at timestamptz;
  _disputed uuid;
  _total numeric := public.cash_quantities_total(_quantities);
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN
    RAISE EXCEPTION 'Somente o auditor pode corrigir uma abertura.';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres.';
  END IF;

  SELECT status, unit_id, opened_at INTO _status, _unit, _opened_at
  FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno não encontrado.'; END IF;
  IF _status <> 'open' THEN RAISE EXCEPTION 'Somente uma abertura ativa pode ser corrigida.'; END IF;

  SELECT * INTO _count
  FROM public.cash_counts
  WHERE shift_id = _shift_id AND count_type = 'opening'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contagem de abertura não encontrada.'; END IF;

  INSERT INTO public.cash_count_corrections (
    shift_id, cash_count_id, corrected_by, previous_total, corrected_total,
    previous_quantities, corrected_quantities, reason
  ) VALUES (
    _shift_id, _count.id, _uid, _count.total_calculated, _total,
    jsonb_build_object(
      'notes_200', _count.notes_200, 'notes_100', _count.notes_100,
      'notes_50', _count.notes_50, 'notes_20', _count.notes_20,
      'notes_10', _count.notes_10, 'notes_5', _count.notes_5,
      'notes_2', _count.notes_2, 'coins_1', _count.coins_1,
      'coins_050', _count.coins_050, 'coins_025', _count.coins_025,
      'coins_010', _count.coins_010, 'coins_005', _count.coins_005
    ),
    _quantities,
    btrim(_reason)
  );

  UPDATE public.cash_counts SET
    notes_200 = COALESCE((_quantities ->> 'notes_200')::integer, 0),
    notes_100 = COALESCE((_quantities ->> 'notes_100')::integer, 0),
    notes_50 = COALESCE((_quantities ->> 'notes_50')::integer, 0),
    notes_20 = COALESCE((_quantities ->> 'notes_20')::integer, 0),
    notes_10 = COALESCE((_quantities ->> 'notes_10')::integer, 0),
    notes_5 = COALESCE((_quantities ->> 'notes_5')::integer, 0),
    notes_2 = COALESCE((_quantities ->> 'notes_2')::integer, 0),
    coins_1 = COALESCE((_quantities ->> 'coins_1')::integer, 0),
    coins_050 = COALESCE((_quantities ->> 'coins_050')::integer, 0),
    coins_025 = COALESCE((_quantities ->> 'coins_025')::integer, 0),
    coins_010 = COALESCE((_quantities ->> 'coins_010')::integer, 0),
    coins_005 = COALESCE((_quantities ->> 'coins_005')::integer, 0),
    total_calculated = _total,
    notes = concat_ws(E'\n', NULLIF(notes, ''), 'Correção do auditor: ' || btrim(_reason))
  WHERE id = _count.id;

  UPDATE public.shifts SET actual_opening_total = _total WHERE id = _shift_id;

  -- A divergência que gerou esta abertura é a do turno da mesma unidade que
  -- foi fechado imediatamente antes dela. Só essa é encerrada — divergências
  -- antigas da unidade seguem abertas, porque não têm relação com a correção.
  SELECT s.id INTO _disputed
  FROM public.shifts s
  WHERE s.unit_id = _unit
    AND s.status = 'disputed'
    AND COALESCE(s.closed_at, s.opened_at) <= _opened_at
  ORDER BY COALESCE(s.closed_at, s.opened_at) DESC
  LIMIT 1;

  IF _disputed IS NOT NULL THEN
    UPDATE public.shifts SET
      status = 'closed',
      resolved_by = _uid,
      resolved_at = now(),
      -- to_char com ponto literal e replace para vírgula: independe do
      -- lc_numeric do servidor, que varia entre ambientes.
      resolution_note = format(
        'Abertura corrigida de R$ %s para R$ %s pelo master. Motivo: %s',
        replace(to_char(_count.total_calculated, 'FM999999990.00'), '.', ','),
        replace(to_char(_total, 'FM999999990.00'), '.', ','),
        btrim(_reason)
      )
    WHERE id = _disputed;
  END IF;

  RETURN _total;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_opening_cash_count(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_opening_cash_count(uuid, jsonb, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
