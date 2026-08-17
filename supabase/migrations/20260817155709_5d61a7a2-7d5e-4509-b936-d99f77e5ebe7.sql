DROP FUNCTION IF EXISTS public.user_display_names(uuid[]);
REVOKE ALL ON FUNCTION public.list_partners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_partners() TO authenticated;