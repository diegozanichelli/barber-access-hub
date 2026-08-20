-- This runs after the enum addition has committed, so PostgreSQL can safely
-- resolve the Upgrade literal while compiling the validation function.
CREATE OR REPLACE FUNCTION public.validate_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF NEW.amount <= 0 OR NEW.amount > 1000000 THEN
    RAISE EXCEPTION 'Valor do lançamento fora do limite permitido.';
  END IF;

  IF NEW.reverses_transaction_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.transaction_type = 'income' THEN
    IF NEW.category NOT IN ('Bebida', 'Assinatura Nova', 'Renovação', 'Upgrade')
       OR NEW.payment_method IS NULL THEN
      RAISE EXCEPTION 'Categoria ou pagamento inválido para uma entrada.';
    END IF;
    IF length(btrim(COALESCE(NEW.client_name, ''))) < 3 THEN
      RAISE EXCEPTION 'Informe o nome completo do cliente.';
    END IF;
    IF length(NEW.client_name) > 120 THEN
      RAISE EXCEPTION 'Nome do cliente acima do limite permitido.';
    END IF;
    IF NEW.payment_method = 'Pix' AND NEW.photo_url IS NULL THEN
      RAISE EXCEPTION 'Comprovante obrigatório para pagamento via Pix.';
    END IF;
  ELSIF NEW.transaction_type = 'expense' THEN
    IF NEW.category NOT IN ('Despesa', 'Sangria') OR NEW.payment_method IS NOT NULL THEN
      RAISE EXCEPTION 'Categoria ou pagamento inválido para uma saída.';
    END IF;
    IF NEW.category = 'Despesa' AND length(btrim(COALESCE(NEW.description, ''))) < 3 THEN
      RAISE EXCEPTION 'Descreva a despesa.';
    END IF;
    IF NEW.photo_url IS NULL THEN
      RAISE EXCEPTION 'Comprovante obrigatório para retiradas.';
    END IF;
    IF length(COALESCE(NEW.description, '')) > 500 THEN
      RAISE EXCEPTION 'Descrição acima do limite permitido.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de lançamento inválido.';
  END IF;

  IF NEW.photo_url IS NOT NULL THEN
    IF NEW.photo_url !~ ('^' || NEW.unit_id::text || '/' || NEW.shift_id::text || '/[^/]+$') THEN
      RAISE EXCEPTION 'Caminho do comprovante inválido.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'receipts' AND o.name = NEW.photo_url
    ) THEN
      RAISE EXCEPTION 'Comprovante não encontrado no armazenamento.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
