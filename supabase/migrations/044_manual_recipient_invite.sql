alter table partner_rfp_inbox
  add column if not exists invite_token text unique;

alter table partner_rfp_inbox
  add column if not exists invite_token_expires_at timestamptz;

alter table partner_rfp_inbox
  add column if not exists claimed_at timestamptz;

alter table partner_rfp_inbox
  add column if not exists nda_gate_enforced boolean
    not null default false;

alter table partner_rfp_inbox
  add column if not exists nda_confirmed_at timestamptz;

alter table partner_rfp_inbox
  add column if not exists agency_nda_notified_at timestamptz;

create index if not exists idx_partner_rfp_inbox_invite_token
  on partner_rfp_inbox(invite_token)
  where invite_token is not null;

create index if not exists idx_partner_rfp_inbox_unclaimed
  on partner_rfp_inbox(recipient_email, claimed_at)
  where partner_id is null;
