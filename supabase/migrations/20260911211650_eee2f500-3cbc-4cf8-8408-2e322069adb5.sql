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
  _counted numeric := public.cash_total(_quantities);
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

  _expected := public.shift_expected_cash(_shift_id);
  RETURN ABS(_counted - _expected) < 0.005;
END;
$$;

REVOKE ALL ON FUNCTION public.check_shift_cash_count(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_shift_cash_count(uuid, jsonb) TO authenticated, service_role;