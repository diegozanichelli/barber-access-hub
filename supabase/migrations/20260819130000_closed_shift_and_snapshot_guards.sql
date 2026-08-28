-- Corrections are allowed only while the shift is open. Once a shift is
-- closed/pending handover/disputed, its accounting history is immutable and a
-- correction must use the reversal workflow instead.
CREATE OR REPLACE FUNCTION public.request_transaction_change(
  _transaction_id uuid,
  _action public.change_request_action,
  _reason text,
  _proposed_amount numeric DEFAULT NULL,
  _proposed_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _tx public.transactions%ROWTYPE;
  _shift_status text;
  _id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da solicitação.'; END IF;

  SELECT t.* INTO _tx
  FROM public.transactions t JOIN public.shifts s ON s.id = t.shift_id
  WHERE t.id = _transaction_id FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  SELECT status INTO _shift_status FROM public.shifts WHERE id = _tx.shift_id;
  IF _shift_status <> 'open' THEN
    RAISE EXCEPTION 'Turno já encerrado. Solicite um estorno para preservar o fechamento.';
  END IF;
  IF NOT (public.has_role(_uid, 'auditor') OR public.current_unit_id() = _tx.unit_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a este lançamento.';
  END IF;
  IF _tx.reversed_at IS NOT NULL OR _tx.reverses_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Um estorno não pode ser editado ou excluído.';
  END IF;
  IF _action = 'edit' AND (COALESCE(_proposed_amount, 0) <= 0 OR _proposed_amount > 1000000) THEN
    RAISE EXCEPTION 'Informe um novo valor válido.';
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
DECLARE
  _uid uuid := auth.uid();
  _req public.transaction_change_requests%ROWTYPE;
  _tx public.transactions%ROWTYPE;
  _shift_status text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode decidir solicitações.'; END IF;
  SELECT * INTO _req FROM public.transaction_change_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR _req.status <> 'pending' THEN RAISE EXCEPTION 'Solicitação não está pendente.'; END IF;

  IF _approve THEN
    SELECT t.* INTO _tx
    FROM public.transactions t JOIN public.shifts s ON s.id = t.shift_id
    WHERE t.id = _req.transaction_id FOR UPDATE OF t;
    IF NOT FOUND THEN RAISE EXCEPTION 'O lançamento não existe mais. Recuse a solicitação.'; END IF;
    SELECT status INTO _shift_status FROM public.shifts WHERE id = _tx.shift_id;
    IF _shift_status <> 'open' THEN
      RAISE EXCEPTION 'O turno foi encerrado após a solicitação. Use um estorno para preservar o fechamento.';
    END IF;
    IF to_jsonb(_tx) IS DISTINCT FROM _req.transaction_snapshot THEN
      RAISE EXCEPTION 'O lançamento mudou após a solicitação. Revise os dados e crie uma nova solicitação.';
    END IF;

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

CREATE OR REPLACE FUNCTION public.master_delete_transaction(_transaction_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _tx public.transactions%ROWTYPE; _shift_status text; _request_id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Somente o login master pode excluir um lançamento diretamente.'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  SELECT t.* INTO _tx FROM public.transactions t
    JOIN public.shifts s ON s.id = t.shift_id WHERE t.id = _transaction_id FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  SELECT status INTO _shift_status FROM public.shifts WHERE id = _tx.shift_id;
  IF _shift_status <> 'open' THEN RAISE EXCEPTION 'Turno já encerrado. Use um estorno para preservar o fechamento.'; END IF;
  IF _tx.reversed_at IS NOT NULL OR _tx.reverses_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Um lançamento estornado ou de estorno não pode ser excluído.'; END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_change_requests WHERE transaction_id = _transaction_id AND status = 'pending') THEN RAISE EXCEPTION 'Existe uma solicitação pendente para este lançamento.'; END IF;
  INSERT INTO public.transaction_change_requests (transaction_id, requested_by, unit_id, action, reason, transaction_snapshot, status, decided_by, decision_note, decided_at)
  VALUES (_transaction_id, _uid, _tx.unit_id, 'delete', btrim(_reason), to_jsonb(_tx), 'approved', _uid, 'Exclusão direta pelo login master', now())
  RETURNING id INTO _request_id;
  DELETE FROM public.transactions WHERE id = _transaction_id;
  RETURN _request_id;
END; $$;

REVOKE ALL ON FUNCTION public.request_transaction_change(uuid, public.change_request_action, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_transaction_change_request(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.master_delete_transaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_transaction_change(uuid, public.change_request_action, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_transaction_change_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_delete_transaction(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
