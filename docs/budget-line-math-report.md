# Budget line math, margin both ways, nav move: run report

**Branch:** `feat/budget-line-math`, cut from `main` at `fc8b517`. Unattended run, 2026-10-14.
Nothing pushed, merged or applied. Each part is appended here as it is committed.

**Owner ruling (2026-10-12):** a production budget line is quantity x unit rate x multiplier.

---

## Part 1. Migration 116 (authored, NOT applied)

Files:
- `supabase/migrations/116_budget_line_math.sql` (BEGIN line 160, **COMMIT line 282**)
- `supabase/migrations/116_budget_line_math_down.sql` (BEGIN line 31, COMMIT line 68)
- `supabase/migrations/116_preapply_test.sql`

What 116 adds to `public.budget_lines`:
- four NULLABLE columns: `quantity numeric(12,3)`, `unit_rate numeric(14,2)`,
  `multiplier numeric(12,3)`, `unit_label text`;
- three CHECKs: `budget_lines_quantity_positive` (NULL or > 0), `budget_lines_multiplier_positive`
  (NULL or > 0), `budget_lines_unit_label_shape` (NULL, or equal to its `btrim` and 1 to 24
  characters). `unit_rate` has no sign check (a discount line);
- `public.budget_lines_compute_estimate()`: SECURITY INVOKER, `SET search_path = public, pg_temp`,
  EXECUTE revoked from PUBLIC, anon and authenticated. When `unit_rate IS NOT NULL` it sets
  `estimate = round(coalesce(quantity,1) * unit_rate * coalesce(multiplier,1), 2)`, overwriting the
  client's value; if `abs(result) >= 1e12` it raises SQLSTATE **22003** with "budget line total ... is
  too large ...". When `unit_rate IS NULL` it returns the row untouched;
- trigger `budget_lines_compute_estimate` BEFORE INSERT OR UPDATE, FOR EACH ROW;
- `NOTIFY pgrst, 'reload schema'`.

Unchanged: every policy (R1's `budget_lines_org_delete` included), every grant, every existing row.
No policy added, no grant changed. Pre-flight inside the transaction raises LG116 if 103 is missing or
any of the four columns or the function already exists.

Down file: drops trigger, function, checks and columns; estimates stay. Refuses (LG116) while any line
carries math unless `SET LOCAL ligament.allow_drop_line_math = 'on'` is added after `BEGIN;`.

### Pre-apply test

115's format: first line "SAFE TO APPLY 116." or a refusal; PASS / FAIL / INCONCLUSIVE / NOT
DISCRIMINATING / NO SUBJECT; isolation fingerprint of `budget_lines` and `budget_project_categories`
after every scenario; ends in RAISE EXCEPTION (rolls back), ROLLBACK backstop. Phase 1 before 116,
phase 2 after; 116 is applied inside the test's own transaction (103 and 104 are live). Subjects use
104's selection (a partnership vendor outside the lead org, preferring one assigned to a project of
that org so the vendor CAN read the project row), with a fallback to any org with a member and a
project (vendor rows then NO SUBJECT). 40 assertions (c_expected 39 + M).

| ID | Assertion | Phase 1 | Phase 2 |
|---|---|---|---|
| C1 | rate only | MISSING | 250.00 |
| C2 | qty x rate (3 x 1250.50) | MISSING | 3751.50 |
| C3 | qty x rate x multiplier (2.5 x 1200 x 1.5) | MISSING | 4500.00 |
| C4 | rounding half away from zero (0.125 x 0.20) | MISSING | 0.03 |
| C5 | negative rounding (0.125 x -0.20) | MISSING | -0.03 |
| C6 | negative rate (2 x -150 x 1.5) | MISSING | -450.00 |
| C7 | client estimate 999.99 overwritten on INSERT | MISSING | 100.00 |
| C8 | client estimate 5 overwritten on UPDATE | MISSING | 100.00 |
| C9 | changing quantity recomputes | MISSING | 150.00 |
| C10 | clearing unit_rate keeps the estimate | MISSING | 100.00, rate NULL |
| C11 | then the estimate is typed (42 sticks) | MISSING | 42.00, qty 4.000 |
| C12 | quantity 0 | MISSING | 23514 |
| C13 | multiplier -1 | MISSING | 23514 |
| C14 | 25-character unit label | MISSING | 23514 |
| C15 | untrimmed unit label | MISSING | 23514 |
| C16 | empty unit label | MISSING | 23514 |
| C17 | overflowing product | MISSING | 22003 with the trigger's message |
| C18 | largest total that fits (-999,999,999,999.99) | MISSING | accepted |
| C19 | INSERT with no math | 123.45 | 123.45 (not discriminating, by design) |
| C20 | UPDATE a no-math estimate | 77.70 | 77.70 (not discriminating, by design) |
| C21 | a no-math line reads NULL math | MISSING | NULL x4, 100.00 |
| C22 | R1: computed non-zero line not deleted | MISSING | 0 deleted, row still there |
| C23 | R1: computed line at 0 (rate 0) deleted | MISSING | 1 deleted |
| C24 | agency reads qty, rate, multiplier, unit back | MISSING | 3.000, 10.00, 2.000, day, 60.00 |
| V1 | vendor reads no line of the project | 0 | 0 |
| V2 | vendor reads no math column | MISSING | 0 |
| V3 | vendor INSERT with math | MISSING or 42501 | 42501 |
| V4 | vendor INSERT without math | 42501 | 42501 |
| V5 | vendor UPDATE of math | MISSING or 0 | 0 |
| V6 | vendor DELETE of a line at 0 | 0 | 0 |
| A1 | anon reads | 42501 | 42501 |
| A2 | anon INSERT with math | MISSING or 42501 | 42501 |
| S1 | no policy in `public` changed (fingerprint) | | |
| S2 | no table ACL or column ACL in `public` changed (fingerprint) | | |
| S3 | four nullable columns, ruled types | | |
| S4 | function invoker, pinned, no PUBLIC, anon and authenticated cannot execute | | |
| S5 | trigger BEFORE INSERT OR UPDATE, row level, enabled | | |
| S6 | existing lines byte-identical in the original columns, none given math | | |
| S7 | R1 delete policy present and unchanged in shape | | |
| M | the inlined migration ran without error | | |

**Inlined DDL vs migration:** the test's `$m116$` body (test lines 467-585) is the migration's body
(lines 162-280), 119 lines. A machine comparison was attempted (`sed` to a temp file, then `awk`) and
both were refused by the permission layer; the two ranges were compared by reading them line for line
and are identical. Not machine-verified.

**Dry run:** in `116_budget_line_math.sql` change line **282** `COMMIT;` to `ROLLBACK;`, run, then P2
must still return zero rows.

Not run against Postgres: no database here. The test is the parse check.

---

## Part 2. Code (works before and after 116)

| File | Change | Before 116 is applied |
|---|---|---|
| `lib/budget/line-math.ts` (new) | One set of rules for browser and server: `parseDecimal3ToMilli` (qty / multiplier: > 0, at most 999,999,999.999, at most 3 decimals, refused not rounded), `parseRateToCents` (the money rules: 2 decimals, negatives allowed, below 1e12), `parseUnitLabel` (trimmed, 1 to 24 code points, no C0/C1 control characters), `computeEstimateCents` (BigInt, half away from zero, refuses above numeric(14,2)), display and API converters. No float carries a number. | pure functions, no I/O |
| `lib/server/budget/schema.ts` | `LINE_MATH_COLUMNS`; `BudgetLine` gains `quantity`, `unit_rate`, `multiplier`, `unit_label` (nullable). | fields are `null` |
| `lib/server/budget/lines.ts` | zod schema over the shared rules for `quantity`, `unitRate`, `multiplier`, `unitLabel` (undefined = unchanged, null = clear). With a rate the server computes the estimate (the trigger would overwrite anything else). `listLines` returns `{ lines, lineMath }`. 22003 -> 400 "The line total is too large..."; 23514 on the three checks -> 400 in words. | every select, insert and update is retried WITHOUT the four columns on 42703 / PGRST204 naming one of them (caught BEFORE `fromDbError`, which would otherwise read "budget_lines ... does not exist" as "spine not enabled"). A rate still sets the estimate (computed server-side, stored typed). An update carrying only math answers 400 `LINE_MATH_DISABLED`. |
| `app/api/agency/budget/projects/[projectId]/lines/route.ts` | GET returns `{ lines, lineMath }`; POST passes the four fields. | `lineMath: false` |
| `.../lines/[lineId]/route.ts` | PATCH passes the four fields. | as above |
| `lib/budget/hooks.ts` | `useLines` type gains `lineMath`. | |
| `components/budgeting/budget-tab.tsx` | When `lineMath`: one-line formula hint; per category a grid with Line, Qty, Rate, x, Unit, Total; new-line row with the same cells and a live computed total. `MathLineRow`: each cell saves on blur or Enter (one field per PATCH, inputs never disabled, so Tab-through is safe), Escape reverts; Total read-only with a rate (live preview, formula in its tooltip), typed input without one. Client validation = the shared rules, plus an overflow check before sending. Refreshed values are adopted in every cell except the one being typed in. | `lineMath` false: the original rows and add-line row, unchanged |

AI suggest route: unchanged.

## Import and export (Part 2 scope)

**Import** (`lib/budget/import.ts`, `components/budgeting/import-sheet.tsx`): optional mappings Quantity,
Rate, Multiplier (x), Unit, with header guesses (`qty`, `rate`/`unit rate`/`day rate`, `x`/`multiplier`,
`unit`/`uom`). The mapping step needs Description plus Amount OR Rate. A row with a rate is computed
(same parser and BigInt product; errors such as "Quantity has more than three decimal places" or the
too-large message exclude the row with its reason); if the file also has a differing amount, the review
shows "File amount X replaced by Qty x Rate x multiplier". A row with no rate uses the amount; with rate
mapped and neither present: "No rate or amount". The review's Amount cell shows the breakdown. The
import posts `unitRate` / `quantity` / `multiplier` / `unitLabel` for computed rows and `estimate`
otherwise. Before 116 the mapping note says the breakdown is not kept (the server still saves each
computed total).

**Export** (`lib/budget/export.ts`): the budget CSV also reads `/lines?include_archived=1` and adds
**Qty, Rate, Multiplier, Unit** after "Fee or cost" (header: Category, Line, Fee or cost, Qty, Rate,
Multiplier, Unit, Estimate, Actual). Totals rows carry empty cells there. Every cell still goes through
`toCsv` (quoted, quotes doubled, formula-start characters prefixed with `'`). Before 116 the four
columns are empty.

Gates: `pnpm exec tsc --noEmit` completed with no output (no errors). `pnpm lint --format json
--output-file /tmp/lint116.json` then `jq` over the touched files: no findings in them (the repo-wide
lint exit 1 comes from pre-existing findings in other files).

---

## Part 3. Margin, both ways

One calculation module: `lib/budget/money.ts` `computeMargin(fee, cost)` now returns
`{ amountCents, shareOfTotalPercent, markupOnCostPercent }`:
- **Margin (share of total)** = fee / (fee + cost), null when fee + cost is 0;
- **Markup on cost** = fee / cost, null when cost is 0.

`lib/budget/summary-view.ts` `buildSummaryView()` calls it for estimate and actual; both the Summary tab
and the budget CSV read that view, so screen and export cannot disagree.

- **Summary tab** (`components/budgeting/summary-tab.tsx`): the two margin cards read
  "x% share of total · y% markup on cost"; the Totals table gains two rows, "Margin (share of total)"
  and "Markup on cost", with Estimate and Actual columns. `formatPercent(null)` shows "-". Actual shows
  "-" while there is no ledger. The footnote explains both formulas and the "-".
- **Budget CSV** (`lib/budget/export.ts`): the old single "Margin percent (fee / (fee + cost))" row is
  replaced by "Margin (share of total) %, fee / (fee + cost)" and "Markup on cost %, fee / cost",
  estimate and actual, one decimal, `-` when the denominator is 0 (`percentCell`). The CSV neutraliser
  writes that cell as `'-`, as it does for every cell starting with "-" (formula-injection rule kept
  intact; a spreadsheet shows `-`). Actual stays empty when there is no ledger, as before.

Gates: `pnpm exec tsc --noEmit` no output.
