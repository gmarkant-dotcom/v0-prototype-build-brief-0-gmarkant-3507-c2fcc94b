-- Replace legacy URL columns with unified attachments JSONB on partner_rfp_responses.
-- Run after 014 if already applied.

ALTER TABLE public.partner_rfp_responses DROP CONSTRAINT IF EXISTS partner_rfp_responses_max_three_urls;

ALTER TABLE public.partner_rfp_responses ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.partner_rfp_responses DROP COLUMN IF EXISTS work_example_urls;
ALTER TABLE public.partner_rfp_responses DROP COLUMN IF EXISTS proposal_document_url;
ALTER TABLE public.partner_rfp_responses DROP COLUMN IF EXISTS proposal_deck_link;

ALTER TABLE public.partner_rfp_responses DROP CONSTRAINT IF EXISTS partner_rfp_responses_max_six_attachments;
ALTER TABLE public.partner_rfp_responses ADD CONSTRAINT partner_rfp_responses_max_six_attachments CHECK (
  jsonb_array_length(COALESCE(attachments, '[]'::jsonb)) <= 6
);
