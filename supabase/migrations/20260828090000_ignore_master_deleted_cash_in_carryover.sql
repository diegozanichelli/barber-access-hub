-- A closed cash count is an immutable physical snapshot. When the master later
-- removes a test/invalid transaction, keep that snapshot for audit but exclude
-- the deleted transaction's cash effect from the amount carried to the next
-- opening. This also repairs deletions made before this migration because the
-- approved request contains the complete transaction snapshot.
CREATE OR REPLACE FUNCTION public.unit_expected_opening_total(_unit_id uuid)
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
  WHERE r.unit_id = _unit_id
    AND r.action = 'delete'
    AND r.status = 'approved'
    AND r.decided_at > _last_shift.closed_at
    AND r.transaction_snapshot->>'shift_id' = _last_shift.id::text
    AND r.transaction_snapshot->>'reversed_at' IS NULL
    AND r.transaction_snapshot->>'reverses_transaction_id' IS NULL;

  RETURN ROUND(COALESCE(_last_shift.closing_total, 0) - _deleted_cash_effect, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.unit_expected_opening_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unit_expected_opening_total(uuid) TO authenticated, service_role;

-- Ensure the authoritative opening RPC stores exactly the same repaired value
-- that the blind preflight checks.
CREATE OR REPLACE FUNCTION public.open_shift(
  _unit_id uuid,
  _quantities jsonb,
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
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF NOT (
    public.has_role(_uid, 'atendente') OR public.has_role(_uid, 'supervisor') OR public.has_role(_uid, 'auditor')
  ) THEN RAISE EXCEPTION 'Você não tem permissão para abrir o caixa.'; END IF;
  IF NOT (public.current_unit_id() = _unit_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE unit_id = _unit_id AND status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE unit_id = _unit_id AND status = 'pending_handover') THEN
    RAISE EXCEPTION 'Há um turno aguardando repasse. Receba o turno pendente.';
  END IF;

  _expected := public.unit_expected_opening_total(_unit_id);

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit_id, _uid, _expected, public.cash_quantities_total(_quantities), 'open')
  RETURNING id INTO _shift;

  PERFORM public.record_cash_count(_shift, 'opening', _uid, _quantities, _notes);
  RETURN _shift;
END;
$$;

REVOKE ALL ON FUNCTION public.open_shift(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, jsonb, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
