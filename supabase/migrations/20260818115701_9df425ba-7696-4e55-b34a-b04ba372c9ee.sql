-- 1. Resolution / audit trail columns
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE public.partner_withdrawals
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reverses_transaction_id uuid REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_reversal
  ON public.transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

-- 2. Accumulated safe balance per unit
CREATE OR REPLACE FUNCTION public.unit_safe_balance(_unit_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(
    COALESCE((
      SELECT SUM(t.amount) FROM public.transactions t
      WHERE t.unit_id = _unit_id
        AND t.transaction_type <> 'income'
        AND t.category = 'Sangria'
        AND t.reverses_transaction_id IS NULL
        AND t.reversed_at IS NULL
    ), 0)
    - COALESCE((
      SELECT SUM(w.amount) FROM public.partner_withdrawals w
      WHERE w.unit_id = _unit_id
    ), 0)
  , 2);
$$;

GRANT EXECUTE ON FUNCTION public.unit_safe_balance(uuid) TO authenticated;

-- 3. Partner withdrawal with server-side safe validation
CREATE OR REPLACE FUNCTION public.create_partner_withdrawal(
  _shift_id uuid,
  _partner_id uuid,
  _amount numeric,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _balance numeric;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;

  SELECT s.unit_id INTO _unit FROM public.shifts s
  WHERE s.id = _shift_id AND s.status = 'open'
  FOR UPDATE;

  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno não está mais aberto. Atualize a tela.'; END IF;

  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _partner_id AND ur.role = 'socio') THEN
    RAISE EXCEPTION 'A retirada só pode ser feita para um sócio.';
  END IF;

  _balance := public.unit_safe_balance(_unit);
  IF _amount > _balance THEN
    RAISE EXCEPTION 'Valor acima do saldo do cofre (disponível: %).', to_char(_balance, 'FM999999990.00');
  END IF;

  INSERT INTO public.partner_withdrawals (shift_id, unit_id, partner_id, created_by, amount, status, note)
  VALUES (_shift_id, _unit, _partner_id, _uid, ROUND(_amount, 2), 'pending', NULLIF(btrim(COALESCE(_note, '')), ''))
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text) TO authenticated;

-- 4. Atomic shift close
CREATE OR REPLACE FUNCTION public.close_shift(
  _shift_id uuid,
  _quantities jsonb,
  _total numeric,
  _expected_closing numeric,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;

  SELECT s.unit_id INTO _unit FROM public.shifts s
  WHERE s.id = _shift_id AND s.status = 'open'
  FOR UPDATE;

  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno já foi fechado. Atualize a tela.'; END IF;

  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005,
    total_calculated, notes
  ) VALUES (
    _shift_id, 'closing', _uid,
    COALESCE((_quantities->>'notes_200')::int, 0),
    COALESCE((_quantities->>'notes_100')::int, 0),
    COALESCE((_quantities->>'notes_50')::int, 0),
    COALESCE((_quantities->>'notes_20')::int, 0),
    COALESCE((_quantities->>'notes_10')::int, 0),
    COALESCE((_quantities->>'notes_5')::int, 0),
    COALESCE((_quantities->>'notes_2')::int, 0),
    COALESCE((_quantities->>'coins_1')::int, 0),
    COALESCE((_quantities->>'coins_050')::int, 0),
    COALESCE((_quantities->>'coins_025')::int, 0),
    COALESCE((_quantities->>'coins_010')::int, 0),
    COALESCE((_quantities->>'coins_005')::int, 0),
    ROUND(_total, 2), NULLIF(btrim(COALESCE(_notes, '')), '')
  );

  UPDATE public.shifts
  SET status = 'pending_handover',
      closing_total = ROUND(_total, 2),
      expected_closing_total = ROUND(_expected_closing, 2),
      closed_by = _uid,
      closed_at = now()
  WHERE id = _shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, numeric, numeric, text) TO authenticated;

-- 5. Atomic handover: settle previous shift + open the new one
CREATE OR REPLACE FUNCTION public.receive_handover(
  _pending_shift_id uuid,
  _quantities jsonb,
  _total numeric,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _expected numeric;
  _matches boolean;
  _new_shift uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;

  SELECT s.unit_id, COALESCE(s.closing_total, 0) INTO _unit, _expected
  FROM public.shifts s
  WHERE s.id = _pending_shift_id AND s.status = 'pending_handover'
  FOR UPDATE;

  IF _unit IS NULL THEN RAISE EXCEPTION 'Este repasse já foi recebido. Atualize a tela.'; END IF;

  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit AND s.status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;

  _matches := abs(_expected - ROUND(_total, 2)) < 0.005;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005,
    total_calculated, notes
  ) VALUES (
    _pending_shift_id, 'handover', _uid,
    COALESCE((_quantities->>'notes_200')::int, 0),
    COALESCE((_quantities->>'notes_100')::int, 0),
    COALESCE((_quantities->>'notes_50')::int, 0),
    COALESCE((_quantities->>'notes_20')::int, 0),
    COALESCE((_quantities->>'notes_10')::int, 0),
    COALESCE((_quantities->>'notes_5')::int, 0),
    COALESCE((_quantities->>'notes_2')::int, 0),
    COALESCE((_quantities->>'coins_1')::int, 0),
    COALESCE((_quantities->>'coins_050')::int, 0),
    COALESCE((_quantities->>'coins_025')::int, 0),
    COALESCE((_quantities->>'coins_010')::int, 0),
    COALESCE((_quantities->>'coins_005')::int, 0),
    ROUND(_total, 2), NULLIF(btrim(COALESCE(_notes, '')), '')
  );

  UPDATE public.shifts
  SET status = CASE WHEN _matches THEN 'closed' ELSE 'disputed' END
  WHERE id = _pending_shift_id;

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit, _uid, _expected, ROUND(_total, 2), 'open')
  RETURNING id INTO _new_shift;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005,
    total_calculated, notes
  ) VALUES (
    _new_shift, 'opening', _uid,
    COALESCE((_quantities->>'notes_200')::int, 0),
    COALESCE((_quantities->>'notes_100')::int, 0),
    COALESCE((_quantities->>'notes_50')::int, 0),
    COALESCE((_quantities->>'notes_20')::int, 0),
    COALESCE((_quantities->>'notes_10')::int, 0),
    COALESCE((_quantities->>'notes_5')::int, 0),
    COALESCE((_quantities->>'notes_2')::int, 0),
    COALESCE((_quantities->>'coins_1')::int, 0),
    COALESCE((_quantities->>'coins_050')::int, 0),
    COALESCE((_quantities->>'coins_025')::int, 0),
    COALESCE((_quantities->>'coins_010')::int, 0),
    COALESCE((_quantities->>'coins_005')::int, 0),
    ROUND(_total, 2), NULLIF(btrim(COALESCE(_notes, '')), '')
  );

  RETURN jsonb_build_object('shift_id', _new_shift, 'matches', _matches, 'expected', _expected);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_handover(uuid, jsonb, numeric, text) TO authenticated;

-- 6. Atomic shift open (blocks a second open shift per unit with a clear message)
CREATE OR REPLACE FUNCTION public.open_shift(
  _unit_id uuid,
  _quantities jsonb,
  _total numeric,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _expected numeric;
  _shift uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;

  IF NOT (public.current_unit_id() = _unit_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit_id AND s.status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.unit_id = _unit_id AND s.status = 'pending_handover') THEN
    RAISE EXCEPTION 'Há um turno aguardando repasse. Receba o turno pendente.';
  END IF;

  SELECT COALESCE(s.closing_total, 0) INTO _expected
  FROM public.shifts s
  WHERE s.unit_id = _unit_id AND s.status = 'closed' AND s.closing_total IS NOT NULL
  ORDER BY s.closed_at DESC
  LIMIT 1;

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit_id, _uid, COALESCE(_expected, 0), ROUND(_total, 2), 'open')
  RETURNING id INTO _shift;

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005,
    total_calculated, notes
  ) VALUES (
    _shift, 'opening', _uid,
    COALESCE((_quantities->>'notes_200')::int, 0),
    COALESCE((_quantities->>'notes_100')::int, 0),
    COALESCE((_quantities->>'notes_50')::int, 0),
    COALESCE((_quantities->>'notes_20')::int, 0),
    COALESCE((_quantities->>'notes_10')::int, 0),
    COALESCE((_quantities->>'notes_5')::int, 0),
    COALESCE((_quantities->>'notes_2')::int, 0),
    COALESCE((_quantities->>'coins_1')::int, 0),
    COALESCE((_quantities->>'coins_050')::int, 0),
    COALESCE((_quantities->>'coins_025')::int, 0),
    COALESCE((_quantities->>'coins_010')::int, 0),
    COALESCE((_quantities->>'coins_005')::int, 0),
    ROUND(_total, 2), NULLIF(btrim(COALESCE(_notes, '')), '')
  );

  RETURN _shift;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_shift(uuid, jsonb, numeric, text) TO authenticated;

-- 7. Auditor resolution of disputes
CREATE OR REPLACE FUNCTION public.resolve_shift_dispute(_shift_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Apenas o Auditor pode resolver divergências.'; END IF;
  IF btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Descreva como a divergência foi resolvida.'; END IF;

  UPDATE public.shifts
  SET status = 'closed', resolved_by = _uid, resolved_at = now(), resolution_note = btrim(_note)
  WHERE id = _shift_id AND status = 'disputed';

  IF NOT FOUND THEN RAISE EXCEPTION 'Turno não está em divergência.'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_shift_dispute(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_withdrawal_dispute(_withdrawal_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Apenas o Auditor pode resolver divergências.'; END IF;
  IF btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Descreva como a divergência foi resolvida.'; END IF;

  UPDATE public.partner_withdrawals
  SET status = 'approved', resolved_by = _uid, resolved_at = now(), resolution_note = btrim(_note)
  WHERE id = _withdrawal_id AND status = 'disputed';

  IF NOT FOUND THEN RAISE EXCEPTION 'Retirada не está em divergência.'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_withdrawal_dispute(uuid, text) TO authenticated;

-- 8. Audit-safe reversal of a wrong transaction
CREATE OR REPLACE FUNCTION public.reverse_transaction(_transaction_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _t public.transactions%ROWTYPE;
  _new uuid;
BEGIN
  IF NOT (public.has_role(_uid, 'auditor') OR public.has_role(_uid, 'supervisor')) THEN
    RAISE EXCEPTION 'Apenas Supervisor ou Auditor podem estornar lançamentos.';
  END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo do estorno.'; END IF;

  SELECT * INTO _t FROM public.transactions WHERE id = _transaction_id FOR UPDATE;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF _t.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Este lançamento já foi estornado.'; END IF;
  IF _t.reverses_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Não é possível estornar um estorno.'; END IF;

  IF NOT (public.has_role(_uid, 'auditor') OR public.current_unit_id() = _t.unit_id) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  INSERT INTO public.transactions (
    shift_id, unit_id, user_id, transaction_type, category, client_name,
    payment_method, amount, description, photo_url, reverses_transaction_id
  ) VALUES (
    _t.shift_id, _t.unit_id, _uid,
    CASE WHEN _t.transaction_type = 'income' THEN 'expense' ELSE 'income' END,
    _t.category, _t.client_name, _t.payment_method, _t.amount,
    'ESTORNO: ' || btrim(_reason), _t.photo_url, _t.id
  ) RETURNING id INTO _new;

  UPDATE public.transactions
  SET reversed_by = _uid, reversed_at = now()
  WHERE id = _t.id;

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_transaction(uuid, text) TO authenticated;