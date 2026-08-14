-- Structured proposal sub-fields + close-bidding-at-deadline (Phase 2, P2-2 and P2-4).
-- Authored Aug 11, 2026. NOT APPLIED.
--
-- STATUS NOT SETTLED BY THE SNAPSHOT: docs/schema-snapshot-2026-08-13.md is a pg_policies
-- dump, and this migration adds columns rather than policies, so the snapshot can neither
-- confirm nor refute the line above. Migration 077 carried an identical "NOT APPLIED" header
-- while its policy was live, so do not trust this status either. Settle it with:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = '<table>';
-- Split from 075 deliberately: 075 alters an existing NOT NULL and adds a CHECK to a live
-- scoring table. This file is purely additive - two nullable columns and two boolean flags with
-- a safe default - so it can be applied and rolled back independently of the scoring work.
--
-- ---------------------------------------------------------------------------------------
-- 1. Structured proposal sub-fields (P2-2)
-- ---------------------------------------------------------------------------------------
-- partner_rfp_responses.proposal_text is free prose today and stays exactly that. This column
-- sits ALONGSIDE it and never replaces it: four optional, skippable, guided sub-fields that a
-- vendor may fill instead of, or as well as, writing one block of prose.
--
--   proposal_sections: {
--     approach:    string | null,   -- how they will do the work
--     experience:  string | null,   -- relevant past work
--     team:        string | null,   -- team and capacity
--     assumptions: string | null    -- assumptions and risks
--   }
--
-- NULL means "this bid predates the feature, or the vendor skipped every sub-field" - readers
-- render the prose alone and nothing else, exactly as they do today. An individual key being
-- null or empty means that one section was skipped and must not render at all. Never infer a
-- section from the prose; never show an empty labelled heading.
--
-- Deliberately a single JSONB rather than four text columns: the set is a product decision that
-- will change (a fifth guided field is a copy edit, not a migration), and the codebase already
-- treats bid-side structured captures this way (business_criteria_responses, terms_disclosure).

ALTER TABLE partner_rfp_responses
  ADD COLUMN IF NOT EXISTS proposal_sections jsonb NULL;

-- ---------------------------------------------------------------------------------------
-- 2. Close bidding at deadline (P2-4)
-- ---------------------------------------------------------------------------------------
-- DEFAULT false is the standing ruling, and is the opposite of migration 070's deliberately
-- retroactive DEFAULT true: bidding stays open past the deadline unless an agency opts in.
-- Applying this migration must not silently close a single RFP that is open today, including
-- ones already past their deadline.
--
-- Two columns, not one, for the same reason 070 needed two: the two RFP creation flows have no
-- shared parent record. The wizard writes one partner_rfp_inbox row per (recipient x scope
-- item); the magic-link flow upserts one rfp_magic_tokens row per (agency, project, vendor).
--
-- The flag alone never closes anything. Closure is (close_bidding_at_deadline = true) AND
-- (response_deadline IS NOT NULL) AND (response_deadline < now()) - a flag with no deadline set
-- is inert, and is treated as inert by every surface rather than as an error.

ALTER TABLE partner_rfp_inbox
  ADD COLUMN IF NOT EXISTS close_bidding_at_deadline boolean NOT NULL DEFAULT false;

ALTER TABLE rfp_magic_tokens
  ADD COLUMN IF NOT EXISTS close_bidding_at_deadline boolean NOT NULL DEFAULT false;

-- Agency-side reading and awarding of already-submitted bids is never gated on this flag. A
-- closed RFP stops accepting new and revised submissions; it does not hide history.

-- Verification (run manually after applying; not part of the migration):
--
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE (table_name = 'partner_rfp_responses' AND column_name = 'proposal_sections')
--    OR (table_name = 'partner_rfp_inbox' AND column_name = 'close_bidding_at_deadline')
--    OR (table_name = 'rfp_magic_tokens' AND column_name = 'close_bidding_at_deadline')
-- ORDER BY table_name, column_name;
-- -- Expected: 3 rows.
-- --   partner_rfp_inbox.close_bidding_at_deadline    boolean  NO   false
-- --   partner_rfp_responses.proposal_sections        jsonb    YES  NULL
-- --   rfp_magic_tokens.close_bidding_at_deadline     boolean  NO   false
--
-- SELECT count(*) FROM partner_rfp_responses WHERE proposal_sections IS NOT NULL;
-- -- Expected: 0
--
-- SELECT count(*) AS inbox_closed FROM partner_rfp_inbox WHERE close_bidding_at_deadline;
-- SELECT count(*) AS token_closed FROM rfp_magic_tokens WHERE close_bidding_at_deadline;
-- -- Expected: 0, 0. THIS IS THE IMPORTANT ONE - a non-zero result here means the default
-- -- landed wrong and live RFPs were closed by the act of applying this migration.
