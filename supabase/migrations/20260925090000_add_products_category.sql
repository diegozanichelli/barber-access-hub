-- Keep the enum change in its own transaction. PostgreSQL only permits the new
-- value to be referenced after this migration has committed.
ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Produtos';
