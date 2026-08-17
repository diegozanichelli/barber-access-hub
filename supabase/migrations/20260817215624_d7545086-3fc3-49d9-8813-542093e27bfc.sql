GRANT SELECT ON public.units TO anon;
CREATE POLICY units_select_anon ON public.units FOR SELECT TO anon USING (true);