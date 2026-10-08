-- =====================================================================
-- 093 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 093 proves the file PARSES. It says NOTHING about whether
-- a vendor can still accept an invitation, decline one, or request
-- payment terms. Those are the questions this file answers, before
-- anything is committed.
--
-- >>> AND IT MATTERS MORE HERE THAN IT DID FOR 092, WHICH IS THE
-- >>> OPPOSITE OF WHAT 092'S HEADER COULD SAY ABOUT ITSELF. 092's permit
-- >>> list guarded ONE COLUMN THAT DID NOT EXIST until line 1 of its own
-- >>> transaction, so no write that worked that morning could move it.
-- >>> 093 GUARDS FIFTEEN OF THE TWENTY-FOUR LIVE COLUMNS AND ALL
-- >>> TWENTY-FOUR EXIST TODAY, five of them written by live vendor
-- >>> sessions every day.
-- >>>
-- >>> A DENY LIST CAN ONLY BE TOO SMALL IN ONE DIRECTION - it can miss a
-- >>> column that ought to be guarded, which is a hole you can close
-- >>> later. A PERMIT LIST CAN BE TOO SMALL IN THE OTHER DIRECTION TOO: a
-- >>> column a vendor session legitimately writes, left off the list, is
-- >>> A WRITE THAT STARTS RAISING LG009 THE MOMENT THE MIGRATION IS
-- >>> APPLIED. T1 to T5 and T12 exist for exactly that, and a FAIL in
-- >>> those is more urgent than a FAIL anywhere else in this file.
--
-- WHAT THE 22 ASSERTIONS COVER:
--
--   T1-T5    the permitted writes. FAIL = 093 breaks a live vendor action.
--   T6-T10   the refusals that make the migration worth doing.
--   T11      087 still speaks first, with its own 42501.
--   T12      the agency side is unaffected. EXIT 3. Also the agency-side
--            control for RULED-093-1 - read its own text for what that
--            does and does not demonstrate.
--   T13      HOLE 1: the predicate text is equality (structural).
--   T14      HOLE 1, behaviourally: with the caller's email set to '%', a
--            no-WHERE claim reaches every unclaimed row under the OLD policy
--            and none under 093. INCONCLUSIVE if the old policy did not.
--   T15a     HOLE 1 the other way: the claim policy admits a legitimate
--            claim (a column-free probe, so only the UPDATE policy governs).
--   T15b     the PRODUCTION-SHAPED claim (WHERE id = ...). A KNOWN LIMIT:
--            it matches 0 rows because the claimer cannot SELECT the row.
--            Pre-existing. Neither a PASS nor a FAIL, never "DO NOT APPLY".
--   T15c     the visibility control that explains T15b: expected 0.
--   T16      the negative control - an already-claimed row is not claimable,
--            with its email term made true so only `vendor_org_id IS NULL`
--            can keep it out.
--   T17      the four ghost-contact columns are REFUSED, per RULED-093-1.
--   T18      the MSA half of the self-confirm pair.
--   T19      the remaining seven guarded columns, one statement each.
--   T20      a guarded column CLEARED TO NULL is still refused - the
--            evidence for the jsonb-subtraction claim the whole permit
--            list rests on.
--
-- >>> THE CLAIM ASSERTIONS WERE REBUILT ON 2026-10-08, AND WHY. <<<
-- >>> T15 failed, and the cause was not 093 and not the impersonation. An
-- >>> UPDATE whose WHERE names a column must also pass the table's SELECT
-- >>> policies. An unclaimed row is visible to neither the lead nor the
-- >>> vendor organization, so the claimer cannot SEE the row they are
-- >>> claiming and the statement matches ZERO rows under ANY claim policy.
-- >>> EXECUTED (user, SQL Editor, 2026-10-08): impersonating
-- >>> a63260b8-ea6a-42cc-8b94-961f697f0198, auth.uid() was correct and a
-- >>> count of partnership 55ba0c93-d5f3-4b39-9825-b423dc4456eb returned 0,
-- >>> as did a count of every partnership. Full account:
-- >>> docs/093-t15-investigation.md.
-- >>>
-- >>> The same mechanism made the old T14 and T16 VACUOUS (reasoned from the
-- >>> same Postgres behaviour; NOT executed): both expected zero rows and both
-- >>> named a column, so both would have passed under the old wildcard policy.
-- >>> A test that cannot fail is not evidence.
--
-- WHAT CHANGED, in five rules the claim assertions now follow:
--
--   1. BEFORE AND AFTER. Every claim probe runs twice in one transaction:
--      against the policy that is LIVE when the paste starts (the old ~~*
--      policy, if 093 is not applied), then 093's two statements are applied
--      (EXECUTE; the migration's code, comments left out) and the same probes run again.
--      The report prints both columns. Only AFTER decides a verdict; BEFORE
--      is what gives a zero its meaning. If the old policy is not live
--      (093 is already applied) T14 says INCONCLUSIVE, because there is no
--      contrast to credit the zero to.
--
--   2. COLUMN-FREE PROBES. T14, T15a and T16 use an UPDATE with no WHERE and
--      no RETURNING, so the SELECT policies are not consulted and only the
--      UPDATE policies govern. The OWNER computes what each policy should
--      admit before the probe and measures what was newly claimed after it.
--      T15a also checks that the subject row (55ba0c93 when it qualifies)
--      reads as claimed to the owner afterwards. This is stated as RECALLED
--      Postgres behaviour in the investigation doc and the first run of
--      this file is what confirms it.
--
--   3. THE LIMIT IS RECORDED, NOT HIDDEN. T15b runs the production-shaped
--      statement and expects 0 rows. It is counted as KNOWN LIMIT, a third
--      outcome beside PASS and FAIL, and it never produces "DO NOT APPLY".
--      The summary has a KNOWN LIMIT line of its own.
--
--   4. ISOLATION, GUARANTEED AND CHECKED. A no-WHERE UPDATE claims EVERY
--      row its policy admits, so each probe runs inside its own nested
--      BEGIN ... EXCEPTION block and always ends in RAISE EXCEPTION with
--      ERRCODE 'LG097', which that block's own handler swallows. A handler
--      that catches an error rolls back everything the block did to the
--      database: the UPDATE, the owner's profiles.email write in T14, the
--      SET LOCAL ROLE and the set_config claims. Local variables survive,
--      which is how a probe carries its measurements out. THIS IS CHECKED,
--      NOT TAKEN ON TRUST: a fingerprint of every partnerships row and of
--      the impersonated profiles' emails is taken before the first probe and
--      recomputed after EVERY probe. A difference ends the run with "THE
--      TEST ITSELF IS BROKEN", which outranks any verdict.
--
--   5. EVERY IDENTITY SWITCH IS READ BACK. After each SET LOCAL ROLE the
--      test reads auth.uid() and raises LG098 if it is not the intended
--      user; after each claims reset the owner state is checked to have
--      auth.uid() NULL. LG098 is reported as INCONCLUSIVE with the words
--      TEST FAULT, never as a verdict on 093.
--
-- THE SUPABASE SQL EDITOR MAY ASK YOU TO CONFIRM. The probes contain
-- UPDATE statements with no WHERE clause. Some versions of the editor warn
-- about that when they see the text. The statements are inside a DO block,
-- inside a transaction that is rolled back; confirm and continue.
--
-- HOW THIS GREW. T16-T19 were added after the first run, which returned DO
-- NOT APPLY on two assertions that were both TEST bugs. T15 and T16 exist as
-- a pair because the first T15 borrowed an ALREADY-CLAIMED subject: a claim
-- needs vendor_org_id IS NULL, so zero rows matched and CORRECT BEHAVIOUR
-- WAS REPORTED AS A MIGRATION FAILURE. T15 now selects its own claimable
-- subject; T16 tests the already-claimed case ON PURPOSE.
--
-- T15 AND THE SHARED-CLAIMS BUG. On main before the 2026-08-25 revision,
-- v_claims was built once from the T1-T12 subject's uid and T15 reused it,
-- so its UPDATE ran with auth.uid() = that subject, not the claimer. T15a-c
-- build their own claims (v_ghost_claims, from the claimer's uid). As of
-- 2026-10-08 that check is no longer special to T15: EVERY role switch in
-- this file reads auth.uid() back (rule 5 above). Every assertion's
-- identity is listed in docs/093-resume-report.md.
--
-- T17 was FLIPPED on 2026-08-25 from "these four are permitted" to "these
-- four are refused" when Greg ruled RULED-093-1. T20 was added in the same
-- pass, because that ruling is the first time a name has been REMOVED from
-- the permit list and nothing until then had tested the value -> NULL
-- direction that removal depends on.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- =====================================================================
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT.        <<<
-- >>> A RUN THAT DOES **NOT** ERROR MEANS SOMETHING WENT WRONG.   <<<
-- =====================================================================
--
-- The DO block finishes with RAISE EXCEPTION carrying the whole report.
-- So a correct, healthy, everything-worked run looks like a red error box
-- with a multi-line message in it. That is not a failure. That IS the
-- output, and the verdict is the first line of it.
--
-- WHY IT HAS TO BE AN ERROR. This is the third mechanism, and the first
-- two were dead ends against this exact client - established in
-- docs/091-preapply-test.sql and docs/092-preapply-test.sql and not
-- re-derived here:
--
--   RAISE NOTICE - the Supabase SQL Editor has no Messages panel and does
--   not render notices at all. Every assertion runs and the editor says
--   "Success. No rows returned".
--
--   A TEMP TABLE AND A FINAL SELECT - the editor returns 3F000 schema
--   "pg_temp" does not exist. That session has no temp namespace, so no
--   results table can exist in it under any spelling.
--
-- DO NOT INVENT A FOURTH. An error is the one channel every SQL client
-- displays, and it aborts the transaction, which is the same outcome the
-- ROLLBACK at the foot was always there to produce.
--
-- WHAT THE ERROR LOOKS LIKE. Verdict first, tally second, per-assertion
-- lines last, because a client that truncates a long message truncates
-- the END of it:
--
--     ERROR:  P0001
--     =====================================================
--     SAFE TO APPLY 093.  21 of 22 assertions passed, 1 KNOWN LIMIT (...)
--     =====================================================
--     assertions run  : 22   (expected 22)
--     PASS            : 21   (expected 21; 22 if the claim limit has lifted)
--     KNOWN LIMIT     : 1    (expected 1: T15b, pre-existing, NOT a verdict on 093)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 22   (must equal assertions run: OK)
--     tally check     : 22   (pass + limit + fail + inconclusive: OK)
--     isolation check : 10 probes, each restored the fingerprint: OK
--
--     CLAIM VERDICTS, BEFORE 093 AND AFTER ... (both columns)
--     VERDICT         : SAFE TO APPLY 093.
--     -----------------------------------------------------
--       T1  vendor accepts invitation     PASS      (1 row written)
--       ... twenty-one more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 093."        -> and only this - apply it. It still
--                                    shows ONE "KNOWN LIMIT" line (T15b): a
--                                    pre-existing defect 093 does not cause
--                                    and does not fix. Read that line.
--     "DO NOT APPLY 093."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 093 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    an assertion could not be exercised,
--                                    so the run says NOTHING about the
--                                    thing it was meant to prove. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 093
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the ALTER POLICY, the
-- CREATE OR REPLACE FUNCTION, every UPDATE against real partnership rows
-- and the profiles.email write in T14 - is inside one transaction, and
-- the RAISE EXCEPTION aborts it. The claim probes are ALSO undone one by one
-- by their own subtransactions (rule 4), so no probe sees another's writes. PostgreSQL rolls back
-- DDL, so after this runs the database is byte-identical to before,
-- whether 093 has been applied or not.
--
-- >>> IT WRITES TO REAL ROWS. SAID PLAINLY BECAUSE IT IS TRUE. This test
-- >>> mutates a live partnership (status, notes, contact details,
-- >>> timestamps), a live profiles.email (T14 only, inside its own probe),
-- >>> and CLAIMS REAL UNCLAIMED PARTNERSHIPS (T14, T15a, T15b, T16 probes,
-- >>> each inside its own subtransaction), because the guard and the claim
-- >>> policy can only be exercised against rows they govern. Every one of those writes is inside the
-- >>> transaction and every one is undone by the abort. If the batch is
-- >>> run in PIECES rather than as one paste, the transaction may commit
-- >>> and those writes become real. RUN IT AS ONE PASTE.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 093 IS ALREADY APPLIED. The ALTER
-- POLICY and the CREATE OR REPLACE simply reinstall the same objects, and
-- the abort restores whatever was there. BUT the BEFORE column only shows
-- the OLD policy when 093 is not applied; if it is, the report says so and
-- T14 is INCONCLUSIVE, because a zero with nothing to contrast it with
-- cannot be credited to 093.
--
-- =====================================================================
-- THREE WAYS THIS RUN CAN END, AND ONLY ONE OF THEM IS A VERDICT
-- =====================================================================
--
-- (1) AN ERROR WITH THE ===== BANNER AND A TALLY.  That is the report.
--     Read the headline.
--
-- (2) AN ERROR SAYING 'undefined_object' OR '42704' FROM THE FIRST EXECUTE
--     IN THE PROBE LOOP (the ALTER POLICY).
--     THAT IS NOT A CRASH AND IT IS NOT A BUG IN THIS FILE. It is the
--     ALTER POLICY failing because the policy name has drifted. 093 is
--     written to fail exactly that way rather than silently create a
--     second policy. Establish what the policy is actually called before
--     going further, with:
--
--         SELECT policyname, cmd FROM pg_policies
--         WHERE schemaname='public' AND tablename='partnerships'
--         ORDER BY policyname;
--
-- (3) "Success. No rows returned".  THE RUN DID NOT WORK. See above.
--
-- =====================================================================
-- WHAT IT IMPERSONATES, AND WHY THAT IS THE WHOLE POINT
-- =====================================================================
--
-- 093's guard turns on auth.uid() being non-null and on the caller NOT
-- being a member of the partnership's lead_org_id. Neither is true of the
-- SQL Editor's own session, so a test that just ran UPDATEs as postgres
-- would exercise EXIT 2 every time and prove nothing at all.
--
-- So each assertion sets `request.jwt.claims` and `request.jwt.claim.sub`
-- and then `SET LOCAL ROLE authenticated`. Both claim spellings are set
-- because Supabase's auth.uid() has been shipped reading each of them at
-- different versions; setting only one is how a test like this silently
-- becomes a test of EXIT 2.
--
-- If your database refuses `SET LOCAL ROLE authenticated` you will see
-- INCONCLUSIVE lines rather than passes. Replace every `SET LOCAL ROLE
-- authenticated;` with `PERFORM set_config('role', 'authenticated',
-- true);` and every `RESET ROLE;` with `PERFORM set_config('role',
-- 'none', true);`. They are equivalent - `role` is an ordinary GUC.
--
-- THE SUBJECTS. THREE, NOT ONE, AND THEY ARE NOT INTERCHANGEABLE.
--
--   1. T1-T14, T16-T20: a partnership that HAS a linked vendor
--      organization, a real member of that organization, and whose lead
--      organization that member does NOT belong to. The last condition
--      keeps the subject on the vendor side of EXIT 3; without it every
--      refusal assertion would pass for the wrong reason.
--
--   2. T15a-c: a CLAIMABLE partnership - vendor_org_id IS NULL - together
--      with the real profile whose lower(btrim(email)) equals the row's
--      lower(btrim(partner_email)), and that profile's organization. The
--      claimer must be in EXACTLY ONE organization and in NO lead
--      organization, because the no-WHERE probe also touches every row the
--      claimer's other policies admit. 55ba0c93 is preferred when it
--      qualifies. A claim cannot be tested against a claimed row.
--
--   3. T16: an ALREADY-CLAIMED partnership belonging to a THIRD
--      organization, so neither the claim policy nor the vendor status
--      policy can admit it. Its partner_email is rewritten by the owner
--      (undone with the probe) to the claimer's email so the claim policy's
--      email term is TRUE and only `vendor_org_id IS NULL` can exclude it.
--
-- Each is selected independently at the top of the DO block and each
-- reports INCONCLUSIVE, never PASS, when it cannot be found. An assertion
-- with no subject has proved nothing.
--
-- =====================================================================
-- THREE NUMBERS MOVE TOGETHER when you add or move an assertion, and all
-- are in this file: the `expected 22` literals in the report, the
-- `expected 21` PASS literal (22 minus the one KNOWN LIMIT), and the
-- `v_ran = 22 AND v_pass + v_limit = 22` condition in the verdict. The self-check
-- at the foot compares v_ran against v_logged - two counters incremented
-- in different places - so it catches an assertion that ran without
-- reporting, which no eyeball review reliably does. A second check ties
-- pass + limit + fail + inconclusive to v_logged, so an assertion that
-- logged without counting is also caught.
-- =====================================================================

BEGIN;

DO $test$
DECLARE
  v_uid          uuid;
  v_org          uuid;
  v_lead         uuid;
  v_pship        uuid;
  v_email        text;
  v_agency_uid   uuid;
  v_ghost        uuid;
  v_ghost_email  text;
  v_ghost_uid    uuid;
  v_ghost_org    uuid;
  v_ghost_claims text;
  v_claimed_other uuid;
  v_claims       text;
  v_seen_uid     uuid;
  v_agency_claims text;
  v_rows         integer;
  v_uses_btrim   boolean;
  v_uses_ilike   boolean;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_verdict_text text;
  -- THE ACCUMULATOR AND ITS COUNTER. v_lines holds one line per assertion,
  -- appended in the order the assertions run. v_logged counts them and is
  -- checked against v_ran at the foot - see THE SELF-CHECK there.
  v_lines        text := '';
  v_logged       integer := 0;
  v_headline     text;
  v_report       text;
  -- ---- the claim probes (T14, T15a-c, T16), one slot per phase: 1 = BEFORE 093, 2 = AFTER ----
  v_ph           integer;
  v_pre_ilike    boolean;
  v_exp_old      integer := 0;
  v_exp_new      integer := 0;
  v_exp          integer;
  v_unclaimed    integer := 0;
  v_uid_lead     integer := 0;
  v_n0           integer;
  v_n1           integer;
  v_cnt          integer;
  v_cnt_all      integer;
  v_post         boolean;
  v_ghost_loose  integer := 0;
  v_before_org   uuid;
  v_after_org    uuid;
  v_t16_match    boolean;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_limit        integer := 0;
  v_ba           text;
  v_pre_note     text;
  a15_class  text[]    := ARRAY['NOT RUN', 'NOT RUN'];
  a15_new    integer[] := ARRAY[NULL, NULL]::integer[];
  a15_exp    integer[] := ARRAY[NULL, NULL]::integer[];
  a15_post   boolean[] := ARRAY[NULL, NULL]::boolean[];
  b15_class  text[]    := ARRAY['NOT RUN', 'NOT RUN'];
  b15_rows   integer[] := ARRAY[NULL, NULL]::integer[];
  c15_class  text[]    := ARRAY['NOT RUN', 'NOT RUN'];
  c15_cnt    integer[] := ARRAY[NULL, NULL]::integer[];
  c15_all    integer[] := ARRAY[NULL, NULL]::integer[];
  w14_class  text[]    := ARRAY['NOT RUN', 'NOT RUN'];
  w14_new    integer[] := ARRAY[NULL, NULL]::integer[];
  t16_class  text[]    := ARRAY['NOT RUN', 'NOT RUN'];
  t16_after  uuid[]    := ARRAY[NULL, NULL]::uuid[];
  t16_match  boolean[] := ARRAY[NULL, NULL]::boolean[];
BEGIN
  -- THE SUBJECT. A linked vendor on a partnership whose LEAD organization
  -- that same user is NOT a member of. The NOT EXISTS is load-bearing: a
  -- subject who belonged to both sides would return at EXIT 3 on every
  -- refusal assertion and this file would report a clean run while
  -- proving nothing.
  SELECT p.id, p.vendor_org_id, p.lead_org_id, m.user_id, pr.email
    INTO v_pship, v_org, v_lead, v_uid, v_email
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.vendor_org_id
  JOIN public.profiles   pr ON pr.id = m.user_id
  WHERE p.vendor_org_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.user_id = m.user_id AND m2.org_id = p.lead_org_id
    )
  ORDER BY (NOT EXISTS (
              SELECT 1 FROM public.org_members m3
              JOIN public.partnerships p3 ON p3.lead_org_id = m3.org_id
              WHERE m3.user_id = m.user_id)) DESC,
           p.id
  LIMIT 1;

  IF v_pship IS NULL THEN
    RAISE EXCEPTION 'No partnership exists whose vendor organization has a member who is NOT also a member of the lead organization. There is nothing to test 093''s vendor-side guard against, and every assertion in this file would have passed for the wrong reason.';
  END IF;

  -- The lead agency's side, for T12. Any member of the lead organization.
  SELECT m.user_id INTO v_agency_uid
  FROM public.org_members m
  WHERE m.org_id = v_lead
  ORDER BY m.user_id
  LIMIT 1;

  -- ===================================================================
  -- T15'S OWN SUBJECT. A CLAIMABLE ROW, SELECTED BY THE CONDITIONS A CLAIM
  -- ACTUALLY REQUIRES.
  --
  -- >>> THE PREVIOUS VERSION OF THIS TEST REUSED THE T1-T12 SUBJECT, WHICH
  -- >>> HAS A vendor_org_id. A claim requires `vendor_org_id IS NULL`, so
  -- >>> the policy admitted nothing, zero rows matched, and CORRECT
  -- >>> BEHAVIOUR WAS REPORTED AS A FAILURE OF THE MIGRATION. The subject
  -- >>> was wrong, not the predicate.
  --
  -- Four conditions, each of them load-bearing:
  --
  --   1. `vendor_org_id IS NULL` - the claim policy's own first term. A row
  --      that is already claimed cannot be claimed, which is the point of
  --      T16 and the reason it is a separate assertion.
  --   2. A profile whose `lower(btrim(email))` EQUALS `lower(btrim(
  --      partner_email))` - the new predicate, spelled the same way. Note
  --      this selects on the FIXED comparison: if the subject exists, the
  --      claim must succeed, and if it does not, T15 says INCONCLUSIVE
  --      rather than passing.
  --   3. That profile must be in an organization, because the claim WRITES
  --      `vendor_org_id` and both the policy's WITH CHECK and 087's
  --      org_has_member_with_email() test it.
  --   4. That profile must NOT be a member of the row's lead organization.
  --      Without this the write would leave at EXIT 3 - as the lead agency -
  --      and T15 would pass while proving nothing about the vendor-side
  --      permit list or the claim-transition widening.
  --
  -- AND `pr.id <> v_uid`, which is about T14 rather than about claims: T14
  -- sets the T1-T12 subject's profiles.email to '%'. If T15 impersonated
  -- that same user, its subject would stop matching by the time it ran, and
  -- the failure would look like a defect in 093.
  --
  -- Nothing is INSERTED to manufacture this. A row created here would have
  -- to dodge 084's UNIQUE (lead_org_id, lower(partner_email)) index, and a
  -- test that builds its own subject proves less than one that uses a real
  -- row. Live count on 2026-08-21: 27 partnerships with vendor_org_id IS
  -- NULL, at least four addressed to a real profile.
  SELECT p.id, p.partner_email, pr.id, m.org_id
    INTO v_ghost, v_ghost_email, v_ghost_uid, v_ghost_org
  FROM public.partnerships p
  JOIN public.profiles pr
    ON pr.email IS NOT NULL
   AND lower(btrim(pr.email)) = lower(btrim(p.partner_email))
  JOIN public.org_members m
    ON m.user_id = pr.id
  WHERE p.vendor_org_id IS NULL
    AND p.partner_email IS NOT NULL
    AND btrim(p.partner_email) <> ''
    AND pr.id <> v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.user_id = pr.id AND m2.org_id = p.lead_org_id
    )
    -- The NO-WHERE probe also touches every row the claimer's OTHER policies admit, so the
    -- claimer must be in exactly one organization and in no lead organization. Otherwise
    -- the agency update policy or a second vendor organization would add rows the probe
    -- cannot account for.
    AND (SELECT count(*) FROM public.org_members mc WHERE mc.user_id = pr.id) = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m4
      JOIN public.partnerships p4 ON p4.lead_org_id = m4.org_id
      WHERE m4.user_id = pr.id
    )
  -- 55ba0c93 is the unclaimed row the 2026-10-08 live evidence was taken on. Prefer it, so the
  -- report is about a row we have executed evidence for; otherwise the lowest id.
  ORDER BY (p.id = '55ba0c93-d5f3-4b39-9825-b423dc4456eb'::uuid) DESC, p.id
  LIMIT 1;

  -- For the INCONCLUSIVE message only: how many unclaimed rows have a matching profile in an
  -- organization at all, ignoring the stricter conditions above.
  SELECT count(*) INTO v_ghost_loose
  FROM public.partnerships p
  JOIN public.profiles pr ON pr.email IS NOT NULL AND lower(btrim(pr.email)) = lower(btrim(p.partner_email))
  JOIN public.org_members m ON m.user_id = pr.id
  WHERE p.vendor_org_id IS NULL AND p.partner_email IS NOT NULL;

  IF v_ghost_uid IS NOT NULL THEN
    v_ghost_claims := json_build_object('sub', v_ghost_uid::text, 'role', 'authenticated')::text;
  END IF;

  -- T16'S SUBJECT. An ALREADY-CLAIMED partnership belonging to somebody
  -- else, so that neither the claim policy (needs NULL) nor the vendor
  -- status policy (needs the caller's own org) can admit it. Zero rows is
  -- the correct answer and T16 asserts exactly that.
  SELECT p.id INTO v_claimed_other
  FROM public.partnerships p
  WHERE p.vendor_org_id IS NOT NULL
    AND p.vendor_org_id <> v_org
    -- 084 makes (lead_org_id, lower(partner_email)) unique, and the T16 probe rewrites this
    -- row's partner_email to the claimer's. Pick a row whose lead holds no row for that email.
    AND NOT EXISTS (
      SELECT 1 FROM public.partnerships q
      WHERE q.lead_org_id = p.lead_org_id
        AND q.partner_email IS NOT NULL
        AND lower(btrim(q.partner_email)) = lower(btrim(v_email))
    )
  ORDER BY p.id
  LIMIT 1;

  v_claims        := json_build_object('sub', v_uid::text,        'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency_uid::text, 'role', 'authenticated')::text;

  -- START FROM A KNOWN CALLER STATE. If this batch is pasted after another
  -- that impersonated somebody, those GUCs are still set on this connection.
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- THE OWNER STATE MUST BE CLEAN TOO. auth.uid() reads a GUC, not the database role.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
      USING ERRCODE = 'LG098';
  END IF;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '093 PRE-APPLY TEST';
  RAISE NOTICE 'vendor permit list : status, accepted_at, updated_at, payment_terms_requests, vendor_org_id';
  RAISE NOTICE 'subject user id    : %', v_uid;
  RAISE NOTICE 'subject vendor org : %', v_org;
  RAISE NOTICE 'subject lead org   : %', v_lead;
  RAISE NOTICE 'subject partnership: %', v_pship;
  RAISE NOTICE '=====================================================';


  -- ===================================================================
  -- THE CLAIM PROBES. RUN TWICE IN ONE TRANSACTION: BEFORE 093, THEN AFTER.
  --
  -- Phase 1 runs against the policy and trigger that are LIVE when the paste
  -- starts. If 093 is not applied that is the OLD ~~* policy and 087's trigger.
  -- Then 093's two statements are applied (EXECUTE, below, verbatim from the
  -- migration) and phase 2 runs the same probes again against 093.
  --
  -- WHY EVERY PROBE IS COLUMN-FREE WHERE IT CAN BE. An UPDATE whose WHERE or
  -- RETURNING names a partnerships column must ALSO pass the SELECT policies.
  -- The claimer is in neither organization on an unclaimed row, so it passes
  -- none of them and the statement matches zero rows whatever the claim policy
  -- says (docs/093-t15-investigation.md, section 1: EXECUTED, user, 2026-10-08).
  -- An UPDATE with no WHERE and no RETURNING is governed by the UPDATE
  -- policies alone, so these probes measure the policy and not the filter.
  -- The one deliberate exception is T15b, which uses the production shape on
  -- purpose to record the limit.
  --
  -- A NO-WHERE UPDATE TOUCHES EVERY ROW ITS POLICIES ADMIT. That is why each
  -- probe is wrapped in its own nested BEGIN ... EXCEPTION block and ends in
  -- RAISE EXCEPTION ... ERRCODE 'LG097', which that block's own handler
  -- swallows. A handler that catches an error rolls back everything the block
  -- did to the database: the UPDATE, the owner-side profiles.email write in
  -- T14, the SET LOCAL ROLE and the set_config claims. Local variables are
  -- NOT rolled back, which is how a probe carries its measurements out.
  --
  -- THAT GUARANTEE IS CHECKED, NOT ASSUMED. v_fp0 is a fingerprint of every
  -- partnerships row and of the two impersonated profiles' emails, taken
  -- before phase 1. After EACH probe the fingerprint is recomputed. Any
  -- difference means a probe leaked into the next one, and the run ends with
  -- "THE TEST ITSELF IS BROKEN", overriding any verdict (see the self-check).
  --
  -- HOW AN OUTCOME IS CLASSIFIED. Row-level security filters rows with USING
  -- before the BEFORE ROW triggers run and checks WITH CHECK after them. So:
  --   DONE      the statement completed.
  --   REACHED   a trigger, or the WITH CHECK, raised. That proves the policy
  --             USING had ALREADY ADMITTED a row. Under the old wildcard
  --             policy this is how "every unclaimed row" shows up, because
  --             087's trigger then refuses the first row that is not the
  --             claimer's: the statement aborts, so ROW_COUNT is never seen.
  --   FAULT     LG098, the test's own impersonation check. Says nothing about 093.
  --   ERR       anything else.
  -- "Admitted" below means DONE with rows newly claimed, or REACHED.
  --
  -- "Newly claimed" is counted by the OWNER (before and after), as the number
  -- of rows whose vendor_org_id stopped being NULL. ROW_COUNT is not used for
  -- that, because a column-free UPDATE also counts the claimer's own rows
  -- (rewritten to the same value) and would blur the figure.
  -- ===================================================================

  SELECT qual LIKE '%~~*%' INTO v_pre_ilike
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'partnerships'
    AND policyname = 'Partners can claim partnership by email';

  IF v_ghost_uid IS NOT NULL THEN
    -- What each policy SHOULD admit for the claimer, computed by the owner
    -- with the policy's own predicate spelled independently.
    SELECT count(*) INTO v_exp_old
    FROM public.partnerships p JOIN public.profiles pr ON pr.id = v_ghost_uid
    WHERE p.vendor_org_id IS NULL AND p.partner_email ILIKE pr.email;
    SELECT count(*) INTO v_exp_new
    FROM public.partnerships p JOIN public.profiles pr ON pr.id = v_ghost_uid
    WHERE p.vendor_org_id IS NULL
      AND p.partner_email IS NOT NULL AND pr.email IS NOT NULL
      AND lower(btrim(pr.email)) = lower(btrim(p.partner_email));
  END IF;
  SELECT count(*) INTO v_unclaimed FROM public.partnerships WHERE vendor_org_id IS NULL;
  SELECT count(*) INTO v_uid_lead
  FROM public.partnerships p JOIN public.org_members m ON m.org_id = p.lead_org_id
  WHERE m.user_id = v_uid;

  v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));

  FOR v_ph IN 1 .. 2 LOOP
    v_exp := CASE WHEN v_ph = 1 AND coalesce(v_pre_ilike, false) THEN v_exp_old ELSE v_exp_new END;

    IF v_ghost IS NOT NULL THEN
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        IF auth.uid() IS NOT NULL THEN
          RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
            USING ERRCODE = 'LG098';
        END IF;
        SELECT count(*) INTO v_n0 FROM public.partnerships WHERE vendor_org_id IS NULL;
        -- Owner-side normalisation, undone with the probe: the claimer's OWN claimed rows are
        -- admitted by "Partners can update partnership status" and this statement writes
        -- profile_status, which 093 permits only on the claim transition. A row whose
        -- profile_status is not already 'active' would raise LG009 for a reason that has
        -- nothing to do with the claim, so make them equal first.
        UPDATE public.partnerships SET profile_status = 'active'
         WHERE vendor_org_id = v_ghost_org AND profile_status IS DISTINCT FROM 'active';
        PERFORM set_config('request.jwt.claims',    v_ghost_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_ghost_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_ghost_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (T15a claimer): auth.uid() is %, expected %', auth.uid(), v_ghost_uid
            USING ERRCODE = 'LG098';
        END IF;
        UPDATE public.partnerships
           SET vendor_org_id = v_ghost_org, profile_status = 'active', updated_at = now();
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        SELECT count(*) INTO v_n1 FROM public.partnerships WHERE vendor_org_id IS NULL;
        SELECT (vendor_org_id IS NOT DISTINCT FROM v_ghost_org) INTO v_post
          FROM public.partnerships WHERE id = v_ghost;
        a15_class[v_ph] := 'DONE';
        a15_new[v_ph]   := v_n0 - v_n1;
        a15_exp[v_ph]   := v_exp;
        a15_post[v_ph]  := v_post;
        RAISE EXCEPTION 'probe T15a complete: undoing its writes' USING ERRCODE = 'LG097';
      EXCEPTION
        WHEN sqlstate 'LG097' THEN
          NULL;
        WHEN OTHERS THEN
          a15_class[v_ph] := CASE
                 WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
                 WHEN SQLSTATE = '23514' THEN 'REACHED:23514 (087: the organization has no member with that email)'
                 WHEN SQLSTATE = 'LG009' THEN 'REACHED:LG009 (093 guard refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'new row violates row-level security%' THEN 'REACHED:WITHCHECK (the policy USING admitted, WITH CHECK refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.%' THEN 'REACHED:42501 (087) ' || left(SQLERRM, 100)
                 ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
               END;
      END;
    END IF;
    -- ISOLATION CHECK for T15a: the fingerprint taken before the loop must be unchanged.
    v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));
    v_iso_runs := v_iso_runs + 1;
    IF v_fp IS DISTINCT FROM v_fp0 THEN
      v_iso_bad := v_iso_bad + 1;
      v_iso_note := v_iso_note || ' T15a/phase ' || v_ph || ';';
    END IF;

    IF v_ghost IS NOT NULL THEN
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        IF auth.uid() IS NOT NULL THEN
          RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
            USING ERRCODE = 'LG098';
        END IF;
        PERFORM set_config('request.jwt.claims',    v_ghost_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_ghost_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_ghost_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (T15b claimer): auth.uid() is %, expected %', auth.uid(), v_ghost_uid
            USING ERRCODE = 'LG098';
        END IF;
        -- W4's shape: it names a column, so the SELECT policies apply.
        UPDATE public.partnerships
           SET vendor_org_id = v_ghost_org, profile_status = 'active', updated_at = now()
         WHERE id = v_ghost;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        b15_class[v_ph] := 'DONE';
        b15_rows[v_ph]  := v_rows;
        RAISE EXCEPTION 'probe T15b complete: undoing its writes' USING ERRCODE = 'LG097';
      EXCEPTION
        WHEN sqlstate 'LG097' THEN
          NULL;
        WHEN OTHERS THEN
          b15_class[v_ph] := CASE
                 WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
                 WHEN SQLSTATE = '23514' THEN 'REACHED:23514 (087: the organization has no member with that email)'
                 WHEN SQLSTATE = 'LG009' THEN 'REACHED:LG009 (093 guard refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'new row violates row-level security%' THEN 'REACHED:WITHCHECK (the policy USING admitted, WITH CHECK refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.%' THEN 'REACHED:42501 (087) ' || left(SQLERRM, 100)
                 ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
               END;
      END;
    END IF;
    -- ISOLATION CHECK for T15b: the fingerprint taken before the loop must be unchanged.
    v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));
    v_iso_runs := v_iso_runs + 1;
    IF v_fp IS DISTINCT FROM v_fp0 THEN
      v_iso_bad := v_iso_bad + 1;
      v_iso_note := v_iso_note || ' T15b/phase ' || v_ph || ';';
    END IF;

    IF v_ghost IS NOT NULL THEN
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        IF auth.uid() IS NOT NULL THEN
          RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
            USING ERRCODE = 'LG098';
        END IF;
        PERFORM set_config('request.jwt.claims',    v_ghost_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_ghost_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_ghost_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (T15c claimer): auth.uid() is %, expected %', auth.uid(), v_ghost_uid
            USING ERRCODE = 'LG098';
        END IF;
        SELECT count(*) INTO v_cnt     FROM public.partnerships WHERE id = v_ghost;
        SELECT count(*) INTO v_cnt_all FROM public.partnerships;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        c15_class[v_ph] := 'DONE';
        c15_cnt[v_ph]   := v_cnt;
        c15_all[v_ph]   := v_cnt_all;
        RAISE EXCEPTION 'probe T15c complete: undoing its writes' USING ERRCODE = 'LG097';
      EXCEPTION
        WHEN sqlstate 'LG097' THEN
          NULL;
        WHEN OTHERS THEN
          c15_class[v_ph] := CASE
                 WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
                 WHEN SQLSTATE = '23514' THEN 'REACHED:23514 (087: the organization has no member with that email)'
                 WHEN SQLSTATE = 'LG009' THEN 'REACHED:LG009 (093 guard refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'new row violates row-level security%' THEN 'REACHED:WITHCHECK (the policy USING admitted, WITH CHECK refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.%' THEN 'REACHED:42501 (087) ' || left(SQLERRM, 100)
                 ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
               END;
      END;
    END IF;
    -- ISOLATION CHECK for T15c: the fingerprint taken before the loop must be unchanged.
    v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));
    v_iso_runs := v_iso_runs + 1;
    IF v_fp IS DISTINCT FROM v_fp0 THEN
      v_iso_bad := v_iso_bad + 1;
      v_iso_note := v_iso_note || ' T15c/phase ' || v_ph || ';';
    END IF;

    IF v_unclaimed > 0 AND v_uid_lead = 0 THEN
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        IF auth.uid() IS NOT NULL THEN
          RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
            USING ERRCODE = 'LG098';
        END IF;
        SELECT count(*) INTO v_n0 FROM public.partnerships WHERE vendor_org_id IS NULL;
        -- The wildcard. Written as the OWNER with the claims cleared, which migration 091's
        -- guard exempts. Undone with the probe, so profiles.email is never left as '%'.
        UPDATE public.profiles SET email = '%' WHERE id = v_uid;
        PERFORM set_config('request.jwt.claims',    v_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (T14 claimer): auth.uid() is %, expected %', auth.uid(), v_uid
            USING ERRCODE = 'LG098';
        END IF;
        UPDATE public.partnerships SET vendor_org_id = v_org;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        SELECT count(*) INTO v_n1 FROM public.partnerships WHERE vendor_org_id IS NULL;
        w14_class[v_ph] := 'DONE';
        w14_new[v_ph]   := v_n0 - v_n1;
        RAISE EXCEPTION 'probe T14 complete: undoing its writes' USING ERRCODE = 'LG097';
      EXCEPTION
        WHEN sqlstate 'LG097' THEN
          NULL;
        WHEN OTHERS THEN
          w14_class[v_ph] := CASE
                 WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
                 WHEN SQLSTATE = '23514' THEN 'REACHED:23514 (087: the organization has no member with that email)'
                 WHEN SQLSTATE = 'LG009' THEN 'REACHED:LG009 (093 guard refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'new row violates row-level security%' THEN 'REACHED:WITHCHECK (the policy USING admitted, WITH CHECK refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.%' THEN 'REACHED:42501 (087) ' || left(SQLERRM, 100)
                 ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
               END;
      END;
    END IF;
    -- ISOLATION CHECK for T14: the fingerprint taken before the loop must be unchanged.
    v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));
    v_iso_runs := v_iso_runs + 1;
    IF v_fp IS DISTINCT FROM v_fp0 THEN
      v_iso_bad := v_iso_bad + 1;
      v_iso_note := v_iso_note || ' T14/phase ' || v_ph || ';';
    END IF;

    IF v_claimed_other IS NOT NULL AND v_uid_lead = 0 THEN
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        IF auth.uid() IS NOT NULL THEN
          RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
            USING ERRCODE = 'LG098';
        END IF;
        SELECT vendor_org_id INTO v_before_org FROM public.partnerships WHERE id = v_claimed_other;
        -- Make the EMAIL term of the claim policy true for this row, as the owner, undone with
        -- the probe. Then the only thing that can keep the row out is `vendor_org_id IS NULL`.
        UPDATE public.partnerships SET partner_email = v_email WHERE id = v_claimed_other;
        SELECT (lower(btrim(partner_email)) = lower(btrim(v_email))) INTO v_t16_match
          FROM public.partnerships WHERE id = v_claimed_other;
        PERFORM set_config('request.jwt.claims',    v_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (T16 claimer): auth.uid() is %, expected %', auth.uid(), v_uid
            USING ERRCODE = 'LG098';
        END IF;
        UPDATE public.partnerships SET vendor_org_id = v_org;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        SELECT vendor_org_id INTO v_after_org FROM public.partnerships WHERE id = v_claimed_other;
        t16_class[v_ph] := 'DONE';
        t16_after[v_ph] := v_after_org;
        t16_match[v_ph] := v_t16_match AND v_before_org IS NOT NULL AND v_before_org IS DISTINCT FROM v_org;
        IF v_after_org IS DISTINCT FROM v_before_org THEN
          t16_class[v_ph] := 'MOVED';
        END IF;
        RAISE EXCEPTION 'probe T16 complete: undoing its writes' USING ERRCODE = 'LG097';
      EXCEPTION
        WHEN sqlstate 'LG097' THEN
          NULL;
        WHEN OTHERS THEN
          t16_class[v_ph] := CASE
                 WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
                 WHEN SQLSTATE = '23514' THEN 'REACHED:23514 (087: the organization has no member with that email)'
                 WHEN SQLSTATE = 'LG009' THEN 'REACHED:LG009 (093 guard refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'new row violates row-level security%' THEN 'REACHED:WITHCHECK (the policy USING admitted, WITH CHECK refused)'
                 WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.%' THEN 'REACHED:42501 (087) ' || left(SQLERRM, 100)
                 ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
               END;
      END;
    END IF;
    -- ISOLATION CHECK for T16: the fingerprint taken before the loop must be unchanged.
    v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '') || '#' || coalesce((SELECT string_agg(pf.id::text || ':' || coalesce(pf.email, '<null>'), '|' ORDER BY pf.id) FROM public.profiles pf WHERE pf.id IN (v_uid, v_ghost_uid)), ''));
    v_iso_runs := v_iso_runs + 1;
    IF v_fp IS DISTINCT FROM v_fp0 THEN
      v_iso_bad := v_iso_bad + 1;
      v_iso_note := v_iso_note || ' T16/phase ' || v_ph || ';';
    END IF;

    -- 093 ITSELF, between the phases. The two statements are the CODE of
    -- supabase/migrations/093_partnership_claim_and_column_guard.sql with its comments left out
    -- (compared with comments and whitespace stripped: identical), wrapped in EXECUTE so they
    -- can sit between the BEFORE run and the AFTER run. The COMMENT ON FUNCTION from that file is
    -- not copied: it writes no data and nothing here asserts on it.
    --
    -- An 'undefined_object' / 42704 from the first EXECUTE is NOT a crash: the policy name has
    -- drifted and 093 is written to fail that way rather than add a second policy.
    IF v_ph = 1 THEN
      RESET ROLE;
      EXECUTE $t093_alter$
ALTER POLICY "Partners can claim partnership by email"
  ON public.partnerships
  USING (
    vendor_org_id IS NULL
    AND partner_email IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND pr.email IS NOT NULL
        AND lower(btrim(pr.email)) = lower(btrim(partnerships.partner_email))
    )
  )
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));
      $t093_alter$;

      EXECUTE $t093_fn$
CREATE OR REPLACE FUNCTION public.partnerships_guard_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_permitted CONSTANT text[] := ARRAY[
    'status',
    'accepted_at',
    'updated_at',
    'payment_terms_requests',
    'vendor_org_id'
  ];
  v_permitted text[];
  v_old_rest  jsonb;
  v_new_rest  jsonb;
  v_moved     text[];
BEGIN
  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION
      'partnerships.lead_org_id is immutable (attempted % -> %)',
      OLD.lead_org_id, NEW.lead_org_id
      USING ERRCODE = '42501';
  END IF;

  IF OLD.vendor_org_id IS NOT NULL AND NEW.vendor_org_id IS NULL THEN
    RAISE EXCEPTION
      'partnerships.vendor_org_id cannot be cleared once set (attempted % -> NULL)',
      OLD.vendor_org_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.vendor_org_id IS DISTINCT FROM OLD.vendor_org_id
     AND NEW.vendor_org_id IS NOT NULL THEN
    IF OLD.vendor_org_id IS NOT NULL THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id cannot be repointed once set (attempted % -> %)',
        OLD.vendor_org_id, NEW.vendor_org_id
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.org_has_member_with_email(NEW.vendor_org_id, NEW.partner_email) THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id % has no member whose email matches partner_email %',
        NEW.vendor_org_id, NEW.partner_email
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_permitted := v_vendor_permitted;
  IF OLD.vendor_org_id IS NULL AND NEW.vendor_org_id IS NOT NULL THEN
    v_permitted := v_permitted || 'profile_status';
  END IF;

  v_old_rest := to_jsonb(OLD) - v_permitted;
  v_new_rest := to_jsonb(NEW) - v_permitted;

  IF v_new_rest = v_old_rest THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k ORDER BY k)
    INTO v_moved
  FROM jsonb_object_keys(v_new_rest) AS k
  WHERE v_new_rest -> k IS DISTINCT FROM v_old_rest -> k;

  RAISE EXCEPTION 'That is not a field you can change on this partnership.'
    USING ERRCODE = 'LG009',
          DETAIL  = format(
            'partnerships.%s may not be written by the vendor on the partnership. Migration 093 guards every column on this table except %s, plus profile_status on the claim transition. The lead agency, the service role, a database function and a migration may all write the rest.',
            array_to_string(v_moved, ', partnerships.'),
            array_to_string(v_permitted, ', ')
          );
END;
$$;
      $t093_fn$;
    END IF;
  END LOOP;

  RESET ROLE;

  -- ===================================================================
  -- T1 - T5. THE PERMITTED WRITES. PASS = the write SUCCEEDED.
  -- A FAIL in this block means 093 BREAKS A LIVE VENDOR ACTION ON APPLY.
  -- It is the most urgent kind of failure in this file.
  -- ===================================================================

  -- T1. W1, app/api/partnerships/route.ts:1029. Accept an invitation.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships
       SET status = 'active', accepted_at = now()
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. The write did not reach the subject row (a zero-row write is not a success); check the subject is visible to the impersonated user.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || 'LG009. status/accepted_at are NOT on the permit list. 093 breaks every invitation accept. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || format('unexpected error %s from a write that must succeed: %s. Read it before deciding; it is not LG009.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T2. W2, app/api/partnerships/route.ts:1179. Decline an invitation.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships
       SET status = 'terminated', updated_at = now()
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. The write did not reach the subject row; check the subject is visible to the impersonated user.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || 'LG009. updated_at is NOT on the permit list. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || format('unexpected error %s from a write that must succeed: %s. Read it before deciding; it is not LG009.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T3. W3, app/partner/projects/page.tsx:366. Request payment terms.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships
       SET payment_terms_requests = '[{"status":"pending","note":"093 pre-apply test"}]'::jsonb
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. The write did not reach the subject row; check the subject is visible to the impersonated user.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || 'LG009. payment_terms_requests is NOT on the permit list. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || format('unexpected error %s from a write that must succeed: %s. Read it before deciding; it is not LG009.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T4. >>> THE ASSERTION THE WHOLE SHAPE DEPENDS ON. <<<
  --
  -- A WHOLE-ROW WRITE naming every guarded column and CHANGING only
  -- `status`. This is what a read-modify-write PATCH produces.
  --
  -- IT PASSES ONLY BECAUSE THE GUARD COMPARES VALUES RATHER THAN THE SET
  -- CLAUSE. A trigger cannot see the SET clause at all, so any
  -- implementation that tried to refuse on "was this column named" would
  -- refuse this write for MENTIONING nda_confirmed_at while sending back
  -- the identical value. A FAIL here is the most important failure in
  -- this file.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    -- ALL TWENTY-FOUR LIVE COLUMNS, self-assigned except `status`. This is
    -- the literal shape of a read-modify-write PATCH and it is the strongest
    -- form of this assertion.
    --
    -- IT USED TO NAME pool_status AND THAT COLUMN DOES NOT EXIST ON THIS
    -- TABLE. The assertion died with 42703 undefined_column and was reported
    -- as a FAIL of the migration, which it was not. Migration 061 adds
    -- pool_status to rfp_magic_tokens, not to partnerships; the original
    -- inventory read its ADD COLUMN lines without checking which of that
    -- file's two ALTER TABLE statements they belonged to. The column list
    -- below is the LIVE one, queried 2026-08-21.
    UPDATE public.partnerships p
       SET status                           = 'active',
           id                               = p.id,
           lead_org_id                      = p.lead_org_id,
           vendor_org_id                    = p.vendor_org_id,
           invitation_message               = p.invitation_message,
           invited_at                       = p.invited_at,
           accepted_at                      = p.accepted_at,
           created_at                       = p.created_at,
           updated_at                       = p.updated_at,
           partner_email                    = p.partner_email,
           nda_confirmed_at                 = p.nda_confirmed_at,
           nda_confirmed_by                 = p.nda_confirmed_by,
           partnership_notes                = p.partnership_notes,
           msa_confirmed_at                 = p.msa_confirmed_at,
           msa_confirmed_by                 = p.msa_confirmed_by,
           payment_terms_requests           = p.payment_terms_requests,
           profile_status                   = p.profile_status,
           invitation_sent_at               = p.invitation_sent_at,
           reliability_summary              = p.reliability_summary,
           reliability_summary_generated_at = p.reliability_summary_generated_at,
           contact_name                     = p.contact_name,
           company_name                     = p.company_name,
           phone                            = p.phone,
           website                          = p.website
     WHERE p.id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('PASS', 14) || '(1 row, value comparison held)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. The write did not reach the subject row; check the subject is visible to the impersonated user.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || 'LG009 ON AN UNCHANGED VALUE. The guard is comparing the SET clause, not values. Every read-modify-write in the product breaks. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || format('unexpected error %s from a write that must succeed: %s. Read it before deciding; it is not LG009.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T5. THE NO-OP. Nothing moves at all. Must leave at exit 1 without
  -- calling auth.uid() or issuing a query.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships p SET status = p.status WHERE p.id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('PASS', 14) || '(1 row, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. The write did not reach the subject row; check the subject is visible to the impersonated user.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T6 - T10. THE REFUSALS. PASS = the write RAISED LG009.
  -- A "no error" here is the hole still being open.
  -- ===================================================================

  -- T6. Self-confirming the NDA the agency is supposed to confirm.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET nda_confirmed_at = now() WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). OPEN-092-9 IS STILL OPEN. DO NOT APPLY on the belief it is closed.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T7. Rewriting the agency's private notes, which hold {blacklisted}.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET partnership_notes = '{"blacklisted":false}'::jsonb WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The vendor can still rewrite the agency''s notes.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T8. Authoring its own AI performance narrative.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET reliability_summary = 'Flawless.' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The vendor can still author the agency''s view of its performance.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T9. Rewriting the pre-claim identifier the claim policy keys on.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET partner_email = 'moved@example.com' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The claim key is still vendor-writable.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T10. profile_status OUTSIDE the claim transition. This is the
  -- conditional half of the permit list. The row already has a
  -- vendor_org_id, so 'profile_status' is NOT on the list for this write
  -- and 'removed' must be refused - it is how an agency hides a row from
  -- its own pool.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET profile_status = 'removed' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The conditional permit is unconditional. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('PASS', 14) || '(LG009, refused off the claim transition)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T11. 087 IS STILL THERE AND STILL SPEAKS FIRST.
  -- PASS = 42501 carrying 087's own message, NOT LG009. If this returns
  -- LG009 the permit list has been placed ABOVE 087's refusals and the
  -- specific diagnosis has been replaced by a generic one.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET lead_org_id = v_org WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). MIGRATION 087 HAS BEEN UNDONE by this file. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      -- 42501 is BOTH 087's chosen ERRCODE and the code for a missing
      -- table grant, so the message is what tells them apart.
      IF SQLERRM LIKE '%lead_org_id is immutable%' THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('PASS', 14) || '(42501, 087''s own message, ahead of the permit list)';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('INCONCLUSIVE', 14) || format('42501 but not 087''s message: %s', SQLERRM);
        v_inconc := v_inconc + 1;
      END IF;
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || 'LG009, not 087''s 42501. The permit list is running BEFORE 087''s refusals and has replaced a precise diagnosis with a generic one.';
      v_fail := v_fail + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || format('refused with %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T12. THE AGENCY SIDE IS UNAFFECTED. EXIT 3.
  --
  -- The lead agency writing nda_confirmed_at is the LEGITIMATE writer
  -- (app/api/partnerships/route.ts:849). PASS = it still succeeds.
  --
  -- EXTENDED 2026-08-25 to write the four ghost-contact columns in the same
  -- statement, now that RULED-093-1 guards them from the vendor. It is the
  -- agency-side control for T17.
  --
  -- >>> BE PRECISE ABOUT WHAT THIS PROVES, BECAUSE IT IS LESS THAN IT LOOKS.
  -- >>> An agency session returns at EXIT 3, which is ABOVE the permit list
  -- >>> and does not consult it. So a PASS here demonstrates THAT EXIT 3
  -- >>> FIRES FOR THE LEAD AGENCY - and nothing whatever about whether those
  -- >>> four columns are on any list. The same PASS would appear if the
  -- >>> permit list were empty, or held all 24 names.
  -- >>>
  -- >>> That is exactly why it is worth asserting. The RULED-093-1 reasoning
  -- >>> turns on "guarding forecloses nothing, because the agency exits above
  -- >>> the list". THIS ASSERTION IS THE EVIDENCE FOR THAT CLAUSE. If it ever
  -- >>> fails, the ruling's premise is false and the four columns would have
  -- >>> to be reconsidered - not because the vendor lost something, but
  -- >>> because the AGENCY did.
  -- >>>
  -- >>> The claim "the vendor cannot write them" is T17's to make, and only
  -- >>> T17's.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_agency_uid IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('INCONCLUSIVE', 14) || 'the lead organization has no org_members row. Exit 3 was never exercised.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_agency_claims,    true);
      PERFORM set_config('request.jwt.claim.sub', v_agency_uid::text, true);
      SET LOCAL ROLE authenticated;
      IF auth.uid() IS DISTINCT FROM v_agency_uid THEN
        RAISE EXCEPTION 'impersonation mismatch (the lead agency member): auth.uid() is %, expected %', auth.uid(), v_agency_uid
          USING ERRCODE = 'LG098';
      END IF;
      UPDATE public.partnerships
         SET nda_confirmed_at = now(),
             nda_confirmed_by = v_agency_uid,
             -- The four RULED-093-1 columns. Distinct values, so they really
             -- move and the write cannot pass by leaving at EXIT 1.
             contact_name     = 'T12 agency-written contact',
             company_name     = 'T12 agency-written company',
             phone            = '093-111-1111',
             website          = 'https://example.invalid/t12'
       WHERE id = v_pship;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('PASS', 14) || '(1 row; proves EXIT 3 fires, not that the cols are permitted)';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. 093 BREAKS NDA CONFIRMATION and the agency-side control for RULED-093-1 is unproved.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN sqlstate 'LG009' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('FAIL', 14) || 'LG009 AT THE AGENCY. EXIT 3 IS NOT FIRING. 093 breaks every NDA and MSA confirmation, AND RULED-093-1''s premise - that guarding the contact columns forecloses nothing because the agency exits above the list - IS FALSE. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
        v_inconc := v_inconc + 1;
      WHEN sqlstate 'LG098' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 agency writes guarded cols', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T13 - T15. HOLE 1, THE CLAIM POLICY.
  -- ===================================================================

  -- T13. THE PREDICATE ITSELF. Structural, and it is here because it is
  -- the only assertion that cannot be faked by the data happening to
  -- cooperate: it reads what the policy actually says.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT qual LIKE '%btrim%', qual LIKE '%~~*%'
      INTO v_uses_btrim, v_uses_ilike
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'partnerships'
      AND policyname = 'Partners can claim partnership by email';
    IF v_uses_btrim IS NULL THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || 'the policy does not exist under that name. The ALTER in section A cannot have run.';
      v_fail := v_fail + 1;
    ELSIF v_uses_btrim AND NOT v_uses_ilike THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('PASS', 14) || '(btrim present, ~~* gone)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || format('btrim=%s ilike=%s. OPEN-092-8 IS STILL OPEN.', v_uses_btrim, v_uses_ilike);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T14, T15a, T15b, T15c, T16. THE CLAIM VERDICTS.
  --
  -- Judged from the measurements the probe loop took. Index 1 is BEFORE 093
  -- and index 2 is AFTER. Only the AFTER column decides a verdict; the BEFORE
  -- column is what makes a zero MEAN something. A test that cannot fail is
  -- not evidence, which is the defect the previous T14 and T16 had: they
  -- named a column in their WHERE and so returned zero under ANY claim policy.
  --
  -- Every FAIL below names the cause the measurement actually shows.
  -- ===================================================================

  v_pre_note := CASE
    WHEN v_pre_ilike IS NULL THEN 'policy not found'
    WHEN v_pre_ilike THEN 'old policy'
    ELSE 'NOT the old policy: 093 or an equivalent was already applied'
  END;

  -- T14. THE WILDCARD, BEHAVIOURALLY.
  --
  -- The T1-T12 subject's profile email is set to '%' (as the owner, undone with the probe) and
  -- that user then runs a NO-WHERE claim of every unclaimed row into their own organization.
  -- Under the old ~~* policy the pattern '%' matches every row, so the statement REACHES them
  -- (087's trigger refuses the first row that is not theirs, 23514). Under 093 it must reach none.
  --
  -- A zero AFTER is only credited to 093 when the BEFORE run was admitted. If the old policy
  -- also admitted nothing, the probe cannot tell a closed wildcard from a vacuous test and the
  -- answer is INCONCLUSIVE, never PASS.
  v_ran := v_ran + 1;
  IF v_unclaimed = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || 'no partnership has vendor_org_id IS NULL, so there is nothing a wildcard could claim. HOLE 1 was never exercised.';
    v_inconc := v_inconc + 1;
  ELSIF v_uid_lead > 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || 'the wildcard claimer is also a member of a lead organization, whose agency update policy would admit rows and blur the probe. HOLE 1 was never exercised.';
    v_inconc := v_inconc + 1;
  ELSIF w14_class[1] LIKE 'FAULT%' OR w14_class[2] LIKE 'FAULT%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 093.', w14_class[1], w14_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF w14_class[2] LIKE 'REACHED%' OR coalesce(w14_new[2], 0) > 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('FAIL', 14) || format('AFTER 093 the wildcard email still reaches unclaimed rows (%s; newly claimed: %s). The claim policy still admits a pattern match. HOLE 1 IS OPEN.', w14_class[2], coalesce(w14_new[2], 0));
    v_fail := v_fail + 1;
  ELSIF w14_class[2] <> 'DONE' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || format('the AFTER probe errored: %s. HOLE 1 was not exercised.', w14_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF NOT coalesce(v_pre_ilike, false) THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || 'the ~~* policy was not live when this paste started (093 or an equivalent is already applied), so there is no old-policy run to contrast with and a zero here cannot be credited to 093. Run this before applying to get the contrast.';
    v_inconc := v_inconc + 1;
  ELSIF w14_class[1] LIKE 'REACHED%' OR coalesce(w14_new[1], 0) > 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('PASS', 14) || format('(BEFORE, old policy: %s, newly claimed %s. AFTER, 093: nothing reached, nothing claimed.)', w14_class[1], coalesce(w14_new[1], 0));
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || format('NOT DISCRIMINATING. The OLD policy also reached nothing in this run (BEFORE: %s, newly claimed %s), so the zero AFTER cannot be credited to 093.', w14_class[1], coalesce(w14_new[1], 0));
    v_inconc := v_inconc + 1;
  END IF;

  -- T15a. >>> A LEGITIMATE CLAIM IS STILL ADMITTED BY THE POLICY. <<<
  --
  -- The claimer (a real profile whose email equals an unclaimed row's partner_email, in exactly
  -- one organization, in no lead organization) runs a NO-WHERE claim of vendor_org_id,
  -- profile_status and updated_at: W4's write set, without W4's WHERE. Only the UPDATE policies
  -- govern it. PASS needs ALL of: the statement completed, the number of rows newly claimed (counted
  -- by the owner) equals the number the policy's predicate should admit (computed by the owner
  -- beforehand), and the subject row itself reads as claimed to the owner afterwards.
  --
  -- This proves the POLICY and the permit-list claim transition. It does NOT prove production
  -- claims work: that is T15b, and the answer there is that it does not.
  v_ran := v_ran + 1;
  IF v_ghost IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('INCONCLUSIVE', 14) || format('no claimable subject: an unclaimed partnership whose partner_email matches a profile that is in exactly one organization, in no lead organization, and not a member of that row''s lead. Looser subject exists for %s partnership(s). The claim policy was NEVER EXERCISED.', v_ghost_loose);
    v_inconc := v_inconc + 1;
  ELSIF a15_class[2] LIKE 'FAULT%' OR a15_class[1] LIKE 'FAULT%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 093.', a15_class[1], a15_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF a15_class[2] = 'REACHED:LG009 (093 guard refused)' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('FAIL', 14) || 'LG009. The policy admitted the row and 093''s guard then refused the claim write: the permit list does not allow the claim transition (profile_status, vendor_org_id, updated_at). Every claim write breaks on apply. DO NOT APPLY.';
    v_fail := v_fail + 1;
  ELSIF a15_class[2] LIKE 'REACHED:WITHCHECK%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('FAIL', 14) || 'the claim policy''s USING admitted the row and its WITH CHECK refused a claim into the claimer''s own organization. 093''s ALTER changed the WITH CHECK or the claimer is not in the organization they claim into.';
    v_fail := v_fail + 1;
  ELSIF a15_class[2] LIKE 'REACHED:23514%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('INCONCLUSIVE', 14) || '087''s org_has_member_with_email refused: a row the policy admitted is addressed to an email no member of the chosen organization has. Says nothing about 093''s policy or guard.';
    v_inconc := v_inconc + 1;
  ELSIF a15_class[2] <> 'DONE' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('INCONCLUSIVE', 14) || format('the AFTER probe errored: %s. The claim policy was not exercised.', a15_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF coalesce(a15_exp[2], 0) < 1 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('INCONCLUSIVE', 14) || 'the claimer has no unclaimed row their email matches under 093''s predicate, so there is nothing to claim.';
    v_inconc := v_inconc + 1;
  ELSIF a15_new[2] = a15_exp[2] AND coalesce(a15_post[2], false) THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('PASS', 14) || format('(AFTER, 093: claimed %s of %s expected, subject row claimed. BEFORE, %s: claimed %s of %s expected, subject claimed: %s)', a15_new[2], a15_exp[2], v_pre_note, a15_new[1], a15_exp[1], a15_post[1]);
    v_pass := v_pass + 1;
  ELSIF coalesce(a15_new[2], 0) = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('FAIL', 14) || format('093''s claim policy admitted NONE of the %s unclaimed row(s) its own predicate matches for this claimer, with no SELECT filter in the way. The claim policy rejects a legitimate claim. DO NOT APPLY.', a15_exp[2]);
    v_fail := v_fail + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15a claim policy admits a claim', 40) || rpad('FAIL', 14) || format('claimed %s row(s), the predicate says %s; subject row claimed: %s. The claim policy admits a different set from its own predicate. DO NOT APPLY.', a15_new[2], a15_exp[2], a15_post[2]);
    v_fail := v_fail + 1;
  END IF;

  -- T15b. THE PRODUCTION-SHAPED CLAIM. >>> A KNOWN LIMIT, NOT A VERDICT ON 093. <<<
  --
  -- W4 (app/auth/callback/route.ts) and the GET /partnerships auto-claim both claim with a WHERE that
  -- names columns. That statement must also pass the SELECT policies, and the claimer passes none of
  -- them for an unclaimed row, so it matches ZERO ROWS and returns no error. EXECUTED evidence of the
  -- invisibility: docs/093-t15-investigation.md section 1. The same happens under the OLD policy,
  -- which is what the BEFORE column shows. It is PRE-EXISTING and 093 neither causes nor fixes it.
  --
  -- It is counted separately (KNOWN LIMIT) and is neither PASS nor FAIL. It must never produce
  -- "DO NOT APPLY". The only way this line fails is if the statement REACHED a row and 093's guard
  -- refused it, which would be a real 093 defect.
  v_ran := v_ran + 1;
  IF v_ghost IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('INCONCLUSIVE', 14) || 'no claimable subject, so the production-shaped claim was not run.';
    v_inconc := v_inconc + 1;
  ELSIF b15_class[2] LIKE 'FAULT%' OR b15_class[1] LIKE 'FAULT%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 093.', b15_class[1], b15_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF b15_class[2] = 'REACHED:LG009 (093 guard refused)' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('FAIL', 14) || 'LG009. The production-shaped claim REACHED the row and 093''s guard refused it. That is a real defect in 093''s claim transition.';
    v_fail := v_fail + 1;
  ELSIF b15_class[2] = 'DONE' AND b15_rows[2] = 0 THEN
    v_limit := v_limit + 1;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('KNOWN LIMIT', 14) || format('(0 rows, as expected. KNOWN LIMIT: the claim path is unreachable from a user session because of SELECT visibility. PRE-EXISTING, not introduced by 093. BEFORE, %s: %s rows.)', v_pre_note, coalesce(b15_rows[1]::text, b15_class[1]));
  ELSIF b15_class[2] = 'DONE' AND b15_rows[2] >= 1 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('PASS', 14) || format('(%s row(s) claimed by the production-shaped statement: THE LIMIT HAS LIFTED. A SELECT policy now lets the claimer see the row. Update T15b and docs/093-t15-investigation.md.)', b15_rows[2]);
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15b production-shaped claim', 40) || rpad('INCONCLUSIVE', 14) || format('the AFTER probe errored: %s.', b15_class[2]);
    v_inconc := v_inconc + 1;
  END IF;

  -- T15c. THE VISIBILITY CONTROL. Expected 0, and it is the EXECUTED observation (user, 2026-10-08)
  -- kept as a standing assertion: the claimer, impersonated, counts the subject row and the whole
  -- table. It explains T15b rather than inferring it. A non-zero count means the SELECT policies
  -- changed, which a human must read: T15b will then read differently too.
  v_ran := v_ran + 1;
  IF v_ghost IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15c claimer cannot see the row', 40) || rpad('INCONCLUSIVE', 14) || 'no claimable subject, so the visibility control was not run.';
    v_inconc := v_inconc + 1;
  ELSIF c15_class[2] LIKE 'FAULT%' OR c15_class[1] LIKE 'FAULT%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15c claimer cannot see the row', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 093.', c15_class[1], c15_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF c15_class[2] <> 'DONE' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15c claimer cannot see the row', 40) || rpad('INCONCLUSIVE', 14) || format('the AFTER probe errored: %s.', c15_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF c15_cnt[2] = 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15c claimer cannot see the row', 40) || rpad('PASS', 14) || format('(control: the claimer sees %s of the subject row and %s partnership row(s) in all. BEFORE, %s: %s and %s. This is why T15b reads 0.)', c15_cnt[2], c15_all[2], v_pre_note, c15_cnt[1], c15_all[1]);
    v_pass := v_pass + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15c claimer cannot see the row', 40) || rpad('INCONCLUSIVE', 14) || format('the claimer CAN see the subject row (count %s). The SELECT policies are not what docs/093-t15-investigation.md recorded. Re-read it before trusting T15b.', c15_cnt[2]);
    v_inconc := v_inconc + 1;
  END IF;

  -- T16. A CLAIMED ROW IS NOT CLAIMABLE, AND IT FAILS FOR THE RIGHT REASON.
  --
  -- The subject belongs to a THIRD organization. Before the claimer runs, the OWNER rewrites that
  -- row's partner_email to the claimer's own email (undone with the probe), so the claim policy's
  -- email term is TRUE for it and the only thing that can keep the row out is `vendor_org_id IS
  -- NULL`. The claimer then runs a NO-WHERE claim into their own organization. PASS = the row's
  -- vendor_org_id is unchanged afterwards and the statement did not reach it, in BOTH runs.
  -- A leak shows as REACHED (087 refusing the repoint, which means a POLICY admitted the row) or
  -- as MOVED (the row is now the claimer's).
  v_ran := v_ran + 1;
  IF v_claimed_other IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('INCONCLUSIVE', 14) || 'no partnership is claimed by an organization other than the subject''s. The negative control was never exercised.';
    v_inconc := v_inconc + 1;
  ELSIF v_uid_lead > 0 THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('INCONCLUSIVE', 14) || 'the claimer is also a member of a lead organization, whose agency update policy would admit rows and blur the probe.';
    v_inconc := v_inconc + 1;
  ELSIF t16_class[2] LIKE 'FAULT%' OR t16_class[1] LIKE 'FAULT%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 093.', t16_class[1], t16_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF t16_class[2] = 'MOVED' OR t16_class[2] LIKE 'REACHED%' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('FAIL', 14) || format('AFTER 093 the claim reached an ALREADY-CLAIMED row (%s). The claim policy no longer requires vendor_org_id IS NULL, or something else admits the row.', t16_class[2]);
    v_fail := v_fail + 1;
  ELSIF t16_class[2] <> 'DONE' THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('INCONCLUSIVE', 14) || format('the AFTER probe errored: %s. (23505 would be 084''s unique index on lead_org_id + partner_email: the rewritten email collides.)', t16_class[2]);
    v_inconc := v_inconc + 1;
  ELSIF NOT coalesce(t16_match[2], false) THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('INCONCLUSIVE', 14) || 'the setup did not make the email term true for the third-organization row, so the probe would pass vacuously.';
    v_inconc := v_inconc + 1;
  ELSE
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T16 claimed row is not claimable', 40) || rpad('PASS', 14) || format('(row untouched with its email term made TRUE. AFTER, 093: %s. BEFORE, %s: %s.)', t16_class[2], v_pre_note, t16_class[1]);
    v_pass := v_pass + 1;
  END IF;

  -- ===================================================================
  -- T17 - T19. THE RECONCILIATION AGAINST THE LIVE TABLE, ASSERTED.
  --
  -- After this block every one of the 24 live columns has been exercised by
  -- some assertion in this file, on the side THE RECONCILIATION claims for
  -- it. A disposition nobody tested is a guess.
  -- ===================================================================

  -- T17. THE FOUR GHOST-CONTACT COLUMNS ARE REFUSED. RULED-093-1.
  --
  -- contact_name, company_name, phone and website. They were briefly left on
  -- the permit list while the question was open; Greg ruled on 2026-08-25
  -- that a vendor may not write them, and this assertion is the flip.
  --
  -- WHY IT MATTERS, in one line each: contact_name is rendered by
  -- app/api/agency/pool/[partnerId]/route.ts:239 as the fallback for a
  -- missing full_name, so a vendor writing it RENAMES ITSELF inside the
  -- agency's own pool record; and `website` puts a VENDOR-CONTROLLED URL
  -- inside a trusted agency surface.
  --
  -- ONE STATEMENT, FOUR COLUMNS. That is deliberate and it is the weaker
  -- form: the guard raises on the FIRST difference it finds, so a PASS here
  -- proves at least one of the four is guarded, not all four. T19's sweep is
  -- the per-column shape and this is not it. The four were added to and
  -- removed from v_vendor_permitted as a block, by one ruling, so they are
  -- asserted as a block - but if that ever stops being true, split this.
  --
  -- IT MUST BE LG009 SPECIFICALLY. A write that fails with some other code
  -- has not been refused by this guard; it has hit a constraint, a missing
  -- grant, or a bug, and reporting that as a pass would be reporting a
  -- different defect wearing the same result. Same shape as T6-T10.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships
       SET contact_name = '093 test contact',
           company_name = '093 test company',
           phone        = '093-000-0000',
           website      = 'https://example.invalid/093'
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The vendor can still rename itself inside the agency''s pool record. RULED-093-1 is not in force.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T17 vendor rewrites contact cols', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T18. THE MSA HALF OF THE PAIR. T6 covers nda_confirmed_at. The header
  -- names the MSA columns among the four that make this migration worth
  -- doing, and until now nothing exercised them.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET msa_confirmed_at = now() WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). A vendor can still confirm its own MSA.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T18 vendor self-confirms MSA', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T19. THE REST OF THE GUARDED SET, ONE COLUMN AT A TIME.
  --
  -- T6-T10, T11 and T18 cover the guarded columns that matter most. These
  -- seven are the remainder, and they are here because THE RECONCILIATION in
  -- 093's header calls them GUARDED-BY-093 and an untested claim in a header
  -- is a guess.
  --
  -- ONE ASSERTION, SEVEN STATEMENTS. Each column is moved on its own, in its
  -- own subtransaction, so a column that slips through is NAMED rather than
  -- masked by its neighbours. A single statement moving all seven would
  -- raise on the first difference and prove nothing about the other six.
  --
  -- Every value is chosen to be genuinely DIFFERENT from what is in the row.
  -- A write that does not move the value leaves at EXIT 1 and would be
  -- counted as a refusal it never was.
  --
  -- `id` is deliberately absent. It is guarded by the permit list like
  -- everything else, and changing a primary key that four foreign keys point
  -- at is a pathological write no caller makes.
  -- `lead_org_id` is absent because it is T11, and it belongs to 087.
  v_ran := v_ran + 1;
  DECLARE
    v_cols text[] := ARRAY[
      'created_at', 'invitation_message', 'invited_at', 'invitation_sent_at',
      'nda_confirmed_by', 'msa_confirmed_by', 'reliability_summary_generated_at'
    ];
    v_vals text[] := ARRAY[
      '''1999-01-01T00:00:00Z''::timestamptz',
      '''093 sweep''::text',
      '''1999-01-01T00:00:00Z''::timestamptz',
      '''1999-01-01T00:00:00Z''::timestamptz',
      quote_literal(v_uid::text) || '::uuid',
      quote_literal(v_uid::text) || '::uuid',
      '''1999-01-01T00:00:00Z''::timestamptz'
    ];
    v_i       integer;
    v_refused integer := 0;
    v_fault   integer := 0;
    v_leaked  text := '';
  BEGIN
    FOR v_i IN 1 .. array_length(v_cols, 1) LOOP
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    v_claims,    true);
        PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_uid THEN
          RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
            USING ERRCODE = 'LG098';
        END IF;
        EXECUTE format('UPDATE public.partnerships SET %I = %s WHERE id = $1',
                       v_cols[v_i], v_vals[v_i])
          USING v_pship;
        RESET ROLE;
        -- No error means the guard ADMITTED it. Name it.
        v_leaked := v_leaked || CASE WHEN v_leaked = '' THEN '' ELSE ', ' END || v_cols[v_i];
      EXCEPTION
        WHEN sqlstate 'LG009' THEN
          RESET ROLE;
          v_refused := v_refused + 1;
        WHEN sqlstate 'LG098' THEN
          RESET ROLE;
          v_fault := v_fault + 1;
        WHEN OTHERS THEN
          RESET ROLE;
          v_leaked := v_leaked || CASE WHEN v_leaked = '' THEN '' ELSE ', ' END
                   || format('%s(%s)', v_cols[v_i], SQLSTATE);
      END;
    END LOOP;
    RESET ROLE;
    IF v_fault > 0 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T19 remaining guarded columns', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take on %s of %s statements. Says nothing about 093.', v_fault, array_length(v_cols, 1));
      v_inconc := v_inconc + 1;
    ELSIF v_refused = array_length(v_cols, 1) THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T19 remaining guarded columns', 40) || rpad('PASS', 14) || format('(all %s refused with LG009)', v_refused);
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T19 remaining guarded columns', 40) || rpad('FAIL', 14) || format('%s of %s refused. NOT REFUSED: %s', v_refused, array_length(v_cols, 1), v_leaked);
      v_fail := v_fail + 1;
    END IF;
  END;

  -- T20. >>> THE JSONB-SUBTRACTION CLAIM, PROVED AGAINST A REAL ROW. <<<
  --
  -- The whole guard rests on one property: taking a name OFF
  -- v_vendor_permitted makes that column guarded, by omission, with no other
  -- edit. WHY REMOVAL IS SYMMETRIC WITH ADDITION in 093's header argues that
  -- from the documented semantics of to_jsonb() and `jsonb - text[]`. This
  -- assertion is the part that argument cannot supply: EVIDENCE.
  --
  -- The case worth proving is value -> NULL, and here is why it is the one:
  --
  --   IF to_jsonb() OMITTED null-valued keys - which it does not, but the
  --   whole design would fail silently if it did - then clearing a guarded
  --   column would DELETE its key from v_new_rest while leaving it in
  --   v_old_rest. Whether the two objects still compared unequal would then
  --   depend on key presence rather than on value, and a reader would have
  --   no way to tell from a green run which of the two mechanisms had
  --   carried it. Every OTHER assertion in this file moves a column from one
  --   non-null value to another, so not one of them touches this.
  --
  -- T12 has just written nda_confirmed_at = now(), so it is reliably NOT
  -- NULL when this runs. Clearing it is therefore a genuine value -> NULL
  -- move, and it is a guarded column, so the correct answer is LG009.
  --
  -- A "NO ERROR" HERE IS THE SERIOUS OUTCOME. It would mean a vendor can
  -- CLEAR any guarded column - erase the agency's NDA confirmation, blank
  -- the notes, delete the reliability narrative - while every
  -- value-to-value assertion in this file still passed. That is a hole that
  -- reads as closed.
  v_ran := v_ran + 1;
  BEGIN
    -- ESTABLISH THE PRECONDITION RATHER THAN INHERITING IT. T12 leaves
    -- nda_confirmed_at non-null, but T12 can be INCONCLUSIVE when the lead
    -- organization has no member, and then this column could be NULL and the
    -- clear below would be a NULL -> NULL no-op. That leaves at EXIT 1 with
    -- no error, which this assertion would report as a FAIL it is not.
    --
    -- CLEAR THE CLAIMS FIRST. EXIT 2 tests auth.uid(), which reads a GUC, NOT
    -- the database role - and set_config(..., true) is local to the
    -- TRANSACTION. A postgres-role write with a previous test's `sub` still
    -- set is treated as that user and would be refused with LG009 here.
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid()
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET nda_confirmed_at = now() WHERE id = v_pship;

    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    IF auth.uid() IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'impersonation mismatch (the vendor subject): auth.uid() is %, expected %', auth.uid(), v_uid
        USING ERRCODE = 'LG098';
    END IF;
    UPDATE public.partnerships SET nda_confirmed_at = NULL WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    IF v_rows = 0 THEN
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('INCONCLUSIVE', 14) || 'the write matched 0 rows and raised nothing, so the guard was never reached. Says nothing about 093; the subject row may not be visible to the impersonated user.';
      v_inconc := v_inconc + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('FAIL', 14) || format('NO ERROR - cleared %s row(s). A vendor can BLANK any guarded column. to_jsonb() is not emitting null-valued keys and the permit list is only half working. DO NOT APPLY.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('PASS', 14) || '(LG009; value -> NULL is detected, so removal from the permit list is symmetric)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN sqlstate 'LG098' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take: %s. The write was not made as the intended user. Says nothing about 093.', SQLERRM);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T20 guarded col cleared to NULL', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  IF v_logged <> v_ran
     OR v_pass + v_fail + v_inconc + v_limit <> v_logged
     OR v_ran <> 22
     OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 093.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s known_limit=%s (expected ran 22); isolation failures=%s%s. The report below is incomplete or contaminated and no verdict drawn from it means anything.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, v_limit, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a probe leaked into the next one:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass + v_limit = 22 THEN
    v_verdict_text := 'SAFE TO APPLY 093.';
    v_headline     := format('SAFE TO APPLY 093.  %s of 22 assertions passed, %s KNOWN LIMIT (pre-existing, NOT introduced and NOT fixed by 093: the claim path is unreachable from a user session; see docs/093-t15-investigation.md).', v_pass, v_limit);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but something 093 exists to do was never actually attempted, so this
    -- run says nothing at all about it.
    v_headline     := format('DO NOT APPLY 093 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 093 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 093.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECKS ARE THE FIRST BRANCH ABOVE, so they outrank SAFE TO APPLY
  -- and every other headline: an incomplete or contaminated report cannot be
  -- read as a clean one. They are: every assertion that ran also logged
  -- (v_ran = v_logged), every logged verdict was counted exactly once
  -- (pass + fail + inconclusive + known limit = v_logged), the assertion
  -- count is the one this file claims (22), and no probe leaked (v_iso_bad).

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE CLAIM TABLE, THEN
  -- THE PER-ASSERTION LINES. A client that truncates a long error message
  -- truncates the END of it, so the verdict and the counts must be at the TOP
  -- where they survive. The 22 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_ba :=
       E'CLAIM VERDICTS, BEFORE 093 AND AFTER (same probes, same subjects, same transaction)\n'
    || '  state when this paste started : '
    || CASE WHEN v_pre_ilike IS NULL THEN 'the claim policy was NOT FOUND'
            WHEN v_pre_ilike THEN 'the OLD ~~* policy was LIVE, so BEFORE is the old policy'
            ELSE 'NOT ~~*: 093 or an equivalent was ALREADY APPLIED, so BEFORE is NOT the old policy' END || E'\n'
    || E'  T14  wildcard email, no-WHERE claim of every unclaimed row\n'
    || E'      EXPECTED : BEFORE reached (087 refuses the first row, 23514) or claimed rows; AFTER nothing reached, nothing claimed\n'
    || '      BEFORE   : ' || CASE WHEN w14_class[1] = 'DONE' THEN format('completed; newly claimed %s of %s unclaimed rows', w14_new[1], v_unclaimed) ELSE w14_class[1] END || E'\n'
    || '      AFTER    : ' || CASE WHEN w14_class[2] = 'DONE' THEN format('completed; newly claimed %s of %s unclaimed rows', w14_new[2], v_unclaimed) ELSE w14_class[2] END || E'\n'
    || E'  T15a claim policy admits a legitimate claim (no-WHERE probe)\n'
    || E'      EXPECTED : BEFORE and AFTER both claim every row the predicate matches, subject row claimed\n'
    || '      BEFORE   : ' || CASE WHEN a15_class[1] = 'DONE' THEN format('completed; claimed %s of %s expected; subject row claimed: %s', a15_new[1], a15_exp[1], a15_post[1]) ELSE a15_class[1] END || E'\n'
    || '      AFTER    : ' || CASE WHEN a15_class[2] = 'DONE' THEN format('completed; claimed %s of %s expected; subject row claimed: %s', a15_new[2], a15_exp[2], a15_post[2]) ELSE a15_class[2] END || E'\n'
    || E'  T15b production-shaped claim (WHERE id = subject)\n'
    || E'      EXPECTED : BEFORE and AFTER both 0 rows: KNOWN LIMIT, pre-existing\n'
    || '      BEFORE   : ' || CASE WHEN b15_class[1] = 'DONE' THEN format('completed; %s row(s) matched', b15_rows[1]) ELSE b15_class[1] END || E'\n'
    || '      AFTER    : ' || CASE WHEN b15_class[2] = 'DONE' THEN format('completed; %s row(s) matched', b15_rows[2]) ELSE b15_class[2] END || E'\n'
    || E'  T15c visibility control (the claimer own count)\n'
    || E'      EXPECTED : BEFORE and AFTER both 0\n'
    || '      BEFORE   : ' || CASE WHEN c15_class[1] = 'DONE' THEN format('completed; the subject row counts %s, the whole table counts %s', c15_cnt[1], c15_all[1]) ELSE c15_class[1] END || E'\n'
    || '      AFTER    : ' || CASE WHEN c15_class[2] = 'DONE' THEN format('completed; the subject row counts %s, the whole table counts %s', c15_cnt[2], c15_all[2]) ELSE c15_class[2] END || E'\n'
    || E'  T16  already-claimed row, email term made true\n'
    || E'      EXPECTED : BEFORE and AFTER both untouched\n'
    || '      BEFORE   : ' || CASE WHEN t16_class[1] = 'DONE' THEN 'completed; the third-organization row is untouched' WHEN t16_class[1] = 'MOVED' THEN 'the third-organization row was MOVED' ELSE t16_class[1] END || E'\n'
    || '      AFTER    : ' || CASE WHEN t16_class[2] = 'DONE' THEN 'completed; the third-organization row is untouched' WHEN t16_class[2] = 'MOVED' THEN 'the third-organization row was MOVED' ELSE t16_class[2] END || E'\n'
    || E'\n';

  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 22)\n', v_ran)
    || format(E'PASS            : %s   (expected 21; 22 if the claim limit has lifted)\n', v_pass)
    || format(E'KNOWN LIMIT     : %s   (expected 1: T15b, pre-existing, NOT a verdict on 093)\n', v_limit)
    || format(E'FAIL            : %s   (expected 0)\n',  v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n',  v_inconc)
    -- THE SELF-CHECKS, IN THE OUTPUT RATHER THAN INFERRED FROM IT. v_ran is
    -- incremented by the assertions themselves and v_logged by the report
    -- sites, so the two numbers are counted independently. Equal means every
    -- assertion that ran also reported. The tally check ties the four outcome
    -- counters to v_logged. The isolation check is the fingerprint compare.
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n',
              v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'tally check     : %s   (pass + known limit + fail + inconclusive, must equal verdicts logged: %s)\n',
              v_pass + v_limit + v_fail + v_inconc,
              CASE WHEN v_pass + v_limit + v_fail + v_inconc = v_logged THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s probe(s) each compared to the pre-loop fingerprint: %s\n',
              v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || E'\n'
    || v_ba
    || 'PERMIT LIST     : status, accepted_at, updated_at, payment_terms_requests, vendor_org_id' || E'\n'
    || '                  (+ profile_status on the claim transition only)' || E'\n'
    || '                  5 permitted + 1 conditional + 17 guarded + 1 pinned by 087 = 24' || E'\n'
    || format(E'SUBJECT (T1-T14, T16-T20) : user %s, vendor org %s, partnership %s\n', v_uid, v_org, v_pship)
    || format(E'SUBJECT (T15a-c claim)    : %s  partnership %s, claimer %s, into org %s%s\n',
              CASE WHEN v_ghost IS NULL THEN 'NONE FOUND' ELSE coalesce(v_ghost_email, '?') END,
              coalesce(v_ghost::text, '-'), coalesce(v_ghost_uid::text, '-'), coalesce(v_ghost_org::text, '-'),
              CASE WHEN v_ghost = '55ba0c93-d5f3-4b39-9825-b423dc4456eb'::uuid THEN '  (the row the 2026-10-08 live evidence was taken on)' ELSE '' END)
    || format(E'SUBJECT (T16 negative)    : partnership %s\n', coalesce(v_claimed_other::text, 'NONE FOUND'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089 to 093 define (nor the test's own
  -- LG097 probe sentinel and LG098 impersonation fault, which never leave this
  -- block). The default P0001 (raise_exception) is correct and deliberate.
  RAISE EXCEPTION '%', v_report;
END
$test$;


-- =====================================================================
-- THE BACKSTOP. IT STAYS.
--
-- IT IS NOT REACHED ON THE EXPECTED PATH. The DO block above ends in
-- RAISE EXCEPTION, and the outer block has no handler, so the exception
-- propagates out of section B, aborts the transaction, and every
-- statement after it - including this one - is skipped.
--
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for
-- the case where that exception is CAUGHT rather than propagated: an
-- enclosing EXCEPTION handler added here later, or a client that wraps
-- the batch in its own block and swallows the error. In that case the
-- transaction is still open and still holds an ALTER POLICY, a CREATE OR
-- REPLACE FUNCTION (both now run via EXECUTE inside the probe loop), a dozen
-- UPDATEs against a real partnership, and - only if a probe's own
-- subtransaction rollback somehow did not happen - a write to a real
-- profiles.email and claims against real ghost rows. This line is the only
-- thing that undoes them.
-- =====================================================================
ROLLBACK;
