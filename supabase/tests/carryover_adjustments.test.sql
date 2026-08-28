BEGIN;
SELECT plan(3);

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
