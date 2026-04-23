alter table partner_rfp_inbox
  add column if not exists response_deadline timestamptz;
