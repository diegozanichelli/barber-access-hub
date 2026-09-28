-- Helper: total from denomination quantities
CREATE OR REPLACE FUNCTION public.cash_total(_q jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ROUND(
    COALESCE((_q->>'notes_200')::int,0)*200 + COALESCE((_q->>'notes_100')::int,0)*100 +
    COALESCE((_q->>'notes_50')::int,0)*50 + COALESCE((_q->>'notes_20')::int,0)*20 +
    COALESCE((_q->>'notes_10')::int,0)*10 + COALESCE((_q->>'notes_5')::int,0)*5 +
    COALESCE((_q->>'notes_2')::int,0)*2 + COALESCE((_q->>'coins_1')::int,0)*1 +
    COALESCE((_q->>'coins_050')::int,0)*0.50 + COALESCE((_q->>'coins_025')::int,0)*0.25 +
    COALESCE((_q->>'coins_010')::int,0)*0.10 + COALESCE((_q->>'coins_005')::int,0)*0.05
  , 2);
$$;

CREATE OR REPLACE FUNCTION public.shift_expected_cash(_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROUND(
    COALESCE((SELECT s.actual_opening_total FROM public.shifts s WHERE s.id = _shift_id), 0)
    + COALESCE((
      SELECT SUM(CASE
        WHEN t.transaction_type = 'income' AND t.payment_method = 'Dinheiro' THEN t.amount
        WHEN t.transaction_type = 'income' THEN 0
        ELSE -t.amount END)
      FROM public.transactions t
      WHERE t.shift_id = _shift_id
        AND t.reverses_transaction_id IS NULL
        AND t.reversed_at IS NULL
    ), 0)
  , 2);
$$;

-- Audit tables -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cancelled_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_snapshot jsonb NOT NULL,
  counts_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancelled_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cancelled_openings TO authenticated;
GRANT ALL ON public.cancelled_openings TO service_role;
ALTER TABLE public.cancelled_openings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cancelled_openings_select ON public.cancelled_openings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'auditor'));

CREATE TABLE IF NOT EXISTS public.deleted_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_snapshot jsonb NOT NULL,
  deleted_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deleted_transactions TO authenticated;
GRANT ALL ON public.deleted_transactions TO service_role;
ALTER TABLE public.deleted_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deleted_transactions_select ON public.deleted_transactions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'auditor'));

CREATE TABLE IF NOT EXISTS public.transaction_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('edit','delete')),
  reason text NOT NULL,
  proposed_amount numeric,
  proposed_description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  transaction_snapshot jsonb NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transaction_change_requests TO authenticated;
GRANT ALL ON public.transaction_change_requests TO service_role;
ALTER TABLE public.transaction_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcr_select ON public.transaction_change_requests
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'auditor'));
CREATE TRIGGER tcr_set_updated_at BEFORE UPDATE ON public.transaction_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cash RPCs (totals now computed in the database) ---------------------------
DROP FUNCTION IF EXISTS public.open_shift(uuid, jsonb, numeric, text);
CREATE OR REPLACE FUNCTION public.open_shift(_unit_id uuid, _quantities jsonb, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT COALESCE(s.closing_total, 0) INTO _expected
  FROM public.shifts s
  WHERE s.unit_id = _unit_id AND s.status = 'closed' AND s.closing_total IS NOT NULL
  ORDER BY s.closed_at DESC LIMIT 1;

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
END; $$;

DROP FUNCTION IF EXISTS public.close_shift(uuid, jsonb, numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.close_shift(_shift_id uuid, _quantities jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _total numeric := public.cash_total(_quantities);
  _expected numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;

  SELECT s.unit_id INTO _unit FROM public.shifts s
  WHERE s.id = _shift_id AND s.status = 'open' FOR UPDATE;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno já foi fechado. Atualize a tela.'; END IF;
  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  _expected := public.shift_expected_cash(_shift_id);

  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005, total_calculated, notes
  ) VALUES (
    _shift_id, 'closing', _uid,
    COALESCE((_quantities->>'notes_200')::int,0), COALESCE((_quantities->>'notes_100')::int,0),
    COALESCE((_quantities->>'notes_50')::int,0), COALESCE((_quantities->>'notes_20')::int,0),
    COALESCE((_quantities->>'notes_10')::int,0), COALESCE((_quantities->>'notes_5')::int,0),
    COALESCE((_quantities->>'notes_2')::int,0), COALESCE((_quantities->>'coins_1')::int,0),
    COALESCE((_quantities->>'coins_050')::int,0), COALESCE((_quantities->>'coins_025')::int,0),
    COALESCE((_quantities->>'coins_010')::int,0), COALESCE((_quantities->>'coins_005')::int,0),
    _total, NULLIF(btrim(COALESCE(_notes,'')), '')
  );

  UPDATE public.shifts
  SET status = 'pending_handover', closing_total = _total,
      expected_closing_total = _expected, closed_by = _uid, closed_at = now()
  WHERE id = _shift_id;

  RETURN jsonb_build_object('total', _total, 'expected', _expected, 'difference', ROUND(_total - _expected, 2));
END; $$;

DROP FUNCTION IF EXISTS public.receive_handover(uuid, jsonb, numeric, text);
CREATE OR REPLACE FUNCTION public.receive_handover(_pending_shift_id uuid, _quantities jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  _matches := abs(_expected - _total) < 0.005;

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
END; $$;

-- Partner decision -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_partner_withdrawal(_withdrawal_id uuid, _decision text)
RETURNS withdrawal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _status withdrawal_status;
BEGIN
  IF _decision NOT IN ('approved','disputed') THEN RAISE EXCEPTION 'Decisão inválida.'; END IF;
  UPDATE public.partner_withdrawals
  SET status = _decision::withdrawal_status
  WHERE id = _withdrawal_id AND status = 'pending' AND partner_id = _uid
  RETURNING status INTO _status;
  IF _status IS NULL THEN RAISE EXCEPTION 'Retirada pendente não encontrada ou já respondida.'; END IF;
  RETURN _status;
END; $$;

-- Master deletions -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_empty_open_shift(_shift_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _shift public.shifts%ROWTYPE;
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode excluir uma abertura.'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;

  SELECT * INTO _shift FROM public.shifts WHERE id = _shift_id AND status = 'open' FOR UPDATE;
  IF _shift.id IS NULL THEN RAISE EXCEPTION 'Abertura ativa não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.shift_id = _shift_id)
     OR EXISTS (SELECT 1 FROM public.partner_withdrawals w WHERE w.shift_id = _shift_id) THEN
    RAISE EXCEPTION 'Este turno possui movimentações. Corrija os lançamentos antes de excluir a abertura.';
  END IF;

  INSERT INTO public.cancelled_openings (shift_snapshot, counts_snapshot, cancelled_by, reason)
  VALUES (
    to_jsonb(_shift),
    COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.cash_counts c WHERE c.shift_id = _shift_id), '[]'::jsonb),
    _uid, btrim(_reason)
  );

  DELETE FROM public.cash_counts WHERE shift_id = _shift_id;
  DELETE FROM public.shifts WHERE id = _shift_id;
END; $$;

CREATE OR REPLACE FUNCTION public.master_delete_transaction(_transaction_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _t public.transactions%ROWTYPE;
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode excluir um lançamento.'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;

  SELECT * INTO _t FROM public.transactions WHERE id = _transaction_id FOR UPDATE;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;

  INSERT INTO public.deleted_transactions (transaction_snapshot, deleted_by, reason)
  VALUES (to_jsonb(_t), _uid, btrim(_reason));

  DELETE FROM public.transactions WHERE id = _transaction_id;
END; $$;

-- Change requests ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_transaction_change(
  _transaction_id uuid, _action text, _reason text,
  _proposed_amount numeric DEFAULT NULL, _proposed_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _t public.transactions%ROWTYPE; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;
  IF _action NOT IN ('edit','delete') THEN RAISE EXCEPTION 'Tipo de solicitação inválido.'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'Descreva o motivo da solicitação.'; END IF;

  SELECT * INTO _t FROM public.transactions WHERE id = _transaction_id;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF NOT (public.has_role(_uid,'auditor') OR public.current_unit_id() = _t.unit_id) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_change_requests r
             WHERE r.transaction_id = _transaction_id AND r.status = 'pending') THEN
    RAISE EXCEPTION 'Já existe uma solicitação pendente para este lançamento.';
  END IF;

  INSERT INTO public.transaction_change_requests (
    transaction_id, requested_by, action, reason, proposed_amount, proposed_description, transaction_snapshot
  ) VALUES (
    _transaction_id, _uid, _action, btrim(_reason), _proposed_amount,
    NULLIF(btrim(COALESCE(_proposed_description,'')), ''), to_jsonb(_t)
  ) RETURNING id INTO _id;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_transaction_change_requests()
RETURNS SETOF public.transaction_change_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.transaction_change_requests r
  WHERE public.has_role(auth.uid(), 'auditor') OR r.requested_by = auth.uid()
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.decide_transaction_change_request(_request_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.transaction_change_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Acesso restrito ao login master.'; END IF;

  SELECT * INTO _r FROM public.transaction_change_requests WHERE id = _request_id AND status = 'pending' FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada ou já decidida.'; END IF;

  IF _approve THEN
    IF _r.action = 'delete' THEN
      INSERT INTO public.deleted_transactions (transaction_snapshot, deleted_by, reason)
      SELECT to_jsonb(t), _uid, _r.reason FROM public.transactions t WHERE t.id = _r.transaction_id;
      DELETE FROM public.transactions WHERE id = _r.transaction_id;
    ELSE
      UPDATE public.transactions
      SET amount = COALESCE(_r.proposed_amount, amount),
          description = COALESCE(_r.proposed_description, description)
      WHERE id = _r.transaction_id;
    END IF;
  END IF;

  UPDATE public.transaction_change_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      decided_by = _uid, decided_at = now()
  WHERE id = _request_id;
END; $$;

GRANT EXECUTE ON FUNCTION
  public.cash_total(jsonb), public.shift_expected_cash(uuid),
  public.open_shift(uuid, jsonb, text), public.close_shift(uuid, jsonb, text),
  public.receive_handover(uuid, jsonb, text), public.respond_partner_withdrawal(uuid, text),
  public.delete_empty_open_shift(uuid, text), public.master_delete_transaction(uuid, text),
  public.request_transaction_change(uuid, text, text, numeric, text),
  public.list_transaction_change_requests(), public.decide_transaction_change_request(uuid, boolean)
TO authenticated;