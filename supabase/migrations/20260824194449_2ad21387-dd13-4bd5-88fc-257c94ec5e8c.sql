-- 1. Revoke EXECUTE from anon/PUBLIC on all public functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- 2. Revoke EXECUTE from authenticated on internal-only helpers
REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.shift_expected_cash(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.cash_total(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

-- Keep the functions the app actually calls (all enforce their own role checks)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_partners() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_partner_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_shift_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unit_safe_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_handover(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_transaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.master_delete_transaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_open_shift(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_transaction_change(uuid, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_transaction_change_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_transaction_change_request(uuid, boolean) TO authenticated;

-- 3. Receipts: ownership-scoped reads
DROP POLICY IF EXISTS receipts_select ON storage.objects;
CREATE POLICY receipts_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'auditor')
    OR public.has_role(auth.uid(), 'socio')
    OR public.has_role(auth.uid(), 'supervisor')
    OR (storage.foldername(name))[1] = public.current_unit_id()::text
  )
);

-- 4. Units: no anonymous access
DROP POLICY IF EXISTS units_select_anon ON public.units;
REVOKE ALL ON TABLE public.units FROM anon;