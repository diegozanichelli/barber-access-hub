BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'master-change@test.local', '', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attendant-change@test.local', '', now(), now());

INSERT INTO public.units (id, name) VALUES ('10000000-0000-0000-0000-000000000010', 'Unidade teste mudanças');
UPDATE public.profiles SET status = 'approved', unit_id = '10000000-0000-0000-0000-000000000010'
WHERE id IN ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', 'auditor'),
  ('10000000-0000-0000-0000-000000000002', 'atendente');

INSERT INTO public.shifts (id, unit_id, opened_by, status, actual_opening_total, expected_opening_total)
VALUES
  ('10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'open', 100, 100),
  ('10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'closed', 100, 100);
INSERT INTO public.transactions (id, shift_id, unit_id, user_id, transaction_type, category, client_name, payment_method, amount)
VALUES
  ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'income', 'Bebida', 'Cliente Teste', 'Dinheiro', 10),
  ('10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'income', 'Bebida', 'Cliente Teste', 'Dinheiro', 20),
  ('10000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'income', 'Bebida', 'Outro Cliente', 'Dinheiro', 30);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT lives_ok($$ SELECT public.request_transaction_change('10000000-0000-0000-0000-000000000030', 'edit', 'corrigir valor', 12, NULL) $$, 'open shift accepts a request');
SELECT throws_ok($$ SELECT public.request_transaction_change('10000000-0000-0000-0000-000000000031', 'delete', 'erro fechado', NULL, NULL) $$, 'P0001', 'Turno já encerrado. Solicite um estorno para preservar o fechamento.', 'closed shift rejects direct changes');

RESET ROLE;
UPDATE public.transactions SET amount = 11 WHERE id = '10000000-0000-0000-0000-000000000030';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public.decide_transaction_change_request((SELECT id FROM public.transaction_change_requests WHERE transaction_id = '10000000-0000-0000-0000-000000000030'), true, NULL) $$, 'P0001', 'O lançamento mudou após a solicitação. Revise os dados e crie uma nova solicitação.', 'snapshot mismatch blocks approval');
SELECT throws_ok($$ SELECT public.master_delete_transaction('10000000-0000-0000-0000-000000000031', 'não apagar fechado') $$, 'P0001', 'Turno já encerrado. Use um estorno para preservar o fechamento.', 'master cannot delete from closed shift');
SELECT lives_ok($$ SELECT public.master_delete_transaction('10000000-0000-0000-0000-000000000032', 'duplicidade confirmada') $$, 'master can atomically delete from open shift');
SELECT is((SELECT count(*)::integer FROM public.transaction_change_requests WHERE transaction_snapshot->>'id' = '10000000-0000-0000-0000-000000000032' AND status = 'approved'), 1, 'master deletion preserves an approved snapshot');

SELECT * FROM finish();
ROLLBACK;
