-- =====================================================================
-- scripts/sql/audit-live.sql
-- LIVE POLICY AND PRIVILEGE AUDIT. ONE READ-ONLY QUERY. AUTHORED 2026-10-09.
--
-- PURPOSE
--   Read the live catalog and return one row per finding, columns
--   (section, object, finding, detail, severity), covering:
--     0  meta     who ran it, server version, whether the session bypasses RLS
--     A1 tables   every public table: RLS on/off, FORCE, policy count, and the
--                 privileges anon and authenticated hold, flagging TRUNCATE,
--                 DELETE, REFERENCES and TRIGGER
--     A2 views    every public view / materialized view: security_invoker and
--                 anon/authenticated SELECT (a definer view bypasses RLS)
--     B  policies every SELECT or ALL policy whose USING expression admits a
--                 counterparty (vendor_org_id, partner_id, the counterparty
--                 helper functions, ...) or is open (true / no USING), with the
--                 table's full column list so whole-row exposure can be judged
--     C  secdef   every SECURITY DEFINER function in public: search_path pin,
--                 EXECUTE by anon / authenticated / PUBLIC
--     D1/D2       existence probes settling the "unverified" status of
--                 migrations 071, 074, 075, 076, 077, 078
--     E1/E2       the guards from 106, 108, 110, 112 (and the private-table
--                 guards of 105, 107, 109, 111 they depend on): exist, enabled,
--                 BEFORE INSERT OR UPDATE FOR EACH ROW, not SECURITY DEFINER,
--                 search_path pinned, EXECUTE revoked; plus a count of non-null
--                 values left in each nulled legacy column group
--   Section-by-section explanation, probe sources (migration file:line) and
--   what each result means: docs/live-audit-2026-10-09.md.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. It is a single statement. Export the result grid as CSV if you want to
--   keep it. Run it as the default SQL Editor role (postgres); the 0 meta row
--   records which role ran it.
--
-- READ-ONLY
--   SELECT only (CTEs). No INSERT/UPDATE/DELETE, no DDL, no temp tables, no DO
--   blocks, no functions created. Section E2 counts rows in four legacy column
--   groups through query_to_xml(), which runs a SELECT count(*) and nothing
--   else; each count is skipped (NULL) if its columns no longer exist.
--
-- NOT PARSE-CHECKED
--   No SQL parser or database was available when this was written (no psql, no
--   node_modules, no database access). It was written against PostgreSQL 15
--   syntax and read, not executed. YOUR SQL EDITOR RUN IS THE PARSE CHECK. If it
--   errors, the error names the line; nothing is written either way.
--
-- SUPERSEDES scripts/audit-policy-snapshot.mjs FOR LIVE CHECKS
--   That script reads docs/schema-snapshot-2026-08-13.md, a frozen pg_policies
--   dump, and cannot see any table, policy or grant created after 2026-08-13
--   (including everything from 079 onward). It is kept unchanged as history and
--   for its offline --guard mode. For the live state, run this file.
--
-- KNOWN LIMITS
--   * Postgres has no per-column RLS, and vendor and agency users are both
--     `authenticated`. A SELECT policy that admits the vendor exposes every
--     column authenticated holds table-level SELECT on. Section B therefore
--     prints the whole column list; it cannot tell you which columns a vendor
--     SHOULD see. That judgment is the owner's.
--   * Section B is a text match on the policy expression. It over-matches
--     (e.g. an agency policy that joins partnerships) rather than under-matches.
--     Severity REVIEW means "read it", not "broken".
--   * Only one lead organization has members, so cross-agency isolation cannot
--     be observed from data. Nothing here depends on row data except E2.
-- =====================================================================
WITH
cfg AS (
  SELECT
    -- Counterparty markers in a policy's USING text. Helper names are the ones the
    -- migrations create: 079 (current_user_counterparty_org_ids,
    -- current_user_visible_profile_ids, current_user_active_counterparty_user_ids),
    -- 085 (current_user_commercial_counterparty_org_ids), 096
    -- (current_user_commercial_counterparty_user_ids), 080 (vendor_visible_event_types),
    -- 089 (current_user_email, used by invitation-by-email policies).
    '(vendor_org_id|partner_org_id|partner_id|vendor_id|partner_user_id|current_user_counterparty_org_ids|current_user_commercial_counterparty_org_ids|current_user_commercial_counterparty_user_ids|current_user_active_counterparty_user_ids|current_user_visible_profile_ids|vendor_visible_event_types|current_user_email|partner_rfp_inbox|partnerships|\mpartner\M)'::text AS cp_re,
    -- Column names that look agency-private. A heuristic for severity only.
    '(note|summary|score|feedback|internal|private|margin|blacklist|rating|variance|would_work_again|^ai_)'::text AS sens_re
),
nulled_legacy (tbl, col, mig) AS (
  VALUES
    ('partnerships',          'partnership_notes',                '106'),
    ('partnerships',          'reliability_summary',              '108'),
    ('partnerships',          'reliability_summary_generated_at', '108'),
    ('partner_rfp_responses', 'composite_score',                  '110'),
    ('partner_rfp_responses', 'ai_summary_short',                 '110'),
    ('partner_rfp_responses', 'ai_summary_detailed',              '110'),
    ('partner_rfp_responses', 'ai_summary_generated_at',          '110'),
    ('delivery_reviews',      'on_time_notes',                    '112'),
    ('delivery_reviews',      'on_budget_notes',                  '112'),
    ('delivery_reviews',      'client_feedback',                  '112'),
    ('delivery_reviews',      'ai_delta_summary',                 '112'),
    ('delivery_reviews',      'would_work_again',                 '112'),
    ('delivery_reviews',      'budget_variance_pct',              '112')
),
pubcols AS (
  SELECT c.oid AS relid,
         c.relname::text AS tbl,
         a.attnum,
         a.attname::text AS col,
         a.attnotnull,
         format_type(a.atttypid, a.atttypmod)::text AS typ
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
),

-- ---------------------------------------------------------------------
-- 0 meta
-- ---------------------------------------------------------------------
sec0 AS (
  SELECT '0 meta'::text AS section,
         current_user::text AS object,
         'session and server context'::text AS finding,
         format('server_version=%s; rolsuper=%s; rolbypassrls=%s; anon_role_exists=%s; authenticated_role_exists=%s; run_at=%s',
                current_setting('server_version'),
                r.rolsuper::text,
                r.rolbypassrls::text,
                (EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = 'anon'))::text,
                (EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = 'authenticated'))::text,
                now()::text)::text AS detail,
         'INFO'::text AS severity
  FROM pg_roles r
  WHERE r.rolname = current_user
),

-- ---------------------------------------------------------------------
-- A1 tables / A2 views
-- ---------------------------------------------------------------------
relp AS (
  SELECT c.oid AS relid,
         c.relname::text AS tbl,
         c.relkind::text AS kind,
         c.relrowsecurity AS rls,
         c.relforcerowsecurity AS force_rls,
         c.reloptions,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS npol,
         has_table_privilege('anon', c.oid, 'SELECT')     AS a_sel,
         has_table_privilege('anon', c.oid, 'INSERT')     AS a_ins,
         has_table_privilege('anon', c.oid, 'UPDATE')     AS a_upd,
         has_table_privilege('anon', c.oid, 'DELETE')     AS a_del,
         has_table_privilege('anon', c.oid, 'TRUNCATE')   AS a_trn,
         has_table_privilege('anon', c.oid, 'REFERENCES') AS a_ref,
         has_table_privilege('anon', c.oid, 'TRIGGER')    AS a_trg,
         has_table_privilege('authenticated', c.oid, 'SELECT')     AS u_sel,
         has_table_privilege('authenticated', c.oid, 'INSERT')     AS u_ins,
         has_table_privilege('authenticated', c.oid, 'UPDATE')     AS u_upd,
         has_table_privilege('authenticated', c.oid, 'DELETE')     AS u_del,
         has_table_privilege('authenticated', c.oid, 'TRUNCATE')   AS u_trn,
         has_table_privilege('authenticated', c.oid, 'REFERENCES') AS u_ref,
         has_table_privilege('authenticated', c.oid, 'TRIGGER')    AS u_trg
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
),
relt AS (
  SELECT r.*,
         coalesce(nullif(concat_ws(',',
           CASE WHEN r.a_sel THEN 'SELECT' END, CASE WHEN r.a_ins THEN 'INSERT' END,
           CASE WHEN r.a_upd THEN 'UPDATE' END, CASE WHEN r.a_del THEN 'DELETE' END,
           CASE WHEN r.a_trn THEN 'TRUNCATE' END, CASE WHEN r.a_ref THEN 'REFERENCES' END,
           CASE WHEN r.a_trg THEN 'TRIGGER' END), ''), 'none') AS anon_privs,
         coalesce(nullif(concat_ws(',',
           CASE WHEN r.u_sel THEN 'SELECT' END, CASE WHEN r.u_ins THEN 'INSERT' END,
           CASE WHEN r.u_upd THEN 'UPDATE' END, CASE WHEN r.u_del THEN 'DELETE' END,
           CASE WHEN r.u_trn THEN 'TRUNCATE' END, CASE WHEN r.u_ref THEN 'REFERENCES' END,
           CASE WHEN r.u_trg THEN 'TRIGGER' END), ''), 'none') AS auth_privs,
         coalesce(nullif(concat_ws(',',
           CASE WHEN r.a_trn THEN 'TRUNCATE' END, CASE WHEN r.a_del THEN 'DELETE' END,
           CASE WHEN r.a_ref THEN 'REFERENCES' END, CASE WHEN r.a_trg THEN 'TRIGGER' END), ''), 'none') AS anon_flag,
         coalesce(nullif(concat_ws(',',
           CASE WHEN r.u_trn THEN 'TRUNCATE' END, CASE WHEN r.u_del THEN 'DELETE' END,
           CASE WHEN r.u_ref THEN 'REFERENCES' END, CASE WHEN r.u_trg THEN 'TRIGGER' END), ''), 'none') AS auth_flag,
         EXISTS (SELECT 1 FROM unnest(coalesce(r.reloptions, '{}'::text[])) AS o(opt)
                 WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on',
                                        'security_invoker=1', 'security_invoker=yes')) AS invoker
  FROM relp r
),
secA1 AS (
  SELECT 'A1 tables'::text AS section,
         ('public.' || t.tbl)::text AS object,
         format('rls=%s force_rls=%s policies=%s%s',
                CASE WHEN t.rls THEN 'ON' ELSE 'OFF' END,
                CASE WHEN t.force_rls THEN 'ON' ELSE 'OFF' END,
                t.npol::text,
                CASE WHEN t.rls AND t.npol = 0 THEN ' (deny-all to non-owners)' ELSE '' END)::text AS finding,
         format('anon holds [%s]; authenticated holds [%s]; flagged TRUNCATE/DELETE/REFERENCES/TRIGGER: anon [%s], authenticated [%s]',
                t.anon_privs, t.auth_privs, t.anon_flag, t.auth_flag)::text AS detail,
         (CASE
            WHEN NOT t.rls AND (t.a_sel OR t.a_ins OR t.a_upd OR t.a_del
                                OR t.u_sel OR t.u_ins OR t.u_upd OR t.u_del) THEN 'CRITICAL'
            WHEN t.a_trn OR t.u_trn THEN 'HIGH'
            WHEN t.a_ref OR t.a_trg OR t.u_ref OR t.u_trg THEN 'MEDIUM'
            WHEN t.a_del OR t.u_del THEN 'LOW'
            WHEN t.rls AND t.npol = 0 THEN 'INFO'
            ELSE 'OK'
          END)::text AS severity
  FROM relt t
  WHERE t.kind IN ('r', 'p')
),
secA2 AS (
  SELECT 'A2 views'::text AS section,
         ('public.' || t.tbl)::text AS object,
         format('%s; security_invoker=%s',
                CASE t.kind WHEN 'v' THEN 'view' ELSE 'materialized view (no RLS possible)' END,
                CASE WHEN t.kind = 'm' THEN 'n/a' WHEN t.invoker THEN 'on' ELSE 'OFF (runs as view owner)' END)::text AS finding,
         format('owner=%s; anon holds [%s]; authenticated holds [%s]',
                pg_get_userbyid((SELECT c.relowner FROM pg_class c WHERE c.oid = t.relid))::text,
                t.anon_privs, t.auth_privs)::text AS detail,
         (CASE
            WHEN (t.a_sel OR t.u_sel) AND (t.kind = 'm' OR NOT t.invoker) THEN 'HIGH'
            ELSE 'OK'
          END)::text AS severity
  FROM relt t
  WHERE t.kind IN ('v', 'm')
),

-- ---------------------------------------------------------------------
-- B counterparty-admitting SELECT / ALL policies
-- ---------------------------------------------------------------------
polc AS (
  SELECT pp.tablename::text  AS tbl,
         pp.policyname::text AS pol,
         pp.cmd::text        AS cmd,
         pp.permissive::text AS permissive,
         array_to_string(pp.roles, ',')::text AS roles,
         pp.qual::text       AS qual,
         c.oid               AS relid
  FROM pg_policies pp
  JOIN pg_namespace n ON n.nspname = pp.schemaname
  JOIN pg_class c     ON c.relnamespace = n.oid AND c.relname = pp.tablename
  WHERE pp.schemaname = 'public'
    AND pp.cmd IN ('SELECT', 'ALL')
),
polm AS (
  SELECT pc.*,
         (SELECT string_agg(DISTINCT lower(rm.arr[1]), ',')
            FROM regexp_matches(coalesce(pc.qual, ''), cfg.cp_re, 'gi') AS rm(arr)) AS tokens,
         coalesce(pc.qual ~* cfg.cp_re, false) AS cp_hit,
         (pc.qual IS NULL OR lower(btrim(pc.qual)) IN ('true', '(true)')) AS open_qual,
         (SELECT string_agg(x.col, ', ' ORDER BY x.attnum) FROM pubcols x WHERE x.relid = pc.relid) AS collist,
         (SELECT string_agg(x.col, ', ' ORDER BY x.attnum) FROM pubcols x
           WHERE x.relid = pc.relid
             AND x.col ~* cfg.sens_re
             AND NOT EXISTS (SELECT 1 FROM nulled_legacy nl WHERE nl.tbl = x.tbl AND nl.col = x.col)) AS sens_cols,
         (SELECT string_agg(x.col || ' (' || nl.mig || ')', ', ' ORDER BY x.attnum) FROM pubcols x
            JOIN nulled_legacy nl ON nl.tbl = x.tbl AND nl.col = x.col
           WHERE x.relid = pc.relid) AS legacy_cols,
         has_table_privilege('authenticated', pc.relid, 'SELECT') AS auth_tbl_sel,
         has_table_privilege('anon', pc.relid, 'SELECT') AS anon_tbl_sel
  FROM polc pc
  CROSS JOIN cfg
),
secB AS (
  SELECT 'B counterparty SELECT policies'::text AS section,
         ('public.' || m.tbl || ' / "' || m.pol || '"')::text AS object,
         format('%s %s policy for roles {%s}; %s',
                m.permissive, m.cmd, m.roles,
                CASE WHEN m.open_qual THEN 'OPEN: USING is true or absent'
                     ELSE 'counterparty markers: ' || coalesce(m.tokens, 'none') END)::text AS finding,
         format('USING: %s || table-level SELECT held: authenticated=%s anon=%s || agency-private-looking columns: %s || nulled legacy columns: %s || all columns: %s',
                coalesce(m.qual, '(none)'),
                m.auth_tbl_sel::text, m.anon_tbl_sel::text,
                coalesce(m.sens_cols, 'none'),
                coalesce(m.legacy_cols, 'none'),
                coalesce(m.collist, '(none)'))::text AS detail,
         (CASE
            WHEN m.permissive = 'RESTRICTIVE' THEN 'INFO'
            WHEN m.open_qual AND m.roles ~ '(^|,)(anon|public)(,|$)' THEN 'HIGH'
            WHEN m.open_qual THEN 'MEDIUM'
            WHEN m.sens_cols IS NOT NULL AND m.auth_tbl_sel THEN 'HIGH'
            ELSE 'REVIEW'
          END)::text AS severity
  FROM polm m
  WHERE m.cp_hit OR m.open_qual
),

-- ---------------------------------------------------------------------
-- C SECURITY DEFINER functions in public
-- ---------------------------------------------------------------------
secdef AS (
  SELECT p.oid,
         p.oid::regprocedure::text AS sig,
         p.proconfig,
         pg_get_userbyid(p.proowner)::text AS owner,
         (p.prorettype = 'trigger'::regtype) AS is_trigger,
         EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS u(v)
                 WHERE u.v LIKE 'search_path=%') AS pinned,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS ae
                 WHERE ae.grantee = 0 AND ae.privilege_type = 'EXECUTE') AS public_x,
         EXISTS (SELECT 1 FROM pg_depend d
                 WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') AS ext_member
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prokind IN ('f', 'p')
),
secC AS (
  SELECT 'C security definer functions'::text AS section,
         s.sig::text AS object,
         coalesce(nullif(concat_ws('; ',
           CASE WHEN NOT s.pinned THEN 'search_path NOT pinned' END,
           CASE WHEN s.anon_x THEN 'EXECUTE by anon' END,
           CASE WHEN s.public_x THEN 'EXECUTE by PUBLIC' END), ''), 'pinned; not executable by anon or PUBLIC')::text AS finding,
         format('proconfig=%s; EXECUTE anon=%s authenticated=%s PUBLIC=%s; trigger_function=%s; owner=%s; extension_member=%s',
                coalesce(array_to_string(s.proconfig, ','), 'NULL'),
                s.anon_x::text, s.auth_x::text, s.public_x::text,
                s.is_trigger::text, s.owner, s.ext_member::text)::text AS detail,
         (CASE
            WHEN NOT s.pinned THEN 'HIGH'
            WHEN (s.anon_x OR s.public_x) AND NOT s.is_trigger THEN 'MEDIUM'
            WHEN (s.anon_x OR s.public_x) AND s.is_trigger THEN 'LOW'
            ELSE 'OK'
          END)::text AS severity
  FROM secdef s
),

-- ---------------------------------------------------------------------
-- D migration probes: 071, 074, 075, 076, 077, 078
-- ---------------------------------------------------------------------
probe_spec (mig, kind, tbl, name, src) AS (
  VALUES
    ('071', 'column',          'partner_rfp_responses',    'business_criteria_acknowledgments',            '071_requirement_tiers.sql:34-35'),
    ('074', 'column',          'rfp_magic_tokens',         'response_deadline',                            '074_magic_token_response_deadline.sql:14-15'),
    ('075', 'column',          'rfp_magic_tokens',         'evaluation_criteria',                          '075_rfp_evaluation_criteria.sql:45-46'),
    ('075', 'column_nullable', 'bid_evaluation_scores',    'criterion_id',                                 '075_rfp_evaluation_criteria.sql:63-64'),
    ('075', 'column',          'bid_evaluation_scores',    'rfp_criterion_key',                            '075_rfp_evaluation_criteria.sql:66-67'),
    ('075', 'column',          'bid_evaluation_scores',    'criterion_name_snapshot',                      '075_rfp_evaluation_criteria.sql:72-73'),
    ('075', 'constraint',      'bid_evaluation_scores',    'bid_evaluation_scores_exactly_one_criterion',  '075_rfp_evaluation_criteria.sql:77-89'),
    ('075', 'index',           'bid_evaluation_scores',    'bid_evaluation_scores_one_per_rfp_criterion',  '075_rfp_evaluation_criteria.sql:94-96'),
    ('076', 'column',          'partner_rfp_responses',    'proposal_sections',                            '076_structured_proposal_and_bid_close.sql:37-38'),
    ('076', 'column',          'partner_rfp_inbox',        'close_bidding_at_deadline',                    '076_structured_proposal_and_bid_close.sql:56-57'),
    ('076', 'column',          'rfp_magic_tokens',         'close_bidding_at_deadline',                    '076_structured_proposal_and_bid_close.sql:59-60'),
    ('077', 'table',           'clients',                  'clients',                                      '077_client_profiles.sql:36-55'),
    ('077', 'index',           'clients',                  'clients_agency_id_idx',                        '077_client_profiles.sql:57'),
    ('077', 'index',           'clients',                  'clients_agency_lower_name_idx',                '077_client_profiles.sql:64'),
    ('077', 'column',          'agency_library_documents', 'client_id',                                    '077_client_profiles.sql:93-94'),
    ('077', 'index',           'agency_library_documents', 'agency_library_documents_client_id_idx',       '077_client_profiles.sql:96-98'),
    ('077', 'column',          'projects',                 'client_id',                                    '077_client_profiles.sql:111-112'),
    ('077', 'index',           'projects',                 'projects_client_id_idx',                       '077_client_profiles.sql:114'),
    ('078', 'fn_search_path_pinned', 'handle_new_user',    'search_path',                                  '078_signup_role_trigger.sql:140'),
    ('078', 'fn_body_contains','handle_new_user',          'raw_user_meta_data->>''role''',                '078_signup_role_trigger.sql:149-152'),
    ('078', 'fn_body_contains','handle_new_user',          'other_role',                                   '078_signup_role_trigger.sql:154'),
    ('078', 'fn_body_lacks',   'handle_new_user',          'greg@withligament.com',                        '078_signup_role_trigger.sql:156-160 (removes 056_default_dual_role_access.sql:26-27)')
),
probe_res AS (
  SELECT s.mig, s.kind, s.tbl, s.name, s.src,
         (CASE s.kind
            WHEN 'column' THEN
              EXISTS (SELECT 1 FROM pubcols pc WHERE pc.tbl = s.tbl AND pc.col = s.name)
            WHEN 'column_nullable' THEN
              EXISTS (SELECT 1 FROM pubcols pc WHERE pc.tbl = s.tbl AND pc.col = s.name AND NOT pc.attnotnull)
            WHEN 'table' THEN
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = s.name AND c.relkind IN ('r', 'p'))
            WHEN 'index' THEN
              EXISTS (SELECT 1 FROM pg_index i
                      JOIN pg_class ic ON ic.oid = i.indexrelid
                      JOIN pg_class tc ON tc.oid = i.indrelid
                      JOIN pg_namespace n ON n.oid = ic.relnamespace
                      WHERE n.nspname = 'public' AND ic.relname = s.name AND tc.relname = s.tbl)
            WHEN 'constraint' THEN
              EXISTS (SELECT 1 FROM pg_constraint k
                      JOIN pg_class c ON c.oid = k.conrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = s.tbl AND k.conname = s.name)
            WHEN 'fn_body_contains' THEN
              EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = s.tbl AND position(s.name IN p.prosrc) > 0)
            WHEN 'fn_body_lacks' THEN
              EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = s.tbl AND position(s.name IN p.prosrc) = 0)
            WHEN 'fn_search_path_pinned' THEN
              EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = s.tbl
                        AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS u(v)
                                    WHERE u.v LIKE 'search_path=%'))
            ELSE false
          END) AS present,
         (CASE WHEN s.kind IN ('column', 'column_nullable') THEN
            (SELECT pc.typ || CASE WHEN pc.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
               FROM pubcols pc WHERE pc.tbl = s.tbl AND pc.col = s.name LIMIT 1)
          END)::text AS observed
  FROM probe_spec s
),
mig_note (mig, note) AS (
  VALUES
    ('071', 'Corroboration: 109_preapply_test.sql:319 selects this column and the 109 pre-apply test ran green.'),
    ('074', 'Reading/writing code keeps its 42703 retry guards either way.'),
    ('075', 'Six objects. "partially applied" means the constraint surgery is half done: read 075 before touching bid_evaluation_scores.'),
    ('076', 'Corroboration for proposal_sections: 109_preapply_test.sql:319 selects it and ran green.'),
    ('077', 'Policy "Agencies manage own clients" is NOT probed: 079 drops and recreates it (079:534, 079:1196). 079 also renames clients.agency_id to org_id (079:652) without IF EXISTS, so 079 being applied already implies 077 was.'),
    ('078', 'SUPERSEDED - DO NOT RUN 078. These probes test 078''s behaviour (role read from metadata, opposite secondary role, pinned search_path, no email literal), which 079 PHASE 12 carries forward. "applied" means the behaviour is live, not which file wrote the body; see the 078 context rows.')
),
secD1 AS (
  SELECT 'D1 migration status'::text AS section,
         (g.mig || ': ' || CASE WHEN g.n_present = g.n_total THEN 'applied'
                                WHEN g.n_present = 0 THEN 'not applied'
                                ELSE 'partially applied' END)::text AS object,
         format('%s of %s probes present', g.n_present::text, g.n_total::text)::text AS finding,
         (g.probes || ' || ' || coalesce(mn.note, ''))::text AS detail,
         (CASE WHEN g.n_present = g.n_total THEN 'INFO'
               WHEN g.n_present = 0 THEN 'MEDIUM'
               ELSE 'HIGH' END)::text AS severity
  FROM (
    SELECT r.mig,
           count(*) FILTER (WHERE r.present) AS n_present,
           count(*) AS n_total,
           string_agg(format('%s %s.%s=%s', r.kind, r.tbl, r.name,
                             CASE WHEN r.present THEN 'present' ELSE 'ABSENT' END), '; ' ORDER BY r.src) AS probes
    FROM probe_res r
    GROUP BY r.mig
  ) g
  LEFT JOIN mig_note mn ON mn.mig = g.mig
),
secD2 AS (
  SELECT 'D2 migration probe detail'::text AS section,
         (r.mig || ' ' || r.kind || ' ' || r.tbl || '.' || r.name)::text AS object,
         (CASE WHEN r.present THEN 'present' ELSE 'ABSENT' END)::text AS finding,
         ('source supabase/migrations/' || r.src || coalesce('; observed ' || r.observed, ''))::text AS detail,
         'INFO'::text AS severity
  FROM probe_res r
  UNION ALL
  SELECT 'D2 migration probe detail'::text,
         '078 context: which body is live'::text,
         (CASE
            WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
                           AND position('org_members' IN p.prosrc) > 0)
              THEN '079 PHASE 12 body is live (it supersedes 078 and carries 078''s behaviour)'
            WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'handle_new_user')
              THEN 'body does NOT create the organization: pre-079 body is live'
            ELSE 'public.handle_new_user does not exist'
          END)::text,
         'probe: position(''org_members'' IN prosrc) > 0; source supabase/migrations/079_organizations.sql:1841-1888'::text,
         (CASE
            WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
                           AND position('org_members' IN p.prosrc) > 0) THEN 'INFO'
            ELSE 'CRITICAL'
          END)::text
  UNION ALL
  SELECT 'D2 migration probe detail'::text,
         '078 context: signup trigger on auth.users'::text,
         coalesce((SELECT string_agg(format('%s tgenabled=%s', t.tgname::text, t.tgenabled::text), '; ')
                     FROM pg_trigger t
                     JOIN pg_proc p ON p.oid = t.tgfoid
                     JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
                      AND NOT t.tgisinternal
                      AND t.tgrelid = to_regclass('auth.users')),
                  'NO trigger on auth.users calls public.handle_new_user')::text,
         'tgenabled O or A = fires; D = disabled; R = replica only. Source supabase/migrations/078_signup_role_trigger.sql:200-206 (verification query 2)'::text,
         (CASE
            WHEN EXISTS (SELECT 1 FROM pg_trigger t
                         JOIN pg_proc p ON p.oid = t.tgfoid
                         JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
                          AND NOT t.tgisinternal
                          AND t.tgrelid = to_regclass('auth.users')
                          AND t.tgenabled IN ('O', 'A')) THEN 'INFO'
            ELSE 'CRITICAL'
          END)::text
),

-- ---------------------------------------------------------------------
-- E guards: 110, 112 (legacy-column write guards), 105/107/109/111
-- (private-table guards the nulling migrations depend on). 106 and 108
-- authored NO guard object (110_partner_rfp_response_private_null.sql:79);
-- their coverage is E2.
-- ---------------------------------------------------------------------
guard_spec (mig, purpose, tbl, trg, fn, src) AS (
  VALUES
    ('110', 'legacy-column write guard',                      'partner_rfp_responses',           'partner_rfp_responses_private_columns_guard', 'partner_rfp_responses_private_columns_guard', '110_partner_rfp_response_private_null.sql:194-230'),
    ('112', 'legacy-column write guard',                      'delivery_reviews',                'delivery_reviews_private_columns_guard',      'delivery_reviews_private_columns_guard',      '112_delivery_review_private_null.sql:148-186'),
    ('105', 'private-table guard (106 depends on 105)',       'partnership_private_notes',       'partnership_private_notes_guard',             'partnership_private_notes_guard',             '105_partnership_private_notes.sql:252-289'),
    ('107', 'private-table guard (108 depends on 107)',       'partnership_private_reliability', 'partnership_private_reliability_guard',       'partnership_private_reliability_guard',       '107_partnership_private_reliability.sql:255-292'),
    ('109', 'private-table guard (110 depends on 109)',       'partner_rfp_response_private',    'partner_rfp_response_private_guard',          'partner_rfp_response_private_guard',          '109_partner_rfp_response_private.sql:276-318'),
    ('111', 'private-table guard (112 depends on 111)',       'delivery_review_private',         'delivery_review_private_guard',               'delivery_review_private_guard',               '111_delivery_review_private.sql:258-299')
),
guard_res AS (
  SELECT g.mig, g.purpose, g.tbl, g.trg, g.fn, g.src,
         c.oid               AS relid,
         t.tgname::text      AS found_trg,
         t.tgenabled::text   AS tgenabled,
         t.tgtype::int       AS tgtype,
         tf.proname::text    AS trg_fn,
         f.oid               AS fn_oid,
         f.prosecdef         AS fn_secdef,
         EXISTS (SELECT 1 FROM unnest(coalesce(f.proconfig, '{}'::text[])) AS u(v)
                 WHERE u.v LIKE 'search_path=%') AS fn_pinned,
         CASE WHEN f.oid IS NOT NULL THEN has_function_privilege('anon', f.oid, 'EXECUTE') END          AS fn_anon_x,
         CASE WHEN f.oid IS NOT NULL THEN has_function_privilege('authenticated', f.oid, 'EXECUTE') END AS fn_auth_x,
         CASE WHEN f.oid IS NOT NULL THEN
           EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) AS ae
                   WHERE ae.grantee = 0 AND ae.privilege_type = 'EXECUTE')
         END AS fn_public_x
  FROM guard_spec g
  LEFT JOIN (pg_class c JOIN pg_namespace cn ON cn.oid = c.relnamespace AND cn.nspname = 'public')
         ON c.relname = g.tbl AND c.relkind IN ('r', 'p')
  LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = g.trg AND NOT t.tgisinternal
  LEFT JOIN pg_proc tf   ON tf.oid = t.tgfoid
  LEFT JOIN LATERAL (
    SELECT p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner
    FROM pg_proc p
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE pn.nspname = 'public' AND p.proname = g.fn AND p.pronargs = 0
    LIMIT 1
  ) f ON true
),
secE1 AS (
  SELECT 'E1 guards'::text AS section,
         (r.mig || ': trigger ' || r.trg || ' ON public.' || r.tbl)::text AS object,
         coalesce(nullif(concat_ws('; ',
           CASE WHEN r.relid IS NULL THEN 'TABLE MISSING' END,
           CASE WHEN r.relid IS NOT NULL AND r.found_trg IS NULL THEN 'TRIGGER MISSING' END,
           CASE WHEN r.tgenabled = 'D' THEN 'TRIGGER DISABLED' END,
           CASE WHEN r.tgenabled = 'R' THEN 'trigger fires only in replica mode' END,
           CASE WHEN r.found_trg IS NOT NULL AND (r.tgtype & 2)  = 0 THEN 'not BEFORE' END,
           CASE WHEN r.found_trg IS NOT NULL AND (r.tgtype & 1)  = 0 THEN 'not FOR EACH ROW' END,
           CASE WHEN r.found_trg IS NOT NULL AND (r.tgtype & 4)  = 0 THEN 'does not fire on INSERT' END,
           CASE WHEN r.found_trg IS NOT NULL AND (r.tgtype & 16) = 0 THEN 'does not fire on UPDATE' END,
           CASE WHEN r.found_trg IS NOT NULL AND r.trg_fn IS DISTINCT FROM r.fn THEN 'trigger calls ' || coalesce(r.trg_fn, '?') END,
           CASE WHEN r.fn_oid IS NULL THEN 'FUNCTION public.' || r.fn || '() MISSING' END,
           CASE WHEN r.fn_secdef THEN 'function is SECURITY DEFINER (authored as invoker)' END,
           CASE WHEN r.fn_oid IS NOT NULL AND NOT r.fn_pinned THEN 'function search_path not pinned' END,
           CASE WHEN r.fn_anon_x THEN 'EXECUTE held by anon' END,
           CASE WHEN r.fn_auth_x THEN 'EXECUTE held by authenticated' END,
           CASE WHEN r.fn_public_x THEN 'EXECUTE held by PUBLIC' END), ''),
           'present, enabled, BEFORE INSERT OR UPDATE FOR EACH ROW, invoker, search_path pinned, EXECUTE revoked')::text AS finding,
         format('%s; tgenabled=%s; tgtype=%s; source supabase/migrations/%s',
                r.purpose, coalesce(r.tgenabled, 'n/a'), coalesce(r.tgtype::text, 'n/a'), r.src)::text AS detail,
         (CASE
            WHEN r.relid IS NULL OR r.found_trg IS NULL OR r.tgenabled = 'D' OR r.fn_oid IS NULL THEN 'CRITICAL'
            WHEN r.tgenabled = 'R'
              OR (r.tgtype & 2) = 0 OR (r.tgtype & 1) = 0 OR (r.tgtype & 4) = 0 OR (r.tgtype & 16) = 0
              OR r.trg_fn IS DISTINCT FROM r.fn THEN 'HIGH'
            WHEN r.fn_secdef OR NOT r.fn_pinned OR r.fn_anon_x OR r.fn_auth_x OR r.fn_public_x THEN 'MEDIUM'
            ELSE 'OK'
          END)::text AS severity
  FROM guard_res r
),
legacy_spec (mig, tbl, cols, q) AS (
  VALUES
    ('106', 'partnerships', ARRAY['partnership_notes'],
     $q$SELECT count(*) AS n FROM public.partnerships WHERE partnership_notes IS NOT NULL$q$),
    ('108', 'partnerships', ARRAY['reliability_summary', 'reliability_summary_generated_at'],
     $q$SELECT count(*) AS n FROM public.partnerships WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL$q$),
    ('110', 'partner_rfp_responses', ARRAY['composite_score', 'ai_summary_short', 'ai_summary_detailed', 'ai_summary_generated_at'],
     $q$SELECT count(*) AS n FROM public.partner_rfp_responses WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL$q$),
    ('112', 'delivery_reviews', ARRAY['on_time_notes', 'on_budget_notes', 'client_feedback', 'ai_delta_summary', 'would_work_again', 'budget_variance_pct'],
     $q$SELECT count(*) AS n FROM public.delivery_reviews WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL$q$)
),
legacy_res AS (
  SELECT s.mig, s.tbl, s.cols, s.q,
         ((SELECT count(*) FROM pubcols pc WHERE pc.tbl = s.tbl AND pc.col = ANY (s.cols)) = cardinality(s.cols)) AS cols_ok,
         (SELECT string_agg(format('%s on %s (tgenabled=%s)', t.tgname::text, p.proname::text, t.tgenabled::text), ', ')
            FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal
             AND t.tgenabled IN ('O', 'A')
             AND t.tgrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                               WHERE n.nspname = 'public' AND c.relname = s.tbl AND c.relkind IN ('r', 'p'))
             AND position(s.cols[1] IN p.prosrc) > 0) AS guards
  FROM legacy_spec s
),
legacy_cnt AS (
  SELECT r.*,
         (CASE WHEN r.cols_ok
               THEN ((xpath('/row/n/text()', query_to_xml(r.q, false, true, '')))[1])::text
          END) AS n
  FROM legacy_res r
),
secE2 AS (
  SELECT 'E2 nulled legacy columns'::text AS section,
         (l.mig || ': public.' || l.tbl || ' (' || array_to_string(l.cols, ', ') || ')')::text AS object,
         format('non-null rows: %s; enabled triggers on the table whose function body names %s: %s',
                coalesce(l.n, 'n/a (a column no longer exists)'),
                l.cols[1],
                coalesce(l.guards, 'NONE'))::text AS detail_finding,
         (CASE l.mig
            WHEN '106' THEN '106 is an UPDATE only; it authored no write guard (gap recorded at 110_partner_rfp_response_private_null.sql:79).'
            WHEN '108' THEN '108 is an UPDATE only; it authored no write guard (gap recorded at 110_partner_rfp_response_private_null.sql:79).'
            WHEN '110' THEN 'Guard expected: partner_rfp_responses_private_columns_guard (see E1).'
            ELSE            'Guard expected: delivery_reviews_private_columns_guard (see E1).'
          END || ' Counted with query_to_xml: ' || l.q)::text AS detail,
         (CASE
            WHEN NOT l.cols_ok THEN 'INFO'
            WHEN l.n IS NOT NULL AND l.n <> '0' THEN 'CRITICAL'
            WHEN l.guards IS NULL THEN 'MEDIUM'
            ELSE 'OK'
          END)::text AS severity
  FROM legacy_cnt l
),

allrows AS (
  SELECT section, object, finding, detail, severity FROM sec0
  UNION ALL SELECT section, object, finding, detail, severity FROM secA1
  UNION ALL SELECT section, object, finding, detail, severity FROM secA2
  UNION ALL SELECT section, object, finding, detail, severity FROM secB
  UNION ALL SELECT section, object, finding, detail, severity FROM secC
  UNION ALL SELECT section, object, finding, detail, severity FROM secD1
  UNION ALL SELECT section, object, finding, detail, severity FROM secD2
  UNION ALL SELECT section, object, finding, detail, severity FROM secE1
  UNION ALL SELECT section, object, detail_finding, detail, severity FROM secE2
)
SELECT section, object, finding, detail, severity
FROM allrows
ORDER BY section,
         CASE severity
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH'     THEN 2
           WHEN 'MEDIUM'   THEN 3
           WHEN 'REVIEW'   THEN 4
           WHEN 'LOW'      THEN 5
           WHEN 'INFO'     THEN 6
           ELSE 7
         END,
         object;
