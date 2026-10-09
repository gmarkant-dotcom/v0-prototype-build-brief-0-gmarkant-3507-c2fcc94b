-- =====================================================================
-- 104: SOURCE DOCUMENTS AND THE LEDGER. THE ONLY VENDOR-FACING READ IN THE
--      BUDGET SCHEMA, AND THE ONLY ONE THERE WILL EVER BE ON A TABLE HERE.
--
-- AUTHORED 2026-10-08 on branch feat/client-required-and-spine. AMENDED
-- 2026-10-09 on branch fix/103-104-rulings TO THE OWNER'S RULINGS R1 TO R5 AND
-- R7 (below). NOT APPLIED. NOT RUN AGAINST POSTGRES. NO SQL PARSER WAS
-- AVAILABLE TO THE AUTHOR: THE OWNER'S PRE-APPLY TEST RUN IN THE SQL EDITOR IS
-- THE PARSE CHECK. DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/104_preapply_test.sql AND GREG'S SAY-SO. DEPENDS ON 103:
-- APPLY 103 FIRST. THIS IS THE FILE TO READ SLOWLY.
--
--   CREATE TABLE public.source_documents
--   CREATE TABLE public.ledger_entries   (with voided_at, void_reason, duplicate_of: R2)
--   ALTER  TABLE public.budget_lines ADD CONSTRAINT ..._project_id_id_key (UNIQUE)
--   CREATE public.source_documents_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE public.ledger_entries_guard()   -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE public.budget_archive_project_documents(uuid)   -> integer   (R3)
--   CREATE public.budget_unarchive_project_documents(uuid) -> integer   (R3)
--   CREATE 7 POLICIES. EXACTLY ONE IS FOR A VENDOR: source_documents_vendor_select.
--   NO POLICY FOR ANY VENDOR ON ledger_entries. NO DELETE POLICY AND NO DELETE
--   GRANT ON EITHER TABLE (R2, R7).
--   NOTIFY pgrst 'reload schema'.
--
-- THE FULL FILENAME IS 104_budget_ledger.sql. Its rollback sibling is
-- 104_budget_ledger_down.sql. DO NOT GLOB.
--
-- NO FEATURE CODE NAVIGATES TO ANY OBJECT HERE. 00 Budgeting is still
-- non-navigable, there is no upload route, no extraction, no page.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] 103 IS APPLIED AND VERIFIED (103's V1 to V7 returned their expected
--       values). This file references budget_project_categories and
--       budget_lines and raises LG104 inside its transaction if either is
--       absent. APPLY ORDER: 103, THEN 104. 104 DEPENDS ON 103; 103 DOES NOT
--       DEPEND ON 104.
--   [ ] Neither source_documents nor ledger_entries exists, nor either R3
--       function (P2). Enforced below with LG104.
--   [ ] 093 and 087 are applied: the pre-apply test moves partnership status as
--       the table owner and must not trip a guard it does not expect.
--   [ ] P3 shows EXACTLY the five partnership statuses this file was written
--       against. The vendor policy is an ALLOW-list; a sixth status would be
--       denied by default, which is safe, but someone must decide it.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO
--       APPLY 104.". Any INCONCLUSIVE is work to do. In particular a NO
--       SUBJECT on clause (i) is NOT a pass. The test is ALSO the parse check.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- =====================================================================
-- RULINGS 2026-10-09 (owner), AND WHERE EACH LIVES IN THIS FILE
-- =====================================================================
--
--  R1 DELETE vs ARCHIVE. 103 carries the line rule. Here: the composite
--     foreign key ledger_entries -> budget_lines is NO ACTION, so a line with
--     any ledger entry (voided or not) cannot be deleted (23503) whatever its
--     estimate.
--  R2 DUPLICATES. LEDGER ENTRIES ARE NEVER DELETED: no DELETE policy and, since
--     R7, no DELETE grant to authenticated (a DELETE is refused with 42501 for
--     agency and vendor alike). A duplicate is VOIDED instead:
--       voided_at    timestamptz  NULL = counts toward Actual
--       void_reason  text
--       duplicate_of uuid         the entry this one duplicates, in the SAME
--                                 project: composite FK (project_id,
--                                 duplicate_of) -> ledger_entries (project_id,
--                                 id), the table's existing composite pattern.
--     CHECKs: duplicate_of requires voided_at; duplicate_of <> id. A voided entry
--     stays readable to everyone who could read it before (the SELECT policies
--     do not look at voided_at). ACTUAL EXCLUDES VOIDED ENTRIES: Actual for a
--     line = sum(amount) of its entries WHERE voided_at IS NULL. Nothing stores
--     Actual (R5); every reader derives it with that filter.
--  R3 ARCHIVE hides and keeps every file; reversible; changes no one's access.
--     source_documents.archived_at is kept. budget_archive_project_documents and
--     budget_unarchive_project_documents set or clear archived_at on every
--     document of one project and return the number of rows changed. SECURITY
--     INVOKER, search_path pinned, 42501 unless the caller is a member of the
--     organization that owns the project (so a vendor call changes nothing).
--     They touch ONLY archived_at and never storage. EXECUTE revoked from
--     PUBLIC and anon, granted to authenticated. The vendor read policy does NOT
--     consider archived_at: archiving changes no vendor's read.
--  R4 VENDOR DOCUMENT ACCESS. The partnerships status domain is exactly
--     ('pending', 'active', 'suspended', 'terminated', 'removed')
--     (partnerships_status_check, migration 063:33-34; transitions in 102).
--     'pending' is an invitation not yet accepted (102: pending -> active is
--     ACCEPT, pending -> terminated is DECLINE). THE ACCEPTED-RELATIONSHIP
--     ALLOW-LIST IS ('active', 'suspended'):
--       active      accepted and live                       -> access
--       suspended   accepted, paused by the agency           -> access (kept)
--       pending     invitation not accepted                  -> NO agency
--                   documents, and CANNOT upload
--       terminated  ended (or declined)                      -> revoked
--       removed     ended by the agency (093)                -> revoked, exactly
--                                                              like terminated
--     The vendor SELECT policy's toggle branch requires ps.status IN the allow
--     list. There is NO vendor INSERT or UPDATE policy on either table (a vendor
--     session cannot write here at all); vendor-provided rows are written by
--     trusted server code, and source_documents_guard() now enforces the same
--     allow-list on THAT path: a uploader_side = 'vendor' row can be inserted
--     only while its partnership is active or suspended (42501 otherwise). THE
--     AUTHORSHIP EXCEPTION IS KEPT: a vendor can always read a document its own
--     side uploaded, whatever the status and the toggle.
--  R5 FOUR STATES. Estimate is stored (103). ACTUAL is derived from the
--     non-voided entries here. COMMITTED and PAID are DEFERRED to later
--     migrations; this file adds no column for either.
--  R7 GRANTS. source_documents and ledger_entries: REVOKE ALL FROM PUBLIC, anon,
--     authenticated by name; GRANT SELECT, INSERT, UPDATE to authenticated;
--     GRANT ALL to service_role. authenticated holds no DELETE, TRUNCATE,
--     REFERENCES or TRIGGER. This file creates NO SECURITY DEFINER function;
--     every function it creates pins search_path.
--
-- UNCHANGED BY THE RULINGS, AND STILL TRUE HERE:
--   * every agency colleague reads every receipt (the org policies key on the
--     organization only);
--   * vendors read no ledger entry, ever (no vendor policy on ledger_entries);
--   * the per-document toggle (visible_to_vendor, default false);
--   * original_category_id is set on insert and frozen;
--   * nothing keys on project status.
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
--               AND ps.status IN ('active', 'suspended'))                      -- (iii)
--         )
--     )
--   )
--
--   (i)  THE ROW MUST BELONG TO A PARTNERSHIP THE CALLER IS THE VENDOR SIDE OF.
--        This is the foundation and it cannot be omitted. WITHOUT IT, A
--        TOGGLE-ON DOCUMENT IS READABLE BY EVERY VENDOR ON THE PLATFORM, not
--        just the counterparty on that engagement. It uses
--        current_user_org_ids(), the caller's OWN organizations (an AUTHORITY
--        set), never current_user_counterparty_org_ids() or
--        current_user_visible_profile_ids() (VISIBILITY sets, which 087
--        forbids for exactly this). It is checked against ps.vendor_org_id
--        explicitly and does not lean on partnerships' own row level security,
--        which is OR-ed across the lead and vendor sides.
--   (ii) AND the document was uploaded by that vendor: uploader_side = 'vendor'.
--        This overrides the toggle AND the status, so it survives termination
--        and removal (R4's authorship exception).
--   (iii) OR the toggle is on AND the relationship is an ACCEPTED one: R4's
--        allow-list. A deny-list ("NOT IN ended") admitted 'pending', which R4
--        forbids, and would admit any status added later; the allow-list
--        denies both.
--   archived_at appears NOWHERE in the policy (R3).
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
-- IMMUTABLE PROVENANCE, AND WHY. The authorship exception is a promise that the
-- vendor can ALWAYS see what it provided. If the lead agency could UPDATE
-- uploader_side from 'vendor' to 'agency', or move the row to another
-- partnership, it would be a promise the agency could revoke with one
-- statement. So source_documents_guard() refuses to change project_id or
-- uploader_side after insert, and refuses to change partnership_id once it is
-- set (NULL -> value is allowed: that is how an agency receipt is SHARED with
-- one vendor). It also refuses a partnership that does not belong to the
-- organization that owns the project, so an agency cannot push its documents at
-- a stranger's vendor. The agency INSERT policy admits uploader_side = 'agency'
-- ONLY; an agency member cannot mint a 'vendor' row.
--
-- =====================================================================
-- NO VENDOR POLICY ON ledger_entries, AND THE DISTINCTION
-- =====================================================================
--
-- A ledger entry is the AGENCY'S ACTUAL SPEND. An entry extracted from a
-- vendor's own invoice is the agency's record of what it spent, not the
-- vendor's record of what it billed. The vendor's record is the invoice, and the
-- invoice is a source_document the vendor can always read. The entry carries the
-- agency's categorization, its reasoning, its budget line, its amount as the
-- agency booked it, and (R2) whether the agency voided it as a duplicate, all of
-- which the vendor trust boundary (spec 2e) keeps from the vendor exactly as it
-- keeps the master budget.
--
-- =====================================================================
-- EQUAL-OR-NARROWER
-- =====================================================================
--
-- BASELINE = production before this file: neither table exists, so every
-- principal reaches zero rows. After: an agency member reaches their own
-- organization's rows; a vendor reaches ONLY (documents it uploaded for its own
-- partnerships) plus (toggle-on documents of its own active or suspended
-- partnerships); anon and everyone else reach zero. No existing table gains a
-- policy. The one ALTER on an existing table adds a UNIQUE constraint on a 103
-- table; it changes no access. The pre-apply test asserts the fingerprint of
-- every pre-existing policy is identical before and after.
--
-- =====================================================================
-- WHAT THIS DOES NOT DO (each is an owed ruling, not an omission)
-- =====================================================================
--   * An ingestion state on the document (spec 5e). Values not ruled; ingestion
--     is migration 113 or later.
--   * A content hash for convergent re-ingest (5e). Mechanism not ruled.
--   * A review state, a currency, an uploader user, a retention period. None is
--     ruled. (A suspected-duplicate FLAG is not built; R2's void is.)
--   * Whether a void may be undone, or whether duplicate_of may point at a
--     voided entry. Not ruled; nothing refuses either.
--   * Which agency member may flip the toggle or void an entry. Not ruled:
--     every member can.
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Confirm 103 is applied (P1). Run P2 to P4. Record the answers.
--   2. Paste supabase/migrations/104_preapply_test.sql and run it ONCE. First
--      line must read "SAFE TO APPLY 104.". Read the whole report, above all
--      clause (i), the pending, termination and removal rows.
--   3. DRY RUN: replace the final COMMIT; (line numbers at the foot of this
--      header) with ROLLBACK; and run. Prove it rolled back: P2 must still
--      return zero rows.
--   4. Restore COMMIT; and run for real.
--   5. Run V1 to V8. They must return EXACTLY the EXPECTED values.
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
-- P2. NEITHER OF THIS FILE'S TABLES EXISTS, NOR EITHER FUNCTION.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN ('source_documents', 'ledger_entries');
--   SELECT to_regprocedure('public.budget_archive_project_documents(uuid)'),
--          to_regprocedure('public.budget_unarchive_project_documents(uuid)');
--
--   EXPECTED: zero rows; then NULL, NULL.
--
-- P3. THE PARTNERSHIP STATUS DOMAIN THE VENDOR POLICY KEYS ON.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.partnerships'::regclass AND conname = 'partnerships_status_check';
--
--   EXPECTED: exactly the five values pending, active, suspended, terminated,
--   removed. If a sixth exists, STOP: the allow-list denies it by default and
--   someone must decide whether that is right.
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
-- V4. THE VENDOR POLICY CARRIES ALL THREE PARTS AND THE ALLOW-LIST.
--
--   SELECT qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'source_documents' AND policyname = 'source_documents_vendor_select';
--
--   EXPECTED: the text contains partnership_id, vendor_org_id, current_user_org_ids,
--   uploader_side, visible_to_vendor, 'active' and 'suspended'. It must NOT contain
--   'pending', 'terminated', 'removed' or archived_at.
--
-- V5. NO PRE-EXISTING POLICY MOVED. Re-run P4.
--
--   EXPECTED: n_policies = (P4 figure) + 7, and the fingerprint computed with
--   `AND tablename NOT IN ('source_documents', 'ledger_entries')` appended equals
--   the P4 fingerprint exactly.
--
-- V6. THE GRANT MATRIX (R7); NO FOREIGN KEY CASCADES.
--
--   SELECT t, p.priv,
--          has_table_privilege('anon', 'public.' || t, p.priv)          AS anon,
--          has_table_privilege('authenticated', 'public.' || t, p.priv) AS auth,
--          has_table_privilege('service_role', 'public.' || t, p.priv)  AS svc
--   FROM unnest(ARRAY['source_documents', 'ledger_entries']) AS t,
--        unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
--   ORDER BY 1, 2;
--   -- EXPECTED: anon false on all 14; svc true on all 14; auth true for SELECT,
--   -- INSERT, UPDATE and false for DELETE, TRUNCATE, REFERENCES, TRIGGER on both.
--
--   SELECT conrelid::regclass AS tbl, conname, confdeltype FROM pg_constraint
--   WHERE contype = 'f' AND conrelid::regclass::text IN ('source_documents', 'ledger_entries')
--   ORDER BY 1, 2;
--   -- EXPECTED: 8 rows (source_documents 2, ledger_entries 6), confdeltype = 'a' on EVERY row.
--
-- V7. BOTH TRIGGERS, AND NEITHER GUARD FUNCTION IS CALLABLE BY ANYONE.
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
-- V8. R3'S FUNCTIONS: INVOKER, PINNED, authenticated ONLY.
--
--   SELECT p.proname, p.prosecdef, p.proconfig::text,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
--          EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
--                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_x
--   FROM pg_proc p
--   WHERE p.oid IN ('public.budget_archive_project_documents(uuid)'::regprocedure,
--                   'public.budget_unarchive_project_documents(uuid)'::regprocedure);
--   -- EXPECTED: two rows, each false, {"search_path=public, pg_temp"}, false, true, false.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 368 and COMMIT is at line 882.

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

  IF to_regprocedure('public.budget_archive_project_documents(uuid)') IS NOT NULL
     OR to_regprocedure('public.budget_unarchive_project_documents(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '104 refuses to apply: an R3 archive function already exists.'
      USING ERRCODE = 'LG104';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. ONE UNIQUE CONSTRAINT ON A 103 TABLE, so ledger_entries can use a composite
--    foreign key that forces its budget line to be in the same project. No
--    access changes.
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
  'and survives termination and removal, OR the lead agency turned the per-document toggle on and '
  'the partnership is active or suspended: R4). uploader_side, project_id and (once set) '
  'partnership_id are immutable. No DELETE policy and no DELETE grant: nothing is destroyed. The '
  'row is not the file: the bytes live in the private Blob store and whatever serves them must '
  'resolve this row under the caller''s own session first.';

COMMENT ON COLUMN public.source_documents.uploader_side IS
  'Who PROVIDED the document: agency or vendor. A vendor-provided document is written by trusted '
  'server code, never by an agency member (the agency INSERT policy admits only agency) and never '
  'by a vendor session (no vendor INSERT policy), and only while the partnership is active or '
  'suspended (source_documents_guard, R4). Immutable after insert.';

COMMENT ON COLUMN public.source_documents.visible_to_vendor IS
  'The per-document toggle: the lead agency turns it on for THIS document. Default off. It only '
  'has effect together with partnership_id, which says WHICH vendor, and only while that '
  'partnership is active or suspended (R4). It does not affect a document the vendor itself provided.';

COMMENT ON COLUMN public.source_documents.archived_at IS
  'The archive STATE (R3, 2026-10-09). NULL means not archived. Archiving HIDES a document from '
  'the default agency view and KEEPS it and its file; it is reversible and changes no one''s '
  'access (the vendor policy does not read this column). Set per project by '
  'budget_archive_project_documents / budget_unarchive_project_documents.';

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
--
-- R2: an entry is never deleted. A duplicate is voided (voided_at), with a
-- reason and the entry it duplicates. UNIQUE (project_id, id) exists so
-- duplicate_of can use the same composite same-project foreign key pattern as
-- every other reference in the budget schema.
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
  voided_at            timestamptz   NULL,
  void_reason          text          NULL,
  duplicate_of         uuid          NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_project_id_id_key
    UNIQUE (project_id, id),
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
    REFERENCES public.budget_lines (project_id, id),
  -- R2. MATCH SIMPLE: a NULL duplicate_of is not checked. Same project only.
  CONSTRAINT ledger_entries_duplicate_of_fkey
    FOREIGN KEY (project_id, duplicate_of)
    REFERENCES public.ledger_entries (project_id, id),
  CONSTRAINT ledger_entries_duplicate_requires_void
    CHECK (duplicate_of IS NULL OR voided_at IS NOT NULL),
  CONSTRAINT ledger_entries_duplicate_not_self
    CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);

COMMENT ON TABLE public.ledger_entries IS
  'The agency''s ACTUAL SPEND: one row per receipt or invoice line, extracted from a source_document '
  '(one document, many entries). Signed: a credit is negative and reduces the actual on its line. '
  'Agency-only. NO vendor policy exists or may be added. Every colleague in the organization may '
  'read every entry, voided or not. NEVER DELETED (R2): no DELETE policy and no DELETE grant. A '
  'duplicate is voided (voided_at, void_reason, duplicate_of). ACTUAL = sum(amount) WHERE '
  'voided_at IS NULL; nothing stores it (R5).';

COMMENT ON COLUMN public.ledger_entries.original_category_id IS
  'The category this entry was FIRST filed under. Set from category_id on insert by '
  'ledger_entries_guard() and immutable afterwards. When two categories are merged '
  '(budget_category_merges) category_id moves and this does not, so last month''s export and this '
  'month''s can be reconciled (ruling 2f).';

COMMENT ON COLUMN public.ledger_entries.amount IS
  'SIGNED (ruling 5d). Positive spends, negative credits. numeric(14,2). No currency is recorded.';

COMMENT ON COLUMN public.ledger_entries.budget_line_id IS
  'The budget line this entry counts against ("the actual on its line"). NULL until reconciled. '
  'A line with any entry, voided or not, cannot be deleted (R1; NO ACTION foreign key).';

COMMENT ON COLUMN public.ledger_entries.payee_name IS
  'Who was paid. The spec''s "vendor" in "vendor plus date plus amount" (finding 4), named payee_name '
  'here so it is not read as a partner vendor. Nullable: extraction may not read it.';

COMMENT ON COLUMN public.ledger_entries.category_reasoning IS
  'The model''s stated reasoning for the category, stored per entry (finding 3). It cannot be '
  'recovered later without re-running extraction.';

COMMENT ON COLUMN public.ledger_entries.voided_at IS
  'R2 (2026-10-09). NULL = the entry counts toward Actual. Set = voided: kept, still readable by '
  'everyone who could read it, excluded from Actual.';

COMMENT ON COLUMN public.ledger_entries.duplicate_of IS
  'R2. The entry, in the same project, that this voided entry duplicates. Requires voided_at; '
  'never the entry itself.';

CREATE INDEX ledger_entries_document_idx
  ON public.ledger_entries (source_document_id);

CREATE INDEX ledger_entries_project_category_idx
  ON public.ledger_entries (project_id, category_id);

CREATE INDEX ledger_entries_budget_line_idx
  ON public.ledger_entries (budget_line_id)
  WHERE budget_line_id IS NOT NULL;

CREATE INDEX ledger_entries_duplicate_of_idx
  ON public.ledger_entries (duplicate_of)
  WHERE duplicate_of IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4. THE DOCUMENT GUARD. Provenance is immutable, a partnership must belong to
--    the organization that owns the project, and (R4) a vendor-provided
--    document can only be filed while the relationship is an accepted one.
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
  v_status text;
BEGIN
  IF NEW.partnership_id IS NOT NULL THEN
    SELECT ps.lead_org_id, ps.status INTO v_lead_org, v_status FROM public.partnerships ps WHERE ps.id = NEW.partnership_id;
    SELECT pr.org_id INTO v_project_org FROM public.projects pr WHERE pr.id = NEW.project_id;
    IF v_lead_org IS NULL OR v_project_org IS NULL OR v_lead_org <> v_project_org THEN
      RAISE EXCEPTION 'source_documents: partnership % does not belong to the organization that owns project %',
        NEW.partnership_id, NEW.project_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.uploader_side = 'vendor'
     AND v_status IS DISTINCT FROM 'active' AND v_status IS DISTINCT FROM 'suspended' THEN
    RAISE EXCEPTION 'source_documents: a vendor document can only be filed while partnership % is active or suspended (it is %)',
      NEW.partnership_id, coalesce(v_status, 'unknown')
      USING ERRCODE = '42501';
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
-- 6. R3: PROJECT DOCUMENT ARCHIVE AND UNARCHIVE. archived_at ONLY; never storage.
--
-- SECURITY INVOKER: the UPDATE runs under the caller's row level security and
-- through source_documents_guard. The explicit agency check comes first so a
-- caller who is not the project's agency (a vendor, another agency) gets 42501
-- and changes nothing, rather than a silent 0.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.budget_archive_project_documents(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = p_project_id
      AND pr.org_id IN (SELECT public.current_user_org_ids())
  ) THEN
    RAISE EXCEPTION 'budget_archive_project_documents: project % is not visible to the caller as its agency', p_project_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.source_documents
     SET archived_at = now()
   WHERE project_id = p_project_id
     AND archived_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE FUNCTION public.budget_unarchive_project_documents(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = p_project_id
      AND pr.org_id IN (SELECT public.current_user_org_ids())
  ) THEN
    RAISE EXCEPTION 'budget_unarchive_project_documents: project % is not visible to the caller as its agency', p_project_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.source_documents
     SET archived_at = NULL
   WHERE project_id = p_project_id
     AND archived_at IS NOT NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.budget_archive_project_documents(uuid) IS
  'R3 (2026-10-09). Sets archived_at on every not-yet-archived source document of the project and '
  'returns how many. Touches no other column and no file. Reversible with '
  'budget_unarchive_project_documents. Changes no one''s access. 42501 unless the caller is a '
  'member of the organization that owns the project.';

COMMENT ON FUNCTION public.budget_unarchive_project_documents(uuid) IS
  'R3 (2026-10-09). Clears archived_at on every archived source document of the project and '
  'returns how many. 42501 unless the caller is a member of the organization that owns the project.';

REVOKE EXECUTE ON FUNCTION public.budget_archive_project_documents(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.budget_archive_project_documents(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.budget_archive_project_documents(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.budget_unarchive_project_documents(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.budget_unarchive_project_documents(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.budget_unarchive_project_documents(uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- 7. PRIVILEGES (R7). Revoke everything by name, then grant authenticated
--    SELECT, INSERT, UPDATE only. No DELETE: nothing here is destroyed (R2).
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.source_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.source_documents FROM anon;
REVOKE ALL ON TABLE public.source_documents FROM authenticated;
REVOKE ALL ON TABLE public.ledger_entries   FROM PUBLIC;
REVOKE ALL ON TABLE public.ledger_entries   FROM anon;
REVOKE ALL ON TABLE public.ledger_entries   FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_entries   TO authenticated;

GRANT ALL ON TABLE public.source_documents TO service_role;
GRANT ALL ON TABLE public.ledger_entries   TO service_role;


-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY. SEVEN POLICIES. ONE IS FOR A VENDOR.
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
--   (iii) the lead agency turned it on AND the relationship is accepted: active or suspended (R4).
-- archived_at is deliberately absent (R3).
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
              AND ps.status IN ('active', 'suspended'))
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

-- PostgREST must see the tables and functions at commit.
NOTIFY pgrst, 'reload schema';

COMMIT;
