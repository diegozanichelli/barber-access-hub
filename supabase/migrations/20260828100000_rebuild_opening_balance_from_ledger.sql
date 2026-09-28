-- A deleted test transaction can have propagated through several subsequent
-- openings. Looking only at deletion requests from the latest closed shift is
-- therefore insufficient. V2 starts with the latest physical closing and
-- removes every approved master deletion made during or after that last shift.
-- Once a new shift opens with the repaired value, those older adjustments are
-- naturally considered consumed and will not be subtracted a second time.
-- The audit snapshots remain unchanged.
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

-- Keep existing callers on the repaired calculation as well.
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
NOTIFY pgrst, 'reload schema';
