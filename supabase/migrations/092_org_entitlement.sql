-- =====================================================================
-- Migration 092: entitlement becomes an ORGANIZATION fact.
--                091 stopped a browser granting itself the paid flag on
--                its own profile. This moves the flag one level up, to
--                the company, and closes the identical hole there in the
--                same transaction that opens it.
--
--   NEW   public.organizations.is_paid  boolean NOT NULL DEFAULT false
--   NEW   public.organizations_guard_columns()  -> trigger
--   NEW   trigger organizations_columns_guard   BEFORE UPDATE ON organizations
--
--   >>> THE GUARD IS A PERMIT LIST, NOT A DENY LIST. The only column a
--   >>> caller with an end-user session may change is `name`. Everything
--   >>> else on this table is refused with LG008 - INCLUDING COLUMNS THAT
--   >>> DO NOT EXIST YET. See THE SHAPE below for why that inverts 091's
--   >>> reasoning rather than contradicting it, and
--   >>> docs/092-organizations-writer-census.md for the derivation.
--
--   ALSO: one COMMENT ON TABLE public.profiles. No data, no schema, and
--   the only statement in this file that names that table - see section 6
--   for why it lives here.
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
--   4. THE PERMIT LIST ITSELF. A deny list can only be too small; a
--      PERMIT LIST CAN BE TOO SMALL IN THE OTHER DIRECTION - a column a
--      session client legitimately writes, left off the list, is a write
--      that starts raising LG008 on apply. That is why this file is
--      derived from a written census rather than from reading the code
--      once, and why T1, T2 and T3 exercise the rename three different
--      ways: bare, whole-row, and no-op.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 459
-- and an explicit COMMIT; on LINE 1049. Those are the only EXECUTABLE
-- occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 1049 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/092_org_entitlement.sql
--
-- THAT GREP RETURNS FOUR HITS, AND FOUR IS CORRECT:
--     459  BEGIN;    <- executable. The transaction.
--     544  BEGIN     <- plpgsql, the backfill assertion block's body.
--                       No semicolon; matched by the case-insensitive
--                       form only, not a transaction statement.
--     856  BEGIN     <- plpgsql, organizations_guard_columns's body.
--                       Same. No semicolon.
--     1049 COMMIT;   <- executable. The one to swap for ROLLBACK;.
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
-- THE SHAPE: A PERMIT LIST OF ONE COLUMN, name. NOT A DENY LIST.
-- THE LOGIC THAT MADE A DENY LIST RIGHT FOR profiles INVERTS HERE.
-- =====================================================================
--
-- AN EARLIER DRAFT OF THIS FILE CARRIED A DENY LIST OF {is_paid},
-- following 091's mechanism. THAT WAS WRONG, and the reason is not that
-- 091 was wrong - it is that the argument 091 made does not transfer.
--
-- 091'S ARGUMENT, WHICH WAS CORRECT FOR profiles:
--
--   profiles has 44 columns, 37 of which are ordinary content a user
--   edits from a settings form, across 24 session write sites. A permit
--   list there is 37 entries where ONE OMISSION SILENTLY BREAKS A SAVE -
--   the exact shape app/api/profile/route.ts:35 records having shipped
--   for two migrations with personal_linkedin_url. A deny list is five
--   entries whose only failure mode is a FUTURE privilege column going
--   unguarded. And on profiles the next column is probably more profile
--   content - a bio, a preference, a contact field. Adding a privilege
--   column is a deliberate act; adding `bio` is not. So the deny list
--   carried the smaller risk.
--
-- ON organizations EVERY TERM IN THAT ARGUMENT FLIPS:
--
--   EIGHT columns, not 44. ONE of them is written by a session client -
--   `name`. So a permit list is ONE ENTRY, not 37, and the "one omission
--   breaks a save" cost is almost nil.
--
--   AND - THIS IS THE PART THAT DECIDES IT - EVERY PLAUSIBLE FUTURE
--   COLUMN ON THIS TABLE IS AUTHORITY-SHAPED. A plan tier. A seat limit.
--   A billing customer id. A trial expiry. There is no `bio` coming for
--   organizations; this is the billing table now.
--
--   A DENY LIST LEAVES EACH OF THOSE UNGUARDED UNTIL SOMEBODY REMEMBERS,
--   and "somebody remembers" is not a mechanism. A PERMIT LIST GUARDS
--   THEM BY DEFAULT, and its failure mode is a write that FAILS LOUDLY -
--   somebody adds a user-editable column, a save raises LG008 at
--   development time, and they add one word to a list - RATHER THAN A
--   HOLE THAT OPENS SILENTLY IN PRODUCTION.
--
-- THAT IS THE WHOLE RULING. docs/092-entitlements-design.md section 1
-- reached the same conclusion by the same route and the first draft of
-- this file did not follow it.
--
-- >>> THE LIST IS DERIVED FROM A CENSUS, NOT FROM A GUESS. <<<
--
-- docs/092-organizations-writer-census.md enumerates all five writers of
-- this table anywhere in the repository and every column each one writes,
-- and ITS GAP TABLE IS EMPTY - all eight columns have an identified
-- writer. A PERMIT LIST CANNOT BE DERIVED WITHOUT THAT: getting one entry
-- short does not fail a build, it breaks a write in production on the day
-- this file is applied. Section 3 quotes the census row that justifies
-- the one permitted column and the census row that excludes each of the
-- other seven.
--
-- >>> THE ROT INSTRUCTION, AND IT IS SHORTER THAN 091's BECAUSE THE
-- >>> SHAPE DOES THE WORK. <<<
--
--   THE PERMIT LIST LIVES IN ONE PLACE: `v_permitted` in
--   public.organizations_guard_columns(). There is no second chain to
--   keep in step with it. The COMMENT ON FUNCTION repeats it so a pg_proc
--   query can answer "what may be written" without opening a .sql file.
--
--   ADDING A COLUMN TO public.organizations REQUIRES NO EDIT HERE. It is
--   guarded from the moment it exists.
--
--   THE ONE THING THAT DOES REQUIRE AN EDIT: if a SESSION-CLIENT writer
--   legitimately starts writing a new column, THAT COLUMN JOINS
--   v_permitted IN THE SAME COMMIT. There is exactly one such writer
--   today, lib/company-identity.ts:306, and it writes `{ name }` and
--   nothing else - not even updated_at. The tripwire is recorded in the
--   census, section 2.
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
  'later. A browser cannot write it: organizations_columns_guard refuses '
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
-- 3. THE GUARD. public.organizations_guard_columns() -> trigger
--
-- >>> IT IS A PERMIT LIST OF ONE COLUMN: name. EVERYTHING ELSE ON THIS
-- >>> TABLE IS GUARDED BY DEFAULT, INCLUDING COLUMNS THAT DO NOT EXIST
-- >>> YET.
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
--
-- =====================================================================
-- THE TEST IS "DID THIS COLUMN CHANGE", NEVER "WAS THIS COLUMN IN THE
-- SET CLAUSE". THIS IS THE PARAGRAPH THAT DECIDES WHETHER A PERMIT LIST
-- IS SAFE AT ALL.
-- =====================================================================
--
-- A TRIGGER CANNOT SEE THE SET CLAUSE. It has OLD and NEW and nothing
-- else. There is no way, from inside a plpgsql trigger, to ask "which
-- columns did the caller name in their UPDATE" - and PostgREST does not
-- pass that information anywhere a trigger could reach it.
--
-- THAT IS NOT A LIMITATION HERE. IT IS THE PROPERTY THE WHOLE SHAPE
-- DEPENDS ON:
--
--   A caller that sends the WHOLE ROW back with one field altered - which
--   is exactly what a read-modify-write PATCH produces, and exactly what
--   both settings forms in this product do - names EVERY column in its
--   SET clause. If this guard refused on "was it in the SET clause", that
--   write would be refused for mentioning `is_paid` at all, even though
--   it sent back the identical value. EVERY WHOLE-ROW WRITE IN THE
--   PRODUCT WOULD BREAK.
--
--   Comparing VALUES with IS DISTINCT FROM makes that write pass, because
--   nothing outside the permit list MOVED. The caller may name any column
--   it likes; it may not change one.
--
-- >>> IMPLEMENT IT THE OTHER WAY AND EVERY WHOLE-ROW WRITE BREAKS. T2 in
-- >>> docs/092-preapply-test.sql is that property under test, and it is
-- >>> not there for symmetry.
--
-- IS DISTINCT FROM, never <>. `null <> null` is null, which is not true,
-- which would fall THROUGH a "did it move" test and report no movement on
-- a column that went from a value to NULL. Three of these eight columns
-- are nullable in practice, so this is not hypothetical.
--
-- =====================================================================
-- HOW THE PERMIT LIST IS EXPRESSED, AND WHY NOT A COLUMN CHAIN
-- =====================================================================
--
-- The obvious spelling is an IS NOT DISTINCT FROM chain naming the seven
-- guarded columns. IT WAS REJECTED, and the reason is the entire ruling:
-- SUCH A CHAIN HAS TO BE EDITED EVERY TIME A COLUMN IS ADDED, which makes
-- it a deny list wearing a permit list's clothes. A column somebody
-- forgets to add is unguarded, silently, which is the failure mode this
-- migration exists to stop.
--
-- So the comparison is over the ROW, with the permitted columns SUBTRACTED:
--
--     to_jsonb(NEW) - v_permitted   vs   to_jsonb(OLD) - v_permitted
--
-- `jsonb - text[]` deletes those keys. If the two projections are equal,
-- nothing outside the permit list moved. A COLUMN ADDED TO THIS TABLE
-- NEXT YEAR APPEARS IN BOTH PROJECTIONS AUTOMATICALLY AND IS THEREFORE
-- GUARDED FROM THE MOMENT IT EXISTS, with no edit to this function.
--
-- jsonb equality is by key set and value, not by key order, so the
-- comparison is well defined. Both sides are the same table's rowtype, so
-- every value serialises the same way on both sides.
--
-- >>> THE ONE MAINTENANCE ACT THIS SHAPE STILL REQUIRES: if a
-- >>> SESSION-CLIENT writer legitimately starts writing a new column, that
-- >>> column joins v_permitted IN THE SAME COMMIT. There is exactly one
-- >>> such writer today - lib/company-identity.ts:306 - and the tripwire
-- >>> is recorded in docs/092-organizations-writer-census.md section 2.
--
-- =====================================================================
-- THE PERMIT LIST, DERIVED FROM THE CENSUS AND NOT FROM A GUESS
-- =====================================================================
--
-- docs/092-organizations-writer-census.md enumerates every writer of this
-- table anywhere in the repository - five of them - and every column each
-- one writes. ITS GAP TABLE IS EMPTY: all eight columns have an
-- identified writer, so nothing here is a guess at an unaccounted column.
--
-- THE RULE: a column belongs on the permit list only if a SESSION-CLIENT
-- writer legitimately writes it.
--
--   name          PERMITTED.  Census W1, lib/company-identity.ts:306:
--                             `.from("organizations").update({ name })`
--                             on a SESSION client. Every company rename in
--                             the product goes through that line. It is
--                             the only session write of this table that
--                             exists.
--
-- AND EVERY OTHER COLUMN IS GUARDED. Stated one at a time, with the
-- census row that excludes it, because "it is not on the list" is not a
-- reason:
--
--   is_paid       GUARDED. See the block below - it is written by W2 and
--                 W3 and a mechanical derivation would have permitted it.
--                 That block exists because that mistake is the easy one.
--
--   updated_at    GUARDED. Census W2, W3 and W6 write it; ALL THREE ARE
--                 EXEMPT (service role, service role, migration). W1, the
--                 one session writer, writes `{ name }` and NOTHING ELSE -
--                 not even updated_at. That is quoted from the object
--                 literal, not inferred. There is also no updated_at
--                 auto-stamp trigger on this table; before this migration
--                 organizations carries no trigger at all.
--
--   is_lead_agency, is_vendor, primary_contact_user_id
--                 GUARDED. Census W4 and W5 only - the 079 backfill and
--                 handle_new_user. Both are migration/trigger writers with
--                 no request.jwt.claims, so auth.uid() is NULL and both
--                 are exempt. NO SESSION CLIENT WRITES ANY OF THE THREE.
--                 079:220 additionally records that the two capability
--                 flags are DESCRIPTIVE rather than authorization - which
--                 is a reason they were not in a deny list, and NOT a
--                 reason to permit them: nothing legitimate writes them
--                 from a browser, so guarding them costs nothing and stops
--                 a vendor org relabelling itself a lead agency.
--
--   id, created_at
--                 GUARDED. Census W4 writes both explicitly; W5 omits both
--                 and takes the column defaults. No session writer, and a
--                 primary key and a creation timestamp are not things a
--                 browser revises.
--
-- >>> ANY NEW COLUMN ON public.organizations IS GUARDED THE MOMENT IT
-- >>> EXISTS AND NOBODY HAS TO REMEMBER ANYTHING. That is the whole
-- >>> reason for the shape, and it is the answer to the question the deny
-- >>> list could not answer: the next column on this table is a plan tier,
-- >>> a seat limit or a billing customer id, and every one of those is
-- >>> authority-shaped.
--
-- =====================================================================
-- THE DETAIL NAMES COLUMNS AND NEVER VALUES. ASSESSED, NOT INHERITED.
-- =====================================================================
--
-- 091's rule was: name the column, never the value, because the caller
-- supplied the column name in their own request.
--
-- THIS FILE DIFFERS ON ONE POINT AND IT IS WORTH BEING EXPLICIT: the
-- moved-column list below is COMPUTED FROM A DIFF, not read back from
-- what the caller named. So a caller who sends a whole row and gets
-- `is_paid` back in the DETAIL has learned that their stored is_paid
-- differed from what they sent.
--
-- THAT IS NOT AN ORACLE HERE, and the reason is structural rather than a
-- judgement call: THIS TRIGGER ONLY FIRES ON A ROW THE UPDATE POLICY
-- ALREADY ADMITTED - "Org admins update their organization",
-- id IN (SELECT current_user_admin_org_ids()) - and the SELECT policy
-- "Members read their organizations" lets that same caller read every
-- column of that same row directly. The DETAIL reveals nothing a single
-- GET does not already give up. For a row they do NOT belong to, the
-- policy filters the UPDATE to zero rows and this trigger never runs.
--
-- VALUES ARE STILL NEVER INTERPOLATED. Not OLD, not NEW. "You cannot
-- change is_paid from false to true" would be a different thing entirely
-- and must not be added.
--
-- WHY NAME THEM AT ALL: the highest-probability real event is not an
-- attack, it is a legitimate writer tripping this guard on a path nobody
-- traced - most likely lib/company-identity.ts:306 having gained a
-- column. A DETAIL that names the moved column turns that investigation
-- into a two-minute read. That is the 087 lesson and it applies here more
-- than it did to 091, because a permit list can be tripped by a column
-- nobody was thinking about.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.organizations_guard_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- THE PERMIT LIST. THE ONLY PLACE IT EXISTS IN THIS FUNCTION - there is
  -- no second chain to keep in step with it, which is the point.
  -- Derived from docs/092-organizations-writer-census.md, W1.
  v_permitted CONSTANT text[] := ARRAY['name'];
  v_old_rest  jsonb;
  v_new_rest  jsonb;
  v_moved     text[];
BEGIN
  -- THE ROW, MINUS THE PERMITTED COLUMNS, ON BOTH SIDES.
  v_old_rest := to_jsonb(OLD) - v_permitted;
  v_new_rest := to_jsonb(NEW) - v_permitted;

  -- THE EARLY RETURN THAT MAKES THIS FREE, AND IT IS FIRST ON PURPOSE.
  -- Every rename in the product leaves here - including a whole-row write
  -- that names all eight columns and alters only `name` - having done one
  -- jsonb comparison and NOT having called auth.uid().
  --
  -- This is a VALUE comparison, not a SET-clause comparison. See the
  -- header block above; it is the property the shape depends on.
  IF v_new_rest = v_old_rest THEN
    RETURN NEW;
  END IF;

  -- THE EXEMPTION. A write with no end-user session behind it is trusted
  -- code that has already made its own authorization decision: the admin
  -- grant routes on the service role (census W2, W3), a future billing
  -- webhook, this migration's own backfill (W6), handle_new_user (W5),
  -- and every migration after this one. See the header for why this test
  -- and not current_user, session_user or auth.role() - the same four
  -- candidates 091 walked, with the same outcome.
  --
  -- >>> EXEMPT IS NOT THE SAME AS PERMITTED. is_paid is written by W2 and
  -- >>> W3 and is deliberately NOT on the permit list: those two are
  -- >>> service-role callers and pass HERE, before the permit list is ever
  -- >>> consulted. Adding is_paid to v_permitted would additionally let a
  -- >>> BROWSER write it, and the browser is the entire threat model -
  -- >>> every user is an owner of their own organization, so the UPDATE
  -- >>> policy already authorises them to write their own row. THAT EDIT
  -- >>> WOULD DELETE THIS MIGRATION'S ENTIRE EFFECT WHILE APPEARING TO
  -- >>> REFLECT THE CENSUS.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller moved a column that is not on the
  -- permit list. RAISE, never silently revert to OLD. A silently reverted
  -- plan change is a customer who believes they upgraded and a company
  -- that goes on being refused - the same class of quiet wrongness 090 and
  -- 091 both refused for their own columns, delivered to a paying reader.
  SELECT array_agg(k ORDER BY k)
    INTO v_moved
  FROM jsonb_object_keys(v_new_rest) AS k
  WHERE v_new_rest -> k IS DISTINCT FROM v_old_rest -> k;

  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG008',
          DETAIL  = format(
            'organizations.%s may not be written by a browser. Migration 092 guards every column on this table except %s, which is the only one a session client legitimately writes. Only the service role, a database function, or a migration may write the rest. Being an owner or admin of an organization does not permit it: every user is an owner of their own organization, so that role would grant this to everybody.',
            array_to_string(v_moved, ', organizations.'),
            array_to_string(v_permitted, ', ')
          );
END;
$$;

COMMENT ON FUNCTION public.organizations_guard_columns() IS
  'BEFORE UPDATE guard on public.organizations. IT IS A PERMIT LIST, NOT A DENY '
  'LIST: the ONLY column a caller with an end-user session may change is `name`. '
  'Every other column - id, primary_contact_user_id, is_lead_agency, is_vendor, '
  'created_at, updated_at, is_paid, AND ANY COLUMN ADDED LATER - is refused with '
  'LG008. The list lives in v_permitted and nowhere else; the comparison is '
  'to_jsonb(NEW) - v_permitted against to_jsonb(OLD) - v_permitted, so a new '
  'column is guarded from the moment it exists with no edit to this function. '
  'IT COMPARES VALUES, NEVER THE SET CLAUSE - a trigger cannot see the SET '
  'clause, and comparing values is what lets a whole-row read-modify-write pass '
  'when only `name` moved. Exempts service_role, postgres, handle_new_user and '
  'migrations, all of which resolve auth.uid() to NULL - EXEMPT IS NOT PERMITTED, '
  'which is why is_paid is written by the admin grant routes and is still not on '
  'the list. IT EXISTS BECAUSE THE ROLE GATE BUYS NOTHING: "Org admins update '
  'their organization" is keyed on current_user_admin_org_ids(), and every user '
  'is an owner of their own organization by construction (079 PHASE 2 and PHASE '
  '12), so that policy authorises every authenticated user to UPDATE some '
  'organization row. RLS has no column granularity and a WITH CHECK has no OLD. '
  'DO NOT AMEND THIS TO LET OWNERS THROUGH - that would delete its entire effect '
  'while appearing to refine it. Permit list derived from '
  'docs/092-organizations-writer-census.md; a column joins it only when a '
  'SESSION-CLIENT writer legitimately writes it, in the same commit.';


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
DROP TRIGGER IF EXISTS organizations_columns_guard ON public.organizations;

CREATE TRIGGER organizations_columns_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_columns();


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
REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM authenticated;


-- ---------------------------------------------------------------------
-- 6. ONE COMMENT ON public.profiles. THE ONLY STATEMENT IN THIS FILE THAT
--    TOUCHES THAT TABLE, AND IT WRITES NO DATA AND NO SCHEMA.
--
-- WHY IT IS IN THIS FILE AND NOT ITS OWN. 092 is the migration that makes
-- this repository's THIRD guard trigger, and the second table to carry
-- one. That is the moment the pattern stops being two ad-hoc triggers and
-- starts being a convention somebody will copy - so it is the moment to
-- write down the one thing about it that is easy to break by accident and
-- impossible to see afterwards.
--
-- IT DESTROYS NOTHING. public.profiles carries no table comment today -
-- grep for COMMENT ON TABLE public.profiles across every migration returns
-- nothing - so this sets one rather than replacing one. If that ever stops
-- being true, MERGE, do not overwrite: COMMENT ON replaces wholesale and
-- there is no append.
--
-- WHAT IT RECORDS, and why it matters:
--
--   profiles carries TWO BEFORE UPDATE triggers, from 090 and 091.
--   POSTGRESQL FIRES THEM IN ALPHABETICAL ORDER BY TRIGGER NAME:
--     profiles_active_org_guard        (090)  'a' sorts first
--     profiles_authority_columns_guard (091)  'u' sorts second
--
--   >>> THE ORDERING IS NOT WHAT MAKES THAT SAFE, AND BELIEVING IT IS, IS
--   >>> THE MISTAKE THIS COMMENT EXISTS TO PREVENT.
--
--   What makes it safe is that EACH GUARD EARLY-RETURNS WHEN ITS OWN
--   COLUMNS HAVE NOT MOVED, and neither modifies NEW. Each either returns
--   NEW untouched or RAISEs. So the pair COMMUTES: run them in either
--   order and the outcome is identical, because at most one of them has
--   anything to say about any given UPDATE.
--
--   THAT IS WHY RENAMING ONE IS SAFE, AND ALSO WHY NOBODY SHOULD HAVE TO
--   CHECK. A future third trigger that MUTATES NEW would break the
--   property, and it would break it silently, in an order determined by
--   how somebody happened to spell its name.
--
-- 092's own trigger is on organizations, not profiles, and is the only
-- trigger on that table - so it has no ordering question of its own. The
-- same reasoning is stated in its section 4 for whoever adds the second.
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.profiles IS
  'One row per account. CARRIES TWO BEFORE UPDATE GUARD TRIGGERS, and PostgreSQL fires '
  'BEFORE triggers in ALPHABETICAL ORDER BY TRIGGER NAME: profiles_active_org_guard (090, '
  'active_org_id must name an organization this profile belongs to) runs first, then '
  'profiles_authority_columns_guard (091, the authority set is_paid/is_admin/demo_access/'
  'email/linked_agency_id may not be written by a caller with an end-user session). '
  'THE ORDER IS NOT WHAT MAKES THE PAIR SAFE. Each guard EARLY-RETURNS when its own '
  'columns have not moved, and NEITHER MODIFIES NEW - each returns NEW unchanged or '
  'RAISEs - so at most one of them has anything to say about any given UPDATE and the two '
  'commute. Renaming either is therefore safe. A future trigger on this table that '
  'MUTATES NEW would destroy that property silently, in an order decided by its spelling. '
  'profiles.is_paid is VESTIGIAL as of migration 092: entitlement is organizations.is_paid '
  'now, and a later migration drops this column together with its entry in 091''s '
  'authority set. See supabase/migrations/092_org_entitlement.sql.';

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
--       --   organizations_columns_guard   tgenabled = O
--       --   proname = organizations_guard_columns
--       -- A SECOND ROW means somebody added a trigger to this table that
--       -- this file does not know about, and it fires on the same
--       -- writes. Find it before trusting this guard.
--       -- tgenabled = D means the trigger is DISABLED and buying
--       -- nothing.
--
--       SELECT p.proname, p.prosecdef, p.proconfig
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'organizations_guard_columns';
--       -- EXPECTED: exactly 1 row.
--       --   prosecdef = t
--       --   proconfig = {"search_path=public, pg_temp"}
--
-- V6. THE GRANTS. THE ONE THAT CATCHES THE 088 MISTAKE.
--
--       SELECT has_function_privilege('anon',          'public.organizations_guard_columns()', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.organizations_guard_columns()', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.organizations_guard_columns()', 'EXECUTE') AS service_role;
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
