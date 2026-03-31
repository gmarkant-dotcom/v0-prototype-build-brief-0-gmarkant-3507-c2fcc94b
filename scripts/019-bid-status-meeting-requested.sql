-- Add meeting_requested status support for agency/partner bid workflow

ALTER TABLE public.partner_rfp_responses
  DROP CONSTRAINT IF EXISTS partner_rfp_responses_status_check;

ALTER TABLE public.partner_rfp_responses
  ADD CONSTRAINT partner_rfp_responses_status_check
  CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'meeting_requested', 'awarded', 'declined', 'draft'));

ALTER TABLE public.partner_rfp_inbox
  DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check;

ALTER TABLE public.partner_rfp_inbox
  ADD CONSTRAINT partner_rfp_inbox_status_check
  CHECK (
    status IN (
      'new',
      'viewed',
      'bid_submitted',
      'feedback_received',
      'revision_submitted',
      'shortlisted',
      'meeting_requested',
      'awarded',
      'declined'
    )
  );
