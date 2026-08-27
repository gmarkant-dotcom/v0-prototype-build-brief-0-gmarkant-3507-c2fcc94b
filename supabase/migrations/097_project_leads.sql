-- =====================================================================
-- Migration 097: 097_project_leads.sql
--
--   CREATE TABLE public.project_leads
--   CREATE UNIQUE INDEX project_leads_one_open_per_project (PARTIAL)
--   CREATE public.project_leads_guard_membership()      -> trigger
--   CREATE TRIGGER project_leads_membership_guard
--   CREATE public.set_project_lead(uuid, uuid)          -> jsonb
--   CREATE 3 POLICIES: SELECT, INSERT, UPDATE. NO DELETE POLICY.
--
-- ONE NEW TABLE, ONE PARTIAL UNIQUE INDEX, TWO SUPPORTING INDEXES, TWO
-- FUNCTIONS, ONE TRIGGER AND THREE POLICIES. It writes no row, backfills
-- nothing, alters no existing table, drops nothing, and touches no policy
-- that already exists.
--
-- THE FULL FILENAME IS 097_project_leads.sql. Its rollback sibling is
-- 097_project_leads_down.sql, and that name sorts FIRST alphabetically
-- under a `097_*.sql` glob. A `094_*.sql` glob matched the down file
-- first this week and the down file was applied by mistake. DO NOT GLOB.
-- Open the file by its full name and read the first line of the header
-- before running anything.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- >>> THIS FILE CREATES A TABLE THE DEPLOYED CODE ALREADY CALLS. Read
-- >>> ORDERING AGAINST THE CODE below before running it, and run
-- >>> docs/097-preapply-test.sql first.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 301
-- and an explicit COMMIT; on LINE 650. Those are the only EXECUTABLE
-- lines that begin with either word AND end in a semicolon.
--
-- There are also TWO bare `BEGIN` lines with no semicolon, at LINES
-- 393 and 478. Those are plpgsql block openers inside the two
-- function bodies. They are not transaction control and they are not
-- matched by the grep below.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that. Use:
--
--     grep -n 'BEGIN;'  supabase/migrations/097_project_leads.sql
--     grep -n 'COMMIT;' supabase/migrations/097_project_leads.sql
--
-- Exactly one line of each ends in the bare keyword and a semicolon.
--
-- FOR THE DRY RUN: change the COMMIT; on LINE 650 to ROLLBACK;, run the
-- file, confirm no errors, then put COMMIT; back. The verification block
-- is AFTER that line and entirely commented out, so a dry run stops
-- there and executes none of it.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run docs/097-preapply-test.sql. Read the headline line.
--   2. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put it back.
--   3. Run for real.
--   4. Run VERIFICATION. Every query states its expected value.
--   5. Update the migrations table in LIGAMENT_CONTEXT.md.
--   6. THEN deploy the code. See ORDERING below - this one is not
--      optional and not reorderable.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. APPLY THIS BEFORE THE DEPLOY.
-- =====================================================================
--
-- THE CODE SHIPPED IN THE SAME BRANCH CALLS THIS TABLE AND THIS
-- FUNCTION BY NAME. `components/project-lead-picker.tsx` selects from
-- `project_leads` and calls `set_project_lead` over RPC.
--
--   APPLY THIS FILE FIRST. THEN PUSH THE CODE.
--
-- If the code is pushed first, the picker renders an error on every
-- project surface: PostgREST answers 42P01 `relation "public.project_leads"
-- does not exist` for the read and 42883 `function public.set_project_lead
-- does not exist` for the write. THAT IS THE INTENDED BEHAVIOUR AND IT
-- IS NOT A BUG TO PATCH. There is deliberately NO fallback path in that
-- component. The 082 fallback blocks are why: a fallback that fires
-- silently returns a wrong answer instead of an error, and a wrong
-- answer about who runs a project is worse than a visible failure.
--
-- Nothing else in the product reads either object, so an unapplied 097
-- breaks the picker and nothing but the picker.
--
-- =====================================================================
-- WHY THIS EXISTS, IN ONE PARAGRAPH
-- =====================================================================
--
-- GREG RULED: one point person per project at a time, changeable by any
-- team member (R1), and REASSIGNING RECORDS A HANDOVER, NOT AN OVERWRITE
-- (R2). Chris led it until March, Dana leads it now, and both facts have
-- to survive. A column on `projects` cannot express that - a column holds
-- one value and forgets the one before it. So this is a HISTORY TABLE
-- with an open/closed marker, and "who leads this project" is the row
-- whose `ended_at` is still NULL.
--
-- =====================================================================
-- WHY A PARTIAL UNIQUE INDEX AND NOT A PLAIN UNIQUE
-- =====================================================================
--
-- R1 says ONE current lead per project. R2 says every past lead is kept.
-- A plain UNIQUE on (project_id) would enforce the first and destroy the
-- second. The partial index enforces uniqueness ONLY over open rows:
--
--     UNIQUE (project_id) WHERE ended_at IS NULL
--
-- so a project may carry any number of closed leadership rows and at
-- most one open one.
--
-- THIS IS THE SAME MECHANISM 086 USED, cited as instructed:
-- `supabase/migrations/086_member_identity_and_invitations.sql:245-247`,
-- `org_invitations_one_live_per_email`, UNIQUE on (org_id, lower(email))
-- WHERE status = 'pending'. 086's header states the reason in a sentence
-- that transfers here word for word: "a partial index rather than a plain
-- UNIQUE, because the history matters: an address that was invited,
-- declined, and invited again should keep both rows."
--
-- And, as 086 also says, POSTGRES ENFORCES THIS RATHER THAN A
-- CHECK-THEN-INSERT IN A ROUTE. That is the pattern that produced the
-- duplicate partner_rfp_inbox rows in LIGAMENT_CONTEXT.md constraint 5 -
-- two callers 11ms apart, both passing the check. Two team members
-- reassigning the same project at the same moment is the same race, and
-- the loser here gets 23505 rather than a second open lead.
--
-- =====================================================================
-- THE FOREIGN KEYS, AND WHY EACH DELETE RULE IS WHAT IT IS
-- =====================================================================
--
-- 079 PHASE 7's rule (`079_organizations.sql:904-910`): CASCADE on a NOT
-- NULL identity column, SET NULL on a nullable one. The nullability is
-- how the choice gets expressed, so the real decision is which columns
-- are nullable.
--
-- project_id -> projects(id)     NOT NULL   ON DELETE CASCADE
--
--   Straightforward. A leadership record is a fact ABOUT A PROJECT. When
--   the project is gone there is no fact left to preserve - "Dana led the
--   project that no longer exists" is not history, it is litter. NOT NULL
--   because a lead row with no project is meaningless, and NOT NULL takes
--   CASCADE by the rule. `project_assignments` already CASCADEs from
--   `projects` the same way (`scripts/010-closed-ecosystem-schema.sql:73`),
--   so this matches what deleting a project already does to its children.
--
-- user_id    -> profiles(id)     NULLABLE   ON DELETE SET NULL
--
--   THIS ONE IS THE ARGUMENT, AND IT GOES THE OTHER WAY.
--
--   A leadership record is a fact ABOUT A PROJECT'S PAST, not a
--   possession of the person named in it. CASCADE would mean: delete a
--   colleague's account and every project they ever ran silently forgets
--   it was ever run. The March-to-June gap in the project's history would
--   just close up. THIS TABLE EXISTS SPECIFICALLY TO PRESERVE SUCH FACTS
--   (R2), so a delete rule that erases them defeats the table.
--
--   SET NULL keeps the row: the project still records that it had a point
--   person from March to June, and that the leadership then passed on.
--   What is lost is the NAME, which is the part that genuinely belongs to
--   the deleted account. That is the correct thing to lose.
--
--   So user_id is NULLABLE - not because a lead is optional, but because
--   079's rule reads nullability as the switch, and SET NULL is the
--   behaviour this table needs. The application NEVER writes NULL here:
--   `set_project_lead()` refuses a NULL p_user_id with LG006, and there
--   is no other sanctioned writer.
--
--   THE ONE CONSEQUENCE, STATED SO IT IS NOT A SURPRISE. If the account
--   holding a project's OPEN lead is deleted, that row stays open with a
--   NULL user_id. It still occupies the partial index's one-open slot, so
--   the project reads as "no point person" while the slot is taken. It is
--   not stuck: `set_project_lead()` closes whatever open row it finds
--   before inserting, NULL user or not, so the next person to set a lead
--   clears it in the ordinary way. VERIFICATION V9 finds any such rows.
--
-- RESTRICT WAS CONSIDERED AND REJECTED. It would refuse to delete any
-- profile that had ever led a project, which turns account deletion into
-- an error nobody can act on, and 079's rule does not offer it.
--
-- =====================================================================
-- THE MEMBERSHIP GUARD, AND WHY IT FOLLOWS 090 AND NOT 091
-- =====================================================================
--
-- WHAT IT ENFORCES: NEW.user_id is a member of the organization that
-- owns NEW.project_id. Without it, a project can be handed to somebody
-- who is not on the team, and the vendor-pool filter built later would
-- list a colleague who does not exist. RLS cannot express this - the
-- policies below constrain WHICH PROJECT a row may name, not WHICH
-- PERSON, and no policy can compare two columns of the new row against
-- a third table's membership.
--
-- THIS IS A FACT ABOUT THE ROW, NOT ABOUT THE CALLER. "user_id belongs to
-- the project's org" is true or false regardless of who is connected, so
-- the guard reads auth.uid() NOWHERE and behaves identically for a
-- session client, for service_role, for a migration and for the SQL
-- Editor. That is 090's `profiles_guard_active_org` shape
-- (`090_active_org.sql:321-367`), quoted there as: "Membership of the ROW
-- OWNER, not of the caller: this is a fact about the row, so it holds for
-- a session client, for service_role, for a migration and for the SQL
-- Editor alike. Nothing here reads auth.uid(), which is what makes it
-- independent of who is connected."
--
-- IT IS DELIBERATELY NOT 091's SHAPE. 091's column guard is
-- caller-dependent by design - it asks what THIS CALLER may change - and
-- that is the opposite case. Copying it here would make the guard's
-- answer depend on who ran the statement, which is exactly what a row
-- invariant must not do.
--
-- IT MUST BE SECURITY DEFINER, AND 090 MADE THIS CHOICE FOR THIS REASON.
-- `org_members` has a self-row-only SELECT policy. Under invoker rights
-- the guard would read org_members through RLS and see only the caller's
-- own membership row, so `EXISTS (... m.user_id = NEW.user_id ...)` would
-- be false for every colleague and A LEGITIMATE ASSIGNMENT OF A COLLEAGUE
-- WOULD BE REFUSED. The guard would pass only when you assigned yourself.
-- SECURITY DEFINER with search_path pinned is what makes it read the
-- membership table as it actually is. It widens nothing: it returns no
-- rows to anybody, it only says yes or no.
--
-- IT ALSO GUARDS UPDATE, not just INSERT, because UPDATE is how ended_at
-- gets stamped and an UPDATE could otherwise move user_id to an outsider
-- on a row that passed the check at insert time. The early return means
-- the ordinary handover UPDATE - which touches ended_at and nothing else
-- - costs two comparisons.
--
-- =====================================================================
-- THE SANCTIONED WRITER, AND WHY IT IS HERE RATHER THAN IN THE APP
-- =====================================================================
--
-- R2's handover is TWO WRITES: stamp ended_at on the open row, insert a
-- new one. From the application those are TWO PostgREST calls, which are
-- TWO HTTP REQUESTS WITH NO TRANSACTION BETWEEN THEM. A failure between
-- them leaves the project either with no open lead at all, or - if the
-- insert is attempted first - blocked by the partial unique index on
-- every subsequent attempt. Neither state has a user-visible cause.
--
-- So the handover is done in ONE statement, server side, inside one
-- transaction: `public.set_project_lead(p_project_id, p_user_id)`. The
-- picker calls it over RPC and does nothing else.
--
-- THIS FUNCTION IS CALLER-DEPENDENT AND IS SUPPOSED TO BE. It is the
-- 090 `set_active_org` shape (`090_active_org.sql:456-499`), not the
-- guard shape: SECURITY DEFINER bypasses RLS, so the function does its
-- own authorization against auth.uid() before writing anything. The
-- distinction from the trigger above is the whole point - a row invariant
-- must ignore the caller; a writer must not.
--
-- ONE ERROR FOR TWO CONDITIONS, exactly as 089's LG001 and 090's LG005
-- are: "no such project" and "not a project of yours" are the same
-- refusal, LG011, with the same message. Answering them differently
-- would confirm the existence of other organizations' projects.
--
-- NEW SQLSTATES. LG010 and LG011. LG001-LG009 are taken (089, 090, 091,
-- 092, 093-parked); these two are the next free pair.
--
-- =====================================================================
-- THE POLICIES: SELECT, INSERT, UPDATE. NO DELETE POLICY, DELIBERATELY.
-- =====================================================================
--
-- Any member of the owning organization may read the history, name a
-- point person, and close an open row. UPDATE is how ended_at gets
-- stamped, so it cannot be withheld.
--
-- THERE IS NO DELETE POLICY FOR ANYBODY. The history is APPEND-AND-CLOSE,
-- not erasable, which is R2 expressed in the policy set rather than in a
-- convention someone has to remember. This is `milestone_events`'
-- precedent (`080_milestone_events.sql`, "There is NO UPDATE policy and
-- NO DELETE policy on this table, for anybody, deliberately"), narrowed
-- by one verb because this table, unlike that one, has to close rows.
--
-- Not writing a policy is the whole mechanism: RLS denies by default, so
-- an authenticated DELETE matches zero rows and reports success having
-- deleted nothing. The rows still go when the PROJECT goes, by CASCADE.
-- That is intended - see the foreign key section.
--
-- THE PREDICATE IS DERIVED FROM THE PROJECT'S ORGANIZATION, not copied
-- onto the row. There is no org_id column on project_leads on purpose: a
-- duplicated org id is a second source of truth that can disagree with
-- the project's own, and 079 exists because company identity was
-- scattered across tables. The shape is the house one, lifted from
-- `onboarding_deployments` at `079_organizations.sql:1262-1268`:
--
--     project_id IN (SELECT pr.id FROM public.projects pr
--                    WHERE pr.org_id IN (SELECT public.current_user_org_ids()))
--
-- IN (SELECT fn()), never = ANY: current_user_org_ids() returns SETOF
-- uuid, and = ANY on a set-returning function is the 42809 this house
-- has hit before.
--
-- PREDICTED POLICY COUNT AFTER THIS FILE: 120.
-- 117 today (089-096 inclusive, verified live), plus exactly three new
-- ones, minus none. Stated explicitly because V7 asserts it and because
-- 121 would mean a fourth policy came from somewhere.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE TABLE.
--
-- No created_at column. `started_at` IS the moment the row was written -
-- set_project_lead() passes the same now() to the closing UPDATE and the
-- opening INSERT - and a second near-identical timestamp is a column two
-- readers will eventually disagree about.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_leads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id  uuid        NOT NULL
                          REFERENCES public.projects(id) ON DELETE CASCADE,

  -- NULLABLE so the foreign key can SET NULL. See THE FOREIGN KEYS above.
  -- The application never writes NULL here.
  user_id     uuid        NULL
                          REFERENCES public.profiles(id) ON DELETE SET NULL,

  started_at  timestamptz NOT NULL DEFAULT now(),

  -- NULL MEANS CURRENT. This is the only marker of who leads the project
  -- now, and the partial unique index below is built on exactly this.
  ended_at    timestamptz NULL,

  CONSTRAINT project_leads_interval_ordered
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

COMMENT ON TABLE public.project_leads IS
  'Who is the point person on a project, and who it was before them. One OPEN row per '
  'project - ended_at IS NULL - enforced by project_leads_one_open_per_project. Closed rows '
  'are kept forever: reassigning is a handover, not an overwrite (Greg''s ruling R2), so '
  '"Chris led it until March" and "Dana leads it now" are both readable from this table. '
  'Append-and-close: there is no DELETE policy for anybody. Written only by '
  'set_project_lead(), which does both halves of a handover in one transaction.';

COMMENT ON COLUMN public.project_leads.user_id IS
  'The point person. Nullable ONLY so the foreign key can be ON DELETE SET NULL: deleting '
  'a colleague''s account must not erase the fact that the project had a leader for those '
  'months. A NULL here is the residue of a deleted account, never something the product '
  'wrote. If it sits on an OPEN row the project reads as having no point person until '
  'someone sets one, which closes it in the ordinary way.';

COMMENT ON COLUMN public.project_leads.ended_at IS
  'NULL means this is the current point person. A timestamp means the leadership was '
  'handed over at that moment, and the row that replaced it carries the same value in '
  'started_at - no gap, no overlap.';


-- ---------------------------------------------------------------------
-- 2. ONE CURRENT LEAD PER PROJECT.
--
-- Same mechanism as 086's org_invitations_one_live_per_email
-- (086_member_identity_and_invitations.sql:245-247). Uniqueness over the
-- OPEN rows only, so history accumulates underneath it.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS project_leads_one_open_per_project
  ON public.project_leads (project_id)
  WHERE ended_at IS NULL;

-- Reading a project's history, newest first. The partial index above
-- covers only the open row, so it cannot serve this.
CREATE INDEX IF NOT EXISTS project_leads_project_started_idx
  ON public.project_leads (project_id, started_at DESC);

-- The unindexed side of the user_id foreign key. Also what a
-- "projects this colleague leads" read would use - that filter is NOT
-- built in this session and this index does not build it.
CREATE INDEX IF NOT EXISTS project_leads_user_idx
  ON public.project_leads (user_id)
  WHERE user_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 3. THE MEMBERSHIP GUARD.
--
-- 090's profiles_guard_active_org shape: a row invariant, reading
-- auth.uid() nowhere, SECURITY DEFINER with search_path pinned so it can
-- see org_members past that table's self-row-only SELECT policy.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_leads_guard_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- THE EARLY RETURN THAT MAKES THE HANDOVER FREE. Stamping ended_at
  -- moves neither identity column, so the ordinary close leaves here
  -- having done two comparisons. A read-modify-write that sends the same
  -- values back is IS NOT DISTINCT FROM and leaves here too.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id    IS NOT DISTINCT FROM OLD.user_id
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;

  -- A NULL point person is always allowed, and it has to be: this is
  -- exactly what the user_id foreign key's ON DELETE SET NULL does when
  -- an account is deleted, and refusing it would turn deleting a
  -- colleague into an error nobody could explain. 090 carries the same
  -- early return for the same reason.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pr.org_id INTO v_org_id
  FROM public.projects pr
  WHERE pr.id = NEW.project_id;

  -- No such project. Say nothing here and let the foreign key raise
  -- 23503 a moment later, which is the accurate error. Answering with a
  -- membership refusal would send the reader looking at the wrong column.
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE INVARIANT. Membership of the PERSON NAMED IN THE ROW, not of the
  -- caller. Nothing above or below reads auth.uid().
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = NEW.user_id
      AND m.org_id  = v_org_id
  ) THEN
    RAISE EXCEPTION 'That person is not on the team that owns this project.'
      USING ERRCODE = 'LG010';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.project_leads_guard_membership() IS
  'BEFORE INSERT OR UPDATE guard on project_leads. Enforces the row invariant "user_id '
  'names a member of the organization that owns project_id", for every writer including '
  'service_role. Returns immediately when neither identity column moves, or when user_id '
  'is NULL - which is what the foreign key''s ON DELETE SET NULL writes. Raises LG010 '
  'otherwise. SECURITY DEFINER because org_members has a self-row-only SELECT policy, so '
  'an invoker-rights version would see only the caller''s own membership and would refuse '
  'every legitimate assignment of a colleague. 090 made the same choice for the same '
  'reason. It returns no row to anybody; it answers yes or no.';

DROP TRIGGER IF EXISTS project_leads_membership_guard ON public.project_leads;

CREATE TRIGGER project_leads_membership_guard
  BEFORE INSERT OR UPDATE ON public.project_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.project_leads_guard_membership();


-- ---------------------------------------------------------------------
-- 4. THE SANCTIONED WRITER. The only thing the picker calls.
--
-- 090's set_active_org shape: caller-dependent, deliberately, because a
-- SECURITY DEFINER writer bypasses RLS and must do its own
-- authorization. Both halves of the handover run in this one
-- transaction, so the two-HTTP-request race cannot happen.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 5. GRANTS.
--
-- EVERY NEW FUNCTION NEEDS AN EXPLICIT REVOKE FROM anon BY NAME. REVOKE
-- ... FROM PUBLIC does NOT remove a direct grant, and a stock Supabase
-- project gives anon EXECUTE on functions in public through
-- pg_default_acl from both postgres and supabase_admin. This is the
-- mistake 088 made and 089 was written not to repeat.
--
-- set_project_lead is the one function here that needs granting.
--
-- project_leads_guard_membership() is a TRIGGER function: it is invoked
-- by the trigger, not by a caller, and PostgreSQL does not check EXECUTE
-- on trigger functions. It is still revoked from PUBLIC and from anon by
-- name, and from authenticated as well, because a trigger function is an
-- ordinary function that happens to return trigger and a direct call
-- would be a way to reach a SECURITY DEFINER body. 090 revokes its guard
-- from all three for exactly this reason. It is granted to NOBODY.
--
-- service_role IS DELIBERATELY NOT GRANTED on set_project_lead. It
-- already holds EXECUTE by the same default privilege, and V5 ASSERTS
-- that inherited value rather than this file writing a GRANT that
-- pretends to have set it - 082's precedent. No service-role caller
-- exists for this function and must not: the picker is session-client
-- only, and a service-role call would bypass the auth.uid() check that
-- is the function's entire authorization.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)        FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_project_lead(uuid, uuid)        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership()    FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_leads_guard_membership()    FROM authenticated;


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY. THREE POLICIES. NO DELETE POLICY.
--
-- ENABLE first. A table created without this is readable by every
-- authenticated caller in the project, and 079's audit exists because
-- that has happened here.
-- ---------------------------------------------------------------------
ALTER TABLE public.project_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_leads_org_select"
  ON public.project_leads AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "project_leads_org_insert"
  ON public.project_leads AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- UPDATE is how ended_at gets stamped, so every member has it. USING and
-- WITH CHECK are the same predicate: a row may not be moved onto another
-- organization's project on the way out.
CREATE POLICY "project_leads_org_update"
  ON public.project_leads AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- NO DELETE POLICY. Not an omission. See THE POLICIES above.


COMMIT;


-- =====================================================================
-- 7. VERIFICATION. RUN AFTER APPLYING. READ ONLY, ALL OF IT.
--    EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above, and so a dry run stops at the COMMIT line and executes none of
-- them. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE TABLE EXISTS AND RLS IS ENABLED.
--
--       SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
--       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relname = 'project_leads';
--       -- EXPECTED: exactly 1 row, relrowsecurity = t.
--       --
--       -- relrowsecurity = f means the ALTER TABLE ... ENABLE line did
--       -- not run and EVERY AUTHENTICATED USER IN THE PROJECT CAN READ
--       -- AND WRITE THIS TABLE. Roll back immediately.
--       -- relforcerowsecurity = f is expected and correct; the table
--       -- owner is postgres and no policy is meant to apply to it.
--
-- V2. THE COLUMNS. Types and nullability, both asserted.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'project_leads'
--       ORDER BY ordinal_position;
--       -- EXPECTED: exactly 5 rows -
--       --   id          uuid                        NO   gen_random_uuid()
--       --   project_id  uuid                        NO   null
--       --   user_id     uuid                        YES  null
--       --   started_at  timestamp with time zone    NO   now()
--       --   ended_at    timestamp with time zone    YES  null
--       --
--       -- user_id is_nullable = NO would mean the ON DELETE SET NULL
--       -- cannot fire and deleting a colleague's account will fail with
--       -- 23502 instead. That is the wrong failure - see THE FOREIGN
--       -- KEYS. Roll back.
--
-- V3. THE PARTIAL UNIQUE INDEX EXISTS AND IS PARTIAL.
--
--       SELECT indexname, indexdef
--       FROM pg_indexes
--       WHERE schemaname = 'public' AND tablename = 'project_leads'
--       ORDER BY indexname;
--       -- EXPECTED: exactly 4 rows -
--       --   project_leads_one_open_per_project    UNIQUE ... (project_id) WHERE (ended_at IS NULL)
--       --   project_leads_pkey                    UNIQUE ... (id)
--       --   project_leads_project_started_idx     ... (project_id, started_at DESC)
--       --   project_leads_user_idx                ... (user_id) WHERE (user_id IS NOT NULL)
--       --
--       -- THE `WHERE (ended_at IS NULL)` CLAUSE IS THE WHOLE POINT. A
--       -- UNIQUE index on (project_id) with NO where clause enforces one
--       -- lead per project EVER and makes the second handover fail with
--       -- 23505. That destroys R2. Roll back.
--
-- V4. EVERY FOREIGN KEY'S DELETE RULE.
--
--       SELECT con.conname,
--              a.attname   AS column_name,
--              cf.relname  AS references_table,
--              con.confdeltype
--       FROM pg_constraint con
--       JOIN pg_class c   ON c.oid  = con.conrelid
--       JOIN pg_class cf  ON cf.oid = con.confrelid
--       JOIN pg_namespace n ON n.oid = c.relnamespace
--       JOIN unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON TRUE
--       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
--       WHERE n.nspname = 'public' AND c.relname = 'project_leads'
--         AND con.contype = 'f'
--       ORDER BY con.conname;
--       -- EXPECTED: exactly 2 rows -
--       --   project_id -> projects   confdeltype = 'c'   (CASCADE)
--       --   user_id    -> profiles   confdeltype = 'n'   (SET NULL)
--       --
--       -- user_id showing 'c' means deleting a colleague's account will
--       -- delete every leadership row naming them and the project's
--       -- history will silently close up. That is the failure this
--       -- table exists to prevent. Roll back.
--       -- project_id showing 'n' means user_id and project_id were
--       -- swapped somewhere; a NULL project_id is refused by NOT NULL,
--       -- so deleting a project would start failing with 23502.
--
-- V5. THE GUARD FUNCTION: EXISTS, SECURITY DEFINER, search_path PINNED,
--     AND THE GRANTS ON BOTH FUNCTIONS.
--
--       SELECT p.proname,
--              pg_get_function_result(p.oid) AS returns,
--              p.prosecdef  AS security_definer,
--              p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('project_leads_guard_membership', 'set_project_lead')
--       ORDER BY p.proname;
--       -- EXPECTED: exactly 2 rows.
--       --   project_leads_guard_membership  returns trigger  t  {"search_path=public, pg_temp"}
--       --   set_project_lead                returns jsonb    t  {"search_path=public, pg_temp"}
--       --
--       -- security_definer = f on the guard means it reads org_members
--       -- through RLS, sees only the caller's own row, and REFUSES EVERY
--       -- LEGITIMATE ASSIGNMENT OF A COLLEAGUE. Roll back.
--       -- proconfig NULL means search_path did not pin. On a SECURITY
--       -- DEFINER function that is a real hazard, not a cosmetic one.
--       -- Roll back.
--
--       SELECT has_function_privilege('anon',
--                'public.set_project_lead(uuid, uuid)', 'EXECUTE') AS anon_setter,
--              has_function_privilege('authenticated',
--                'public.set_project_lead(uuid, uuid)', 'EXECUTE') AS auth_setter,
--              has_function_privilege('service_role',
--                'public.set_project_lead(uuid, uuid)', 'EXECUTE') AS svc_setter,
--              has_function_privilege('anon',
--                'public.project_leads_guard_membership()', 'EXECUTE') AS anon_guard,
--              has_function_privilege('authenticated',
--                'public.project_leads_guard_membership()', 'EXECUTE') AS auth_guard;
--       -- EXPECTED: anon_setter = f, auth_setter = t, svc_setter = t
--       --           (inherited, not granted here - 082's precedent),
--       --           anon_guard = f, auth_guard = f.
--       --
--       -- anon_setter = t means the default privilege survived the
--       -- REVOKE. auth.uid() is NULL for anon so the function raises
--       -- LG002 and writes nothing, but an executable SECURITY DEFINER
--       -- function reachable by anon is not left standing on a guess.
--       -- Re-run both REVOKE lines and re-check.
--
-- V6. THE TRIGGER IS ATTACHED, ON BOTH VERBS.
--
--       SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS def
--       FROM pg_trigger t
--       JOIN pg_class c ON c.oid = t.tgrelid
--       JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relname = 'project_leads'
--         AND NOT t.tgisinternal;
--       -- EXPECTED: exactly 1 row, tgname = project_leads_membership_guard,
--       -- tgenabled = 'O', and the definition reading
--       -- BEFORE INSERT OR UPDATE ... FOR EACH ROW.
--       --
--       -- "BEFORE INSERT" alone means an UPDATE can move user_id to
--       -- somebody outside the team on a row that passed at insert time.
--
-- V7. THE POLICIES: THREE, AND NO DELETE.
--
--       SELECT policyname, cmd, permissive, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'project_leads'
--       ORDER BY policyname;
--       -- EXPECTED: exactly 3 rows -
--       --   project_leads_org_insert  INSERT  qual NULL, with_check set
--       --   project_leads_org_select  SELECT  qual set,  with_check NULL
--       --   project_leads_org_update  UPDATE  both set
--       --
--       -- ANY ROW WITH cmd = 'DELETE' MEANS THE HISTORY IS ERASABLE and
--       -- R2 is not enforced. It did not come from this file. Roll back
--       -- and find out what wrote it.
--       -- Every predicate must read
--       --   project_id IN (SELECT pr.id FROM projects pr
--       --                  WHERE pr.org_id IN (SELECT current_user_org_ids()))
--       -- An org_id column named directly on project_leads means a second
--       -- source of truth got added somewhere.
--
-- V8. THE TOTAL POLICY COUNT.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 120.
--       --
--       -- 117 before this file (089-096 inclusive, verified live), plus
--       -- exactly the three above. 121 means a fourth policy landed from
--       -- somewhere - most likely a DELETE policy, which is the one this
--       -- file must not have. 118 or 119 means a CREATE POLICY line did
--       -- not run and part of the table is unreachable. Either is a
--       -- stop-and-read, not a retry.
--
-- V9. THE ORPHAN CHECK. Zero on day one; worth knowing later.
--
--       SELECT count(*) FILTER (WHERE ended_at IS NULL)                        AS open_rows,
--              count(*) FILTER (WHERE ended_at IS NULL AND user_id IS NULL)     AS open_with_no_person,
--              count(*)                                                         AS all_rows
--       FROM public.project_leads;
--       -- EXPECTED IMMEDIATELY AFTER APPLYING: 0, 0, 0. This file writes
--       -- no row and there is no backfill.
--       --
--       -- open_with_no_person > 0 later means an account holding an open
--       -- lead was deleted. Those projects read as having no point person
--       -- and the next set_project_lead() call on each clears the row.
--
-- V10. THE THING GREG ACTUALLY WANTS TO SEE. Run it in the agency
--      portal's own session AFTER setting a point person in the picker:
--
--       SELECT l.project_id, pr.name, l.user_id, pf.full_name,
--              l.started_at, l.ended_at
--       FROM public.project_leads l
--       JOIN public.projects pr ON pr.id = l.project_id
--       LEFT JOIN public.profiles pf ON pf.id = l.user_id
--       ORDER BY l.project_id, l.started_at DESC;
--       -- EXPECTED AFTER ONE ASSIGNMENT: one row, ended_at NULL.
--       -- EXPECTED AFTER ONE REASSIGNMENT: TWO rows for that project.
--       -- The older one has ended_at set; the newer one has ended_at
--       -- NULL; and the two timestamps are EQUAL - the same now() closed
--       -- one and opened the other. THAT SECOND ROW IS R2. If the
--       -- reassignment produced only one row, the picker overwrote
--       -- instead of handing over.
-- =====================================================================
