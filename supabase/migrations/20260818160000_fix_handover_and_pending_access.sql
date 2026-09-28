-- A handover count is recorded against the shift that is being received.
-- The original constraint only allowed opening/closing and made receive_handover fail.
ALTER TABLE public.cash_counts
  DROP CONSTRAINT IF EXISTS cash_counts_count_type_check;
ALTER TABLE public.cash_counts
  ADD CONSTRAINT cash_counts_count_type_check
  CHECK (count_type IN ('opening', 'closing', 'handover'));

-- Role checks are only valid for approved accounts. Keeping this rule in the
-- shared helper makes every role-based RLS policy and SECURITY DEFINER RPC deny
-- pending/rejected users consistently.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved(_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    );
$$;

-- Unit-scoped policies and RPCs must not derive an operational unit for an
-- account until an auditor has approved it.
CREATE OR REPLACE FUNCTION public.current_unit_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT unit_id
  FROM public.profiles
  WHERE id = auth.uid() AND status = 'approved';
$$;

-- Approval checks are not meaningful if an authenticated user can promote
-- their own profile or switch units. Profile creation is handled by the Auth
-- trigger and privileged changes are handled by auditor server functions.
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- A partner owns the row, so the old policy did not call either helper above.
-- Add an explicit approval check while preserving the existing permissions.
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

DROP POLICY IF EXISTS partner_withdrawals_update ON public.partner_withdrawals;
CREATE POLICY partner_withdrawals_update
ON public.partner_withdrawals
FOR UPDATE TO authenticated
USING (
  public.is_approved(auth.uid())
  AND (partner_id = auth.uid() OR public.has_role(auth.uid(), 'auditor'))
)
WITH CHECK (
  public.is_approved(auth.uid())
  AND (partner_id = auth.uid() OR public.has_role(auth.uid(), 'auditor'))
);

-- Storage ownership alone is not enough: a pending account must not upload or
-- read financial evidence. Unit-level receipt visibility is addressed
-- separately from this approval hardening.
DROP POLICY IF EXISTS receipts_insert ON storage.objects;
CREATE POLICY receipts_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND owner = auth.uid()
  AND public.is_approved(auth.uid())
);

DROP POLICY IF EXISTS receipts_select ON storage.objects;
CREATE POLICY receipts_select
ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'receipts' AND public.is_approved(auth.uid()));

DROP POLICY IF EXISTS receipts_delete_admin ON storage.objects;
CREATE POLICY receipts_delete_admin
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'receipts'
  AND public.has_role(auth.uid(), 'auditor')
);

-- These SECURITY DEFINER read helpers previously bypassed RLS without checking
-- account approval. Return no financial data to pending/rejected accounts.
CREATE OR REPLACE FUNCTION public.unit_safe_balance(_unit_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_approved(auth.uid()) THEN 0::numeric
    ELSE ROUND(
      COALESCE((
        SELECT SUM(t.amount)
        FROM public.transactions t
        WHERE t.unit_id = _unit_id
          AND t.transaction_type <> 'income'
          AND t.category = 'Sangria'
          AND t.reverses_transaction_id IS NULL
          AND t.reversed_at IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(w.amount)
        FROM public.partner_withdrawals w
        WHERE w.unit_id = _unit_id
      ), 0),
      2
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.list_partners()
RETURNS TABLE (id uuid, full_name text, unit_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.unit_id
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'socio'
  WHERE public.is_approved(auth.uid()) AND p.status = 'approved'
  ORDER BY p.full_name;
$$;

REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_unit_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unit_safe_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_partners() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unit_safe_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_partners() TO authenticated, service_role;
