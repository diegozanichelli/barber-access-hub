-- Rastreabilidade da retirada de sócio: foto opcional do comprovante de entrega
ALTER TABLE public.partner_withdrawals
  ADD COLUMN IF NOT EXISTS photo_url text;

-- Marca de notificação ao auditor (alerta de divergência enviado uma única vez)
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS dispute_notified_at timestamptz;
ALTER TABLE public.partner_withdrawals
  ADD COLUMN IF NOT EXISTS dispute_notified_at timestamptz;

-- Recria a RPC com o novo parâmetro opcional _photo_url
CREATE OR REPLACE FUNCTION public.create_partner_withdrawal(
  _shift_id uuid,
  _partner_id uuid,
  _amount numeric,
  _note text DEFAULT NULL::text,
  _photo_url text DEFAULT NULL::text
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

  SELECT s.unit_id INTO _unit FROM public.shifts s
  WHERE s.id = _shift_id AND s.status = 'open'
  FOR UPDATE;

  IF _unit IS NULL THEN RAISE EXCEPTION 'Este turno não está mais aberto. Atualize a tela.'; END IF;

  IF NOT (public.current_unit_id() = _unit OR public.has_role(_uid, 'auditor')) THEN
    RAISE EXCEPTION 'Você não tem permissão nesta unidade.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _partner_id AND ur.role = 'socio') THEN
    RAISE EXCEPTION 'A retirada só pode ser feita para um sócio.';
  END IF;

  _balance := public.unit_safe_balance(_unit);
  IF _amount > _balance THEN
    RAISE EXCEPTION 'Valor acima do saldo do cofre (disponível: %).', to_char(_balance, 'FM999999990.00');
  END IF;

  INSERT INTO public.partner_withdrawals (shift_id, unit_id, partner_id, created_by, amount, status, note, photo_url)
  VALUES (_shift_id, _unit, _partner_id, _uid, ROUND(_amount, 2), 'pending',
          NULLIF(btrim(COALESCE(_note, '')), ''),
          NULLIF(btrim(COALESCE(_photo_url, '')), ''))
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

-- Mantém a assinatura antiga chamável (sem foto) para compatibilidade
GRANT EXECUTE ON FUNCTION public.create_partner_withdrawal(uuid, uuid, numeric, text, text) TO authenticated;