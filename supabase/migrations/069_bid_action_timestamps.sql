-- Bid action timestamps (LIGAMENT_CONTEXT.md backlog P14): partner_rfp_responses.status
-- only ever tracked current state, not when it changed, so shortlisted/meeting_requested/
-- declined never had a real timestamp to show on a timeline or in an activity feed. Adding
-- three nullable columns, set going forward wherever the corresponding status transition
-- happens (agency-side PATCH route) - no backfill, historical transitions have no known
-- time and a guessed one would not be honest.
ALTER TABLE partner_rfp_responses
  ADD COLUMN IF NOT EXISTS shortlisted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_requested_at timestamptz;
