-- Nova categoria de entrada: Serviços (corte, barba e demais atendimentos).
--
-- ALTER TYPE ... ADD VALUE precisa ter efetivado antes que qualquer função
-- consiga referenciar o novo literal, por isso a liberação no
-- validate_transaction vem na migration seguinte, como foi feito com Upgrade.
ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Serviços';
