# S4 Phase 2 Implementation Plan: Budget Structure

Docs-only, authored during the S4 overnight run alongside migration 072 (`supabase/migrations/072_budget_structure.sql`, not applied). No feature code from this plan should exist yet - if it does, something jumped ahead of schedule. This is tomorrow's execution prompt, not tonight's build.

## 0. Prerequisites before starting

1. Migration 071 applied and verified (see `docs/s4-migrations-runbook.md`) - Phase 2 code should be written against a codebase that already pushed S4-1.
2. Migration 072 applied and verified (same runbook, "Applying 072" section) - do this at the START of Phase 2 execution day, not before.
3. RLS policies for `rfp_budget_categories` and `bid_budget_lines` written and applied (072 deliberately ships without them - see its own comments). Recommended shape, matching the existing `partner_rfp_inbox` / `partner_rfp_responses` pattern:
   - `rfp_budget_categories`: agency can `ALL` where they own the parent `partner_rfp_inbox`/`rfp_magic_tokens` row; vendor can `SELECT` where they'd already pass `partnerCanAccessPartnerRfpInbox()` (or the guest-token equivalent) for that RFP.
   - `bid_budget_lines`: vendor can `ALL` their own rows (via `response_id` -> `partner_rfp_responses.partner_id = auth.uid()`, or the guest path's existing token-scoped access check); agency can `SELECT` where they own the parent RFP.
   - **Question, my recommendation:** should guests (unauthenticated, token-scoped) be allowed to write `bid_budget_lines` directly via RLS, or should all guest writes route through a service-role API route (matching how `app/api/rfp/guest/[token]/route.ts` already writes `partner_rfp_responses` today)? *Recommendation: service-role route, matching the existing guest pattern exactly - RLS can't evaluate a magic-link token, only Postgres auth.uid(), so guest writes already bypass RLS via the service client today (see partner_id nullability for guest rows) and budget lines should follow the same precedent rather than invent a new access model.*

## 1. Wizard: category builder

New step (or new section within the existing "Business criteria" step - **question, my recommendation:** own step vs. shared step? *Recommendation: own step, "Budget Categories," inserted after Business Criteria and before Scope Allocation - 5-10 categories with presets/custom/CSV is enough surface area to crowd an existing step, and the wizard already treats each concern as its own step.*).

Three entry methods, in the existing wizard's card/list interaction pattern (matches how scope items and criteria already render as a `space-y-3` list of bordered rows with add/remove controls - no new interaction pattern to invent):

- **Presets:** a fixed starter list (candidates: Production, Post-Production, Talent/Cast, Location, Equipment, Crew, Travel & Per Diem, Contingency, Agency Fee - **question, my recommendation:** who owns the canonical preset list, product or engineering-default? *Recommendation: ship a sensible engineering default (the 9 above), let Greg edit copy in a follow-up - do not block Phase 2 on final category-name bikeshedding.*). Agency clicks to add a preset category; `preset_origin` stores `'preset:production'` etc.
- **Custom:** free-text name input + add button, same pattern as the terms-disclosure notes field. `preset_origin = 'custom'`.
- **CSV seeding:** reuse `components/spreadsheet-import-panel.tsx`'s existing parse muscle (already handles the Partner Import flow's CSV/paste parsing - the "existing spreadsheet-import muscle" the spec names). Two-column expectation: category name, optional starting amount hint (dropped - categories don't carry amounts, only vendors do, per the subtotal-or-itemize duality). `preset_origin = 'csv'`.
- **Additional items:** created automatically, once, server-side or on first wizard load for a new RFP - never manually addable/removable, matches the "always-present flagged" spec language and the partial-unique-index constraint in 072 that enforces exactly one per RFP.

5-10 category cap: soft warning past 10 (matches how other wizard steps warn rather than hard-block on count - **question, my recommendation:** hard cap or soft warning? *Recommendation: soft warning, consistent with the rest of this wizard's validation posture - nothing else in it hard-blocks on count.*).

## 2. Bid form: categories with itemize-on-demand

Both portal and guest paths (parity mandatory, per spec) - build as a second shared component alongside `business-criteria-requirement-block.tsx`, same theme-aware pattern (`theme: "light" | "dark"` prop), same reasoning: two bid-form paths, two visual atmospheres, one component.

Per category, default state: single subtotal input (matches today's `budget_proposal` single-field pattern in `lib/rfp-response-fields.ts`). "Itemize" toggle/link expands to a sub-line list (label + amount rows, add/remove, matches the existing `draftAttachments`-style add/remove list pattern already used for attachments in both bid forms) - subtotal then becomes a computed, read-only sum displayed but not stored as its own `bid_budget_lines` row (matches 072's `is_subtotal` design: only one row type exists at a time per category).

**Paste-from-spreadsheet spec** (tab-separated label+amount rows, pasted into an expanded/itemized category):

- Parse: split on newlines, then each line split on the first tab character. Left of tab = description, right = amount.
- Currency normalization: strip `$`, `,`, whitespace; reject (skip, flag) a line whose remaining text isn't a valid number after stripping. **Question, my recommendation:** reject the whole paste on any bad line, or skip bad lines and import the rest with a per-line flag? *Recommendation: skip-and-flag, matching `spreadsheet-import-panel.tsx`'s existing partner-import behavior (grouped review: New / Already in pool / Invalid, per-row reasons) - this codebase already has a house style for "import what's valid, show what wasn't" and paste-from-spreadsheet should match it rather than being all-or-nothing.*
- No currency symbol/locale beyond USD-style `$1,234.56` assumed for v1 - **question, my recommendation:** support other currency symbols in the paste parser? *Recommendation: no, not for Phase 2 v1 - the rest of the budget/bid system (`lib/rfp-response-fields.ts`'s `BUDGET_CURRENCY_OPTIONS`) already has a currency picker pattern; if multi-currency paste turns out to matter, extend the parser then rather than guessing which symbols to support now.*
- Each valid parsed row becomes one `bid_budget_lines` row with `is_subtotal = false`.

Always show the flagged "Additional items" category last, visually distinguished (matches the "flagged" spec language - **question, my recommendation:** what does "flagged" mean visually? *Recommendation: same amber/warning treatment already used for the 80%-usage banner and similar soft-warning UI elsewhere in the app - not destructive-red, not silent, consistent with the existing warning-color semantic.*).

## 3. Compare view: category table with expandable itemization

New section in `bid-compare-view.tsx`, likely its own `<Table>` below the existing dimension table (budget categories don't fit as a single row the way "Score"/"Budget"/"Timeline" do - there are N categories, each needing its own row, so this is structurally a second table, not one more row in the first). One row per category (agency-defined, so category identity is shared across all bids being compared - a real win over today's single freeform `budget_proposal` string, which can't be compared category-by-category at all), one column per bid, cell shows the subtotal (derived or stored) with an expand affordance revealing itemized sub-lines when present. "Additional items" row always last, flagged.

**Question, my recommendation:** how to handle a bid that didn't itemize a category another bid did? *Recommendation: show the subtotal only for that bid's cell, no fake itemization - matches the honesty doctrine ("no fake data") already governing every other surface in this app.*

## 4. Guest parity notes

Everything in sections 1-3 must work identically for guest bids (`app/rfp/respond/[token]/page.tsx` + `app/api/rfp/guest/[token]/route.ts`) - no profile-dependent behavior exists in the budget feature (unlike requirement tiers' profile-prefill, budget categories have no vendor-profile source to prefill from at all, so there is no light/portal-only branch to build here - genuinely simpler parity than S4-1's). Guest writes route through the service-role guest API route, matching the RLS recommendation in section 0.

## 5. Judgment calls summary (all phrased as question + recommendation above, collected here for scanning)

1. Own wizard step vs. shared step for category builder -> **own step.**
2. Guest RLS-direct-write vs. service-role route for budget lines -> **service-role route**, matching existing guest precedent.
3. Canonical preset category list ownership -> **ship engineering default, let Greg edit copy later.**
4. 5-10 category cap: hard block vs. soft warning -> **soft warning**, matching wizard's existing validation posture.
5. Paste-parser bad-line handling: reject-all vs. skip-and-flag -> **skip-and-flag**, matching `spreadsheet-import-panel.tsx`'s house style.
6. Multi-currency paste support -> **no, USD-style only for v1.**
7. "Flagged" Additional Items visual treatment -> **existing amber/warning color semantic.**
8. Mismatched itemization across bids in compare view -> **show subtotal only, no fake itemization.**

None of these block starting Phase 2 execution - each has a stated default. Revisit only if Greg disagrees with a specific recommendation.
