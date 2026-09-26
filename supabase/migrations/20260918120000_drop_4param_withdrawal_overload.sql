-- Remove overload ambiguity: the 4-param version is superseded by the 5-param
-- one (added in 20260828201541) which already has DEFAULT NULL for both _note
-- and _photo_url. PostgreSQL cannot choose between them when callers omit the
-- optional fields, so the old signature must be dropped.
DROP FUNCTION IF EXISTS public.create_partner_withdrawal(uuid, uuid, numeric, text);
