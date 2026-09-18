-- Depósito bancário do sócio: o destino final do dinheiro.
--
-- Rastro do dinheiro: caixa -> cofre da unidade -> retirada do sócio ->
-- sócio confirma o recebimento (status 'approved') -> sócio deposita no banco.
-- Até aqui o sistema parava em "confirmou". Esta migration registra o depósito
-- e permite calcular quanto cada sócio ainda está segurando.
--
-- Regras (confirmadas com o dono):
--   * "Em posse" = retiradas CONFIRMADAS (approved) menos o já depositado.
--   * Depósito parcial é permitido.
--   * Comprovante do banco é opcional.
--   * Saldo é GERAL por sócio (todas as unidades juntas).
--   * Podem registrar: o próprio sócio ou um auditor.

CREATE TABLE IF NOT EXISTS public.partner_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  photo_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_deposits_partner_idx
  ON public.partner_deposits (partner_id, created_at DESC);

ALTER TABLE public.partner_deposits ENABLE ROW LEVEL SECURITY;

-- Leitura: auditor vê tudo; o sócio vê só os seus. Escrita é apenas via RPC
-- SECURITY DEFINER abaixo (nenhum INSERT/UPDATE/DELETE direto é concedido).
DROP POLICY IF EXISTS partner_deposits_select_auditor ON public.partner_deposits;
CREATE POLICY partner_deposits_select_auditor ON public.partner_deposits
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'auditor'));

DROP POLICY IF EXISTS partner_deposits_select_own ON public.partner_deposits;
CREATE POLICY partner_deposits_select_own ON public.partner_deposits
  FOR SELECT TO authenticated
  USING (partner_id = auth.uid());

REVOKE ALL ON public.partner_deposits FROM PUBLIC, anon;
GRANT SELECT ON public.partner_deposits TO authenticated;

-- Comprovante do depósito no storage: caminho deposits/<partner_id>/arquivo.
-- Política ADICIONAL (permissiva) — não altera a receipts_insert existente,
-- só acrescenta este caso, então uploads de comprovantes de caixa seguem iguais.
DROP POLICY IF EXISTS receipts_insert_deposits ON storage.objects;
CREATE POLICY receipts_insert_deposits ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND owner = auth.uid()
    AND public.is_approved(auth.uid())
    AND (storage.foldername(name))[1] = 'deposits'
    AND (
      (public.has_role(auth.uid(), 'socio') AND (storage.foldername(name))[2] = auth.uid()::text)
      OR public.has_role(auth.uid(), 'auditor')
    )
  );

-- Registra um depósito. Só o próprio sócio ou um auditor; nunca acima do que o
-- sócio tem em posse (retiradas confirmadas - já depositado).
CREATE OR REPLACE FUNCTION public.create_partner_deposit(
  _partner_id uuid,
  _amount numeric,
  _note text DEFAULT NULL::text,
  _photo_url text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _held numeric;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;
  IF NOT public.has_role(_partner_id, 'socio') THEN
    RAISE EXCEPTION 'O depósito só pode ser registrado para um sócio.';
  END IF;
  IF NOT (_uid = _partner_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão para registrar este depósito.';
  END IF;

  SELECT ROUND(
    COALESCE((SELECT SUM(w.amount) FROM public.partner_withdrawals w
              WHERE w.partner_id = _partner_id AND w.status = 'approved'), 0)
    - COALESCE((SELECT SUM(d.amount) FROM public.partner_deposits d
              WHERE d.partner_id = _partner_id), 0),
    2)
  INTO _held;

  IF _amount > _held + 0.005 THEN
    RAISE EXCEPTION 'Valor acima do que o sócio tem em posse (disponível: %).',
      to_char(_held, 'FM999999990.00');
  END IF;

  INSERT INTO public.partner_deposits (partner_id, amount, note, photo_url, created_by)
  VALUES (
    _partner_id,
    ROUND(_amount, 2),
    NULLIF(btrim(COALESCE(_note, '')), ''),
    NULLIF(btrim(COALESCE(_photo_url, '')), ''),
    _uid
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Saldo por sócio (geral, todas as unidades). Auditor recebe todos os sócios;
-- um sócio recebe apenas a própria linha.
CREATE OR REPLACE FUNCTION public.partner_cash_balances()
RETURNS TABLE (partner_id uuid, full_name text, held numeric, waiting numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH socios AS (
    SELECT ur.user_id AS pid FROM public.user_roles ur WHERE ur.role = 'socio'
  ),
  w AS (
    SELECT pw.partner_id,
           SUM(pw.amount) FILTER (WHERE pw.status = 'approved') AS approved,
           SUM(pw.amount) FILTER (WHERE pw.status = 'pending')  AS pending
    FROM public.partner_withdrawals pw
    GROUP BY pw.partner_id
  ),
  d AS (
    SELECT pd.partner_id, SUM(pd.amount) AS deposited
    FROM public.partner_deposits pd
    GROUP BY pd.partner_id
  )
  SELECT s.pid,
         COALESCE(p.full_name, 'Sócio') AS full_name,
         ROUND(COALESCE(w.approved, 0) - COALESCE(d.deposited, 0), 2) AS held,
         ROUND(COALESCE(w.pending, 0), 2) AS waiting
  FROM socios s
  LEFT JOIN public.profiles p ON p.id = s.pid
  LEFT JOIN w ON w.partner_id = s.pid
  LEFT JOIN d ON d.partner_id = s.pid
  WHERE public.has_role(auth.uid(), 'auditor') OR s.pid = auth.uid()
  ORDER BY held DESC, full_name;
$$;

REVOKE ALL ON FUNCTION public.create_partner_deposit(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partner_deposit(uuid, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.partner_cash_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_cash_balances() TO authenticated;

NOTIFY pgrst, 'reload schema';
