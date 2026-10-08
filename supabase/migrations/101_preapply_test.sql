-- =====================================================================
-- 101 PRE-APPLY TEST. ONE PASTE. APPLIES 101, WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 101 proves the trigger parses. It says NOTHING about the
-- questions that matter, and every one of them is a WRITE:
--
--   * is a vendor really refused status writes once the row is not pending,
--   * can a vendor write 'pending' onto their own row (the self-escalation),
--   * can a vendor still accept, decline, and request payment terms,
--   * does the claim path still work,
--   * can the AGENCY still suspend and terminate - the feature this exists
--     to protect.
--
-- >>> A GUARD THAT IS TOO PERMISSIVE RAISES NOTHING. It applies perfectly,
-- >>> every verification query returns what the migration predicted, and
-- >>> the hole is invisible until somebody writes through it. The only way
-- >>> to find out is to write through it first, here, inside a transaction
-- >>> that rolls back. A guard that is TOO NARROW is the opposite failure:
-- >>> it applies, and a vendor's accept or payment-terms request starts
-- >>> raising 42501 in production. T8, T9, T14 to T16 are the ones that
-- >>> catch that.
--
-- =====================================================================
-- THE ASSERTIONS THAT MATTER MOST, BY NAME
-- =====================================================================
--
--   T4, T5, T6   THE SELF-ESCALATION. A vendor writes 'pending' onto an
--                active, a suspended and a terminated row. If any is
--                ADMITTED the vendor can re-enter pending and the whole
--                guard is decorative. This is the one most likely to be
--                missing from a design.
--   T1, T2       A vendor cannot terminate an active partnership, and
--                cannot write 'active' over a suspension. These are the
--                two things the Suspend and Terminate controls exist to
--                prevent.
--   T14          A vendor CAN still write payment_terms_requests. This is
--                the over-narrow catch: app/partner/projects/page.tsx:369
--                is a live vendor write that is not a status change.
--   T8, T9       A vendor CAN still accept and still decline.
--   T22 to T24   The AGENCY can still suspend, terminate and reinstate.
--   H0           INFO, not pass/fail. Demonstrates live that a policy-only
--                narrowing is vacuous, which is why 101 is a trigger.
--   D0           INFO. Reproduces the defect BEFORE 101 is applied in this
--                transaction. If D0 says NOT REPRODUCED the defect is not
--                what the brief measured; read that before applying.
--
-- EVERY REFUSAL MUST CARRY THE SQLSTATE AND THE MESSAGE OF THE LAYER IT IS
-- EXPECTED FROM. 101's refusals are 42501 with a message starting
-- "partnerships.status" (raised by the trigger, not by RLS). 093's are
-- LG009. 087's lead_org_id refusal is 42501 "is immutable". A refusal with
-- the right code from the WRONG layer is a FAIL, not a pass by another
-- name: it means the assertion measured something other than 101.
--
-- =====================================================================
-- THIS ONE IMPERSONATES. IT HAS TO. AND IT IMPERSONATES TWO ACTORS.
-- =====================================================================
--
-- Run as the table owner or the service role and RLS and the trigger's
-- end-user checks are bypassed, every write below succeeds, and the file
-- reports a clean sweep while measuring nothing at all.
--
-- Every actor write sets BOTH JWT GUCs and SET LOCAL ROLE authenticated
-- first (pg_temp.t_try). TWO ACTORS:
--
--   the VENDOR  - a member of the vendor organization of a real
--                 partnerships row, and NOT a member of its lead org.
--   the AGENCY  - a member of the lead organization of that same row, and
--                 NOT a member of its vendor org.
--
-- C2a and C2b are controls that prove impersonation took at all: inside
-- the role switch, current_user is 'authenticated' and auth.uid() is the
-- actor. If they are not PASS, nothing below them means anything. C1 proves
-- the vendor can read the row at all, so a refusal below is a refusal of a
-- write and not an invisible row. C4 proves 093's trigger is the one that
-- is live, without which T17 to T19 are meaningless.
--
-- STATE IS SET BY THE OWNER, NOT BY THE ACTOR. Each assertion first sets
-- the subject row to the status it needs through pg_temp.t_state, with the
-- JWT claims blanked so auth.uid() is NULL and 101's own trigger exits at
-- its second exit. Without that blanking the owner's setup write would be
-- refused as if it were a vendor.
--
-- >>> NO SUBJECT IS REPORTED AS INCONCLUSIVE, NEVER AS A PASS. 100's two
-- >>> inconclusive results came from missing subjects. A run with any
-- >>> INCONCLUSIVE is not a green light, however many PASSes surround it.
--
-- The claim assertions need a GHOST row (vendor_org_id NULL) addressed to
-- the vendor's email. None may exist, so this file CLONES the subject row
-- through a temp table, repoints it at a different lead organization and
-- the vendor's own profile email, and says in the report whether it did.
-- The clone is written as the OWNER, so no policy is involved in creating
-- it, and it rolls back with everything else.
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
-- A correct run looks like a red error box with a multi-line message in
-- it. That is the output, and the verdict is the first line of it. The
-- mechanism is the one established in docs/091-preapply-test.sql and
-- re-used by 092, 094, 096, 097, 098, 099 and 100.
--
-- SECTION A below is the body of 101_partnership_write_guard.sql between
-- its BEGIN and COMMIT, copied by script, not by hand. If the two ever
-- disagree, this file is testing something that will not be applied.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- HARNESS. Temp objects only; all of it dies with the transaction.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE t_res (
  seq     serial PRIMARY KEY,
  id      text,
  name    text,
  verdict text,
  note    text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.t_log(p_id text, p_name text, p_verdict text, p_note text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO t_res (id, name, verdict, note) VALUES (p_id, p_name, p_verdict, p_note);
END
$f$;

CREATE FUNCTION pg_temp.t_clear()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END
$f$;

-- Run one statement AS an actor. Returns 'OK|<rows>' or 'ERR|<sqlstate>|<message>'.
CREATE FUNCTION pg_temp.t_try(p_actor uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    PERFORM pg_temp.t_clear();
    RETURN 'OK|' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.t_clear();
    RETURN 'ERR|' || SQLSTATE || '|' || SQLERRM;
  END;
END
$f$;

CREATE FUNCTION pg_temp.t_whoami(p_actor uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  SET LOCAL ROLE authenticated;
  v := current_user || '|' || COALESCE(auth.uid()::text, 'NULL');
  RESET ROLE;
  PERFORM pg_temp.t_clear();
  RETURN v;
END
$f$;

-- Owner sets the subject row's state. Claims blanked first.
CREATE FUNCTION pg_temp.t_state(p_id uuid, p_status text, p_accepted timestamptz)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM pg_temp.t_clear();
  UPDATE public.partnerships SET status = p_status, accepted_at = p_accepted WHERE id = p_id;
END
$f$;

CREATE FUNCTION pg_temp.t_refused(
  p_id text, p_name text, p_actor uuid, p_row uuid, p_sql text, p_code text, p_msg_like text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  r text; v_code text; v_msg text;
BEGIN
  IF p_actor IS NULL OR p_row IS NULL THEN
    PERFORM pg_temp.t_log(p_id, p_name, 'INCONCLUSIVE', 'NO SUBJECT: see the subject lines in the report header.');
    RETURN;
  END IF;
  r := pg_temp.t_try(p_actor, p_sql);
  IF r = 'OK|0' THEN
    PERFORM pg_temp.t_log(p_id, p_name, 'INCONCLUSIVE',
      'the write matched 0 rows: the row was not visible to the actor, so NOTHING WAS MEASURED.');
  ELSIF r LIKE 'OK|%' THEN
    PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
      '>>> ADMITTED (' || substr(r, 4) || ' row). The write the guard exists to refuse went through. <<<');
  ELSE
    v_code := split_part(r, '|', 2);
    v_msg  := substr(r, length('ERR|' || v_code || '|') + 1);
    IF v_code = p_code AND v_msg LIKE p_msg_like THEN
      PERFORM pg_temp.t_log(p_id, p_name, 'PASS', 'refused ' || v_code || ': ' || left(v_msg, 100));
    ELSIF v_code = p_code THEN
      PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
        'refused with ' || v_code || ' but by a DIFFERENT layer than expected, so this measured something other than 101: ' || left(v_msg, 140));
    ELSE
      PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
        'refused with ' || v_code || ', expected ' || p_code || '. A constraint or a key was hit before the guard: ' || left(v_msg, 140));
    END IF;
  END IF;
END
$f$;

CREATE FUNCTION pg_temp.t_admitted(
  p_id text, p_name text, p_actor uuid, p_row uuid, p_sql text, p_check text, p_ok_note text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  r text; b boolean;
BEGIN
  IF p_actor IS NULL OR p_row IS NULL THEN
    PERFORM pg_temp.t_log(p_id, p_name, 'INCONCLUSIVE', 'NO SUBJECT: see the subject lines in the report header.');
    RETURN;
  END IF;
  r := pg_temp.t_try(p_actor, p_sql);
  IF r = 'OK|1' THEN
    EXECUTE p_check INTO b;
    IF b IS TRUE THEN
      PERFORM pg_temp.t_log(p_id, p_name, 'PASS', p_ok_note);
    ELSE
      PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
        'the write reported 1 row but the row is not in the expected state afterwards.');
    END IF;
  ELSIF r = 'OK|0' THEN
    PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
      'the write matched 0 rows and raised nothing. An RLS update that matches no row returns HTTP 200 with no error; this is the silent kind of break.');
  ELSE
    PERFORM pg_temp.t_log(p_id, p_name, 'FAIL',
      '>>> REFUSED, and a legitimate write must pass. ' || split_part(r, '|', 2) || ': ' || left(substr(r, length('ERR|' || split_part(r, '|', 2) || '|') + 1), 140) || ' <<<');
  END IF;
END
$f$;


DO $test$
DECLARE
  -- the subject
  v_s1        uuid;
  v_lead      uuid;
  v_vorg      uuid;
  v_vm        uuid;     -- vendor member
  v_am        uuid;     -- agency member
  v_vm_email  text;
  v_other_org uuid;
  -- the claim clone
  v_l2        uuid;
  v_ghost     uuid;
  v_ghost_how text := 'NONE - the claim assertions are UNMEASURED';
  -- machinery
  v_r         text;
  v_who       text;
  v_n         integer;
  v_has093    boolean;
  v_order_ok  boolean;
  v_pol_before integer;
  v_pol_after  integer;
  v_fp_ag_0 text; v_fp_cl_0 text; v_fp_vn_0 text;
  v_fp_ag_1 text; v_fp_cl_1 text; v_fp_vn_1 text;
  v_pass integer; v_fail integer; v_inconc integer; v_info integer; v_total integer;
  v_expected CONSTANT integer := 35;
  v_headline text; v_verdict_text text; v_report text; v_lines text;
BEGIN

  SELECT count(*) INTO v_pol_before FROM pg_policies WHERE schemaname = 'public';

  -- ===================================================================
  -- SUBJECT SELECTION. As the owner, before any role is assumed.
  -- A partnership with a vendor-side member who is NOT in the lead org,
  -- and a lead-side member who is NOT in the vendor org.
  -- ===================================================================
  SELECT p.id, p.lead_org_id, p.vendor_org_id, vm.user_id, am.user_id
    INTO v_s1, v_lead, v_vorg, v_vm, v_am
  FROM public.partnerships p
  JOIN public.org_members vm ON vm.org_id = p.vendor_org_id
  JOIN public.org_members am ON am.org_id = p.lead_org_id
  WHERE p.vendor_org_id IS NOT NULL
    AND p.lead_org_id   IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.org_members x
                    WHERE x.org_id = p.lead_org_id   AND x.user_id = vm.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.org_members x
                    WHERE x.org_id = p.vendor_org_id AND x.user_id = am.user_id)
  ORDER BY p.created_at
  LIMIT 1;

  SELECT pr.email INTO v_vm_email FROM public.profiles pr WHERE pr.id = v_vm;

  -- A real organization that is neither side, for the forged lead_org_id.
  SELECT o.id INTO v_other_org
  FROM public.organizations o
  WHERE o.id <> COALESCE(v_lead, '00000000-0000-0000-0000-000000000000'::uuid)
    AND o.id <> COALESCE(v_vorg, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  -- 093 is live: the identity trigger carries the permit list.
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'partnerships_guard_identity_columns'
      AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%LG009%'
  ) INTO v_has093;

  -- The claim clone. A different lead organization, vendor_org_id NULL,
  -- partner_email = the vendor member's own profile email. The lead org
  -- must not contain the vendor member (else they would be the AGENCY on
  -- that row and exit 3 would exempt them), and must hold no row for that
  -- vendor or that email (two unique indexes, 084).
  IF v_s1 IS NOT NULL AND v_vm_email IS NOT NULL THEN
    BEGIN
      SELECT o.id INTO v_l2
      FROM public.organizations o
      WHERE o.id <> v_vorg
        AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.org_id = o.id AND x.user_id = v_vm)
        AND NOT EXISTS (SELECT 1 FROM public.partnerships q
                        WHERE q.lead_org_id = o.id
                          AND (q.vendor_org_id = v_vorg
                               OR lower(btrim(q.partner_email)) = lower(btrim(v_vm_email))))
      LIMIT 1;
      IF v_l2 IS NOT NULL THEN
        CREATE TEMP TABLE t_clone ON COMMIT DROP AS
          SELECT * FROM public.partnerships WHERE id = v_s1;
        UPDATE t_clone
           SET id = gen_random_uuid(), lead_org_id = v_l2, vendor_org_id = NULL,
               partner_email = v_vm_email, status = 'pending', accepted_at = NULL,
               profile_status = 'unclaimed';
        INSERT INTO public.partnerships SELECT * FROM t_clone;
        SELECT id INTO v_ghost FROM t_clone;
        v_ghost_how := 'SYNTHESIZED (cloned the subject row to a different lead org, vendor NULL, email = the vendor member''s)';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_ghost := NULL;
      v_ghost_how := 'NONE - could not synthesize: ' || SQLSTATE || ' ' || left(SQLERRM, 120);
    END;
  END IF;

  -- Policy fingerprints BEFORE anything below touches a policy.
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_ag_0 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Agencies can update their partnerships';
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_cl_0 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Partners can claim partnership by email';
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_vn_0 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Partners can update partnership status';


  -- ===================================================================
  -- CONTROLS. If these are not PASS nothing below means anything.
  -- ===================================================================
  IF v_s1 IS NULL THEN
    PERFORM pg_temp.t_log('C1',  'control: vendor reads own partnership', 'INCONCLUSIVE',
      'NO SUBJECT: no partnership has a vendor-side member outside the lead org AND a lead-side member outside the vendor org. EVERYTHING BELOW IS UNMEASURED.');
    PERFORM pg_temp.t_log('C2a', 'control: vendor impersonation took', 'INCONCLUSIVE', 'NO SUBJECT');
    PERFORM pg_temp.t_log('C2b', 'control: agency impersonation took', 'INCONCLUSIVE', 'NO SUBJECT');
  ELSE
    v_r := pg_temp.t_try(v_vm, format('SELECT 1 FROM public.partnerships WHERE id = %L', v_s1));
    IF v_r = 'OK|1' THEN
      PERFORM pg_temp.t_log('C1', 'control: vendor reads own partnership', 'PASS',
        'the vendor member can see the row, so a refusal below is a refusal of a WRITE');
    ELSE
      PERFORM pg_temp.t_log('C1', 'control: vendor reads own partnership', 'FAIL',
        'the vendor could not read their own row (' || v_r || '). Every vendor result below is meaningless.');
    END IF;

    v_who := pg_temp.t_whoami(v_vm);
    IF v_who = 'authenticated|' || v_vm::text THEN
      PERFORM pg_temp.t_log('C2a', 'control: vendor impersonation took', 'PASS', 'current_user = authenticated and auth.uid() = the vendor member');
    ELSE
      PERFORM pg_temp.t_log('C2a', 'control: vendor impersonation took', 'FAIL', 'got ' || v_who || '. RLS and the trigger were not exercised as the vendor.');
    END IF;

    v_who := pg_temp.t_whoami(v_am);
    IF v_who = 'authenticated|' || v_am::text THEN
      PERFORM pg_temp.t_log('C2b', 'control: agency impersonation took', 'PASS', 'current_user = authenticated and auth.uid() = the agency member');
    ELSE
      PERFORM pg_temp.t_log('C2b', 'control: agency impersonation took', 'FAIL', 'got ' || v_who);
    END IF;
  END IF;

  IF v_has093 THEN
    PERFORM pg_temp.t_log('C4', 'control: 093 permit list is live', 'PASS',
      'partnerships_guard_identity_columns() carries the LG009 permit list; T17 to T19 measure it');
  ELSE
    PERFORM pg_temp.t_log('C4', 'control: 093 permit list is live', 'FAIL',
      '>>> 093 IS NOT APPLIED. nda_confirmed_at, msa_confirmed_at and partnership_notes are OPEN and 101 does not guard them. The brief was right about them. <<<');
  END IF;


  -- ===================================================================
  -- D0 (INFO). THE DEFECT, REPRODUCED BEFORE 101 IS APPLIED.
  -- ===================================================================
  IF v_s1 IS NOT NULL THEN
    PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
    v_r := pg_temp.t_try(v_vm, format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'terminated', v_s1));
    IF v_r = 'OK|1' THEN
      PERFORM pg_temp.t_log('D0', 'BEFORE 101: vendor terminates an active row', 'INFO',
        'DEFECT REPRODUCED. A vendor session wrote terminated over an active partnership. This is what 101 closes.');
    ELSE
      PERFORM pg_temp.t_log('D0', 'BEFORE 101: vendor terminates an active row', 'INFO',
        '>>> DEFECT NOT REPRODUCED (' || left(v_r, 150) || '). It may already be closed, or the subject does not behave like production. READ THIS BEFORE APPLYING. <<<');
    END IF;
  ELSE
    PERFORM pg_temp.t_log('D0', 'BEFORE 101: vendor terminates an active row', 'INFO', 'NO SUBJECT');
  END IF;

  -- ===================================================================
  -- H0 (INFO). WHY 101 IS A TRIGGER. Inside a block that is rolled back by
  -- design, replace the vendor policy's WITH CHECK with `false`, which
  -- refuses everything, and try the same write. If the write still goes
  -- through, the WITH CHECKs of the permissive policies are OR-ed and the
  -- claim policy's check passes every vendor's own row: a policy-only
  -- narrowing is vacuous.
  -- ===================================================================
  IF v_s1 IS NOT NULL THEN
    v_r := NULL;
    BEGIN
      PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
      ALTER POLICY "Partners can update partnership status" ON public.partnerships WITH CHECK (false);
      v_r := pg_temp.t_try(v_vm, format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'terminated', v_s1));
      RAISE EXCEPTION 'h0_rollback';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'h0_rollback' THEN
        v_r := 'HARNESS|' || SQLSTATE || '|' || SQLERRM;
      END IF;
    END;
    IF v_r = 'OK|1' THEN
      PERFORM pg_temp.t_log('H0', 'policy WITH CHECK (false) vs a vendor status write', 'INFO',
        'CONFIRMED: the write was still ADMITTED with the vendor policy refusing everything. Permissive WITH CHECKs are OR-ed and the claim policy passes the vendor''s own row. A policy-only narrowing would have been vacuous. 101 is a trigger for this reason.');
    ELSIF v_r LIKE 'ERR|42501|%' THEN
      PERFORM pg_temp.t_log('H0', 'policy WITH CHECK (false) vs a vendor status write', 'INFO',
        '>>> NOT CONFIRMED: the write was refused (' || left(v_r, 120) || '). The OR finding in 101''s header is WRONG for this database and a policy-only narrowing would have worked. The trigger still works; say so to the reviewer. <<<');
    ELSE
      PERFORM pg_temp.t_log('H0', 'policy WITH CHECK (false) vs a vendor status write', 'INFO',
        'inconclusive: ' || COALESCE(left(v_r, 150), 'NULL'));
    END IF;
  ELSE
    PERFORM pg_temp.t_log('H0', 'policy WITH CHECK (false) vs a vendor status write', 'INFO', 'NO SUBJECT');
  END IF;


  -- ===================================================================
  -- SECTION A. APPLY MIGRATION 101, INSIDE THIS TRANSACTION.
  -- Copied by script from 101_partnership_write_guard.sql.
  -- ===================================================================
CREATE OR REPLACE FUNCTION public.partnerships_guard_vendor_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- EXIT 1. NEITHER GUARDED COLUMN MOVED. A value comparison against OLD.
  -- payment_terms_requests, updated_at, vendor_org_id and every write that
  -- leaves status and accepted_at alone leave here.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  -- EXIT 2. NO END-USER SESSION. The service role, a database function, a
  -- migration. Already authorised by their own code.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- EXIT 3. THE CALLER IS THE LEAD AGENCY. OLD, not NEW: 087 has already
  -- refused any write that moved lead_org_id. IN (SELECT fn()), never
  -- = ANY: the current_user_* helpers return SETOF uuid.
  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller who is not the lead agency moved
  -- status or accepted_at. The vendor may do exactly two things, both from
  -- a PENDING row, and the prior status is OLD.status, never NEW.status.

  -- ACCEPT. accepted_at is written with it.
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  -- DECLINE. accepted_at must not move.
  IF OLD.status = 'pending'
     AND NEW.status = 'terminated'
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  -- RAISE, never silently revert to OLD. An RLS update that matches no row
  -- returns HTTP 200 with no error, and this project has lost real
  -- behaviour to exactly that five times. 42501 so a caller that already
  -- treats 087's refusals as a permission failure treats this as one; the
  -- message starts "partnerships.status" so it is not mistaken for RLS.
  RAISE EXCEPTION
    'partnerships.status may not be changed by the vendor on the partnership (attempted % -> %, accepted_at % -> %)',
    OLD.status, NEW.status, OLD.accepted_at, NEW.accepted_at
    USING ERRCODE = '42501',
          DETAIL  = 'Migration 101. A vendor session may only accept (pending -> active) or decline (pending -> terminated, accepted_at unchanged). Suspending, terminating, reinstating and re-inviting belong to the lead agency.';
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_vendor_state() IS
  'BEFORE UPDATE guard on public.partnerships, migration 101. A caller with an end-user '
  'session who is not a member of lead_org_id may change status or accepted_at only by '
  'ACCEPTING (OLD.status pending -> active) or DECLINING (pending -> terminated with '
  'accepted_at unchanged). Everything else is refused with 42501. Exempt: writes that move '
  'neither column, writes with no end-user session (auth.uid() IS NULL), and the lead agency. '
  'IT IS A TRIGGER BECAUSE A POLICY CANNOT DO IT: permissive WITH CHECK expressions are OR-ed '
  'and the claim policy''s WITH CHECK is satisfied by every vendor''s own row. It reads OLD, '
  'so a vendor cannot write pending onto a non-pending row. It fires AFTER '
  'partnerships_guard_identity_columns (alphabetical), which keeps 087''s and 093''s specific '
  'messages. DO NOT WIDEN THE TWO TRANSITIONS without a real vendor-session writer and a census.';

CREATE TRIGGER partnerships_guard_vendor_state
  BEFORE UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_guard_vendor_state();

COMMENT ON POLICY "Partners can update partnership status" ON public.partnerships IS
  'Despite its name this policy constrains NO column and NO value; it only requires that the '
  'caller belongs to vendor_org_id. The column permit list is in partnerships_guard_identity_'
  'columns() (093) and the status and accepted_at transition rules are in '
  'partnerships_guard_vendor_state() (101). A policy cannot hold them: the permissive WITH '
  'CHECK of "Partners can claim partnership by email" is OR-ed with this one and passes every '
  'vendor''s own row.';

  SELECT count(*) INTO v_pol_after FROM pg_policies WHERE schemaname = 'public';


  -- ===================================================================
  -- THE VENDOR IS REFUSED. T1 to T7.
  -- ===================================================================

  -- T1. >>> MANDATORY. A vendor cannot terminate an ACTIVE partnership.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T1', 'MANDATORY vendor cannot write terminated (active row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'terminated', v_s1),
    '42501', 'partnerships.status%');

  -- T2. >>> MANDATORY. A vendor cannot write 'active' over a SUSPENSION.
  PERFORM pg_temp.t_state(v_s1, 'suspended', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T2', 'MANDATORY vendor cannot lift a suspension', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'active', v_s1),
    '42501', 'partnerships.status%');

  -- T3. A vendor cannot write 'active' over a TERMINATION (including their own decline).
  PERFORM pg_temp.t_state(v_s1, 'terminated', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T3', 'vendor cannot reinstate a terminated row', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'active', v_s1),
    '42501', 'partnerships.status%');

  -- T4, T5, T6. >>> MANDATORY. THE SELF-ESCALATION. 'pending' onto a
  -- non-pending row, from each of the three states a vendor would use.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T4', 'MANDATORY vendor cannot write pending (active row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'pending', v_s1),
    '42501', 'partnerships.status%');
  PERFORM pg_temp.t_state(v_s1, 'suspended', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T5', 'MANDATORY vendor cannot write pending (suspended row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'pending', v_s1),
    '42501', 'partnerships.status%');
  PERFORM pg_temp.t_state(v_s1, 'terminated', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T6', 'MANDATORY vendor cannot write pending (terminated row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'pending', v_s1),
    '42501', 'partnerships.status%');

  -- T7. A vendor cannot suspend an active partnership either.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T7', 'vendor cannot write suspended (active row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'suspended', v_s1),
    '42501', 'partnerships.status%');


  -- ===================================================================
  -- THE VENDOR STILL ACCEPTS AND DECLINES. T8 to T12.
  -- ===================================================================

  -- T8. A vendor CAN accept while the row is pending.
  PERFORM pg_temp.t_state(v_s1, 'pending', NULL);
  PERFORM pg_temp.t_admitted('T8', 'MANDATORY vendor CAN accept (pending -> active)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L, accepted_at = now() WHERE id = %L', 'active', v_s1),
    format('SELECT status = %L AND accepted_at IS NOT NULL FROM public.partnerships WHERE id = %L', 'active', v_s1),
    'pending -> active with accepted_at, exactly what PATCH /api/partnerships writes');

  -- T9. A vendor CAN decline while the row is pending.
  PERFORM pg_temp.t_state(v_s1, 'pending', NULL);
  PERFORM pg_temp.t_admitted('T9', 'MANDATORY vendor CAN decline (pending -> terminated)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L, updated_at = now() WHERE id = %L', 'terminated', v_s1),
    format('SELECT status = %L AND accepted_at IS NULL FROM public.partnerships WHERE id = %L', 'terminated', v_s1),
    'pending -> terminated with accepted_at untouched, exactly what the decline branch writes');

  -- T10. On a pending row the vendor still cannot write anything but those two.
  PERFORM pg_temp.t_state(v_s1, 'pending', NULL);
  PERFORM pg_temp.t_refused('T10', 'vendor cannot write suspended (pending row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L WHERE id = %L', 'suspended', v_s1),
    '42501', 'partnerships.status%');

  -- T11. On a pending row the vendor cannot write accepted_at without accepting.
  PERFORM pg_temp.t_state(v_s1, 'pending', NULL);
  PERFORM pg_temp.t_refused('T11', 'vendor cannot stamp accepted_at while staying pending', v_vm, v_s1,
    format('UPDATE public.partnerships SET accepted_at = now() WHERE id = %L', v_s1),
    '42501', 'partnerships.status%');

  -- T12. A decline cannot carry an accepted_at.
  PERFORM pg_temp.t_state(v_s1, 'pending', NULL);
  PERFORM pg_temp.t_refused('T12', 'vendor decline cannot carry accepted_at', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = %L, accepted_at = now() WHERE id = %L', 'terminated', v_s1),
    '42501', 'partnerships.status%');

  -- T13. On an ACTIVE row the vendor cannot rewrite accepted_at.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '30 days');
  PERFORM pg_temp.t_refused('T13', 'vendor cannot rewrite accepted_at (active row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET accepted_at = now() WHERE id = %L', v_s1),
    '42501', 'partnerships.status%');


  -- ===================================================================
  -- THE VENDOR STILL REQUESTS PAYMENT TERMS. T14 to T16.
  -- >>> THE ONE THAT CATCHES AN OVER-NARROW GUARD. <<<
  -- ===================================================================

  -- T14. >>> MANDATORY. app/partner/projects/page.tsx:369, on an ACTIVE row.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_admitted('T14', 'MANDATORY vendor CAN write payment_terms_requests', v_vm, v_s1,
    format('UPDATE public.partnerships SET payment_terms_requests = COALESCE(payment_terms_requests, %L::jsonb) || %L::jsonb WHERE id = %L',
           '[]', '[{"proposed_rate":"t101"}]', v_s1),
    format('SELECT payment_terms_requests @> %L::jsonb FROM public.partnerships WHERE id = %L', '[{"proposed_rate":"t101"}]', v_s1),
    'the browser-side payment terms write is untouched by 101');

  -- T15. The same write on a SUSPENDED row. 101 does not change this; the
  -- assertion exists so the behaviour is known, not assumed.
  PERFORM pg_temp.t_state(v_s1, 'suspended', now() - interval '1 day');
  PERFORM pg_temp.t_admitted('T15', 'vendor can write payment_terms_requests (suspended row)', v_vm, v_s1,
    format('UPDATE public.partnerships SET payment_terms_requests = COALESCE(payment_terms_requests, %L::jsonb) || %L::jsonb WHERE id = %L',
           '[]', '[{"proposed_rate":"t101b"}]', v_s1),
    format('SELECT payment_terms_requests @> %L::jsonb FROM public.partnerships WHERE id = %L', '[{"proposed_rate":"t101b"}]', v_s1),
    'unchanged by 101: status and accepted_at do not move, so the guard exits at once');

  -- T16. A whole-row-shaped write that NAMES status and accepted_at but
  -- leaves them alone. The guard compares VALUES, never the SET clause.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_admitted('T16', 'vendor CAN name status/accepted_at unchanged', v_vm, v_s1,
    format('UPDATE public.partnerships SET status = status, accepted_at = accepted_at, updated_at = now(), payment_terms_requests = COALESCE(payment_terms_requests, %L::jsonb) WHERE id = %L',
           '[]', v_s1),
    format('SELECT status = %L FROM public.partnerships WHERE id = %L', 'active', v_s1),
    'a read-modify-write that restates the columns passes: value comparison, not SET-clause comparison');


  -- ===================================================================
  -- 093 IS STILL INTACT. T17 to T19. Expected layer: 093, LG009.
  -- ===================================================================
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_refused('T17', 'vendor cannot write nda_confirmed_at (093)', v_vm, v_s1,
    format('UPDATE public.partnerships SET nda_confirmed_at = now() WHERE id = %L', v_s1),
    'LG009', 'That is not a field you can change%');
  PERFORM pg_temp.t_refused('T18', 'vendor cannot write msa_confirmed_at (093)', v_vm, v_s1,
    format('UPDATE public.partnerships SET msa_confirmed_at = now() WHERE id = %L', v_s1),
    'LG009', 'That is not a field you can change%');
  PERFORM pg_temp.t_refused('T19', 'vendor cannot write partnership_notes (093)', v_vm, v_s1,
    format('UPDATE public.partnerships SET partnership_notes = jsonb_build_object(%L, gen_random_uuid()) WHERE id = %L', 't101', v_s1),
    'LG009', 'That is not a field you can change%');


  -- ===================================================================
  -- THE CLAIM PATH. T20, T21.
  -- ===================================================================

  -- T21 FIRST, on the still-unclaimed clone: a claimer cannot write status
  -- inside the claim statement. 093's permit list allows status and the
  -- claim policy's WITH CHECK constrains no column, so before 101 this was
  -- open on any unclaimed row. The row is 'terminated' here, so a vendor
  -- who could write 'active' would be lifting an ended relationship.
  IF v_ghost IS NOT NULL THEN
    PERFORM pg_temp.t_state(v_ghost, 'terminated', NULL);
  END IF;
  PERFORM pg_temp.t_refused('T21', 'claimer cannot write status inside the claim', v_vm, v_ghost,
    format('UPDATE public.partnerships SET vendor_org_id = %L, profile_status = %L, status = %L WHERE id = %L',
           v_vorg, 'active', 'active', v_ghost),
    '42501', 'partnerships.status%');

  -- T20. >>> MANDATORY. The claim itself still works: vendor_org_id NULL ->
  -- the caller's organization, with profile_status and updated_at, and no
  -- status. These are the columns app/auth/callback/route.ts:208 writes.
  IF v_ghost IS NOT NULL THEN
    PERFORM pg_temp.t_state(v_ghost, 'pending', NULL);
  END IF;
  PERFORM pg_temp.t_admitted('T20', 'MANDATORY the CLAIM path still works', v_vm, v_ghost,
    format('UPDATE public.partnerships SET vendor_org_id = %L, profile_status = %L, updated_at = now() WHERE id = %L',
           v_vorg, 'active', v_ghost),
    format('SELECT vendor_org_id = %L AND status = %L FROM public.partnerships WHERE id = %L', v_vorg, 'pending', v_ghost),
    'NULL -> the caller''s organization under "Partners can claim partnership by email"; 101 left the claim policy and the claim columns alone');


  -- ===================================================================
  -- THE AGENCY IS NOT RESTRICTED. T22 to T25.
  -- >>> PROVES THE FIX DID NOT BREAK THE FEATURE IT EXISTS TO PROTECT. <<<
  -- ===================================================================
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  PERFORM pg_temp.t_admitted('T22', 'MANDATORY agency CAN suspend', v_am, v_s1,
    format('UPDATE public.partnerships SET status = %L, updated_at = now() WHERE id = %L', 'suspended', v_s1),
    format('SELECT status = %L FROM public.partnerships WHERE id = %L', 'suspended', v_s1),
    'active -> suspended by a lead-org member');
  PERFORM pg_temp.t_admitted('T23', 'MANDATORY agency CAN terminate', v_am, v_s1,
    format('UPDATE public.partnerships SET status = %L, updated_at = now() WHERE id = %L', 'terminated', v_s1),
    format('SELECT status = %L FROM public.partnerships WHERE id = %L', 'terminated', v_s1),
    'suspended -> terminated by a lead-org member');
  PERFORM pg_temp.t_state(v_s1, 'suspended', now() - interval '1 day');
  PERFORM pg_temp.t_admitted('T24', 'agency CAN reinstate', v_am, v_s1,
    format('UPDATE public.partnerships SET status = %L, updated_at = now() WHERE id = %L', 'active', v_s1),
    format('SELECT status = %L FROM public.partnerships WHERE id = %L', 'active', v_s1),
    'suspended -> active by a lead-org member');

  -- T25. The agency policy still refuses a forged lead_org_id. WHICH LAYER
  -- refuses it is reported: 087's immutable-lead_org_id trigger fires first
  -- (both are 42501), so the policy's own WITH CHECK is not independently
  -- reachable while that trigger is live. The policy fingerprint lines
  -- below are what prove the policy text itself is unchanged.
  PERFORM pg_temp.t_state(v_s1, 'active', now() - interval '1 day');
  IF v_am IS NULL OR v_s1 IS NULL OR v_other_org IS NULL THEN
    PERFORM pg_temp.t_log('T25', 'agency cannot forge lead_org_id', 'INCONCLUSIVE', 'NO SUBJECT: needs a third organization.');
  ELSE
    v_r := pg_temp.t_try(v_am, format('UPDATE public.partnerships SET lead_org_id = %L WHERE id = %L', v_other_org, v_s1));
    IF v_r LIKE 'ERR|42501|%' THEN
      PERFORM pg_temp.t_log('T25', 'agency cannot forge lead_org_id', 'PASS',
        'refused 42501 by ' || CASE WHEN v_r LIKE '%immutable%' THEN '087''s trigger (fires before RLS)' ELSE 'row level security' END
        || ': ' || left(substr(v_r, 10), 90));
    ELSIF v_r LIKE 'OK|%' THEN
      PERFORM pg_temp.t_log('T25', 'agency cannot forge lead_org_id', 'FAIL', '>>> ADMITTED: ' || v_r || ' <<<');
    ELSE
      PERFORM pg_temp.t_log('T25', 'agency cannot forge lead_org_id', 'FAIL', 'refused, but not 42501: ' || left(v_r, 150));
    END IF;
  END IF;


  -- ===================================================================
  -- NOTHING ELSE MOVED. T26 to T29.
  -- ===================================================================
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_ag_1 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Agencies can update their partnerships';
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_cl_1 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Partners can claim partnership by email';
  SELECT md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) INTO v_fp_vn_1 FROM pg_policies
    WHERE schemaname='public' AND tablename='partnerships' AND policyname='Partners can update partnership status';

  PERFORM pg_temp.t_log('T26', 'agency policy byte-identical after 101',
    CASE WHEN v_fp_ag_0 IS NULL THEN 'INCONCLUSIVE' WHEN v_fp_ag_0 = v_fp_ag_1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_fp_ag_0 IS NULL THEN 'policy not found by name' ELSE 'fingerprint ' || left(v_fp_ag_0, 8) || ' -> ' || left(v_fp_ag_1, 8) END);
  PERFORM pg_temp.t_log('T27', 'claim policy byte-identical after 101',
    CASE WHEN v_fp_cl_0 IS NULL THEN 'INCONCLUSIVE' WHEN v_fp_cl_0 = v_fp_cl_1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_fp_cl_0 IS NULL THEN 'policy not found by name' ELSE 'fingerprint ' || left(v_fp_cl_0, 8) || ' -> ' || left(v_fp_cl_1, 8) END);
  PERFORM pg_temp.t_log('T28', 'vendor policy byte-identical after 101',
    CASE WHEN v_fp_vn_0 IS NULL THEN 'INCONCLUSIVE' WHEN v_fp_vn_0 = v_fp_vn_1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_fp_vn_0 IS NULL THEN 'policy not found by name' ELSE 'fingerprint ' || left(v_fp_vn_0, 8) || ' -> ' || left(v_fp_vn_1, 8)
         || ' (H0 altered this policy inside a rolled-back block; equality proves the rollback took)' END);

  SELECT (array_agg(tgname ORDER BY tgname))[1] = 'partnerships_guard_identity_columns'
         AND 'partnerships_guard_vendor_state' = ANY (array_agg(tgname))
    INTO v_order_ok
  FROM pg_trigger
  WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
    AND (tgtype & 2) <> 0 AND (tgtype & 16) <> 0
    AND tgname IN ('partnerships_guard_identity_columns','partnerships_guard_vendor_state');
  PERFORM pg_temp.t_log('T29', 'firing order: 093 trigger before 101 trigger',
    CASE WHEN v_order_ok IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN v_order_ok IS TRUE THEN 'partnerships_guard_identity_columns sorts first, so 087/093 keep their specific messages'
         ELSE 'the two triggers are not both present, or not in this order' END);


  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  SELECT count(*) FILTER (WHERE verdict = 'PASS'),
         count(*) FILTER (WHERE verdict = 'FAIL'),
         count(*) FILTER (WHERE verdict = 'INCONCLUSIVE'),
         count(*) FILTER (WHERE verdict = 'INFO'),
         count(*)
    INTO v_pass, v_fail, v_inconc, v_info, v_total
  FROM t_res;

  IF v_fail = 0 AND v_inconc = 0 THEN
    v_verdict_text := 'SAFE TO APPLY 101.';
    v_headline     := format('SAFE TO APPLY 101.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'INCONCLUSIVE. Not a green light.';
    v_headline     := format('DO NOT APPLY 101 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 101 does what it claims. A missing subject is not a pass.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 101.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. A run that logged fewer
  -- verdicts than it was written to produce is an incomplete report, and
  -- no verdict drawn from it can be trusted, INCLUDING A CLEAN ONE.
  IF v_total <> v_expected THEN
    v_headline := format('DO NOT APPLY 101.  THE TEST ITSELF IS BROKEN: expected %s logged verdicts, got %s.', v_expected, v_total);
  END IF;

  SELECT string_agg(rpad(id, 5) || rpad(verdict, 14) || rpad(name, 58) || note, E'\n' ORDER BY seq)
    INTO v_lines FROM t_res;

  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'verdicts logged : %s   (expected %s: %s)\n', v_total, v_expected,
              CASE WHEN v_total = v_expected THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'INFO            : %s   (D0 and H0; read them, they are not pass/fail)\n', v_info)
    || E'\n'
    || format(E'>>> subject         : %s\n',
              CASE WHEN v_s1 IS NULL THEN 'NONE - EVERYTHING IS UNMEASURED' ELSE 'a real partnership with a vendor-side member and a lead-side member' END)
    || format(E'    claim ghost     : %s\n', v_ghost_how)
    || format(E'    093 live        : %s\n', CASE WHEN v_has093 THEN 'yes' ELSE 'NO' END)
    || format(E'    policies        : %s before -> %s after (must be equal)\n', v_pol_before, v_pol_after)
    || E'\n'
    || E'ASSERTIONS\n'
    || COALESCE(v_lines, '(none)')
    || E'\n\n'
    || E'VERDICT: ' || v_verdict_text || E'\n'
    || E'EVERYTHING THIS FILE WROTE IS ROLLED BACK. Migration 101 is NOT applied.\n';

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
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for the
-- case where that exception is CAUGHT rather than propagated: an enclosing
-- handler added here later, or a client that wraps the batch in its own
-- block and swallows the error.
--
-- >>> WHAT IS AT STAKE. At the moment of the RAISE this transaction holds
-- >>> THE 101 TRIGGER CREATED, a cloned partnerships row, and the subject
-- >>> row's status rewritten many times. Without this ROLLBACK a swallowed
-- >>> exception would leave all of it committed by a file whose header says
-- >>> it applies nothing.
-- =====================================================================
ROLLBACK;
