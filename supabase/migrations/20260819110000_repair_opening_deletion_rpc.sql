-- Compatibility repair for environments where the application bundle was
-- published before the transaction-change migration reached PostgREST.
CREATE TABLE IF NOT EXISTS public.cancelled_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_snapshot jsonb NOT NULL,
  counts_snapshot jsonb NOT NULL,
  cancelled_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cancelled_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelled_openings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cancelled_openings TO authenticated;

DROP POLICY IF EXISTS cancelled_openings_master_select ON public.cancelled_openings;
CREATE POLICY cancelled_openings_master_select
ON public.cancelled_openings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'auditor'));

CREATE OR REPLACE FUNCTION public.delete_empty_open_shift(_shift_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _shift public.shifts%ROWTYPE;
  _counts jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN
    RAISE EXCEPTION 'Somente o login master pode excluir uma abertura.';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.';
  END IF;

  SELECT * INTO _shift FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND OR _shift.status <> 'open' THEN
    RAISE EXCEPTION 'Abertura ativa não encontrada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE shift_id = _shift_id)
    OR EXISTS (SELECT 1 FROM public.partner_withdrawals WHERE shift_id = _shift_id) THEN
    RAISE EXCEPTION 'Este turno possui movimentações. Corrija os lançamentos antes de excluir a abertura.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  INTO _counts FROM public.cash_counts c WHERE shift_id = _shift_id;

  INSERT INTO public.cancelled_openings
    (shift_snapshot, counts_snapshot, cancelled_by, reason)
  VALUES (to_jsonb(_shift), _counts, _uid, btrim(_reason));

  DELETE FROM public.shifts WHERE id = _shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_empty_open_shift(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_empty_open_shift(uuid, text) TO authenticated;

-- Ask PostgREST to expose the repaired function immediately instead of waiting
-- for its periodic schema-cache refresh.
NOTIFY pgrst, 'reload schema';
