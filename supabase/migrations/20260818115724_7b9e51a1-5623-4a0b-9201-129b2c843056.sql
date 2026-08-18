REVOKE EXECUTE ON FUNCTION public.unit_safe_balance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receive_handover(uuid, jsonb, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, jsonb, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_shift_dispute(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_withdrawal_dispute(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_transaction(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_unit_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_partners() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.resolve_withdrawal_dispute(_withdrawal_id uuid, _note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'auditor') THEN RAISE EXCEPTION 'Apenas o Auditor pode resolver divergências.'; END IF;
  IF btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Descreva como a divergência foi resolvida.'; END IF;

  UPDATE public.partner_withdrawals
  SET status = 'approved', resolved_by = _uid, resolved_at = now(), resolution_note = btrim(_note)
  WHERE id = _withdrawal_id AND status = 'disputed';

  IF NOT FOUND THEN RAISE EXCEPTION 'Esta retirada não está em divergência.'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_withdrawal_dispute(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal_dispute(uuid, text) TO authenticated;