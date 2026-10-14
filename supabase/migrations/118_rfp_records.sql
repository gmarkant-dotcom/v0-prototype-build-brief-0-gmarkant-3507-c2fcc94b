-- =====================================================================
-- 118: THE AGENCY-OWNED RFP RECORD. rfp_records AND rfp_record_lines, THE FIVE LINK COLUMNS, THE
--      PAID-LEAD-AGENCY HELPER, AND THE GUARDS (D5 SNAPSHOT, LINE PARENT, LINK COLUMNS).
--
-- AUTHORED 2026-10-14 on branch feat/rfp-record-a (unattended run). NOT APPLIED. NOT RUN AGAINST
-- POSTGRES. NO SQL PARSER WAS AVAILABLE TO THE AUTHOR: THE OWNER'S PRE-APPLY TEST RUN IN THE SQL
-- EDITOR IS THE PARSE CHECK. DO NOT APPLY WITHOUT A GREEN RUN OF
-- supabase/migrations/118_preapply_test.sql AND GREG'S SAY-SO.
--
-- Design: docs/rfp-source-of-truth-design.md (sections 1, 3, 6). Step A code (feat/rfp-record-a)
-- writes these tables when they exist and skips them when they do not, so the code may deploy on
-- either side of this file.
--
--   CREATE FUNCTION public.current_user_entitled_lead_org_ids()     -> SETOF uuid   (D1, the G1 rule)
--   CREATE TABLE public.rfp_records                                  (agency-only, one row per send)
--   CREATE TABLE public.rfp_record_lines                             (agency-only, one row per scope line)
--   CREATE FUNCTION + TRIGGER rfp_records_guard                      (lead_org_id immutable, D5, updated_at)
--   CREATE FUNCTION + TRIGGER rfp_record_lines_guard                 (lead_org_id from parent, rfp_id pinned, D5)
--   ALTER TABLE partner_rfp_inbox ADD rfp_line_id, client_name_released          (nullable, no backfill)
--   ALTER TABLE rfp_magic_tokens ADD rfp_line_id, attached_inbox_id, client_name_released (nullable)
--   CREATE FUNCTION + TRIGGER partner_rfp_inbox_link_columns_guard   (110's shape, plus the vendor
--                                                                     allow-list, rulings O1/O2)
--   CREATE FUNCTION + TRIGGER rfp_magic_tokens_link_columns_guard    (110's shape)
--   GRANTS: both new tables REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT,
--           UPDATE TO authenticated; GRANT ALL TO service_role. Nothing else.
--   RLS: 3 policies per new table (SELECT, INSERT, UPDATE), TO authenticated. NO DELETE POLICY. NO
--        VENDOR POLICY. NO anon POLICY.
--   NOTIFY pgrst 'reload schema'
--
-- UNCHANGED: every existing policy, every existing grant, every existing trigger and function, every
-- existing row (the five link columns are added NULL with no default and nothing is backfilled;
-- 119 does that). The new columns on partner_rfp_inbox and rfp_magic_tokens are covered by those
-- tables' existing table-level grants and policies; no column grant is added.
--
-- >>> ONE VENDOR-VISIBLE EFFECT, ACCEPTED BY THE OWNER: every vendor read that selects WHOLE inbox
-- >>> rows now also returns rfp_line_id and client_name_released (both NULL until 119 / step C).
-- >>> rfp_line_id is an opaque id into a table no vendor can read. The paths are listed in
-- >>> docs/rfp-record-a-report.md section 5. No vendor path selects whole rfp_magic_tokens rows.
--
-- >>> AND ONE VENDOR-VISIBLE REFUSAL, RULED BY THE OWNER (O1, O2): a vendor UPDATE of
-- >>> partner_rfp_inbox that changes any column outside the allow-list now fails with 42501. Every
-- >>> vendor write the application makes is on the list (header section THE VENDOR ALLOW-LIST).
--
-- THE FULL FILENAME IS 118_rfp_records.sql. Its rollback sibling is 118_rfp_records_down.sql.
-- DO NOT GLOB.
--
-- =====================================================================
-- OWNER RULINGS 2026-10-14 (docs/rfp-source-of-truth-design.md section 6), AND WHERE EACH LIVES
-- =====================================================================
--
--  * D1 PAID GATE AT RLS. Every policy on both new tables reads
--    current_user_entitled_lead_org_ids(), which mirrors G1 in lib/entitlements.ts
--    (resolveAgencyGate, lib/entitlements.ts:556-629, with resolveActingOrgId,
--    lib/acting-org.ts:226-272) exactly - see section 1 below.
--  * D2 PER-LINE RELEASE. rfp_record_lines.released_budget. NULL = hidden. New RFPs default hidden
--    (step A code writes NULL unless the agency releases the line). 119 backfills
--    released_budget = estimated_budget for RFPs already broadcast. Nothing in this file defaults it.
--  * D3 CLIENT HIDDEN BY DEFAULT. rfp_records.show_client_to_vendors boolean NOT NULL DEFAULT false.
--  * D4 ONE RECORD PER BROADCAST SEND. No uniqueness on (lead_org_id, project_id): a project may have
--    many records.
--  * D5 SNAPSHOT AFTER BROADCAST. Once broadcast_at is set, only show_client_to_vendors,
--    response_deadline, close_bidding_at_deadline and archived_at may change (updated_at is the
--    trigger's own). broadcast_at cannot be cleared or changed. Lines of a broadcast record cannot be
--    inserted or updated. Enforced by rfp_records_guard and rfp_record_lines_guard for EVERY caller,
--    the service role included. A new column added to rfp_records later is FROZEN BY DEFAULT: the
--    guard compares whole rows minus an allow-list, not a deny-list.
--  * D6 Lightning (magic-link) and wizard RFPs are separate records (source 'magic_link' / 'wizard').
--  * D7 project_id REFERENCES projects ON DELETE SET NULL. The D5 guard admits exactly that one change
--    after broadcast (project_id to NULL when the project row no longer exists), so deleting a
--    project never fails because it was broadcast. created_by gets the same treatment
--    (ON DELETE SET NULL, see ADJUSTMENTS).
--  * D8 _magic_token is stripped in step C, not here. This file does not touch master_rfp_json.
--  * D9 output_template_config lives on the record (rfp_records.output_template_config).
--
-- =====================================================================
-- THE WRITE ORDER. EVERY WRITER MUST FOLLOW IT: STEP A NOW, THE 119 BACKFILL LATER.
-- =====================================================================
--
--   1. INSERT the rfp_records row WITHOUT broadcast_at.
--   2. INSERT its rfp_record_lines.
--   3. Write the vendor rows that carry rfp_line_id (partner_rfp_inbox, rfp_magic_tokens).
--   4. Set rfp_magic_tokens.attached_inbox_id where an inbox row is attached.
--   5. UPDATE rfp_records SET broadcast_at LAST.
--
-- Step 5 freezes the record (D5). A writer that sets broadcast_at before its lines are in can never
-- add them: rfp_record_lines_guard refuses (LG118). 119 must therefore insert each reconstructed
-- record with broadcast_at NULL, insert its lines, link the inbox rows and tokens, and only then
-- set broadcast_at.
--
-- =====================================================================
-- THE LINK-COLUMN GUARD (110's shape), ON partner_rfp_inbox AND rfp_magic_tokens
-- =====================================================================
--
-- BEFORE INSERT OR UPDATE, FOR EACH ROW, plpgsql, SECURITY INVOKER, search_path pinned, EXECUTE
-- revoked from PUBLIC, anon and authenticated. Three rules here (the inbox guard adds rule (4),
-- the vendor allow-list, in the next header section):
--
--   (1) The link columns (rfp_line_id, client_name_released, and on tokens attached_inbox_id) may be
--       set or changed only by a member of the row's lead organization (partner_rfp_inbox.lead_org_id,
--       rfp_magic_tokens.org_id) or by a trusted path with no end-user session (service role,
--       migrations, the SQL Editor). Anyone else, INCLUDING THE VENDOR WHO OWNS THE INBOX ROW, is
--       refused with 42501 when a link column changes. On UPDATE the caller must be a member of the
--       lead organization BEFORE and AFTER the write, so a vendor cannot first repoint lead_org_id at
--       its own organization and then pass.
--   (2) rfp_line_id must reference a line whose lead_org_id equals the row's lead organization.
--       23514. Checked when rfp_line_id is set or changed, and when the lead organization of a row
--       that already carries one changes (the invariant would otherwise break silently).
--   (3) attached_inbox_id must reference an inbox row of the same lead organization. 23514. Same
--       trigger points as (2).
--
-- The inbox guard carries a fourth rule, the vendor allow-list: see the next header section.
--
-- THE TRUSTED-PATH TEST: auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated').
-- auth.uid() IS NULL is 091's chosen exemption (091:173-205: a service-role JWT carries no sub). The
-- current_user term is added because this function is SECURITY INVOKER, so current_user is the
-- calling role and is meaningful here (091 rejected it only for a SECURITY DEFINER body): it stops
-- an anon caller, who also has no uid, from counting as trusted. A foreign-key action (the
-- attached_inbox_id ON DELETE SET NULL below) runs as the table owner and is trusted.
--
-- (2) and (3) read rfp_record_lines / partner_rfp_inbox under the CALLER's row level security. For
-- the service role that is the whole table; for an agency member it is its own organization's rows;
-- a row the caller cannot see is refused exactly like a row of another organization.
--
-- =====================================================================
-- THE VENDOR ALLOW-LIST ON partner_rfp_inbox (OWNER RULINGS O1 AND O2, 2026-10-14). CLOSES F1.
-- =====================================================================
--
-- F1 (found 2026-10-14, docs/rfp-record-a-report.md sections 6 and 8): the 099 vendor UPDATE policy
-- constrains vendor_org_id (clause B) and status (clause C) and nothing else, so a vendor could
-- rewrite its own row's lead_org_id, master_rfp_json (the rubric included), estimated_budget,
-- project_id, scope_item_id and every other column through raw PostgREST. The owner found no sign
-- of exploitation across the 97 inbox rows on 2026-10-14.
--
-- Rule (4) of partner_rfp_inbox_link_columns_guard, on UPDATE only. It applies when the caller is
-- NOT on the trusted path (the same test as rule (1)) AND is NOT a member of the row's lead
-- organization both BEFORE and AFTER the write (the same current_user_org_ids() test as rule (1)).
-- For that caller it compares to_jsonb(OLD) and to_jsonb(NEW) minus the allow-list; any remaining
-- difference raises 42501 naming the first offending column (alphabetical). DENY BY DEFAULT: a
-- column added to partner_rfp_inbox later is refused for vendors without touching this guard.
--
--   O1 ALWAYS ALLOWED: status, updated_at, viewed_at, partner_intent, intent_set_at,
--      agency_nda_notified_at. (status stays under 099 clause C: only 'bid_submitted', never out
--      of 'closed' or 'not_selected'.)
--   O2 THE CLAIM, ALSO ALLOWED, ONLY WHEN ALL HOLD: OLD.vendor_org_id IS NULL (unclaimed),
--      NEW.vendor_org_id IN current_user_org_ids() (099 clause B's test), and NEW.claimed_at is
--      non-NULL and differs from OLD.claimed_at (set in the same update). Then vendor_org_id and
--      claimed_at may change too. Once vendor_org_id is set a vendor can never change vendor_org_id
--      or claimed_at again: this closes the gap 099:783-790 names (moving a claimed row between
--      two of the caller's organizations).
--
-- The vendor-session writers this admits (docs/rfp-record-a-report.md section 8a):
--   app/api/partner/rfps/[id]/route.ts:71-78               viewed_at
--   app/api/partner/rfps/[id]/intent/route.ts:92-99        partner_intent, intent_set_at
--   app/api/partner/rfps/[id]/nda-notify/route.ts:115-118  agency_nda_notified_at, updated_at
--   app/api/partner/rfps/[id]/response/route.ts:380-383    status 'bid_submitted', updated_at
--   app/api/partner/rfps/claim/route.ts:76-84              vendor_org_id, claimed_at, updated_at (O2)
-- The 099 policy text is not touched: its clauses still apply on top of this rule, and so do
-- rules (1) and (2). The lead agency's own updates and the service role are not affected.
--
-- =====================================================================
-- ADJUSTMENTS TO THE DESIGN SKETCH (docs/rfp-source-of-truth-design.md section 1), STATED
-- =====================================================================
--
--   * rfp_magic_tokens.attached_inbox_id REFERENCES partner_rfp_inbox(id) ON DELETE SET NULL (the
--     sketch gave no ON DELETE). lib/magic-token-attach.ts collapses duplicate invitation rows by
--     DELETING the losers (magic-token-attach.ts:195); a NO ACTION key pointing at a loser would make
--     that delete fail on every load, forever.
--   * rfp_records.created_by REFERENCES auth.users(id) ON DELETE SET NULL (the sketch gave none). A
--     NO ACTION key would block deleting the account that sent an RFP. Admitted by the D5 guard the
--     same way as project_id.
--   * No type changes. Every column type in the sketch matches what it mirrors:
--     scope_item_key text (partner_rfp_inbox.scope_item_id is text NOT NULL, scripts/013:11);
--     estimated_budget and released_budget text (partner_rfp_inbox.estimated_budget is text,
--     scripts/013:14); lead_org_id uuid (organizations.id, 079); partner_rfp_inbox.id uuid
--     (scripts/013:5). rfp_magic_tokens has no CREATE TABLE in the repository; the link columns
--     depend only on its org_id, which 079 renamed and made NOT NULL (079:658, :982) and which its
--     policy compares to current_user_org_ids() (uuid).
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] 117 is applied (2026-10-14). 118 does not depend on it; the numbering does.
--   [ ] P1 to P3 below answer EXPECTED. The transaction ENFORCES P1 and P2 (LG118).
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 118." It is also the parse check.
--       Its INCONCLUSIVE-BY-DESIGN rows (U1, U2, X1, X2: no unpaid or second lead agency exists;
--       C3: no user outside the lead organization belongs to two organizations) are expected and
--       named in its headline. C3 runs and is judged normally if such a user exists.
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 still answers zero rows).
--   [ ] The step A code (feat/rfp-record-a) is deployed, or main is deployed: main never names the
--       new tables or columns, and the step A code skips them on 42P01 / PGRST205 / 42703 / PGRST204.
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 to P3. Record the answers. STOP on any mismatch with EXPECTED.
--   2. Paste supabase/migrations/118_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 118.". Anything else: do not continue.
--   3. DRY RUN: replace the final COMMIT; (line number at the foot of this header) with ROLLBACK;
--      and run the file. Prove it rolled back: P2 must still return zero rows.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V7. They must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record. Next free: 119.
--   Rollback: supabase/migrations/118_rfp_records_down.sql (read its header: forcing it loses every
--   record and every link).
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY.
-- =====================================================================
--
-- P1. WHAT 118 DEPENDS ON.
--
--   SELECT to_regclass('public.partner_rfp_inbox'), to_regclass('public.rfp_magic_tokens'),
--          to_regclass('public.organizations'), to_regclass('public.org_members'),
--          to_regclass('public.projects'), to_regprocedure('public.current_user_org_ids()');
--
--   EXPECTED: all six non-null.
--
-- P2. NOTHING OF 118 EXISTS YET.
--
--   SELECT to_regclass('public.rfp_records'), to_regclass('public.rfp_record_lines'),
--          to_regprocedure('public.current_user_entitled_lead_org_ids()');
--   SELECT c.relname, a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
--   WHERE c.relname IN ('partner_rfp_inbox', 'rfp_magic_tokens') AND c.relnamespace = 'public'::regnamespace
--     AND a.attname IN ('rfp_line_id', 'client_name_released', 'attached_inbox_id') AND NOT a.attisdropped;
--
--   EXPECTED: null, null, null; zero rows.
--
-- P3. THE TRIGGERS ALREADY ON THE TWO LINKED TABLES (recorded, compared in V5).
--
--   SELECT c.relname, t.tgname, t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE c.relname IN ('partner_rfp_inbox', 'rfp_magic_tokens') AND c.relnamespace = 'public'::regnamespace
--     AND NOT t.tgisinternal ORDER BY 1, 2;
--
--   EXPECTED: no migration in the repository creates one; write down whatever the live answer is.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE TABLES, RLS ON, EMPTY.
--
--   SELECT c.relname, c.relrowsecurity FROM pg_class c
--   WHERE c.oid IN ('public.rfp_records'::regclass, 'public.rfp_record_lines'::regclass) ORDER BY 1;
--   SELECT (SELECT count(*) FROM public.rfp_records), (SELECT count(*) FROM public.rfp_record_lines);
--
--   EXPECTED: rfp_record_lines t; rfp_records t. 0, 0.
--
-- V2. THE POLICIES. SIX, ALL TO authenticated, NONE FOR DELETE.
--
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('rfp_records', 'rfp_record_lines') ORDER BY 1, 2;
--
--   EXPECTED: rfp_record_lines_entitled_insert INSERT, _select SELECT, _update UPDATE;
--             rfp_records_entitled_insert INSERT, _select SELECT, _update UPDATE; roles {authenticated}.
--             And the public total is 155 + 6 = 161.
--
-- V3. THE GRANTS.
--
--   SELECT t, r, has_table_privilege(r, t, 'SELECT') s, has_table_privilege(r, t, 'INSERT') i,
--          has_table_privilege(r, t, 'UPDATE') u, has_table_privilege(r, t, 'DELETE') d,
--          has_table_privilege(r, t, 'TRUNCATE') tr, has_table_privilege(r, t, 'REFERENCES') rf,
--          has_table_privilege(r, t, 'TRIGGER') tg
--   FROM unnest(ARRAY['public.rfp_records', 'public.rfp_record_lines']) t,
--        unnest(ARRAY['anon', 'authenticated', 'service_role']) r ORDER BY 1, 2;
--
--   EXPECTED: anon all f; authenticated t t t f f f f; service_role all t.
--
-- V4. THE HELPER.
--
--   SELECT p.prosecdef, p.provolatile::text, p.proconfig,
--          has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
--   FROM pg_proc p WHERE p.oid = 'public.current_user_entitled_lead_org_ids()'::regprocedure;
--
--   EXPECTED: t, s, {"search_path=public, pg_temp"}, f, t.
--
-- V5. THE FOUR NEW TRIGGERS, AND NOTHING ELSE MOVED.
--
--   SELECT c.relname, t.tgname, t.tgenabled::text, (t.tgtype & 2) = 2 before_event,
--          (t.tgtype & 4) = 4 on_insert, (t.tgtype & 16) = 16 on_update
--   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE c.relname IN ('rfp_records', 'rfp_record_lines', 'partner_rfp_inbox', 'rfp_magic_tokens')
--     AND c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal ORDER BY 1, 2;
--
--   EXPECTED: P3's rows unchanged, plus partner_rfp_inbox_link_columns_guard,
--   rfp_magic_tokens_link_columns_guard, rfp_record_lines_guard, rfp_records_guard, each O t t t.
--
-- V6. THE LINK COLUMNS, NULLABLE, EMPTY.
--
--   SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
--   FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
--   WHERE c.relname IN ('partner_rfp_inbox', 'rfp_magic_tokens') AND c.relnamespace = 'public'::regnamespace
--     AND a.attname IN ('rfp_line_id', 'client_name_released', 'attached_inbox_id') AND NOT a.attisdropped
--   ORDER BY 1, 2;
--   SELECT (SELECT count(*) FROM public.partner_rfp_inbox WHERE rfp_line_id IS NOT NULL OR client_name_released IS NOT NULL),
--          (SELECT count(*) FROM public.rfp_magic_tokens WHERE rfp_line_id IS NOT NULL OR attached_inbox_id IS NOT NULL
--                                                           OR client_name_released IS NOT NULL);
--
--   EXPECTED: partner_rfp_inbox client_name_released text f; partner_rfp_inbox rfp_line_id uuid f;
--   rfp_magic_tokens attached_inbox_id uuid f; rfp_magic_tokens client_name_released text f;
--   rfp_magic_tokens rfp_line_id uuid f. 0, 0 immediately after the apply.
--
-- V7. THE FOREIGN-KEY ACTIONS.
--
--   SELECT conrelid::regclass::text, conname, confdeltype::text FROM pg_constraint
--   WHERE contype = 'f' AND conrelid IN ('public.rfp_records'::regclass, 'public.rfp_record_lines'::regclass,
--                                       'public.partner_rfp_inbox'::regclass, 'public.rfp_magic_tokens'::regclass)
--     AND confrelid IN ('public.projects'::regclass, 'public.rfp_records'::regclass, 'public.rfp_record_lines'::regclass,
--                       'public.partner_rfp_inbox'::regclass, 'auth.users'::regclass)
--   ORDER BY 1, 2;
--
--   EXPECTED (among any pre-existing keys on the two old tables): rfp_records project_id 'n',
--   created_by 'n'; rfp_record_lines rfp_id 'c'; partner_rfp_inbox rfp_line_id 'a';
--   rfp_magic_tokens rfp_line_id 'a', attached_inbox_id 'n'.
--
-- BEGIN, COMMIT and body-marker line numbers of the transaction below (BODY START 321, BODY END 923):
-- BEGIN is at line 320 and COMMIT is at line 924.

BEGIN;
-- >>> 118 BODY START
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.partner_rfp_inbox') IS NULL OR to_regclass('public.rfp_magic_tokens') IS NULL
     OR to_regclass('public.organizations') IS NULL OR to_regclass('public.org_members') IS NULL
     OR to_regclass('public.projects') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION '118 refuses to apply: one of partner_rfp_inbox, rfp_magic_tokens, organizations, org_members, projects, profiles does not exist.'
      USING ERRCODE = 'LG118';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '118 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG118';
  END IF;

  -- The columns the helper and the guards read. 079 (lead_org_id, org_id, is_lead_agency),
  -- 090 (active_org_id), 092 (is_paid).
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'organizations'     AND column_name IN ('is_lead_agency', 'is_paid'))
           OR (table_name = 'profiles'          AND column_name = 'active_org_id')
           OR (table_name = 'org_members'       AND column_name IN ('org_id', 'user_id'))
           OR (table_name = 'partner_rfp_inbox' AND column_name = 'lead_org_id')
           OR (table_name = 'rfp_magic_tokens'  AND column_name = 'org_id')
           OR (table_name = 'projects'          AND column_name = 'org_id'))) <> 8 THEN
    RAISE EXCEPTION '118 refuses to apply: a column it reads is missing (organizations.is_lead_agency/is_paid, profiles.active_org_id, org_members.org_id/user_id, partner_rfp_inbox.lead_org_id, rfp_magic_tokens.org_id, projects.org_id).'
      USING ERRCODE = 'LG118';
  END IF;

  IF to_regclass('public.rfp_records') IS NOT NULL OR to_regclass('public.rfp_record_lines') IS NOT NULL
     OR to_regprocedure('public.current_user_entitled_lead_org_ids()') IS NOT NULL THEN
    RAISE EXCEPTION '118 refuses to apply: rfp_records, rfp_record_lines or current_user_entitled_lead_org_ids() already exists. Read the schema before going further.'
      USING ERRCODE = 'LG118';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid IN ('public.partner_rfp_inbox'::regclass, 'public.rfp_magic_tokens'::regclass)
               AND a.attname IN ('rfp_line_id', 'client_name_released', 'attached_inbox_id')
               AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '118 refuses to apply: a link column already exists on partner_rfp_inbox or rfp_magic_tokens. A drifted column must not be skipped silently.'
      USING ERRCODE = 'LG118';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE HELPER. D1: the G1 rule, at the database.
--
-- MIRRORS lib/entitlements.ts resolveAgencyGate() (:556-629) EXACTLY, step by step:
--   a. The ACTING organization, as lib/acting-org.ts resolveActingOrgId() (:226-272) resolves it:
--      the caller's memberships from org_members (loadMemberOrgIds, :161-178); exactly one
--      membership -> that one (:243-245); more than one -> profiles.active_org_id, used ONLY if it
--      names one of those memberships (:247-271); no preference, or a preference outside the set ->
--      nothing (fails closed). No membership -> nothing.
--   b. That organization must have is_lead_agency = true (:613) AND is_paid = true (:619). A NULL
--      flag is not a grant (`IS TRUE`, the SQL form of `=== true`).
--   NOT MIRRORED, BY NECESSITY: isDemoDeployment() (NEXT_PUBLIC_IS_DEMO, :557) is an environment
--   variable the database cannot see. On a demo deployment the routes admit everyone and these
--   policies admit only entitled lead agencies, so a demo caller who is not one gets an empty
--   record set and the step A writes fail closed. The demo deployment is not production.
--
-- Returns zero or one row. SECURITY DEFINER because policies call it and org_members / profiles /
-- organizations carry their own RLS (the 079 PHASE 3 reason). STABLE, no parameters, reads
-- auth.uid() only, so no caller can ask about anybody but themselves.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.current_user_entitled_lead_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH memberships AS (
    SELECT m.org_id
    FROM public.org_members m
    WHERE m.user_id = auth.uid()
  ),
  acting AS (
    SELECT ms.org_id
    FROM memberships ms
    WHERE (SELECT count(*) FROM memberships) = 1
    UNION
    SELECT ms.org_id
    FROM memberships ms
    JOIN public.profiles p ON p.id = auth.uid() AND p.active_org_id = ms.org_id
    WHERE (SELECT count(*) FROM memberships) > 1
  )
  SELECT o.id
  FROM public.organizations o
  JOIN acting a ON a.org_id = o.id
  WHERE o.is_lead_agency IS TRUE
    AND o.is_paid IS TRUE;
$$;

COMMENT ON FUNCTION public.current_user_entitled_lead_org_ids() IS
  'Migration 118 (ruling D1). The caller''s ACTIVE organization when it is a paid lead agency: the G1 '
  'rule of lib/entitlements.ts resolveAgencyGate() at the database. Acting organization = the sole '
  'membership, or profiles.active_org_id when it names one of several; then is_lead_agency AND is_paid. '
  'Zero or one row. The demo-deployment bypass is not mirrored (an environment variable). Change this '
  'and resolveAgencyGate() together or not at all.';

REVOKE EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() TO authenticated;


-- ---------------------------------------------------------------------
-- 2. THE TABLES. Design section 1, with the two ON DELETE adjustments named in the header.
-- ---------------------------------------------------------------------
CREATE TABLE public.rfp_records (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_org_id                uuid        NOT NULL REFERENCES public.organizations (id),
  project_id                 uuid        REFERENCES public.projects (id) ON DELETE SET NULL,
  source                     text        NOT NULL CHECK (source IN ('wizard', 'magic_link', 'backfill')),
  master_rfp                 jsonb       NOT NULL,
  evaluation_criteria        jsonb,
  budget_categories          jsonb,
  business_criteria_required jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_template_config     jsonb,
  total_budget               text,
  show_client_to_vendors     boolean     NOT NULL DEFAULT false,
  client_name_snapshot       text,
  response_deadline          timestamptz,
  close_bidding_at_deadline  boolean     NOT NULL DEFAULT false,
  require_terms_disclosure   boolean     NOT NULL DEFAULT true,
  nda_link                   text,
  broadcast_at               timestamptz,
  archived_at                timestamptz,
  created_by                 uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  backfill_note              text
);

CREATE INDEX rfp_records_lead_org_id_idx ON public.rfp_records (lead_org_id);
CREATE INDEX rfp_records_project_id_idx  ON public.rfp_records (project_id);

COMMENT ON TABLE public.rfp_records IS
  'Migration 118. The agency''s own record of an RFP, one row per broadcast send (D4): the master as '
  'broadcast, the rubric, budget categories, requirements, output template (D9), and the per-RFP '
  'client toggle (D3, default hidden). AGENCY-ONLY: no vendor policy, no anon policy, no DELETE policy '
  '(archive, never delete). RLS admits members of a PAID LEAD AGENCY only (D1). A SNAPSHOT once '
  'broadcast_at is set (D5, rfp_records_guard). Write order: record, lines, vendor rows, broadcast_at LAST.';

COMMENT ON COLUMN public.rfp_records.show_client_to_vendors IS
  'Ruling D3: default false. Vendors cannot read this table; the decision reaches them through '
  'partner_rfp_inbox.client_name_released and rfp_magic_tokens.client_name_released (step B/C).';

COMMENT ON COLUMN public.rfp_records.broadcast_at IS
  'Set LAST, once every send succeeded. NULL = an unsent draft. Once set it cannot be cleared or '
  'changed, and only show_client_to_vendors, response_deadline, close_bidding_at_deadline and '
  'archived_at may change (D5).';

CREATE TABLE public.rfp_record_lines (
  id                     uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id                 uuid    NOT NULL REFERENCES public.rfp_records (id) ON DELETE CASCADE,
  lead_org_id            uuid    NOT NULL,
  scope_item_key         text    NOT NULL,
  scope_item_name        text    NOT NULL,
  scope_item_description text,
  estimated_budget       text,
  released_budget        text,
  sort_order             integer NOT NULL DEFAULT 0,
  UNIQUE (rfp_id, scope_item_key)
);

CREATE INDEX rfp_record_lines_lead_org_id_idx ON public.rfp_record_lines (lead_org_id);

COMMENT ON TABLE public.rfp_record_lines IS
  'Migration 118. One row per scope line of an rfp_records row. lead_org_id is copied from the parent '
  'by rfp_record_lines_guard, never taken from the caller. rfp_id cannot change. No insert or update '
  'once the parent''s broadcast_at is set (D5). AGENCY-ONLY, paid lead agency only (D1).';

COMMENT ON COLUMN public.rfp_record_lines.released_budget IS
  'Ruling D2: what this line''s vendors may see. NULL = hidden, the default for new RFPs. The 119 '
  'backfill sets it to estimated_budget for RFPs already broadcast, so bids in progress keep their number.';


-- ---------------------------------------------------------------------
-- 3. rfp_records_guard. lead_org_id immutable; D5 snapshot; updated_at maintained.
--
-- SECURITY DEFINER FOR ONE REASON: the D7 exception must know whether the referenced project (and
-- for created_by, the auth user) still EXISTS, and an invoker-rights read would answer "no" for a
-- row the caller merely cannot see. It reads existence by primary key and nothing else, writes
-- nothing but NEW, and EXECUTE is revoked from everyone. It RAISES, never silently reverts.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The D5 allow-list. Everything else is frozen once broadcast_at is set, including any column
  -- added to this table later.
  v_skip    text[] := ARRAY['show_client_to_vendors', 'response_deadline', 'close_bidding_at_deadline',
                            'archived_at', 'updated_at'];
  v_changed text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION 'An RFP record cannot move to another organization.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_records.lead_org_id is immutable after insert (migration 118).';
  END IF;

  IF OLD.broadcast_at IS NOT NULL THEN
    IF NEW.broadcast_at IS DISTINCT FROM OLD.broadcast_at THEN
      RAISE EXCEPTION 'This RFP has been sent. Its send time cannot be cleared or changed.'
        USING ERRCODE = 'LG118',
              DETAIL  = 'rfp_records.broadcast_at is fixed once set (migration 118, ruling D5).';
    END IF;

    -- D7: the foreign key's own ON DELETE SET NULL, and nothing that merely resembles it.
    IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
      v_skip := array_append(v_skip, 'project_id');
    END IF;
    IF OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.created_by) THEN
      v_skip := array_append(v_skip, 'created_by');
    END IF;

    SELECT string_agg(o.key, ', ' ORDER BY o.key)
      INTO v_changed
      FROM jsonb_each(to_jsonb(OLD) - v_skip) o
      LEFT JOIN jsonb_each(to_jsonb(NEW) - v_skip) n ON n.key = o.key
     WHERE n.value IS DISTINCT FROM o.value;

    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'This RFP has been sent and is a snapshot. Only the client toggle, the response deadline, closing at the deadline and archiving can change.'
        USING ERRCODE = 'LG118',
              DETAIL  = format('rfp_records columns frozen after broadcast_at (migration 118, ruling D5): %s', v_changed);
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_records_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_records, every caller including the service role: '
  'lead_org_id immutable; once broadcast_at is set it cannot change and only show_client_to_vendors, '
  'response_deadline, close_bidding_at_deadline, archived_at (and updated_at, set here) may change, '
  'except project_id / created_by going NULL through their ON DELETE SET NULL keys (D7). LG118.';

CREATE TRIGGER rfp_records_guard
  BEFORE INSERT OR UPDATE ON public.rfp_records
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_records_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 4. rfp_record_lines_guard. lead_org_id from the parent; rfp_id pinned; D5 for lines.
--
-- 109's shape: plpgsql, SECURITY INVOKER, the parent read under the CALLER's row level security, so
-- a caller who cannot see the record cannot attach a line to it.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_record_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead  uuid;
  v_sent  timestamptz;
  v_found boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rfp_id IS DISTINCT FROM OLD.rfp_id THEN
    RAISE EXCEPTION 'A scope line cannot move to another RFP record.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines.rfp_id is fixed after insert (migration 118).';
  END IF;

  SELECT r.lead_org_id, r.broadcast_at, true
    INTO v_lead, v_sent, v_found
    FROM public.rfp_records r
   WHERE r.id = NEW.rfp_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That RFP record does not exist or is not yours.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines.rfp_id must be an rfp_records row the caller can see (migration 118).';
  END IF;

  IF v_sent IS NOT NULL THEN
    RAISE EXCEPTION 'This RFP has been sent and is a snapshot. Its scope lines cannot change.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines of a record with broadcast_at set are frozen (migration 118, ruling D5). Insert lines before setting broadcast_at.';
  END IF;

  -- The caller's value is ignored on every write. The parent decides.
  NEW.lead_org_id := v_lead;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_record_lines_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_record_lines, every caller: lead_org_id is set from '
  'the parent rfp_records row (read under the caller''s RLS), rfp_id cannot change, and no line of a '
  'record whose broadcast_at is set may be inserted or updated (D5). LG118.';

CREATE TRIGGER rfp_record_lines_guard
  BEFORE INSERT OR UPDATE ON public.rfp_record_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_record_lines_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 5. PRIVILEGES. 113/114 posture: anon nothing, by name; authenticated SELECT, INSERT, UPDATE only
--    (no DELETE, TRUNCATE, REFERENCES, TRIGGER); service_role ALL.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.rfp_records      FROM PUBLIC;
REVOKE ALL ON TABLE public.rfp_records      FROM anon;
REVOKE ALL ON TABLE public.rfp_records      FROM authenticated;
REVOKE ALL ON TABLE public.rfp_record_lines FROM PUBLIC;
REVOKE ALL ON TABLE public.rfp_record_lines FROM anon;
REVOKE ALL ON TABLE public.rfp_record_lines FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rfp_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rfp_record_lines TO authenticated;
GRANT ALL ON TABLE public.rfp_records      TO service_role;
GRANT ALL ON TABLE public.rfp_record_lines TO service_role;


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY. THREE POLICIES PER TABLE, TO authenticated. NO DELETE POLICY. NO VENDOR
--    POLICY. NO anon POLICY. D1: the paid lead agency helper, never current_user_org_ids().
--    rfp_records INSERT/UPDATE also require the project, when given, to be the lead org's own
--    (114's shape for rfp_magic_tokens, 114:178-185).
-- ---------------------------------------------------------------------
ALTER TABLE public.rfp_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfp_record_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfp_records_entitled_select"
  ON public.rfp_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_records_entitled_insert"
  ON public.rfp_records AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_records.project_id
                       AND pr.org_id = rfp_records.lead_org_id))
  );

CREATE POLICY "rfp_records_entitled_update"
  ON public.rfp_records AS PERMISSIVE FOR UPDATE TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()))
  WITH CHECK (
    lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_records.project_id
                       AND pr.org_id = rfp_records.lead_org_id))
  );

CREATE POLICY "rfp_record_lines_entitled_select"
  ON public.rfp_record_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_record_lines_entitled_insert"
  ON public.rfp_record_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_record_lines_entitled_update"
  ON public.rfp_record_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));


-- ---------------------------------------------------------------------
-- 7. THE FIVE LINK COLUMNS. Nullable, no default, no backfill (119 backfills).
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  ADD COLUMN rfp_line_id          uuid NULL REFERENCES public.rfp_record_lines (id),
  ADD COLUMN client_name_released text NULL;

ALTER TABLE public.rfp_magic_tokens
  ADD COLUMN rfp_line_id          uuid NULL REFERENCES public.rfp_record_lines (id),
  ADD COLUMN attached_inbox_id    uuid NULL REFERENCES public.partner_rfp_inbox (id) ON DELETE SET NULL,
  ADD COLUMN client_name_released text NULL;

CREATE INDEX partner_rfp_inbox_rfp_line_id_idx      ON public.partner_rfp_inbox (rfp_line_id);
CREATE INDEX rfp_magic_tokens_rfp_line_id_idx       ON public.rfp_magic_tokens (rfp_line_id);
CREATE INDEX rfp_magic_tokens_attached_inbox_id_idx ON public.rfp_magic_tokens (attached_inbox_id);

COMMENT ON COLUMN public.partner_rfp_inbox.rfp_line_id IS
  'Migration 118. The rfp_record_lines row this inbox row was sent from. The vendor may read it (an '
  'opaque id into a table it cannot read) and may not write it: partner_rfp_inbox_link_columns_guard.';
COMMENT ON COLUMN public.partner_rfp_inbox.client_name_released IS
  'Migration 118. The client name when the record''s show_client_to_vendors is on, NULL when off. '
  'Written by the agency or the service role only (link-column guard). Not written before step B.';
COMMENT ON COLUMN public.rfp_magic_tokens.rfp_line_id IS
  'Migration 118. The rfp_record_lines row this invitation was sent from. Link-column guard.';
COMMENT ON COLUMN public.rfp_magic_tokens.attached_inbox_id IS
  'Migration 118. The partner_rfp_inbox row this invitation is attached to; replaces the '
  'master_rfp_json._magic_token join (step B). ON DELETE SET NULL: the attach collapse deletes '
  'duplicate inbox rows. Link-column guard.';
COMMENT ON COLUMN public.rfp_magic_tokens.client_name_released IS
  'Migration 118. As partner_rfp_inbox.client_name_released, for the guest page. Link-column guard.';


-- ---------------------------------------------------------------------
-- 8. THE LINK-COLUMN GUARDS. See the header section of that name for the three rules, and THE
--    VENDOR ALLOW-LIST for the inbox guard's rule (4).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partner_rfp_inbox_link_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed   boolean;
  v_trusted   boolean;
  v_line_org  uuid;
  -- Rule (4), ruling O1: the columns a vendor may change. Everything else is refused for a vendor,
  -- including any column added to this table later.
  v_vendor_ok text[] := ARRAY['status', 'updated_at', 'viewed_at', 'partner_intent', 'intent_set_at',
                              'agency_nda_notified_at'];
  v_offending text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.rfp_line_id IS NOT NULL OR NEW.client_name_released IS NOT NULL;
  ELSE
    v_changed := NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
              OR NEW.client_name_released IS DISTINCT FROM OLD.client_name_released;
  END IF;

  v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated');

  -- (1) WHO MAY WRITE A LINK COLUMN.
  IF v_changed AND NOT v_trusted THEN
    IF NOT coalesce(NEW.lead_org_id IN (SELECT public.current_user_org_ids()), false)
       OR (TG_OP = 'UPDATE' AND NOT coalesce(OLD.lead_org_id IN (SELECT public.current_user_org_ids()), false)) THEN
      RAISE EXCEPTION 'That is not a field you can change.'
        USING ERRCODE = '42501',
              DETAIL  = 'partner_rfp_inbox.rfp_line_id and client_name_released are written by the lead agency or the service role only (migration 118).';
    END IF;
  END IF;

  -- (2) THE LINE BELONGS TO THE ROW'S LEAD ORGANIZATION.
  IF NEW.rfp_line_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
          OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id) THEN
    SELECT l.lead_org_id INTO v_line_org FROM public.rfp_record_lines l WHERE l.id = NEW.rfp_line_id;
    IF v_line_org IS DISTINCT FROM NEW.lead_org_id THEN
      RAISE EXCEPTION 'That RFP line does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'partner_rfp_inbox.rfp_line_id must reference an rfp_record_lines row with the same lead_org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  -- (4) THE VENDOR ALLOW-LIST (rulings O1 and O2). Anyone who is not a member of the row's lead
  -- organization before AND after the write, and is not on the trusted path, is a vendor here.
  IF TG_OP = 'UPDATE' AND NOT v_trusted
     AND NOT (coalesce(OLD.lead_org_id IN (SELECT public.current_user_org_ids()), false)
              AND coalesce(NEW.lead_org_id IN (SELECT public.current_user_org_ids()), false)) THEN
    -- O2, the claim: an unclaimed row, claimed for one of the caller's own organizations (099
    -- clause B's test), with claimed_at set in the same update. Never once vendor_org_id is set.
    IF OLD.vendor_org_id IS NULL
       AND coalesce(NEW.vendor_org_id IN (SELECT public.current_user_org_ids()), false)
       AND NEW.claimed_at IS NOT NULL
       AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
      v_vendor_ok := v_vendor_ok || ARRAY['vendor_org_id', 'claimed_at'];
    END IF;

    SELECT o.key
      INTO v_offending
      FROM jsonb_each(to_jsonb(OLD) - v_vendor_ok) o
      LEFT JOIN jsonb_each(to_jsonb(NEW) - v_vendor_ok) n ON n.key = o.key
     WHERE n.value IS DISTINCT FROM o.value
     ORDER BY o.key
     LIMIT 1;

    IF v_offending IS NOT NULL THEN
      RAISE EXCEPTION 'A vendor cannot change partner_rfp_inbox.%.', v_offending
        USING ERRCODE = '42501',
              DETAIL  = 'Vendors may change status, updated_at, viewed_at, partner_intent, intent_set_at and agency_nda_notified_at, and may claim an unclaimed row for their own organization (vendor_org_id with claimed_at). Nothing else (migration 118, rulings O1 and O2).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.partner_rfp_inbox_link_columns_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on partner_rfp_inbox: rfp_line_id and client_name_released '
  'may be set or changed only by a member of the row''s lead organization (before and after the write) '
  'or a trusted path with no session (42501); rfp_line_id must reference a line of the same lead '
  'organization (23514). VENDOR ALLOW-LIST (rulings O1, O2): on UPDATE, a caller who is neither on '
  'the trusted path nor a member of the lead organization before and after may change only status, '
  'updated_at, viewed_at, partner_intent, intent_set_at, agency_nda_notified_at, plus vendor_org_id '
  'and claimed_at when claiming an unclaimed row for one of its own organizations with claimed_at set. '
  'Any other change raises 42501 naming the column. Deny by default: new columns are refused too.';

CREATE TRIGGER partner_rfp_inbox_link_columns_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_inbox_link_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM authenticated;

CREATE FUNCTION public.rfp_magic_tokens_link_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed   boolean;
  v_trusted   boolean;
  v_line_org  uuid;
  v_inbox_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.rfp_line_id IS NOT NULL OR NEW.attached_inbox_id IS NOT NULL
              OR NEW.client_name_released IS NOT NULL;
  ELSE
    v_changed := NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
              OR NEW.attached_inbox_id IS DISTINCT FROM OLD.attached_inbox_id
              OR NEW.client_name_released IS DISTINCT FROM OLD.client_name_released;
  END IF;

  v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated');

  -- (1) WHO MAY WRITE A LINK COLUMN.
  IF v_changed AND NOT v_trusted THEN
    IF NOT coalesce(NEW.org_id IN (SELECT public.current_user_org_ids()), false)
       OR (TG_OP = 'UPDATE' AND NOT coalesce(OLD.org_id IN (SELECT public.current_user_org_ids()), false)) THEN
      RAISE EXCEPTION 'That is not a field you can change.'
        USING ERRCODE = '42501',
              DETAIL  = 'rfp_magic_tokens.rfp_line_id, attached_inbox_id and client_name_released are written by the lead agency or the service role only (migration 118).';
    END IF;
  END IF;

  -- (2) THE LINE BELONGS TO THE TOKEN'S LEAD ORGANIZATION.
  IF NEW.rfp_line_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
          OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    SELECT l.lead_org_id INTO v_line_org FROM public.rfp_record_lines l WHERE l.id = NEW.rfp_line_id;
    IF v_line_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'That RFP line does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'rfp_magic_tokens.rfp_line_id must reference an rfp_record_lines row with lead_org_id = org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  -- (3) THE ATTACHED INBOX ROW BELONGS TO THE TOKEN'S LEAD ORGANIZATION.
  IF NEW.attached_inbox_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.attached_inbox_id IS DISTINCT FROM OLD.attached_inbox_id
          OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    SELECT i.lead_org_id INTO v_inbox_org FROM public.partner_rfp_inbox i WHERE i.id = NEW.attached_inbox_id;
    IF v_inbox_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'That inbox row does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'rfp_magic_tokens.attached_inbox_id must reference a partner_rfp_inbox row with lead_org_id = org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_magic_tokens_link_columns_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_magic_tokens: rfp_line_id, attached_inbox_id and '
  'client_name_released may be set or changed only by a member of the token''s org_id (before and after '
  'the write) or a trusted path with no session (42501); rfp_line_id must reference a line, and '
  'attached_inbox_id an inbox row, of the same organization (23514).';

CREATE TRIGGER rfp_magic_tokens_link_columns_guard
  BEFORE INSERT OR UPDATE ON public.rfp_magic_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_magic_tokens_link_columns_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM authenticated;

-- PostgREST must see the tables and columns at commit.
NOTIFY pgrst, 'reload schema';
-- <<< 118 BODY END
COMMIT;
