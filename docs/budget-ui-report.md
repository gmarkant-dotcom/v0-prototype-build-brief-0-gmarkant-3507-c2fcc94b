# Budget UI run report (feat/budget-ui)

**Written:** 2026-10-12, unattended. **Merge status: not stated here.** Check with
`git merge-base --is-ancestor <sha> main`.

This file is updated after each workstream so progress survives an interruption. The final section
is the consolidated report.

## Progress

| Workstream | State |
|---|---|
| U1 project budget screens + finance export | committed (workstream 1) |
| U3 budget import + AI suggest route | committed (workstream 1) |
| U4 agency nav | committed (workstream 1) |
| U2 templates + starter library + composition | committed (workstream 2) |
| U4 vendor nav + U5 vendor documents view | pending |
| U6 plans | pending |
| Test script, final report | pending |

## Workstream 1 (U1, U3, U4 agency)

- `/agency/budgeting` (`app/agency/budgeting/page.tsx`): projects with budget status; Start budget runs
  copy-on-create (R6) through `POST chart {action:"copy_template"}`; a 409 opens the existing chart.
- `/agency/budgeting/[projectId]` with Budget, Summary, Ledger and Documents tabs
  (`components/budgeting/*`), Budget CSV and Ledger CSV exports (`lib/budget/export.ts`,
  `lib/budget/csv-export.ts`).
- Import sheet on the Budget tab (`components/budgeting/import-sheet.tsx`, `lib/budget/import.ts`),
  browser-only parsing through the existing `lib/spreadsheet-parse.ts` by dynamic import.
- New gated routes: `GET /api/agency/budget/projects`, `GET /api/agency/budget/projects/[projectId]`,
  `GET .../partnerships`, `POST .../suggest-categories` (AI).
- 00 Budgeting links to `/agency/budgeting` when `useBudgetSpineEnabled("core")` says 103 is applied.

## Workstream 2 (U2)

- `/agency/budgeting/templates` (`app/agency/budgeting/templates/page.tsx`): add, rename, fee-or-cost,
  archive / restore, delete (R1: template rows are referenced by nothing, so delete is allowed).
- Starter library in code, `lib/budget/starter-templates.ts`: eight starters.
- Composition step, `components/budgeting/template-composer.tsx`: choose starters, check categories
  (duplicates across starters shown once; names already in the template, live or archived, cannot be
  picked), adjust fee or cost, preview, then one POST per category with a fresh duplicate re-check and
  a per-category added / skipped / failed result.
- Gates: tsc exit 0; zero lint messages in the new files.

Gates (workstream 1): `tsc --noEmit` exit 0. `pnpm lint` exit 1 (pre-existing); zero messages in any new file; the
three messages in `components/agency-layout.tsx` (two react-hooks/set-state-in-effect, one
no-img-element) are in code this run did not change.
