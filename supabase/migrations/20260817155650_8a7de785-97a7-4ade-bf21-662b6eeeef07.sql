ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check CHECK (status IN ('open','pending_handover','closed','disputed'));

CREATE TYPE public.withdrawal_status AS ENUM ('pending','approved','disputed');

CREATE TABLE public.partner_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id),
  partner_id uuid NOT NULL REFERENCES auth.users(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  amount numeric NOT NULL CHECK (amount > 0),
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.partner_withdrawals TO authenticated;
GRANT ALL ON public.partner_withdrawals TO service_role;

ALTER TABLE public.partner_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_withdrawals_select ON public.partner_withdrawals FOR SELECT TO authenticated
USING (
  unit_id = public.current_unit_id()
  OR partner_id = auth.uid()
  OR public.has_role(auth.uid(),'auditor')
  OR public.has_role(auth.uid(),'socio')
  OR public.has_role(auth.uid(),'supervisor')
);

CREATE POLICY partner_withdrawals_insert ON public.partner_withdrawals FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor'))
  AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = shift_id AND s.unit_id = partner_withdrawals.unit_id AND s.status = 'open')
);

CREATE POLICY partner_withdrawals_update ON public.partner_withdrawals FOR UPDATE TO authenticated
USING (partner_id = auth.uid() OR public.has_role(auth.uid(),'auditor'))
WITH CHECK (partner_id = auth.uid() OR public.has_role(auth.uid(),'auditor'));

CREATE TRIGGER partner_withdrawals_set_updated_at BEFORE UPDATE ON public.partner_withdrawals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX partner_withdrawals_shift_idx ON public.partner_withdrawals(shift_id);
CREATE INDEX partner_withdrawals_partner_status_idx ON public.partner_withdrawals(partner_id, status);

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(),'auditor')
  OR public.has_role(auth.uid(),'socio')
  OR public.has_role(auth.uid(),'supervisor')
);

CREATE OR REPLACE FUNCTION public.list_partners()
RETURNS TABLE (id uuid, full_name text, unit_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.unit_id
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'socio'
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_partners() TO authenticated;

CREATE OR REPLACE FUNCTION public.user_display_names(_ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name FROM public.profiles p WHERE p.id = ANY(_ids);
$$;

GRANT EXECUTE ON FUNCTION public.user_display_names(uuid[]) TO authenticated;