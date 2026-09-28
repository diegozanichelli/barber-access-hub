-- Cash totals are authoritative in PostgreSQL. Clients send denomination counts,
-- never a trusted total or expected closing balance.
CREATE OR REPLACE FUNCTION public.cash_quantities_total(_quantities jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _field text;
  _raw text;
  _total numeric := 0;
  _fields constant text[] := ARRAY[
    'notes_200', 'notes_100', 'notes_50', 'notes_20', 'notes_10', 'notes_5', 'notes_2',
    'coins_1', 'coins_050', 'coins_025', 'coins_010', 'coins_005'
  ];
BEGIN
  IF _quantities IS NULL OR jsonb_typeof(_quantities) <> 'object' THEN
    RAISE EXCEPTION 'Contagem de caixa inválida.';
  END IF;

  FOREACH _field IN ARRAY _fields LOOP
    _raw := COALESCE(_quantities ->> _field, '0');
    IF _raw !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Quantidade inválida para %.', _field;
    END IF;
    IF _raw::numeric > 1000000 THEN
      RAISE EXCEPTION 'Quantidade acima do limite para %.', _field;
    END IF;
  END LOOP;

  _total :=
      COALESCE((_quantities ->> 'notes_200')::integer, 0) * 200
    + COALESCE((_quantities ->> 'notes_100')::integer, 0) * 100
    + COALESCE((_quantities ->> 'notes_50')::integer, 0) * 50
    + COALESCE((_quantities ->> 'notes_20')::integer, 0) * 20
    + COALESCE((_quantities ->> 'notes_10')::integer, 0) * 10
    + COALESCE((_quantities ->> 'notes_5')::integer, 0) * 5
    + COALESCE((_quantities ->> 'notes_2')::integer, 0) * 2
    + COALESCE((_quantities ->> 'coins_1')::integer, 0) * 1
    + COALESCE((_quantities ->> 'coins_050')::integer, 0) * 0.50
    + COALESCE((_quantities ->> 'coins_025')::integer, 0) * 0.25
    + COALESCE((_quantities ->> 'coins_010')::integer, 0) * 0.10
    + COALESCE((_quantities ->> 'coins_005')::integer, 0) * 0.05;

  RETURN ROUND(_total, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cash_count(
  _shift_id uuid,
  _count_type text,
  _counted_by uuid,
  _quantities jsonb,
  _notes text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _total numeric := public.cash_quantities_total(_quantities);
BEGIN
  INSERT INTO public.cash_counts (
    shift_id, count_type, counted_by,
    notes_200, notes_100, notes_50, notes_20, notes_10, notes_5, notes_2,
    coins_1, coins_050, coins_025, coins_010, coins_005,
    total_calculated, notes
  ) VALUES (
    _shift_id, _count_type, _counted_by,
    COALESCE((_quantities ->> 'notes_200')::integer, 0),
    COALESCE((_quantities ->> 'notes_100')::integer, 0),
    COALESCE((_quantities ->> 'notes_50')::integer, 0),
    COALESCE((_quantities ->> 'notes_20')::integer, 0),
    COALESCE((_quantities ->> 'notes_10')::integer, 0),
    COALESCE((_quantities ->> 'notes_5')::integer, 0),
    COALESCE((_quantities ->> 'notes_2')::integer, 0),
    COALESCE((_quantities ->> 'coins_1')::integer, 0),
    COALESCE((_quantities ->> 'coins_050')::integer, 0),
    COALESCE((_quantities ->> 'coins_025')::integer, 0),
    COALESCE((_quantities ->> 'coins_010')::integer, 0),
    COALESCE((_quantities ->> 'coins_005')::integer, 0),
    _total, NULLIF(btrim(COALESCE(_notes, '')), '')
  );
  RETURN _total;
END;
$$;

CREATE OR REPLACE FUNCTION public.shift_expected_closing(_shift_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(
    s.actual_opening_total
    + COALESCE(SUM(
      CASE
        WHEN t.transaction_type = 'income' AND t.payment_method = 'Dinheiro' THEN t.amount
        WHEN t.transaction_type <> 'income' THEN -t.amount
        ELSE 0
      END
    ) FILTER (
      WHERE t.reverses_transaction_id IS NULL AND t.reversed_at IS NULL
    ), 0),
    2
  )
  FROM public.shifts s
  LEFT JOIN public.transactions t ON t.shift_id = s.id
  WHERE s.id = _shift_id
  GROUP BY s.id, s.actual_opening_total;
$$;

-- Remove the client-trusting overloads before publishing the new signatures.
REVOKE ALL ON FUNCTION public.open_shift(uuid, jsonb, numeric, text) FROM authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_shift(uuid, jsonb, numeric, numeric, text) FROM authenticated, service_role;
REVOKE ALL ON FUNCTION public.receive_handover(uuid, jsonb, numeric, text) FROM authenticated, service_role;
DROP FUNCTION public.open_shift(uuid, jsonb, numeric, text);
DROP FUNCTION public.close_shift(uuid, jsonb, numeric, numeric, text);
DROP FUNCTION public.receive_handover(uuid, jsonb, numeric, text);

CREATE FUNCTION public.open_shift(
  _unit_id uuid,
  _quantities jsonb,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _expected numeric;
  _shift uuid;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF NOT (
    public.has_role(_uid, 'atendente') OR public.has_role(_uid, 'supervisor') OR public.has_role(_uid, 'auditor')
  ) THEN RAISE EXCEPTION 'Você não tem permissão para abrir o caixa.'; END IF;
  IF NOT (public.current_unit_id() = _unit_id OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE unit_id = _unit_id AND status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE unit_id = _unit_id AND status = 'pending_handover') THEN
    RAISE EXCEPTION 'Há um turno aguardando repasse. Receba o turno pendente.';
  END IF;

  SELECT COALESCE(closing_total, 0) INTO _expected
  FROM public.shifts
  WHERE unit_id = _unit_id AND status = 'closed' AND closing_total IS NOT NULL
  ORDER BY closed_at DESC LIMIT 1;

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit_id, _uid, COALESCE(_expected, 0), public.cash_quantities_total(_quantities), 'open')
  RETURNING id INTO _shift;

  PERFORM public.record_cash_count(_shift, 'opening', _uid, _quantities, _notes);
  RETURN _shift;
END;
$$;

CREATE FUNCTION public.close_shift(
  _shift_id uuid,
  _quantities jsonb,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _total numeric;
  _expected numeric;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF NOT (
    public.has_role(_uid, 'atendente') OR public.has_role(_uid, 'supervisor') OR public.has_role(_uid, 'auditor')
  ) THEN RAISE EXCEPTION 'Você não tem permissão para fechar o caixa.'; END IF;

  SELECT unit_id INTO _unit FROM public.shifts
  WHERE id = _shift_id AND status = 'open' FOR UPDATE;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno já foi fechado. Atualize a tela.'; END IF;
  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;

  _total := public.record_cash_count(_shift_id, 'closing', _uid, _quantities, _notes);
  _expected := public.shift_expected_closing(_shift_id);

  UPDATE public.shifts
  SET status = 'pending_handover', closing_total = _total,
      expected_closing_total = _expected, closed_by = _uid, closed_at = now()
  WHERE id = _shift_id;

  RETURN jsonb_build_object(
    'total', _total,
    'expected', _expected,
    'difference', ROUND(_total - _expected, 2)
  );
END;
$$;

CREATE FUNCTION public.receive_handover(
  _pending_shift_id uuid,
  _quantities jsonb,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit uuid;
  _expected numeric;
  _total numeric;
  _matches boolean;
  _new_shift uuid;
BEGIN
  IF _uid IS NULL OR NOT public.is_approved(_uid) THEN RAISE EXCEPTION 'Cadastro não aprovado.'; END IF;
  IF NOT (
    public.has_role(_uid, 'atendente') OR public.has_role(_uid, 'supervisor') OR public.has_role(_uid, 'auditor')
  ) THEN RAISE EXCEPTION 'Você não tem permissão para receber o caixa.'; END IF;

  SELECT unit_id, COALESCE(closing_total, 0) INTO _unit, _expected
  FROM public.shifts
  WHERE id = _pending_shift_id AND status = 'pending_handover' FOR UPDATE;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Este repasse já foi recebido. Atualize a tela.'; END IF;
  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE unit_id = _unit AND status = 'open') THEN
    RAISE EXCEPTION 'Já existe um caixa aberto nesta unidade.';
  END IF;

  _total := public.record_cash_count(_pending_shift_id, 'handover', _uid, _quantities, _notes);
  _matches := abs(_expected - _total) < 0.005;

  UPDATE public.shifts SET status = CASE WHEN _matches THEN 'closed' ELSE 'disputed' END
  WHERE id = _pending_shift_id;

  INSERT INTO public.shifts (unit_id, opened_by, expected_opening_total, actual_opening_total, status)
  VALUES (_unit, _uid, _expected, _total, 'open') RETURNING id INTO _new_shift;
  PERFORM public.record_cash_count(_new_shift, 'opening', _uid, _quantities, _notes);

  RETURN jsonb_build_object(
    'shift_id', _new_shift, 'matches', _matches, 'expected', _expected, 'total', _total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cash_quantities_total(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_cash_count(uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_expected_closing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_shift(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_handover(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_handover(uuid, jsonb, text) TO authenticated, service_role;

-- Enforce transaction/category/evidence invariants even when PostgREST is called
-- directly. Reversal rows are generated only by reverse_transaction and retain
-- the original category for their audit trail.
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
    IF NEW.category NOT IN ('Bebida', 'Assinatura Nova', 'Renovação') OR NEW.payment_method IS NULL THEN
      RAISE EXCEPTION 'Categoria ou pagamento inválido para uma entrada.';
    END IF;
    IF length(btrim(COALESCE(NEW.client_name, ''))) < 3 THEN
      RAISE EXCEPTION 'Informe o nome completo do cliente.';
    END IF;
    IF length(NEW.client_name) > 120 THEN
      RAISE EXCEPTION 'Nome do cliente acima do limite permitido.';
    END IF;
    IF (NEW.category IN ('Assinatura Nova', 'Renovação') OR NEW.payment_method = 'Pix')
       AND NEW.photo_url IS NULL THEN
      RAISE EXCEPTION 'Comprovante obrigatório para assinatura ou Pix.';
    END IF;
  ELSIF NEW.transaction_type = 'expense' THEN
    IF NEW.category NOT IN ('Despesa', 'Sangria') OR NEW.payment_method IS NOT NULL THEN
      RAISE EXCEPTION 'Categoria ou pagamento inválido para uma saída.';
    END IF;
    IF NEW.category = 'Despesa' AND (
      length(btrim(COALESCE(NEW.description, ''))) < 3 OR NEW.photo_url IS NULL
    ) THEN
      RAISE EXCEPTION 'Descrição e comprovante são obrigatórios para despesas.';
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

DROP TRIGGER IF EXISTS transactions_validate ON public.transactions;
CREATE TRIGGER transactions_validate
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_transaction();

DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert
ON public.transactions
FOR INSERT TO authenticated
WITH CHECK (
  public.is_approved(auth.uid())
  AND (
    public.has_role(auth.uid(), 'atendente')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'auditor')
  )
  AND user_id = auth.uid()
  AND reverses_transaction_id IS NULL
  AND reversed_by IS NULL
  AND reversed_at IS NULL
  AND (unit_id = public.current_unit_id() OR public.has_role(auth.uid(), 'auditor'))
  AND EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = shift_id AND s.unit_id = transactions.unit_id AND s.status = 'open'
  )
);

REVOKE ALL ON FUNCTION public.validate_transaction() FROM PUBLIC, anon, authenticated;

-- Receipt paths are unit_id/shift_id/file. Operational users can access only
-- their approved unit; auditors can access every unit. Partners have no receipt
-- access because their dashboard does not expose financial evidence.
DROP POLICY IF EXISTS receipts_insert ON storage.objects;
CREATE POLICY receipts_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND owner = auth.uid()
  AND public.is_approved(auth.uid())
  AND (
    (
      public.has_role(auth.uid(), 'auditor')
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id::text = split_part(name, '/', 2)
          AND s.unit_id::text = split_part(name, '/', 1)
          AND s.status = 'open'
      )
    )
    OR (
      split_part(name, '/', 1) = public.current_unit_id()::text
      AND (
        public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'supervisor')
      )
      AND EXISTS (
        SELECT 1 FROM public.shifts s
        WHERE s.id::text = split_part(name, '/', 2)
          AND s.unit_id = public.current_unit_id()
          AND s.status = 'open'
      )
    )
  )
);

DROP POLICY IF EXISTS receipts_select ON storage.objects;
CREATE POLICY receipts_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND public.is_approved(auth.uid())
  AND (
    public.has_role(auth.uid(), 'auditor')
    OR (
      split_part(name, '/', 1) = public.current_unit_id()::text
      AND (
        public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'supervisor')
      )
    )
  )
);

DROP POLICY IF EXISTS receipts_delete_admin ON storage.objects;
CREATE POLICY receipts_delete_admin
ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'auditor'));
