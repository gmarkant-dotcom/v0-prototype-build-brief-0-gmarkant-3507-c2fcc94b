# Phase 2 Trio Run Report

Aug 11, 2026. Six commits, P2-0 through P2-4, none pushed. **No SQL was executed against any
database at any point in this run.** All three migrations are authored as files only.

| Commit | What |
| --- | --- |
| `b5565d3` | P2-0 plan reconciliation (docs only) |
| `9931d25` | P2-M migrations 072 re-authored, 075, 076 authored; runbook rewritten |
| `3a898f7` | P2-1 budget structure |
| `be5311a` | P2-2 structured proposal sub-fields |
| `8d108c7` | P2-3 per-RFP evaluation criteria |
| `9f0abb9` | P2-4 close bidding at deadline |

`npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after every commit. Markdown-link corruption
scan clean. No em dashes introduced.

---

## 1. Reconciliation highlights

Full document: `docs/p2-reconciliation.md`.

**The plan's compare-view premise was false.** `docs/s4-phase2-plan.md` §3 claims "category
identity is shared across all bids being compared." Against migration 072's Aug 5 draft it is
not: `broadcast-rfp` writes one `partner_rfp_inbox` row per (scope item x recipient), so
categories parented on `inbox_item_id` are copied per row with distinct UUIDs, and two vendors
bidding the same scope item hold budget lines pointing at different category rows with the same
name. The compare view would have had to reconcile by name anyway - defeating the relational
model entirely. 072 was re-authored (it had never been applied, so this cost nothing).

**Verified live schema before authoring anything** (one read-only OpenAPI metadata fetch, not a
query): 071 is applied, 074 is applied, 072 has never been applied, and none of the six new
columns exist anywhere.

**Prerequisite 3 of the plan dissolved.** The re-authored 072 creates no tables, so there is no
new RLS surface to write policies for.

---

## 2. The eight judgment calls

All eight adopted. Four unchanged, four resolved toward a newer ruling or component.

| # | Question | Plan's recommendation | Adopted | Conflict resolved |
| --- | --- | --- | --- | --- |
| 1 | Own wizard step vs shared | Own step, after Business Criteria | **Shared step** | Yes. This run's scope guard forbids restyling the wizard beyond adding blocks. A new step renumbers 3 to 6, rewrites the step-nav rail, and resumes every in-flight localStorage draft on the wrong step (`currentStep` is persisted). Both new blocks are `GlassCard`s inside the existing Step 2. |
| 2 | Guest RLS write vs service-role route | Service-role route | **Adopted, question dissolved** | The re-authored schema stores budget lines as a column on `partner_rfp_responses`, the exact row the guest route already writes with the service client. No new table, no policy, no new access model. |
| 3 | Preset list ownership | Ship engineering default (9 names), Greg edits later | **Three bundles** | Yes. This run names "standard production, retainer, project fee" - bundles, not one flat list. The plan's nine names became the Standard production bundle. Copy still lives in one file. |
| 4 | Cap: hard vs soft | Soft warning | **Split** | Partial. Budget categories advise past 10 (plan's posture, and this run says "guidance"). Evaluation criteria hard-stop at 8, because this run says "cap 8 enforced app-side". Two rules for two blocks, each stated where it applies. |
| 5 | Paste bad lines | Skip-and-flag | **Adopted unchanged** | No. |
| 6 | Multi-currency paste | No, USD-style only | **Adopted, minimally extended** | Yes. G2 shipped `CURRENCY_SYMBOLS` as the one symbol map. Hardcoding a `$`-only stripper next to it would be a second source for the same fact, so the parser strips anything in that map. Locale decimal-comma grammar is still not guessed, which is the plan's actual substance. |
| 7 | "Flagged" treatment | Existing amber semantic | **Adopted unchanged** | No. Checked against "never use amber decoratively": uncategorized spend inside a categorized budget is a genuine soft-warning condition. |
| 8 | Mismatched itemization | Subtotal only, no fake itemization | **Adopted unchanged** | No. |

---

## 3. Migration summaries (authored, never executed)

**072 budget structure, RE-AUTHORED.** Was two tables; is now
`rfp_magic_tokens.budget_categories jsonb`, `partner_rfp_responses.budget_lines jsonb`, plus
`master_rfp_json.budget_categories` for the wizard flow (no column). Keys inside the blob stay
stable across the broadcast fan-out, which is what makes identity survive. Both columns NULL by
default so "defines no categories" stays distinguishable from "defined, and empty".

**075 per-RFP evaluation criteria.** `rfp_magic_tokens.evaluation_criteria jsonb`;
`bid_evaluation_scores.criterion_id` drops NOT NULL and gains `rfp_criterion_key` +
`criterion_name_snapshot`, a CHECK that exactly one identifier is set, and a partial unique
index for the per-RFP half (065's UNIQUE cannot cover it because NULLs are distinct). Every
existing row already satisfies the CHECK: no backfill, no rewrite, no legacy bid's score
touched. The 8 cap is app-side, not a jsonb-length CHECK that would reject a valid RFP with an
error the UI could not explain.

**076 structured proposal + close bidding.** `partner_rfp_responses.proposal_sections jsonb`
alongside `proposal_text`; `close_bidding_at_deadline boolean NOT NULL DEFAULT false` on both
RFP tables. The default is deliberately the opposite of 070's retroactive `DEFAULT true`.

Split 075/076 on blast radius: 075 is the only one altering an existing constraint, so it can
be rolled back alone. Every file ends with commented verification queries and expected results.
`docs/s4-migrations-runbook.md` rewritten with order, per-file expectations, and rollbacks -
including the trap that a 075 rollback must not casually restore `criterion_id NOT NULL`.

---

## 4. Per-commit file summaries

**P2-1 budget structure.** New: `lib/budget-categories.ts` (shape, three preset bundles, both
paste parsers, all arithmetic), `components/budget-category-editor.tsx` (agency, dark),
`components/bid-budget-categories.tsx` (vendor, theme-aware),
`components/bid-budget-comparison.tsx` (agency read: comparison table + single-bid breakdown).
Wired: wizard Step 2, magic-rfp, `broadcast-rfp`, `rfp/magic-link`, both bid forms, both
response APIs, `agency/rfp-responses`, compare view, bid detail sheet, `lib/bid-shared.ts`,
glossary.

**P2-2 proposal sub-fields.** New: `lib/proposal-sections.ts`,
`components/bid-proposal-sections.tsx` (editor + read-only display). Wired: both bid forms,
both response APIs, `lib/bid-analysis-context.ts` (AI prompts), compare view, bid detail sheet.

**P2-3 evaluation criteria.** New: `lib/rfp-evaluation-criteria.ts`,
`lib/rfp-evaluation-criteria-server.ts` (rubric resolution + availability probe),
`components/evaluation-criteria-editor.tsx`. Wired: wizard Step 2, magic-rfp, `broadcast-rfp`,
`rfp/magic-link`, the evaluation GET/PUT, the ai-score route, `bid-evaluation-tab.tsx`,
`lib/delivery-review.ts`, `delivery-review-sheet.tsx`, glossary, design-language decision log
entry 31.

**P2-4 close bidding.** New: `lib/bid-close.ts`. Wired: wizard, magic-rfp, `broadcast-rfp`,
`rfp/magic-link`, both bid forms (banner, sticky bar, disabled actions, deadline chip, autosave
suppression), both response APIs (server-side enforcement).

---

## 5. Honest verification statements

What was actually verified:

- `npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after each of the six commits.
- Markdown-link corruption scan clean across `app/`, `lib/`, `components/`.
- Live schema confirmed once, read-only, before authoring migrations.

What was **not** verified, plainly:

- **Nothing was run against a database.** No migration applied, no query executed, no row read
  or written by any Phase 2 code path.
- **The post-migration path is unexercised.** Everything built here is pre-migration safe by
  construction, which means the path this build actually takes is the fallback one: no budget
  categories, no structured proposals, the global scoring rubric, and bidding always open. The
  post-migration behavior is verified by tracing the write guards and the read fallbacks, not by
  observation.
- **No browser was opened.** No wizard step, bid form, compare view, or Evaluate tab was
  rendered. Layout, spacing, and interaction were written to the existing patterns and read
  against the design language, not seen.
- **The AI-facing changes are untested against a model.** Rubric and structured-proposal text
  reach the prompt builders correctly by inspection; no prompt was actually sent.

---

## 6. Cross-surface score approach, and why

Two aggregates consume scores across RFPs. They are handled differently because they consume
different things.

**Mapped through composite score, no change needed.** The vendor reliability index and the
composite bid-to-delivery delta (`app/api/agency/pool/[partnerId]/performance/route.ts`,
`components/vendor-performance-history.tsx`) read `bid_evaluations.composite_score` and
`delivery_reviews.composite_score`. A composite is a weighted mean on a 0-100 scale regardless
of which rubric produced it, and a per-RFP evaluation writes it exactly like any other. So these
keep computing correctly with no code change at all. Rankings (`bids/rank`) read the same
number, which is why per-RFP criteria and weights flow into rankings automatically.

**Explicitly excluded with honest basis text.** The per-criterion bid-to-delivery delta
(`lib/delivery-review.ts`, `components/delivery-review-sheet.tsx`) matches bid scores to delivery
scores by `criterion_id` against the agency-global `bid_scoring_criteria`. A per-RFP score has a
NULL `criterion_id` by design, so nothing matches. Rather than render an empty delta table -
which reads as "delivery matched the bid exactly", a fabricated agreement - the sheet states
that this bid was scored against criteria defined for its own RFP, that there is no shared
criterion to compare, and that the composites above are still directly comparable.

**Never silently corrupted.** A per-RFP score is never written under a global criterion's uuid,
even when the names match exactly. Names collide; meanings do not. The synthetic `rfp:` id
prefix means the two id spaces cannot be confused at any layer, in either direction.

---

## 7. Open questions

1. **Step 2's label** still reads "Master RFP + Business Criteria" while the step now also holds
   budget categories and evaluation criteria. Renaming it is copy work owned by the design pass.
2. **CSV file input was not built.** Seeding is paste-first, as instructed.
   `spreadsheet-import-panel.tsx` is a full mapping-and-review flow bound to partner import, so
   reusing it was not trivial, and building new upload infrastructure was out of scope. Pasting
   CSV rows works (comma fallback), so the gap is only "choose a .csv file".
3. **Preset bundle copy** is an engineering default per judgment call 3. Greg edits
   `lib/budget-categories.ts`.
4. **Weights UI** is a numeric input defaulting to equal. A slider or normalize-to-100
   affordance is a design-pass question.
5. **Guest bids do not get the RFP's category order in the compare view.** The magic-token
   select there is an explicit column list, and adding `budget_categories` to it would 500 the
   route pre-migration. They fall back to the union of what their own budget lines carry, which
   is correct but ordered by first appearance. Worth revisiting after 072 is applied.
6. **`bid_scoring_templates`** is untouched by per-RFP criteria. A template still applies to the
   global rubric only. Whether an agency should be able to save a per-RFP rubric as a reusable
   template is a product question, not a Phase 2 one.
7. **Portal autosave does not persist a `draft` status bid's `budget_lines` on a closed RFP**,
   because autosave is suppressed entirely once bidding closes. Correct, but worth naming.

---

## MORNING CHECKLIST

Do these in this exact order. Do not reorder, and do not push before step 1 is fully verified.

### 1. Apply the authored migrations, in sequence

Full procedure with rollbacks: `docs/s4-migrations-runbook.md`. Order is **072, then 075, then
076**, chosen on blast radius (075 is the only one altering an existing constraint).

**1a. Apply `supabase/migrations/072_budget_structure.sql`** (everything above `Verification`).
Expect *Success. No rows returned.* Then:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_name = 'rfp_magic_tokens' AND column_name = 'budget_categories')
   OR (table_name = 'partner_rfp_responses' AND column_name = 'budget_lines')
ORDER BY table_name;
```
**Expected:** 2 rows, both `jsonb`, `is_nullable = YES`, `column_default = NULL`.

```sql
SELECT count(*) FROM rfp_magic_tokens WHERE budget_categories IS NOT NULL;
SELECT count(*) FROM partner_rfp_responses WHERE budget_lines IS NOT NULL;
```
**Expected:** `0`, `0`.

**1b. Before applying 075, record the baseline:**

```sql
SELECT count(*) FROM bid_evaluation_scores;
```
**Write this number down.** It must be unchanged after 075.

**Apply `supabase/migrations/075_rfp_evaluation_criteria.sql`.** Paste it whole - it contains a
`DO $$ ... $$` block, so do not split at the semicolons inside it. Then:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bid_evaluation_scores'
  AND column_name IN ('criterion_id', 'rfp_criterion_key', 'criterion_name_snapshot')
ORDER BY column_name;
```
**Expected:** 3 rows. `criterion_id` `is_nullable = YES` (was `NO`); `criterion_name_snapshot`
text YES; `rfp_criterion_key` text YES.

```sql
SELECT conname FROM pg_constraint WHERE conname = 'bid_evaluation_scores_exactly_one_criterion';
SELECT indexname FROM pg_indexes WHERE indexname = 'bid_evaluation_scores_one_per_rfp_criterion';
```
**Expected:** one row each.

```sql
SELECT count(*) FROM bid_evaluation_scores;
SELECT count(*) FROM bid_evaluation_scores WHERE rfp_criterion_key IS NOT NULL;
```
**Expected:** the first equals your baseline from above exactly; the second is `0`.

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'rfp_magic_tokens' AND column_name = 'evaluation_criteria';
```
**Expected:** one row, `jsonb`, `YES`.

**1c. Apply `supabase/migrations/076_structured_proposal_and_bid_close.sql`.** Then:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_name = 'partner_rfp_responses' AND column_name = 'proposal_sections')
   OR (table_name = 'partner_rfp_inbox' AND column_name = 'close_bidding_at_deadline')
   OR (table_name = 'rfp_magic_tokens' AND column_name = 'close_bidding_at_deadline')
ORDER BY table_name, column_name;
```
**Expected:** 3 rows. `partner_rfp_inbox.close_bidding_at_deadline` boolean `NO` `false`;
`partner_rfp_responses.proposal_sections` jsonb `YES` `NULL`;
`rfp_magic_tokens.close_bidding_at_deadline` boolean `NO` `false`.

```sql
SELECT count(*) FROM partner_rfp_responses WHERE proposal_sections IS NOT NULL;
SELECT count(*) FROM partner_rfp_inbox WHERE close_bidding_at_deadline;
SELECT count(*) FROM rfp_magic_tokens WHERE close_bidding_at_deadline;
```
**Expected:** `0`, `0`, `0`. **The last two matter most:** anything other than zero means
applying this migration closed live RFPs, which is exactly what `DEFAULT false` exists to
prevent. Roll back immediately if so.

**1d.** Update the migrations table in `LIGAMENT_CONTEXT.md` with a row per applied file.

### 2. ONLY THEN push

```bash
git push
```

Six commits: P2-0, P2-M, P2-1, P2-2, P2-3, P2-4. Wait for the Vercel deploy to finish before
step 3.

### 3. Live tests

**3a. Broadcast a test RFP** through the wizard with all four features on at once:
- Step 2: add a **preset budget bundle** (Standard production), then one **custom category**.
  Confirm "Additional items" appears automatically, last, amber, and cannot be removed.
- Step 2: **Evaluation criteria** - load the standard criteria, remove one, rename one, add one
  **custom criterion**, and set **non-equal weights**.
- Recipients step: set a **short response deadline** (today's date) and turn **"Close bidding at
  deadline" ON**.
- Broadcast to a test vendor.

**3b. Bid it as the vendor**, structured:
- Enter a subtotal in most categories. **Enter an honest 0 in one category** and confirm the
  form treats it as answered, not as blank.
- **Itemize one category** and use **paste-from-spreadsheet** (tab-separated label and amount,
  and deliberately include one unparseable line - confirm it is listed back with a reason rather
  than silently dropped, and that the good lines import).
- Confirm the **budget total is read-only** and equals the sum of the categories.
- Fill **two of the four guided proposal sections**, leave two blank.
- Confirm the sticky bar counts unfilled categories and does **not** count the skipped proposal
  sections.
- Submit.

**3c. Compare, agency-side:**
- The **category table** renders one row per category with an expand affordance only on
  itemized ones; the un-itemized bid shows "Subtotal only".
- The **structured proposal sections** render as labelled rows, and only the two the vendor
  filled in - the two skipped ones do not appear at all.
- **Evaluate tab** shows *this RFP's* criteria, says it is scoring against them, and the
  settings link reads "Standard scoring settings". Generate AI scores and confirm the rationales
  reference the custom criterion.
- Save the evaluation and confirm a composite score lands.

**3d. Close-at-deadline:** once the deadline has passed, reload the vendor's bid form. Confirm
the closed message replaces the preflight line, the sticky bar says "Bidding closed" with the
readiness count still beneath it, save and submit are disabled, and the deadline chip says
"closed" rather than "past due". Then confirm the agency **can still see and award** that bid.

**3e. Legacy regression:** open an RFP broadcast **before** today. Confirm the bid form shows no
category block and an ordinary editable budget field, the compare view shows no category table
and no proposal-section rows, and the Evaluate tab uses the global criteria with the original
"Scoring Settings" label. It must be indistinguishable from yesterday.

**3f. Delivery Performance aggregates:** open a vendor's performance history and confirm the
reliability summary, average delivery score, and bid-to-delivery composite delta all still
compute. Then open a delivery review for a bid scored against per-RFP criteria and confirm the
per-criterion delta table is replaced by the honest "no shared criterion" sentence, not an empty
table.
