-- Migration 053: create partner_vouches table for the Triple-Vouched feature
CREATE TABLE IF NOT EXISTS partner_vouches (
  id uuid primary key default gen_random_uuid(),
  voucher_agency_id uuid not null references auth.users(id) on delete cascade,
  vouched_partner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(voucher_agency_id, vouched_partner_id)
);

ALTER TABLE partner_vouches ENABLE ROW LEVEL SECURITY;

-- Count queries are safe (no identifying info)
CREATE POLICY "Anyone can count vouches" ON partner_vouches FOR SELECT USING (true);

-- Lead agencies can add their own vouch
CREATE POLICY "Agencies can vouch" ON partner_vouches FOR INSERT WITH CHECK (auth.uid() = voucher_agency_id);

-- Lead agencies can remove their own vouch
CREATE POLICY "Agencies can remove their vouch" ON partner_vouches FOR DELETE USING (auth.uid() = voucher_agency_id);
