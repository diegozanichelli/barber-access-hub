-- Incidente: supervisor não conseguia fechar o caixa — "Você não tem permissão
-- para esta ação nesta unidade" ao clicar em Confirmar fechamento.
--
-- Causa: a migration 20260911211708 recriou check_shift_cash_count como
-- SECURITY INVOKER (a versão anterior, 211650, era SECURITY DEFINER). Como
-- INVOKER, a função roda com as permissões de quem chama e lê shifts/
-- transactions e chama current_unit_id()/is_approved()/has_role() sob a RLS do
-- supervisor; algo aí é negado e o Postgres levanta um "permission denied" em
-- inglês, que a UI traduz para a mensagem acima.
--
-- Correção: voltar para SECURITY DEFINER, como todas as outras RPCs de caixa.
-- É seguro porque a função já faz a própria checagem de permissão (unidade
-- atual aprovada, ou auditor) antes de qualquer cálculo. O corpo é o mesmo da
-- 211708 (cálculo embutido, sem depender de cash_total/shift_expected_cash).
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

  SELECT s.unit_id, s.status
    INTO _unit, _status
    FROM public.shifts s
   WHERE s.id = _shift_id;

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

  SELECT ROUND(
    s.actual_opening_total
    + COALESCE(SUM(CASE
        WHEN t.transaction_type = 'income' AND t.payment_method = 'Dinheiro' THEN t.amount
        WHEN t.transaction_type = 'income' THEN 0
        WHEN t.category::text = 'Troco' AND t.payment_method = 'Pix' THEN t.amount
        WHEN t.category::text = 'Troco' THEN 0
        ELSE -t.amount
      END) FILTER (
        WHERE t.reverses_transaction_id IS NULL
          AND t.reversed_at IS NULL
      ), 0),
    2
  )
    INTO _expected
    FROM public.shifts s
    LEFT JOIN public.transactions t ON t.shift_id = s.id
   WHERE s.id = _shift_id
   GROUP BY s.actual_opening_total;

  RETURN ABS(_counted - _expected) < 0.005;
END;
$$;

REVOKE ALL ON FUNCTION public.check_shift_cash_count(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_shift_cash_count(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
