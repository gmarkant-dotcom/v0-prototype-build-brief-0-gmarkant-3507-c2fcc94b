# The budget spine: build plan for the session that builds it

**Written:** 2026-10-08, branch `feat/client-required-and-spine`. **Merge status: not stated here.**
Check with `git merge-base --is-ancestor <sha> main`.

**What this is.** The phases a build session would run, in order, with what each needs and what blocks
it. It exists so that session does not have to rediscover the rulings, the schema, or the traps.

**What exists after this branch.** Two migrations, **authored and not applied**:
`supabase/migrations/103_budget_core.sql` and `supabase/migrations/104_budget_ledger.sql`, each with a
down file and a generated pre-apply test. **No feature code, no route, no page.** 00 Budgeting is still
the non-navigable "Coming soon" item in `components/agency-layout.tsx`. Nothing in this repository reads
or writes any table these migrations create.

**Read first, in this order:** `docs/ligament-00-budgeting-spec.md`, `docs/budget-actuals-findings.md`,
`docs/client-required-and-spine-report.md` (the column-by-column account of what was and was not built,
and why), then the two migration headers. Every claim about the live database in this plan is a
**prediction** until the apply checklist in section 0 has been run.

---

## 0. Before any code: apply 103, then 104

**Order is fixed: 103, then 104. 104 depends on 103. 103 does not depend on 104.** 104 refuses to apply
(`LG104`) if 103's tables are absent, and 104's pre-apply test applies 103 inside its own rolled-back
transaction if it is absent, so the test can be run first.

For each of 103 and 104, in this order (the full procedure is in each file's header):

1. Run the pre-flight captures P1 to P4.
2. Paste the `NNN_preapply_test.sql` and run it **once**. It ends in an error and the error is the result.
   The first line must read `SAFE TO APPLY NNN.`. An `INCONCLUSIVE` is work to do. A `NO SUBJECT` on the
   clause (i) pair (104's I1 and I2) is **not** a pass: it means that assertion did not run.
3. Dry run with `COMMIT;` swapped for `ROLLBACK;`, then prove by catalog query that it rolled back.
4. Apply for real. Run V1 onward and compare to the stated values exactly.
5. Add a row for the migration to the table in `LIGAMENT_CONTEXT.md` (it stops at 078 and is incomplete;
   add 103 and 104 and consider adding 079 to 102 while there).

**Do not start section 2 onward against unapplied migrations.** A route that selects from a table that does
not exist answers 42P01 and a page built on it renders an error. That is the intended behaviour (097's
header argues for it) and not something to paper over with a fallback.

## 1. The rulings that still block, and what each blocks

None of these is answered in this repository. The build must not answer them by shipping code.

| Open question | Blocks |
|---|---|
| **Q2** Are Committed, Actual and Paid stored or derived? | Any read of a line's four states. 103 stores **Estimate only**. Also decides whether `budget_lines` ever gains columns. |
| **Q3** What is a budget version (snapshot, diff, log)? What is an approved baseline? | The movement report, version comparison, and any edit history on lines. The strongest differentiator in the spec, and the one with no schema at all. |
| **Q4** What joins an awarded bid to a budget line? | Committed. The whole of spec section 4 step 5. |
| **Q4a** (new, `docs/client-required-and-spine-report.md`) How does an RFP-facing line point back to a master line, if it does? | The accept-or-dictate flow's bookkeeping (spec 2d). |
| **Q5** Where does merge history live? | 103 chose "a separate merge record" for the chart side and 104 stores the original category on the entry. If Greg wants only one of the two, one of them is wrong now. Confirm before building merge. |
| **Q10** The chart-of-accounts composition step and the shipped templates | The accuracy lever (spec 5b). Templates are content, and "the quality of the shipped templates largely determines the quality of the product". |
| **Q1** Deletion of a document with entries beneath it | A "delete this upload" control. 104 has **no DELETE policy** and NO ACTION keys, which is the "refuse" behaviour as a default. |
| **Q6** Partial refunds against a reconciled entry | Refund handling past "a credit is a negative entry". |
| **Retention** after a project closes (spec section 6 question 4) — ANSWERED 2026-10-08, see `supabase/migrations/104_budget_ledger.sql:44-70` (R5: nothing is destroyed on close; archive is a separate agency action) | Any scheduled purge. Nothing may delete in the meantime. |
| **Currency** | Any display or total. No currency is stored anywhere in 103 or 104. |

## 2. Phase A. The chart of accounts

**Needs:** 103 applied. **Blocked by:** Q10 for the shipped templates (not for the plumbing).

1. **Template editor** (agency settings): CRUD on `budget_template_categories`. Every category needs a
   fee-or-cost choice; the column has no default on purpose, so the form must ask.
2. **Copy-on-create.** When a project's budget is created, copy the template to
   `budget_project_categories` in **one statement** (`INSERT ... SELECT`, cast the literals: an unknown-typed
   literal in a select list will not coerce to uuid). 103's pre-apply test proves the copy is independent.
   Prefer a `SECURITY INVOKER` RPC if atomicity with the first budget write matters. Do not write a route
   that copies row by row: a failure halfway leaves a half-chart.
3. **Add a category** to a project at any time. **Promote** a project category back to the template is an
   INSERT into `budget_template_categories` from a project row. No pointer is stored (a pointer would let a
   template edit change a closed project), so "promoted from" is not recorded.
4. **Merge and rename.** Rename is a merge into a new name. A merge must, in one transaction:
   insert the `budget_category_merges` row; re-point `budget_lines.category_id` and
   `ledger_entries.category_id` from the retired category to the survivor; **never** touch
   `ledger_entries.original_category_id` (a trigger forbids it). The retired category row is kept forever.
   The cycle guard (`budget_category_merges_guard`) refuses merging into something already merged away.
   **Lines do not remember their original category** (not ruled), so a merge loses which lines were under
   the retired one. Ask before building the merge UI whether that matters.
5. "Live" categories are derived: those with no merge row naming them as the source. There is no `retired`
   column. Names are not unique on purpose (a retired category keeps its name).

## 3. Phase B. Budget ingestion and the editor

**Needs:** Phase A. **Blocked by:** nothing for estimate-only; Q3 before any "save version" button.

1. Ingest a spreadsheet into `budget_lines` (Estimate). **The ingested budget is the working artifact**
   (ruling 2a): after import the spreadsheet is irrelevant. Do not build re-sync.
2. **Extraction must be schema-constrained and lossless** (spec 5e). Do not copy
   `app/api/interpret/budget/route.ts`: it is the opposite direction (brief to estimate) and parses free-form
   JSON out of a fenced reply, the exact failure the findings document measured. Report how many lines were
   found. A row that fails is visible to the user as a failure, not a log line.
3. The editor page, and **then** make 00 Budgeting navigable. The nav comment in `agency-layout.tsx` is
   deliberate; changing it is the last step of this phase, not the first.
4. Margin view: fee-versus-cost is the load-bearing flag (2b); margin is only computable because every
   category carries it. **The margin formula itself is not ruled** and this plan does not state one. Get it
   from Greg before showing a margin number.
5. **Currency.** Decide before the first number is displayed. Adding a column later is
   `ADD COLUMN ... NOT NULL DEFAULT 'USD'`, which is safe, but a display built without it will be wrong in
   the first non-USD project.

## 4. Phase C. The RFP hand-off

**Needs:** Phase B. **Blocked by:** Q4 and Q4a.

The vendor trust boundary is the rule that governs this phase. **A vendor never sees the master budget.**
There is no vendor policy on any table in 103 or on `ledger_entries`, and there must never be one. What a
vendor sees is the existing RFP payload (`rfp_magic_tokens.budget_categories`,
`partner_rfp_responses.budget_lines`, migration 072): a released artifact the agency writes, distinct from
the master line.

1. Accept-or-dictate (2d): the producer either releases a master line as the RFP line (copy its allowance
   into the RFP payload) or dictates a different one. **Copy, never reference.**
2. **Guard it.** Add a check in the style of `scripts/check-org-id-reads.mjs`: no file under
   `app/api/partner/`, `app/partner/` or `app/api/rfp/guest/` may name `budget_template_categories`,
   `budget_project_categories`, `budget_lines`, `budget_category_merges` or `ledger_entries`. The only vendor
   code that may name a table from 104 is the document-serving route in Phase D, and only
   `source_documents`.
3. Committed (award to line) cannot start before Q4. Do not put a budget-line pointer on
   `partner_rfp_responses`: that table is vendor-writable and the pointer would run the boundary backwards.

## 5. Phase D. Source documents (the only vendor-facing read)

**Needs:** 104 applied. **Blocked by:** nothing in the schema; Q1 for deletion.

1. **Intake route.** Upload to the **private** Blob store (`app/api/upload/route.ts` routes by folder; the
   budget folder must not be one of the public Supabase folders). Insert the `source_documents` row with
   `uploader_side = 'agency'` as the signed-in agency member (the INSERT policy admits nothing else).
2. **Vendor-provided documents are written by trusted server code with the service role**, never by a
   vendor session (there is no vendor INSERT policy) and never by an agency member (the INSERT policy
   refuses `uploader_side = 'vendor'`). Decide which existing vendor submissions (bids, invoices, status
   updates) file a `source_documents` row and where; that choice is unmade. The row needs the vendor's
   `partnership_id` and the lead organization's `project_id`; the guard trigger refuses a mismatch.
3. **THE SERVING ROUTE IS THE WHOLE OF THE FILE'S SECURITY.** A row policy protects the row and nothing
   else: `blob_path` points into a private store and RLS does not reach it. The route that returns bytes
   **must first read the `source_documents` row with the CALLER'S SESSION client** (so
   `source_documents_vendor_select` or the agency policy decides), and only if that returns the row fetch the
   blob. Never read the row with the service role and then check access in code; never accept a `blob_path`
   from the request. `app/api/agency/blob-download/route.ts` is the closest existing route to read first.
4. **The toggle control** (any agency member may flip it; who may is not ruled): an UPDATE of
   `visible_to_vendor`. Turning it on needs a `partnership_id`; `source_documents_toggle_needs_partnership`
   refuses otherwise, and sharing an unshared document is `partnership_id` NULL to a value.
5. **Archive control** (R5): set `archived_at`. Archiving does not change who can read it (not ruled; ask).
6. **The vendor's view** of its documents lists what `source_documents_vendor_select` returns. Do not
   re-implement the predicate in application code; select and let the policy decide.
7. **Termination and removal** are already handled by the policy: `terminated` and `removed` revoke the
   toggle branch and not the authorship branch; `suspended` revokes nothing. Note this reads "ended" as both
   `terminated` and `removed`, which is narrower than the brief's literal "not terminated" (see the report).
8. Ingestion state, a content hash for convergent re-ingest, and an uploader user are **not columns** and
   will need the next free migration number at authoring time (109 or later; 105 is partnership_private_notes) once their values are ruled. The findings document requires all three
   behaviours; the schema deliberately does not guess.

## 6. Phase E. Extraction and the ledger

**Needs:** Phase D. **Blocked by:** Q6 for refunds past the sign convention; the ingestion-state columns.

1. Schema-constrained extraction, per page, with a visible per-document failure state and an entry count.
2. Insert `ledger_entries`. Do **not** supply `original_category_id`: the trigger sets it from
   `category_id`. A mismatch is refused (`23514`) rather than overwritten.
3. **Store the model's reasoning per entry** (`category_reasoning`) and the confidence. It cannot be
   recovered without re-running extraction (finding 3).
4. **Credits are negative.** Extraction must identify a refund as a refund; a refund posted positive
   inflates spend invisibly.
5. The review queue is a queue of **entries**. There is no review-state column yet; its values are not
   ruled. Dedupe runs across all documents in a project on payee plus date plus amount and **flags, never
   merges**. Neither a duplicate flag nor a review state exists in the schema.
6. "Add a Storage category?" (finding 3): cluster low-confidence entries by reasoning and suggest a
   category. Needs Phase A's add-category path.
7. Every colleague in the organization reads every entry (R3, 104's local numbering). Do not add per-member scoping.
8. **No vendor ever reads `ledger_entries`.** The Phase C guard covers it.

## 7. Phase F. Actual, Paid, versions, export

**Blocked by:** Q2, Q3, Q4.

- Actual per line = the sum of `ledger_entries.amount` where `budget_line_id` = the line (signed). Whether
  that is computed on read or cached is Q2. `budget_line_id` is nullable: an unreconciled entry counts
  against its category and no line.
- Paid is the existing cash-flow data. Nothing joins it to a budget line yet.
- Versions and the movement report against an approved baseline need Q3 first.
- Export is a first-class requirement (2h): Ligament is not the accounting ledger of record. Exports are
  written against entries; the original-category column is what makes two months' exports reconcilable
  after a merge.

## 8. Traps already found, so they are not found twice

- **Unproven SQL.** 093 passed a parse check and had a runtime bug (a bare string appended to a `text[]`)
  that only the first real run found. 103 and 104 and their tests have been parsed with the PostgreSQL
  parser and nothing else. Treat the first run of each test as the first time the SQL is executed.
- **A zero is not evidence.** Both pre-apply tests run every "cannot" case as the table owner first and
  report `NOT DISCRIMINATING` if the owner cannot. Keep that discipline in any test you add.
- **`SET LOCAL ROLE` plus claims is how the tests impersonate**, and every scenario reads `auth.uid()`
  back. A control that proves impersonation took is part of the test, not an extra.
- **Do not widen an existing table's policy** to make a budget query easier. New tables define their own
  policies; that is not a widening and is the only route.
- **Identifiers from a request are claims.** Resolve with `resolveCallerOrgIds` for reads and
  `resolveCallerWriteOrgId` for writes (`lib/entitlements.ts`). Never scope with the visibility sets
  (`current_user_counterparty_org_ids`, `current_user_visible_profile_ids`).
- **No em dashes** in copy.
