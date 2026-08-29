BEGIN;
SELECT plan(6);

SELECT has_function(
  'public',
  'unit_expected_opening_total',
  ARRAY['uuid'],
  'existe uma fonte única para o saldo esperado da próxima abertura'
);

SELECT function_privs_are(
  'public',
  'unit_expected_opening_total',
  ARRAY['uuid'],
  'anon',
  ARRAY[]::text[],
  'usuários anônimos não podem consultar o saldo esperado'
);

SELECT function_returns(
  'public',
  'unit_expected_opening_total',
  ARRAY['uuid'],
  'numeric',
  'o saldo reconstruído mantém precisão monetária'
);

SELECT has_function(
  'public',
  'unit_expected_opening_total_v2',
  ARRAY['uuid'],
  'a versão cumulativa do cálculo está publicada'
);

SELECT function_privs_are(
  'public',
  'unit_expected_opening_total_v2',
  ARRAY['uuid'],
  'anon',
  ARRAY[]::text[],
  'a versão cumulativa também bloqueia usuários anônimos'
);

SELECT function_privs_are(
  'public',
  'unit_expected_opening_total',
  ARRAY['uuid'],
  'authenticated',
  ARRAY['EXECUTE'],
  'usuários autenticados usam a função com validação interna de unidade'
);

SELECT * FROM finish();
ROLLBACK;
