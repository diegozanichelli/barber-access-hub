REVOKE ALL ON FUNCTION public.current_unit_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated, service_role;