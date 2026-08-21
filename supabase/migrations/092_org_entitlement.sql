-- =====================================================================
-- Migration 092: entitlement becomes an ORGANIZATION fact.
--                091 stopped a browser granting itself the paid flag on
--                its own profile. This moves the flag one level up, to
--                the company, and closes the identical hole there in the
--                same transaction that opens it.
--
--   NEW   public.organizations.is_paid  boolean NOT NULL DEFAULT false
--   NEW   public.organizations_guard_entitlement()  -> trigger
--   NEW   trigger organizations_entitlement_guard   BEFORE UPDATE ON organizations
--
--   POLICIES ADDED: NONE. DROPPED: NONE. Count stays at 117.
--   092 ADDS A TRIGGER, NOT A POLICY. If the count moves, something
--   other than this file moved it.
--
--   COLUMNS DROPPED: NONE. profiles.is_paid IS DELIBERATELY LEFT IN
--   PLACE. See DO NOT DROP profiles.is_paid below - it is not an
--   oversight, it is the only ordering that does not break the deployed
--   site, and it owes a follow-up migration that is named there.
--
--   "Org admins update their organization" IS NOT TOUCHED, AND MUST NOT
--   BE. See THE ROLE GATE BUYS NOTHING below.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed
-- no statement against any database and holds no credential that could.
-- It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- RUN docs/092-preapply-test.sql FIRST. It is one paste. It BEGINs, runs
-- this entire migration, impersonates a real member of a real
-- organization through request.jwt.claims, exercises a legitimate rename,
-- a self-grant, a no-op, a no-session write and 091's guard, and then
-- ROLLBACKs. Nothing persists.
--
-- WHY A DRY RUN IS NOT ENOUGH, STATED HONESTLY RATHER THAN INHERITED
-- FROM 091'S HEADER. 091 could refuse writes that worked that morning:
-- it guarded five columns with thirty live writers between them. THIS
-- FILE GUARDS ONE COLUMN THAT DOES NOT EXIST UNTIL LINE 1 OF ITS OWN
-- TRANSACTION, so no write that works today can move it and the early
-- return covers every existing writer by construction. The risk here is
-- SMALLER than 091's and it is not zero, in three specific places:
--
--   1. THE BACKFILL. It is the whole point of the migration and it is
--      the one statement whose failure mode is silence. A backfill that
--      matches zero rows commits happily and every organization stays
--      false, which locks every paying customer out on the next deploy.
--      Section 2 below is written so that cannot happen quietly.
--   2. THE EARLY RETURN. If it were spelled <> rather than IS NOT
--      DISTINCT FROM, a read-modify-write sending a NULL back would fall
--      through to the refusal. The column is NOT NULL so that is
--      currently unreachable, and it is tested anyway, because "currently
--      unreachable" is how the 082 fallbacks were described too.
--   3. THE ONE LIVE WRITER. lib/company-identity.ts:306 renames the
--      organization with a SESSION client. Every company rename in the
--      product goes through it. It must still work. T1 proves it.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 428
-- and an explicit COMMIT; on LINE 783. Those are the only EXECUTABLE
-- occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 783 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/092_org_entitlement.sql
--
-- THAT GREP RETURNS FOUR HITS, AND FOUR IS CORRECT:
--     428  BEGIN;    <- executable. The transaction.
--     513  BEGIN     <- plpgsql, the backfill assertion block's body.
--                       No semicolon; matched by the case-insensitive
--                       form only, not a transaction statement.
--     654  BEGIN     <- plpgsql, organizations_guard_entitlement's body.
--                       Same. No semicolon.
--     783  COMMIT;   <- executable. The one to swap for ROLLBACK;.
-- Exactly one line ends in `BEGIN;` and exactly one in `COMMIT;`.
-- If your grep shows a different set, this is not the file that was read.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that.
--
-- THE VERIFICATION BLOCK IS AFTER THE COMMIT, DELIBERATELY, and it is
-- entirely commented out. A dry run therefore stops at the COMMIT line
-- and executes none of it. Paste those queries in afterwards, one at a
-- time.
--
-- "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON ITS
-- OWN. It is the identical message for a dry run that rolled everything
-- back, for a real apply that committed, and for a correct file pasted
-- into the wrong project's tab. The VERIFICATION block at the foot is
-- the only thing that distinguishes them. Run it.
--
-- Sequence, no step skipped:
--   1. Run docs/092-preapply-test.sql. Read the headline line.
--   2. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put it back.
--   3. Run for real.
--   4. Run VERIFICATION. Every query states its expected value.
--   5. Update the migrations table in LIGAMENT_CONTEXT.md.
--   6. THEN push the code. Not before - see ORDERING below.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. THIS FILE IS NOT INDEPENDENT OF THE DEPLOY.
-- 091 WAS. THIS ONE IS NOT, AND THE DIFFERENCE MATTERS.
-- =====================================================================
--
-- 091 added no column, so nothing could 42703 and it could be applied
-- before the code, after it, or with no code change at all.
--
-- 092 ADDS A COLUMN THAT THE CODE ON THIS BRANCH READS.
--
--   APPLY THIS MIGRATION FIRST, THEN PUSH.
--
-- IF THE CODE IS PUSHED BEFORE THIS IS APPLIED: every read of
-- organizations.is_paid raises PostgREST 42703 (undefined_column) - and
-- PostgREST fails the WHOLE statement on one unknown column, it does not
-- ignore it. hasAgencyEntitlement() cannot resolve, so project creation,
-- project duplication, the four AI routes and the upload route all
-- refuse, and the agency layout gate falls to its unpaid branch for
-- everybody. The window is however long the next apply takes.
--
-- IF THIS IS APPLIED BEFORE THE CODE IS PUSHED: nothing happens. The
-- column exists, no deployed statement names it, the guard fires on
-- renames and early-returns. That is the safe order and it is the only
-- one this file endorses.
--
-- =====================================================================
-- WHY THIS EXISTS, IN ONE PARAGRAPH
-- =====================================================================
--
-- Billing is ruled PER ORGANIZATION and always has been (the ruling is
-- recorded at lib/entitlements.ts:24). Entitlement was never stored that
-- way: it is a boolean on profiles, so a colleague of a paying owner is
-- refused at app/api/projects/route.ts:552 with "Active subscription
-- required" while their own company is paid up. 079 moved the QUOTA
-- counters onto the organization and could not move the entitlement,
-- because organizations carried no column to move it to. This creates
-- that column.
--
-- =====================================================================
-- SECTION 2 IS A CLOSING WINDOW. THIS IS THE PARAGRAPH TO READ IF YOU
-- READ ONE.
-- =====================================================================
--
-- EVERY ONE OF THE EIGHTEEN ORGANIZATIONS HAS EXACTLY ONE MEMBER TODAY.
-- That is what makes the backfill have a defined answer at all: one
-- member per organization is exactly one unambiguous source row per
-- target row, so "the company is paid if its member was" is total,
-- deterministic and reviewable.
--
-- THE MOMENT ANY ORGANIZATION HAS TWO MEMBERS, "WHICH MEMBER'S FLAG
-- BECOMES THE COMPANY'S" HAS NO CORRECT ANSWER. Not a hard one. None. If
-- A is paid and B is not, bool_or and bool_and are both defensible and
-- both are guesses, and the guess is permanent because the source column
-- is on its way to being retired. The drift would also be SILENT,
-- because nothing anywhere compares the two flags.
--
-- accept_org_invitation() is the only thing in this product's history
-- that can give an organization a second member, and it is behind
-- COLLEAGUE_INVITATIONS, which is off everywhere. So the window is open
-- ONLY because that flag is off. Section 2 does not merely rely on that:
-- it CHECKS it, and refuses to run if it is no longer true.
--
-- =====================================================================
-- THE ROLE GATE BUYS NOTHING. DO NOT REACH FOR A POLICY.
-- =====================================================================
--
-- organizations' UPDATE policy is "Org admins update their organization"
-- (079:1797), qual and with_check both
-- id IN (SELECT public.current_user_admin_org_ids()), and that helper
-- resolves role IN ('owner','admin'). It reads like a privilege check.
--
-- IT BUYS NOTHING AGAINST SELF-GRANTING, BECAUSE EVERY USER IS THE OWNER
-- OF THEIR OWN ORGANIZATION BY CONSTRUCTION. 079 PHASE 2 backfilled one
-- per profile with role 'owner'; PHASE 12's handle_new_user trigger
-- creates one per signup with role 'owner'. So every authenticated user
-- is an owner of some organization and the policy authorises them to
-- UPDATE it. Put a billing column on that table with no guard and it is
-- self-grantable by exactly the argument 091 made about profiles.is_paid,
-- one level up. WITHOUT SECTION 3, THIS MIGRATION REPRODUCES THE HOLE 091
-- JUST CLOSED.
--
-- AND A WITH CHECK CANNOT FIX IT. organizations DOES have a with_check,
-- unlike profiles, and it makes no difference: A WITH CHECK HAS NO OLD.
-- "is_paid did not change" is a statement about two rows and a WITH CHECK
-- can only make statements about one. Same structural argument as 087,
-- 090 and 091. A column-level REVOKE is not the answer either - it is a
-- no-op while `authenticated` holds table-level UPDATE (090:286).
--
-- SO THE GUARD IS A TRIGGER, and it is the FIRST trigger this table has
-- ever carried. Verified by grep over every migration: the only three
-- CREATE TRIGGER statements in the repository are 087's on partnerships
-- and 090's and 091's on profiles. There is no updated_at auto-stamp
-- trigger here to order against, and no name-ordering question arises,
-- because there is nothing to order against.
--
-- =====================================================================
-- THE COLUMN MUST BE BORN WITH ITS GUARD, AND THE ORDER INSIDE THE
-- TRANSACTION IS LOAD-BEARING. ALL THREE POSITIONS ARE DELIBERATE.
-- =====================================================================
--
--   1. ADD COLUMN     (section 1)
--   2. BACKFILL       (section 2)  <- BEFORE the trigger exists
--   3. GUARD          (section 3)  <- AFTER the backfill
--
-- ADD BEFORE BACKFILL: obvious, the column has to exist.
--
-- GUARD AFTER BACKFILL, AND THIS IS THE ONE WORTH STATING: the guard
-- never evaluates this migration's own write. It would be exempt anyway -
-- a migration has no request.jwt.claims, so auth.uid() is NULL and
-- section 3's exemption covers it - but that is an argument, and the
-- ordering is a fact. The backfill's correctness does not depend on
-- anybody having reasoned correctly about the trigger.
--
-- ALL THREE IN ONE TRANSACTION: between an ALTER TABLE ADD COLUMN and a
-- later CREATE TRIGGER there is a window in which any authenticated user
-- can PATCH /rest/v1/organizations?id=eq.<their own org> with
-- {"is_paid": true}. The window is however long it takes somebody to
-- notice, and migrations here are applied by hand. One transaction means
-- there is no window at all.
--
-- =====================================================================
-- THE GUARDED SET: ONE COLUMN, is_paid. AND THE SHAPE THE DESIGN DOC
-- ARGUED FOR INSTEAD, RECORDED SO THE CHOICE IS VISIBLE.
-- =====================================================================
--
-- docs/092-entitlements-design.md section 1 argued for the INVERSE
-- shape: a PERMIT LIST of {name}, refusing any other column moving under
-- a session. Its argument is good and it is not adopted here, so both
-- halves are written down.
--
-- WHAT IS BUILT: a deny-list of ONE column, is_paid. It matches the
-- instruction for this migration and 091's mechanism exactly.
--
-- WHAT IT COSTS: a FUTURE privilege column on organizations ships
-- unguarded unless somebody adds it to this set. That is 091's failure
-- mode, and 091's ROT instruction is the countermeasure. It is repeated
-- below.
--
-- WHAT THE PERMIT LIST WOULD HAVE BOUGHT: every future column guarded by
-- default, with a loud development-time failure (a save raises LG008 and
-- somebody adds one word to a list) instead of a silent production one.
-- organizations has seven columns and a session client writes exactly
-- ONE of them - `name`, at lib/company-identity.ts:306, which writes
-- { name } and nothing else, not even updated_at - so the permit list
-- would be one entry long and would break nothing today.
--
-- IT IS A ONE-LINE DIFFERENCE IF GREG WANTS IT: replace the early return
-- and the single refusal below with "NEW.name IS DISTINCT FROM OLD.name
-- is the only permitted movement". RECORDED AS AN OPEN ITEM in
-- docs/092-session-report.md rather than decided here.
--
-- WHAT IS DELIBERATELY NOT GUARDED, so the omissions are choices:
--   name                     the one live session write. Guarding it
--                            would break every company rename.
--   is_lead_agency,          079:220 states these are DESCRIPTIVE, not
--   is_vendor                authorization: "no policy in this file
--                            reads them, precisely so a wrong flag
--                            cannot lock anybody out of their own data."
--                            Nothing grants on them. 092 does not change
--                            that.
--   primary_contact_user_id  a pointer at a person, already writable by
--                            an org admin today. 092 changes nothing
--                            about it, and guarding it would be a
--                            behaviour change dressed up as a migration.
--   created_at, updated_at   timestamps. Not authority.
--
-- >>> THE ROT INSTRUCTION. CARRIED FORWARD FROM 091 UNCHANGED. <<<
--
--   THE SET LIVES IN EXACTLY TWO PLACES IN THIS FILE AND NOWHERE ELSE:
--   the IS NOT DISTINCT FROM early return, and the IS DISTINCT FROM
--   refusal below it. Plus the COMMENT ON FUNCTION, which repeats it so
--   a pg_proc query can answer "what is guarded" without opening a .sql
--   file.
--
--   ANY NEW COLUMN ON public.organizations THAT GRANTS ANYTHING - access,
--   a plan, a seat allowance, a limit - MUST JOIN THIS SET IN THE SAME
--   MIGRATION THAT CREATES IT. Not in a follow-up. A privilege column
--   that ships unguarded is self-grantable from a browser the moment it
--   exists, because every user is an admin of their own organization.
--
-- =====================================================================
-- THE EXEMPTION TEST: auth.uid() IS NULL. THE SAME TEST AS 091, FOR A
-- DIFFERENT REASON. THE REASON IS WORTH READING.
-- =====================================================================
--
-- On profiles, "no session client legitimately writes is_paid" was a
-- MEASURED FACT - the writer census found zero - so "no session may write
-- it" simply IS the rule.
--
-- HERE THE RULING SAYS THE OPPOSITE: owner and admin MAY change the plan.
-- So a session client eventually SHOULD write this column. The same test
-- is still right, and here is why, because it is not obvious:
--
--   1. TODAY THERE IS NO BILLING PROVIDER ANYWHERE IN THE REPOSITORY.
--      Grep for stripe/Stripe over app/, lib/, components/ and
--      package.json returns two hits and neither is an integration. So
--      there is no validated flow a session write could come from, and
--      every session write to this column today is a self-grant.
--   2. WHEN A BILLING PROVIDER ARRIVES, IT STILL IS. A plan change from
--      a provider arrives as a WEBHOOK - server-side, service role,
--      auth.uid() NULL, exempt. The browser never writes the plan; it
--      writes to the provider, and the provider tells the database.
--
-- So the test survives the arrival of billing without amendment.
--
-- >>> WHAT MUST NOT HAPPEN IS A LATER "THE OWNER IS ALLOWED, SO LET
-- >>> OWNERS THROUGH" AMENDMENT. "is an owner" is true of every user
-- >>> about their own organization. That amendment would delete this
-- >>> migration's entire effect while appearing to refine it.
--
-- WHAT IT DOES UNDER EACH WRITER, walked one at a time:
--
--   THE ONE SESSION WRITER (lib/company-identity.ts:306, the company
--   rename): auth.uid() is the signed-in user, so the guard is ACTIVE -
--   and it PASSES on the early return, because it writes { name } and
--   is_paid does not move. T1 in the pre-apply test proves that rather
--   than asserting it.
--
--   THE ADMIN GRANT ROUTES on the service role
--   (app/api/admin/users/[userId]/flags and app/api/admin/grant-access):
--   a service_role JWT carries no `sub` claim, so auth.uid() is NULL and
--   the guard EXEMPTS them. THIS IS THE FINDING THAT MAKES THE PHASE 3
--   CODE CHANGE POSSIBLE - moving the admin write from profiles.is_paid
--   to organizations.is_paid lands on the exempt side of this test, the
--   same way it lands on the exempt side of 091's. Same client, same
--   mechanism, same outcome, verified against 091's writer-outcome table
--   rather than assumed.
--
--   A MIGRATION OR THE SQL EDITOR: no request.jwt.claims, auth.uid() is
--   NULL, EXEMPT. Which is what makes section 2 of this very file able to
--   write the column, and every later migration able to touch it.
--
--   A SECURITY DEFINER FUNCTION CALLED BY A SESSION CLIENT keeps that
--   session's auth.uid(), so it stays GUARDED. THAT IS THE BEHAVIOUR TO
--   WANT: a future RPC cannot become a laundering path for the billing
--   column unless somebody deliberately writes an exemption into it. It
--   costs nothing today - accept_org_invitation() does not write
--   organizations at all, and must not start. If a seat model ever
--   arrives, DERIVE the count from org_members rather than storing one
--   here; a stored counter would make accept a writer of this table and
--   the guard would refuse it on the day it shipped.
--
-- =====================================================================
-- THE ERROR. ERRCODE 'LG008', AND WHAT THE API LAYER SHOULD DO WITH IT.
-- =====================================================================
--
-- LG008 IS THE NEXT FREE CODE. 089 used LG001-LG004, 090 added LG005 and
-- LG006, 091 used LG007. Confirmed by grep over supabase/, lib/ and app/:
-- LG008 appears in docs/ only, where the design doc reserved it for
-- exactly this, and nowhere in any executable file.
--
-- >>> THE API LAYER SHOULD MAP LG008 TO 403. <<<
--
-- Not 400 - the request was well-formed and the caller is not permitted
-- to make it. Not 500 - it is a refusal, not a fault. The existing map is
-- lib/org-invitations.ts:77 (LG001->404, LG002->401, LG003->409,
-- LG004->410) and that is where an LG008 entry belongs, alongside the
-- LG007 entry 091 also left owed.
--
-- NO API ROUTE IS CHANGED BY THIS MIGRATION, DELIBERATELY. Nothing in the
-- product raises LG008 on any path a user can reach without trying to -
-- the only session writer of this table writes `name` and leaves on the
-- early return - so there is no broken surface to repair. Wiring the
-- mapping is its own change.
--
-- THE MESSAGE NAMES THE COLUMN, IN DETAIL, AND NEVER A VALUE. The caller
-- supplied the column name in their own request, and PostgREST publishes
-- the full column list through its OpenAPI document at /rest/v1/ anyway,
-- so there is nothing to enumerate that a single GET does not already
-- give up. THE VALUES ARE NEVER INTERPOLATED - not OLD, not NEW. "You
-- cannot change is_paid from false to true" would confirm the current
-- state of a column to a caller who may not be able to read it, and turn
-- a refusal into an oracle. The DETAIL below is a FIXED LITERAL.
--
-- =====================================================================
-- DO NOT DROP profiles.is_paid. THIS IS NOT AN OVERSIGHT.
-- =====================================================================
--
-- A MIGRATION GOES LIVE THE MOMENT GREG RUNS IT IN THE SQL EDITOR. That
-- is independent of git and independent of Vercel. There is no ordering
-- relationship between "the migration is applied" and "the code that
-- matches it is deployed" other than the one a human maintains by hand.
--
-- POSTGREST RAISES 42703 FOR AN ENTIRE STATEMENT ON ONE UNKNOWN COLUMN.
-- It does not ignore the column; it fails the whole select. FIFTEEN
-- SELECT LISTS ACROSS FIFTEEN FILES NAME profiles.is_paid today. So
-- between a DROP COLUMN and the push that removes it from those fifteen:
--
--   app/auth/callback/route.ts:17     the post-authentication routing
--                                     decision - confirming an email
--                                     breaks
--   app/api/projects/route.ts:541     project creation
--   all four AI routes                every AI feature
--   contexts/paid-user-context.tsx:107  sets isPaid, which drives
--                                     AgencySubscriptionGate over
--                                     components/agency-layout.tsx:817 -
--                                     so EVERY AGENCY USER SEES THE
--                                     RESTRICTION PAGE INSTEAD OF THE
--                                     PRODUCT
--
-- Leaving the column costs nothing. 091's guard means it can no longer
-- be self-granted, only read, and after the Phase 3 deploy nothing reads
-- it as an entitlement at all. It is a mirror by SEQUENCING, not by
-- dual-write: nothing has to keep the two columns in sync, because only
-- one of them is ever consulted.
--
-- >>> THE FOLLOW-UP THIS MIGRATION OWES, NAMED SO IT IS NOT FORGOTTEN:
-- >>>
-- >>>   093 (or later): DROP COLUMN public.profiles.is_paid, and take
-- >>>   its entry out of 091's authority set in the same migration -
-- >>>   both the IS NOT DISTINCT FROM chain and the IS DISTINCT FROM
-- >>>   refusal, plus the COMMENT ON FUNCTION.
-- >>>
-- >>> PRECONDITION, AND IT IS CHECKABLE RATHER THAN REMEMBERED:
-- >>>   grep -rn "is_paid" app/ lib/ components/ contexts/ hooks/
-- >>> must return no read of profiles.is_paid, and the Phase 3 deploy
-- >>> must be LIVE, not merely merged. Dropping it before that push
-- >>> lands is the 42703 window above.
--
-- ---------------------------------------------------------------------


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE COLUMN.
--
-- NOT NULL DEFAULT false. Both halves are deliberate.
--
-- NOT NULL: a three-state entitlement is a bug generator. 091 recorded
-- that hasAgencyEntitlement() had to settle on `is_paid === true` rather
-- than `is_paid !== false` precisely because the two spellings had
-- already drifted apart across routes when a null was possible. One
-- state fewer is one drift fewer.
--
-- DEFAULT false: it fails CLOSED. A new organization is not entitled
-- until somebody says so, which is the same answer profiles.is_paid gives
-- today and the same answer the product has always given. The alternative
-- - default true - would make every organization created by any future
-- code path silently free.
--
-- THE DEFAULT IS WHAT THE BACKFILL THEN CORRECTS. Section 2 exists
-- because false is right for a new organization and wrong for the sixteen
-- that are already paying.
--
-- ADD COLUMN ... DEFAULT is metadata-only in PostgreSQL 11 and later - it
-- does not rewrite the table - so this is not a lock hazard on eighteen
-- rows or on eighteen million.
-- ---------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.is_paid IS
  'THE COMPANY PLAN. Entitlement is an ORGANIZATION fact, not a per-person one: '
  'any number of colleagues, one price, usage metered by the existing '
  'organization-keyed AI-analyses and Projects quotas. Read by '
  'hasAgencyEntitlement() for the ACTING organization. Written ONLY by the '
  'service role - the admin grant routes today, a billing provider webhook '
  'later. A browser cannot write it: organizations_entitlement_guard refuses '
  'with LG008, because every user is an owner of their own organization and the '
  '"Org admins update their organization" policy therefore grants nothing here. '
  'BOOLEAN, NOT A DATE, DELIBERATELY - there is no source of truth for an expiry '
  'in this product, is_paid has always been a manual toggle, and a fabricated '
  'date nobody remembers to extend locks out a paying customer silently. When a '
  'billing provider exists it supplies real dates. NO SEAT COLUMN ACCOMPANIES '
  'THIS, also deliberately: a seat check that cannot fail is dead code that '
  'looks live. Supersedes profiles.is_paid, which migration 092 leaves in place '
  'and a later migration drops - see 092_org_entitlement.sql.';


-- ---------------------------------------------------------------------
-- 2. THE BACKFILL. BEFORE THE GUARD EXISTS.
--
-- >>> THIS IS A CLOSING WINDOW. <<<
--
-- Every one of the eighteen organizations has exactly one member today,
-- and that is the ONLY reason "which member's flag becomes the company's"
-- has an answer. The moment any organization has two members it has no
-- correct answer - bool_or and bool_and are both defensible and both are
-- guesses, and the guess is permanent because the source column is on its
-- way out. The drift would be silent, because nothing compares the two
-- flags.
--
-- SO THIS BLOCK CHECKS THE PRECONDITION RATHER THAN TRUSTING IT, and
-- refuses to run if it no longer holds.
--
-- IT ALSO CANNOT SILENTLY DO NOTHING. That is the failure mode a backfill
-- has: it matches zero rows, PostgreSQL says nothing, the transaction
-- commits, every organization stays false, and the next deploy locks out
-- every paying customer with no error anywhere. Three assertions below
-- make that outcome impossible - and each RAISEs, which aborts the whole
-- migration, rather than logging a notice the SQL Editor does not render.
--
-- WHY A DO BLOCK RATHER THAN A BARE UPDATE. A bare UPDATE cannot report
-- its own row count, and RAISE NOTICE is invisible in the Supabase SQL
-- Editor (established in docs/091-preapply-test.sql, attempt 1). An
-- exception is the one channel that client displays.
-- ---------------------------------------------------------------------
DO $backfill$
DECLARE
  v_orgs           integer;
  v_multi_member   integer;
  v_no_member      integer;
  v_updated        integer;
  v_paid_after     integer;
  v_unpaid_after   integer;
BEGIN
  SELECT count(*) INTO v_orgs FROM public.organizations;

  -- PRECONDITION 1. THE WINDOW IS STILL OPEN.
  -- Any organization with more than one member means the source is
  -- ambiguous and this migration must not guess. It is the design doc's
  -- section 0 query, enforced instead of recommended.
  SELECT count(*) INTO v_multi_member FROM (
    SELECT m.org_id FROM public.org_members m
    GROUP BY m.org_id HAVING count(*) > 1
  ) AS multi;

  IF v_multi_member > 0 THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: % organization(s) have more than one member.', v_multi_member
      USING DETAIL =
        'Migration 092 backfills organizations.is_paid from the ONE member of each '
        'organization. With two members and disagreeing flags there is no correct '
        'answer - bool_or and bool_and are both guesses, and the guess is permanent '
        'because profiles.is_paid is on its way to being dropped. This is a RULING '
        'Greg owes, not a bug in this file. Run the query in section 0 of '
        'docs/092-entitlements-design.md, decide, and amend the UPDATE below to '
        'match the decision before re-running.';
  END IF;

  -- PRECONDITION 2. EVERY ORGANIZATION HAS A MEMBER TO READ FROM.
  -- An organization with zero members has no source row at all, so it
  -- would keep the DEFAULT false silently. That may be correct - it may
  -- also be an orphan from a deleted account - but it must not pass
  -- unnoticed.
  SELECT count(*) INTO v_no_member
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = o.id);

  IF v_no_member > 0 THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: % organization(s) have no members.', v_no_member
      USING DETAIL =
        'Those organizations have no profile to read an entitlement from, so they '
        'would silently keep the DEFAULT false. Establish whether they are orphans '
        'or legitimately empty before applying 092. The query: SELECT o.id, o.name '
        'FROM public.organizations o WHERE NOT EXISTS (SELECT 1 FROM '
        'public.org_members m WHERE m.org_id = o.id);';
  END IF;

  -- THE BACKFILL ITSELF.
  --
  -- ONE MEMBER PER ORGANIZATION IS ALREADY PROVEN ABOVE, so bool_or over
  -- a one-row group is that row's value and nothing else. It is spelled
  -- as an aggregate rather than a scalar subquery ONLY so that the shape
  -- survives if somebody ever re-runs this after the window has closed
  -- and deliberately amends precondition 1 - at which point the choice
  -- between bool_or and bool_and becomes VISIBLE on this line instead of
  -- hidden in a LIMIT 1. It is not a decision this file makes; with one
  -- member the two are identical.
  --
  -- COALESCE(..., false) because profiles.is_paid is nullable. A null
  -- entitlement is not an entitlement - the same reading
  -- hasAgencyEntitlement() already takes with `is_paid === true`.
  --
  -- No WHERE clause narrowing to "only the paid ones": every organization
  -- is written, so the statement's row count is the whole table and a
  -- zero means the join matched nothing rather than "nobody was paid".
  UPDATE public.organizations o
     SET is_paid    = src.paid,
         updated_at = now()
    FROM (
      SELECT m.org_id, COALESCE(bool_or(p.is_paid), false) AS paid
      FROM public.org_members m
      JOIN public.profiles p ON p.id = m.user_id
      GROUP BY m.org_id
    ) AS src
   WHERE o.id = src.org_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- PRECONDITION 3, CHECKED AFTER THE FACT: THE BACKFILL DID SOMETHING,
  -- AND IT DID IT TO EVERY ROW.
  --
  -- This is the assertion that makes a silent no-op impossible. A zero
  -- here, or any number short of the organization count, aborts the
  -- migration instead of committing a table full of false.
  IF v_updated <> v_orgs THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: updated % row(s) but there are % organization(s).',
      v_updated, v_orgs
      USING DETAIL =
        'Every organization must receive a value from its member. A short count '
        'means the org_members -> profiles join dropped rows - most likely an '
        'org_members row pointing at a profile that no longer exists. Nothing has '
        'been committed. Investigate before re-running.';
  END IF;

  SELECT count(*) FILTER (WHERE is_paid),
         count(*) FILTER (WHERE NOT is_paid)
    INTO v_paid_after, v_unpaid_after
  FROM public.organizations;

  -- THE EXPECTED DISTRIBUTION, AT TIME OF WRITING: 16 true, 2 false,
  -- matching the known profiles.is_paid distribution across eighteen
  -- one-member organizations.
  --
  -- IT IS NOT ASSERTED, AND THAT IS DELIBERATE. A signup between the
  -- writing of this file and its application legitimately changes both
  -- numbers, and a migration that refuses to run because somebody signed
  -- up is worse than one that reports. THE VERIFICATION BLOCK AT THE FOOT
  -- CARRIES THE EXPECTATION and V3 states it. What IS asserted here is
  -- the structural fact - every row was written - because that is the one
  -- that cannot legitimately change.
  --
  -- The numbers are still raised into the migration's own transcript, so
  -- a dry run shows them without anybody running a second query. This is
  -- the ONE non-fatal RAISE in the file; it is a WARNING, which the SQL
  -- Editor does surface where a NOTICE is not.
  RAISE WARNING '092 BACKFILL: % organization(s) written. is_paid true=%, false=%. EXPECTED AT AUTHORING TIME: 18 written, 16 true, 2 false.',
    v_updated, v_paid_after, v_unpaid_after;
END
$backfill$;


-- ---------------------------------------------------------------------
-- 3. THE GUARD. public.organizations_guard_entitlement() -> trigger
--
-- CREATED AFTER THE BACKFILL, so it never evaluates this migration's own
-- write. See the ORDER IS LOAD-BEARING section in the header.
--
-- SECURITY DEFINER matches 090's and 091's siblings. NOTE THAT IT IS NOT
-- LOAD-BEARING HERE: this body reads no table and calls no policy-scoped
-- query, so DEFINER and INVOKER would behave identically. It is stated
-- because it is exactly WHY current_user cannot be the exemption test -
-- under DEFINER, current_user is the owner and nothing else.
--
-- SET search_path = public, pg_temp, as every function in 089, 090 and
-- 091.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.organizations_guard_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- THE EARLY RETURN THAT MAKES THIS FREE, AND IT IS FIRST ON PURPOSE.
  -- The ONE session-client writer of this table is the company rename at
  -- lib/company-identity.ts:306, which writes { name } and nothing else.
  -- It leaves here having done one comparison and NOT having called
  -- auth.uid(). Every rename in the product goes through that line, so
  -- this is the common path and it should not pay for the caller test.
  --
  -- IS NOT DISTINCT FROM, never <>: a read-modify-write that sends the
  -- same value back must pass, and null <> null is null, which is not
  -- true, which would fall through to the refusal. The column is NOT NULL
  -- so a null cannot arise from the table - but a PATCH body is free to
  -- send one, and the spelling costs nothing.
  --
  -- THE GUARDED SET, PLACE 1 OF 2. See the ROT instruction in the header
  -- before adding to it.
  IF NEW.is_paid IS NOT DISTINCT FROM OLD.is_paid THEN
    RETURN NEW;
  END IF;

  -- THE EXEMPTION. A write with no end-user session behind it is trusted
  -- code that has already made its own authorization decision: the admin
  -- grant routes on the service role, a future billing webhook, this
  -- migration, and every migration after it. See the header for why this
  -- test and not current_user, session_user or auth.role() - the same
  -- four candidates 091 walked, with the same outcome.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller moved the billing column. RAISE,
  -- never silently revert to OLD. A silently reverted plan change is a
  -- customer who believes they upgraded and a company that goes on being
  -- refused - the same class of quiet wrongness 090 and 091 both refused
  -- for their own columns, delivered to a paying reader.
  --
  -- THE GUARDED SET, PLACE 2 OF 2. The DETAIL is a FIXED LITERAL. No
  -- value is ever interpolated into it - see the oracle assessment in the
  -- header.
  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG008',
            DETAIL  = 'organizations.is_paid is the company plan, guarded by migration 092. Only the service role, a database function, or a migration may write it. Being an owner or admin of an organization does not permit it: every user is an owner of their own organization, so that role would grant this to everybody.';
  END IF;

  -- UNREACHABLE BY CONSTRUCTION: the early return covers the case where
  -- is_paid did not move, and the block above covers the case where it
  -- did. It is here so that adding a column to the early return and
  -- forgetting to add its refusal below fails LOUDLY rather than silently
  -- permitting the write.
  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG008',
          DETAIL  = 'A guarded column on organizations moved but migration 092 has no refusal for it. The guarded set in organizations_guard_entitlement() is out of step with itself - see the ROT instruction in 092_org_entitlement.sql.';
END;
$$;

COMMENT ON FUNCTION public.organizations_guard_entitlement() IS
  'BEFORE UPDATE guard on the organizations GUARDED SET: is_paid, and only '
  'is_paid. Refuses with LG008 when a caller that HAS an end-user session '
  '(auth.uid() IS NOT NULL) moves it. Exempts service_role, postgres and '
  'migrations, all of which resolve auth.uid() to NULL - without that exemption '
  'the admin grant routes and every future migration would break, and a billing '
  'provider webhook could never write a plan. Returns immediately when is_paid '
  'did not move, which is every company rename. IT EXISTS BECAUSE THE ROLE GATE '
  'BUYS NOTHING: "Org admins update their organization" is keyed on '
  'current_user_admin_org_ids(), and every user is an owner of their own '
  'organization by construction (079 PHASE 2 and PHASE 12), so that policy '
  'authorises every authenticated user to UPDATE some organization row. RLS has '
  'no column granularity and a WITH CHECK has no OLD, so neither can express '
  'column immutability. DO NOT AMEND THIS TO LET OWNERS THROUGH - that would '
  'delete its entire effect while appearing to refine it. ANY NEW PRIVILEGE '
  'COLUMN ON organizations MUST JOIN THIS SET IN THE MIGRATION THAT CREATES IT. '
  'See supabase/migrations/092_org_entitlement.sql.';


-- ---------------------------------------------------------------------
-- 4. The trigger.
--
-- DROP IF EXISTS then CREATE, so re-running this file is idempotent.
-- That is safe for a TRIGGER in a way it is not for a FUNCTION: a trigger
-- has no ACL to lose. The function above is CREATE OR REPLACE for the
-- opposite reason - see section 5.
--
-- THIS IS THE FIRST AND ONLY TRIGGER ON public.organizations. Verified by
-- grep over every migration in the repository: the only CREATE TRIGGER
-- statements are 087's on partnerships and 090's and 091's on profiles.
-- So there is no firing-order question here, and no updated_at auto-stamp
-- trigger to interact with. If a second trigger is ever added to this
-- table, note that PostgreSQL fires BEFORE triggers in ALPHABETICAL ORDER
-- BY TRIGGER NAME, and that what makes such a pair safe is each one
-- early-returning when its own columns have not moved - not the ordering.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS organizations_entitlement_guard ON public.organizations;

CREATE TRIGGER organizations_entitlement_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_entitlement();


-- ---------------------------------------------------------------------
-- 5. GRANTS.
--
-- EVERY NEW FUNCTION NEEDS AN EXPLICIT REVOKE FROM anon BY NAME. REVOKE
-- ... FROM PUBLIC does NOT remove a direct grant, and a stock Supabase
-- project gives anon EXECUTE on functions in public through
-- pg_default_acl from BOTH postgres AND supabase_admin. This is the
-- mistake 088 made, 089 was written not to repeat, and 090 and 091
-- repeated the fix for.
--
-- CREATE OR REPLACE above preserves an ACL; DROP THEN CREATE would
-- re-grant anon from that default privilege. If this function is ever
-- dropped and recreated, THESE THREE STATEMENTS MUST COME WITH IT.
--
-- IT IS GRANTED TO NOBODY - not even authenticated. It is a TRIGGER
-- function: it is invoked by the trigger, not by a caller, and PostgreSQL
-- does not check EXECUTE on trigger functions. It is still revoked by
-- name because a trigger function is an ordinary function that happens to
-- return trigger, and a direct call would be a way to reach a SECURITY
-- DEFINER body. Exactly 090's and 091's treatment of their guards.
--
-- service_role IS DELIBERATELY NOT GRANTED. It holds EXECUTE by the same
-- default privilege and V6 ASSERTS that inherited value rather than this
-- file writing a GRANT that pretends to have set it - 082's precedent.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM authenticated;

COMMIT;


-- =====================================================================
-- 6. VERIFICATION. RUN AFTER APPLYING. READ ONLY, EXCEPT V7, WHICH IS A
--    WRITE AND IS MARKED. EXPECTED VALUES STATED.
--
-- These are commented out so they cannot run inside the transaction
-- above, and so a dry run stops at the COMMIT line and executes none of
-- them. Paste them into the SQL Editor one at a time, after the COMMIT
-- has landed.
-- =====================================================================
--
-- V1. THE COLUMN EXISTS, WITH THE RIGHT TYPE, NULLABILITY AND DEFAULT.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema = 'public'
--         AND table_name   = 'organizations'
--         AND column_name  = 'is_paid';
--       -- EXPECTED: exactly 1 row.
--       --   data_type      = boolean
--       --   is_nullable    = NO
--       --   column_default = false
--       -- is_nullable = YES means the NOT NULL did not take and a three-
--       -- state entitlement is now possible. data_type text or anything
--       -- else means this is not the column this file created.
--
-- V2. NOTHING ELSE MOVED ON THE TABLE.
--
--       SELECT count(*) AS organizations_columns
--       FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='organizations';
--       -- EXPECTED: 8. It was 7 - id, name, primary_contact_user_id,
--       -- is_lead_agency, is_vendor, created_at, updated_at - and this
--       -- file adds exactly one.
--
-- V3. THE BACKFILL COUNTS. THE ONE THAT SAYS WHETHER THIS WORKED.
--
--       SELECT is_paid, count(*) AS organizations
--       FROM public.organizations GROUP BY is_paid ORDER BY is_paid;
--       -- EXPECTED AT AUTHORING TIME: 2 rows - false = 2, true = 16.
--       -- Eighteen organizations, sixteen paid, matching the known
--       -- profiles.is_paid distribution.
--       --
--       -- >>> ONE ROW READING false = 18 IS THE FAILURE THIS QUERY
--       -- >>> EXISTS TO CATCH. It means the backfill matched nothing and
--       -- >>> every organization kept the DEFAULT. Section 2's third
--       -- >>> assertion should have made that impossible - if you are
--       -- >>> seeing it anyway, the DO block did not run, and the guard
--       -- >>> is now the only thing standing between you and a table
--       -- >>> full of locked-out customers. DO NOT PUSH THE CODE.
--       --
--       -- A LARGER TOTAL than 18 is normal and expected if anybody has
--       -- signed up since this file was written; a new organization is
--       -- correctly false. Compare against V4 rather than against 18.
--
-- V4. THE BACKFILL AGREES WITH ITS SOURCE, ROW BY ROW. THE REAL CHECK.
--
--       SELECT o.id, o.name, o.is_paid AS org_flag,
--              bool_or(p.is_paid)  AS any_member_paid,
--              count(*)            AS members
--       FROM public.organizations o
--       JOIN public.org_members  m ON m.org_id = o.id
--       JOIN public.profiles     p ON p.id = m.user_id
--       GROUP BY o.id, o.name, o.is_paid
--       HAVING o.is_paid IS DISTINCT FROM COALESCE(bool_or(p.is_paid), false)
--       ORDER BY o.name;
--       -- EXPECTED: 0 rows. Every organization's flag equals its
--       -- member's. ANY ROW is a backfill that did not land, and the
--       -- `members` column tells you whether the window closed
--       -- underneath it (members > 1).
--
-- V5. THE TRIGGER EXISTS, IS ENABLED, AND POINTS AT THAT FUNCTION.
--
--       SELECT t.tgname, t.tgenabled, p.proname
--       FROM pg_trigger t
--       JOIN pg_class c ON c.oid = t.tgrelid
--       JOIN pg_proc  p ON p.oid = t.tgfoid
--       WHERE c.relname = 'organizations' AND NOT t.tgisinternal
--       ORDER BY t.tgname;
--       -- EXPECTED: exactly 1 row.
--       --   organizations_entitlement_guard   tgenabled = O
--       --   proname = organizations_guard_entitlement
--       -- A SECOND ROW means somebody added a trigger to this table that
--       -- this file does not know about, and it fires on the same
--       -- writes. Find it before trusting this guard.
--       -- tgenabled = D means the trigger is DISABLED and buying
--       -- nothing.
--
--       SELECT p.proname, p.prosecdef, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'organizations_guard_entitlement';
--       -- EXPECTED: exactly 1 row.
--       --   prosecdef = t
--       --   proconfig = {"search_path=public, pg_temp"}
--
-- V6. THE GRANTS. THE ONE THAT CATCHES THE 088 MISTAKE.
--
--       SELECT has_function_privilege('anon',          'public.organizations_guard_entitlement()', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.organizations_guard_entitlement()', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.organizations_guard_entitlement()', 'EXECUTE') AS service_role;
--       -- EXPECTED: anon = f, authenticated = f, service_role = t.
--       -- anon = f IS THE ASSERTION THIS SECTION EXISTS FOR.
--       -- authenticated = f is correct and deliberate: trigger functions
--       -- are invoked by the trigger, not by a caller.
--       -- service_role = t is INHERITED from pg_default_acl and is NOT
--       -- set by this file. An f there is not a defect of this migration.
--       -- anon = t means this was applied as DROP-then-CREATE somewhere
--       -- and the REVOKEs in section 5 must be re-issued.
--
-- V7. THE GUARD ACTUALLY BITES, AND THE EXEMPTION ACTUALLY EXEMPTS.
--     A WRITE. RUN IT, THEN LET IT ROLL BACK.
--
--     This is the after-the-fact version of the pre-apply test. The full
--     one, with impersonation and a refusal case, is
--     docs/092-preapply-test.sql - prefer that one BEFORE applying.
--
--       BEGIN;
--         -- 7a. THE EXEMPTION. The SQL Editor has no auth.uid(), so this
--         --     MUST SUCCEED. If it raises LG008, the exemption is
--         --     broken, the admin grant route can no longer mark anybody
--         --     paid, and every migration after this one is blocked.
--         UPDATE public.organizations
--            SET is_paid = NOT is_paid
--          WHERE id = (SELECT id FROM public.organizations ORDER BY created_at, id LIMIT 1);
--
--         -- 7b. A RENAME. The one live session write, on the exempt
--         --     path here but proved on the guarded path by T1 of the
--         --     pre-apply test. MUST SUCCEED.
--         UPDATE public.organizations
--            SET name = name || ' (092 verification)'
--          WHERE id = (SELECT id FROM public.organizations ORDER BY created_at, id LIMIT 1);
--       ROLLBACK;
--       -- EXPECTED: both succeed, then the ROLLBACK undoes them.
--       -- IF 7a RAISES LG008: roll the migration back with
--       -- 092_org_entitlement_down.sql. A migration that cannot write
--       -- the column it created has locked out the only route that
--       -- grants access to a paying customer.
--
-- V8. THE POLICY COUNT DID NOT MOVE.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117. 090 left 117 and 091 left 117.
--       -- >>> 092 ADDS A TRIGGER, NOT A POLICY, SO 117 IS BOTH THE
--       -- >>> BEFORE AND THE AFTER. A different number means something
--       -- >>> other than this file changed the policy set.
--
--       SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--       WHERE schemaname='public' AND tablename='organizations' AND cmd='UPDATE';
--       -- EXPECTED: exactly 1 row, byte-identical to before this apply:
--       --   "Org admins update their organization", UPDATE, {authenticated},
--       --   qual and with_check both
--       --   (id IN ( SELECT current_user_admin_org_ids() AS current_user_admin_org_ids))
--       -- A SECOND ROW, or a changed with_check, means somebody reached
--       -- for the policy anyway. It cannot express what this guard
--       -- expresses - see THE ROLE GATE BUYS NOTHING in the header.
--
-- V9. profiles.is_paid IS STILL THERE. Yes, on purpose.
--
--       SELECT count(*) AS still_present
--       FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='profiles'
--         AND column_name='is_paid';
--       -- EXPECTED: 1. This file does NOT drop it, and a 0 here means
--       -- somebody dropped it early - which breaks fifteen select lists
--       -- on the deployed site with PostgREST 42703 until the Phase 3
--       -- push lands. See DO NOT DROP profiles.is_paid in the header,
--       -- and the follow-up migration named there.
