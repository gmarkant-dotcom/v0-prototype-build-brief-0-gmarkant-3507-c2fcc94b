-- Ghost partnerships (magic link auto-add to partner pool) + domain-match flagging.
--
-- Schema check performed before writing this migration: partner_email already exists
-- on partnerships (part of the pre-tracked core schema, migrations 001-038 - confirmed
-- in active use by app/api/partnerships/route.ts and referenced by migration 045's RLS
-- policy), so it is NOT re-added here. profile_status, pool_status, and
-- domain_match_profile_id do not exist anywhere in the schema or codebase - all new.
--
-- profile_status distinguishes a partnerships row with a real linked profile ('active')
-- from a ghost row created for a guest bidder who has no Ligament account yet
-- ('unclaimed'). Existing rows all default to 'active' since they already carry a
-- resolvable partner_id or predate this feature.
ALTER TABLE partnerships
  ADD COLUMN IF NOT EXISTS profile_status text DEFAULT 'active';

-- pool_status records the outcome of the guest-bid auto-classification (see
-- app/api/rfp/guest/[token]/route.ts): 'existing_user_added', 'ghost_created', or
-- 'domain_match_flagged'. domain_match_profile_id points at the existing profile whose
-- company domain matched the guest's email domain, for the "Domain Match - Review" flag
-- shown on /agency/pool.
ALTER TABLE rfp_magic_tokens
  ADD COLUMN IF NOT EXISTS pool_status text,
  ADD COLUMN IF NOT EXISTS domain_match_profile_id uuid REFERENCES profiles(id);
