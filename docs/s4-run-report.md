# S4 Overnight Run - Final Report

Four sequential local commits, nothing pushed, no SQL executed against any database. `npx tsc --noEmit` and `pnpm build` both pass clean on the final state.

```
3319e1a docs: S4-2P Phase 2 implementation plan - budget structure
71c6751 feat: S4-1 requirement tiers (required/preferred), pre-migration safe
6796b76 chore: S4-M migration files - requirement tiers + budget structure
8c9fe5e chore: S4-0 discovery - requirement tiers + budget structure
e0afb86 fix: hero eyebrow two-line layout to kill mid-line gap   <- last commit before tonight's run
```

---

## 1. Discovery highlights + spec contradictions

Full detail in `docs/s4-discovery.md`. The short version:

- **Wizard** (`app/agency/page.tsx`, one 2,700+ line file, no per-step files): business criteria requirements are edited in one step's JSX, held in a single `masterRfp` state object, mutated by small `update*` handlers. No wizard-state library.
- **Bid form**: two independent files, no shared component existed before tonight - `app/partner/rfps/[id]/page.tsx` (portal) and `app/rfp/respond/[token]/page.tsx` (guest). **Both write to the same `partner_rfp_responses` table** (guest bids are just nullable `partner_id`/`inbox_item_id` rows there, confirmed via migration 057's history) - this is why one migration and one write-guard pattern cover both paths.
- **Genuine gap found, not in the original spec's framing**: neither bid-form path prefilled business criteria from the vendor's profile before tonight. Every bid started blank unless the vendor had already bid on that exact RFP. Built for the portal path only tonight, per spec ("guest has no profile").
- **Types are hand-rolled everywhere**, no generated Supabase types file exists in the repo. This directly shaped the Phase 1 typing approach: new fields are optional properties on existing hand-rolled types, read through `normalize*` functions that treat "absent" as "not present yet," not regenerated from anywhere.

**Two material spec contradictions, flagged rather than silently adapted:**

1. **"A priority column on the criteria/requirements structure, backfilled to preferred."** The schema has no per-criterion rows to add a column to - `business_criteria_required` is a single JSONB blob per RFP, with a fixed, code-defined key set (`DESIGNATION_KEYS`/`INSURANCE_KEYS` in `lib/business-criteria.ts`), stored in two different places depending on which of the two broadcast flows created the RFP. There's no reliable way to blind-backfill a nested per-key JSONB shape from a generic migration without risking silent corruption on shapes never reviewed. **Resolution:** priority lives as new JSONB keys added at the application layer (no schema change for this part); migration 071's real, needed work became the cannot-meet acknowledgment column instead, which genuinely is new data with no existing home. No SQL backfill runs anywhere - RFPs with zero explicit priority data are instead detected (`hasExplicitPriorityData()`) and rendered with the exact pre-tier legacy UI, which achieves "current RFPs are unaffected" without literally setting a stored value.
2. **Compliance-matrix cannot-meet reason text isn't visible in compare/detail view yet.** The column exists after 071 and the write path saves it, but `bid-compare-view.tsx` and `bid-detail-sheet.tsx` both fetch bids through explicit Supabase `.select()` column lists (not `select("*")`) that don't name this new column - adding it tonight would 500 the entire bid list page until 071 is applied, which is exactly the class of pre-migration breakage this run was told to avoid. Met/unmet status and the pass/fail count work today regardless (computed from data that's already selected); only the reason *text* is deferred. Flagged as a real, working-but-incomplete state, not skipped.

## 2. OPEN QUESTIONS (autonomy rule - logged, not blocking)

None of these stopped the run; each was resolved with the conservative choice and is listed here per the autonomy rule.

1. **Should the literal "backfill to preferred" SQL statement be attempted anyway, accepting some risk?** Conservative choice made: no - see contradiction #1 above. If you want existing RFPs to carry an explicit `preferred` tag (rather than just falling back to the legacy UI, which is functionally equivalent from a user's perspective), that needs a deliberate, reviewed one-off script against the two known JSONB locations, not a blind migration. Flag if you disagree with this being deferred.
2. **"Confirm all" semantics for designations with sub-fields** (certifying body, certification number, self-certification): confirmed-all sets `holds = true` for every required item but does not auto-fill certifying-body/certification-number text fields, since those can't be guessed. Vendor still needs to fill them in if not self-certifying. Conservative choice: don't fabricate data into free-text fields.
3. **Where does the new required/preferred UI go relative to the pre-existing untiered UI in the two bid-form files?** Both old and new blocks are literally present in the JSX, gated by `hasExplicitPriorityData(...)` so only one ever renders. Chose this over deleting the old block, since the old block is exactly what's needed for every RFP created before tonight.
4. **Wizard "Confirm all" button placement / interaction pattern**: built as a plain segmented two-way pill (`PriorityToggle`) matching existing button-group patterns already in this wizard (e.g. group-by toggles elsewhere in the app), not a new control type.
5. **Whether to touch the guest page's separate READ-ONLY preview list** (a second, non-interactive summary of required criteria shown before the actual bid form opens): left untouched. It only ever renders label text, has no priority-specific logic to break, and touching it would have been scope creep beyond "adding the new controls in existing patterns."

## 3. Migration files summary

Both authored as plain SQL files in `supabase/migrations/`. **Neither has been run against any database, tonight or ever.**

- **`071_requirement_tiers.sql`**: adds `business_criteria_acknowledgments jsonb NULL` to `partner_rfp_responses`. That's the entire schema change - see contradiction #1 above for why priority itself needed no column. Commented-out verification queries at the bottom of the file.
- **`072_budget_structure.sql`**: creates `rfp_budget_categories` (ordered, name, preset origin, always-present flagged "Additional items" enforced via a partial unique index, dual nullable FK to whichever of the two RFP-creation-flow parent tables created the RFP) and `bid_budget_lines` (category ref, description, amount, sort, `is_subtotal` flag implementing the subtotal-or-itemize duality). Not wired to any application code. RLS deliberately not written tonight - flagged in the file's own comments as a required Phase 2 task rather than guessed blind.
- **`docs/s4-migrations-runbook.md`**: exact apply order (071 first and only, tonight; 072 waits for Phase 2 execution day), expected verification results, and rollback statements for both.

## 4. Phase 1 file-by-file summary

| File | Change |
|---|---|
| `lib/business-criteria.ts` | Core extension: `RequirementPriority` type, `designationPriority`/`insurancePriority`/`coiPriority` added to `BusinessCriteriaRequired` (new optional fields alongside the existing gate fields, not replacing them), `hasExplicitPriorityData()`, `getDesignationPriority()`/`getInsurancePriority()`/`getCoiPriority()` (all default to `"required"` when tier data is genuinely missing for one item on an otherwise-tiered RFP - never silently softened), `CriterionAcknowledgment`/`BusinessCriteriaAcknowledgments` types + `normalizeAcknowledgments()`, and `computeRequirementCompliance()` - the single shared function every other surface below calls. |
| `components/business-criteria-requirement-block.tsx` | **New.** Theme-aware (`light`/`dark`) shared required/preferred confirmation block used by both bid-form paths. Renders `null` when `hasTierData` is false. |
| `app/agency/page.tsx` | New `PriorityToggle` component (two-way segmented pill). Wired into the three requirement rows (designations, insurance, COI) in the wizard's Business Criteria step. New requirements default to `preferred`. |
| `app/partner/rfps/[id]/page.tsx` | Acknowledgment state, profile-prefill fetch (new, no prior equivalent existed) with `profileCriteriaHolds` tracked separately for the "Confirmed from your profile" badge, `confirmAllRequiredCriteria()`, conditional render (tiered block vs. untouched legacy block), submit payload write-guard. |
| `app/rfp/respond/[token]/page.tsx` | Same shape as the portal path, minus profile prefill (no profile on the guest path). Dark-themed instance of the shared block. |
| `app/api/partner/rfps/[id]/response/route.ts` | `saveResponseRow()` write-guard helper: attempts the write with acknowledgments, retries once without that field on a Postgres `42703` (undefined_column) error. Applies to both the update and insert code paths. |
| `app/api/rfp/guest/[token]/route.ts` | Same guard pattern (`saveGuestResponseRow()`), applied to both the edit-update and fresh-insert paths. |
| `lib/bid-shared.ts` | `business_criteria_acknowledgments?: unknown` added to `BidRow` (forward-compat; undefined until a follow-up adds the column to the two read surfaces' SELECT lists - see contradiction #2). |
| `components/bid-compare-view.tsx` | New "Meets required" `<TableRow>`, inserted immediately before the existing Score row. Renders `-` for any bid whose RFP has no tier data, a real Yes/No + confirmed-count + per-item unmet reasons otherwise. Legacy "Business Criteria" row left untouched. |
| `components/bid-detail-sheet.tsx` | New compliance block at the top of the Analysis tab, before AI Analysis and before the separate Evaluate tab (scoring). Same `hasTierData` gate. |
| `lib/glossary.ts` + `docs/glossary-content.md` | "Required criterion" / "Preferred criterion" entries added. |
| `docs/ligament-design-language.md` | Decision-log entry 30. |

### Playwright / verification results

- **tsc + build**: clean at every commit boundary, confirmed again on the final state.
- **Pure-function logic checks** (`lib/business-criteria.ts`'s `computeRequirementCompliance`, run via `tsx` against real code, no DB): pre-migration fallback renders nothing for untagged data (PASS), required/preferred classification correct (PASS), a cannot-meet acknowledgment counts toward "N of M confirmed" without ever counting as met (PASS), a genuinely met required item passes `meetsAllRequired` (PASS).
- **Guest respond page** (`/rfp/respond/[token]`, public, no auth): loaded with zero console/page errors against a nonexistent token (expected 404 flow) - confirms the guarded pre-migration code path doesn't crash on a cold, unauthenticated request.
- **Blocked, not skipped**: the wizard (`/agency`) and both authenticated bid-form pages sit behind this app's real auth middleware, which requires a genuine Supabase session. Reaching them to interactively exercise the new `PriorityToggle`, `Confirm all`, cannot-meet reason field, and progress line would require either real credentials against the live database or faked/mocked auth - both out of bounds for "local fixtures only, never any remote DB." Demo mode (`NEXT_PUBLIC_IS_DEMO=true`) does not bypass auth for `/agency` or `/partner/rfps/[id]` (confirmed by testing - it redirected straight to `/auth/login`), and existing demo fixtures in `lib/demo-data.ts` carry no explicit priority-tier data to exercise the new bid-form rendering path even if auth weren't the wall. **This is the single largest verification gap tonight** - recommend it be the very first thing checked in the morning's live smoke test (see checklist below).

### What awaits the migration

- Cannot-meet reasons persist to a real column in `partner_rfp_responses` only after 071 is applied - before that, the write-guard silently retries without that field (bid submission still succeeds, the reason is simply not stored yet).
- Cannot-meet reason *text* won't be visible in compare view or bid detail until a follow-up separately adds `business_criteria_acknowledgments` to those two surfaces' explicit SELECT column lists (deliberately not done tonight - see contradiction #2).

## 5. Phase 2 plan summary

`docs/s4-phase2-plan.md` - full detail there, headline structure:

1. New wizard step, "Budget Categories" (own step, not folded into an existing one) - presets, custom free-text, CSV seeding via `spreadsheet-import-panel.tsx`'s existing parse path.
2. New shared bid-form component (same theme-aware pattern as tonight's requirement block) with subtotal-or-itemize-on-demand per category and a fully specified paste-from-spreadsheet parser (tab-separated, currency-symbol stripping, skip-and-flag on bad lines matching this repo's existing partner-import house style).
3. Compare view gets a second table (category identity is shared across bids being compared, which today's single freeform budget string can't support at all).
4. Guest parity is structurally simpler than tonight's feature - there's no profile-dependent branch to build, since budget categories have no vendor-profile source to prefill from either path.
5. Eight judgment calls, each phrased as a question with a stated recommendation, none blocking - collected in the plan's closing section for a fast scan.

Migration 072 is authored and ready; RLS policies for its two new tables are explicitly deferred to Phase 2 execution day rather than guessed blind tonight.

---

## MORNING CHECKLIST

1. **Apply migration 071** in Supabase SQL Editor - paste `supabase/migrations/071_requirement_tiers.sql` (everything above the "Verification" comment block), run it. Expect "Success. No rows returned."
2. **Run 071's verification queries** (commented out at the bottom of the file, or copied into `docs/s4-migrations-runbook.md`) and confirm expected results:
   - `business_criteria_acknowledgments` column exists on `partner_rfp_responses`, type `jsonb`, nullable, default `NULL`.
   - `count(*) WHERE business_criteria_acknowledgments IS NOT NULL` = `0`.
3. **Only then**, `git push` the five unpushed commits (`e0afb86` through `3319e1a` - the hero-eyebrow fix plus all four S4 commits are all still local-only).
4. **Live smoke tests** (explicit list, since tonight's Playwright pass couldn't reach any of these behind the auth wall):
   - In the wizard's Business Criteria step, toggle a designation to Required, save/broadcast the RFP, confirm the tier persists on reload.
   - Open that RFP's bid as a real vendor (portal path): confirm the required item renders in the new block, "Confirm all" works, toggling "Cannot meet" reveals the reason field and blocks nothing on submit.
   - Repeat the same bid via a Magic Link guest URL for the same RFP: confirm parity (dark theme, same required-first ordering, same progress line, no profile-prefill badge since guests have no profile).
   - As the agency, open Bid Management → Compare on that RFP: confirm the new "Meets required" row appears before the Score row and reflects the vendor's actual answers.
   - Open the same bid's detail sheet, Analysis tab: confirm the compliance block appears above AI Analysis.
   - Create or open an RFP from *before* tonight's change (no tier data) and confirm its bid form and compare/detail view render exactly as they did before this run - no compliance row, no crash, no fake "fully compliant."
5. **Migration 072 waits** until Phase 2 execution begins. Do not apply it as part of tonight's cleanup - read `docs/s4-phase2-plan.md` first when that day comes, and write the RLS policies it deliberately left out before applying it.
