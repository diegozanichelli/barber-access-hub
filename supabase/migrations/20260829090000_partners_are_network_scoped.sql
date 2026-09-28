-- Partners are network-scoped identities. A unit on their profile is both
-- misleading and dangerous because application code may accidentally filter
-- their withdrawal access by current_unit_id(). Normalize existing data and
-- enforce the invariant for future role/profile updates.
UPDATE public.profiles p
SET unit_id = NULL
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id AND ur.role IN ('socio', 'auditor')
)
OR (p.status = 'pending' AND p.requested_role IN ('socio', 'auditor'));

CREATE OR REPLACE FUNCTION public.normalize_network_role_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('socio', 'auditor') THEN
    UPDATE public.profiles SET unit_id = NULL WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_normalize_network_unit ON public.user_roles;
CREATE TRIGGER user_roles_normalize_network_unit
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.normalize_network_role_unit();

CREATE OR REPLACE FUNCTION public.enforce_profile_role_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'pending' AND NEW.requested_role IN ('socio', 'auditor')) OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = NEW.id AND ur.role IN ('socio', 'auditor')
    ) THEN
    NEW.unit_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_role_scope ON public.profiles;
CREATE TRIGGER profiles_enforce_role_scope
BEFORE INSERT OR UPDATE OF unit_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_scope();

REVOKE ALL ON FUNCTION public.normalize_network_role_unit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_profile_role_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_network_role_unit() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profile_role_scope() TO service_role;
