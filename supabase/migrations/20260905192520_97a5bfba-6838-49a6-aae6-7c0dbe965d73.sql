ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Troco';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS pix_status text,
  ADD COLUMN IF NOT EXISTS pix_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS pix_reviewed_at timestamptz;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_pix_status_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_pix_status_check
  CHECK (pix_status IS NULL OR pix_status IN ('pending', 'paid'));

CREATE INDEX IF NOT EXISTS transactions_pix_status_idx
  ON public.transactions (pix_status)
  WHERE pix_status = 'pending';

CREATE OR REPLACE FUNCTION public.set_pix_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method = 'Pix' AND NEW.pix_status IS NULL THEN
    NEW.pix_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_set_pix_status ON public.transactions;
CREATE TRIGGER transactions_set_pix_status
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_pix_status();

UPDATE public.transactions
   SET pix_status = 'pending'
 WHERE payment_method = 'Pix' AND pix_status IS NULL;

CREATE OR REPLACE FUNCTION public.review_pix_transaction(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    has_role(auth.uid(), 'auditor'::app_role)
    OR has_role(auth.uid(), 'socio'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'Apenas supervisor, sócio ou auditor podem confirmar um Pix.';
  END IF;

  UPDATE public.transactions
     SET pix_status = 'paid',
         pix_reviewed_by = auth.uid(),
         pix_reviewed_at = now()
   WHERE id = _transaction_id
     AND payment_method = 'Pix';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento Pix não encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_pix_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_pix_transaction(uuid) TO authenticated, service_role;