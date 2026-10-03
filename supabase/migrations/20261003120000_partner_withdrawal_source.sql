-- Retirada de sócio: origem do dinheiro (gaveta do caixa ou cofre da unidade).
--
-- Antes, toda retirada descontava do COFRE. Quando o sócio pegava da GAVETA
-- (caso dos R$ 400 da Macelly), o caixa fechava com sobra. Agora o atendente
-- escolhe a origem e o sistema desconta do lugar certo:
--   * source = 'safe'   -> desconta do cofre  (unit_safe_balance), como antes.
--   * source = 'drawer' -> desconta da gaveta (shift_expected_cash / fechamento).
--
-- Linhas antigas recebem 'safe' (comportamento anterior), então nada muda para
-- retiradas já registradas.

ALTER TABLE public.partner_withdrawals
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'safe'
  CHECK (source IN ('drawer', 'safe'));

-- Saldo do cofre: sangrias menos retiradas que saíram DO COFRE (source='safe').
-- As retiradas da gaveta não tocam o cofre.
CREATE OR REPLACE FUNCTION public.unit_safe_balance(_unit_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ROUND(
    COALESCE((
      SELECT SUM(t.amount) FROM public.transactions t
      WHERE t.unit_id = _unit_id
        AND t.transaction_type <> 'income'
        AND t.category = 'Sangria'
        AND t.reverses_transaction_id IS NULL
        AND t.reversed_at IS NULL
    ), 0)
    - COALESCE((
      SELECT SUM(w.amount) FROM public.partner_withdrawals w
      WHERE w.unit_id = _unit_id
        AND w.source = 'safe'
    ), 0)
  , 2);
$function$;

-- Dinheiro esperado na gaveta: abertura + entradas em dinheiro - despesas -
-- sangrias - retiradas de sócio que saíram DA GAVETA (source='drawer').
CREATE OR REPLACE FUNCTION public.shift_expected_cash(_shift_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    - COALESCE((
      SELECT SUM(w.amount) FROM public.partner_withdrawals w
      WHERE w.shift_id = _shift_id
        AND w.source = 'drawer'
    ), 0)
  , 2);
$function$;

-- Pré-checagem da contagem cega do fechamento. Passa a reusar shift_expected_cash
-- (fonte única), mantendo a tolerância de R$ 0,05 e SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.check_shift_cash_count(_shift_id uuid, _quantities jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _status text;
  _counted numeric;
  _expected numeric;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada. Entre novamente.';
  END IF;

  SELECT s.unit_id, s.status INTO _unit, _status
    FROM public.shifts s WHERE s.id = _shift_id;

  IF _unit IS NULL OR _status <> 'open' THEN
    RAISE EXCEPTION 'Este turno não está disponível para conferência.';
  END IF;

  IF NOT (
    (public.current_unit_id() = _unit AND public.is_approved(_uid))
    OR public.has_role(_uid, 'auditor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Você não tem permissão para conferir este caixa.';
  END IF;

  _counted := ROUND(
    COALESCE((_quantities->>'notes_200')::int, 0) * 200
    + COALESCE((_quantities->>'notes_100')::int, 0) * 100
    + COALESCE((_quantities->>'notes_50')::int, 0) * 50
    + COALESCE((_quantities->>'notes_20')::int, 0) * 20
    + COALESCE((_quantities->>'notes_10')::int, 0) * 10
    + COALESCE((_quantities->>'notes_5')::int, 0) * 5
    + COALESCE((_quantities->>'notes_2')::int, 0) * 2
    + COALESCE((_quantities->>'coins_1')::int, 0)
    + COALESCE((_quantities->>'coins_050')::int, 0) * 0.50
    + COALESCE((_quantities->>'coins_025')::int, 0) * 0.25
    + COALESCE((_quantities->>'coins_010')::int, 0) * 0.10
    + COALESCE((_quantities->>'coins_005')::int, 0) * 0.05,
    2
  );

  _expected := public.shift_expected_cash(_shift_id);

  RETURN ROUND(ABS(_counted - _expected), 2) <= 0.05;
END;
$$;

REVOKE ALL ON FUNCTION public.check_shift_cash_count(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_shift_cash_count(uuid, jsonb) TO authenticated, service_role;

-- A retirada ganha o parâmetro _source. A assinatura de 5 args é removida para
-- não reintroduzir ambiguidade de overload (o cliente sempre envia _source).
DROP FUNCTION IF EXISTS public.create_partner_withdrawal(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.create_partner_withdrawal(
  _shift_id uuid,
  _partner_id uuid,
  _amount numeric,
  _note text DEFAULT NULL::text,
  _photo_url text DEFAULT NULL::text,
  _source text DEFAULT 'safe'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _balance numeric;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;
  IF _source NOT IN ('drawer', 'safe') THEN RAISE EXCEPTION 'Origem da retirada inválida.'; END IF;

  SELECT s.unit_id INTO _unit FROM public.shifts s
  WHERE s.id = _shift_id AND s.status = 'open'
  FOR UPDATE;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno não está mais aberto. Atualize a tela.'; END IF;

  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _partner_id AND ur.role = 'socio') THEN
    RAISE EXCEPTION 'A retirada só pode ser feita para um sócio.';
  END IF;

  IF _source = 'safe' THEN
    _balance := public.unit_safe_balance(_unit);
    IF _amount > _balance THEN
      RAISE EXCEPTION 'Valor acima do saldo do cofre (disponível: %).', to_char(_balance, 'FM999999990.00');
    END IF;
  ELSE
    _balance := public.shift_expected_cash(_shift_id);
    IF _amount > _balance THEN
      RAISE EXCEPTION 'Valor acima do dinheiro em caixa (disponível: %).', to_char(_balance, 'FM999999990.00');
    END IF;
  END IF;

  INSERT INTO public.partner_withdrawals (shift_id, unit_id, partner_id, created_by, amount, status, note, photo_url, source)
  VALUES (_shift_id, _unit, _partner_id, _uid, ROUND(_amount, 2), 'pending',
          NULLIF(btrim(COALESCE(_note, '')), ''),
          NULLIF(btrim(COALESCE(_photo_url, '')), ''),
          _source)
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
