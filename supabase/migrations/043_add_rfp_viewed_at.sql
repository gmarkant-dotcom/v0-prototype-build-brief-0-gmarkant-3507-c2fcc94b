alter table partner_rfp_inbox
  add column if not exists viewed_at timestamptz;
