CREATE TYPE public.change_request_action AS ENUM ('edit', 'delete');
CREATE TYPE public.change_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.transaction_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  unit_id uuid NOT NULL REFERENCES public.units(id),
  action public.change_request_action NOT NULL,
  reason text NOT NULL,
  proposed_amount numeric(12,2),
  proposed_description text,
  transaction_snapshot jsonb NOT NULL,
  status public.change_request_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES auth.users(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

ALTER TABLE public.transaction_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_change_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_transaction_change(
  _transaction_id uuid,
  _action public.change_request_action,
  _reason text,
  _proposed_amount numeric DEFAULT NULL,
  _proposed_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _tx public.transactions%ROWTYPE; _id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da solicitação.'; END IF;
  SELECT * INTO _tx FROM public.transactions WHERE id = _transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF NOT (public.has_role(_uid, 'auditor') OR public.current_unit_id() = _tx.unit_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a este lançamento.';
  END IF;
  IF _tx.reversed_at IS NOT NULL OR _tx.reverses_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Um estorno não pode ser editado ou excluído.';
  END IF;
  IF _action = 'edit' AND (COALESCE(_proposed_amount, 0) <= 0) THEN
    RAISE EXCEPTION 'Informe o novo valor.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_change_requests WHERE transaction_id = _transaction_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Já existe uma solicitação pendente para este lançamento.';
  END IF;
  INSERT INTO public.transaction_change_requests
    (transaction_id, requested_by, unit_id, action, reason, proposed_amount, proposed_description, transaction_snapshot)
  VALUES (_transaction_id, _uid, _tx.unit_id, _action, btrim(_reason), _proposed_amount,
    NULLIF(btrim(COALESCE(_proposed_description, '')), ''), to_jsonb(_tx)) RETURNING id INTO _id;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.decide_transaction_change_request(
  _request_id uuid, _approve boolean, _decision_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _req public.transaction_change_requests%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode decidir solicitações.'; END IF;
  SELECT * INTO _req FROM public.transaction_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR _req.status <> 'pending' THEN RAISE EXCEPTION 'Solicitação não está pendente.'; END IF;
  IF _approve THEN
    IF _req.action = 'delete' THEN
      DELETE FROM public.transactions WHERE id = _req.transaction_id;
    ELSE
      UPDATE public.transactions SET amount = _req.proposed_amount,
        description = COALESCE(_req.proposed_description, description)
      WHERE id = _req.transaction_id;
    END IF;
  END IF;
  UPDATE public.transaction_change_requests SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = _uid, decision_note = NULLIF(btrim(COALESCE(_decision_note, '')), ''), decided_at = now()
  WHERE id = _request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_transaction_change_requests()
RETURNS SETOF public.transaction_change_requests LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.transaction_change_requests r
  WHERE public.has_role(auth.uid(), 'auditor') OR r.requested_by = auth.uid()
  ORDER BY (r.status = 'pending') DESC, r.created_at DESC;
$$;

CREATE TABLE public.cancelled_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_snapshot jsonb NOT NULL,
  counts_snapshot jsonb NOT NULL, cancelled_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cancelled_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelled_openings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cancelled_openings TO authenticated;
CREATE POLICY cancelled_openings_master_select ON public.cancelled_openings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'auditor'));

CREATE OR REPLACE FUNCTION public.delete_empty_open_shift(_shift_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _shift public.shifts%ROWTYPE; _counts jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode excluir uma abertura.'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  SELECT * INTO _shift FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND OR _shift.status <> 'open' THEN RAISE EXCEPTION 'Abertura ativa não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE shift_id = _shift_id)
    OR EXISTS (SELECT 1 FROM public.partner_withdrawals WHERE shift_id = _shift_id) THEN
    RAISE EXCEPTION 'Este turno possui movimentações. Corrija os lançamentos antes de excluir a abertura.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO _counts FROM public.cash_counts c WHERE shift_id = _shift_id;
  INSERT INTO public.cancelled_openings (shift_snapshot, counts_snapshot, cancelled_by, reason)
  VALUES (to_jsonb(_shift), _counts, _uid, btrim(_reason));
  DELETE FROM public.shifts WHERE id = _shift_id;
END; $$;

REVOKE ALL ON FUNCTION public.request_transaction_change(uuid, public.change_request_action, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_transaction_change_request(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_transaction_change_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_empty_open_shift(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_transaction_change(uuid, public.change_request_action, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_transaction_change_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_transaction_change_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_open_shift(uuid, text) TO authenticated;
