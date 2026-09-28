-- Functions receive EXECUTE from PUBLIC by default in PostgreSQL. Remove that
-- implicit access from every project function, then grant only the public API
-- used by authenticated application sessions. Trigger/internal helpers remain
-- callable by their owners and SECURITY DEFINER functions, not by API clients.
DO $$
DECLARE
  function_signature regprocedure;
BEGIN
  FOR function_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_signature
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  function_signature regprocedure;
BEGIN
  FOR function_signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'has_role',
        'is_approved',
        'current_unit_id',
        'list_partners',
        'open_shift',
        'close_shift',
        'receive_handover',
        'create_partner_withdrawal',
        'respond_partner_withdrawal',
        'resolve_shift_dispute',
        'resolve_withdrawal_dispute',
        'reverse_transaction',
        'unit_safe_balance',
        'request_transaction_change',
        'list_transaction_change_requests',
        'decide_transaction_change_request',
        'master_delete_transaction',
        'correct_opening_cash_count',
        'delete_empty_open_shift'
      ])
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
      function_signature
    );
  END LOOP;
END;
$$;
