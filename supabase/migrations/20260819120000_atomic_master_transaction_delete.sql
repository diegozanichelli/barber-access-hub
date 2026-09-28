-- The master deletion must be one database transaction. Creating a request and
-- approving it in two browser calls could leave a pending request after a
-- partial failure.
CREATE OR REPLACE FUNCTION public.master_delete_transaction(
  _transaction_id uuid,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tx public.transactions%ROWTYPE;
  _request_id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'auditor') THEN
    RAISE EXCEPTION 'Somente o login master pode excluir um lançamento diretamente.';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.';
  END IF;

  SELECT * INTO _tx
  FROM public.transactions
  WHERE id = _transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF _tx.reversed_at IS NOT NULL OR _tx.reverses_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Um lançamento estornado ou de estorno não pode ser excluído.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transaction_change_requests
    WHERE transaction_id = _transaction_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe uma solicitação pendente para este lançamento.';
  END IF;

  INSERT INTO public.transaction_change_requests (
    transaction_id, requested_by, unit_id, action, reason,
    transaction_snapshot, status, decided_by, decision_note, decided_at
  ) VALUES (
    _transaction_id, _uid, _tx.unit_id, 'delete', btrim(_reason),
    to_jsonb(_tx), 'approved', _uid, 'Exclusão direta pelo login master', now()
  ) RETURNING id INTO _request_id;

  DELETE FROM public.transactions WHERE id = _transaction_id;
  RETURN _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.master_delete_transaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_delete_transaction(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
