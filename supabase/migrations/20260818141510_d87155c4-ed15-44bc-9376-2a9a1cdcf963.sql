DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS requested_role public.app_role,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE public.profiles SET status = 'approved', approved_at = COALESCE(approved_at, now())
WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.status = 'approved');
$$;

GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _unit uuid;
  _role public.app_role;
BEGIN
  BEGIN
    _unit := NULLIF(NEW.raw_user_meta_data ->> 'unit_id','')::uuid;
  EXCEPTION WHEN others THEN _unit := NULL;
  END;
  BEGIN
    _role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role',''), 'atendente')::public.app_role;
  EXCEPTION WHEN others THEN _role := 'atendente';
  END;
  IF _role = 'auditor' THEN _role := 'atendente'; END IF;

  INSERT INTO public.profiles (id, full_name, unit_id, status, requested_role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name',''), _unit, 'pending', _role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;