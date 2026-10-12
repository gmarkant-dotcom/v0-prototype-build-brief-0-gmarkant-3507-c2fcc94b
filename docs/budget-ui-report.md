# Budget UI run report (feat/budget-ui)

**Written:** 2026-10-12, unattended. Branch `feat/budget-ui`, cut from `main` at `5b79c9a` (after the
budget spine server layer merged). **Merge status: not stated here.** Check with
`git merge-base --is-ancestor <sha> main`. Nothing was pushed, merged or deployed.

## 0. Commits

| SHA | What |
|---|---|
| `20cc94e` | U1 screens, ledger, documents, export; U3 import + AI route; U4 agency nav |
| `547e59e` | U2 template editor, eight starters, composition step |
| `74ac9fb` | U5 vendor documents view + route; U4 vendor nav |
| `ba10ba2` | U6 plans |
| final commit | test script, this report, two small fixes (not-enabled wording per tab; excluded import rows show their reason) |

## 1. Screens and routes, and how each handles 404 and 402

Every agency screen reads through `lib/budget/client-api.ts` `budgetFetch`, which turns a status into a
state: 404 with `enabled:false` is **not enabled**, 402 is **upgrade**, 401, 403, 404 (not found), 409,
400, and anything else is an error. `components/budgeting/budget-states.tsx` `BudgetErrorState` renders
each: "Budgeting is not enabled yet" (or "The ledger" / "Budget documents" when only 104 is missing),
"Budgeting is part of the lead agency plan" with a link to `/agency/usage`, session ended, no access,
project not found, and a retryable error. Loading shows a spinner only while SWR `isLoading`. 4xx is never
retried. Empty states are one quiet line.

| Screen | File | Reads | Notes |
|---|---|---|---|
| `/agency/budgeting` | `app/agency/budgeting/page.tsx` | `GET /api/agency/budget/projects` (new) | status per project: No budget yet / Chart, no lines / Budgeted with estimate total. Start budget = `POST chart {copy_template}` (R6); 409 opens the existing chart |
| `/agency/budgeting/[projectId]` | `app/agency/budgeting/[projectId]/page.tsx` | `GET .../projects/[projectId]` (new) | header, Budget CSV, Ledger CSV, four tabs |
| Budget tab | `components/budgeting/budget-tab.tsx` | chart, lines | inline add / edit of lines and estimates; add category with fee-or-cost; rename and merge (with history list); switch fee or cost (merge into a same-name category of the other flag); promote to template (skips a name already there); archive / restore; delete per R1 with refusal wording and **Archive instead**; Show archived toggle; Finish merge recovery; Import |
| Summary tab | `components/budgeting/summary-tab.tsx` | chart, summary, ledger | Estimate vs Actual per line and category, "not on a line" rows, totals, fee total, cost total, margin amount and percent for estimate and actual. 104 missing reads "No ledger yet" |
| Ledger tab | `components/budgeting/ledger-tab.tsx` | ledger (voided included), chart, lines, documents | manual entries; void with "duplicate of" (the entry kept) and a required reason; voided rows struck through with reason and pointer; no delete anywhere |
| Documents tab | `components/budgeting/documents-tab.tsx` | documents, partnerships (new) | metadata list, vendor-visibility toggle (asks which active / suspended vendor when unshared), Archive all / Unarchive all (R3) |
| Import sheet | `components/budgeting/import-sheet.tsx` | | U3, section 3 |
| `/agency/budgeting/templates` | `app/agency/budgeting/templates/page.tsx`, `components/budgeting/template-composer.tsx` | templates | U2, section 2 |
| `/partner/budget-documents` | `app/partner/budget-documents/page.tsx` | `GET /api/partner/budget-documents` (new) | U5, section 6. 404 not enabled: "Budget documents are not available yet." The vendor route is not behind the agency gate, so it never answers 402 |

New agency routes, all through `lib/server/budget/http.ts` (`budgetRouteSession` / `budgetRouteProject`:
401, then the paid lead-agency gate 402 `agency_entitlement_required`, then 403 no organization, then 404
project not the caller's), caller's session only:

- `GET /api/agency/budget/projects` (`app/api/agency/budget/projects/route.ts`)
- `GET /api/agency/budget/projects/[projectId]` (`.../[projectId]/route.ts`)
- `GET /api/agency/budget/projects/[projectId]/partnerships` (`.../partnerships/route.ts`)
- `POST /api/agency/budget/projects/[projectId]/suggest-categories` (`.../suggest-categories/route.ts`)

Every write goes through the existing server-layer routes and helpers, unchanged.

## 2. Starter templates (`lib/budget/starter-templates.ts`)

| Starter | Categories | Fee |
|---|---|---|
| Live-action video production | 21 | 3 |
| Experiential and live event | 19 | 3 |
| Digital and social campaign | 12 | 6 |
| Photo shoot | 14 | 2 |
| Animation and post-production | 14 | 2 |
| Agency retainer | 6 | 2 |
| Brand identity and design | 9 | 5 |
| Audio and podcast production | 9 | 2 |

Composition: choose starters, check categories (shared names shown once with their sources; names already
in the template, live or archived, cannot be picked), change fee or cost, preview with the split, then one
`POST /api/agency/budget/templates` per category after a fresh duplicate re-check, reporting added /
skipped / failed per category.

## 3. Import and the AI route

**Import** (browser only): `lib/budget/import.ts` checks extension (.csv/.xlsx/.xls), refuses over 5 MB
before reading, parses with the existing `lib/spreadsheet-parse.ts` through `import()` (first sheet only),
and refuses over 2,000 rows. Mapping: description and amount required, category and fee-or-cost optional,
guessed from headers. Amounts parse to integer cents with no floating point (`lib/budget/money.ts
parseMoneyToCents`): currency symbols and codes, commas, spaces stripped; `(80.00)` and `-80` are credits;
more than two decimals is refused, not rounded. Review table: include / exclude, existing category or new
(from the file's category or typed), fee or cost (one flag per new category), per-row status, 100 rows per
page. Confirm creates new categories once each in first-appearance order, then lines in file order, one
request each, and lists every failure by row ("8 of 8 lines imported" / "N lines were not imported").

**AI route** `POST /api/agency/budget/projects/[projectId]/suggest-categories`:
- Gate: `budgetRouteProject` (401 / 402 / 403 / 404), then `canUseAgencyAi` (403 `ai_not_entitled`),
  then 503 if the provider key is absent or the call fails. The import hides the button and continues by
  hand on 402, 403 or 503.
- Input validated with zod: each row `{ index (int), description (1-300 chars), amount (<= 40 chars) }`.
  Caps: **200 rows** and **20,000 characters** of payload, refused with 413, never truncated. The browser
  batches at 200 rows and 18,000 characters.
- **Exactly what is sent to the model:** a JSON string `{ categories: [<names of this project's live
  categories, read from the database, not from the request>], lines: [{ index, description, amount }] }`
  plus a fixed system prompt. No project name, client, organization, user, line, ledger or document data.
- Model: `anthropic("claude-sonnet-4-6")` with `Output.object` (the repo's pattern from
  `app/api/ai/master-brief`), temperature 0.
- Output treated as untrusted and re-validated with zod: index must be one that was sent and not repeated;
  category must equal an existing live category name (case-insensitive, replaced by the stored name and
  id) or be null with a `newCategory` proposal that is stripped of control characters and angle brackets
  and is 1-60 chars; flag must be `fee` or `cost`. Anything else is discarded and counted (`unanswered`).
  Nothing is written by the route. The browser shows suggestions as editable React text (no HTML render).

## 4. Export and injection handling

`lib/budget/export.ts`, `lib/budget/csv-export.ts`. Budget CSV: Category, Line, Fee or cost, Estimate,
Actual, plus "(not on a line)" rows, then Fee total, Cost total, Project total, Margin, Margin percent.
Ledger CSV: Entry ID, Date, Payee, Category, Fee or cost, Original category, Line, Document, Amount,
Status (active / voided), Voided at, Void reason, Duplicate of (entry ID), Recorded at. Both read fresh
from the gated API and use the same summary view as the Summary tab. **Every** field is quoted with
inner quotes doubled; **every** cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a
leading `'` (negative amounts included, so no column can be the one missed). UTF-8 BOM for Excel.

## 5. Nav

- **Agency** (`components/agency-layout.tsx`): 00 Budgeting stays the non-focusable "Coming soon" text
  unless `useBudgetSpineEnabled("core")` is true, then it is a link to `/agency/budgeting` with active
  state. **Vendor** (`components/partner-layout.tsx`): "Budget Documents" (unnumbered, Resources) appears
  only when `useBudgetSpineEnabled("documents")` is true.
- Detection (`lib/budget/use-spine-enabled.ts`): a one-row `select("id")` probe with the browser Supabase
  client under the caller's session, judged by the server layer's own `isBudgetSpineMissing()`. Not a
  fetch of the app's API. Any error or throw reads as not enabled; SWR caches it for the session.

## 6. Vendor documents view

`GET /api/partner/budget-documents` (`app/api/partner/budget-documents/route.ts`,
`lib/server/budget/vendor-documents.ts`): authenticate (401); organizations from `org_members` (403 if
none; no role read); partnerships where `vendor_org_id` is one of them; `source_documents` filtered to those
partnership ids with the caller's session, so `source_documents_vendor_select` decides; the R4 predicate is
re-applied in code only as a second fence (it can remove rows, never add). Returns, per project and lead
agency: file name, a type from the extension or "Manual entry", date, source (lead agency / you), archived
flag. No blob path, no download, no amounts, no budget, line, category or ledger data. 404 `enabled:false`
when 104 is missing. Archived documents stay listed and marked (R3: access unchanged).

## 7. Plans and their owner decisions

- `docs/budget-actuals-feeder-plan.md`: ingestion state, content hash, review state, duplicate flag,
  org-prefixed paths, uploader, a "manual" document kind; migration sketch; screens; validated extraction
  flow; sign convention. Decisions: state values, review threshold, re-categorising accepted entries,
  image retention, which vendor submissions file documents, partial refunds, manual kind versus nullable
  document, path shape and migration of existing rows.
- `docs/budget-116-plus-plan.md`: versions and the movement report (recommends explicit snapshots),
  Committed (agency-only commitment record), Paid (allocations from `payment_milestones`, agency-side), the
  RFP hand-off (blocked on `docs/rfp-source-of-truth-design.md`), housekeeping, ordering B0-B5.
  Decisions: Q3 version model, which moments make a version, un-approving, Q4 join and POs, Paid source,
  export timing, RFP D1-D9 (especially D2), **the margin formula**, and **migration numbering: the RFP
  design also claims 116-118**.

## 8. Security review list

New or changed routes and queries (all with the caller's session client; explicit columns; no service
role; no role / active_role / secondary_role read):

| Where | What |
|---|---|
| `app/api/agency/budget/projects/route.ts:9` | `budgetRouteSession()` gate |
| `lib/server/budget/overview.ts:43` | `projects` select `id, name, client_name, status, created_at` `.in("org_id", orgIds)` |
| `lib/server/budget/overview.ts:56` | `budget_project_categories` select `project_id` `.in("project_id", ids)` (chunks of 100) |
| `lib/server/budget/overview.ts:63` | `budget_lines` select `project_id, estimate` live only |
| `lib/server/budget/overview.ts:77` | `budget_project_categories` select `id` limit 1 (not-enabled probe, no projects) |
| `app/api/agency/budget/projects/[projectId]/route.ts:10` | `budgetRouteProject()` gate |
| `lib/server/budget/overview.ts:103` | `projects` select `id, name, client_name` by id `.in("org_id", orgIds)` |
| `app/api/agency/budget/projects/[projectId]/partnerships/route.ts:14` | `budgetRouteProject()` gate |
| `lib/server/budget/overview.ts:123` | `partnerships` select `id, status, company_name` `.eq("lead_org_id", project.orgId)` (the gated project's org, not a client value) |
| `app/api/agency/budget/projects/[projectId]/suggest-categories/route.ts:74` | `budgetRouteProject()` gate |
| `.../suggest-categories/route.ts:79` | `profiles` select `id` for the caller (presence only) |
| `.../suggest-categories/route.ts:82` | `canUseAgencyAi` |
| `.../suggest-categories/route.ts:89` | zod request validation |
| `.../suggest-categories/route.ts:92`, `:107` | 200-row and 20,000-character caps (413) |
| `.../suggest-categories/route.ts:98-104` | live categories via existing `listProjectCategories` / `listCategoryMerges` |
| `.../suggest-categories/route.ts:113` | **the AI call** (`generateText`, `Output.object`) |
| `.../suggest-categories/route.ts:128`, `:149` | output re-validation (`modelSchema`, `safeName`) |
| `app/api/partner/budget-documents/route.ts:22`, `:24` | vendor route: `getUser`, `resolveCallerOrgIds`; not under the agency gate |
| `lib/server/budget/vendor-documents.ts:50` | `partnerships` select `id, lead_org_id, status` `.in("vendor_org_id", orgIds)` |
| `lib/server/budget/vendor-documents.ts:58` | `source_documents` select `id` limit 1 (not-enabled probe) |
| `lib/server/budget/vendor-documents.ts:65` | `source_documents` select metadata `.in("partnership_id", vendor partnership ids)`; RLS decides; `blob_path` read server-side only for the manual check and never returned |
| `lib/server/budget/vendor-documents.ts:93`, `:94` | `projects` select `id, name`; `organizations` select `id, name` (names, best effort under RLS) |
| `lib/budget/use-spine-enabled.ts:29` | browser probe: `budget_template_categories` or `source_documents` select `id` limit 1 |
| `components/agency-layout.tsx` (NavSectionBlock), `components/partner-layout.tsx` (PartnerChrome) | nav changes only |
| `lib/budget/import.ts:12-13`, `:24`, `:30`, `:28` | 5 MB and 2,000-row caps; xlsx reached only by dynamic import in the browser. No file under `app/api`, `lib/server` or `middleware.ts` imports `xlsx`, `lib/spreadsheet-parse.ts` or `lib/budget/import.ts` (grep) |
| `lib/budget/csv-export.ts:11`, `:17` | formula neutralisation and quoting |

Client write call sites (all to existing gated routes): `components/budgeting/budget-tab.tsx:101, 120,
131, 138, 145, 157, 168, 189, 191, 208, 224, 232, 249, 508, 615`; `ledger-tab.tsx:82` (records the manual
reference document), `:94`, `:121`; `documents-tab.tsx:68, 84`; `import-sheet.tsx:165` (AI), `:229`,
`:254`; `template-composer.tsx:83, 96`; `app/agency/budgeting/page.tsx:37`;
`app/agency/budgeting/templates/page.tsx:66, 115, 119, 123, 170`.

## 9. Test script

`docs/budget-ui-test-script.md`: 61 numbered steps, covering before 103, between 103 and 104, and after
both; the sample CSV with a formula-injection row, a bad amount and a credit; the export check; the vendor
view with `gmarkant@icloud.com`.

## 10. REFUSED, ASSUMPTIONS, STOPPED ON

**Gates.** `tsc --noEmit` exit 0 (run as `./node_modules/.bin/tsc`, unpiped; node_modules is a real
directory here). `pnpm lint` exit 1, all pre-existing: zero messages in any new file; the three messages
in each of `agency-layout.tsx` and `partner-layout.tsx` (two react-hooks/set-state-in-effect on the
existing `setIsDemo` effects, one no-img-element) are in lines this run did not change. `pnpm build`
was not run (not asked). **Nothing was run in a browser or against a database.**

**REFUSED** (by the permission layer; worked around):
- `cat` of several files and a `for` loop over files: used the Read tool.
- `... ; echo "EXIT=$?"`: ran tsc alone and read its exit.
- `./node_modules/.bin/eslint <dirs>` (twice): used `pnpm lint --format json --output-file` plus `jq`.

**ASSUMPTIONS**
1. Margin: the spec has no formula; margin amount = fee total, margin percent = fee / (fee + cost), shown
   for estimate and actual; percent hidden ("-") when fee + cost is 0.
2. Currency: none is stored (103 / 104), so no symbol is shown; amounts are plain with two decimals.
   Import treats a dot as the decimal point and a comma as a thousands separator.
3. Manual ledger entries: `ledger_entries.source_document_id` is NOT NULL, so "Manual entry (no file)"
   first records an agency `source_documents` row named "Manual entry: <payee> (<date>)" with
   `blob_path = budget/<projectId>/manual/<uuid>` and no bytes behind it. The UI labels these "Manual
   entry, no file". A real document kind is proposed in the feeder plan.
4. Changing a project category's fee-or-cost: no update helper exists, so it is a merge into a new
   same-name category of the other flag (history kept). In-place change is an owner option (116+ plan,
   B5 item 2).
5. Void: the void dialog requires a reason and offers "duplicate of" the entry kept, or "Not a
   duplicate" for an entry made in error. Both are R2 voids; nothing is deleted.
6. Nav detection is a browser one-row probe judged by `isBudgetSpineMissing`; any failure hides or keeps
   "Coming soon".
7. Vendor view lists archived documents, marked Archived (archive changes no one's access). It
   re-applies R4 in code as a second fence and limits itself to the vendor side of the caller's
   partnerships, so a user in both organizations does not see the agency's private documents there.
8. AI suggestions are not counted against the AI-analysis usage limit (the brief named only
   `canUseAgencyAi`). `canUseAgencyAi` receives `{}` once the caller's profile row is confirmed (it
   checks presence only).
9. Only live categories (not archived, not merged away) are sent to the model and offered in import.
10. A project "has a chart" when it has any category, archived or not (the same condition R6 refuses on).
11. Template composition and promotion skip a name already in the template, live or archived
    (case- and space-insensitive).
12. Budget totals include live lines in an archived category (archiving hides, it does not remove money).
13. `lib/utils.ts` has `formatDateTime` but no `formatDate`; timestamps use `formatDateTime`, and the
    ledger's date-only field uses a local UTC-safe formatter.
14. The upgrade state links to `/agency/usage` ("See your plan"), not `/pricing`, per "no pricing copy".
15. Starter content: the agency's own fees, mark-ups and in-house team time are fee; ambiguous categories
    are cost (never inflates margin).
16. The 2,000-row cap is checked after parsing; the 5 MB cap is checked before reading.
17. Creative Treatment Analysis is ruled to move under 00 when 00 becomes navigable; not moved (not in
    this brief). Owed.

**STOPPED ON:** nothing. Open items: browser run of the test script after 103 and 104; the boundary
guard script (build plan Phase C step 2) is still unbuilt; the margin formula and migration numbering
need the owner.
