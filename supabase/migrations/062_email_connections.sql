-- Migration 062: email_connections table for email import (partner pool seeding).
-- Phase 1 is Google/Gmail only; provider is already a CHECK-constrained enum so
-- Microsoft can be added in Phase 2 without a schema change.
--
-- user_id references auth.users(id), matching the FK convention already used by
-- partner_vouches.voucher_agency_id/vouched_partner_id (migration 053) and
-- partnerships.msa_confirmed_by (migration 051) elsewhere in this schema -
-- profiles.id IS auth.users.id throughout this app, so this is equivalent to
-- "FK profiles" in practice while matching existing convention.
--
-- Verified no conflict: no email_connections table/references exist anywhere in
-- prior migrations or the codebase (grepped supabase/migrations/, app/, lib/).
CREATE TABLE IF NOT EXISTS email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text,
  connected_at timestamptz default now(),
  last_scan_at timestamptz,
  scan_status text default 'idle' check (scan_status in ('idle', 'scanning', 'complete', 'error')),
  scan_results jsonb,
  status text default 'active' check (status in ('active', 'revoked', 'expired')),
  unique(user_id, provider)
);

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own email connections"
ON email_connections
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
