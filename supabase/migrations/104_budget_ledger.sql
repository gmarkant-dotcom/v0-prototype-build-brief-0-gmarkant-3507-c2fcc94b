-- =====================================================================
-- 104: SOURCE DOCUMENTS AND THE LEDGER. THE ONLY VENDOR-FACING READ IN THE
--      BUDGET SCHEMA, AND THE ONLY ONE THERE WILL EVER BE ON A TABLE HERE.
--
-- AUTHORED 2026-10-08 on branch feat/client-required-and-spine. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. PARSE-CHECKED ONLY. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/104_preapply_test.sql AND GREG'S
-- SAY-SO. DEPENDS ON 103: APPLY 103 FIRST. THIS IS THE FILE TO READ SLOWLY.
--
--   CREATE TABLE public.source_documents
--   CREATE TABLE public.ledger_entries
--   ALTER  TABLE public.budget_lines ADD CONSTRAINT ..._project_id_id_key (UNIQUE)
--   CREATE public.source_documents_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE public.ledger_entries_guard()   -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE 7 POLICIES. EXACTLY ONE IS FOR A VENDOR: source_documents_vendor_select.
--   NO POLICY FOR ANY VENDOR ON ledger_entries. NO DELETE POLICY ON EITHER TABLE.
--
-- THE FULL FILENAME IS 104_budget_ledger.sql. Its rollback sibling is
-- 104_budget_ledger_down.sql. DO NOT GLOB.
--
-- NO FEATURE CODE CALLS ANY OBJECT HERE. 00 Budgeting is still non-navigable,
-- there is no upload route, no extraction, no page.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] 103 IS APPLIED AND VERIFIED (103's V1 to V6 returned their expected
--       values). This file references budget_project_categories and
--       budget_lines and raises LG104 inside its transaction if either is
--       absent. APPLY ORDER: 103, THEN 104. 104 DEPENDS ON 103; 103 DOES NOT
--       DEPEND ON 104.
--   [ ] Neither source_documents nor ledger_entries exists (P2 returns zero
--       rows). Enforced below with LG104.
--   [ ] 093 and 087 are applied: the pre-apply test moves partnership status as
--       the table owner and must not trip a guard it does not expect (P3).
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO
--       APPLY 104.". Any INCONCLUSIVE is work to do. In particular a NO
--       SUBJECT on clause (i) is NOT a pass: that is the assertion most likely
--       to be missing and the one that matters most.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- =====================================================================
-- THE ACCESS RULINGS (Greg, answered 2026-10-08) AND WHERE EACH LIVES
-- =====================================================================
--
--  R1  A vendor sees a source document ONLY IF the lead agency turns it on,
--      PER DOCUMENT. A per-document on/off, not a property of the relationship.
--        -> source_documents.visible_to_vendor, default false.
--  R2  ONE PERMANENT EXCEPTION overrides the toggle AND overrides termination:
--      IF THE VENDOR PROVIDED THE DOCUMENT THEY CAN ALWAYS SEE IT.
--        -> source_documents.uploader_side = 'vendor', in the vendor policy's
--           first branch, which never reads the toggle or the status.
--  R3  EVERY COLLEAGUE in a lead agency may read EVERY receipt. No per-member
--      scoping on the ledger.
--        -> the agency policies key on the organization only. There is no
--           per-user column to scope on and none was added.
--  R4  AN ENDED PARTNERSHIP revokes access to AGENCY documents, partnership-
--      scoped, AT TERMINATION ONLY and not at suspension.
--        -> the vendor policy's toggle branch requires ps.status NOT IN
--           ('terminated', 'removed'). 'suspended' is not in that list.
--  R5  NOTHING IS DESTROYED WHEN A PROJECT CLOSES. The lead agency MAY ARCHIVE,
--      a deliberate action with its own control. Model it as a STATE.
--        -> source_documents.archived_at. NO control is built. Archiving does not
--           change who can read a document (not ruled; see the report). NO
--           foreign key cascades, and there is NO DELETE POLICY on either
--           table, so a project, a document or an entry cannot be silently
--           destroyed. Deletion semantics (open question 1) are NOT answered
--           here; the absence of a DELETE policy is the conservative default and
--           a later ruling can add one.
--
-- =====================================================================
-- THE VENDOR POLICY, IN FULL, AND WHY EACH PART IS THERE
-- =====================================================================
--
--   USING (
--     partnership_id IS NOT NULL
--     AND EXISTS (
--       SELECT 1 FROM public.partnerships ps
--       WHERE ps.id = source_documents.partnership_id
--         AND ps.vendor_org_id IN (SELECT public.current_user_org_ids())      -- (i)
--         AND (
--           source_documents.uploader_side = 'vendor'                          -- (ii)
--           OR (source_documents.visible_to_vendor
--               AND ps.status NOT IN ('terminated', 'removed'))                -- (iii)
--         )
--     )
--   )
--
--   (i)  THE ROW MUST BELONG TO A PARTNERSHIP THE CALLER IS THE VENDOR SIDE OF.
--        This is the foundation and it cannot be omitted. WITHOUT IT, A
--        TOGGLE-ON DOCUMENT IS READABLE BY EVERY VENDOR ON THE PLATFORM, not
--        just the counterparty on that engagement: the toggle is a column on
--        the row, and a predicate of "visible_to_vendor" alone says nothing
--        about WHICH vendor. (i) pins the document to one engagement and the
--        caller to that engagement's vendor organization. (ii) and (iii) only
--        NARROW what (i) already admitted. It uses current_user_org_ids(), the
--        caller's OWN organizations (an AUTHORITY set), never
--        current_user_counterparty_org_ids() or current_user_visible_profile_ids()
--        (VISIBILITY sets, which 087 forbids for exactly this).
--        It is checked against ps.vendor_org_id explicitly and does not lean on
--        partnerships' own row level security, which is OR-ed across the lead
--        and vendor sides and would let a lead-agency member satisfy the EXISTS.
--   (ii) AND the document was uploaded by that vendor: uploader_side = 'vendor'.
--        This overrides the toggle AND the status, so it survives termination.
--        Authorship is expressed by a column that did not exist before this
--        migration: THE `uploader_side` COLUMN IS ADDED HERE for this purpose,
--        as the brief instructed. Because a document belongs to exactly one
--        partnership, "uploaded by that vendor" is "uploader_side = 'vendor'".
--   (iii) OR the toggle is on AND the partnership is not ended.
--
-- (iii) READS "NOT ENDED" AS status NOT IN ('terminated', 'removed'), NOT AS
-- status <> 'terminated'. The brief wrote the latter; 085 is this
-- repository's precedent for what ENDED means (its commercial tier excludes
-- both, and 093 records 'removed' as how an agency ends a relationship by
-- hiding it from its own pool). A vendor an agency removed should not keep
-- reading the agency's toggle-on documents. THIS IS NARROWER THAN THE BRIEF'S
-- LITERAL TEXT, deliberately, and it is a one-word change if Greg wants the
-- literal reading. It is a decision made here, and the pre-apply test asserts
-- both 'terminated' and 'removed'.
--
-- WHAT A VENDOR SEES ON A ROW IT CAN READ: the whole row, because RLS has no
-- column granularity: id, project_id, partnership_id, uploader_side,
-- visible_to_vendor, archived_at, file_name, blob_path, created_at. None of
-- those is a note, a margin or an amount. THE ROW IS NOT THE FILE. The file
-- lives in the private Vercel Blob store, and a row policy does not protect it:
-- whatever serves the bytes MUST resolve the row under the CALLER'S session
-- first and only then fetch. That is a build-plan constraint
-- (docs/budget-spine-build-plan.md), not something this file can enforce.
--
-- IMMUTABLE PROVENANCE, AND WHY. R2 is a promise that the vendor can ALWAYS see
-- what it provided. If the lead agency could UPDATE uploader_side from 'vendor'
-- to 'agency', or move the row to another partnership, R2 would be a promise
-- the lead agency could revoke with one statement. So source_documents_guard()
-- refuses to change project_id or uploader_side after insert, and refuses to
-- change partnership_id once it is set (NULL -> value is allowed: that is how an
-- agency receipt is SHARED with one vendor). It also refuses a partnership that
-- does not belong to the organization that owns the project, so an agency
-- cannot push its documents at a stranger's vendor.
-- The agency INSERT policy admits uploader_side = 'agency' ONLY. Rows with
-- uploader_side = 'vendor' are written by trusted server code (the service
-- role) when a vendor's own submission is filed; an agency member cannot mint
-- one, because a forged 'vendor' row would be a document the agency could never
-- hide from that vendor again.
--
-- =====================================================================
-- NO VENDOR POLICY ON ledger_entries, AND THE DISTINCTION
-- =====================================================================
--
-- A ledger entry is the AGENCY'S ACTUAL SPEND. An entry extracted from a
-- vendor's own invoice is the agency's record of what it spent, not the
-- vendor's record of what it billed. The vendor's record is the invoice, and the
-- invoice is a source_document the vendor can always read (R2). The entry
-- carries the agency's categorization, its reasoning, its budget line and its
-- amount as the agency booked it, which may differ from the invoice, and which
-- the vendor trust boundary (spec 2e) keeps from the vendor exactly as it keeps
-- the master budget. A vendor policy here would also expose the amount a vendor's
-- competitor was paid whenever a receipt covered both.
--
-- =====================================================================
-- EQUAL-OR-NARROWER
-- =====================================================================
--
-- BASELINE = production before this file: neither table exists, so every
-- principal reaches zero rows. After: an agency member reaches their own
-- organization's rows; a vendor reaches ONLY (documents it uploaded for its own
-- partnerships) plus (toggle-on documents of its own non-ended partnerships);
-- anon and everyone else reach zero. No existing table gains a policy. The one
-- ALTER on an existing table adds a UNIQUE constraint on a 103 table that
-- holds no row yet; it changes no access. The pre-apply test asserts the
-- fingerprint of every pre-existing policy is identical before and after.
--
-- Against the strictest alternative, "no vendor policy at all", the vendor policy
-- IS wider by design: R2 requires a vendor to read what it provided. Against the
-- loosest alternative, "a vendor reads every document of every partnership it
-- is on", it is narrower by the toggle and by termination.
--
-- =====================================================================
-- WHAT THIS DOES NOT DO (each is an owed ruling, not an omission)
-- =====================================================================
--   * Deletion semantics for a document with entries beneath it (Q1). There is
--     no DELETE policy; the foreign keys refuse. That is the "refuse" option's
--     behaviour, adopted as a default and not as a ruling.
--   * An ingestion state on the document ("a state on the document", spec
--     5e). Its values are not ruled, so no column.
--   * A content hash for convergent re-ingest (5e). The mechanism is not ruled.
--   * A review state, a suspected-duplicate flag, a currency, an uploader user,
--     a retention period (spec section 6 question 4). None is ruled.
--   * Whether archiving hides a document from the vendor. Not ruled.
--   * Which agency member may flip the toggle. Not ruled: every member can.
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Confirm 103 is applied (P1). Run P2 to P4. Record the answers.
--   2. Paste supabase/migrations/104_preapply_test.sql and run it ONCE. First
--      line must read "SAFE TO APPLY 104.". Read the whole report, above all
--      clause (i), the termination pair and the removed pair.
--   3. DRY RUN: replace the final COMMIT; (line numbers at the foot of this
--      header) with ROLLBACK; and run. Prove it rolled back: P2 must still
--      return zero rows.
--   4. Restore COMMIT; and run for real.
--   5. Run V1 to V7. They must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md.
--   Rollback: supabase/migrations/104_budget_ledger_down.sql (refuses if either
--   table holds a row).
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY. RUN AND WRITE DOWN THE ANSWERS.
-- =====================================================================
--
-- P1. 103 IS APPLIED.
--
--   SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges')
--   ORDER BY c.relname;
--
--   EXPECTED: four rows, relrowsecurity = true on every one.
--
-- P2. NEITHER OF THIS FILE'S TABLES EXISTS.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN ('source_documents', 'ledger_entries');
--
--   EXPECTED: zero rows.
--
-- P3. THE PARTNERSHIP STATUS DOMAIN THE VENDOR POLICY KEYS ON.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.partnerships'::regclass AND conname = 'partnerships_status_check';
--
--   EXPECTED: the five values pending, active, suspended, terminated, removed.
--   If a sixth exists, STOP: the policy's NOT IN list decides what it means and
--   someone must read it.
--
-- P4. THE POLICY TOTAL AND A FINGERPRINT OF EVERY POLICY THAT EXISTS NOW.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' ||
--                         coalesce(qual, '') || '|' || coalesce(with_check, ''),
--                         E'\n' ORDER BY tablename, policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public';
--
--   WRITE DOWN BOTH. After 103 this includes its 14 policies.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. TWO TABLES, ROW LEVEL SECURITY ON.
--
--   SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN ('source_documents', 'ledger_entries') ORDER BY c.relname;
--
--   EXPECTED: two rows, relrowsecurity = true on both.
--
-- V2. SEVEN POLICIES, ALL authenticated, NO DELETE ANYWHERE.
--
--   SELECT tablename, policyname, cmd, roles::text FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('source_documents', 'ledger_entries')
--   ORDER BY tablename, cmd, policyname;
--
--   EXPECTED: 7 rows, roles = {authenticated} on all. source_documents: INSERT,
--   SELECT (agency), SELECT (vendor), UPDATE. ledger_entries: INSERT, SELECT, UPDATE.
--   No row has cmd = DELETE.
--
-- V3. EXACTLY ONE POLICY IN THE WHOLE BUDGET SCHEMA IS VENDOR-FACING.
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('budget_template_categories', 'budget_project_categories', 'budget_lines',
--                       'budget_category_merges', 'source_documents', 'ledger_entries')
--     AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '(vendor_org_id|partnership)';
--
--   EXPECTED: exactly one row: source_documents / source_documents_vendor_select.
--
-- V4. THE VENDOR POLICY CARRIES ALL THREE PARTS.
--
--   SELECT qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'source_documents' AND policyname = 'source_documents_vendor_select';
--
--   EXPECTED: the text contains partnership_id, vendor_org_id, current_user_org_ids,
--   uploader_side, visible_to_vendor and the status list 'terminated' and 'removed'.
--   It must NOT contain 'suspended'.
--
-- V5. NO PRE-EXISTING POLICY MOVED. Re-run P4.
--
--   EXPECTED: n_policies = (P4 figure) + 7, and the fingerprint computed with
--   `AND tablename NOT IN ('source_documents', 'ledger_entries')` appended equals
--   the P4 fingerprint exactly.
--
-- V6. anon HAS NO PRIVILEGE; NO FOREIGN KEY CASCADES.
--
--   SELECT t, has_table_privilege('anon', 'public.' || t, 'SELECT') AS anon_select
--   FROM unnest(ARRAY['source_documents', 'ledger_entries']) AS t;
--   -- EXPECTED: false on both.
--
--   SELECT conrelid::regclass AS tbl, conname, confdeltype FROM pg_constraint
--   WHERE contype = 'f' AND conrelid::regclass::text IN ('source_documents', 'ledger_entries')
--   ORDER BY 1, 2;
--   -- EXPECTED: confdeltype = 'a' (NO ACTION) on EVERY row.
--
-- V7. BOTH TRIGGERS, AND NEITHER FUNCTION IS CALLABLE BY ANYONE.
--
--   SELECT tgrelid::regclass AS tbl, tgname, tgenabled, (tgtype & 2) = 2 AS before_event,
--          (tgtype & 4) = 4 AS on_insert, (tgtype & 16) = 16 AS on_update
--   FROM pg_trigger WHERE tgrelid IN ('public.source_documents'::regclass, 'public.ledger_entries'::regclass)
--     AND NOT tgisinternal ORDER BY 1;
--   -- EXPECTED: two rows, tgenabled = 'O', all three booleans true on both.
--
--   SELECT has_function_privilege('anon', 'public.source_documents_guard()', 'EXECUTE')     AS a1,
--          has_function_privilege('authenticated', 'public.source_documents_guard()', 'EXECUTE') AS a2,
--          has_function_privilege('anon', 'public.ledger_entries_guard()', 'EXECUTE')       AS l1,
--          has_function_privilege('authenticated', 'public.ledger_entries_guard()', 'EXECUTE')   AS l2;
--   -- EXPECTED: false, false, false, false.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 322 and COMMIT is at line 696.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.budget_project_categories') IS NULL
     OR to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '104 refuses to apply: migration 103 is not applied (budget_project_categories or budget_lines is missing). Apply 103 first.'
      USING ERRCODE = 'LG104';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '104 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG104';
  END IF;

  IF to_regclass('public.partnerships') IS NULL THEN
    RAISE EXCEPTION '104 refuses to apply: public.partnerships does not exist.'
      USING ERRCODE = 'LG104';
  END IF;

  IF to_regclass('public.source_documents') IS NOT NULL OR to_regclass('public.ledger_entries') IS NOT NULL THEN
    RAISE EXCEPTION '104 refuses to apply: source_documents or ledger_entries already exists. Plain CREATE TABLE is used on purpose.'
      USING ERRCODE = 'LG104';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. ONE UNIQUE CONSTRAINT ON A 103 TABLE, so ledger_entries can use a composite
--    foreign key that forces its budget line to be in the same project. The
--    table holds no row yet and no access changes.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_project_id_id_key UNIQUE (project_id, id);


-- ---------------------------------------------------------------------
-- 2. SOURCE DOCUMENTS. One file, many ledger entries beneath it.
--
-- NO FOREIGN KEY HERE CASCADES: a project or a partnership with documents cannot
-- be deleted out from under them.
-- ---------------------------------------------------------------------
CREATE TABLE public.source_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id),
  partnership_id    uuid        NULL     REFERENCES public.partnerships(id),
  uploader_side     text        NOT NULL,
  visible_to_vendor boolean     NOT NULL DEFAULT false,
  archived_at       timestamptz NULL,
  file_name         text        NOT NULL,
  blob_path         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_documents_project_id_id_key
    UNIQUE (project_id, id),
  CONSTRAINT source_documents_uploader_side_check
    CHECK (uploader_side IN ('agency', 'vendor')),
  -- A document the vendor provided belongs to that vendor's partnership from birth.
  CONSTRAINT source_documents_vendor_has_partnership
    CHECK (uploader_side <> 'vendor' OR partnership_id IS NOT NULL),
  -- The toggle is meaningless without a partnership to scope it to. A toggle that could be on
  -- with no partnership would read as shared and be visible to nobody.
  CONSTRAINT source_documents_toggle_needs_partnership
    CHECK (NOT visible_to_vendor OR partnership_id IS NOT NULL),
  CONSTRAINT source_documents_file_name_present
    CHECK (btrim(file_name) <> ''),
  CONSTRAINT source_documents_blob_path_present
    CHECK (btrim(blob_path) <> '')
);

COMMENT ON TABLE public.source_documents IS
  'A receipt, invoice or statement filed against a project: the FILE, not the spend. One document '
  'produces many ledger_entries (spec finding 1). Owned by the lead agency that owns the project. '
  'A vendor reads a row ONLY through source_documents_vendor_select: when the row belongs to a '
  'partnership the vendor is the vendor side of, AND (the vendor uploaded it, which is permanent '
  'and survives termination, OR the lead agency turned the per-document toggle on and the '
  'partnership has not ended). uploader_side, project_id and (once set) partnership_id are '
  'immutable, so the permanent right cannot be revoked by an UPDATE. No DELETE policy: nothing is '
  'destroyed. The row is not the file: the bytes live in the private Blob store and whatever serves '
  'them must resolve this row under the caller''s own session first.';

COMMENT ON COLUMN public.source_documents.uploader_side IS
  'Who PROVIDED the document: agency or vendor. Added by migration 104 to express authorship, which '
  'the vendor policy''s permanent branch needs. A vendor-provided document is written by trusted '
  'server code, never by an agency member (the agency INSERT policy admits only agency) and never '
  'by a vendor session (no vendor INSERT policy). Immutable after insert.';

COMMENT ON COLUMN public.source_documents.visible_to_vendor IS
  'The per-document toggle (ruling R1): the lead agency turns it on for THIS document. Default off. '
  'It only has effect together with partnership_id, which says WHICH vendor, and it stops having '
  'effect when the partnership ends. It does not affect a document the vendor itself provided.';

COMMENT ON COLUMN public.source_documents.archived_at IS
  'The archive STATE (ruling R5). NULL means not archived. No control exists to set it. Nothing '
  'is destroyed when a project closes; archiving is a deliberate agency action and not a delete.';

COMMENT ON COLUMN public.source_documents.blob_path IS
  'Where the file lives in the PRIVATE Vercel Blob store. Row visibility does not protect the '
  'file: the serving route must read this row as the caller first.';

CREATE INDEX source_documents_partnership_idx
  ON public.source_documents (partnership_id)
  WHERE partnership_id IS NOT NULL;

CREATE INDEX source_documents_project_idx
  ON public.source_documents (project_id);


-- ---------------------------------------------------------------------
-- 3. THE LEDGER. The agency's actual spend, one row per receipt, SIGNED.
--
-- A credit is a NEGATIVE amount and reduces the actual on its line (spec
-- 5d); there is no sign constraint. original_category_id is the category the
-- entry was FIRST filed under and never changes, which is what lets a merge
-- (103's budget_category_merges) happen without losing the answer to "what was
-- this filed as". category_id is where it sits NOW.
-- ---------------------------------------------------------------------
CREATE TABLE public.ledger_entries (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid          NOT NULL REFERENCES public.projects(id),
  source_document_id   uuid          NOT NULL,
  category_id          uuid          NOT NULL,
  original_category_id uuid          NOT NULL,
  budget_line_id       uuid          NULL,
  amount               numeric(14,2) NOT NULL,
  payee_name           text          NULL,
  entry_date           date          NULL,
  category_confidence  numeric       NULL,
  category_reasoning   text          NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_source_document_fkey
    FOREIGN KEY (project_id, source_document_id)
    REFERENCES public.source_documents (project_id, id),
  CONSTRAINT ledger_entries_category_fkey
    FOREIGN KEY (project_id, category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT ledger_entries_original_category_fkey
    FOREIGN KEY (project_id, original_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  -- MATCH SIMPLE: a NULL budget_line_id (not yet on a line) is not checked.
  CONSTRAINT ledger_entries_budget_line_fkey
    FOREIGN KEY (project_id, budget_line_id)
    REFERENCES public.budget_lines (project_id, id)
);

COMMENT ON TABLE public.ledger_entries IS
  'The agency''s ACTUAL SPEND: one row per receipt or invoice line, extracted from a source_document '
  '(one document, many entries). Signed: a credit is negative and reduces the actual on its line. '
  'Agency-only. NO vendor policy exists or may be added: an entry extracted from a vendor''s own '
  'invoice is the agency''s record of what it spent, not the vendor''s record of what it billed '
  '(the vendor''s record is the invoice, a source_document it can always read). Every colleague in '
  'the organization may read every entry. No DELETE policy.';

COMMENT ON COLUMN public.ledger_entries.original_category_id IS
  'The category this entry was FIRST filed under. Set from category_id on insert by '
  'ledger_entries_guard() and immutable afterwards. When two categories are merged '
  '(budget_category_merges) category_id moves and this does not, so last month''s export and this '
  'month''s can be reconciled (ruling 2f).';

COMMENT ON COLUMN public.ledger_entries.amount IS
  'SIGNED (ruling 5d). Positive spends, negative credits. numeric(14,2). No currency is recorded.';

COMMENT ON COLUMN public.ledger_entries.budget_line_id IS
  'The budget line this entry counts against ("the actual on its line"). NULL until reconciled. '
  'The reconciliation model beyond this one link, and partial refunds against a reconciled entry, '
  'are open questions (spec questions 4 and 6).';

COMMENT ON COLUMN public.ledger_entries.payee_name IS
  'Who was paid. The spec''s "vendor" in "vendor plus date plus amount" (finding 4), named payee_name '
  'here so it is not read as a partner vendor. Nullable: extraction may not read it.';

COMMENT ON COLUMN public.ledger_entries.category_reasoning IS
  'The model''s stated reasoning for the category, stored per entry (finding 3). It cannot be '
  'recovered later without re-running extraction.';

CREATE INDEX ledger_entries_document_idx
  ON public.ledger_entries (source_document_id);

CREATE INDEX ledger_entries_project_category_idx
  ON public.ledger_entries (project_id, category_id);

CREATE INDEX ledger_entries_budget_line_idx
  ON public.ledger_entries (budget_line_id)
  WHERE budget_line_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4. THE DOCUMENT GUARD. Provenance is immutable, and a partnership must belong
--    to the organization that owns the project.
--
-- SECURITY INVOKER on purpose: it reads partnerships and projects as the
-- caller, so a caller who cannot see the partnership gets a refusal, which is
-- the safe direction. The service role sees everything and is held to the same
-- rule. It only raises; it never assigns to NEW.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.source_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_org uuid;
  v_project_org uuid;
BEGIN
  IF NEW.partnership_id IS NOT NULL THEN
    SELECT ps.lead_org_id INTO v_lead_org FROM public.partnerships ps WHERE ps.id = NEW.partnership_id;
    SELECT pr.org_id INTO v_project_org FROM public.projects pr WHERE pr.id = NEW.project_id;
    IF v_lead_org IS NULL OR v_project_org IS NULL OR v_lead_org <> v_project_org THEN
      RAISE EXCEPTION 'source_documents: partnership % does not belong to the organization that owns project %',
        NEW.partnership_id, NEW.project_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.uploader_side IS DISTINCT FROM OLD.uploader_side THEN
      RAISE EXCEPTION 'source_documents.project_id and uploader_side are immutable (the vendor''s right to a document it provided cannot be revoked by an update)'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.partnership_id IS NOT NULL AND NEW.partnership_id IS DISTINCT FROM OLD.partnership_id THEN
      RAISE EXCEPTION 'source_documents.partnership_id cannot be changed once set'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER source_documents_guard
  BEFORE INSERT OR UPDATE ON public.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.source_documents_guard();

REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 5. THE LEDGER GUARD. An entry is originally filed under the category it is
--    created in; that, its project and its document never change.
--    A supplied original_category_id that disagrees with category_id is refused
--    rather than silently overwritten.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.ledger_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.original_category_id IS NULL THEN
      NEW.original_category_id := NEW.category_id;
    ELSIF NEW.original_category_id <> NEW.category_id THEN
      RAISE EXCEPTION 'ledger_entries: an entry is originally filed under the category it is created in (original %, category %)',
        NEW.original_category_id, NEW.category_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.original_category_id IS DISTINCT FROM OLD.original_category_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id THEN
      RAISE EXCEPTION 'ledger_entries.original_category_id, project_id and source_document_id are immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_guard
  BEFORE INSERT OR UPDATE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_entries_guard();

REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 6. PRIVILEGES. anon gets nothing, by name.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.source_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.source_documents FROM anon;
REVOKE ALL ON TABLE public.ledger_entries   FROM PUBLIC;
REVOKE ALL ON TABLE public.ledger_entries   FROM anon;


-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY. SEVEN POLICIES. ONE IS FOR A VENDOR.
-- ---------------------------------------------------------------------
ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries   ENABLE ROW LEVEL SECURITY;

-- ---- source_documents: the lead agency, by the project's organization ----
CREATE POLICY "source_documents_org_select"
  ON public.source_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- An agency member files AGENCY documents only. A 'vendor' row is written by trusted server code.
CREATE POLICY "source_documents_org_insert"
  ON public.source_documents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    uploader_side = 'agency'
    AND project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "source_documents_org_update"
  ON public.source_documents AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- ---- source_documents: THE ONLY VENDOR-FACING POLICY IN THE BUDGET SCHEMA. READ-ONLY. ----
--   (i)   the caller is the VENDOR SIDE of the row's partnership (authority set, explicit);
--   (ii)  the vendor provided it: permanent, ignores the toggle and the status; OR
--   (iii) the lead agency turned it on AND the partnership has not ended.
-- 'suspended' is not an ending (ruling R4); 'terminated' and 'removed' are (085's precedent).
CREATE POLICY "source_documents_vendor_select"
  ON public.source_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.partnerships ps
      WHERE ps.id = source_documents.partnership_id
        AND ps.vendor_org_id IN (SELECT public.current_user_org_ids())
        AND (
          source_documents.uploader_side = 'vendor'
          OR (source_documents.visible_to_vendor
              AND ps.status NOT IN ('terminated', 'removed'))
        )
    )
  );

-- NO DELETE POLICY on source_documents. Not an omission: nothing is destroyed.

-- ---- ledger_entries: the lead agency ONLY. NO VENDOR POLICY. NO DELETE POLICY. ----
CREATE POLICY "ledger_entries_org_select"
  ON public.ledger_entries AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "ledger_entries_org_insert"
  ON public.ledger_entries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "ledger_entries_org_update"
  ON public.ledger_entries AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

COMMIT;
