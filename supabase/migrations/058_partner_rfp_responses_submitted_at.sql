-- Support editable magic-link guest bids: the guest RFP respond page's "Edit Bid" flow
-- (app/api/rfp/guest/[token]/route.ts POST with is_edit: true) updates the existing
-- partner_rfp_responses row and stamps submitted_at = now() on every (re)submission.
-- Additive only.

ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Backfill from the original insert time for existing rows so "Submitted on ..." dates
-- in the guest UI aren't blank for bids submitted before this column existed.
UPDATE partner_rfp_responses SET submitted_at = updated_at WHERE submitted_at IS NULL;
