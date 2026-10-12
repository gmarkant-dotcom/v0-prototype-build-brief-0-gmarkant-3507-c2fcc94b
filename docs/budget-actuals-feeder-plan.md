# The actuals feeder: receipt and invoice digester (plan only)

**Written:** 2026-10-12, branch `feat/budget-ui`. Unattended session. **No code and no migration in this
file is built or applied.** The next free migration number at the time of writing is 116 (state of
record 2026-10-12), **but `docs/rfp-source-of-truth-design.md` also claims 116 to 118** for the RFP
record. "116" below means "the next free number at authoring time"; `docs/budget-116-plus-plan.md`
calls this migration B0 and gives the ordering.

**Read first:** `docs/budget-actuals-findings.md` (the extraction test and its qualifications),
`docs/ligament-00-budgeting-spec.md` section 5, `supabase/migrations/104_budget_ledger.sql`, and
`docs/budget-ui-report.md` (what the UI run built, including the "manual reference" documents below).

## 1. What it is

A producer drops a PDF or photo of one or many receipts or invoices on a project. Ligament stores the
file privately, extracts every receipt it contains as a ledger entry with a category, a confidence and
the model's stated reasoning, flags suspected duplicates, and puts uncertain entries in a review queue.
Actual on the budget (R5: the signed sum of non-voided entries) moves only when entries exist.

Positioning still holds (spec 2h): this feeds the producer's working budget and the finance export. It
is not the accounting ledger of record.

## 2. What 103 / 104 already give it

| Need | Where |
|---|---|
| One document, many entries | `source_documents` 1-to-many `ledger_entries` (104) |
| Signed amount, credit negative | `ledger_entries.amount numeric(14,2)`, no sign check |
| Category, original category frozen on insert | `category_id`, `original_category_id` + `ledger_entries_guard` |
| Model confidence and reasoning per entry | `category_confidence`, `category_reasoning` |
| Never delete; void a duplicate with a pointer | `voided_at`, `void_reason`, `duplicate_of` (R2) |
| Vendor document visibility | `source_documents_vendor_select` (R4) |
| Archive without changing access | `budget_archive_project_documents` (R3) |

## 3. What it needs that 103 / 104 lack

1. **Ingestion state on the document.** Spec 5e requirement 2: a failure is a state on the document, not
   a log line. Values proposed: `queued`, `extracting`, `extracted`, `failed`, `partial`. Plus
   `ingest_error text`, `pages_total int`, `pages_failed int`, `entries_found int` (requirement 4: report
   the count).
2. **Content hash.** Requirement 3: re-ingesting the same file converges. `content_sha256 text` with a
   UNIQUE `(project_id, content_sha256)`; a second upload of the same bytes returns the existing document.
3. **Per-entry review state.** `review_state text` (`needs_review`, `accepted`) and `reviewed_at`,
   `reviewed_by`. The review queue is a queue of ENTRIES (spec 5a).
4. **Duplicate flag, separate from void.** `suspected_duplicate_of uuid` (composite FK, same project),
   set by the dedupe pass (payee + date + amount across ALL documents of the project). It is a flag for a
   human; confirming it becomes the existing R2 void with `duplicate_of`. Never auto-merged.
5. **Org-prefixed storage paths.** 104 and `lib/server/budget/schema.ts` constrain `blob_path` to
   `budget/<projectId>/`. Proposed: `budget/<orgId>/<projectId>/<documentId>/<sha256>.<ext>` so a path
   alone names its tenant, and a storage listing per organization is possible for retention work. The
   prefix check in `validBlobPath` moves to the new shape in the same change.
6. **Uploader user.** `uploaded_by uuid` (who, for audit in the producer sense, not the accounting sense).
7. **A real "no file" document kind.** The UI run had to record manual ledger entries against a document
   row whose `blob_path` is a placeholder under `budget/<projectId>/manual/` (no bytes exist), because
   `ledger_entries.source_document_id` is NOT NULL. Proposed: `source_documents.kind text NOT NULL
   DEFAULT 'file' CHECK (kind IN ('file','manual'))` and `blob_path` nullable only for `manual`.
   Migrate existing placeholder rows by prefix.

## 4. Migration 116 sketch (not authored)

```sql
BEGIN;
ALTER TABLE public.source_documents
  ADD COLUMN kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file','manual')),
  ADD COLUMN ingest_state text NULL CHECK (ingest_state IN ('queued','extracting','extracted','failed','partial')),
  ADD COLUMN ingest_error text NULL,
  ADD COLUMN pages_total integer NULL,
  ADD COLUMN pages_failed integer NULL,
  ADD COLUMN entries_found integer NULL,
  ADD COLUMN content_sha256 text NULL,
  ADD COLUMN uploaded_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.source_documents ALTER COLUMN blob_path DROP NOT NULL;
ALTER TABLE public.source_documents
  ADD CONSTRAINT source_documents_file_has_blob CHECK (kind = 'manual' OR blob_path IS NOT NULL);
CREATE UNIQUE INDEX source_documents_project_sha ON public.source_documents (project_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;
UPDATE public.source_documents SET kind = 'manual' WHERE blob_path LIKE 'budget/%/manual/%';

ALTER TABLE public.ledger_entries
  ADD COLUMN review_state text NOT NULL DEFAULT 'accepted' CHECK (review_state IN ('needs_review','accepted')),
  ADD COLUMN reviewed_at timestamptz NULL,
  ADD COLUMN reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN suspected_duplicate_of uuid NULL,
  ADD CONSTRAINT ledger_entries_suspected_dup_fkey FOREIGN KEY (project_id, suspected_duplicate_of)
    REFERENCES public.ledger_entries (project_id, id),
  ADD CONSTRAINT ledger_entries_suspected_dup_not_self CHECK (suspected_duplicate_of IS NULL OR suspected_duplicate_of <> id);
-- Existing policies are project-scoped (PROJ) and need no change; the vendor policy reads none of these
-- columns. Grants unchanged. Add the columns to lib/server/budget/schema.ts in the same change.
NOTIFY pgrst, 'reload schema';
COMMIT;
```

Pre-apply test in the 103 / 104 style: impersonation control, a NOT DISCRIMINATING owner run for every
"cannot" case, and the vendor policy re-asserted unchanged.

## 5. Screens

1. **Documents tab, upload.** Drop zone (PDF, JPG, PNG, HEIC), per-file progress, then per-document
   state chip: QUEUED, EXTRACTING, n ENTRIES, FAILED (with the reason and a Retry), PARTIAL (n of m pages).
2. **Review queue** (Ledger tab, a filter): entries with `review_state = 'needs_review'`, low confidence
   first. Each row: payee, date, amount, proposed category, the model's reasoning, and the page image.
   Actions: accept, change category, assign to a line, void as duplicate.
3. **Duplicate flags**: a row badge SUSPECTED DUPLICATE linking the two entries side by side; "Keep both"
   clears the flag, "Void this one" is the R2 void with `duplicate_of`.
4. **Chart gap prompt** (spec 5c): "12 entries were filed under Venue with low confidence, most look like
   storage. Add a Storage category?" Uses the existing add-category path.

## 6. Extraction flow (validated output)

1. Upload to the PRIVATE Blob store, server-side, under the org-prefixed path; compute SHA-256; insert or
   return the existing `source_documents` row (convergent).
2. A background step (Vercel Queues or a Workflow; one document per message) renders pages and calls the
   model with the project's live category names only. Same provider pattern as the repo's AI routes
   (`@ai-sdk/anthropic`, the model string they use), behind `canUseAgencyAi`.
3. **Schema-constrained output** with zod, per page: `{ receipts: [{ payee, date (YYYY-MM-DD|null),
   amount (string, two decimals, signed), is_refund (boolean), category (one of the given names |
   { new: string }), confidence (0..1), reasoning (string, max 600) }] }`. Anything that fails the schema
   marks the PAGE failed; it is never salvaged by regex (spec 5e: salvage was the 186 vs 280 difference).
4. Amounts are parsed to integer cents with the same parser as the UI import
   (`lib/budget/money.ts parseMoneyToCents`); a refund must come back `is_refund: true` and is stored
   negative. A positive amount with `is_refund: true` is negated; a negative amount with
   `is_refund: false` is a page failure, not a guess.
5. Insert entries (category, reasoning, confidence; `original_category_id` left to the trigger);
   `review_state = 'needs_review'` below the confidence threshold.
6. Dedupe pass over the whole project: same payee (normalised), same date, same amount in cents. Sets
   `suspected_duplicate_of`. Never voids on its own.
7. Update the document's state and counts. A document with any failed page is `partial`, never
   `extracted`.

**Sign convention:** a cost is positive, a credit or refund is negative, on every entry. Actual is the
signed sum of non-voided entries (R2, R5); a refund lowers Actual on its line.

## 7. Owner decisions owed

1. The ingestion state values and whether `partial` is a state or `extracted` plus a count.
2. The confidence threshold for `needs_review` (the test used 0.7; not ruled).
3. Whether an accepted entry may still be re-categorised (the guard keeps `original_category_id` either
   way).
4. Retention of receipt images after a project closes (104 R5: nothing is destroyed; is a purge ever
   wanted?).
5. Which vendor submissions file a `source_documents` row with `uploader_side = 'vendor'` (bids,
   invoices, status updates), and the trusted server path that writes them.
6. Partial refunds against an already-reconciled entry (spec Q6).
7. Whether the "manual" document kind (section 3 item 7) is acceptable, or manual entries should get
   their own nullable `source_document_id` instead (the latter weakens "every actual traces to a
   document", which finance export relies on).
8. The org-prefixed path shape, and whether existing `budget/<projectId>/` rows are moved or grandfathered.
