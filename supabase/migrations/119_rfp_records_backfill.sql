-- =====================================================================
-- 119: THE RFP RECORD BACKFILL, AND THE CLIENT TOGGLE FUNCTION.
--
-- AUTHORED 2026-10-14 on branch feat/rfp-record-b (unattended run). NOT APPLIED. NOT RUN AGAINST
-- POSTGRES. NO SQL PARSER WAS AVAILABLE TO THE AUTHOR: THE OWNER'S PRE-APPLY TEST RUN IN THE SQL
-- EDITOR IS THE PARSE CHECK. DO NOT APPLY WITHOUT A GREEN RUN OF
-- supabase/migrations/119_preapply_test.sql AND GREG'S SAY-SO.
--
-- Design: docs/rfp-source-of-truth-design.md sections 3, 4 and 7, rulings D1-D9 (section 6). 118 is
-- applied and catalog-verified (2026-10-14). Step B code (feat/rfp-record-b) reads the record where
-- a row is linked and the inbox copy where it is not, so the code may deploy on either side of this
-- file; its toggle route answers 503 until this file creates the function.
--
--   (i)  CREATE FUNCTION public.rfp_record_set_client_visibility(p_record uuid, p_show boolean) -> jsonb
--   (ii) THE BACKFILL: one rfp_records row per past send, its lines, and rfp_line_id /
--        attached_inbox_id on the inbox rows and tokens it was rebuilt from.
--
-- UNCHANGED: every policy, every grant, every trigger, every existing function, every step A record
-- and line, every inbox row and token that already carries rfp_line_id (step A sends, e.g. record
-- 21f9d17d-6b6c-471c-8cfb-931d631b6ca4 from the 2026-10-14 smoke test), and every column of every
-- inbox row and token except the two link columns named above. No inbox row or token is inserted
-- or deleted. client_name_released is not written: every backfilled record is hidden (D3), so it
-- stays NULL. master_rfp_json is not touched (step C / 120).
--
-- THE FULL FILENAME IS 119_rfp_records_backfill.sql. Its rollback sibling is
-- 119_rfp_records_backfill_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- (i) THE FUNCTION
-- =====================================================================
--
-- rfp_record_set_client_visibility(p_record, p_show): SECURITY INVOKER (118's RLS and its four
-- guards apply as the caller), search_path pinned, EXECUTE revoked from PUBLIC and anon, granted to
-- authenticated. One call is one statement, so one transaction:
--   1. UPDATE rfp_records SET show_client_to_vendors = p_show (D5 admits this column after
--      broadcast). Under RLS only a member of the record's paid lead agency (D1) matches the row.
--      ZERO ROWS RAISES P0002 BEFORE ANYTHING ELSE IS WRITTEN: another organization's record, an
--      unpaid caller, a vendor, or an id that does not exist all get the same refusal, and nothing
--      changes.
--   2. client_name_released := the record's client_name_snapshot when p_show, NULL otherwise, on
--      every partner_rfp_inbox row and every rfp_magic_tokens row whose rfp_line_id is one of the
--      record's lines. 118's link-column guard admits the caller as a member of the row's lead
--      organization; rule (2) of that guard means every row linked to the record's lines belongs to
--      the record's organization, so no linked row is hidden from the caller's UPDATE.
--   Any error in 2 (a policy or guard refusal) aborts the whole call: no partial write.
--   Returns {"record", "show_client_to_vendors", "inbox_rows", "tokens"} (rows changed).
--   Called by app/api/agency/rfp-records/[id]/route.ts on the agency's session client only.
--
-- =====================================================================
-- (ii) THE BACKFILL. RULINGS AND WHERE EACH LIVES
-- =====================================================================
--
--  * D4 ONE RECORD PER SEND. A wizard send is every unlinked, non-Lightning inbox row sharing
--    (lead_org_id, project_id, created_at): broadcast-rfp inserts a send's rows in one statement,
--    so they share created_at to the transaction. Lines are that group's scope_item_ids.
--  * D6 LIGHTNING (MAGIC-LINK) SENDS ARE THEIR OWN RECORDS, SOURCED FROM THE AGENCY-ONLY TOKEN, never
--    from an inbox copy. ONE RECORD PER UNLINKED TOKEN (step A writes one record per magic-link send;
--    the magic-link route keeps one token per (org, project, vendor) and moves it on a resend). The
--    design's section 4.2 sketch grouped tokens per (org, project); tokens of one project can carry
--    different rubrics and are separate sends, so they are not merged.
--  * D2 released_budget = estimated_budget on every backfilled line (bids in progress keep their
--    number). Wizard lines: inbox.estimated_budget. Lightning lines: projects.budget_range (step A's
--    own fallback when no figure is given).
--  * D3 show_client_to_vendors = false on every backfilled record.
--  * source = 'backfill' on every record this file writes; backfill_note says how it was built.
--
-- THE PROVENANCE RULE (security: before 118's F1 fix a vendor could rewrite its own inbox copy):
--  * A wizard group rebuilt from 2+ inbox copies must carry IDENTICAL evaluation_criteria,
--    budget_categories and business_criteria_required on every copy, and identical
--    scope_item_name / scope_item_description / estimated_budget on every copy of a line. Otherwise
--    the group is REFUSED: nothing is written for it, its rows stay unlinked (the readers keep their
--    pre-step-B fallback for them), and it is listed (RAISE WARNING ... LG119, and in the result).
--  * A group rebuilt from a SINGLE inbox copy cannot be cross-checked. It is built, its
--    backfill_note starts 'unverified single copy', and it is listed in the result's unverified list.
--  * Every wizard group's client name is checked against projects.client_name. On a mismatch the
--    snapshot is taken FROM THE PROJECT and the note says 'client name taken from project'. A group
--    with no project keeps the copy's client name and the note says so. (Hidden either way: D3.)
--  * A group or token whose project is missing or belongs to another organization is refused.
--  * The token is agency-only (no vendor can write it), so a Lightning record needs no cross-check.
--
-- THE WRITE ORDER (118's snapshot guard requires it), per record:
--   1. INSERT the rfp_records row WITHOUT broadcast_at;  2. INSERT its lines;
--   3. SET rfp_line_id on its inbox rows and tokens;     4. SET rfp_magic_tokens.attached_inbox_id;
--   5. SET broadcast_at LAST, to the original send time (inbox created_at / token created_at).
-- created_at is the time of this backfill; broadcast_at carries the original send time.
--
-- LIGHTNING INBOX ROWS ATTACHED AFTER A STEP A SEND. The vendor-side attach (lib/magic-token-attach.ts,
-- unchanged until step C) can create an inbox row for a token step A already linked, without setting
-- rfp_line_id. Such a row is linked to its token's existing line. The step A record, its lines and
-- the token are not changed. A Lightning inbox row whose token is missing, or was refused above, is
-- refused.
--
-- IDEMPOTENCY: the file refuses (LG119) if any rfp_records row has source = 'backfill'. Rows and
-- tokens that already carry rfp_line_id are skipped.
--
-- THE TRUSTED PATH (118): 118's link-column guards admit a write with no end-user session
-- (auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated')). The SQL Editor runs as
-- postgres with no JWT claims, so it passes. The file checks that first and refuses otherwise; it
-- never relies on weakening a guard.
--
-- THE RESULT: a final RAISE NOTICE with the counts and lists, and the same as JSON in the
-- transaction-local setting ligament.backfill_119 (the pre-apply test reads it). The Supabase SQL
-- Editor may show only "Success. No rows returned"; V2 to V6 below reproduce every list from the
-- tables.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--   [ ] 118 is applied and catalog-verified (2026-10-14).
--   [ ] P1 to P4 below answer as EXPECTED. The transaction ENFORCES P1 and P2 (LG119).
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 119." It is also the parse check. Its
--       INCONCLUSIVE-BY-DESIGN rows (U1, X1: no unpaid or second lead agency exists) are expected.
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 still answers null and 0).
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 to P4. Record the answers (P3 and P4 are what the backfill will do).
--   2. Paste supabase/migrations/119_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 119.". Read its BACKFILL lines.
--   3. DRY RUN: replace the final COMMIT; (line number at the foot of this header) with ROLLBACK;
--      and run the file. Prove it rolled back: P2 must still answer null and 0.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V6. V1 and V5 must return EXACTLY the EXPECTED values; V2 to V4 and V6 are lists.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record. Next free: 120.
--   Rollback: supabase/migrations/119_rfp_records_backfill_down.sql.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY.
-- =====================================================================
--
-- P1. 118 IS PRESENT.
--   SELECT to_regclass('public.rfp_records'), to_regclass('public.rfp_record_lines'),
--          to_regprocedure('public.partner_rfp_inbox_link_columns_guard()'),
--          to_regprocedure('public.rfp_magic_tokens_link_columns_guard()');
--   EXPECTED: four non-null values.
--
-- P2. NOTHING OF 119 EXISTS YET.
--   SELECT to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)'),
--          (SELECT count(*) FROM public.rfp_records WHERE source = 'backfill');
--   EXPECTED: null, 0.
--
-- P3. WHAT IS UNLINKED (what the backfill reads).
--   SELECT (SELECT count(*) FROM public.partner_rfp_inbox) AS inbox_rows,
--          (SELECT count(*) FROM public.partner_rfp_inbox WHERE rfp_line_id IS NULL) AS inbox_unlinked,
--          (SELECT count(*) FROM public.partner_rfp_inbox WHERE rfp_line_id IS NULL
--             AND (coalesce(master_rfp_json ? '_magic_token', false) OR scope_item_id LIKE 'magic:%')) AS inbox_unlinked_lightning,
--          (SELECT count(*) FROM public.rfp_magic_tokens) AS tokens,
--          (SELECT count(*) FROM public.rfp_magic_tokens WHERE rfp_line_id IS NULL) AS tokens_unlinked;
--   EXPECTED: inbox_rows 97 plus any send since 2026-10-14; write the numbers down.
--
-- P4. THE WIZARD GROUPS THE BACKFILL WILL BUILD, AND WHICH IT WILL REFUSE OR MARK UNVERIFIED.
--   SELECT i.lead_org_id, i.project_id, i.created_at, count(*) AS copies,
--          count(DISTINCT i.scope_item_id) AS lines,
--          count(DISTINCT jsonb_build_array(i.master_rfp_json -> 'evaluation_criteria',
--                                           i.master_rfp_json -> 'budget_categories',
--                                           i.master_rfp_json -> 'business_criteria_required')) AS rubric_variants
--   FROM public.partner_rfp_inbox i
--   WHERE i.rfp_line_id IS NULL
--     AND NOT (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))
--   GROUP BY 1, 2, 3 ORDER BY 3;
--   EXPECTED: rubric_variants 1 on every row (any row with 2+ is refused); copies 1 = unverified.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT.
-- =====================================================================
--
-- V1. THE RECORDS BY SOURCE. EXPECTED: a 'backfill' row with drafts 0, client_shown 0, and
--     no_lines 0; the 'wizard' and 'magic_link' rows exactly as before the apply.
--   SELECT r.source, count(*) AS records, count(*) FILTER (WHERE r.broadcast_at IS NULL) AS drafts,
--          count(*) FILTER (WHERE r.show_client_to_vendors) AS client_shown,
--          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.rfp_id = r.id)) AS no_lines
--   FROM public.rfp_records r GROUP BY r.source ORDER BY 1;
--
-- V2. THE REFUSED ROWS (every inbox row still unlinked). Equals the NOTICE's refused list.
--   SELECT i.id, i.lead_org_id, i.project_id, i.created_at, i.scope_item_id
--   FROM public.partner_rfp_inbox i WHERE i.rfp_line_id IS NULL ORDER BY i.created_at, i.id;
--   SELECT t.id, t.org_id, t.project_id, t.created_at FROM public.rfp_magic_tokens t
--   WHERE t.rfp_line_id IS NULL ORDER BY t.created_at;
--
-- V3. THE UNVERIFIED SINGLE-COPY RECORDS.
--   SELECT r.id, r.project_id, r.broadcast_at, r.backfill_note FROM public.rfp_records r
--   WHERE r.source = 'backfill' AND r.backfill_note LIKE 'unverified single copy%' ORDER BY r.broadcast_at;
--
-- V4. THE CLIENT-NAME CORRECTIONS.
--   SELECT r.id, r.project_id, r.client_name_snapshot, r.backfill_note FROM public.rfp_records r
--   WHERE r.source = 'backfill' AND r.backfill_note LIKE '%client name taken from project%' ORDER BY r.broadcast_at;
--
-- V5. THE FUNCTION. EXPECTED: f, {"search_path=public, pg_temp"}, f, t; and 161 policies.
--   SELECT p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
--   FROM pg_proc p WHERE p.oid = 'public.rfp_record_set_client_visibility(uuid, boolean)'::regprocedure;
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- V6. EVERY BACKFILLED LINE: released = estimated (D2). EXPECTED: 0.
--   SELECT count(*) FROM public.rfp_record_lines l JOIN public.rfp_records r ON r.id = l.rfp_id
--   WHERE r.source = 'backfill' AND l.released_budget IS DISTINCT FROM l.estimated_budget;
--
-- BEGIN, COMMIT and body-marker line numbers of the transaction below (BODY START 203, BODY END 747):
-- BEGIN is at line 202 and COMMIT is at line 748.

BEGIN;
-- >>> 119 BODY START
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.rfp_records') IS NULL OR to_regclass('public.rfp_record_lines') IS NULL THEN
    RAISE EXCEPTION '119 refuses to run: rfp_records or rfp_record_lines does not exist. Apply 118 first.'
      USING ERRCODE = 'LG119';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('rfp_records', 'rfp_records_guard'),
                                                   ('rfp_record_lines', 'rfp_record_lines_guard'),
                                                   ('partner_rfp_inbox', 'partner_rfp_inbox_link_columns_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_link_columns_guard'))) <> 4 THEN
    RAISE EXCEPTION '119 refuses to run: one of 118''s four guards is missing or not enabled. The backfill must run under them.'
      USING ERRCODE = 'LG119';
  END IF;

  -- The columns the backfill reads and writes.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'partner_rfp_inbox' AND column_name IN ('id', 'lead_org_id', 'project_id', 'scope_item_id',
                 'scope_item_name', 'scope_item_description', 'estimated_budget', 'master_rfp_json', 'created_at',
                 'response_deadline', 'close_bidding_at_deadline', 'require_terms_disclosure', 'rfp_line_id',
                 'client_name_released'))
           OR (table_name = 'rfp_magic_tokens' AND column_name IN ('id', 'token', 'org_id', 'project_id', 'scope_item_id',
                 'scope_item_name', 'scope_item_description', 'reference_materials', 'business_criteria_required',
                 'evaluation_criteria', 'budget_categories', 'response_deadline', 'close_bidding_at_deadline',
                 'require_terms_disclosure', 'created_at', 'rfp_line_id', 'attached_inbox_id', 'client_name_released'))
           OR (table_name = 'projects' AND column_name IN ('id', 'org_id', 'name', 'client_name', 'budget_range')))) <> 37 THEN
    RAISE EXCEPTION '119 refuses to run: a column it reads or writes is missing on partner_rfp_inbox, rfp_magic_tokens or projects.'
      USING ERRCODE = 'LG119';
  END IF;

  -- Idempotency. Checked before the function, so a second run names the real reason.
  IF EXISTS (SELECT 1 FROM public.rfp_records WHERE source = 'backfill') THEN
    RAISE EXCEPTION '119 refuses to run: rfp_records already holds backfilled records (source = backfill), so 119 has run. Nothing was changed.'
      USING ERRCODE = 'LG119';
  END IF;

  IF to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '119 refuses to run: public.rfp_record_set_client_visibility(uuid, boolean) already exists. Read the schema before going further.'
      USING ERRCODE = 'LG119';
  END IF;

  -- 118's trusted path. Never weaken a guard to make this pass.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '119 refuses to run: it must run with no end-user session (the SQL Editor role), which is 118''s trusted path. auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG119';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE FUNCTION. See the header section (i).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_record_set_client_visibility(p_record uuid, p_show boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found    boolean;
  v_snapshot text;
  v_released text;
  v_inbox    integer := 0;
  v_tokens   integer := 0;
BEGIN
  IF p_record IS NULL OR p_show IS NULL THEN
    RAISE EXCEPTION 'An RFP record and a true or false choice are both required.'
      USING ERRCODE = '22004';
  END IF;

  -- 1. The record, under the caller's RLS. Zero rows: refuse before anything is written.
  UPDATE public.rfp_records r
     SET show_client_to_vendors = p_show
   WHERE r.id = p_record
  RETURNING true, r.client_name_snapshot INTO v_found, v_snapshot;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That RFP record does not exist or is not yours.'
      USING ERRCODE = 'P0002',
            DETAIL  = 'rfp_record_set_client_visibility matched no rfp_records row the caller may update (migration 119).';
  END IF;

  v_released := CASE WHEN p_show THEN nullif(btrim(v_snapshot), '') ELSE NULL END;

  -- 2. Every inbox row and token linked to this record's lines follows the record.
  UPDATE public.partner_rfp_inbox i
     SET client_name_released = v_released
   WHERE i.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l WHERE l.rfp_id = p_record)
     AND i.client_name_released IS DISTINCT FROM v_released;
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  UPDATE public.rfp_magic_tokens t
     SET client_name_released = v_released
   WHERE t.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l WHERE l.rfp_id = p_record)
     AND t.client_name_released IS DISTINCT FROM v_released;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  RETURN jsonb_build_object('record', p_record, 'show_client_to_vendors', p_show,
                            'inbox_rows', v_inbox, 'tokens', v_tokens);
END;
$$;

COMMENT ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) IS
  'Migration 119. The per-RFP client toggle (ruling D3) on an existing record, in one transaction: '
  'sets rfp_records.show_client_to_vendors, then client_name_released (the record''s '
  'client_name_snapshot when on, NULL when off) on every partner_rfp_inbox row and rfp_magic_tokens row '
  'linked to the record''s lines. SECURITY INVOKER: RLS and 118''s guards apply as the caller. Raises '
  'P0002 and writes nothing when the caller cannot update the record.';

REVOKE EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) TO authenticated;


-- ---------------------------------------------------------------------
-- 2. THE BACKFILL. See the header section (ii).
-- ---------------------------------------------------------------------
DO $backfill$
DECLARE
  g                  record;
  s                  record;
  t                  record;
  r                  record;
  v_rec              uuid;
  v_line             uuid;
  v_first_inbox      uuid;
  v_tok_line         uuid;
  v_tok_found        boolean;
  v_m                jsonb;
  v_n                integer;
  v_left             bigint;
  v_reason           text;
  v_gid              text;
  v_notes            text[];
  v_snapshot         text;
  v_copy_client      text;
  v_pname            text;
  v_pclient          text;
  v_pbudget          text;
  v_records_wizard   integer := 0;
  v_records_magic    integer := 0;
  v_lines            integer := 0;
  v_inbox_linked     integer := 0;
  v_inbox_to_step_a  integer := 0;
  v_tokens_linked    integer := 0;
  v_tokens_attached  integer := 0;
  v_no_project_inbox integer := 0;
  v_no_project_token integer := 0;
  v_groups_refused   integer := 0;
  v_refused          text[] := ARRAY[]::text[];
  v_refused_inbox    text[] := ARRAY[]::text[];
  v_refused_tokens   text[] := ARRAY[]::text[];
  v_unverified       text[] := ARRAY[]::text[];
  v_client_fixes     text[] := ARRAY[]::text[];
  v_result           jsonb;
BEGIN
  -- ===================================================================
  -- A. WIZARD SENDS. One record per (lead_org_id, project_id, created_at) of unlinked,
  --    non-Lightning inbox rows.
  -- ===================================================================
  FOR g IN
    SELECT i.lead_org_id, i.project_id, i.created_at, count(*)::integer AS n,
           array_agg(i.id ORDER BY i.id) AS ids
      FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NULL
       AND NOT (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))
     GROUP BY i.lead_org_id, i.project_id, i.created_at
     ORDER BY i.created_at, i.lead_org_id, i.project_id
  LOOP
    v_gid := format('wizard send %s, org %s, project %s', g.created_at, g.lead_org_id, coalesce(g.project_id::text, 'none'));
    v_reason := NULL;

    IF g.lead_org_id IS NULL THEN
      v_reason := 'the rows carry no lead organization';
    ELSIF g.created_at IS NULL THEN
      v_reason := 'the rows carry no send time';
    ELSIF g.project_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = g.project_id AND p.org_id = g.lead_org_id) THEN
      v_reason := 'the project is missing or belongs to another organization';
    ELSIF EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                   WHERE i.id = ANY (g.ids) AND jsonb_typeof(i.master_rfp_json) IS DISTINCT FROM 'object') THEN
      v_reason := 'a copy carries no master_rfp_json object';
    ELSIF (SELECT count(DISTINCT jsonb_build_array(i.master_rfp_json -> 'evaluation_criteria',
                                                   i.master_rfp_json -> 'budget_categories',
                                                   i.master_rfp_json -> 'business_criteria_required'))
             FROM public.partner_rfp_inbox i WHERE i.id = ANY (g.ids)) > 1 THEN
      v_reason := format('the rubric, budget categories or requirements differ across its %s copies', g.n);
    ELSIF EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                   WHERE i.id = ANY (g.ids)
                   GROUP BY i.scope_item_id
                  HAVING count(DISTINCT jsonb_build_array(i.scope_item_name, i.scope_item_description, i.estimated_budget)) > 1) THEN
      v_reason := 'a scope line''s name, description or estimated budget differs across its copies';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('%s: %s (inbox rows %s)', v_gid, v_reason, array_to_string(g.ids, ', '));
      v_refused_inbox := v_refused_inbox || (SELECT array_agg(x::text) FROM unnest(g.ids) AS x);
      RAISE WARNING 'LG119 REFUSED %: %', v_gid, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    -- The copy the master is taken from: the first by id (every copy of a send shares created_at).
    SELECT i.* INTO s FROM public.partner_rfp_inbox i WHERE i.id = g.ids[1];
    v_m := s.master_rfp_json;
    v_notes := ARRAY[]::text[];

    IF g.n = 1 THEN
      v_notes := v_notes || 'unverified single copy'::text;
    END IF;

    v_copy_client := nullif(btrim(v_m ->> 'client'), '');
    IF g.project_id IS NOT NULL THEN
      SELECT nullif(btrim(p.client_name::text), '') INTO v_snapshot FROM public.projects p WHERE p.id = g.project_id;
      IF v_copy_client IS DISTINCT FROM v_snapshot THEN
        v_notes := v_notes || 'client name taken from project'::text;
        v_client_fixes := v_client_fixes || v_gid;
      END IF;
    ELSE
      v_snapshot := v_copy_client;
      v_notes := v_notes || 'no project to check the client name against, taken from the copy'::text;
      v_no_project_inbox := v_no_project_inbox + g.n;
    END IF;

    IF g.n > 1 AND (SELECT count(DISTINCT i.master_rfp_json) FROM public.partner_rfp_inbox i WHERE i.id = ANY (g.ids)) > 1 THEN
      v_notes := v_notes || 'copies differ outside the rubric, categories and requirements, master taken from the first copy'::text;
    END IF;

    v_notes := v_notes || format('119 backfill of the wizard send of %s, rebuilt from %s inbox cop%s, master from inbox row %s',
                                 g.created_at, g.n, CASE WHEN g.n = 1 THEN 'y' ELSE 'ies' END, s.id);

    -- (1) The record, WITHOUT broadcast_at.
    INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp, evaluation_criteria, budget_categories,
                                    business_criteria_required, output_template_config, total_budget,
                                    show_client_to_vendors, client_name_snapshot, response_deadline,
                                    close_bidding_at_deadline, require_terms_disclosure, nda_link, created_by, backfill_note)
    VALUES (g.lead_org_id, g.project_id, 'backfill', v_m - 'nda_link',
            nullif(v_m -> 'evaluation_criteria', 'null'::jsonb),
            nullif(v_m -> 'budget_categories', 'null'::jsonb),
            CASE WHEN jsonb_typeof(v_m -> 'business_criteria_required') = 'object'
                 THEN v_m -> 'business_criteria_required' ELSE '{}'::jsonb END,
            NULL,
            CASE WHEN jsonb_typeof(v_m -> 'totalBudget') IN ('string', 'number')
                 THEN nullif(btrim(v_m ->> 'totalBudget'), '') END,
            false,
            v_snapshot,
            s.response_deadline,
            coalesce(s.close_bidding_at_deadline, false),
            coalesce(s.require_terms_disclosure, true),
            nullif(btrim(v_m ->> 'nda_link'), ''),
            NULL,
            array_to_string(v_notes, '; '))
    RETURNING id INTO v_rec;

    -- (2) Its lines, one per scope_item_id. D2: released_budget = estimated_budget.
    INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name, scope_item_description,
                                         estimated_budget, released_budget, sort_order)
    SELECT v_rec, x.scope_item_id,
           coalesce(nullif(btrim(x.scope_item_name), ''), 'Scope'),
           x.scope_item_description,
           x.estimated_budget,
           x.estimated_budget,
           coalesce((SELECT (e.ord - 1)::integer
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_m -> 'scopeItems') = 'array'
                                                      THEN v_m -> 'scopeItems' ELSE '[]'::jsonb END)
                            WITH ORDINALITY AS e(item, ord)
                      WHERE e.item ->> 'id' = x.scope_item_id
                      LIMIT 1), 1000)
      FROM (SELECT DISTINCT ON (i.scope_item_id) i.scope_item_id, i.scope_item_name, i.scope_item_description, i.estimated_budget
              FROM public.partner_rfp_inbox i
             WHERE i.id = ANY (g.ids)
             ORDER BY i.scope_item_id, i.id) x;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_lines := v_lines + v_n;

    -- (3) Every copy carries its line.
    UPDATE public.partner_rfp_inbox i
       SET rfp_line_id = l.id
      FROM public.rfp_record_lines l
     WHERE l.rfp_id = v_rec
       AND l.scope_item_key = i.scope_item_id
       AND i.id = ANY (g.ids)
       AND i.rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> g.n THEN
      RAISE EXCEPTION '119 stopped: % linked % of its % inbox rows. Nothing was committed.', v_gid, v_n, g.n
        USING ERRCODE = 'LG119';
    END IF;
    v_inbox_linked := v_inbox_linked + v_n;

    -- (5) broadcast_at LAST, to the original send time.
    UPDATE public.rfp_records SET broadcast_at = g.created_at WHERE id = v_rec AND broadcast_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not set broadcast_at on record % (%). Nothing was committed.', v_rec, v_gid
        USING ERRCODE = 'LG119';
    END IF;

    v_records_wizard := v_records_wizard + 1;
    IF g.n = 1 THEN
      v_unverified := v_unverified || format('record %s (%s, inbox row %s)', v_rec, v_gid, g.ids[1]);
    END IF;
  END LOOP;

  -- ===================================================================
  -- B. LIGHTNING (MAGIC-LINK) SENDS. One record per unlinked token, from the token (D6).
  -- ===================================================================
  FOR t IN
    SELECT tk.id::text AS tid, tk.token, tk.org_id, tk.project_id, tk.scope_item_id::text AS scope_item_id,
           tk.scope_item_name, tk.scope_item_description, tk.reference_materials, tk.business_criteria_required,
           tk.evaluation_criteria, tk.budget_categories, tk.response_deadline, tk.close_bidding_at_deadline,
           tk.require_terms_disclosure, tk.created_at
      FROM public.rfp_magic_tokens tk
     WHERE tk.rfp_line_id IS NULL
     ORDER BY tk.created_at, tk.id::text
  LOOP
    -- The token value is a bearer credential: never printed. Rows are named by their id.
    v_gid := format('Lightning token row %s, org %s, project %s', t.tid, t.org_id, coalesce(t.project_id::text, 'none'));
    v_reason := NULL;

    IF t.org_id IS NULL THEN
      v_reason := 'the token carries no organization';
    ELSIF t.created_at IS NULL THEN
      v_reason := 'the token carries no send time';
    ELSIF t.project_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id AND p.org_id = t.org_id) THEN
      v_reason := 'the project is missing or belongs to another organization';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('%s: %s', v_gid, v_reason);
      v_refused_tokens := v_refused_tokens || t.tid;
      RAISE WARNING 'LG119 REFUSED %: %', v_gid, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    v_pname := NULL; v_pclient := NULL; v_pbudget := NULL;
    IF t.project_id IS NOT NULL THEN
      SELECT p.name::text, p.client_name::text, p.budget_range::text INTO v_pname, v_pclient, v_pbudget
        FROM public.projects p WHERE p.id = t.project_id;
    ELSE
      v_no_project_token := v_no_project_token + 1;
    END IF;

    -- (1) The record, WITHOUT broadcast_at. Everything from the agency-only token and the project.
    INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp, evaluation_criteria, budget_categories,
                                    business_criteria_required, output_template_config, total_budget,
                                    show_client_to_vendors, client_name_snapshot, response_deadline,
                                    close_bidding_at_deadline, require_terms_disclosure, nda_link, created_by, backfill_note)
    VALUES (t.org_id, t.project_id, 'backfill',
            jsonb_build_object(
              'projectName', v_pname,
              'scopeItems', jsonb_build_array(jsonb_build_object('id', t.scope_item_id, 'name', t.scope_item_name,
                                                                 'description', t.scope_item_description)),
              'referenceMaterials', CASE jsonb_typeof(t.reference_materials)
                                      WHEN 'array'  THEN t.reference_materials
                                      WHEN 'object' THEN coalesce(t.reference_materials -> 'materials', '[]'::jsonb)
                                      ELSE '[]'::jsonb END),
            nullif(t.evaluation_criteria, 'null'::jsonb),
            nullif(t.budget_categories, 'null'::jsonb),
            CASE WHEN jsonb_typeof(t.business_criteria_required) = 'object' THEN t.business_criteria_required ELSE '{}'::jsonb END,
            CASE WHEN jsonb_typeof(t.reference_materials) = 'object'
                 THEN nullif(t.reference_materials -> 'output_template_config', 'null'::jsonb) END,
            v_pbudget,
            false,
            nullif(btrim(v_pclient), ''),
            t.response_deadline,
            coalesce(t.close_bidding_at_deadline, false),
            coalesce(t.require_terms_disclosure, true),
            NULL,
            NULL,
            format('119 backfill of the Lightning RFP sent %s, rebuilt from the agency-only token row %s (D6)', t.created_at, t.tid))
    RETURNING id INTO v_rec;

    -- (2) Its one line. D2: released_budget = estimated_budget (the project's budget range).
    INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name, scope_item_description,
                                         estimated_budget, released_budget, sort_order)
    VALUES (v_rec, coalesce(t.scope_item_id, 'magic'),
            coalesce(nullif(btrim(t.scope_item_name), ''), nullif(btrim(v_pname), ''), 'Scope item'),
            t.scope_item_description, v_pbudget, v_pbudget, 0)
    RETURNING id INTO v_line;
    v_lines := v_lines + 1;

    -- (3) The token, and every inbox row attached for it (either key), carry the line.
    UPDATE public.rfp_magic_tokens SET rfp_line_id = v_line WHERE id::text = t.tid AND rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not link % to its line. Nothing was committed.', v_gid USING ERRCODE = 'LG119';
    END IF;
    v_tokens_linked := v_tokens_linked + 1;

    UPDATE public.partner_rfp_inbox i
       SET rfp_line_id = v_line
     WHERE i.lead_org_id = t.org_id
       AND i.rfp_line_id IS NULL
       AND (coalesce(i.master_rfp_json @> jsonb_build_object('_magic_token', t.token), false)
            OR i.scope_item_id = 'magic:' || t.token);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inbox_linked := v_inbox_linked + v_n;

    -- (4) attached_inbox_id: the invitation's canonical row, first by (created_at, id), the order
    --     lib/magic-token-attach.ts keeps when it collapses duplicates.
    v_first_inbox := NULL;
    SELECT i.id INTO v_first_inbox FROM public.partner_rfp_inbox i
     WHERE i.lead_org_id = t.org_id AND i.rfp_line_id = v_line
     ORDER BY i.created_at, i.id LIMIT 1;
    IF v_first_inbox IS NOT NULL THEN
      UPDATE public.rfp_magic_tokens SET attached_inbox_id = v_first_inbox
       WHERE id::text = t.tid AND attached_inbox_id IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_tokens_attached := v_tokens_attached + v_n;
    END IF;

    -- (5) broadcast_at LAST, to the original send time.
    UPDATE public.rfp_records SET broadcast_at = t.created_at WHERE id = v_rec AND broadcast_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not set broadcast_at on record % (%). Nothing was committed.', v_rec, v_gid
        USING ERRCODE = 'LG119';
    END IF;
    v_records_magic := v_records_magic + 1;
  END LOOP;

  -- ===================================================================
  -- C. LIGHTNING INBOX ROWS STILL UNLINKED: attached after a step A send (linked to the token's
  --    existing line; the step A record, its lines and the token are not changed), or orphaned.
  -- ===================================================================
  FOR r IN
    SELECT i.id, i.lead_org_id, i.master_rfp_json ->> '_magic_token' AS marker, i.scope_item_id
      FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NULL
       AND (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))
     ORDER BY i.created_at, i.id
  LOOP
    v_tok_line := NULL;
    v_tok_found := false;
    SELECT tk.rfp_line_id, true INTO v_tok_line, v_tok_found
      FROM public.rfp_magic_tokens tk
     WHERE tk.org_id = r.lead_org_id
       AND (tk.token = r.marker OR 'magic:' || tk.token = r.scope_item_id)
     ORDER BY tk.created_at, tk.id::text
     LIMIT 1;

    IF v_tok_found IS NOT TRUE THEN
      v_reason := 'a Lightning RFP inbox row whose token is not in its organization';
    ELSIF v_tok_line IS NULL THEN
      v_reason := 'a Lightning RFP inbox row whose token was refused above';
    ELSE
      v_reason := NULL;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('inbox row %s: %s', r.id, v_reason);
      v_refused_inbox := v_refused_inbox || r.id::text;
      RAISE WARNING 'LG119 REFUSED inbox row %: %', r.id, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    UPDATE public.partner_rfp_inbox SET rfp_line_id = v_tok_line WHERE id = r.id AND rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not link Lightning inbox row % to its token''s line. Nothing was committed.', r.id
        USING ERRCODE = 'LG119';
    END IF;
    v_inbox_linked := v_inbox_linked + 1;
    v_inbox_to_step_a := v_inbox_to_step_a + 1;
  END LOOP;

  -- ===================================================================
  -- D. THE ACCOUNTING. Every inbox row and token is linked or listed as refused; every backfilled
  --    record has lines and a send time. Anything else stops the whole file.
  -- ===================================================================
  SELECT count(*) INTO v_left FROM public.partner_rfp_inbox WHERE rfp_line_id IS NULL;
  IF v_left <> cardinality(v_refused_inbox)
     OR EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                 WHERE i.rfp_line_id IS NULL AND NOT (i.id::text = ANY (v_refused_inbox))) THEN
    RAISE EXCEPTION '119 stopped: % inbox rows are unlinked but % were refused. Nothing was committed.', v_left, cardinality(v_refused_inbox)
      USING ERRCODE = 'LG119';
  END IF;

  SELECT count(*) INTO v_left FROM public.rfp_magic_tokens WHERE rfp_line_id IS NULL;
  IF v_left <> cardinality(v_refused_tokens) THEN
    RAISE EXCEPTION '119 stopped: % tokens are unlinked but % were refused. Nothing was committed.', v_left, cardinality(v_refused_tokens)
      USING ERRCODE = 'LG119';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rfp_records rr
              WHERE rr.source = 'backfill'
                AND (rr.broadcast_at IS NULL OR rr.show_client_to_vendors
                     OR NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.rfp_id = rr.id))) THEN
    RAISE EXCEPTION '119 stopped: a backfilled record has no line, no broadcast_at, or shows the client. Nothing was committed.'
      USING ERRCODE = 'LG119';
  END IF;

  v_result := jsonb_build_object(
    'records',                v_records_wizard + v_records_magic,
    'records_wizard',         v_records_wizard,
    'records_lightning',      v_records_magic,
    'lines',                  v_lines,
    'inbox_rows_linked',      v_inbox_linked,
    'inbox_rows_linked_to_step_a_lines', v_inbox_to_step_a,
    'tokens_linked',          v_tokens_linked,
    'tokens_attached',        v_tokens_attached,
    'groups_refused',         v_groups_refused,
    'refused',                to_jsonb(v_refused),
    'refused_inbox_ids',      to_jsonb(v_refused_inbox),
    'refused_token_ids',      to_jsonb(v_refused_tokens),
    'unverified_single_copy', to_jsonb(v_unverified),
    'client_name_corrections', to_jsonb(v_client_fixes),
    'no_project_inbox_rows',  v_no_project_inbox,
    'no_project_tokens',      v_no_project_token);

  -- Transaction-local: gone at COMMIT. The pre-apply test reads it.
  PERFORM set_config('ligament.backfill_119', v_result::text, true);

  -- One message, built with format() (in RAISE itself "%%" is a literal percent sign).
  RAISE NOTICE '%', format(
    E'119 BACKFILL DONE.\n  records: %s (wizard %s, Lightning %s)\n  lines: %s\n  inbox rows linked: %s (of which %s to an existing step A line)\n  tokens linked: %s (attached_inbox_id set on %s)\n  groups refused: %s (%s inbox rows, %s tokens)%s\n  unverified single-copy groups: %s%s\n  client-name corrections: %s%s\n  rows with no project_id: %s inbox rows, %s tokens',
    v_records_wizard + v_records_magic, v_records_wizard, v_records_magic,
    v_lines,
    v_inbox_linked, v_inbox_to_step_a,
    v_tokens_linked, v_tokens_attached,
    v_groups_refused, cardinality(v_refused_inbox), cardinality(v_refused_tokens),
    CASE WHEN cardinality(v_refused) > 0 THEN E'\n    ' || array_to_string(v_refused, E'\n    ') ELSE '' END,
    cardinality(v_unverified),
    CASE WHEN cardinality(v_unverified) > 0 THEN E'\n    ' || array_to_string(v_unverified, E'\n    ') ELSE '' END,
    cardinality(v_client_fixes),
    CASE WHEN cardinality(v_client_fixes) > 0 THEN E'\n    ' || array_to_string(v_client_fixes, E'\n    ') ELSE '' END,
    v_no_project_inbox, v_no_project_token);
END
$backfill$;

-- PostgREST must see the new function at commit.
NOTIFY pgrst, 'reload schema';
-- <<< 119 BODY END
COMMIT;
