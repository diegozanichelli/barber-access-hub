GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_partners() TO authenticated;

DELETE FROM public.user_roles
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'cassiano.diego@gmail.com')
  AND role <> 'auditor';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'auditor'::public.app_role FROM auth.users WHERE email = 'cassiano.diego@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;