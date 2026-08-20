-- PostgreSQL requires a newly-added enum value to be committed before another
-- migration can reference it. Keep this migration limited to the enum change.
ALTER TYPE public.transaction_category ADD VALUE IF NOT EXISTS 'Upgrade';
