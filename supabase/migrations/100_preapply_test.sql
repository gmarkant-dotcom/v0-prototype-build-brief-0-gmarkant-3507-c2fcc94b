-- =====================================================================
-- 100 PRE-APPLY TEST. ONE PASTE. APPLIES 100, WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 100 proves the policy parses. It says NOTHING about the
-- only four questions that matter, and every one of them is a WRITE:
--
--   * does branch B actually admit the vendor it was written for,
--   * does it refuse the three forgeries it was written against,
--   * did replacing the policy silently weaken branch A, and
--   * what happens to the overlap case, which is the steady state.
--
-- >>> A POLICY THAT IS TOO PERMISSIVE RAISES NOTHING. It applies
-- >>> perfectly, every verification query returns exactly what the
-- >>> migration predicted, and the hole is invisible until somebody
-- >>> writes through it. The only way to find out is to write through it
-- >>> first, here, inside a transaction that rolls back.
--
-- =====================================================================
-- THE FIVE MANDATORY ASSERTIONS, AND WHERE THEY ARE
-- =====================================================================
--
--   T3  a vendor CAN write for an inbox row genuinely addressed to them
--       (and T3b, not on the mandatory list but load-bearing: the same
--       for a BID, which reaches its inbox row through a second hop.
--       T3 alone covers rfp.view and nda.acknowledge; T3b covers
--       bid.submit and bid.revise, which is half the repair.)
--   T4  a vendor CANNOT name an inbox row belonging to a DIFFERENT vendor
--   T5  a vendor CANNOT name an ARBITRARY agency as org_id  <- 088's V6,
--       re-run against the new pin. This is the feed-injection test.
--   T7  the EXISTING partnership-pinned path still refuses a forged
--       org_id. This proves 100 did not weaken what 088 already had.
--   T8  a vendor with BOTH a partnership AND an inbox row for the same
--       RFP is admitted EXACTLY ONCE and still cannot forge org_id
--       through either branch. This is the overlap case.
--
-- ALL REFUSALS MUST BE 42501 (insufficient_privilege). Any other
-- SQLSTATE is a FAIL, not a pass by another name: 23503 means the test
-- picked an id that is not a real row and measured a foreign key instead
-- of a policy, and 23502 means it omitted a NOT NULL column. Both would
-- look like "the write was refused" while proving nothing about 100.
--
-- =====================================================================
-- THIS ONE IMPERSONATES. IT HAS TO. AND IT IMPERSONATES TWO VENDORS.
-- =====================================================================
--
-- Run as the table owner or the service role and RLS is bypassed, every
-- write below succeeds, and the file reports a clean sweep while
-- measuring nothing at all.
--
-- Every write assertion sets both JWT GUCs and SET LOCAL ROLE
-- authenticated first. TWO ACTORS:
--
--   the INBOX VENDOR  - a member of an organization that is the
--                       vendor_org_id on a partner_rfp_inbox row and has
--                       NO partnerships row with that row's lead agency.
--                       This actor is the entire point of branch B.
--   the POOL VENDOR   - a member of the vendor side of a real
--                       partnerships row. Exercises branch A (T6, T7)
--                       and, when they also hold an inbox row from the
--                       same agency, the overlap case (T8).
--
-- T1 and T2 are controls that prove impersonation took at all. If they
-- are not PASS, nothing below them means anything.
--
-- =====================================================================
-- THE INBOX VENDOR MAY NOT EXIST ON THIS DATABASE, AND THAT IS HANDLED
-- =====================================================================
--
-- Pre-flight P4 in the migration counts exactly this population. It may
-- be ZERO: if every vendor who has ever been sent an RFP was also added
-- to the pool, there is no natural subject for branch B.
--
-- >>> SO THIS FILE SYNTHESIZES ONE WHEN IT HAS TO, AND SAYS WHICH PATH
-- >>> IT TOOK IN THE REPORT. <<<
--
-- The synthesis CLONES an existing partner_rfp_inbox row through a temp
-- table and repoints its vendor_org_id at an organization that has no
-- partnership with that row's lead agency. Cloning rather than composing
-- a row from scratch is deliberate: this file does not know
-- partner_rfp_inbox's NOT NULL columns or its defaults, and a row built
-- from a guess would fail with 23502 and be reported as a policy result.
-- A clone satisfies every constraint the original satisfied, by
-- construction.
--
-- The clone is written as the OWNER, before any SET LOCAL ROLE, so no
-- policy is involved in creating the subject - only in writing through
-- it afterwards. And it rolls back with everything else.
--
-- >>> A SYNTHESIZED SUBJECT IS STILL A REAL TEST OF THE POLICY. What it
-- >>> does not prove is that the population exists in production. Read
-- >>> P4 for that, and do not read a PASS here as evidence that anything
-- >>> will change on the live feed.
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
-- A correct, healthy, everything-worked run looks like a red error box
-- with a multi-line message in it. That is not a failure. That IS the
-- output, and the verdict is the first line of it. The mechanism is the
-- one established in docs/091-preapply-test.sql and re-used by 092, 094,
-- 096, 097 and 098: the Supabase SQL Editor has no Messages panel, so
-- RAISE NOTICE goes nowhere a human can read.
--
-- =====================================================================


BEGIN;


DO $test$
DECLARE
  -- the inbox vendor (branch B)
  v_inbox_row      uuid;
  v_inbox_lead     uuid;
  v_inbox_vendor   uuid;
  v_inbox_member   uuid;
  v_inbox_synth    boolean := false;
  -- the pool vendor (branch A and the overlap)
  v_partnership    uuid;
  v_pool_lead      uuid;
  v_pool_vendor    uuid;
  v_pool_member    uuid;
  v_overlap_inbox  uuid;
  -- the bid sub-arm (branch B, second arm)
  v_bid_response   uuid;
  v_bid_lead       uuid;
  v_bid_vendor     uuid;
  v_bid_member     uuid;
  v_claims_bid     text;
  -- forgery targets
  v_other_org      uuid;
  v_other_inbox    uuid;
  -- machinery
  v_claims_inbox   text;
  v_claims_pool    text;
  v_count          integer;
  v_written        integer;
  v_pol_before     integer;
  v_pol_after      integer;
  v_clone_src      uuid;
  v_free_vendor    uuid;
  v_sqlstate       text;
  -- tally
  v_ran            integer := 0;
  v_pass           integer := 0;
  v_fail           integer := 0;
  v_inconc         integer := 0;
  v_logged         integer := 0;
  v_lines          text := '';
  v_verdict_text   text;
  v_headline       text;
  v_report         text;
  v_subject_note   text;
BEGIN

  SELECT count(*) INTO v_pol_before FROM pg_policies WHERE schemaname = 'public';

  -- ===================================================================
  -- SUBJECT SELECTION. Before anything is applied and before any role is
  -- assumed. Everything here runs as the owner.
  -- ===================================================================

  -- The POOL VENDOR: a partnership whose vendor side has a member.
  SELECT p.id, p.lead_org_id, p.vendor_org_id, m.user_id
    INTO v_partnership, v_pool_lead, v_pool_vendor, v_pool_member
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.vendor_org_id
  WHERE p.vendor_org_id IS NOT NULL
    AND p.lead_org_id   IS NOT NULL
  LIMIT 1;

  -- The OVERLAP: an inbox row from the SAME agency to the SAME vendor.
  IF v_partnership IS NOT NULL THEN
    SELECT i.id INTO v_overlap_inbox
    FROM public.partner_rfp_inbox i
    WHERE i.vendor_org_id = v_pool_vendor
      AND i.lead_org_id   = v_pool_lead
    LIMIT 1;
  END IF;

  -- The INBOX VENDOR, natural first: an inbox row whose vendor org has a
  -- member AND has NO partnership with that row's lead agency.
  SELECT i.id, i.lead_org_id, i.vendor_org_id, m.user_id
    INTO v_inbox_row, v_inbox_lead, v_inbox_vendor, v_inbox_member
  FROM public.partner_rfp_inbox i
  JOIN public.org_members m ON m.org_id = i.vendor_org_id
  WHERE i.vendor_org_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.vendor_org_id = i.vendor_org_id
        AND p.lead_org_id   = i.lead_org_id
    )
  LIMIT 1;

  -- Synthesized fallback. Clone an inbox row and repoint its vendor at an
  -- organization with a member and no partnership with that lead agency.
  IF v_inbox_row IS NULL THEN
    BEGIN
      SELECT i.id, i.lead_org_id INTO v_clone_src, v_inbox_lead
      FROM public.partner_rfp_inbox i
      WHERE i.lead_org_id IS NOT NULL
      LIMIT 1;

      IF v_clone_src IS NOT NULL THEN
        SELECT m.org_id, m.user_id INTO v_free_vendor, v_inbox_member
        FROM public.org_members m
        WHERE m.org_id <> v_inbox_lead
          AND NOT EXISTS (
            SELECT 1 FROM public.partnerships p
            WHERE p.vendor_org_id = m.org_id
              AND p.lead_org_id   = v_inbox_lead
          )
        LIMIT 1;
      END IF;

      IF v_free_vendor IS NOT NULL THEN
        CREATE TEMP TABLE t_clone ON COMMIT DROP AS
          SELECT * FROM public.partner_rfp_inbox WHERE id = v_clone_src;
        UPDATE t_clone SET id = gen_random_uuid(), vendor_org_id = v_free_vendor;
        INSERT INTO public.partner_rfp_inbox SELECT * FROM t_clone;
        SELECT id INTO v_inbox_row FROM t_clone;
        v_inbox_vendor := v_free_vendor;
        v_inbox_synth  := true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A unique constraint, a trigger, anything. The subject is simply
      -- unavailable; every branch B assertion reports INCONCLUSIVE below
      -- and says why, rather than reporting a policy verdict it did not
      -- measure.
      v_inbox_row := NULL;
    END;
  END IF;

  -- The BID SUB-ARM subject: a portal response (inbox_item_id set) whose
  -- inbox row names a vendor organization with a member and NO
  -- partnership with that row's lead agency. Natural only - a synthesized
  -- one would have to clone a response as well as an inbox row, and a
  -- two-table clone is more machinery than this assertion is worth.
  SELECT r.id, i.lead_org_id, i.vendor_org_id, m.user_id
    INTO v_bid_response, v_bid_lead, v_bid_vendor, v_bid_member
  FROM public.partner_rfp_responses r
  JOIN public.partner_rfp_inbox    i ON i.id = r.inbox_item_id
  JOIN public.org_members          m ON m.org_id = i.vendor_org_id
  WHERE i.vendor_org_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.vendor_org_id = i.vendor_org_id
        AND p.lead_org_id   = i.lead_org_id
    )
  LIMIT 1;

  -- An organization that is NOT the inbox row's lead agency. It must be a
  -- REAL organizations row: milestone_events.org_id is a foreign key, so a
  -- made-up uuid would raise 23503 and measure the key instead of the
  -- policy.
  SELECT o.id INTO v_other_org
  FROM public.organizations o
  WHERE o.id <> COALESCE(v_inbox_lead, '00000000-0000-0000-0000-000000000000'::uuid)
    AND o.id <> COALESCE(v_inbox_vendor, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  -- An inbox row belonging to a DIFFERENT vendor than the inbox vendor.
  -- Read as the OWNER so RLS cannot quietly empty it; T4 uses only the id.
  SELECT i.id INTO v_other_inbox
  FROM public.partner_rfp_inbox i
  WHERE i.vendor_org_id IS NOT NULL
    AND i.vendor_org_id <> COALESCE(v_inbox_vendor, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  v_claims_inbox := json_build_object('sub', COALESCE(v_inbox_member, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_pool  := json_build_object('sub', COALESCE(v_pool_member,  '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;
  v_claims_bid   := json_build_object('sub', COALESCE(v_bid_member,   '00000000-0000-0000-0000-000000000000'::uuid)::text, 'role','authenticated')::text;

  v_subject_note := CASE
    WHEN v_inbox_row IS NULL   THEN 'NONE - branch B is UNMEASURED'
    WHEN v_inbox_synth         THEN 'SYNTHESIZED (cloned inbox row; see the header)'
    ELSE                            'NATURAL (a real unpooled vendor exists on this database)'
  END;


  -- ===================================================================
  -- SECTION A. APPLY MIGRATION 100, INSIDE THIS TRANSACTION.
  -- The body of 100_milestone_inbox_pin.sql between its BEGIN and COMMIT,
  -- reproduced. If this section and that file ever disagree, this file is
  -- testing something that will not be applied.
  -- ===================================================================
  DROP POLICY IF EXISTS "Vendors insert own company milestone events" ON public.milestone_events;

  CREATE POLICY "Vendors insert own company milestone events"
    ON public.milestone_events AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
      actor_side = 'vendor'
      AND actor_id = auth.uid()
      AND actor_email IS NULL
      AND vendor_org_id IN (SELECT public.current_user_org_ids())
      AND event_type = ANY (public.vendor_emittable_event_types())
      AND (
        (
          partnership_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.partnerships p
            WHERE p.id            = milestone_events.partnership_id
              AND p.vendor_org_id = milestone_events.vendor_org_id
              AND p.lead_org_id   = milestone_events.org_id
          )
        )
        OR
        (
          partnership_id IS NULL
          AND (
            (
              subject_type = 'rfp_inbox'
              AND EXISTS (
                SELECT 1
                FROM public.partner_rfp_inbox i
                WHERE i.id            = milestone_events.subject_id
                  AND i.vendor_org_id = milestone_events.vendor_org_id
                  AND i.lead_org_id   = milestone_events.org_id
              )
            )
            OR
            (
              subject_type = 'bid'
              AND EXISTS (
                SELECT 1
                FROM public.partner_rfp_responses r
                JOIN public.partner_rfp_inbox    i ON i.id = r.inbox_item_id
                WHERE r.id            = milestone_events.subject_id
                  AND i.vendor_org_id = milestone_events.vendor_org_id
                  AND i.lead_org_id   = milestone_events.org_id
              )
            )
          )
        )
      )
    );

  SELECT count(*) INTO v_pol_after FROM pg_policies WHERE schemaname = 'public';


  -- ===================================================================
  -- T1. CONTROL. The inbox vendor can read their own inbox row. If this
  -- is not PASS, impersonation never took and every branch B result below
  -- is meaningless.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox_row IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T1  control: inbox vendor reads own row', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no unpooled inbox vendor could be found or synthesized. See the header.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_inbox,    true);
      PERFORM set_config('request.jwt.claim.sub', v_inbox_member::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count FROM public.partner_rfp_inbox WHERE id = v_inbox_row;
      RESET ROLE;
      IF v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: inbox vendor reads own row', 52) || rpad('PASS', 14)
          || 'impersonation took and RLS lets the vendor read the row they are named on';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T1  control: inbox vendor reads own row', 52) || rpad('FAIL', 14)
          || format('the vendor could not read their own inbox row (%s rows). The harness is broken; every branch B result below is meaningless.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  control: inbox vendor reads own row', 52) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T2. CONTROL. The pool vendor can read their own partnership. Same
  -- role for branch A that T1 plays for branch B.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_partnership IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T2  control: pool vendor reads partnership', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no partnership whose vendor organization has a member. Branch A is UNMEASURED and T6, T7 and T8 below are ambiguous.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_pool,       true);
      PERFORM set_config('request.jwt.claim.sub', v_pool_member::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_count FROM public.partnerships WHERE id = v_partnership;
      RESET ROLE;
      IF v_count = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: pool vendor reads partnership', 52) || rpad('PASS', 14)
          || 'impersonation took';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T2  control: pool vendor reads partnership', 52) || rpad('FAIL', 14)
          || format('the vendor could not read their own partnership (%s rows). Branch A results below are meaningless.', v_count);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  control: pool vendor reads partnership', 52) || rpad('FAIL', 14)
        || format('%s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T3. >>> MANDATORY 1. THE REPAIR ITSELF. <<<
  -- A vendor writes a row for an inbox row genuinely addressed to them,
  -- with partnership_id NULL. This is the write that is refused with
  -- 42501 today and must be ADMITTED after 100.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox_row IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3  MANDATORY: branch B admits the vendor', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: see T1. >>> THE ENTIRE POINT OF MIGRATION 100 IS UNMEASURED. <<<';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_inbox,       true);
      PERFORM set_config('request.jwt.claim.sub', v_inbox_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_inbox_lead, v_inbox_vendor, NULL, v_inbox_member, NULL,
         'vendor', 'rfp.view', 'rfp_inbox', v_inbox_row, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  MANDATORY: branch B admits the vendor', 52) || rpad('PASS', 14)
        || format('rfp.view written with a NULL partnership_id, pinned through the inbox row (subject %s)', v_subject_note);
      v_pass := v_pass + 1;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  MANDATORY: branch B admits the vendor', 52) || rpad('FAIL', 14)
        || format('%s: %s  >>> 42501 HERE MEANS BRANCH B DOES NOT WORK AND 100 REPAIRS NOTHING. <<<', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T3b. THE BID SUB-ARM. The other half of the repair, and the half
  -- that needs a two-table hop.
  --
  -- bid.submit and bid.revise carry subject_type 'bid' and subject_id =
  -- the partner_rfp_responses row, NOT the inbox row - which
  -- lib/activity-feed.ts REQUIRES of them, because bid.submit is on
  -- UNION_REPLACING_EVENT_TYPES keyed on the response id. So branch B
  -- reaches the inbox through partner_rfp_responses.inbox_item_id. If
  -- that hop is wrong, T3 still passes and HALF THE REPAIR SILENTLY DOES
  -- NOTHING.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_bid_response IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T3b branch B admits a portal bid', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: no portal response whose inbox vendor lacks a partnership. >>> THE bid.submit / bid.revise HALF OF THE REPAIR IS UNMEASURED. <<< See P4''s second query in the migration.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_bid,       true);
      PERFORM set_config('request.jwt.claim.sub', v_bid_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_bid_lead, v_bid_vendor, NULL, v_bid_member, NULL,
         'vendor', 'bid.submit', 'bid', v_bid_response, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3b branch B admits a portal bid', 52) || rpad('PASS', 14)
        || 'bid.submit written with a NULL partnership_id, pinned response -> inbox_item_id -> inbox row';
      v_pass := v_pass + 1;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3b branch B admits a portal bid', 52) || rpad('FAIL', 14)
        || format('%s: %s  >>> 42501 HERE MEANS THE inbox_item_id HOP IS WRONG AND bid.submit / bid.revise ARE STILL BROKEN. <<<', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T4. >>> MANDATORY 2. <<<
  -- The same vendor names an inbox row belonging to a DIFFERENT vendor.
  -- The org_id is that other row's agency, so the only thing standing
  -- between this write and the feed is branch B's vendor_org_id join.
  -- MUST be refused with 42501.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox_row IS NULL OR v_other_inbox IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T4  MANDATORY: refuses another vendor''s inbox', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs an inbox row belonging to a different vendor than the test subject.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_inbox,       true);
      PERFORM set_config('request.jwt.claim.sub', v_inbox_member::text, true);
      SET LOCAL ROLE authenticated;
      -- THE CALLER'S OWN org_id AND vendor_org_id, and somebody else's
      -- inbox row as subject_id. Every clause except branch B's
      -- `i.id = subject_id` join is satisfied, so this isolates that one
      -- join and nothing else. v_other_inbox_lead was read as the OWNER
      -- during subject selection, NOT inside this impersonated block: a
      -- SELECT that RLS filtered to zero rows would insert zero rows and
      -- be reported as "refused" while proving nothing.
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_inbox_lead, v_inbox_vendor, NULL, v_inbox_member, NULL,
         'vendor', 'rfp.view', 'rfp_inbox', v_other_inbox, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  MANDATORY: refuses another vendor''s inbox', 52) || rpad('FAIL', 14)
        || '>>> ADMITTED. A vendor can write against an inbox row addressed to somebody else. Branch B is not pinning subject_id. DO NOT APPLY 100. <<<';
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  MANDATORY: refuses another vendor''s inbox', 52) || rpad('PASS', 14)
          || 'refused with 42501, which is the policy and not a constraint';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        v_sqlstate := SQLSTATE;
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T4  MANDATORY: refuses another vendor''s inbox', 52) || rpad('FAIL', 14)
          || format('refused with %s, NOT 42501. A foreign key or a NOT NULL was hit before the policy was, so this assertion measured nothing: %s', v_sqlstate, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T5. >>> MANDATORY 3. 088's V6, RE-RUN AGAINST THE NEW PIN. <<<
  -- The vendor keeps their own vendor_org_id and their own inbox row, and
  -- swaps org_id for an ARBITRARY organization. This is the feed
  -- injection 088's header calls the thing "the clause that matters most"
  -- exists to prevent. Branch B's EXISTS must pin org_id exactly as
  -- branch A's does. MUST be 42501.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox_row IS NULL OR v_other_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T5  MANDATORY: branch B pins org_id', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs a second organization to forge. >>> THE FEED-INJECTION BOUNDARY IS UNMEASURED. <<<';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_inbox,       true);
      PERFORM set_config('request.jwt.claim.sub', v_inbox_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_other_org, v_inbox_vendor, NULL, v_inbox_member, NULL,
         'vendor', 'rfp.view', 'rfp_inbox', v_inbox_row, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  MANDATORY: branch B pins org_id', 52) || rpad('FAIL', 14)
        || '>>> ADMITTED. FEED INJECTION IS OPEN: a vendor can put a line they composed on an arbitrary agency dashboard. DO NOT APPLY 100. <<<';
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  MANDATORY: branch B pins org_id', 52) || rpad('PASS', 14)
          || 'refused with 42501. Branch B pins org_id the same way branch A does.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        v_sqlstate := SQLSTATE;
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T5  MANDATORY: branch B pins org_id', 52) || rpad('FAIL', 14)
          || format('refused with %s, NOT 42501. The forged org_id was probably not a real organizations row, so a foreign key answered before the policy did and the boundary is UNMEASURED: %s', v_sqlstate, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T6. BRANCH A STILL ADMITS A LEGITIMATE ROW.
  -- Not one of the five, but without it a run where branch A was broken
  -- outright would still show T7 passing, because a policy that refuses
  -- everything refuses forgeries too.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_partnership IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  branch A still admits a real row', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: see T2.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_pool,       true);
      PERFORM set_config('request.jwt.claim.sub', v_pool_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_pool_lead, v_pool_vendor, v_partnership, v_pool_member, NULL,
         'vendor', 'bid.submit', 'bid', NULL, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  branch A still admits a real row', 52) || rpad('PASS', 14)
        || 'the partnership-pinned path is unchanged by 100';
      v_pass := v_pass + 1;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  branch A still admits a real row', 52) || rpad('FAIL', 14)
        || format('%s: %s  >>> 100 BROKE BRANCH A. Every pooled vendor stops writing breadcrumbs. DO NOT APPLY. <<<', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T7. >>> MANDATORY 4. THE REGRESSION TEST. <<<
  -- The pool vendor, with a real partnership, forges org_id. 088 already
  -- refused this. If 100 weakened branch A, or if the disjunction lets
  -- branch B answer for a row branch A should have judged, this is where
  -- it shows. MUST be 42501.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_partnership IS NULL OR v_other_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7  MANDATORY: branch A still pins org_id', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs a partnership and a second organization. >>> THE REGRESSION IS UNMEASURED. <<<';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_pool,       true);
      PERFORM set_config('request.jwt.claim.sub', v_pool_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_other_org, v_pool_vendor, v_partnership, v_pool_member, NULL,
         'vendor', 'bid.submit', 'bid', NULL, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  MANDATORY: branch A still pins org_id', 52) || rpad('FAIL', 14)
        || '>>> ADMITTED. 100 WEAKENED WHAT 088 ALREADY HAD. DO NOT APPLY. <<<';
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  MANDATORY: branch A still pins org_id', 52) || rpad('PASS', 14)
          || 'refused with 42501, exactly as 088 refused it. Nothing was weakened.';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        v_sqlstate := SQLSTATE;
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T7  MANDATORY: branch A still pins org_id', 52) || rpad('FAIL', 14)
          || format('refused with %s, NOT 42501: %s', v_sqlstate, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T8. >>> MANDATORY 5. THE OVERLAP CASE. <<<
  -- A vendor holding BOTH a partnership AND an inbox row from the same
  -- agency. Two writes:
  --   (a) the real one, partnership_id set. It must be admitted, and it
  --       must produce EXACTLY ONE row - a WITH CHECK is a boolean test,
  --       not a row multiplier, and this counts rather than assumes it.
  --   (b) the same vendor forging org_id while holding both credentials.
  --       If the two branches could disagree, this is the row where the
  --       weaker one would admit it. MUST be 42501.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_partnership IS NULL OR v_overlap_inbox IS NULL OR v_other_org IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8  MANDATORY: overlap admitted once, no forge', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: needs a vendor holding BOTH a partnership and an inbox row from the same agency, plus a second organization. This is the normal steady state, so its absence is itself worth reading.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_pool,       true);
      PERFORM set_config('request.jwt.claim.sub', v_pool_member::text, true);
      SET LOCAL ROLE authenticated;

      -- (a) the legitimate write.
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_pool_lead, v_pool_vendor, v_partnership, v_pool_member, NULL,
         'vendor', 'nda.acknowledge', 'rfp_inbox', v_overlap_inbox, '{}'::jsonb);
      RESET ROLE;

      SELECT count(*) INTO v_written
      FROM public.milestone_events
      WHERE event_type   = 'nda.acknowledge'
        AND subject_id   = v_overlap_inbox
        AND actor_id     = v_pool_member
        AND partnership_id = v_partnership;

      -- (b) the forgery, by the same actor holding both credentials.
      BEGIN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    v_claims_pool,       true);
        PERFORM set_config('request.jwt.claim.sub', v_pool_member::text, true);
        SET LOCAL ROLE authenticated;
        INSERT INTO public.milestone_events
          (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
           actor_side, event_type, subject_type, subject_id, payload)
        VALUES
          (v_other_org, v_pool_vendor, NULL, v_pool_member, NULL,
           'vendor', 'nda.acknowledge', 'rfp_inbox', v_overlap_inbox, '{}'::jsonb);
        RESET ROLE;
        v_sqlstate := 'ADMITTED';
      EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; v_sqlstate := '42501';
        WHEN OTHERS THEN                 RESET ROLE; v_sqlstate := SQLSTATE;
      END;

      v_logged := v_logged + 1;
      IF v_written = 1 AND v_sqlstate = '42501' THEN
        v_lines := v_lines || E'\n  ' || rpad('T8  MANDATORY: overlap admitted once, no forge', 52) || rpad('PASS', 14)
          || 'the legitimate write produced exactly 1 row through branch A, and the forgery was refused with 42501 through both branches';
        v_pass := v_pass + 1;
      ELSIF v_written <> 1 THEN
        v_lines := v_lines || E'\n  ' || rpad('T8  MANDATORY: overlap admitted once, no forge', 52) || rpad('FAIL', 14)
          || format('the legitimate overlap write produced %s row(s), expected exactly 1', v_written);
        v_fail := v_fail + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T8  MANDATORY: overlap admitted once, no forge', 52) || rpad('FAIL', 14)
          || format('the forgery came back %s, not 42501. >>> A VENDOR HOLDING BOTH CREDENTIALS CAN FORGE org_id. THE BRANCHES ARE NOT MUTUALLY EXCLUSIVE IN PRACTICE. DO NOT APPLY 100. <<<', v_sqlstate);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  MANDATORY: overlap admitted once, no forge', 52) || rpad('FAIL', 14)
        || format('the legitimate overlap write was refused: %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T9. THE FIVE PRESERVED CLAUSES STILL APPLY TO BRANCH B.
  -- An event type NOT on vendor_emittable_event_types() must still be
  -- refused on the new path. If branch B had been written as a separate
  -- PERMISSIVE policy instead of an arm inside this one, it would OR with
  -- the old policy and this is where that shows.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_inbox_row IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T9  branch B still obeys the type whitelist', 52) || rpad('INCONCLUSIVE', 14)
      || 'NO SUBJECT: see T1.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_claims_inbox,       true);
      PERFORM set_config('request.jwt.claim.sub', v_inbox_member::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.milestone_events
        (org_id, vendor_org_id, partnership_id, actor_id, actor_email,
         actor_side, event_type, subject_type, subject_id, payload)
      VALUES
        (v_inbox_lead, v_inbox_vendor, NULL, v_inbox_member, NULL,
         'vendor', 'bid.award', 'rfp_inbox', v_inbox_row, '{}'::jsonb);
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  branch B still obeys the type whitelist', 52) || rpad('FAIL', 14)
        || '>>> ADMITTED. A vendor wrote bid.award, an AGENCY act, onto the agency feed attributed to themselves. DO NOT APPLY 100. <<<';
      v_fail := v_fail + 1;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T9  branch B still obeys the type whitelist', 52) || rpad('PASS', 14)
          || 'refused with 42501; the five clauses above the disjunction still apply to both arms';
        v_pass := v_pass + 1;
      WHEN OTHERS THEN
        v_sqlstate := SQLSTATE;
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T9  branch B still obeys the type whitelist', 52) || rpad('FAIL', 14)
          || format('refused with %s, NOT 42501: %s', v_sqlstate, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;


  -- ===================================================================
  -- T10. THE POLICY COUNT IS UNCHANGED. One dropped, one created. A
  -- delta of +1 means the DROP did not match and there are now TWO
  -- permissive INSERT policies ORing together, which is the failure mode
  -- T9 is written against.
  -- ===================================================================
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  IF v_pol_after = v_pol_before THEN
    v_lines := v_lines || E'\n  ' || rpad('T10 schema policy count unchanged', 52) || rpad('PASS', 14)
      || format('%s before, %s after (delta 0)', v_pol_before, v_pol_after);
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('T10 schema policy count unchanged', 52) || rpad('FAIL', 14)
      || format('%s before, %s after (delta %s). +1 means the DROP matched nothing and 088 is still live alongside 100.', v_pol_before, v_pol_after, v_pol_after - v_pol_before);
    v_fail := v_fail + 1;
  END IF;


  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 THEN
    v_verdict_text := 'SAFE TO APPLY 100.';
    v_headline     := format('SAFE TO APPLY 100.  All %s assertions passed.', v_ran);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'INCONCLUSIVE. Not a green light.';
    v_headline     := format('DO NOT APPLY 100 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 100 does what it claims. (If T3, T3b, T4, T5 or T9 are the inconclusive ones, BRANCH B IS UNMEASURED and branch B is the entire migration. T3 alone passing covers rfp.view and nda.acknowledge only; T3b is the bid half. If T5 or T7 are, THE FEED-INJECTION BOUNDARY IS UNMEASURED. Read the header on subject selection before treating any of it as a pass.)', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 100.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. An assertion that ran without
  -- logging means the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 100.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  -- ===================================================================
  -- THE REPORT. HEADLINE, THEN TALLY, THEN THE PER-ASSERTION LINES.
  -- A client that truncates a long error message truncates the END of
  -- it, so the verdict and the counts must be at the TOP.
  -- ===================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 11)\n', v_ran)
    || format(E'PASS            : %s   (expected 11)\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n',
              v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || E'\n'
    || format(E'>>> branch B subject : %s\n', v_subject_note)
    || format(E'    branch A subject : %s\n',
              CASE WHEN v_partnership IS NULL THEN 'NONE - branch A is UNMEASURED' ELSE 'a live partnership with a vendor-side member' END)
    || format(E'    bid sub-arm      : %s\n',
              CASE WHEN v_bid_response IS NULL THEN 'NONE - the bid half of branch B is UNMEASURED' ELSE 'a portal response whose inbox vendor has no partnership' END)
    || format(E'    overlap subject  : %s\n',
              CASE WHEN v_overlap_inbox IS NULL THEN 'NONE - T8 is UNMEASURED' ELSE 'a vendor holding both a partnership and an inbox row' END)
    || format(E'    policies         : %s before -> %s after\n', v_pol_before, v_pol_after)
    || E'\n'
    || E'ASSERTIONS\n'
    || v_lines
    || E'\n\n'
    || E'VERDICT: ' || v_verdict_text || E'\n'
    || E'EVERYTHING THIS FILE WROTE IS ROLLED BACK. Migration 100 is NOT applied.\n';

  -- The default P0001 (raise_exception) is correct and deliberate.
  RAISE EXCEPTION '%', v_report;
END
$test$;


-- =====================================================================
-- THE BACKSTOP. IT STAYS.
--
-- IT IS NOT REACHED ON THE EXPECTED PATH. The DO block above ends in
-- RAISE EXCEPTION, the outer block has no handler, so the exception
-- propagates out, aborts the transaction, and every statement after it -
-- including this one - is skipped.
--
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for
-- the case where that exception is CAUGHT rather than propagated: an
-- enclosing EXCEPTION handler added here later, or a client that wraps
-- the batch in its own block and swallows the error.
--
-- >>> WHAT IS AT STAKE. At the moment of the RAISE this transaction
-- >>> holds THE VENDOR INSERT POLICY REPLACED, possibly a CLONED
-- >>> partner_rfp_inbox row, and up to three test rows in
-- >>> milestone_events - a table with NO DELETE
-- >>> POLICY FOR ANYBODY, so a committed test row is permanent and
-- >>> unremovable by any caller. Without this ROLLBACK a swallowed
-- >>> exception would leave all of it committed by a file whose header
-- >>> says it applies nothing.
-- =====================================================================
ROLLBACK;
