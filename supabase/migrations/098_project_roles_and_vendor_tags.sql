-- =====================================================================
-- Migration 098: 098_project_roles_and_vendor_tags.sql
--
--   ALTER TABLE public.project_leads ADD COLUMN role  (NOT NULL, DEFAULT 'lead')
--   ALTER TABLE public.project_leads ADD CONSTRAINT project_leads_role_valid
--   DROP  INDEX  project_leads_one_open_per_project
--   CREATE UNIQUE INDEX project_leads_one_open_per_project (TWO-PART PREDICATE)
--   CREATE OR REPLACE public.set_project_lead(uuid, uuid)   -- DEFECT FIX
--   ALTER POLICY project_leads_org_update                   -- NARROWED
--   CREATE TABLE public.partnership_owners
--   CREATE public.partnership_owners_guard_membership()     -> trigger
--   CREATE TRIGGER partnership_owners_membership_guard
--   CREATE 2 POLICIES: SELECT, INSERT. NO UPDATE. NO DELETE.
--
-- THE FULL FILENAME IS 098_project_roles_and_vendor_tags.sql. Its
-- rollback sibling is 098_project_roles_and_vendor_tags_down.sql, and
-- that name sorts FIRST alphabetically under a `098_*.sql` glob. A
-- `094_*.sql` glob matched the down file first this week and the down
-- file was applied by mistake. DO NOT GLOB. Open the file by its full
-- name and read the first line of the header before running anything.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- >>> THIS IS THE FIRST MIGRATION IN THIS SEQUENCE TO ALTER A TABLE
-- >>> THAT ALREADY HAS ROWS IN IT. 097 is applied and project_leads
-- >>> carries live leadership history, including a handover recorded on
-- >>> project 5473ceeb. Every ALTER below is a statement that can
-- >>> destroy a fact. Read PART A ORDERING before running it, and run
-- >>> docs/098-preapply-test.sql first.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 471
-- and an explicit COMMIT; on LINE 899. Those are the only EXECUTABLE
-- lines that begin with either word AND end in a semicolon.
--
-- There are also TWO bare `BEGIN` lines with no semicolon, at LINES
-- 566 and 770. Those are plpgsql block openers inside the two
-- function bodies. They are not transaction control and they are not
-- matched by the grep below.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that. Use:
--
--     grep -n 'BEGIN;'  supabase/migrations/098_project_roles_and_vendor_tags.sql
--     grep -n 'COMMIT;' supabase/migrations/098_project_roles_and_vendor_tags.sql
--
-- Exactly one line of each ends in the bare keyword and a semicolon.
--
-- FOR THE DRY RUN: change the COMMIT; on LINE 899 to ROLLBACK;, run
-- the file, confirm no errors, then put COMMIT; back. The verification
-- block is AFTER that line and entirely commented out, so a dry run stops
-- there and executes none of it.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run docs/098-preapply-test.sql. Read the headline line.
--   2. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put it back.
--   3. Run for real.
--   4. Run VERIFICATION. Every query states its expected value.
--   5. Update the migrations table in LIGAMENT_CONTEXT.md.
--   6. THEN deploy the code. See ORDERING below.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. APPLY THIS BEFORE THE DEPLOY.
-- =====================================================================
--
--   APPLY THIS FILE FIRST. THEN PUSH THE CODE.
--
-- Two shipped surfaces call objects this file creates:
-- `components/partnership-owner-picker.tsx` selects from and inserts into
-- `partnership_owners`; `components/project-contributor-picker.tsx`
-- selects `project_leads.role`. Before this file is applied PostgREST
-- answers 42P01 `relation "public.partnership_owners" does not exist` for
-- the first and 42703 `column project_leads.role does not exist` for the
-- second. THAT IS THE INTENDED BEHAVIOUR AND IT IS NOT A BUG TO PATCH.
-- There is deliberately NO fallback path in either component, for the
-- reason 097 gives: the 082 fallback blocks fired silently and returned a
-- wrong answer instead of an error.
--
-- >>> THE ONE THING THAT BREAKS IN THE OTHER DIRECTION. If this file is
-- >>> applied and the code is NOT deployed, nothing breaks: no existing
-- >>> reader of project_leads filters on role, and the shipped picker's
-- >>> `.maybeSingle()` open-row read still returns exactly one row
-- >>> because NO CONTRIBUTOR ROWS EXIST YET. The window is safe in that
-- >>> direction and only in that direction.
--
-- =====================================================================
-- PART A. WHY project_leads GAINS A ROLE INSTEAD OF A SECOND TABLE
-- =====================================================================
--
-- GREG RULED (R2): the work tag SHARES project_leads rather than getting
-- its own table. One row is the lead, the rest are contributors, and THE
-- POINT PERSON IS SIMPLY THE CONTRIBUTOR MARKED LEAD.
--
-- THE VOCABULARY IS ('lead','contributor') AND THE CODE SUGGESTS NO
-- THIRD VALUE. The two role vocabularies already in this schema are
-- org_members.role ('owner','admin','member') and profiles.role
-- ('agency','partner'); neither describes project work and neither
-- offers a third term to borrow. Nothing in the product distinguishes
-- kinds of contribution - there is no discipline, no craft and no
-- seniority field anywhere near a project - so a richer vocabulary here
-- would be inventing a distinction the interface cannot show and the
-- data cannot fill. Two values, and a CHECK that says so.
--
-- THE DEFAULT IS 'lead', DELIBERATELY, SO NO BACKFILL IS NEEDED. Every
-- row that exists today was written by set_project_lead() and means "this
-- person is or was the point person". 'lead' is what those rows already
-- mean, so the default makes the column true of the existing data at the
-- moment it is added rather than a second statement later that could
-- fail halfway. THE VERIFICATION BLOCK COUNTS ROWS WITH A NULL ROLE
-- RATHER THAN ASSERTING THE DEFAULT APPLIED (V2).
--
-- =====================================================================
-- PART A ORDERING. THE RISKIEST LINE IN THIS MIGRATION.
-- =====================================================================
--
-- DROPPING AND RECREATING A UNIQUE INDEX ON A LIVE TABLE IS THE RISKIEST
-- THING THIS FILE DOES. Between the DROP and the CREATE the one-open-
-- lead-per-project invariant is not enforced by anything. It is inside
-- the transaction, so no other session can commit a violating row in
-- that window, but the ORDER of the four statements is still what makes
-- the CREATE safe:
--
--   1. ADD COLUMN role NOT NULL DEFAULT 'lead'   <- every existing row
--                                                   is 'lead' from here
--   2. ADD CONSTRAINT project_leads_role_valid
--   3. DROP INDEX project_leads_one_open_per_project
--   4. CREATE UNIQUE INDEX ... WHERE ended_at IS NULL AND role = 'lead'
--
-- THE COLUMN AND ITS DEFAULT LAND FIRST (1) SO THAT NO ROW CAN VIOLATE
-- THE NEW PREDICATE AT (4).
--
-- AND THE CREATE AT (4) CANNOT FAIL ON EXISTING DATA. This is provable
-- without knowing how many rows the table holds, which matters because
-- the count changes every time somebody reassigns a project:
--
--   The new predicate is (ended_at IS NULL AND role = 'lead').
--   The old predicate is (ended_at IS NULL).
--   Every row matching the new one matches the old one, so the new
--   index's row set is a SUBSET of the old index's row set.
--   The old index is applied, live, and has been enforcing uniqueness
--   of project_id over that superset since 097.
--   Uniqueness over a set implies uniqueness over any subset.
--
-- So (4) succeeds for ANY row count, INCLUDING ZERO, and including any
-- number of handovers recorded between now and when Greg runs this.
--
-- WHAT IT WOULD LOOK LIKE IF IT FAILED ANYWAY, so nobody meets it cold:
--
--     ERROR:  could not create unique index "project_leads_one_open_per_project"
--     DETAIL:  Key (project_id)=(....) is duplicated.
--
-- That would mean the premise above is false - that two open rows for one
-- project already exist, which the 097 index should have made impossible.
-- THE TRANSACTION ABORTS AND NOTHING IS CHANGED, which is the safe
-- direction. Do not retry. Run the query in the down file's
-- "BEFORE YOU RUN THIS" section to find the duplicate pair and stop.
--
-- =====================================================================
-- PART A, THE DEFECT. WHAT A CONTRIBUTOR ROW DOES TO WHAT 097 BUILT.
-- =====================================================================
--
-- BOTH 097 OBJECTS WERE WRITTEN WHEN "OPEN ROW" AND "THE LEAD" WERE THE
-- SAME THING. Adding contributors breaks that identity, and the two
-- objects are affected very differently.
--
-- project_leads_guard_membership() IS UNAFFECTED AND IS NOT CHANGED BY
-- THIS FILE. Its invariant is "NEW.user_id is a member of the
-- organization that owns NEW.project_id". That sentence contains no
-- notion of open, closed, one-per-project or lead, so it is exactly as
-- true of a contributor row as of a lead row, and it is what we want for
-- contributors: you cannot tag somebody who is not on the team. The
-- early return on an UPDATE that moves neither identity column still
-- holds. NO CHANGE NEEDED. Not changing it is also what keeps its ACL
-- untouched.
--
-- >>> set_project_lead() IS BROKEN BY CONTRIBUTOR ROWS AND THIS FILE
-- >>> FIXES IT. It is the defect most likely to be subtly wrong in this
-- >>> whole change, so here is exactly what goes wrong.
--
-- The function locates the row to close like this (097 lines 519-525):
--
--     SELECT l.id, l.user_id INTO v_open_id, v_previous
--     FROM public.project_leads l
--     WHERE l.project_id = p_project_id
--       AND l.ended_at IS NULL
--     FOR UPDATE;
--
-- WITH CONTRIBUTORS PRESENT THAT PREDICATE MATCHES SEVERAL ROWS. A
-- plpgsql `SELECT ... INTO` with multiple matching rows DOES NOT RAISE -
-- it silently assigns THE FIRST ROW RETURNED, in whatever order the plan
-- happens to produce, and discards the rest. There is no ORDER BY here.
-- So v_open_id becomes an ARBITRARY open row: the lead, or any
-- contributor.
--
-- THREE OUTCOMES, AND THE FIRST IS THE DANGEROUS ONE:
--
--   (i)  IT PICKS A CONTRIBUTOR WHOSE user_id IS THE PERSON BEING SET.
--        The "already the point person" branch fires, the function
--        RETURNS changed=false AND WRITES NOTHING, and the picker reports
--        success. THE LEAD IS NEVER CHANGED. No error, no log line, no
--        red state - the handover simply does not happen and the
--        interface says it did. This is the silent wrong answer.
--
--   (ii) IT PICKS A CONTRIBUTOR WHOSE user_id IS SOMEBODY ELSE. The
--        function stamps ended_at on THAT CONTRIBUTOR - closing the wrong
--        person's contribution - and then inserts a new lead row while
--        the real lead is still open. With the new two-part index that
--        second open lead raises 23505 and the whole transaction aborts,
--        so the wrongly-closed contributor is rolled back with it. Loud,
--        and self-repairing, but the error names a unique violation and
--        tells the reader nothing about why.
--
--   (iii) IT PICKS THE ACTUAL LEAD. Correct behaviour, by luck.
--
-- THE FIX IS ONE PREDICATE: the function must look for the LEAD row, not
-- for AN OPEN row. Section 3 below adds `AND l.role = 'lead'` to that
-- SELECT, names role explicitly in the INSERT, and re-states role on the
-- closing UPDATE. Three changes, all listed at the section head.
--
-- IT IS DONE WITH CREATE OR REPLACE AND NEVER DROP-THEN-CREATE. A DROP
-- discards the function's ACL, and the next CREATE picks up a fresh set
-- of default privileges from pg_default_acl - which on a stock Supabase
-- project GRANTS EXECUTE TO anon. That is the 088 mistake 089 was
-- written not to repeat, and here it would hand an anonymous caller a
-- SECURITY DEFINER writer. OR REPLACE keeps the existing ACL in place.
-- V8 ASSERTS THAT RATHER THAN TRUSTING IT.
--
-- =====================================================================
-- PART A, ADD-ONLY. HOW IT IS EXPRESSED, AND WHY NOTHING CONFLICTS.
-- =====================================================================
--
-- R3: both tag layers are ADD-ONLY. No UPDATE and no DELETE for anybody,
-- matching milestone_events. The requirement to check is whether "no
-- UPDATE for contributor rows" can coexist with 097's UPDATE policy,
-- which its header says "cannot be withheld" because UPDATE is how
-- ended_at gets stamped.
--
-- >>> THEY DO NOT CONFLICT, AND THE REASON IS THAT 097's STATED
-- >>> JUSTIFICATION FOR THAT POLICY DOES NOT ACTUALLY HOLD.
--
-- set_project_lead() is SECURITY DEFINER and the table is owned by
-- postgres with relforcerowsecurity = f (097's V1 asserts exactly this).
-- A SECURITY DEFINER function running as the table owner DOES NOT CONSULT
-- RLS AT ALL. So the ended_at stamp inside that function never touches
-- project_leads_org_update, and the policy could be dropped outright
-- without breaking the handover.
--
-- IT IS NARROWED RATHER THAN DROPPED. Narrowing keeps 097's intent
-- - a member may close their own organization's lead row - available to
-- any future direct writer, while removing UPDATE from contributor rows
-- entirely. Dropping it would also move the policy count, and a count
-- that moves for two reasons at once is harder to check.
--
-- The narrowed predicate adds `AND role = 'lead'` to BOTH clauses, and
-- the two clauses do different jobs because they see different rows:
--
--   USING      is evaluated against the OLD row -> a contributor row
--              cannot be TARGETED by an UPDATE at all.
--   WITH CHECK is evaluated against the NEW row -> a lead row cannot be
--              REWRITTEN INTO a contributor row.
--
-- Together those two refuse: updating a contributor (USING fails),
-- promoting a contributor to lead (USING fails), and demoting a lead to
-- contributor (WITH CHECK fails). CONTRIBUTOR ROWS ARE ADD-ONLY, which
-- is R3, and lead rows keep exactly the access 097 gave them.
--
-- NOTHING IN THE APPLICATION UPDATES THIS TABLE DIRECTLY. Verified by
-- reading, not assumed: the only references to project_leads in app/,
-- lib/, components/, contexts/ and hooks/ are one SELECT and one
-- `.rpc("set_project_lead")`, both in components/project-lead-picker.tsx.
-- Narrowing this policy therefore changes no shipped behaviour.
--
-- THERE IS STILL NO DELETE POLICY, for anybody, on either table. Not
-- writing one is the whole mechanism: RLS denies by default, so an
-- authenticated DELETE matches zero rows and reports success having
-- deleted nothing. milestone_events' precedent, as 097 cites it.
--
-- INSERT NEEDS NO NEW POLICY AND THIS FILE ADDS NONE. R4 says any team
-- member can add either tag. project_leads_org_insert already reads
-- WITH CHECK (project_id IN (SELECT pr.id FROM projects pr WHERE
-- pr.org_id IN (SELECT current_user_org_ids()))) and says NOTHING about
-- role, so a contributor row from any member of the owning organization
-- already satisfies it exactly as a lead row does. ADDING A SECOND
-- INSERT POLICY WOULD BE A DUPLICATE: PERMISSIVE policies are OR-ed, so
-- it would widen nothing, enforce nothing, and leave two predicates to
-- keep in step forever.
--
-- =====================================================================
-- PART B. THE VENDOR RELATIONSHIP TAG, AND WHY IT POINTS AT partnerships
-- =====================================================================
--
-- GREG RULED (R1): TWO DIFFERENT TAGS. On a project or an awarded scope,
-- tagging a colleague says they WORKED ON THAT WORK - that is Part A. On
-- a VENDOR PROFILE, tagging a colleague says they OWN THAT VENDOR
-- RELATIONSHIP, and that claim is about the relationship itself, not
-- about any one project bought through it. So the foreign key points at
-- partnerships(id) and NOT at a project-vendor pair. A project-scoped key
-- would make the same person's ownership of the same vendor a different
-- fact on every project, which is not what the tag means.
--
-- MANY COLLEAGUES PER PARTNERSHIP, each at most once: UNIQUE
-- (partnership_id, user_id). A second attempt to tag the same person
-- raises 23505 rather than growing a duplicate row that nobody can
-- delete - and with no DELETE policy, a duplicate would be permanent.
--
-- WHO AND WHEN ARE RECORDED, because a manual claim with no author is
-- unfalsifiable: added_by and added_at. added_by IS ENFORCED AGAINST
-- auth.uid() IN THE INSERT POLICY, not merely defaulted, so a caller
-- cannot record somebody else as the author of their own claim.
--
-- =====================================================================
-- >>> PART B, THE SECURITY QUESTION. WHY THE VENDOR SIDE IS EXCLUDED. <<<
-- =====================================================================
--
-- IN ONE SENTENCE, FOR THE HEADER: a partnership row is readable and
-- writable from BOTH sides, so scoping this table by "an org on this
-- partnership" would let a VENDOR tag their own staff onto the AGENCY's
-- record of who owns the relationship - names the agency never chose,
-- appearing in the agency's own surfaces as though it had - and since
-- the ownership claim is the agency's, BOTH the policy and the guard are
-- scoped to lead_org_id ALONE.
--
-- THE LONGER FORM. partnerships carries lead_org_id AND vendor_org_id,
-- and 079 gives each side its own policies
-- (079_organizations.sql:1464-1498):
--
--     "Agencies can view their partnerships"   USING (lead_org_id   IN ...)
--     "Partners can view their partnerships"   USING (vendor_org_id IN ...)
--
-- So a vendor organization genuinely can SELECT the partnership row. Any
-- predicate here of the form "lead_org_id IN (...) OR vendor_org_id IN
-- (...)" would inherit that and hand the vendor INSERT on the agency's
-- ownership list.
--
-- THIS IS THE SAME CLASS AS THE READ-SCOPE DEFECT where the vendor
-- portal returned the agency's own outbound RFPs because the query
-- trusted RLS for scoping across a two-sided table. The lesson there was
-- that on a two-sided table, "related to me" is not a scope - the SIDE
-- has to be named. It is named here, twice, in the policy and in the
-- guard, because either one alone would leave the other as the hole.
--
-- A SECOND, INDEPENDENT REASON THE VENDOR SIDE CANNOT CARRY THIS.
-- partnerships.vendor_org_id IS NULLABLE AND IS MOSTLY NULL. 079 PHASE 8
-- measured it and left it nullable on purpose: "partnerships.vendor_org_id
-- 27 of 31 rows NULL - ghost rows" (079_organizations.sql:952), the
-- pre-claim state before a vendor claims their invitation. lead_org_id is
-- NOT NULL (079_organizations.sql:990). A vendor-side predicate would
-- therefore be comparing against NULL on the large majority of rows and
-- silently matching nothing - which looks identical to a working policy
-- until the day a vendor claims their row. THE SIDE THAT IS ALWAYS
-- PRESENT IS THE LEAD SIDE, and it is also the side that owns the claim.
--
-- I FOUND NO REASON TO WIDEN IT, so nothing is widened and there is
-- nothing here for Greg to rule on.
--
-- =====================================================================
-- PART B, THE GUARD. WHY A SECOND ONE RATHER THAN REUSING 097's.
-- =====================================================================
--
-- 097's project_leads_guard_membership() DERIVES THE ORGANIZATION BY
-- READING projects.org_id FROM NEW.project_id. This table has no
-- project_id; its organization comes from partnerships.lead_org_id via
-- NEW.partnership_id. That is a different table and a different column,
-- and a trigger function cannot be parameterized over either without
-- dynamic SQL. REUSING IT WOULD MEAN CONTORTING IT - branching on TG_ARGV
-- or TG_TABLE_NAME inside a function that 097 is entitled to assume is
-- about project_leads - so THIS FILE WRITES A SECOND GUARD, which is the
-- disposition the brief asks for when the org is derived differently.
--
-- WHAT IS REUSED IS THE SHAPE, NOT THE FUNCTION: 090's row-invariant
-- form, exactly as 097 adopted it. SECURITY DEFINER with search_path
-- pinned, so it can see org_members past that table's self-row-only
-- SELECT policy; reading auth.uid() NOWHERE, so it answers identically
-- for a session client, for service_role, for a migration and for the
-- SQL Editor. "user_id belongs to the partnership's lead organization"
-- is a fact about the row, not about the caller.
--
-- IT IS SCOPED TO lead_org_id, THE SAME SIDE AS THE POLICY, for the
-- reason above. The policy decides WHICH PARTNERSHIP a row may name; the
-- guard decides WHICH PERSON. Both have to name the lead side or the
-- other becomes the way in.
--
-- NEW SQLSTATE: LG012. LG001-LG011 are taken (089, 090, 091, 092,
-- 093-parked, 097); this is the next free one.
--
-- =====================================================================
-- PART B, THE FOREIGN KEYS. 079's RULE, AND ONE DELIBERATE DIVERGENCE.
-- =====================================================================
--
-- 079 PHASE 7's rule (079_organizations.sql:904-910): CASCADE on a NOT
-- NULL identity column, SET NULL on a nullable one. Nullability is how
-- the choice is expressed, so the real decision is which columns are
-- nullable.
--
-- partnership_id -> partnerships(id)  NOT NULL  ON DELETE CASCADE
--
--   A tag is a fact ABOUT A PARTNERSHIP. Delete the partnership and
--   "Dana owns the relationship that no longer exists" is not history,
--   it is litter. NOT NULL takes CASCADE by the rule.
--
-- user_id -> profiles(id)  NOT NULL  ON DELETE CASCADE
--
--   >>> THIS IS WHERE THIS TABLE DIVERGES FROM project_leads, WHICH
--   >>> MADE user_id NULLABLE AND SET NULL. The divergence is deliberate
--   >>> and the reason is that the two tables record different KINDS of
--   >>> fact.
--
--   project_leads records a DATED INTERVAL: "the project had a point
--   person from March to June." Losing the name leaves that interval
--   standing and still meaningful, which is why 097 chose SET NULL - the
--   history survives the account.
--
--   THIS TABLE RECORDS NO INTERVAL. A row here says only "this person
--   owns this relationship." Strip the person and nothing is left: the
--   row degrades to "somebody owns this relationship", which is not a
--   diminished fact, it is no fact at all.
--
--   AND IT COULD NEVER BE CLEARED. There is no DELETE policy on this
--   table for anybody, by R3. A SET NULL orphan would therefore be
--   PERMANENT - an unremovable blank entry in the agency's ownership
--   list, with no product path to clear it. That is the outcome CASCADE
--   avoids, and it is the argument that decides it.
--
--   NOT NULL follows from choosing CASCADE, per 079's rule, and is also
--   correct on its own terms: this column is the entire content of the
--   row.
--
-- added_by -> profiles(id)  NULLABLE  ON DELETE SET NULL
--
--   The opposite call, for the opposite reason. The claim stays true
--   when the colleague who recorded it leaves; what is lost is only the
--   attribution, which is the part that genuinely belonged to that
--   account. CASCADE here would delete other people's valid tags because
--   an administrator was offboarded. Nullable, so SET NULL, per the rule.
--
--   THE APPLICATION NEVER WRITES NULL HERE: the INSERT policy's
--   WITH CHECK requires added_by = auth.uid(), and auth.uid() is never
--   NULL for the authenticated role. A NULL in this column is always the
--   residue of a deleted account.
--
-- RESTRICT WAS CONSIDERED AND REJECTED on all three, as 097 rejected it:
-- it turns account and partnership deletion into an error nobody can
-- act on, and 079's rule does not offer it.
--
-- =====================================================================
-- PREDICTED POLICY COUNT AFTER THIS FILE: 122.
--
-- 120 today (089-097 inclusive, verified live), PLUS EXACTLY TWO -
-- partnership_owners_lead_select and partnership_owners_lead_insert -
-- MINUS NONE.
--
-- PART A ADDS NO POLICY AND REMOVES NONE. It narrows an existing one
-- with ALTER POLICY, which rewrites a predicate in place and does not
-- move the count. That is also why ALTER POLICY was chosen over
-- DROP-then-CREATE: the count stays a single-purpose signal.
--
-- 123 would mean a third policy came from somewhere. 121 means only one
-- of the two was created. 120 means section 8 did not run at all.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE ROLE COLUMN. Ordering step (1) - see PART A ORDERING.
--
-- NOT NULL DEFAULT 'lead' makes every existing row a lead at the moment
-- the column appears, with no backfill statement that could fail
-- halfway. In PostgreSQL 11+ a DEFAULT on ADD COLUMN is stored in the
-- catalogue rather than written to every row, so this does not rewrite
-- the table.
-- ---------------------------------------------------------------------
ALTER TABLE public.project_leads
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'lead';

-- Ordering step (2). Named, rather than inline on the ADD COLUMN, so the
-- down file and the verification block can both refer to it by name.
ALTER TABLE public.project_leads
  DROP CONSTRAINT IF EXISTS project_leads_role_valid;

ALTER TABLE public.project_leads
  ADD CONSTRAINT project_leads_role_valid
  CHECK (role IN ('lead', 'contributor'));

COMMENT ON COLUMN public.project_leads.role IS
  'Which claim this row makes. ''lead'' is the point person - at most one open lead per '
  'project, enforced by project_leads_one_open_per_project. ''contributor'' says only that '
  'this person worked on the project (Greg''s ruling R2); any number may be open at once. '
  'DEFAULT ''lead'' because every row written before this column existed was written by '
  'set_project_lead() and already meant exactly that. Contributor rows are add-only: '
  'project_leads_org_update is scoped to role = ''lead'' and there is no DELETE policy.';


-- ---------------------------------------------------------------------
-- 2. THE INDEX SWAP. Ordering steps (3) and (4).
--
-- The new predicate's row set is a SUBSET of the old one's, and the old
-- index has been enforcing uniqueness over that superset since 097, so
-- the CREATE below cannot fail on existing data for ANY row count. The
-- proof, and what a failure would look like anyway, are in PART A
-- ORDERING at the head of this file.
--
-- The name is REUSED rather than replaced, so no reader has to learn a
-- second name for the same invariant and the down file has one thing to
-- restore.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.project_leads_one_open_per_project;

CREATE UNIQUE INDEX project_leads_one_open_per_project
  ON public.project_leads (project_id)
  WHERE ended_at IS NULL AND role = 'lead';

-- Listing a project's contributors is a new read: (project_id, role)
-- filtered, and the existing project_leads_project_started_idx leads with
-- project_id so it already serves it. NO NEW INDEX IS ADDED HERE - one
-- that duplicated an existing prefix would cost writes and buy nothing.


-- ---------------------------------------------------------------------
-- 3. THE DEFECT FIX. set_project_lead() MUST CLOSE THE LEAD, NOT AN
--    ARBITRARY OPEN ROW.
--
-- CREATE OR REPLACE, NEVER DROP-THEN-CREATE: OR REPLACE preserves the
-- ACL, a DROP would re-grant anon from pg_default_acl. V8 asserts it.
--
-- THE BODY BELOW IS 097's, REPRODUCED FROM THE FILE, WITH EXACTLY THREE
-- CHANGES, EACH MARKED `-- 098:` IN PLACE:
--
--   1. The locating SELECT gains `AND l.role = 'lead'`.  THE FIX.
--   2. The INSERT names `role` explicitly instead of leaning on the
--      column default, so the statement is correct on its own reading
--      and stays correct if the default is ever changed.
--   3. The closing UPDATE re-states `AND role = 'lead'`. REDUNDANT
--      TODAY - v_open_id is a primary key that change 1 guarantees came
--      from a lead row - and kept anyway so the statement cannot close a
--      contributor even if change 1 is later edited. 097's own down file
--      keeps a redundant DROP TRIGGER on the same reasoning.
--
-- NOTHING ELSE MOVES: same signature, same LANGUAGE, same SECURITY
-- DEFINER, same search_path, same declarations, same four refusals with
-- the same SQLSTATEs and the same messages, same jsonb shape.
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

  -- LOCK THE OPEN LEAD ROW. Two team members reassigning the same project
  -- at the same moment serialize here. If there is NO open lead, this
  -- locks nothing and the two INSERTs race - the loser gets 23505 from the
  -- partial unique index, which is a loud, correct failure rather than a
  -- second open lead.
  --
  -- 098: `AND l.role = 'lead'` IS THE FIX. Without it this predicate
  -- matches every open row - the lead AND every contributor - and
  -- `SELECT ... INTO` silently takes an arbitrary one of them. See PART A,
  -- THE DEFECT at the head of this file for the three outcomes.
  SELECT l.id, l.user_id INTO v_open_id, v_previous
  FROM public.project_leads l
  WHERE l.project_id = p_project_id
    AND l.ended_at IS NULL
    AND l.role = 'lead'                                          -- 098: THE FIX
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
     WHERE id = v_open_id
       AND role = 'lead';                                        -- 098: belt and braces
  END IF;

  INSERT INTO public.project_leads (project_id, user_id, started_at, role)
  VALUES (p_project_id, p_user_id, v_now, 'lead')                -- 098: explicit, not defaulted
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
  'The only sanctioned writer for project_leads LEAD rows. Closes the project''s open row '
  'WHERE role = ''lead'' and opens a new one naming p_user_id, both in this one transaction. '
  'It does not read, write or close contributor rows - 098 added role = ''lead'' to its '
  'locating SELECT because without it the predicate matched every open row and SELECT INTO '
  'took an arbitrary one, which either silently skipped the handover or closed the wrong '
  'person. Caller-dependent by design, unlike the row-invariant guard: SECURITY DEFINER '
  'bypasses RLS so this does its own authorization against auth.uid(). Refuses LG002 signed '
  'out, LG006 on a NULL argument, LG011 for a project that does not exist OR is not the '
  'caller''s, LG010 for a point person who is not on the team. Contributor rows are inserted '
  'directly under project_leads_org_insert, not through this function.';


-- ---------------------------------------------------------------------
-- 4. NARROW THE UPDATE POLICY SO CONTRIBUTOR ROWS ARE ADD-ONLY.
--
-- ALTER POLICY rewrites the predicate in place: the policy keeps its
-- name, its command and its role, and THE POLICY COUNT DOES NOT MOVE.
-- See PART A, ADD-ONLY for why this does not break set_project_lead
-- (it is SECURITY DEFINER and never consults RLS) and for what each of
-- the two clauses refuses.
-- ---------------------------------------------------------------------
ALTER POLICY "project_leads_org_update"
  ON public.project_leads
  USING (
    role = 'lead'
    AND project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (
    role = 'lead'
    AND project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())));


-- ---------------------------------------------------------------------
-- 5. THE VENDOR RELATIONSHIP TAG.
--
-- Foreign key on PARTNERSHIPS, not on a project-vendor pair: this is
-- about who owns the relationship with the vendor. See PART B.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partnership_owners (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  partnership_id uuid        NOT NULL
                             REFERENCES public.partnerships(id) ON DELETE CASCADE,

  -- NOT NULL and CASCADE, unlike project_leads.user_id. This row records
  -- no interval, so it does not survive losing its subject, and with no
  -- DELETE policy a SET NULL orphan could never be cleared. See PART B,
  -- THE FOREIGN KEYS.
  user_id        uuid        NOT NULL
                             REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The author of the claim. Nullable so the foreign key can SET NULL:
  -- the tag stays true when the person who recorded it leaves. Written
  -- only as auth.uid(), enforced by the INSERT policy below.
  added_by       uuid        NULL
                             REFERENCES public.profiles(id) ON DELETE SET NULL,

  added_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partnership_owners_one_per_person
    UNIQUE (partnership_id, user_id)
);

COMMENT ON TABLE public.partnership_owners IS
  'Which colleagues own the relationship with a vendor (Greg''s ruling R1). Points at '
  'partnerships, not at a project-vendor pair, because the claim is about the relationship '
  'itself rather than about work bought through it. SCOPED TO THE LEAD SIDE ONLY: a '
  'partnership row is readable from both sides, so a policy scoped to "an org on this '
  'partnership" would let a vendor tag their own staff onto the agency''s ownership record. '
  'Add-only - any team member may add a tag, nobody may UPDATE or DELETE one - so there is '
  'no UPDATE policy and no DELETE policy for anybody.';

COMMENT ON COLUMN public.partnership_owners.added_by IS
  'Who recorded this claim. A manual claim with no author is unfalsifiable, so it is '
  'required at insert time: the INSERT policy''s WITH CHECK demands added_by = auth.uid(), '
  'which means a caller can only ever record themselves. NULL here is never something the '
  'product wrote - it is the residue of a deleted account, via ON DELETE SET NULL.';

-- The unindexed side of the user_id foreign key, and what a "vendor
-- relationships this colleague owns" read would use. The UNIQUE
-- constraint above already indexes (partnership_id, user_id), which
-- leads with partnership_id and so serves the per-partnership list.
CREATE INDEX IF NOT EXISTS partnership_owners_user_idx
  ON public.partnership_owners (user_id);


-- ---------------------------------------------------------------------
-- 6. THE MEMBERSHIP GUARD FOR THE VENDOR TAG.
--
-- A SECOND guard, not a reuse of 097's: the organization is derived from
-- partnerships.lead_org_id here, not from projects.org_id, and a trigger
-- function cannot be parameterized over the table it reads. See PART B,
-- THE GUARD.
--
-- 090's row-invariant shape, as 097 adopted it. SECURITY DEFINER with
-- search_path pinned so it can see org_members past that table's
-- self-row-only SELECT policy. It reads auth.uid() NOWHERE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partnership_owners_guard_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_org_id uuid;
BEGIN
  -- The same early return 097 carries: an UPDATE that moves neither
  -- identity column cannot break the invariant. This table has no
  -- UPDATE policy, so on the ordinary path nothing reaches here as an
  -- UPDATE at all; the branch exists for service_role and for migrations.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id        IS NOT DISTINCT FROM OLD.user_id
     AND NEW.partnership_id IS NOT DISTINCT FROM OLD.partnership_id THEN
    RETURN NEW;
  END IF;

  -- NO NULL user_id EARLY RETURN, and none is needed: this column is NOT
  -- NULL and its foreign key CASCADEs rather than SET NULLs, so unlike
  -- project_leads there is no path that writes a NULL here.

  -- THE LEAD SIDE, AND ONLY THE LEAD SIDE. Reading vendor_org_id here
  -- would let a vendor's member pass this guard on the agency's record.
  SELECT p.lead_org_id INTO v_lead_org_id
  FROM public.partnerships p
  WHERE p.id = NEW.partnership_id;

  -- No such partnership. Say nothing and let the foreign key raise 23503
  -- a moment later, which is the accurate error. 097's guard does the
  -- same for the same reason.
  IF v_lead_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE INVARIANT. Membership of the PERSON NAMED IN THE ROW, not of the
  -- caller. Nothing above or below reads auth.uid().
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = NEW.user_id
      AND m.org_id  = v_lead_org_id
  ) THEN
    RAISE EXCEPTION 'That person is not on the team that owns this vendor relationship.'
      USING ERRCODE = 'LG012';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.partnership_owners_guard_membership() IS
  'BEFORE INSERT OR UPDATE guard on partnership_owners. Enforces the row invariant '
  '"user_id names a member of the LEAD organization on partnership_id", for every writer '
  'including service_role. Raises LG012 otherwise. Scoped to partnerships.lead_org_id and '
  'never to vendor_org_id: the partnership row is visible from both sides, so a guard that '
  'accepted either would let a vendor tag their own staff onto the agency''s ownership '
  'record. A SECOND guard rather than a reuse of project_leads_guard_membership() because '
  'the organization is derived from a different table and column. SECURITY DEFINER because '
  'org_members has a self-row-only SELECT policy, so an invoker-rights version would see '
  'only the caller''s own membership and refuse every legitimate tag of a colleague. It '
  'returns no row to anybody; it answers yes or no.';

DROP TRIGGER IF EXISTS partnership_owners_membership_guard ON public.partnership_owners;

CREATE TRIGGER partnership_owners_membership_guard
  BEFORE INSERT OR UPDATE ON public.partnership_owners
  FOR EACH ROW
  EXECUTE FUNCTION public.partnership_owners_guard_membership();


-- ---------------------------------------------------------------------
-- 7. GRANTS.
--
-- EVERY NEW FUNCTION NEEDS AN EXPLICIT REVOKE FROM anon BY NAME. REVOKE
-- ... FROM PUBLIC does NOT remove a direct grant, and a stock Supabase
-- project gives anon EXECUTE on functions in public through
-- pg_default_acl from both postgres and supabase_admin. This is the
-- mistake 088 made and 089 was written not to repeat.
--
-- partnership_owners_guard_membership() is a TRIGGER function: it is
-- invoked by the trigger, not by a caller, and PostgreSQL does not check
-- EXECUTE on trigger functions. It is still revoked from PUBLIC, from
-- anon and from authenticated by name, because a trigger function is an
-- ordinary function that happens to return trigger and a direct call
-- would be a way to reach a SECURITY DEFINER body. 090 and 097 revoke
-- their guards from all three for exactly this reason. IT IS GRANTED TO
-- NOBODY.
--
-- NOTHING IS GRANTED OR REVOKED ON set_project_lead HERE. CREATE OR
-- REPLACE preserved the ACL 097 set, and re-issuing those grants would
-- make this file appear to be the thing that established them. V8
-- asserts the inherited value instead - 082's precedent, the same reason
-- 097 declined to GRANT service_role.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnership_owners_guard_membership() FROM authenticated;


-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY ON THE NEW TABLE. TWO POLICIES.
--    NO UPDATE POLICY. NO DELETE POLICY.
--
-- ENABLE first. A table created without this is readable by every
-- authenticated caller in the project, and 079's audit exists because
-- that has happened here.
--
-- BOTH PREDICATES NAME lead_org_id AND NEITHER NAMES vendor_org_id.
-- That is the security boundary of this migration - see PART B, THE
-- SECURITY QUESTION.
-- ---------------------------------------------------------------------
ALTER TABLE public.partnership_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnership_owners_lead_select"
  ON public.partnership_owners AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())));

-- R4: any team member may add a tag. The added_by clause is what makes
-- the author unfalsifiable - a caller can only record themselves.
CREATE POLICY "partnership_owners_lead_insert"
  ON public.partnership_owners AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    added_by = auth.uid()
    AND partnership_id IN (
      SELECT p.id FROM public.partnerships p
      WHERE p.lead_org_id IN (SELECT public.current_user_org_ids())));

-- NO UPDATE POLICY AND NO DELETE POLICY. Not omissions. R3: this tag
-- layer is add-only for everybody. See PART A, ADD-ONLY - the mechanism
-- is that RLS denies by default, so an authenticated UPDATE or DELETE
-- matches zero rows and reports success having changed nothing. The rows
-- go when the PARTNERSHIP goes, by CASCADE.


COMMIT;


-- =====================================================================
-- 9. VERIFICATION. RUN AFTER APPLYING. READ ONLY, ALL OF IT.
--    EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above, and so a dry run stops at the COMMIT line and executes none of
-- them. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE ROLE COLUMN, ITS TYPE, ITS NOT NULL AND ITS DEFAULT.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'project_leads'
--         AND column_name = 'role';
--       -- EXPECTED: exactly 1 row -
--       --   role  text  NO  'lead'::text
--       --
--       -- is_nullable = YES means the NOT NULL did not take and rows
--       -- with no role can be written. column_default NULL means the
--       -- default did not take - check V2 immediately, because existing
--       -- rows may then be NULL.
--
-- V2. >>> ZERO ROWS HAVE A NULL ROLE. The brief asks for this counted
--     rather than inferred from the default having been declared.
--
--       SELECT count(*) AS null_role_rows
--       FROM public.project_leads WHERE role IS NULL;
--       -- EXPECTED: 0.
--       --
--       -- Any other number means existing leadership rows lost their
--       -- meaning. The NOT NULL should make this structurally
--       -- impossible; it is counted anyway because "should" is not
--       -- evidence.
--
-- V2b. AND EVERY PRE-EXISTING ROW IS A LEAD. This file creates no
--      contributor row, so immediately after applying there must be
--      none. A non-zero count means something other than this migration
--      wrote one.
--
--       SELECT role, count(*) AS rows,
--              count(*) FILTER (WHERE ended_at IS NULL) AS open_rows
--       FROM public.project_leads GROUP BY role ORDER BY role;
--       -- EXPECTED: exactly 1 group, role = 'lead'. Its `rows` must
--       -- equal the total the Phase 0 count query returned, and its
--       -- `open_rows` must equal that query's open_rows. If the table
--       -- was empty, EXPECTED is 0 rows returned.
--
-- V3. THE CHECK CONSTRAINT EXISTS AND NAMES BOTH VALUES.
--
--       SELECT conname, pg_get_constraintdef(oid) AS definition
--       FROM pg_constraint
--       WHERE conrelid = 'public.project_leads'::regclass AND contype = 'c'
--       ORDER BY conname;
--       -- EXPECTED: exactly 2 rows -
--       --   project_leads_interval_ordered  CHECK ((ended_at IS NULL OR ended_at >= started_at))
--       --   project_leads_role_valid        CHECK ((role = ANY (ARRAY['lead'::text, 'contributor'::text])))
--
-- V4. >>> THE INDEX AND ITS TWO-PART PREDICATE. The single most
--     important line of this block: an index recreated without the role
--     half applies silently and makes every contributor collide with the
--     lead.
--
--       SELECT indexname, indexdef
--       FROM pg_indexes
--       WHERE schemaname = 'public' AND tablename = 'project_leads'
--       ORDER BY indexname;
--       -- EXPECTED: exactly 4 rows. The one that matters reads:
--       --   project_leads_one_open_per_project
--       --     CREATE UNIQUE INDEX project_leads_one_open_per_project
--       --     ON public.project_leads USING btree (project_id)
--       --     WHERE ((ended_at IS NULL) AND (role = 'lead'::text))
--       --
--       -- WHERE (ended_at IS NULL) alone means the DROP ran and the
--       -- CREATE used the old predicate. Contributors will then raise
--       -- 23505. Roll back.
--       -- The other three are project_leads_pkey,
--       -- project_leads_project_started_idx and project_leads_user_idx,
--       -- all unchanged by this file.
--
-- V5. THE NEW TABLE EXISTS AND RLS IS ENABLED.
--
--       SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
--       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relname = 'partnership_owners';
--       -- EXPECTED: exactly 1 row, relrowsecurity = t.
--       --
--       -- relrowsecurity = f means EVERY AUTHENTICATED USER IN THE
--       -- PROJECT CAN READ AND WRITE THIS TABLE. Roll back immediately.
--       -- relforcerowsecurity = f is expected and correct.
--
-- V6. EVERY FOREIGN KEY DELETE RULE, ON BOTH TABLES.
--
--       SELECT c.conrelid::regclass AS child, c.conname,
--              a.attname AS column_name,
--              c.confrelid::regclass AS parent,
--              CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
--                                 WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
--                                 WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
--       FROM pg_constraint c
--       JOIN unnest(c.conkey) AS k(attnum) ON true
--       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
--       WHERE c.contype = 'f'
--         AND c.conrelid IN ('public.project_leads'::regclass,
--                            'public.partnership_owners'::regclass)
--       ORDER BY child, column_name;
--       -- EXPECTED: exactly 5 rows -
--       --   partnership_owners  added_by        -> profiles      SET NULL
--       --   partnership_owners  partnership_id  -> partnerships  CASCADE
--       --   partnership_owners  user_id         -> profiles      CASCADE
--       --   project_leads       project_id      -> projects      CASCADE
--       --   project_leads       user_id         -> profiles      SET NULL
--       --
--       -- The two project_leads rows are 097's and must be UNCHANGED -
--       -- this file does not touch them. partnership_owners.user_id
--       -- reading SET NULL would mean an unremovable orphan tag is
--       -- possible; see PART B, THE FOREIGN KEYS.
--
-- V7. BOTH GUARD FUNCTIONS' GRANTS. anon MUST HOLD NO EXECUTE.
--
--       SELECT p.proname, p.prosecdef AS security_definer,
--              has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_execute,
--              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('project_leads_guard_membership',
--                           'partnership_owners_guard_membership')
--       ORDER BY p.proname;
--       -- EXPECTED: exactly 2 rows, both security_definer = t,
--       --   both anon_execute = f AND both auth_execute = f.
--       --
--       -- anon_execute = t on either means the REVOKE ... FROM anon did
--       -- not run or was undone, and an anonymous caller can invoke a
--       -- SECURITY DEFINER body directly. Roll back.
--
-- V8. >>> set_project_lead's GRANTS ARE UNCHANGED BY THE REPLACE.
--     CREATE OR REPLACE should preserve them. This proves it rather than
--     trusting it, which is the whole reason OR REPLACE was used instead
--     of DROP-then-CREATE.
--
--       SELECT p.proname, p.prosecdef AS security_definer,
--              has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_execute,
--              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
--              has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_execute
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'set_project_lead';
--       -- EXPECTED: exactly 1 row -
--       --   security_definer = t
--       --   anon_execute     = f   <<< THE ONE THAT MATTERS
--       --   auth_execute     = t
--       --   svc_execute      = t   (inherited default, as 097's V5 found it)
--       --
--       -- anon_execute = t MEANS THE REPLACE BEHAVED LIKE A DROP AND
--       -- pg_default_acl RE-GRANTED anon. That is the 088 failure. An
--       -- anonymous caller could then invoke the writer. ROLL BACK.
--
-- V9. THE FUNCTION ACTUALLY CARRIES THE FIX. A replace that silently did
--     nothing leaves V8 green and the defect live.
--
--       SELECT pg_get_functiondef(p.oid) LIKE '%l.role = ''lead''%' AS has_fix
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'set_project_lead';
--       -- EXPECTED: exactly 1 row, has_fix = t.
--       -- f means the old body is still installed. See PART A, THE
--       -- DEFECT for what that costs.
--
-- V10. THE NARROWED UPDATE POLICY, AND THE TWO NEW POLICIES.
--
--       SELECT tablename, policyname, cmd, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public'
--         AND tablename IN ('project_leads', 'partnership_owners')
--       ORDER BY tablename, policyname;
--       -- EXPECTED: exactly 5 rows -
--       --   partnership_owners  partnership_owners_lead_insert  INSERT
--       --   partnership_owners  partnership_owners_lead_select  SELECT
--       --   project_leads       project_leads_org_insert        INSERT
--       --   project_leads       project_leads_org_select        SELECT
--       --   project_leads       project_leads_org_update        UPDATE
--       --
--       -- NO UPDATE OR DELETE ROW FOR partnership_owners, and NO DELETE
--       -- ROW FOR project_leads. A sixth row is a policy this file did
--       -- not write.
--       --
--       -- CHECK THE TEXT, not just the count:
--       --   project_leads_org_update  -> BOTH qual AND with_check must
--       --      contain (role = 'lead'::text). If either lacks it the
--       --      narrowing half-applied and contributor rows are editable.
--       --   partnership_owners_*      -> BOTH must reference
--       --      lead_org_id and NEITHER may reference vendor_org_id.
--       --      >>> vendor_org_id APPEARING IN EITHER IS THE SECURITY
--       --      >>> DEFECT THIS MIGRATION EXISTS TO AVOID. ROLL BACK.
--
-- V11. THE TOTAL POLICY COUNT.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 122.
--       --
--       -- 120 means section 8 did not run. 121 means only one of the two
--       -- new policies was created. 123 means a third came from
--       -- somewhere - find it before doing anything else:
--       --   SELECT tablename, policyname FROM pg_policies
--       --   WHERE schemaname='public' ORDER BY tablename, policyname;
--
-- V12. THE UNIQUE CONSTRAINT ON THE NEW TABLE.
--
--       SELECT conname, pg_get_constraintdef(oid) AS definition
--       FROM pg_constraint
--       WHERE conrelid = 'public.partnership_owners'::regclass AND contype = 'u';
--       -- EXPECTED: exactly 1 row -
--       --   partnership_owners_one_per_person  UNIQUE (partnership_id, user_id)
--       -- Missing means the same colleague can be tagged twice on one
--       -- partnership, and with no DELETE policy the duplicate is
--       -- permanent.
-- =====================================================================
