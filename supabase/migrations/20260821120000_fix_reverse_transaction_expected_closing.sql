-- reverse_transaction() creates a compensating entry and marks the original
-- transaction reversed, which already makes both invisible to live
-- running-cash math (src/lib/running-cash.ts skips any row with
-- reversed_at/reverses_transaction_id set, regardless of shift). But when the
-- reversed transaction belonged to a shift that had already been closed
-- (status 'pending_handover' or 'closed'), that shift's frozen
-- expected_closing_total was never recomputed: it still reflected the
-- original, now-corrected mistake, so the shift's divergence
-- (closing_total - expected_closing_total, shown in shift-history.tsx /
-- auditor-overview.tsx) stayed wrong forever even though the ledger says the
-- transaction was fixed.
--
-- Recompute only expected_closing_total (the theoretical total derived from
-- the ledger) using the same shift_expected_cash() formula close_shift()
-- itself uses, which already excludes reversed rows. closing_total (what the
-- attendant physically counted at close time) is left untouched — it is a
-- historical fact, not a derived value. Downstream shifts are unaffected:
-- open_shift() seeds the next shift's expected_opening_total from
-- closing_total, not expected_closing_total.
CREATE OR REPLACE FUNCTION public.reverse_transaction(_transaction_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _t public.transactions%ROWTYPE;
  _shift_status text;
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

  SELECT status INTO _shift_status FROM public.shifts WHERE id = _t.shift_id FOR UPDATE;
  IF _shift_status IN ('pending_handover', 'closed') THEN
    UPDATE public.shifts
    SET expected_closing_total = public.shift_expected_cash(_t.shift_id)
    WHERE id = _t.shift_id;
  END IF;

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_transaction(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
