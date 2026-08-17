-- helper: current user's unit
CREATE OR REPLACE FUNCTION public.current_unit_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT unit_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Auditor management of roles
CREATE POLICY user_roles_admin_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'auditor'));
CREATE POLICY user_roles_admin_update ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'auditor')) WITH CHECK (public.has_role(auth.uid(), 'auditor'));
CREATE POLICY user_roles_admin_delete ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'auditor'));

CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'auditor')) WITH CHECK (public.has_role(auth.uid(), 'auditor'));

CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id),
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  closed_by uuid REFERENCES auth.users(id),
  expected_opening_total numeric(12,2) NOT NULL DEFAULT 0,
  actual_opening_total numeric(12,2) NOT NULL DEFAULT 0,
  closing_total numeric(12,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shifts_one_open_per_unit ON public.shifts(unit_id) WHERE status = 'open';
CREATE INDEX shifts_unit_closed_idx ON public.shifts(unit_id, closed_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY shifts_select ON public.shifts FOR SELECT TO authenticated
  USING (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'socio') OR public.has_role(auth.uid(),'supervisor'));
CREATE POLICY shifts_insert ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (opened_by = auth.uid() AND (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor')));
CREATE POLICY shifts_update ON public.shifts FOR UPDATE TO authenticated
  USING (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor'))
  WITH CHECK (unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor'));

CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  count_type text NOT NULL CHECK (count_type IN ('opening','closing')),
  counted_by uuid NOT NULL REFERENCES auth.users(id),
  notes_100 integer NOT NULL DEFAULT 0,
  notes_50 integer NOT NULL DEFAULT 0,
  notes_20 integer NOT NULL DEFAULT 0,
  notes_10 integer NOT NULL DEFAULT 0,
  notes_5 integer NOT NULL DEFAULT 0,
  notes_2 integer NOT NULL DEFAULT 0,
  coins_1 integer NOT NULL DEFAULT 0,
  coins_050 integer NOT NULL DEFAULT 0,
  coins_025 integer NOT NULL DEFAULT 0,
  coins_010 integer NOT NULL DEFAULT 0,
  coins_005 integer NOT NULL DEFAULT 0,
  total_calculated numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, count_type)
);

GRANT SELECT, INSERT ON public.cash_counts TO authenticated;
GRANT ALL ON public.cash_counts TO service_role;
ALTER TABLE public.cash_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_counts_select ON public.cash_counts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = shift_id AND (s.unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'socio') OR public.has_role(auth.uid(),'supervisor'))));
CREATE POLICY cash_counts_insert ON public.cash_counts FOR INSERT TO authenticated
  WITH CHECK (counted_by = auth.uid() AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = shift_id AND (s.unit_id = public.current_unit_id() OR public.has_role(auth.uid(),'auditor'))));