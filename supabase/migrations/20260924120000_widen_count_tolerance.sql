-- Tolerância de contagem: aceita diferença de até R$ 0,05 sem acusar divergência.
--
-- A menor moeda é R$ 0,05, então o valor contado é sempre múltiplo de 0,05 e
-- nunca bate exatamente um esperado em centavos quebrados (ex.: 203,76). O limite
-- anterior (< 0,005) travava o fechamento por 1 centavo de arredondamento. Uma
-- folga de 5 centavos absorve isso sem deixar passar diferença que importe.
--
-- Espelha public.COUNT_TOLERANCE no cliente (src/lib/cash.ts). Mudou aqui, mude lá.
--
-- Pontos ajustados:
--   * check_shift_cash_count  -> pré-checagem do fechamento (contagem cega)
--   * receive_handover        -> marca 'disputed' no repasse entre turnos
-- close_shift e open_shift apenas gravam os números; não decidem divergência.

CREATE OR REPLACE FUNCTION public.check_shift_cash_count(_shift_id uuid, _quantities jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _status text;
  _counted numeric;
  _expected numeric;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente.';
  END IF;

  SELECT s.unit_id, s.status
    INTO _unit, _status
    FROM public.shifts s
   WHERE s.id = _shift_id;

  IF _unit IS NULL OR _status <> 'open' THEN
    RAISE EXCEPTION 'Este turno não está disponível para conferência.';
  END IF;

  IF NOT (
    (public.current_unit_id() = _unit AND public.is_approved(_uid))
    OR public.has_role(_uid, 'auditor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Você não tem permissão para conferir este caixa.';
  END IF;

  _counted := ROUND(
    COALESCE((_quantities->>'notes_200')::int, 0) * 200
    + COALESCE((_quantities->>'notes_100')::int, 0) * 100
    + COALESCE((_quantities->>'notes_50')::int, 0) * 50
    + COALESCE((_quantities->>'notes_20')::int, 0) * 20
    + COALESCE((_quantities->>'notes_10')::int, 0) * 10
    + COALESCE((_quantities->>'notes_5')::int, 0) * 5
    + COALESCE((_quantities->>'notes_2')::int, 0) * 2
    + COALESCE((_quantities->>'coins_1')::int, 0)
    + COALESCE((_quantities->>'coins_050')::int, 0) * 0.50
    + COALESCE((_quantities->>'coins_025')::int, 0) * 0.25
    + COALESCE((_quantities->>'coins_010')::int, 0) * 0.10
    + COALESCE((_quantities->>'coins_005')::int, 0) * 0.05,
    2
  );

  SELECT ROUND(
    s.actual_opening_total
    + COALESCE(SUM(CASE
        WHEN t.transaction_type = 'income' AND t.payment_method = 'Dinheiro' THEN t.amount
        WHEN t.transaction_type = 'income' THEN 0
        WHEN t.category::text = 'Troco' AND t.payment_method = 'Pix' THEN t.amount
        WHEN t.category::text = 'Troco' THEN 0
        ELSE -t.amount
      END) FILTER (
        WHERE t.reverses_transaction_id IS NULL
          AND t.reversed_at IS NULL
      ), 0),
    2
  )
    INTO _expected
    FROM public.shifts s
    LEFT JOIN public.transactions t ON t.shift_id = s.id
   WHERE s.id = _shift_id
   GROUP BY s.actual_opening_total;

  RETURN ROUND(ABS(_counted - _expected), 2) <= 0.05;
END;
$$;

REVOKE ALL ON FUNCTION public.check_shift_cash_count(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_shift_cash_count(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_handover(_pending_shift_id uuid, _quantities jsonb, _notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _expected numeric;
  _matches boolean;
  _new_shift uuid;
  _total numeric := public.cash_total(_quantities);
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;

  SELECT s.unit_id, COALESCE(s.closing_total, 0) INTO _unit, _expected
  FROM public.shifts s WHERE s.id = _pending_shift_id AND s.status = 'pending_handover' FOR UPDATE;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Este repasse já foi recebido. Atualize a tela.'; END IF;
  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit AND s.status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;

  _matches := ROUND(abs(_expected - _total), 2) <= 0.05;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005, total_calculated, notes
  ) VALUES (
    _pending_shift_id, 'handover', _uid,
    COALESCE((_quantities->>'notes_200')::int,0), COALESCE((_quantities->>'notes_100')::int,0),
    COALESCE((_quantities->>'notes_50')::int,0), COALESCE((_quantities->>'notes_20')::int,0),
    COALESCE((_quantities->>'notes_10')::int,0), COALESCE((_quantities->>'notes_5')::int,0),
    COALESCE((_quantities->>'notes_2')::int,0), COALESCE((_quantities->>'coins_1')::int,0),
    COALESCE((_quantities->>'coins_050')::int,0), COALESCE((_quantities->>'coins_025')::int,0),
    COALESCE((_quantities->>'coins_010')::int,0), COALESCE((_quantities->>'coins_005')::int,0),
    _total, NULLIF(btrim(COALESCE(_notes,'')), '')
  );

  UPDATE public.shifts SET status = CASE WHEN _matches THEN 'closed' ELSE 'disputed' END
  WHERE id = _pending_shift_id;

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit, _uid, _expected, _total, 'open') RETURNING id INTO _new_shift;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005, total_calculated, notes
  ) VALUES (
    _new_shift, 'opening', _uid,
    COALESCE((_quantities->>'notes_200')::int,0), COALESCE((_quantities->>'notes_100')::int,0),
    COALESCE((_quantities->>'notes_50')::int,0), COALESCE((_quantities->>'notes_20')::int,0),
    COALESCE((_quantities->>'notes_10')::int,0), COALESCE((_quantities->>'notes_5')::int,0),
    COALESCE((_quantities->>'notes_2')::int,0), COALESCE((_quantities->>'coins_1')::int,0),
    COALESCE((_quantities->>'coins_050')::int,0), COALESCE((_quantities->>'coins_025')::int,0),
    COALESCE((_quantities->>'coins_010')::int,0), COALESCE((_quantities->>'coins_005')::int,0),
    _total, NULLIF(btrim(COALESCE(_notes,'')), '')
  );

  RETURN jsonb_build_object('shift_id', _new_shift, 'matches', _matches, 'expected', _expected, 'total', _total);
END; $function$;

NOTIFY pgrst, 'reload schema';
