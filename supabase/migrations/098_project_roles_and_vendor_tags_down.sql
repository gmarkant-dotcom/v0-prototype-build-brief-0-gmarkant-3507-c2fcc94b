-- =====================================================================
-- Migration 098 ROLLBACK: 098_project_roles_and_vendor_tags_down.sql
--
-- THIS IS THE DOWN FILE. IT DESTROYS EVERY CONTRIBUTOR TAG AND EVERY
-- VENDOR RELATIONSHIP TAG. IF YOU MEANT TO APPLY 098, THE FILE YOU WANT
-- IS 098_project_roles_and_vendor_tags.sql - NO `_down`.
--
-- >>> THIS NAME SORTS FIRST UNDER A `098_*.sql` GLOB. That is exactly how
-- >>> a down file got applied by mistake this week. If you reached this
-- >>> file by expanding a glob rather than by typing its name, STOP.
--
-- =====================================================================
-- >>> THIS ROLLBACK IS NOT SYMMETRIC. READ THIS SECTION BEFORE THE   <<<
-- >>> REST OF THE FILE.                                             <<<
-- =====================================================================
--
-- 097's down file was a clean inverse: 097 created only new objects, so
-- dropping them restored the prior state exactly. THIS ONE IS NOT.
-- 098 ALTERED A LIVE TABLE, and two of its changes cannot be undone
-- without destroying information that did not exist before 098 ran.
--
-- ASYMMETRY 1. DROPPING THE ROLE COLUMN DESTROYS THE LEAD/CONTRIBUTOR
-- DISTINCTION, AND IT DOES NOT DELETE THE ROWS.
--
--   Contributor rows live in project_leads alongside lead rows. Once
--   `role` is gone there is nothing left in the row that says which was
--   which - no other column differs in kind, and a contributor row with
--   ended_at IS NULL is byte-for-byte indistinguishable from a lead row.
--   EVERY CONTRIBUTOR SILENTLY BECOMES A LEAD, on the same project, at
--   the same time.
--
-- ASYMMETRY 2. THE INDEX REVERTS TO ONE-OPEN-PER-PROJECT, AND THOSE ROWS
-- WOULD VIOLATE IT.
--
--   The restored index is UNIQUE (project_id) WHERE ended_at IS NULL. A
--   project with one open lead and even one open contributor has TWO
--   rows matching that predicate. THE CREATE UNIQUE INDEX AT THE FOOT OF
--   THIS FILE WILL FAIL:
--
--       ERROR:  could not create unique index "project_leads_one_open_per_project"
--       DETAIL:  Key (project_id)=(....) is duplicated.
--
--   THE WHOLE TRANSACTION THEN ABORTS AND NOTHING IS ROLLED BACK. That
--   is the safe direction - it refuses rather than mangling - but it
--   means THIS FILE CANNOT RUN AT ALL while open contributor rows exist,
--   not that it runs and does something regrettable.
--
--   The order below deliberately puts the index recreation LAST, so that
--   if it is going to fail it fails after having changed nothing that
--   matters and before the column drop can be committed.
--
-- >>> THEREFORE: THIS FILE IS SAFE ONLY WHILE NO CONTRIBUTOR ROWS
-- >>> EXIST. If any exist, this file either refuses to run (asymmetry 2)
-- >>> or, if you removed the index step to force it through, silently
-- >>> promotes every contributor to a lead (asymmetry 1). Neither is a
-- >>> rollback.
--
-- =====================================================================
-- BEFORE YOU RUN THIS. THREE QUERIES, IN THIS ORDER.
-- =====================================================================
--
-- 1. ARE THERE ANY CONTRIBUTOR ROWS AT ALL? This is the question that
--    decides whether this file is safe.
--
--       SELECT count(*) AS contributor_rows
--       FROM public.project_leads WHERE role = 'contributor';
--       -- 0  -> this rollback is safe to run. Proceed.
--       -- >0 -> STOP. See WHAT TO DO INSTEAD below.
--
-- 2. WOULD THE RESTORED INDEX ACTUALLY BUILD? Each row returned is a
--    project that will abort this file at its last statement.
--
--       SELECT project_id, count(*) AS open_rows
--       FROM public.project_leads
--       WHERE ended_at IS NULL
--       GROUP BY project_id HAVING count(*) > 1;
--       -- EXPECTED: 0 rows. Any row here means step 5 below fails.
--
-- 3. TAKE A COPY OF EVERYTHING THIS FILE DESTROYS. It is small and it is
--    the only record. Keep the output somewhere outside the database.
--
--       SELECT id, project_id, user_id, role, started_at, ended_at
--       FROM public.project_leads ORDER BY project_id, started_at;
--
--       SELECT id, partnership_id, user_id, added_by, added_at
--       FROM public.partnership_owners ORDER BY partnership_id, added_at;
--
-- =====================================================================
-- WHAT TO DO INSTEAD, IF CONTRIBUTOR ROWS EXIST
-- =====================================================================
--
-- There is no DELETE policy on project_leads, so you cannot clear them
-- from the application - that is R3 working as designed. Removing them
-- is an owner-level act, done knowingly, with the copy from query 3
-- already saved:
--
--       -- AS THE TABLE OWNER, having saved query 3's output:
--       DELETE FROM public.project_leads WHERE role = 'contributor';
--
-- Then re-run queries 1 and 2, confirm both are clean, and run this file.
--
-- DO NOT instead delete the CREATE UNIQUE INDEX step to make this file
-- pass. That converts a refusal into asymmetry 1 - the contributors are
-- not removed, they are promoted, and the table then says several people
-- simultaneously led the same project with nothing recording that this
-- ever happened.
--
-- =====================================================================
-- WHAT THIS RESTORES, AND WHAT IT CANNOT
-- =====================================================================
--
-- RESTORED EXACTLY: the 120-policy count; project_leads without a role
-- column or its CHECK; the one-open-per-project index with its original
-- single-clause predicate; project_leads_org_update's original predicate;
-- set_project_lead's 097 body. No partnership_owners table, no
-- partnership_owners_guard_membership function, no LG012.
--
-- NOT RESTORED, EVER: the contributor tags and the vendor relationship
-- tags themselves. Nothing else in the schema holds either fact.
--
-- >>> set_project_lead IS RESTORED TO ITS 097 BODY, WHICH CONTAINS THE
-- >>> DEFECT 098 FIXED. That is correct for a rollback - the 097 body is
-- >>> what 097 applied - AND IT IS ONLY SAFE BECAUSE THE COLUMN IS GONE
-- >>> AND WITH IT EVERY CONTRIBUTOR ROW'S DISTINCTION. With no
-- >>> contributors, "the open row" and "the lead" are the same thing
-- >>> again and the 097 body is correct. This is another reason the
-- >>> file is safe only in the state described above.
--
-- IT IS DONE WITH CREATE OR REPLACE, not DROP-then-CREATE, for the same
-- reason 098 used it: a DROP discards the ACL and pg_default_acl
-- re-grants anon EXECUTE on a SECURITY DEFINER writer. That is the 088
-- mistake. Re-run 098's V8 after this file to confirm anon still holds
-- no EXECUTE.
--
-- THE DEPLOYED CODE WILL BREAK, LOUDLY, AND THAT IS CORRECT.
-- `components/partnership-owner-picker.tsx` and
-- `components/project-contributor-picker.tsx` have NO fallback paths, on
-- purpose. After this runs they show PostgREST's 42P01 and 42703. If you
-- are rolling back the migration, roll back the deploy too - revert both
-- Phase 3 commits - rather than leaving the pickers calling objects that
-- no longer exist.
--
-- TRANSACTION CONTROL. One explicit BEGIN; on LINE 172 and one
-- explicit COMMIT; on LINE 330. There is ONE bare plpgsql `BEGIN`
-- with no semicolon, at LINE 200, inside the restored function body.
--
--     grep -n 'BEGIN;'  supabase/migrations/098_project_roles_and_vendor_tags_down.sql
--     grep -n 'COMMIT;' supabase/migrations/098_project_roles_and_vendor_tags_down.sql
--
-- =====================================================================
-- ORDER OF OPERATIONS
-- =====================================================================
--
-- 1. The new table goes first. DROP TABLE removes its two policies, its
--    index, its unique constraint, its three foreign keys and its
--    trigger with it. The explicit DROP TRIGGER is kept anyway so that a
--    partial 098 - one that created the trigger and then failed - still
--    rolls back cleanly. 097's down file keeps its own for the same
--    reason.
-- 2. Then the guard function, after the trigger that used it.
-- 3. Then set_project_lead, back to its 097 body.
-- 4. Then the UPDATE policy's original predicate.
-- 5. Then, LAST, the column and the index - the two steps that can fail,
--    placed where a failure costs nothing.
--
-- NO `CASCADE` ANYWHERE. If something outside 098 has come to depend on
-- these objects, this file must FAIL and tell you, not quietly remove
-- whatever that was.
-- =====================================================================


BEGIN;


-- 1. THE VENDOR TAG TABLE AND ITS TRIGGER.
DROP TRIGGER IF EXISTS partnership_owners_membership_guard ON public.partnership_owners;

DROP TABLE IF EXISTS public.partnership_owners;

-- 2. ITS GUARD, after the trigger that referenced it.
DROP FUNCTION IF EXISTS public.partnership_owners_guard_membership();


-- 3. set_project_lead BACK TO ITS 097 BODY, byte-identical to
--    supabase/migrations/097_project_leads.sql lines 465-563. The three
--    `-- 098:` markers are gone with the changes they annotated.
CREATE OR REPLACE FUNCTION public.set_project_lead(p_project_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid        := auth.uid();
  v_now      timestamptz := now();
  v_org_id   uuid;
  v_open_id  uuid;
  v_previous uuid;
  v_new_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to set a point person.'
      USING ERRCODE = 'LG002';
  END IF;

  IF p_project_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Choose a project and a point person.'
      USING ERRCODE = 'LG006';
  END IF;

  -- AUTHORIZATION. One refusal for two conditions - "no such project" and
  -- "not a project of yours" are the same LG011 with the same message,
  -- because distinguishing them would confirm that another organization's
  -- project exists. 089's LG001 and 090's LG005 set this precedent.
  SELECT pr.org_id INTO v_org_id
  FROM public.projects pr
  WHERE pr.id = p_project_id
    AND pr.org_id IN (
      SELECT m.org_id FROM public.org_members m WHERE m.user_id = v_uid
    );

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'That is not a project you can change.'
      USING ERRCODE = 'LG011';
  END IF;

  -- The incoming point person must be on the same team. The trigger
  -- enforces this too and would catch it at the INSERT below; checking
  -- here as well is what makes the refusal arrive before anything is
  -- written, so a rejected handover never closes the standing lead.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = p_user_id
      AND m.org_id  = v_org_id
  ) THEN
    RAISE EXCEPTION 'That person is not on the team that owns this project.'
      USING ERRCODE = 'LG010';
  END IF;

  -- LOCK THE OPEN ROW. Two team members reassigning the same project at
  -- the same moment serialize here. If there is NO open row, this locks
  -- nothing and the two INSERTs race - the loser gets 23505 from the
  -- partial unique index, which is a loud, correct failure rather than a
  -- second open lead.
  SELECT l.id, l.user_id INTO v_open_id, v_previous
  FROM public.project_leads l
  WHERE l.project_id = p_project_id
    AND l.ended_at IS NULL
  FOR UPDATE;

  -- ALREADY THE POINT PERSON. Setting Dana to Dana is not a handover and
  -- must not write a closed row saying she handed over to herself.
  IF v_open_id IS NOT NULL AND v_previous IS NOT DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object(
      'project_id',       p_project_id,
      'user_id',          p_user_id,
      'previous_user_id', v_previous,
      'lead_id',          v_open_id,
      'changed',          false
    );
  END IF;

  -- THE HANDOVER, BOTH HALVES, ONE TRANSACTION. The same v_now closes the
  -- old row and opens the new one, so the history has no gap and no
  -- overlap. This closes an open row whose user_id is NULL too - the
  -- residue of a deleted account - which is how that state gets cleared.
  IF v_open_id IS NOT NULL THEN
    UPDATE public.project_leads
       SET ended_at = v_now
     WHERE id = v_open_id;
  END IF;

  INSERT INTO public.project_leads (project_id, user_id, started_at)
  VALUES (p_project_id, p_user_id, v_now)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'project_id',       p_project_id,
    'user_id',          p_user_id,
    'previous_user_id', v_previous,
    'lead_id',          v_new_id,
    'changed',          true
  );
END;
$$;

COMMENT ON FUNCTION public.set_project_lead(uuid, uuid) IS
  'The only sanctioned writer for project_leads. Closes the project''s open leadership row '
  'and opens a new one naming p_user_id, both in this one transaction, because from the '
  'application those are two PostgREST calls with no transaction between them and a failure '
  'between them leaves the project with no open lead or blocked by the partial unique index. '
  'Caller-dependent by design, unlike project_leads_guard_membership(): SECURITY DEFINER '
  'bypasses RLS so this does its own authorization against auth.uid(). Refuses LG002 signed '
  'out, LG006 on a NULL argument, LG011 for a project that does not exist OR is not the '
  'caller''s (one refusal, two conditions, per 089 and 090), LG010 for a point person who is '
  'not on the team. Returns the new row''s id, the previous point person and a changed flag; '
  'setting the standing lead to themselves returns changed=false and writes nothing.';


-- 4. THE UPDATE POLICY'S ORIGINAL PREDICATE, without the role clause.
ALTER POLICY "project_leads_org_update"
  ON public.project_leads
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));


-- 5. LAST: THE COLUMN AND THE INDEX. THE TWO STEPS THAT CAN FAIL.
--    Read the ASYMMETRY section at the head of this file before running.
--
--    The column drop takes the CHECK constraint with it, so there is no
--    separate DROP CONSTRAINT.
ALTER TABLE public.project_leads
  DROP COLUMN IF EXISTS role;

DROP INDEX IF EXISTS public.project_leads_one_open_per_project;

-- >>> THIS IS THE STATEMENT THAT FAILS IF OPEN CONTRIBUTOR ROWS EXISTED.
-- >>> By this point the role column is already gone, so they are no
-- >>> longer identifiable - which is why query 1 at the head of this
-- >>> file has to be run BEFORE any of this, not after a failure.
CREATE UNIQUE INDEX project_leads_one_open_per_project
  ON public.project_leads (project_id)
  WHERE ended_at IS NULL;


COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. RUN AFTER APPLYING. READ ONLY.
-- =====================================================================
--
-- R1. THE ROLE COLUMN IS GONE.
--
--       SELECT count(*) AS still_there
--       FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='project_leads' AND column_name='role';
--       -- EXPECTED: 0.
--
-- R2. THE INDEX IS BACK TO ITS SINGLE-CLAUSE PREDICATE.
--
--       SELECT indexdef FROM pg_indexes
--       WHERE schemaname='public' AND indexname='project_leads_one_open_per_project';
--       -- EXPECTED: 1 row, ending WHERE (ended_at IS NULL) and with NO
--       -- mention of role. 0 rows means the CREATE at step 5 failed and
--       -- THE TABLE IS NOW UNPROTECTED - a second open lead can be
--       -- written. That is the one outcome here worth panicking about.
--       -- Re-read the ASYMMETRY section and rebuild it by hand.
--
-- R3. THE NEW TABLE AND ITS GUARD ARE GONE.
--
--       SELECT count(*) AS tbl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--       WHERE n.nspname='public' AND c.relname='partnership_owners';
--       -- EXPECTED: 0.
--
--       SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname='public' AND p.proname='partnership_owners_guard_membership';
--       -- EXPECTED: 0 rows.
--
-- R4. set_project_lead IS BACK TO THE 097 BODY, AND anon STILL HOLDS NO
--     EXECUTE. The second half matters more than the first.
--
--       SELECT pg_get_functiondef(p.oid) LIKE '%l.role = ''lead''%' AS still_has_098_fix,
--              has_function_privilege('anon', p.oid, 'EXECUTE')    AS anon_execute
--       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname='public' AND p.proname='set_project_lead';
--       -- EXPECTED: 1 row, still_has_098_fix = f, anon_execute = f.
--       -- anon_execute = t means the CREATE OR REPLACE behaved like a
--       -- DROP and pg_default_acl re-granted anon. Revoke it by name.
--
-- R5. THE UPDATE POLICY NO LONGER MENTIONS role.
--
--       SELECT qual, with_check FROM pg_policies
--       WHERE schemaname='public' AND tablename='project_leads'
--         AND policyname='project_leads_org_update';
--       -- EXPECTED: 1 row, neither column containing 'role'.
--
-- R6. THE POLICY COUNT IS BACK TO WHERE 097 LEFT IT.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname='public';
--       -- EXPECTED: 120.
--       -- 122 means the DROP TABLE did not run.
-- =====================================================================
