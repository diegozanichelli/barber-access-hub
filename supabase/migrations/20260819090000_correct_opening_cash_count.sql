-- Opening cash is not a transaction. Allow the auditor to correct an erroneous
-- active opening while retaining an immutable record of the previous value.
CREATE TABLE IF NOT EXISTS public.cash_count_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  cash_count_id uuid NOT NULL REFERENCES public.cash_counts(id),
  corrected_by uuid NOT NULL REFERENCES auth.users(id),
  previous_total numeric(12,2) NOT NULL,
  corrected_total numeric(12,2) NOT NULL,
  previous_quantities jsonb NOT NULL,
  corrected_quantities jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_count_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_count_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cash_count_corrections TO authenticated;

DROP POLICY IF EXISTS cash_count_corrections_auditor_select ON public.cash_count_corrections;
CREATE POLICY cash_count_corrections_auditor_select
ON public.cash_count_corrections FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'auditor'));

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
  _total numeric := public.cash_quantities_total(_quantities);
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN
    RAISE EXCEPTION 'Somente o auditor pode corrigir uma abertura.';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres.';
  END IF;

  SELECT status INTO _status FROM public.shifts WHERE id = _shift_id FOR UPDATE;
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
  RETURN _total;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_opening_cash_count(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_opening_cash_count(uuid, jsonb, text) TO authenticated;
