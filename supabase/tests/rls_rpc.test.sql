BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(10);

SELECT has_function(
  'public', 'delete_empty_open_shift', ARRAY['uuid', 'text'],
  'atomic opening deletion RPC is installed'
);
SELECT has_function(
  'public', 'master_delete_transaction', ARRAY['uuid', 'text'],
  'atomic master transaction deletion RPC is installed'
);

-- Stable fixture IDs make auth.uid() and ownership assertions readable.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partner@test.local', '', now(), now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attendant@test.local', '', now(), now());

INSERT INTO public.units (id, name)
VALUES ('00000000-0000-0000-0000-000000000201', 'Unidade teste RLS');

UPDATE public.profiles
SET unit_id = '00000000-0000-0000-0000-000000000201', status = 'pending'
WHERE id = '00000000-0000-0000-0000-000000000101';
UPDATE public.profiles
SET unit_id = '00000000-0000-0000-0000-000000000201', status = 'approved'
WHERE id IN (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000102', 'socio'),
  ('00000000-0000-0000-0000-000000000103', 'atendente');

INSERT INTO public.shifts (
  id, unit_id, opened_by, actual_opening_total, expected_opening_total, status
) VALUES (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000103', 100, 100, 'open'
);
INSERT INTO public.partner_withdrawals (
  id, shift_id, unit_id, partner_id, created_by, amount, status
) VALUES (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103', 50, 'pending'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SELECT is((SELECT count(*)::integer FROM public.shifts), 0, 'pending user cannot read shifts');
SELECT is((SELECT count(*)::integer FROM public.transactions), 0, 'pending user cannot read transactions');
SELECT throws_ok(
  $$ SELECT public.open_shift('00000000-0000-0000-0000-000000000201', '{}'::jsonb, NULL) $$,
  'P0001', 'Cadastro não aprovado.', 'pending user cannot invoke cash RPC'
);
SELECT is(public.unit_safe_balance('00000000-0000-0000-0000-000000000201'), 0::numeric, 'pending user receives no safe balance');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
SELECT is(
  public.respond_partner_withdrawal(
    '00000000-0000-0000-0000-000000000401', 'approved'
  )::text,
  'approved',
  'partner can approve their pending withdrawal'
);
SELECT throws_ok(
  $$ SELECT public.respond_partner_withdrawal('00000000-0000-0000-0000-000000000401', 'disputed') $$,
  'P0001', 'Retirada pendente não encontrada ou já respondida.',
  'partner cannot answer the same withdrawal twice'
);

RESET ROLE;
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-000000000103', 'supervisor') $$,
  '23505', NULL, 'database permits only one role per user'
);
SELECT is(
  (SELECT count(*)::integer FROM public.user_roles WHERE user_id = '00000000-0000-0000-0000-000000000103'),
  1,
  'failed second role leaves the original role intact'
);

SELECT * FROM finish();
ROLLBACK;
