-- =====================================================================
-- 120. THE VENDOR COPY SCRUB (RFP record step C; closes live leak #8).
--
-- AUTHORED 2026-10-15 on feat/rfp-record-c (unattended run). NOT APPLIED. NOT RUN: there is no
-- Postgres and no credentials in the authoring session. The pre-apply test
-- (120_preapply_test.sql) is also the parse check. OWNER-RUN, in the Supabase SQL Editor.
--
-- WHAT IT CLOSES. Every partner_rfp_inbox row is a vendor's copy of one line of an agency's RFP, and
-- the vendor reads its own row whole with its own login. Until step C the copy (master_rfp_json)
-- was the agency's whole wizard object: the client name (client), the programme budget
-- (totalBudget), every scope line with its budget (scopeItems), the scoring rubric
-- (evaluation_criteria), reference materials, and on Lightning rows the vendor's bearer token
-- (_magic_token). Step C (code, deployed BEFORE this file) writes allow-listed copies only and no
-- vendor or guest reader uses the removed keys; this file removes them from every existing copy
-- and refuses them on every future write.
--
-- WHAT IT DOES
--   1. Two allow-list functions, ONE COPY OF EACH LIST (lib/rfp-vendor-copy.ts holds the same lists;
--      the pre-apply test checks they match):
--        public.rfp_vendor_copy_keys()               partner_rfp_inbox.master_rfp_json top-level keys
--          projectName, overview, objectives, timeline, business_criteria_required,
--          budget_categories, nda_link, response_deadline
--        public.rfp_token_reference_materials_keys() rfp_magic_tokens.reference_materials keys
--          materials   (output_template_config is agency-only and lives on the RFP record, D9)
--   2. THE SCRUB. Every inbox row's master_rfp_json is rewritten to its allow-listed keys only (this
--      removes _magic_token, D8), and every token's reference_materials object to its materials only.
--      NO OTHER COLUMN IS TOUCHED: not estimated_budget, not client_name_released, not scope_item_id,
--      not the token's whole-value JSON columns (business_criteria_required, budget_categories,
--      evaluation_criteria), which are agency-only by RLS and reach a guest only through the guest
--      API's explicit view. A bare-array reference_materials (the legacy materials list) is left as
--      it is. The unlinked row 119 refused (inbox 04391718, whose token row no longer exists) is
--      scrubbed too and named in the final NOTICE.
--   3. THE GUARD. BEFORE INSERT OR UPDATE triggers on partner_rfp_inbox and rfp_magic_tokens raise
--      23514 when the JSON (on insert, or when it changes) carries a key outside its allow-list, or
--      when master_rfp_json is neither NULL nor an object. FOR EVERY ROLE: the service role and this
--      SQL Editor role included. SECURITY INVOKER, search_path pinned.
--   No policy and no grant on any existing object changes. No table or column is added.
--
-- THE PRE-FLIGHT (LG120, fail-closed, inside the transaction; nothing is written when it refuses):
--   * 118's trusted path: no end-user session (the SQL Editor role). 118's link-column guard admits
--     the scrub's writes there and only there; never weaken a guard to make this pass.
--   * 118's four guards present and enabled; 119 has run (rfp_record_set_client_visibility exists
--     and backfilled records exist).
--   * No linked inbox row or token points at a missing record line.
--   * No inbox row's master_rfp_json is anything but NULL or an object.
--   * NO DATA LOSS ON A LINKED ROW: every key the scrub removes from a linked row, with a non-empty
--     value, is held by its record: in rfp_records.master_rfp under the same key, or in the record's
--     own column (evaluation_criteria, client_name_snapshot for client, total_budget for
--     totalBudget, its lines for scopeItems). _magic_token is held when its token row is reachable
--     through rfp_magic_tokens.attached_inbox_id or the same line, or no longer exists. The same for
--     a linked token's reference_materials (output_template_config -> rfp_records.output_template_config).
--     Exceptions are listed in the error.
--   * NO LOST JOIN: an inbox row whose _magic_token names a token that still exists but cannot be
--     reached through the link columns is refused (the marker would be its only join).
--   * UNLINKED ROWS: only inbox 04391718-bf70-4d63-a0d6-ea773003b6cc (refused by 119; its token row
--     no longer exists) may lose a non-empty key. Any other unlinked row or token that would is
--     refused and listed.
--
-- IDEMPOTENCY: a second run changes nothing and says so. The functions and triggers are CREATE OR
-- REPLACE with identical bodies, the scrub only touches rows that carry a removed key (none after the
-- first run), and the final NOTICE reads "120 already applied: nothing changed".
--
-- THE RESULT: a final RAISE NOTICE with the counts and lists, and the same as JSON in the
-- transaction-local setting ligament.scrub_120 (the pre-apply test reads it). The Supabase SQL Editor
-- may show only "Success. No rows returned"; V1 to V5 below reproduce it from the tables.
--
-- DOWN: 120_rfp_vendor_copy_scrub_down.sql drops the guard (triggers and the four functions) ONLY.
-- THE SCRUBBED JSON CANNOT BE RESTORED FROM IT. The agency's RFP records (118/119) hold the truth.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--   [ ] The step C code (feat/rfp-record-c) is DEPLOYED. Before it, the broadcast and attach writers
--       still write the removed keys and this file's guard would make every send fail.
--   [ ] supabase/sql-checks/120-key-inventory.sql has been run and read: every REMOVE key is one no
--       vendor screen needs; C1, C2, C3 and C6 are 0; C4 and C5 are 1 (inbox 04391718).
--   [ ] P1 to P3 below answer as EXPECTED.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 120." (28 assertions; none
--       INCONCLUSIVE by design; S10 is INCONCLUSIVE only if inbox 04391718 no longer exists).
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P3 unchanged).
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Deploy the step C code. Run the key inventory and P1 to P3; record the answers.
--   2. Paste supabase/migrations/120_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 120.". Read its SCRUB lines.
--   3. DRY RUN: replace the final COMMIT; (line number at the foot of this header) with ROLLBACK;
--      and run the file. Prove it rolled back: P3 must answer exactly as in step 1.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V5. Each must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record. Next free: 121.
--   Rollback of the guard: supabase/migrations/120_rfp_vendor_copy_scrub_down.sql.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY.
-- =====================================================================
--
-- P1. 119 IS PRESENT AND 120 IS NOT.
--   SELECT to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)'),
--          (SELECT count(*) FROM public.rfp_records WHERE source = 'backfill'),
--          to_regprocedure('public.rfp_vendor_copy_keys()');
--   EXPECTED: non-null, 43, null.
--
-- P2. WHAT 120 WILL SCRUB.
--   SELECT count(*) AS inbox_rows,
--          count(*) FILTER (WHERE jsonb_typeof(master_rfp_json) = 'object' AND EXISTS (
--            SELECT 1 FROM jsonb_object_keys(master_rfp_json) k
--            WHERE k NOT IN ('projectName','overview','objectives','timeline','business_criteria_required',
--                            'budget_categories','nda_link','response_deadline'))) AS inbox_to_scrub,
--          count(*) FILTER (WHERE rfp_line_id IS NULL) AS inbox_unlinked
--   FROM public.partner_rfp_inbox;
--   EXPECTED: inbox_rows 98 plus any send since 2026-10-14; inbox_unlinked 1.
--
-- P3. A FINGERPRINT TO PROVE THE DRY RUN ROLLED BACK.
--   SELECT md5(string_agg(id::text || coalesce(master_rfp_json::text, ''), ',' ORDER BY id)) FROM public.partner_rfp_inbox;
--   SELECT md5(string_agg(id::text || coalesce(reference_materials::text, ''), ',' ORDER BY id::text)) FROM public.rfp_magic_tokens;
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT.
-- =====================================================================
--
-- V1. NO KEY OUTSIDE THE ALLOW-LISTS. EXPECTED: 0, 0.
--   SELECT (SELECT count(*) FROM public.partner_rfp_inbox i, jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
--            WHERE NOT (k = ANY (public.rfp_vendor_copy_keys()))),
--          (SELECT count(*) FROM public.rfp_magic_tokens t, jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
--            WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys())));
--
-- V2. THE GUARD. EXPECTED: two rows, partner_rfp_inbox_vendor_copy_guard and
--     rfp_magic_tokens_vendor_copy_guard, enabled O, tgtype 23 (BEFORE ROW INSERT OR UPDATE).
--   SELECT c.relname, t.tgname, t.tgenabled::text, t.tgtype FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE NOT t.tgisinternal AND t.tgname LIKE '%vendor_copy_guard' ORDER BY 1;
--
-- V3. THE FUNCTIONS. EXPECTED: four rows; prosecdef f; proconfig {"search_path=public, pg_temp"};
--     the two *_guard functions anon f, authenticated f; the two *_keys functions anon f, authenticated t.
--   SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--     AND p.proname IN ('rfp_vendor_copy_keys', 'rfp_token_reference_materials_keys',
--                       'partner_rfp_inbox_vendor_copy_guard', 'rfp_magic_tokens_vendor_copy_guard')
--   ORDER BY 1;
--
-- V4. POLICIES UNCHANGED. EXPECTED: 161.
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- V5. THE REFUSED ROW, SCRUBBED AND STILL UNLINKED. EXPECTED: one row, rfp_line_id null, keys allow-listed only.
--   SELECT id, rfp_line_id, (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(master_rfp_json) k) AS keys
--   FROM public.partner_rfp_inbox WHERE id = '04391718-bf70-4d63-a0d6-ea773003b6cc';
--
-- BEGIN, COMMIT and body-marker line numbers of the transaction below (BODY START 154, BODY END 539):
-- BEGIN is at line 153 and COMMIT is at line 540. Requires PostgreSQL 14+ (CREATE OR REPLACE TRIGGER).

BEGIN;
-- >>> 120 BODY START
-- ---------------------------------------------------------------------
-- 0. THE ALLOW-LISTS. ONE COPY EACH, used by the pre-flight, the scrub and the guard below.
--    lib/rfp-vendor-copy.ts holds the same lists. Created first so nothing else carries a copy; a
--    pre-flight refusal below aborts the transaction and takes them with it.
--    EXECUTE: not PUBLIC, not anon; authenticated (and the service role) may, because the guard
--    triggers call them as the invoker on every agency and service-role write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rfp_vendor_copy_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT ARRAY['projectName','overview','objectives','timeline','business_criteria_required','budget_categories','nda_link','response_deadline']::text[]
$fn$;

COMMENT ON FUNCTION public.rfp_vendor_copy_keys() IS
  'Migration 120. The top-level keys a vendor copy (partner_rfp_inbox.master_rfp_json) may carry. '
  'The same list as lib/rfp-vendor-copy.ts VENDOR_COPY_KEYS. No client, budget, other line, rubric or _magic_token.';

REVOKE EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() TO service_role;

CREATE OR REPLACE FUNCTION public.rfp_token_reference_materials_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT ARRAY['materials']::text[]
$fn$;

COMMENT ON FUNCTION public.rfp_token_reference_materials_keys() IS
  'Migration 120. The keys rfp_magic_tokens.reference_materials may carry when it is an object. The same list as '
  'lib/rfp-vendor-copy.ts TOKEN_REFERENCE_MATERIALS_KEYS. output_template_config lives on the RFP record (D9).';

REVOKE EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() TO service_role;


-- ---------------------------------------------------------------------
-- 1. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION. Nothing but the two list functions above is
--    written before it, and a refusal aborts the transaction.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  -- The one unlinked row the owner accepted (119 refused it: its token row no longer exists).
  c_expected_unlinked CONSTANT uuid[] := ARRAY['04391718-bf70-4d63-a0d6-ea773003b6cc']::uuid[];
  c_allow       CONSTANT text[] := public.rfp_vendor_copy_keys();
  c_allow_token CONSTANT text[] := public.rfp_token_reference_materials_keys();
  v_list text;
BEGIN
  -- 118's trusted path. Never weaken a guard to make this pass.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '120 refuses to run: it must run with no end-user session (the SQL Editor role), which is 118''s trusted path. auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG120';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('rfp_records', 'rfp_records_guard'),
                                                   ('rfp_record_lines', 'rfp_record_lines_guard'),
                                                   ('partner_rfp_inbox', 'partner_rfp_inbox_link_columns_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_link_columns_guard'))) <> 4 THEN
    RAISE EXCEPTION '120 refuses to run: one of 118''s four guards is missing or not enabled.'
      USING ERRCODE = 'LG120';
  END IF;

  -- 119 has run.
  IF to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.rfp_records WHERE source = 'backfill') THEN
    RAISE EXCEPTION '120 refuses to run: 119 has not run (rfp_record_set_client_visibility is missing, or no backfilled record exists). Apply 119 first.'
      USING ERRCODE = 'LG120';
  END IF;

  -- No linked row or token points at a missing line.
  SELECT string_agg(x, ', ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text AS x FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = i.rfp_line_id)
    UNION ALL
    SELECT 'token row ' || t.id::text FROM public.rfp_magic_tokens t
     WHERE t.rfp_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = t.rfp_line_id)
    LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: linked rows point at a missing RFP record line: %', v_list USING ERRCODE = 'LG120';
  END IF;

  -- Every vendor copy is NULL or an object.
  SELECT string_agg(i.id::text || ' (' || jsonb_typeof(i.master_rfp_json) || ')', ', ') INTO v_list
    FROM (SELECT * FROM public.partner_rfp_inbox
           WHERE master_rfp_json IS NOT NULL AND jsonb_typeof(master_rfp_json) <> 'object' LIMIT 50) i;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: these inbox rows hold a master_rfp_json that is not an object: %', v_list USING ERRCODE = 'LG120';
  END IF;

  -- NO DATA LOSS ON A LINKED INBOX ROW, AND NO LOST JOIN.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text || ' key ' || e.key AS x
      FROM public.partner_rfp_inbox i
      JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
      JOIN public.rfp_records r ON r.id = l.rfp_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
     WHERE NOT (e.key = ANY (c_allow))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND NOT (
         coalesce((r.master_rfp -> e.key) NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
         OR CASE e.key
              WHEN 'evaluation_criteria' THEN coalesce(r.evaluation_criteria NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
              WHEN 'client'              THEN coalesce(btrim(r.client_name_snapshot) <> '', false)
              WHEN 'totalBudget'         THEN coalesce(btrim(r.total_budget) <> '', false)
              WHEN 'scopeItems'          THEN true
              WHEN '_magic_token'        THEN NOT EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = e.value #>> '{}')
                                              OR EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk
                                                          WHERE tk.token = e.value #>> '{}' AND tk.org_id = i.lead_org_id
                                                            AND (tk.attached_inbox_id = i.id OR tk.rfp_line_id = i.rfp_line_id))
              ELSE false
            END)
     ORDER BY i.id, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: the scrub would remove a value from a linked inbox row that its RFP record does not hold (or the only join to a live token): %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- UNLINKED INBOX ROWS: only the accepted row may lose a non-empty key; no unlinked row may lose
  -- the only join to a token that still exists.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text || ' key ' || e.key AS x
      FROM public.partner_rfp_inbox i
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
     WHERE i.rfp_line_id IS NULL
       AND NOT (e.key = ANY (c_allow))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND (NOT (i.id = ANY (c_expected_unlinked))
            OR (e.key = '_magic_token' AND EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = e.value #>> '{}')))
     ORDER BY i.id, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: an unlinked inbox row other than 04391718 would lose a value no RFP record holds (or the only join to a live token): %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- TOKENS: a removed reference_materials key with a non-empty value must be held by the record.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'token row ' || t.id::text || ' key ' || e.key AS x
      FROM public.rfp_magic_tokens t
      LEFT JOIN public.rfp_record_lines l ON l.id = t.rfp_line_id
      LEFT JOIN public.rfp_records r ON r.id = l.rfp_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) AS e(key, value)
     WHERE NOT (e.key = ANY (c_allow_token))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND NOT (r.id IS NOT NULL
                AND (coalesce((r.master_rfp -> e.key) NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
                     OR (e.key = 'output_template_config'
                         AND coalesce(r.output_template_config NOT IN ('null'::jsonb, '{}'::jsonb), false))))
     ORDER BY t.id::text, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: the scrub would remove a token reference_materials value its RFP record does not hold: %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- Captured for the post-check and the result.
  -- A previous run is recognised by its guard trigger (created last, section 3).
  PERFORM set_config('ligament.m120_present',
                     CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                                        WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
                                          AND c.relname = 'partner_rfp_inbox' AND t.tgname = 'partner_rfp_inbox_vendor_copy_guard')
                          THEN '1' ELSE '0' END, true);
  PERFORM set_config('ligament.m120_counts',
                     (SELECT count(*) FROM public.partner_rfp_inbox)::text || ',' || (SELECT count(*) FROM public.rfp_magic_tokens)::text, true);
END
$preflight$;


-- ---------------------------------------------------------------------
-- 2. THE SCRUB. The JSON columns only; rows carrying no removed key are not written.
-- ---------------------------------------------------------------------
DO $scrub$
DECLARE
  v_inbox_scrubbed  bigint;
  v_inbox_linked    bigint;
  v_inbox_unlinked  bigint;
  v_tokens_scrubbed bigint;
  v_keys            jsonb;
  v_unlinked        jsonb;
  v_present         boolean := current_setting('ligament.m120_present', true) = '1';
BEGIN
  -- What is about to go, by key, for the record (inbox and tokens).
  SELECT coalesce(jsonb_object_agg(x.key, x.n), '{}'::jsonb) INTO v_keys FROM (
    SELECT 'inbox.' || k AS key, count(*) AS n
      FROM public.partner_rfp_inbox i,
           jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
     WHERE NOT (k = ANY (public.rfp_vendor_copy_keys()))
     GROUP BY k
    UNION ALL
    SELECT 'token.reference_materials.' || k, count(*)
      FROM public.rfp_magic_tokens t,
           jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
     WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys()))
     GROUP BY k) x;

  SELECT coalesce(jsonb_agg(i.id::text ORDER BY i.id), '[]'::jsonb) INTO v_unlinked
    FROM public.partner_rfp_inbox i
   WHERE i.rfp_line_id IS NULL
     AND jsonb_typeof(i.master_rfp_json) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())));

  WITH s AS (
    UPDATE public.partner_rfp_inbox i
       SET master_rfp_json = (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                FROM jsonb_each(i.master_rfp_json) AS e(key, value)
                               WHERE e.key = ANY (public.rfp_vendor_copy_keys()))
     WHERE jsonb_typeof(i.master_rfp_json) = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())))
    RETURNING i.rfp_line_id
  )
  SELECT count(*), count(*) FILTER (WHERE rfp_line_id IS NOT NULL), count(*) FILTER (WHERE rfp_line_id IS NULL)
    INTO v_inbox_scrubbed, v_inbox_linked, v_inbox_unlinked
    FROM s;

  WITH s AS (
    UPDATE public.rfp_magic_tokens t
       SET reference_materials = (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                    FROM jsonb_each(t.reference_materials) AS e(key, value)
                                   WHERE e.key = ANY (public.rfp_token_reference_materials_keys()))
     WHERE jsonb_typeof(t.reference_materials) = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_object_keys(t.reference_materials) k WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys())))
    RETURNING 1
  )
  SELECT count(*) INTO v_tokens_scrubbed FROM s;

  PERFORM set_config('ligament.scrub_120', jsonb_build_object(
    'already_applied',        v_present AND v_inbox_scrubbed = 0 AND v_tokens_scrubbed = 0,
    'inbox_scrubbed',         v_inbox_scrubbed,
    'inbox_scrubbed_linked',  v_inbox_linked,
    'inbox_scrubbed_unlinked', v_inbox_unlinked,
    'unlinked_scrubbed_ids',  v_unlinked,
    'tokens_scrubbed',        v_tokens_scrubbed,
    'removed_keys',           v_keys)::text, true);
END
$scrub$;


-- ---------------------------------------------------------------------
-- 3. THE GUARD. For every role. A key outside the allow-list, or a vendor copy that is not an
--    object, raises 23514. Checked on insert, and on update only when the JSON column changes
--    (every existing row is compliant after the scrub above).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rfp_inbox_vendor_copy_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bad text;
BEGIN
  IF NEW.master_rfp_json IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.master_rfp_json IS NOT DISTINCT FROM OLD.master_rfp_json THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.master_rfp_json) <> 'object' THEN
    RAISE EXCEPTION 'A vendor copy must be a JSON object.'
      USING ERRCODE = '23514',
            DETAIL  = 'partner_rfp_inbox.master_rfp_json must be NULL or an object of allow-listed keys (migration 120).';
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(NEW.master_rfp_json) k
   WHERE NOT (k = ANY (public.rfp_vendor_copy_keys()));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A vendor copy may not carry %.', v_bad
      USING ERRCODE = '23514',
            DETAIL  = 'partner_rfp_inbox.master_rfp_json may hold only public.rfp_vendor_copy_keys() (migration 120; lib/rfp-vendor-copy.ts). The client name and budget go in client_name_released and estimated_budget; the rest of the RFP is on the agency''s record.';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() IS
  'Migration 120. BEFORE INSERT OR UPDATE on partner_rfp_inbox, every role: master_rfp_json must be NULL or an '
  'object whose keys are all in rfp_vendor_copy_keys() (23514). Checked on insert and when the column changes.';

REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM authenticated;

CREATE OR REPLACE TRIGGER partner_rfp_inbox_vendor_copy_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_inbox_vendor_copy_guard();

CREATE OR REPLACE FUNCTION public.rfp_magic_tokens_vendor_copy_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bad text;
BEGIN
  IF NEW.reference_materials IS NULL OR jsonb_typeof(NEW.reference_materials) <> 'object' THEN
    -- NULL, or the legacy bare array of materials: nothing agency-only can hide in it by key.
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.reference_materials IS NOT DISTINCT FROM OLD.reference_materials THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(NEW.reference_materials) k
   WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys()));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A Lightning RFP invitation''s reference materials may not carry %.', v_bad
      USING ERRCODE = '23514',
            DETAIL  = 'rfp_magic_tokens.reference_materials may hold only public.rfp_token_reference_materials_keys() (migration 120). The output template lives on the RFP record (D9).';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() IS
  'Migration 120. BEFORE INSERT OR UPDATE on rfp_magic_tokens, every role: an object reference_materials may '
  'carry only rfp_token_reference_materials_keys() (23514). Checked on insert and when the column changes.';

REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM authenticated;

CREATE OR REPLACE TRIGGER rfp_magic_tokens_vendor_copy_guard
  BEFORE INSERT OR UPDATE ON public.rfp_magic_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_magic_tokens_vendor_copy_guard();


-- ---------------------------------------------------------------------
-- 4. POST-CHECK AND RESULT. Any shortfall aborts the file: nothing is committed.
-- ---------------------------------------------------------------------
DO $post$
DECLARE
  v_res     jsonb := current_setting('ligament.scrub_120', true)::jsonb;
  v_counts  text := current_setting('ligament.m120_counts', true);
  v_left    bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.partner_rfp_inbox i,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())))
       + (SELECT count(*) FROM public.rfp_magic_tokens t,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys())))
    INTO v_left;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '120 stopped: % key(s) outside the allow-lists remain after the scrub. Nothing was committed.', v_left
      USING ERRCODE = 'LG120';
  END IF;

  IF v_counts IS DISTINCT FROM ((SELECT count(*) FROM public.partner_rfp_inbox)::text || ',' || (SELECT count(*) FROM public.rfp_magic_tokens)::text) THEN
    RAISE EXCEPTION '120 stopped: the inbox or token row count changed during the scrub (before %). Nothing was committed.', v_counts
      USING ERRCODE = 'LG120';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('partner_rfp_inbox', 'partner_rfp_inbox_vendor_copy_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_vendor_copy_guard'))) <> 2 THEN
    RAISE EXCEPTION '120 stopped: a vendor-copy guard trigger is missing or not enabled. Nothing was committed.'
      USING ERRCODE = 'LG120';
  END IF;

  IF (v_res ->> 'already_applied')::boolean THEN
    RAISE NOTICE '120 already applied: nothing changed (0 inbox rows and 0 tokens scrubbed; the allow-lists and guards are unchanged).';
  ELSE
    RAISE NOTICE E'120 SCRUB DONE.\n  inbox rows scrubbed: % (linked %, unlinked %)\n  unlinked rows scrubbed (no RFP record holds their removed keys): %\n  tokens scrubbed (reference_materials): %\n  removed keys (rows carrying each): %\n  rows in partner_rfp_inbox and rfp_magic_tokens: % (unchanged)',
      v_res ->> 'inbox_scrubbed', v_res ->> 'inbox_scrubbed_linked', v_res ->> 'inbox_scrubbed_unlinked',
      v_res -> 'unlinked_scrubbed_ids', v_res ->> 'tokens_scrubbed', v_res -> 'removed_keys', v_counts;
  END IF;
END
$post$;
-- <<< 120 BODY END
COMMIT;
