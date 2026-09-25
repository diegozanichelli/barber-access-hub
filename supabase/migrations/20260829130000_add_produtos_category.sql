-- Nova categoria de entrada: Produtos (venda de itens de balcão além de bebida).
--
-- ALTER TYPE ... ADD VALUE precisa ter efetivado antes que qualquer função
-- consiga referenciar o novo literal, por isso a liberação no
-- validate_transaction vem na migration seguinte, como foi feito com Serviços.
ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Produtos';
