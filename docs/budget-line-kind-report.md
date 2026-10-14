# Budget line kind (117): run report

**Branch:** `feat/budget-line-kind`, from `main` at `4d3fa5a`. Unattended run, 2026-10-14.
**Nothing pushed, merged or applied. No existing migration edited.** The pre-apply test has not been
run: there is no Postgres and no credentials here. Its first run is also the parse check.

**Owner rulings implemented (2026-10-14):** R-K1 (line-level kind, inherit with override; every total
by effective kind), R-K2 (aggregate percentages, never a line computed from other lines), R-K3
(category % of total). Plus browser-test findings F1 to F3.

---

## 1. Commits

| sha | subject |
|---|---|
| `01666ee` | feat: migration 117 - budget_lines.fee_or_cost, nullable line-level kind override (NULL inherits the category); down file and pre-apply test (29 assertions) |
| `88758a5` | feat: server reads and writes the line kind through the existing line routes (zod: fee \| cost \| null); summary carries each line's override and archived lines; degrades to all-inherited before 117 |
| `324434f` | feat: summary math by effective kind per line - fee/cost totals, margin, % of total (totals and by category), Mixed categories; budget CSV adds Kind, Kind source and % of total; ledger CSV labels entries by effective kind; margin cards read 'n/a' for an undefined ratio (F3) |
| `7026432` | feat: Budget tab FEE/COST chip per line (dashed inherited, solid override, click toggles, Reset to category); import Kind column; F1 rate shows thousands separators; F2 Unit after Qty, Tab follows |
| `879f19b` | docs: RFP record migrations renumbered to 118-120, budget plan from 121; state of record - 116 applied and catalog-verified 2026-10-14 (40/40 PASS), 117 authored, next free 118 |
| `96cd7fa` | docs: test script - Part D updated for F1/F2/F3, LM0 and LM0b marked not run; Part E for 117 |
| (this file) | docs: budget line kind run report |

## 2. STEP 0 answers

**a. The category kind in 103.** Both tables declare `fee_or_cost text NOT NULL` with a CHECK
constraint `fee_or_cost IN ('fee', 'cost')`:

- `budget_template_categories.fee_or_cost`: `supabase/migrations/103_budget_core.sql:414`, constraint
  `budget_template_categories_fee_or_cost_check` at `:420-421`.
- `budget_project_categories.fee_or_cost`: `103_budget_core.sql:454`, constraint
  `budget_project_categories_fee_or_cost_check` at `:462-463`.

117 copies the type (`text`) and the two values and makes the column nullable.

**b. How ledger entries attach (104).** `ledger_entries.category_id uuid NOT NULL`
(`104_budget_ledger.sql:506`, composite FK `:524-526`) and `ledger_entries.budget_line_id uuid NULL`
(`:508`, MATCH SIMPLE FK `:530-533`). So **every entry references a category, and may also reference
a line**. No entry references neither, so this was not a stop. The Actual split:

- an entry on a **live** line counts with that line, under the line's effective kind;
- an entry on an **archived** line takes that line's effective kind (its override, else the kind of
  the category the line sits in);
- an entry on **no** line takes its own category's kind.

Nothing in the schema forces an entry's `category_id` to match its line's category. The money stays
where it was placed before (line actual goes to the line's category, off-line actual to the entry's
category); only the fee/cost attribution follows the line.

**c. Every place that split money into fee and cost before this run.**

- `lib/budget/summary-view.ts:99-103` (pre-change): `sum(..., flag)` filtered **categories** by
  `c.feeOrCost`. This was the only calculation of the split. It fed:
  - `components/budgeting/summary-tab.tsx` (metric cards, Totals table, By category);
  - `lib/budget/export.ts` budget CSV (`Fee total`, `Cost total`, margin rows).
- `lib/budget/export.ts:103` (pre-change): the ledger CSV's per-entry "Fee or cost" cell read
  `cat.get(e.category_id)?.fee_or_cost`. It labels entries rather than summing them, but it is an
  export of fee versus cost, so it now uses the entry's effective kind as well.
- `lib/server/budget/summary.ts` **did not split**: it returns per-line estimate and actual only.
  It now carries each line's override and the archived lines' kinds, so the view can split.
- `lib/server/budget/overview.ts` **does not split**: it sums every live line's estimate per project
  (`overview.ts:68-71`) for the landing list. A sum of all lines is correct under R-K1, so it is
  **unchanged**.
- Other uses of `fee_or_cost` (`chart.ts`, the template routes and page, `template-composer.tsx`,
  `starter-templates.ts`, `suggest-categories`, `import.ts`) set or display the **category's** flag
  and do not total money. They are unchanged, except `import.ts`, which gained the separate per-line
  Kind column (section 4).

## 3. Migration 117

`supabase/migrations/117_budget_line_kind.sql`:

- `ALTER TABLE public.budget_lines ADD COLUMN fee_or_cost text NULL;` NULL means inherit. The column
  is named like the category column it overrides, so effective kind is
  `coalesce(budget_lines.fee_or_cost, budget_project_categories.fee_or_cost)`.
- `ADD CONSTRAINT budget_lines_fee_or_cost_check CHECK (fee_or_cost IS NULL OR fee_or_cost IN ('fee', 'cost'))`.
- `NOTIFY pgrst, 'reload schema'`.
- Fail-closed pre-flight (LG117): `budget_lines` exists; the column and the constraint do not.
- **No backfill.** ADD COLUMN with no default rewrites nothing, so every existing line is NULL
  (inherit).
- **No policy and no grant change**, exactly as 116 handled its four columns. 103's R7 table-level
  grants (authenticated SELECT, INSERT, UPDATE, DELETE; service_role ALL; PUBLIC and anon nothing)
  and the four `budget_lines_org_*` policies already cover a column added later. `budget_lines` has
  no column-level grant and no vendor policy. **No policy change is needed**, so this was not a stop.
- 116's trigger fires on every UPDATE and recomputes the estimate from unchanged qty, rate and
  multiplier. A kind-only update therefore leaves the estimate unchanged (pre-apply K10, K11).

**BEGIN is line 138 and COMMIT is line 190**, alone on its own line. For the dry run, swap line
190 to `ROLLBACK;`.

**Down file:** `117_budget_line_kind_down.sql` (BEGIN line 33, COMMIT line 59) drops the constraint
and the column. **Rolling back loses every override:** every line goes back to following its
category, and the record of which lines were overridden, and to what, is gone. It refuses (LG117)
while any override exists unless `SET LOCAL ligament.allow_drop_line_kind = 'on'` is added.

**Pre-apply test:** `117_preapply_test.sql`, **29 assertions expected**: 21 scenarios + 7
self-checks + M. It follows `116_preapply_test.sql` structurally: phase 1 runs before 117 and phase 2
after, with every scenario run in both. It has the policy and grant fingerprints and the per-scenario
isolation fingerprint. A scenario whose expectation is the same in both phases is flagged NOT
DISCRIMINATING. Everything ends in one RAISE carrying the summary block. The vendor subject is found
through **`partnerships.vendor_org_id`**.

- Scenarios:
  - K1-K3: insert with no kind reads NULL; insert fee; insert cost.
  - K4-K6: override to fee; override to cost; reset to NULL.
  - K7-K9: 'Fee', 'margin' and '' are refused with 23514.
  - K10-K12: a kind-only update leaves the estimate unchanged on a rated line (100.00), on a
    rounded line (0.03) and on a typed line.
  - K13-K14: moving a line to another category (what a merge or re-flag does) keeps an override and
    lets an inherited line take the new kind.
  - K15: the no-kind insert behaves exactly as before. This is the NOT DISCRIMINATING one.
  - KV1-KV3: the vendor cannot read, update or insert the column.
  - KA1-KA3: anon cannot read, update or insert it.
- Self-checks:
  - S1: no policy changed.
  - S2: no table or column grant changed.
  - S3: the column is nullable with the same type as the category's.
  - S4: the check allows NULL, 'fee' and 'cost', the category's values.
  - S5: existing rows are byte-identical, including 116's columns, and none was given a kind.
  - S6: 116's trigger and function are unchanged.
  - S7: `budget_lines` has exactly the four policies of 103.
  - M: the inlined migration ran.
- The inlined body (between `$m117$` markers) is lines 140-188 of the migration, copied verbatim.

## 4. Every file changed

| File | Change |
|---|---|
| `supabase/migrations/117_budget_line_kind.sql` | new: the column and its check |
| `supabase/migrations/117_budget_line_kind_down.sql` | new: drops them (loses every override) |
| `supabase/migrations/117_preapply_test.sql` | new: 29-assertion before/after test |
| `lib/server/budget/schema.ts` | `LINE_KIND_COLUMNS`, `BudgetLine.fee_or_cost`, `effectiveKind()`, `isFeeOrCost()` |
| `lib/server/budget/lines.ts` | one optional-column mechanism for 116 and 117 (`missingLineColumns`, `withLineColumns`); zod `kind`; read/write `fee_or_cost`; `lineKind` flag; LINE_KIND_DISABLED |
| `lib/server/budget/summary.ts` | reads every line with its override (fallback before 117); `kind` per line, `archivedLines`, `lineKind` |
| `app/api/agency/budget/projects/[projectId]/lines/route.ts` | GET returns `lineKind`; POST passes `kind` |
| `app/api/agency/budget/projects/[projectId]/lines/[lineId]/route.ts` | PATCH passes `kind` |
| `lib/budget/summary-view.ts` | the split by effective kind, Estimate and Actual; % of total; Mixed; per-category fee/cost |
| `lib/budget/export.ts` | budget CSV Kind, Kind source, % columns, category totals; ledger CSV effective kind |
| `lib/budget/hooks.ts` | `useLines` type carries `lineKind` |
| `lib/budget/import.ts` | `kind` mapping, `parseLineKindCell`, `kind`/`kindError` on review rows |
| `components/budgeting/budget-states.tsx` | `KindChip` (dashed inherited, solid override, button when clickable), `MixedBadge` |
| `components/budgeting/budget-tab.tsx` | chip column with toggle and Reset to category; F1 rate formatting; F2 column and Tab order |
| `components/budgeting/summary-tab.tsx` | % of total columns, Mixed and fee/cost parts, line chips, F3 card wording |
| `components/budgeting/import-sheet.tsx` | Kind mapping (only after 117), Line kind review column, sends `kind` |
| `docs/rfp-source-of-truth-design.md` | RFP record migrations 117-119 renumbered to 118-120 |
| `docs/budget-116-plus-plan.md` | numbering: 117 taken, RFP 118-120, budget B0-B5 from 121 |
| `docs/state-of-record-2026-10-12.md` | 116 applied and catalog-verified 2026-10-14; 117 authored; next free 118 |
| `LIGAMENT_CONTEXT.md` | the same state, plus 116 and 117 rows in the migration table |
| `docs/budget-ui-test-script.md` | Part D updated for F1-F3, LM0/LM0b not run; Part E for 117 |
| `docs/budget-line-kind-report.md` | this report |

## 5. How effective kind flows into each total

Effective kind = `effectiveKind(line.fee_or_cost, category.fee_or_cost)` (`lib/server/budget/schema.ts:133`).

- **Source data.**
  - `lib/server/budget/summary.ts:54-70` reads every line with `fee_or_cost`. Before 117 it falls
    back to all-NULL.
  - Live lines carry `kind` (`:115`). Archived lines are listed with their category and override
    (`:70`).
- **Estimate.**
  - `lib/budget/summary-view.ts:125` resolves each live line's effective kind.
  - `:138` adds its estimate to the category's fee or cost part, and `:140` marks the category Mixed
    if the kind differs.
  - Fee and cost totals are the sums of the category parts (`:182-189`). The project total is the
    sum of all lines (`:190`).
- **Actual.**
  - Live-line actual follows the same line (`:139`).
  - Off-line entries (`:150-172`): an entry on an archived line takes that line's effective kind
    (`:145-148`, `:158`). An entry on no line takes its category's kind (`:158`). It is added to the
    category's part (`:170`).
  - An unplaced entry (category not in the chart) counts toward fee or cost when its line resolves a
    kind (`:161`).
- **Margin.** `computeMargin(fee, cost)` on the effective-kind totals (`:203-204`). The definitions
  are unchanged (`lib/budget/money.ts:97`).
- **Percentages.** `shareOfTotal()` gives fee, cost and project-total % (`:201`) and each category's
  % (`:192`). The value is null (shown "-") only when the project total is 0, and negatives stay
  negative.
- **Surfaces, all from `buildSummaryView`.**
  - Summary tab (`components/budgeting/summary-tab.tsx:29`): cards `:54-61`, totals `:82-100`, by
    category `:181-212`.
  - Budget CSV (`lib/budget/export.ts:37`): lines `:63-67`, totals `:72-74`, category totals `:102`.
  - Ledger CSV labels each entry by the same rule (`export.ts:144-155`).
- **Budget tab category subtotal.** Still the sum of every live line in the category, whatever its
  kind (`components/budgeting/budget-tab.tsx:536`).
- **Landing list** (`overview.ts`): the sum of all live lines, with no split, unchanged.

## 6. SECURITY REVIEW LIST

- **Route handlers changed.** No new route. All of them sit behind `budgetRouteProject()`
  (`lib/server/budget/http.ts:52`, the paid gate `agencyGateRefusal` at `:40`, then the session
  org/project scope). That gate is unchanged and is still the only authorization.
  - `app/api/agency/budget/projects/[projectId]/lines/route.ts:16` GET now returns `lineKind`
    (`:24`).
  - `.../lines/route.ts:34` POST now passes `kind: body.kind` (`:50`).
  - `.../lines/[lineId]/route.ts:14` PATCH now passes `kind: body.kind` (`:31`).
  - `.../summary/route.ts:7` GET is unchanged in code. Its payload gains `lineKind`, per-line
    `kind`, and `archivedLines` (line id, category id, override) for archived lines.
- **Validation.**
  - `lib/server/budget/lines.ts:204` zod accepts `"fee" | "cost" | null`. Absent means unchanged.
    Anything else gives 400 "Kind must be fee, cost, or empty to follow the category".
  - The DB check `budget_lines_fee_or_cost_check` is the backstop (mapped at `:117`).
- **Queries changed.** All of them use the caller's session client, so RLS decides every row.
  - `lines.ts:224-229` (list: explicit column list `lineColumns(sets)`, no `*`).
  - `lines.ts:259-261` (insert/update select back the same explicit list; the update is still scoped
    `.eq("project_id").eq("id")`).
  - `summary.ts:54-58`: explicit columns. It now reads archived lines too; it previously filtered
    `archived_at IS NULL`. These are the same project's rows, readable by the same agency.
- **Payload.** `kindPayload` (`lines.ts:212`) writes only `fee_or_cost`. No client field is passed
  through unvalidated.
- **Column.** `budget_lines.fee_or_cost` (117), text, nullable, CHECK NULL/'fee'/'cost'.
- **Grants.** None added or changed. 103's R7 table grants apply. Pre-apply S2 fingerprints every
  relacl and column ACL in `public`.
- **Policies.** None added or changed. Pre-apply S1 checks the fingerprint and S7 checks that
  `budget_lines` has exactly four policies. Vendor and anon access is covered by KV1-KV3 and
  KA1-KA3.
- **Browser.** The new `effectiveKind`/`isFeeOrCost` helpers are imported from
  `lib/server/budget/schema.ts` into client code. That file holds constants and pure functions only;
  it has no server import.
- **Import.** The parsing stays in the browser; the Kind cell is validated client-side
  (`lib/budget/import.ts:109`) and again by the server's zod.

## 7. REFUSED, ASSUMPTIONS, STOPPED ON

**Stopped on:** nothing. Step 0b found that every entry references a category, and no policy change
was needed.

**Refused:** nothing.

**Assumptions (check these):**

1. **Column name `fee_or_cost`.** The brief says "a nullable kind column". I named it after the
   category column it overrides, with the same type and values. Renaming it means editing the three
   117 files and `LINE_KIND_COLUMNS`.
2. **An explicit choice is an override, even when it equals the category's kind.**
   - Clicking the chip always sets the other kind as an override. A line can therefore hold a solid
     override equal to its category, which then no longer follows a category flip.
   - "Reset to category" is the only way back to inherit.
   - Likewise an imported Kind cell that matches the category is stored as an override.
3. **Mixed** means at least one live line or off-line entry in the category has an effective kind
   other than the category's. This holds even at amount 0 (an overridden line with estimate 0
   still makes the category Mixed).
4. **Off-line entries on an archived line** take that line's effective kind (step 0b). **Unplaced
   entries** (category not in the chart) now count toward fee or cost when their line resolves a
   kind; before, they never did. They are expected to be 0.
5. **Before 117** a create that sends `kind` stores the line without it (it inherits), mirroring how
   116's math was dropped. An update whose only change is `kind` answers 400 `LINE_KIND_DISABLED`.
   The UI never sends either case, because the toggle and the Kind mapping are hidden.
6. **Import header guessing.**
   - A header named `Kind` used to be guessed as the category's fee-or-cost column. It is now
     guessed as the per-line Kind column, and only once 117 is applied.
   - The category mapping is relabelled "Category fee or cost" and still guesses `Fee or cost` and
     `Type`.
7. **The ledger CSV's "Fee or cost" is the entry's effective kind**, beyond the listed files,
   because R-K1 says every export goes by effective kind.
8. **Budget CSV layout.**
   - Kind and Kind source sit after "Fee or cost" (the category's flag).
   - "Estimate % of total" and "Actual % of total" are appended at the end and filled on the
     total rows only.
   - A new block of "(category total)" rows follows the margin rows, with "(fee part)" and
     "(cost part)" rows for a Mixed category.
   - Off-line actual is written as one "(not on a line)" row per kind.
9. **F1 covers the Rate cell only.** The tooltip and the import review already used thousands
   separators. A **typed** Total input (a line with no rate) still shows `3751.50` while editable.
   F1 did not ask for that change, so it was not made.
10. **The new-line row has no kind choice.** A new line inherits, and its row shows the category's
    kind as a dashed chip. Override it after adding.

**Not verified here:**

- The pre-apply test has not run anywhere.
- The UI has not been opened in a browser.
- `npx tsc --noEmit` exits 0.
- `pnpm lint` exits 1 on files this run did not touch (for example `app/agency/bids/page.tsx` and
  `app/agency/page.tsx`). No file under `components/budgeting/`, `lib/budget/`, `lib/server/budget/`
  or `app/api/agency/budget/` appears in its output.
