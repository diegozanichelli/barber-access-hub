-- Defense in depth: make approval explicit in every financial SELECT/INSERT
-- policy instead of relying only on current_unit_id()/has_role(). This keeps the
-- authorization rule visible and safe if either helper changes in the future.

DROP POLICY IF EXISTS shifts_select ON public.shifts;
CREATE POLICY shifts_select
ON public.shifts
FOR SELECT TO authenticated
USING (
  public.is_approved(auth.uid())
  AND (
    unit_id = public.current_unit_id()
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'socio')
    OR public.has_role(auth.uid(), 'supervisor')
  )
);

DROP POLICY IF EXISTS cash_counts_select ON public.cash_counts;
CREATE POLICY cash_counts_select
ON public.cash_counts
FOR SELECT TO authenticated
USING (
  public.is_approved(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id = shift_id
      AND (
        s.unit_id = public.current_unit_id()
        OR public.has_role(auth.uid(), 'auditor')
        OR public.has_role(auth.uid(), 'socio')
        OR public.has_role(auth.uid(), 'supervisor')
      )
  )
);

DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select
ON public.transactions
FOR SELECT TO authenticated
USING (
  public.is_approved(auth.uid())
  AND (
    unit_id = public.current_unit_id()
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'socio')
    OR public.has_role(auth.uid(), 'supervisor')
  )
);

DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert
ON public.transactions
FOR INSERT TO authenticated
WITH CHECK (
  public.is_approved(auth.uid())
  AND (
    public.has_role(auth.uid(), 'atendente')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'auditor')
  )
  AND user_id = auth.uid()
  AND (unit_id = public.current_unit_id() OR public.has_role(auth.uid(), 'auditor'))
  AND EXISTS (
    SELECT 1
    FROM public.shifts s
    WHERE s.id = shift_id
      AND s.unit_id = transactions.unit_id
      AND s.status = 'open'
  )
);

DROP POLICY IF EXISTS transactions_delete_admin ON public.transactions;
CREATE POLICY transactions_delete_admin
ON public.transactions
FOR DELETE TO authenticated
USING (
  public.is_approved(auth.uid())
  AND public.has_role(auth.uid(), 'auditor')
);

DROP POLICY IF EXISTS partner_withdrawals_select ON public.partner_withdrawals;
CREATE POLICY partner_withdrawals_select
ON public.partner_withdrawals
FOR SELECT TO authenticated
USING (
  public.is_approved(auth.uid())
  AND (
    unit_id = public.current_unit_id()
    OR partner_id = auth.uid()
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'socio')
    OR public.has_role(auth.uid(), 'supervisor')
  )
);

-- Shifts, cash counts and partner withdrawals are written only through the
-- atomic SECURITY DEFINER functions. Removing direct table writes prevents a
-- client from bypassing their validation or forging audit fields.
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
DROP POLICY IF EXISTS shifts_update ON public.shifts;
DROP POLICY IF EXISTS cash_counts_insert ON public.cash_counts;
DROP POLICY IF EXISTS partner_withdrawals_insert ON public.partner_withdrawals;
DROP POLICY IF EXISTS partner_withdrawals_update ON public.partner_withdrawals;

REVOKE INSERT, UPDATE ON public.shifts FROM authenticated;
REVOKE INSERT ON public.cash_counts FROM authenticated;
REVOKE INSERT, UPDATE ON public.partner_withdrawals FROM authenticated;

-- A partner may only answer one of their own pending withdrawals. The caller
-- cannot change amount, unit, shift, creator, partner or resolution metadata.
CREATE OR REPLACE FUNCTION public.respond_partner_withdrawal(
  _withdrawal_id uuid,
  _decision public.withdrawal_status
)
RETURNS public.withdrawal_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _result public.withdrawal_status;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN
    RAISE EXCEPTION 'Cadastro não aprovado.';
  END IF;

  IF NOT public.has_role(_uid, 'socio') THEN
    RAISE EXCEPTION 'Apenas o sócio pode responder à própria retirada.';
  END IF;

  IF _decision NOT IN ('approved', 'disputed') THEN
    RAISE EXCEPTION 'Resposta inválida para a retirada.';
  END IF;

  UPDATE public.partner_withdrawals
  SET status = _decision
  WHERE id = _withdrawal_id
    AND partner_id = _uid
    AND status = 'pending'
  RETURNING status INTO _result;

  IF _result IS NULL THEN
    RAISE EXCEPTION 'Retirada pendente não encontrada ou já respondida.';
  END IF;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_partner_withdrawal(uuid, public.withdrawal_status)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_partner_withdrawal(uuid, public.withdrawal_status)
TO authenticated, service_role;
