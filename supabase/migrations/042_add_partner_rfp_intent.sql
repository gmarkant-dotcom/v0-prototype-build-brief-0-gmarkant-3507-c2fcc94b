alter table partner_rfp_inbox
  add column if not exists partner_intent text
  check (partner_intent in (
    'will_respond',
    'has_questions',
    'requesting_call'
  ));

alter table partner_rfp_inbox
  add column if not exists intent_set_at timestamptz;
