CREATE TYPE public.transaction_category AS ENUM ('Bebida','Assinatura Nova','Renovação','Despesa');
CREATE TYPE public.payment_method AS ENUM ('Pix','Crédito','Débito','Dinheiro');

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  category public.transaction_category NOT NULL,
  client_name text,
  payment_method public.payment_method,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  description text,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_shift_idx ON public.transactions(shift_id, created_at DESC);
CREATE INDEX transactions_unit_idx ON public.transactions(unit_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
  USING (
    unit_id = public.current_unit_id()
    OR public.has_role(auth.uid(),'auditor')
    OR public.has_role(auth.uid(),'socio')
    OR public.has_role(auth.uid(),'supervisor')
  );

CREATE POLICY transactions_insert ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor'))
    AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = shift_id AND s.unit_id = transactions.unit_id AND s.status = 'open')
  );

CREATE POLICY transactions_delete_admin ON public.transactions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'auditor'));

-- Receipt photos (private bucket, served via signed URLs)
CREATE POLICY receipts_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());
CREATE POLICY receipts_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');
CREATE POLICY receipts_delete_admin ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND public.has_role(auth.uid(),'auditor'));