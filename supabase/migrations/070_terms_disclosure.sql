-- Terms Alignment Phase 1: structured vendor term disclosures at bid time.
--
-- The two RFP creation flows persist broadcast config on different tables with no shared
-- parent record - the RFP Broadcast wizard writes one row per (partner x scope item)
-- directly to partner_rfp_inbox (no parent broadcast entity), and the magic-link flow
-- upserts one row per (agency, project, vendor_email) to rfp_magic_tokens. Each gets its
-- own require_terms_disclosure column rather than a single shared flag.
--
-- DEFAULT true is intentional and retroactive: every already-broadcast RFP - including
-- ones with a bid already submitted - starts requiring disclosure from the next
-- submission/edit onward, per product decision.
ALTER TABLE partner_rfp_inbox
  ADD COLUMN IF NOT EXISTS require_terms_disclosure boolean NOT NULL DEFAULT true;

ALTER TABLE rfp_magic_tokens
  ADD COLUMN IF NOT EXISTS require_terms_disclosure boolean NOT NULL DEFAULT true;

-- Structured four-term disclosure captured with a bid. NULL = not disclosed (legacy bids
-- predating this feature, or RFPs where disclosure was optional and the vendor skipped
-- it) - readers must render "No terms disclosed", never infer values. Shape documented
-- in lib/terms-disclosure.ts and shared by both write paths (partner portal + guest) and
-- all readers (bid-detail-sheet, agency-broadcast-responses, bid-compare-view).
ALTER TABLE partner_rfp_responses
  ADD COLUMN IF NOT EXISTS terms_disclosure jsonb NULL;

-- Partner's saved default terms ("handle compliance once"), prefilled on future bids and
-- editable per bid. Same shape as terms_disclosure. Guests never read/write this column.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_terms jsonb NULL;

-- Verification
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_name = 'partner_rfp_inbox' AND column_name = 'require_terms_disclosure')
   OR (table_name = 'rfp_magic_tokens' AND column_name = 'require_terms_disclosure')
   OR (table_name = 'partner_rfp_responses' AND column_name = 'terms_disclosure')
   OR (table_name = 'profiles' AND column_name = 'default_terms')
ORDER BY table_name, column_name;
