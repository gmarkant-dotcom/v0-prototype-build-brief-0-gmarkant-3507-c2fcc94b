-- Budget structure (Phase 2 PLAN - authored tonight per S4-M, NOT applied, NOT wired to any
-- application code yet; see docs/s4-phase2-plan.md for the execution plan that consumes
-- this schema). Do not run this migration until Phase 2 execution day.
--
-- Agencies define 5-10 budget categories per RFP in the wizard (presets, custom, or CSV
-- seeding). Vendors enter one subtotal per category, or expand to itemize with sub-lines
-- that roll up (the subtotal then becomes derived/read-only in the UI, not stored). An
-- "Additional items" category is always present and flagged. Guest path parity is
-- mandatory - both bid_budget_lines and rfp_budget_categories are keyed the same way
-- business_criteria_required is today (nullable FK to each of the two RFP-creation-flow
-- parent tables, mirroring the dual-path pattern from migration 070).

CREATE TABLE IF NOT EXISTS rfp_budget_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one of these two is set, matching which broadcast flow created the RFP
  -- (wizard -> partner_rfp_inbox, magic link -> rfp_magic_tokens). Both nullable + a CHECK
  -- rather than a single polymorphic column, matching how business_criteria_required is
  -- already split across the two tables rather than unified.
  inbox_item_id uuid NULL REFERENCES partner_rfp_inbox(id) ON DELETE CASCADE,
  magic_token_id uuid NULL REFERENCES rfp_magic_tokens(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- 'preset:<key>' for a picked preset, 'custom' for agency-typed, 'csv' for CSV-seeded.
  -- Free text, not an enum - the preset key list lives in application code
  -- (docs/s4-phase2-plan.md) and will grow without a migration if left as text.
  preset_origin text NULL,
  -- The always-present, always-flagged "Additional items" category - exactly one per RFP,
  -- enforced by the partial unique index below, not a CHECK (CHECK can't count sibling rows).
  is_additional_items boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfp_budget_categories_exactly_one_parent
    CHECK (
      (inbox_item_id IS NOT NULL AND magic_token_id IS NULL) OR
      (inbox_item_id IS NULL AND magic_token_id IS NOT NULL)
    )
);

-- At most one "Additional items" category per RFP per flow (partial unique index, since a
-- plain UNIQUE constraint can't be conditional on is_additional_items = true).
CREATE UNIQUE INDEX IF NOT EXISTS rfp_budget_categories_one_additional_per_inbox
  ON rfp_budget_categories (inbox_item_id)
  WHERE is_additional_items = true AND inbox_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rfp_budget_categories_one_additional_per_token
  ON rfp_budget_categories (magic_token_id)
  WHERE is_additional_items = true AND magic_token_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rfp_budget_categories_inbox_item_id_idx ON rfp_budget_categories (inbox_item_id);
CREATE INDEX IF NOT EXISTS rfp_budget_categories_magic_token_id_idx ON rfp_budget_categories (magic_token_id);

CREATE TABLE IF NOT EXISTS bid_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES partner_rfp_responses(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, not CASCADE: if an agency edits/removes a category after a vendor
  -- has already bid against it, the vendor's submitted line survives as history rather than
  -- silently vanishing from their own bid. category_name_snapshot preserves the label.
  category_id uuid NULL REFERENCES rfp_budget_categories(id) ON DELETE SET NULL,
  category_name_snapshot text NOT NULL,
  -- NULL for the category's single subtotal line; set for each itemized sub-line under it.
  -- A category has either one subtotal row (is_subtotal = true, description NULL) or N
  -- itemized rows (is_subtotal = false each) - never both. The subtotal-when-itemized value
  -- is derived client-side as SUM(amount), never stored, so it can never drift from its
  -- sub-lines.
  description text NULL,
  amount numeric(12, 2) NOT NULL,
  is_subtotal boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_budget_lines_subtotal_has_no_description
    CHECK (NOT is_subtotal OR description IS NULL)
);

CREATE INDEX IF NOT EXISTS bid_budget_lines_response_id_idx ON bid_budget_lines (response_id);
CREATE INDEX IF NOT EXISTS bid_budget_lines_category_id_idx ON bid_budget_lines (category_id);

-- RLS: matches the existing partner_rfp_responses / partner_rfp_inbox pattern - agencies
-- manage their own RFPs' categories, vendors read the categories for RFPs they can already
-- see (via the same access path partner_inbox_access.ts already gates), and each side
-- manages its own budget lines. Deliberately not enabled yet (RLS off, like every table
-- above is created with default Postgres behavior) - Phase 2 execution should write and
-- test these policies against the real access patterns rather than have them guessed here
-- blind. Flagged in docs/s4-phase2-plan.md as a required Phase 2 task, not an oversight.

-- Verification (run manually after applying, not part of the migration itself):
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('rfp_budget_categories', 'bid_budget_lines');
-- -- Expected: both rows present
--
-- SELECT conname FROM pg_constraint
-- WHERE conname IN ('rfp_budget_categories_exactly_one_parent', 'bid_budget_lines_subtotal_has_no_description');
-- -- Expected: both rows present
--
-- SELECT count(*) FROM rfp_budget_categories;
-- SELECT count(*) FROM bid_budget_lines;
-- -- Expected: 0, 0 (brand new tables, nothing writes to them until Phase 2 code ships)
