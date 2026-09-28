CREATE OR REPLACE FUNCTION public.unit_expected_opening_total_v2(_unit_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _last_shift public.shifts%ROWTYPE;
  _deleted_cash_effect numeric := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN
    RAISE EXCEPTION 'Cadastro não aprovado.';
  END IF;
  IF NOT (public.current_unit_id() = _unit_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  SELECT s.* INTO _last_shift
  FROM public.shifts s
  WHERE s.unit_id = _unit_id
    AND s.status = 'closed'
    AND s.closing_total IS NOT NULL
  ORDER BY s.closed_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN r.transaction_snapshot->>'transaction_type' = 'income'
        AND r.transaction_snapshot->>'payment_method' = 'Dinheiro'
        THEN (r.transaction_snapshot->>'amount')::numeric
      WHEN r.transaction_snapshot->>'transaction_type' <> 'income'
        THEN -(r.transaction_snapshot->>'amount')::numeric
      ELSE 0
    END
  ), 0)
  INTO _deleted_cash_effect
  FROM public.transaction_change_requests r
  JOIN public.shifts source_shift
    ON source_shift.id::text = r.transaction_snapshot->>'shift_id'
  WHERE source_shift.unit_id = _unit_id
    AND source_shift.closed_at <= _last_shift.closed_at
    AND r.action = 'delete'
    AND r.status = 'approved'
    AND r.decided_at >= _last_shift.opened_at
    AND r.transaction_snapshot->>'reversed_at' IS NULL
    AND r.transaction_snapshot->>'reverses_transaction_id' IS NULL;

  RETURN ROUND(COALESCE(_last_shift.closing_total, 0) - _deleted_cash_effect, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.unit_expected_opening_total(_unit_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.unit_expected_opening_total_v2(_unit_id);
$$;

REVOKE ALL ON FUNCTION public.unit_expected_opening_total_v2(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unit_expected_opening_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unit_expected_opening_total_v2(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unit_expected_opening_total(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_shift(_unit_id uuid, _quantities jsonb, _notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _expected numeric;
  _shift uuid;
  _total numeric := public.cash_total(_quantities);
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;
  IF NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF NOT (public.current_unit_id() = _unit_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit_id AND s.status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit_id AND s.status = 'pending_handover') THEN
    RAISE EXCEPTION 'Há um turno aguardando repasse. Receba o turno pendente.';
  END IF;

  _expected := public.unit_expected_opening_total(_unit_id);

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit_id, _uid, COALESCE(_expected, 0), _total, 'open')
  RETURNING id INTO _shift;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005, total_calculated, notes
  ) VALUES (
    _shift, 'opening', _uid,
    COALESCE((_quantities->>'notes_200')::int,0), COALESCE((_quantities->>'notes_100')::int,0),
    COALESCE((_quantities->>'notes_50')::int,0), COALESCE((_quantities->>'notes_20')::int,0),
    COALESCE((_quantities->>'notes_10')::int,0), COALESCE((_quantities->>'notes_5')::int,0),
    COALESCE((_quantities->>'notes_2')::int,0), COALESCE((_quantities->>'coins_1')::int,0),
    COALESCE((_quantities->>'coins_050')::int,0), COALESCE((_quantities->>'coins_025')::int,0),
    COALESCE((_quantities->>'coins_010')::int,0), COALESCE((_quantities->>'coins_005')::int,0),
    _total, NULLIF(btrim(COALESCE(_notes,'')), '')
  );
  RETURN _shift;
END; $function$;

NOTIFY pgrst, 'reload schema';