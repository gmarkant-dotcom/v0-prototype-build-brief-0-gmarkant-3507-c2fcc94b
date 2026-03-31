-- Bid status + feedback workflow for agency review and partner visibility

ALTER TABLE public.partner_rfp_responses
  ADD COLUMN IF NOT EXISTS agency_feedback TEXT,
  ADD COLUMN IF NOT EXISTS feedback_updated_at TIMESTAMPTZ;

-- Keep status as text but enforce allowed values.
ALTER TABLE public.partner_rfp_responses
  DROP CONSTRAINT IF EXISTS partner_rfp_responses_status_check;

ALTER TABLE public.partner_rfp_responses
  ADD CONSTRAINT partner_rfp_responses_status_check
  CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'awarded', 'declined', 'draft'));

-- partner_rfp_inbox status now includes awarded.
ALTER TABLE public.partner_rfp_inbox
  DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check;

ALTER TABLE public.partner_rfp_inbox
  ADD CONSTRAINT partner_rfp_inbox_status_check
  CHECK (status IN ('new', 'viewed', 'bid_submitted', 'feedback_received', 'revision_submitted', 'shortlisted', 'awarded', 'declined'));

-- Agencies can update status/feedback on responses they own.
DROP POLICY IF EXISTS "Agencies update response status and feedback" ON public.partner_rfp_responses;
CREATE POLICY "Agencies update response status and feedback"
ON public.partner_rfp_responses
FOR UPDATE
TO authenticated
USING (agency_id = auth.uid())
WITH CHECK (agency_id = auth.uid());

-- Partners can read feedback/status on their own rows.
DROP POLICY IF EXISTS "Partners read response status and feedback" ON public.partner_rfp_responses;
CREATE POLICY "Partners read response status and feedback"
ON public.partner_rfp_responses
FOR SELECT
TO authenticated
USING (partner_id = auth.uid());
