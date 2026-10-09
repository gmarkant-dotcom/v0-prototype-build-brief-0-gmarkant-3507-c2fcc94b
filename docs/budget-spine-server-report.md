# Budget spine server layer: helpers and agency routes

**Written:** 2026-10-09, branch `feat/budget-spine-server`, created from `fix/103-104-rulings` at
`cc3af07`. Unattended session.

**Merge status: not stated here.** Check with `git merge-base --is-ancestor <sha> main`.

**Depends on 103 and 104 as amended on `fix/103-104-rulings`. Neither is applied.** Until they are,
every route below answers `404 { "error": "Budget spine not enabled", "enabled": false }`.

**No UI. Nothing links here.** 00 Budgeting is still the "Coming soon" placeholder in
`components/agency-layout.tsx:84`. Nothing is uploaded to storage; documents are metadata only.

## Security boundary
- **Every helper uses the caller's session client** (`createClient()` from `lib/supabase/server`), so
  row level security decides every read and write.
  - No file in `lib/server/budget/` or `app/api/agency/budget/` creates or accepts a service-role client.
  - A grep for `service`, `SERVICE_ROLE`, `select("*")` and `active_role` across both trees finds only
    the comments saying they are not used.
- **Scope comes from the session.** `lib/server/budget/scope.ts`:
  - `budgetSession()` resolves the caller's own organizations from `org_members`, using
    `resolveCallerOrgIds`.
  - `requireAgencyProject()` admits a project only when its `org_id` is one of those organizations. A
    vendor assigned to the project can read the project row but fails this check, just as it fails
    103's policies.
- **`profiles.role` and `profiles.active_role` are never read.** A vendor can set `active_role` itself
  (docs/leak-sweep-2026-10-09.md, finding 2), so the gate is org membership instead.
- **No client-supplied organization id is accepted.** Template writes go to `budgetWriteOrgId()`
  (`resolveCallerWriteOrgId`, then checked against the caller's own organizations). Promotion writes to
  the gated project's organization.
- **Missing tables.** 42P01, 42883, PGRST205 and PGRST202 all map to `kind: "disabled"`, which becomes a
  404 "not enabled". There is never an error page and never a fallback to another table.
- **There are no vendor routes and no vendor-reachable reads.** Every list helper uses an explicit
  column list from `schema.ts`.

## Typecheck and lint
- `pnpm exec tsc --noEmit`: exit 0 before B and exit 0 after B.
- `pnpm lint`: exit 1 before B and after B. **All failures are pre-existing:** 53 files have errors, for
  example `app/agency/bids/page.tsx:392` (react-hooks/set-state-in-effect) and
  `app/agency/dashboard/page.tsx:216` (react-hooks/purity).
- **The 20 new files have zero messages.** That was read from `eslint . --format json` output, file by
  file.
- B edits no existing file, so it adds no failure.

## The column contract (`lib/server/budget/schema.ts`)

Every table, column and function name is in this one module.

| Name in code | Database object | Columns assumed |
|---|---|---|
| `BUDGET_TABLES.templateCategories` | `budget_template_categories` | id, org_id, name, fee_or_cost, archived_at, created_at |
| `BUDGET_TABLES.projectCategories` | `budget_project_categories` | id, project_id, name, fee_or_cost, archived_at, created_at |
| `BUDGET_TABLES.lines` | `budget_lines` | id, project_id, category_id, name, estimate, archived_at, created_at |
| `BUDGET_TABLES.merges` | `budget_category_merges` | id, project_id, from_category_id, into_category_id, merged_at |
| `BUDGET_TABLES.sourceDocuments` | `source_documents` | id, project_id, partnership_id, uploader_side, visible_to_vendor, archived_at, file_name, blob_path, created_at |
| `BUDGET_TABLES.ledgerEntries` | `ledger_entries` | id, project_id, source_document_id, category_id, original_category_id, budget_line_id, amount, payee_name, entry_date, category_confidence, category_reasoning, voided_at, void_reason, duplicate_of, created_at |
| `BUDGET_RPCS.copyTemplateToProject` | `budget_copy_template_to_project(p_project_id uuid) -> integer` | |
| `BUDGET_RPCS.archiveProjectDocuments` | `budget_archive_project_documents(p_project_id uuid) -> integer` | |
| `BUDGET_RPCS.unarchiveProjectDocuments` | `budget_unarchive_project_documents(p_project_id uuid) -> integer` | |
| `RPC_PROJECT_ARG` | `p_project_id` | |

Also read: `projects (id, org_id)` and `org_members (user_id, org_id)`, through the existing entitlements
helpers.

Values the helpers write:
- `fee_or_cost` ∈ {fee, cost}
- `uploader_side = 'agency'`
- blob paths must start with `budget/<projectId>/`

**If a first-run fix to 103 or 104 renames anything,** change `schema.ts`. If it renames a column the
helpers write in an insert or update, also check the patch keys in `chart.ts`, `lines.ts`,
`documents.ts` and `ledger.ts` (for example `archived_at`, `voided_at`, `duplicate_of`,
`visible_to_vendor`). Those are literal keys in the patch objects. Grep each module for the old name.

## Helpers (`lib/server/budget/`)

Each returns `BudgetResult<T>` (`result.ts`): `{ ok: true, data }` or `{ ok: false, kind, code, message }`.
- `kind` is one of `disabled`, `not_found`, `refused`, `conflict`, `in_use`, `invalid`, `error`.
- Postgres codes map as follows: 42501 to `refused`, 23505 to `conflict`, 23503 to `in_use` (relabelled
  `invalid` where it means a bad cross-project reference), and 23514/23502/22P02 to `invalid`.

| Module | Helper | Ruling |
|---|---|---|
| `scope.ts` | `budgetSession`, `budgetWriteOrgId`, `requireAgencyProject` | boundary |
| `chart.ts` | `listTemplateCategories`, `createTemplateCategory`, `updateTemplateCategory` (rename / flag / archive), `deleteTemplateCategory` | R1 (a template is always deletable: nothing references it) |
| `chart.ts` | `copyTemplateToProject` | R6 RPC |
| `chart.ts` | `listProjectCategories`, `addProjectCategory`, `setProjectCategoryArchived`, `deleteProjectCategory` (23503 becomes `in_use`) | R1 |
| `chart.ts` | `promoteProjectCategory` | copy of name and flag, no pointer |
| `chart.ts` | `mergeProjectCategories`, `repointMergedCategory`, `renameProjectCategory`, `listCategoryMerges` | merge/rename with history; `original_category_id` is never touched |
| `lines.ts` | `listLines`, `createLine`, `updateLine`, `archiveLine` | R5: estimate only |
| `lines.ts` | `deleteLine` | R1 (see below) |
| `documents.ts` | `listProjectDocuments`, `recordDocumentUpload` (agency, metadata only), `setDocumentVisibility` (toggle / share) | R4 toggle |
| `documents.ts` | `setProjectDocumentsArchived` | R3 RPCs |
| `ledger.ts` | `listLedgerEntries` (voided entries excluded unless asked), `createLedgerEntry` | |
| `ledger.ts` | `voidLedgerEntry` | R2; there is no delete helper |
| `summary.ts` | `getEstimateVsActual` | R5: Actual = signed sum of non-voided entries per line, in integer cents |
| `http.ts` | `budgetRouteSession`, `budgetRouteProject`, `budgetResponse`, `failureResponse`, `readJson` | route plumbing |

`deleteLine` reads the line first, because a USING refusal in Postgres is silent (0 rows):
- estimate is not 0: `refused`, code `R1_ESTIMATE` (HTTP 403)
- a ledger entry references the line: `in_use` (HTTP 409)

In both cases the caller archives instead.

## Routes (`app/api/agency/budget/`)

All are `force-dynamic` and `Cache-Control: private, no-store`. They authenticate (401), require
organization membership (403), and on project routes require the agency-of-project gate (404).

| Route | Methods |
|---|---|
| `templates` | GET (`?include_archived=1`), POST `{ name, feeOrCost }` |
| `templates/[categoryId]` | PATCH `{ name?, feeOrCost?, archived? }`, DELETE |
| `projects/[projectId]/chart` | GET (categories and merges), POST `{ action: "copy_template" }` or `{ action: "add", name, feeOrCost }` |
| `projects/[projectId]/chart/[categoryId]` | POST `{ action: archive \| unarchive \| promote \| rename{name} \| merge{intoCategoryId} \| repoint }`, DELETE |
| `projects/[projectId]/lines` | GET, POST `{ categoryId, name, estimate }` |
| `projects/[projectId]/lines/[lineId]` | PATCH `{ name?, estimate?, categoryId?, archived? }`, DELETE (R1) |
| `projects/[projectId]/documents` | GET, POST `{ action: "record", fileName, blobPath, partnershipId? }` or `{ action: "archive" \| "unarchive" }` |
| `projects/[projectId]/documents/[documentId]` | PATCH `{ visibleToVendor, partnershipId? }` |
| `projects/[projectId]/ledger` | GET (`?include_voided=1`), POST |
| `projects/[projectId]/ledger/[entryId]/void` | POST `{ reason?, duplicateOf? }` |
| `projects/[projectId]/summary` | GET |

## Known limits, stated rather than hidden
1. **Merge is not atomic.** PostgREST gives the helpers no transaction. The merge row is inserted first
   (append-only history), then lines and ledger entries are re-pointed. If a re-point fails, the route
   returns an error saying so, and `{ action: "repoint" }` finishes it (it is idempotent). A
   `SECURITY INVOKER` merge function in migration 113 or later would make it atomic. That is a schema
   change, so it was not made here.
2. **Rename** creates the new category and then merges into it. If the merge step fails, the new empty
   category remains and can be deleted.
3. **Template scope for a vendor.** A vendor who calls the template routes sees and writes only its own
   organization's template rows. That is its own data, not an agency's, and organizations carry no
   type column to refuse it with. Project routes refuse it outright.
4. **No vendor-provided document path.** Filing `uploader_side = 'vendor'` rows needs trusted server
   code and a ruling on which submissions file one. It is not built.
5. **No test run against a database.** The helpers were typechecked, not executed.

## Assumptions
- "Agency" for these routes means "a member of the organization that owns the project", derived from
  `org_members`. This is the same definition 103's policies use.
- A recorded document's `blob_path` must start with `budget/<projectId>/`, so a row cannot point at
  another tenant's blob. That matters for the serving route that will be built later.
- An empty organization set is a 403 ("not linked to an organization yet"), matching
  `app/api/agency/client-cash-flow/route.ts`.
