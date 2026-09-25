CREATE OR REPLACE FUNCTION public.shift_expected_cash(_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROUND(
    COALESCE((SELECT s.actual_opening_total FROM public.shifts s WHERE s.id = _shift_id), 0)
    + COALESCE((
      SELECT SUM(CASE
        WHEN t.transaction_type = 'income' AND t.payment_method = 'Dinheiro' THEN t.amount
        WHEN t.transaction_type = 'income' THEN 0
        WHEN t.category::text = 'Troco' AND t.payment_method = 'Pix' THEN t.amount
        WHEN t.category::text = 'Troco' THEN 0
        ELSE -t.amount END)
      FROM public.transactions t
      WHERE t.shift_id = _shift_id
        AND t.reverses_transaction_id IS NULL
        AND t.reversed_at IS NULL
    ), 0)
  , 2);
$$;

REVOKE ALL ON FUNCTION public.shift_expected_cash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_expected_cash(uuid) TO service_role;