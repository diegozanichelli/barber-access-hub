-- The application has exactly one dashboard role per user. Keep the most
-- privileged/current role when cleaning legacy duplicates, then enforce it.
WITH ranked_roles AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE role
          WHEN 'auditor' THEN 1
          WHEN 'socio' THEN 2
          WHEN 'supervisor' THEN 3
          ELSE 4
        END,
        created_at DESC,
        id
    ) AS position
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked_roles ranked
WHERE ur.id = ranked.id AND ranked.position > 1;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_one_role_per_user UNIQUE (user_id);
