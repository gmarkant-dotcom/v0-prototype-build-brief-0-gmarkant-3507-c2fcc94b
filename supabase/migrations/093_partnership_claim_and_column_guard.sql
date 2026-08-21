-- =====================================================================
-- Migration 093: two holes in the partnerships policy set, found by live
--                query and logged as OPEN-092-8 and OPEN-092-9.
--
--   CHANGED  policy "Partners can claim partnership by email"
--            ~~* (ILIKE)  ->  equality on lower(btrim()) both sides
--
--   CHANGED  public.partnerships_guard_identity_columns()  -> trigger
--            087's four refusals are carried forward VERBATIM and a
--            VENDOR-SIDE COLUMN PERMIT LIST is added below them.
--
--   >>> THE NEW HALF IS A PERMIT LIST, NOT A DENY LIST, FOLLOWING 092.
--   >>> A caller acting as the VENDOR on a partnership may change
--   >>> status, accepted_at, updated_at, payment_terms_requests and
--   >>> vendor_org_id, plus profile_status on the claim transition only.
--   >>> EVERY OTHER COLUMN IS REFUSED WITH LG009 - INCLUDING COLUMNS
--   >>> THAT DO NOT EXIST YET. See THE SHAPE and THE CENSUS below.
--
--   POLICIES ADDED: NONE. DROPPED: NONE. Count stays at 117.
--   HOLE 1 IS AN **ALTER** POLICY, NOT A DROP-THEN-CREATE, AND THAT IS
--   DELIBERATE - see WHY ALTER below. If the count moves, something
--   other than this file moved it.
--
--   COLUMNS ADDED: NONE. TABLES ADDED: NONE. DATA WRITTEN: NONE.
--   FUNCTIONS ADDED: NONE - the one function here already exists and is
--   CREATE OR REPLACE'd, so its ACL survives.
--
--   087's INSERT policy "Agencies can create partnerships" IS NOT
--   TOUCHED. Neither is "Partners can update partnership status" itself:
--   the column restriction it lacks CANNOT be written as a policy, which
--   is the whole reason this is a trigger. See WHY NOT A POLICY.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. The session that wrote it executed
-- no statement against any database and holds no credential that could.
-- It is applied by Greg, by hand, in the Supabase SQL Editor.
--
-- RUN docs/093-preapply-test.sql FIRST. It is one paste. It BEGINs, runs
-- this entire migration, impersonates a real vendor on a real
-- partnership through request.jwt.claims, exercises every legitimate
-- vendor write and every write this file is meant to refuse, and then
-- ROLLBACKs. Nothing persists.
--
-- WHY A DRY RUN IS NOT ENOUGH. A dry run proves this file PARSES. It
-- says nothing about whether a vendor can still accept an invitation,
-- decline one, or request payment terms - three live writes that this
-- file can break, in production, the moment it is applied.
--
-- >>> 092's HEADER COULD ARGUE ITS RISK WAS SMALL BECAUSE ITS PERMIT
-- >>> LIST GUARDED A COLUMN THAT DID NOT EXIST UNTIL LINE 1 OF ITS OWN
-- >>> TRANSACTION. THAT ARGUMENT IS NOT AVAILABLE HERE AND MUST NOT BE
-- >>> BORROWED. THIS PERMIT LIST GUARDS TWENTY-ODD COLUMNS THAT ALL
-- >>> EXIST TODAY AND SEVERAL OF WHICH ARE WRITTEN EVERY DAY. The risk
-- >>> is the OPPOSITE direction from a hole: a column a vendor
-- >>> legitimately writes, left off the list, is a write that STARTS
-- >>> RAISING LG009 ON APPLY. That is why the list is derived from the
-- >>> written census in section 3 rather than from reading the code
-- >>> once, and why the test exercises the three live vendor writers
-- >>> individually rather than as a group.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE
-- 381 and an explicit COMMIT; on LINE 609. Those are the
-- only EXECUTABLE occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 609 to ROLLBACK; and run
-- the whole file. Every statement executes, every error surfaces,
-- nothing persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/093_partnership_claim_and_column_guard.sql
--
-- THAT GREP RETURNS THREE HITS, AND THREE IS CORRECT:
--     381  BEGIN;    <- executable. The transaction.
--     455  BEGIN     <- plpgsql, partnerships_guard_identity_columns's
--                       body. No semicolon; matched by the
--                       case-insensitive form only, not a transaction
--                       statement.
--     609  COMMIT;   <- executable. Change this one to ROLLBACK; to dry
--                       run.
--
-- There is no ROLLBACK in this file. The DOWN file has its own.
--
-- >>> "Success. No rows returned" IS WHAT THE SUPABASE SQL EDITOR SAYS
-- >>> FOR A DRY RUN, FOR A REAL APPLY, AND FOR A QUERY PASTED INTO THE
-- >>> WRONG TAB. It is not evidence of anything. The verification block
-- >>> after the COMMIT is what tells the three apart.
--
-- =====================================================================
-- HOLE 1: THE CLAIM POLICY MATCHES BY PATTERN, NOT BY EQUALITY
-- =====================================================================
--
-- "Partners can claim partnership by email" is the ONLY policy in this
-- schema that lets a caller write a row they do not yet own. Its live
-- USING clause is:
--
--     vendor_org_id IS NULL
--     AND partner_email ~~* (SELECT pr.email FROM profiles pr
--                            WHERE pr.id = auth.uid())
--
-- `~~*` IS ILIKE. THE RIGHT-HAND SIDE IS A PATTERN, NOT A STRING. The
-- pattern is the CALLER'S OWN PROFILE EMAIL, a value the caller controls
-- through the profile update path. `%` matches any run of characters and
-- `_` matches any single one, so an account whose email were
-- `%@example.com` would match, and be able to claim, EVERY unclaimed
-- ghost partnership addressed to any address at that domain. An account
-- whose email were simply `%` would match every unclaimed row in the
-- table.
--
-- NOT EXPLOITABLE TODAY, STATED PRECISELY RATHER THAN WAVED AT: no live
-- profiles.email contains `%` or `_`. That is a property of today's data
-- and of nothing else. Nothing in the schema constrains it, Supabase
-- Auth permits `_` in the local part of an address as a matter of course
-- (RFC 5321 does), and `_` alone would let one account claim every
-- one-character-email row. The fix does not depend on which of those is
-- reachable.
--
-- THE FIX IS EQUALITY, WITH THE HOUSE CONVENTION ON BOTH SIDES:
-- lower(btrim(a)) = lower(btrim(b)), false when either side is NULL. It
-- is the same comparison the vendor arm of partner_rfp_inbox already
-- uses ("Partners select inbox rows by recipient email") and the same
-- one lib/partner-inbox-access.ts makes in application code, so all
-- three now agree.
--
-- WHAT THIS NARROWS, AND THE ONE THING IT WIDENS. SAID OUT LOUD BECAUSE
-- A SILENT WIDENING IS EXACTLY WHAT THIS FILE EXISTS TO REMOVE:
--
--   NARROWS  `%` and `_` in the caller's email stop being wildcards.
--            That is the hole and it is closed.
--   NARROWS  a partner_email of NULL can no longer be reached by the
--            three-valued path; it is refused explicitly.
--   WIDENS   btrim(). ILIKE did not trim, so a partner_email stored as
--            ' greg@x.com' was NOT claimable by greg@x.com and now is.
--            That is one extra row-shape, it is the SAME PERSON, and it
--            is the house convention every other email comparison in
--            this schema already follows. It is a widening and it is
--            named as one rather than buried.
--
-- CASE IS UNCHANGED: ILIKE was already case-insensitive and lower() on
-- both sides is too.
--
-- WHY ALTER POLICY RATHER THAN DROP-THEN-CREATE. 087 used DROP IF EXISTS
-- + CREATE for the INSERT policy on this table. That shape has a failure
-- mode this change cannot afford: IF THE POLICY NAME HAD DRIFTED, the
-- DROP silently matches nothing and the CREATE adds a SECOND policy -
-- leaving the ILIKE one live, OR-ing the two together, and closing
-- NOTHING while reporting success. ALTER POLICY on a name that does not
-- exist raises 42704 undefined_object and aborts the transaction. For a
-- change whose entire purpose is to REMOVE a predicate, failing loudly
-- on a missing name is the only acceptable behaviour.
--
-- The WITH CHECK is restated below unchanged, character for character,
-- so this file is readable without cross-referencing 079.
--
-- =====================================================================
-- HOLE 2: "Partners can update partnership status" HAS NO COLUMN
--         RESTRICTION, AND ITS NAME IS A LIE
-- =====================================================================
--
-- The live policy is:
--
--     FOR UPDATE TO authenticated
--     USING      (vendor_org_id IN (SELECT current_user_org_ids()))
--     WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))
--
-- It says "status" in its name and it restricts NO COLUMN. A vendor may
-- rewrite ANY column on any partnership they belong to.
--
-- WHAT IS ALREADY MITIGATED, VERIFIED AGAINST 087 RATHER THAN ASSUMED.
-- 087's partnerships_guard_identity_columns trigger is live and it pins
-- the identity columns:
--
--   * lead_org_id is IMMUTABLE (087:606-612). A vendor CANNOT move a
--     partnership to another lead agency. This is the worst outcome the
--     open hole could otherwise have had and it is already closed.
--   * vendor_org_id cannot be CLEARED once set (087:621-627).
--   * vendor_org_id cannot be REPOINTED once set (087:632-638).
--   * vendor_org_id may only ever be written NULL -> the organization of
--     the person the row is addressed to (087:642-648).
--
-- WHAT REMAINS WRITABLE, AND WHY EACH ONE MATTERS. Established from the
-- schema, column by column, in section 3. The four that make this worth
-- a migration:
--
--   nda_confirmed_at / nda_confirmed_by   THE AGENCY'S CONFIRMATION that
--     this vendor's NDA is signed. A vendor writing it confirms their own
--     NDA. app/api/partnerships/route.ts:849 is the only legitimate
--     writer and it is gated on `isAgency`.
--   msa_confirmed_at / msa_confirmed_by   the same, for the MSA.
--     app/api/partnerships/route.ts:931, also gated on `isAgency`.
--   partnership_notes                     the lead agency's PRIVATE notes
--     about this vendor, and the namespace that holds the {blacklisted}
--     flag (migration 068). A vendor writing it can un-blacklist
--     themselves and rewrite what the agency wrote about them.
--   reliability_summary /
--   reliability_summary_generated_at      the CACHED AI PERFORMANCE
--     NARRATIVE about this vendor, computed from delivery_reviews and
--     rendered to the lead agency. A vendor writing it authors their own
--     performance record. Migration 073's header already flagged this
--     column as vendor-readable and worried about it in writing; this is
--     the write half of that worry.
--
-- WHY NOT A POLICY. Row level security has NO COLUMN GRANULARITY, and a
-- WITH CHECK expression sees only NEW - it has no OLD, so it cannot say
-- "this column did not change". Column immutability is not expressible
-- as a policy under any spelling. A trigger is the only mechanism, and
-- 087 already put one on this table, so this EXTENDS that function
-- rather than adding a second trigger beside it.
--
-- >>> BECAUSE IT EXTENDS IT, 087'S FOUR REFUSALS ARE REPRODUCED BELOW
-- >>> CHARACTER FOR CHARACTER. CREATE OR REPLACE FUNCTION REPLACES A
-- >>> BODY WHOLESALE. Dropping one of those blocks while editing this
-- >>> file would silently reopen HOLE 3, 5 or 6 of migration 087 and
-- >>> nothing would report it. If you change this function, diff it
-- >>> against 087:596-651 first.
--
-- ADDING A SECOND TRIGGER WOULD ALSO HAVE WORKED AND IS WORSE. Postgres
-- fires BEFORE triggers in ALPHABETICAL ORDER BY TRIGGER NAME, so a new
-- `partnerships_columns_guard` would sort BEFORE
-- `partnerships_guard_identity_columns` and its generic LG009 would
-- pre-empt 087's four specific messages for the cases 087 already
-- diagnoses precisely. One function, one message per situation.
--
-- =====================================================================
-- THE SHAPE: A PERMIT LIST, AND WHAT MAKES IT SAFE
-- =====================================================================
--
-- Copied deliberately from 092's organizations_guard_columns(), for the
-- same reason 092 gives: every future column on this table is
-- authority-shaped. A deny list guards what somebody remembered; a
-- permit list guards what nobody thought about, including columns added
-- after this file is written.
--
-- IT COMPARES VALUES, NEVER THE SET CLAUSE. A trigger cannot see the SET
-- clause - it has OLD and NEW and nothing else. So a whole-row
-- read-modify-write that names every column and CHANGES only `status`
-- passes, because to_jsonb(NEW) - permitted equals to_jsonb(OLD) -
-- permitted. Any implementation that tried to refuse on "was this column
-- named" would break every read-modify-write in the product.
--
-- THREE EARLY EXITS, IN THIS ORDER, AND THE ORDER IS THE DESIGN:
--
--   1. NOTHING GUARDED MOVED  -> return. One jsonb comparison, no
--      auth.uid() call, no query. Every legitimate vendor write and most
--      agency writes leave here.
--   2. auth.uid() IS NULL     -> return. No end-user session behind the
--      write: the service role, a database function, this migration, and
--      every migration after it. Those callers have already made their
--      own authorization decision. EXEMPT IS NOT PERMITTED - see 092's
--      function comment for why that distinction is load-bearing.
--   3. THE CALLER IS THE LEAD AGENCY -> return. Their writes are
--      authorised by "Agencies can update their partnerships", which is
--      keyed on lead_org_id, and this guard is about the VENDOR side. The
--      membership test is `OLD.lead_org_id IN (SELECT
--      public.current_user_org_ids())` - OLD, not NEW, because 087 has
--      already refused any write that moved it, so the two are equal by
--      the time this line runs, and OLD is the value that decides who
--      the caller was BEFORE the write.
--
-- Anything past those three is a signed-in caller who is NOT the lead
-- agency moving a column that is not on the permit list. That is the
-- vendor, and it is refused.
--
-- A NOTE ON THE DUAL-ROLE ACCOUNT. Somebody who is BOTH the lead agency
-- and the vendor on one row leaves at exit 3 and is unrestricted. That
-- is correct: they ARE the agency on that row, and the agency may write
-- these columns. It is not a bypass, it is the answer to the question.
--
-- ACL DEPENDENCY, STATED BECAUSE IT IS INVISIBLE. This function is NOT
-- SECURITY DEFINER - 087 chose that deliberately and it is preserved -
-- so `public.current_user_org_ids()` is called AS THE INVOKER. 079 grants
-- EXECUTE on it to `authenticated` and to nobody else. Every role that
-- holds an UPDATE policy on partnerships is `authenticated`, and every
-- other caller returns at exit 2 before reaching the call. If a future
-- migration grants some other role UPDATE on this table without granting
-- it EXECUTE on that helper, this guard starts raising 42501 instead of
-- LG009. Verification V6 after the COMMIT checks the grant is still there.
--
-- =====================================================================
-- THE CENSUS: EVERY COLUMN ON public.partnerships, AND WHO WRITES IT
-- =====================================================================
--
-- Assembled from the CREATE TABLE and every ALTER that touched it:
-- scripts/010-closed-ecosystem-schema.sql:12-31, scripts/011:5,
-- scripts/025:3-6, scripts/032:4, 051:5-6, 052:2, 061:14-23, 063:9,
-- 066:59-60, 068:9-12, and 079:672-673 for the two renames.
--
--   COLUMN                          PERMITTED TO A VENDOR?  WHY
--   ------------------------------  ----------------------  --------------
--   id                              no    primary key
--   lead_org_id                     no    087 pins it, immutable
--   vendor_org_id                   YES   the claim path writes it, and
--                                         087's checks above govern it
--                                         far more tightly than a permit
--                                         list could
--   status                          YES   W1 accept, W2 decline
--   accepted_at                     YES   W1 accept
--   updated_at                      YES   W2, W4, W5
--   payment_terms_requests          YES   W3, the vendor's rate request
--   profile_status                  CLAIM ONLY  W4 and W5 write 'active'
--                                         on the claim transition. NOT
--                                         permitted afterwards: it also
--                                         holds 'removed', which is how an
--                                         agency hides a row from its own
--                                         pool (063), so a claimed vendor
--                                         could delete themselves from the
--                                         agency's view of their network.
--   partner_email                   no    THE PRE-CLAIM IDENTIFIER. It is
--                                         the right-hand side of the claim
--                                         policy this same migration is
--                                         fixing. A vendor rewriting it
--                                         rewrites who may claim the row.
--   invitation_message              no    the agency's message to them
--   invited_at                      no    agency timestamp
--   invitation_sent_at              no    agency timestamp (063)
--   created_at                      no    immutable by convention
--   nda_confirmed_at                no    THE AGENCY CONFIRMS THE NDA
--   nda_confirmed_by                no    same
--   msa_confirmed_at                no    THE AGENCY CONFIRMS THE MSA
--   msa_confirmed_by                no    same
--   partnership_notes               no    agency's private notes, holds
--                                         the {blacklisted} flag
--   reliability_summary             no    cached AI performance narrative
--   reliability_summary_generated_at no   same
--   pool_status                     no    agency pool classification (061)
--   domain_match_profile_id         no    agency auto-classification (061)
--   contact_name                    no    pre-claim contact data (068)
--   company_name                    no    pre-claim contact data (068)
--   phone                           no    pre-claim contact data (068)
--   website                         no    pre-claim contact data (068)
--   ANY COLUMN ADDED AFTER THIS     no    guarded from the moment it
--                                         exists, with no edit here
--
-- THE VENDOR-SIDE WRITERS, W1 TO W5. Every session-client write to this
-- table by a caller who is not the lead agency. Found by grep for
-- `from("partnerships")` followed by `.update(` across app/ and lib/.
--
--   W1  app/api/partnerships/route.ts:1029
--       accept an invitation: { status: 'active', accepted_at }
--   W2  app/api/partnerships/route.ts:1179
--       decline an invitation: { status: 'terminated', updated_at }
--   W3  app/partner/projects/page.tsx:366
--       request payment terms: { payment_terms_requests }
--   W4  app/auth/callback/route.ts:183
--       claim on login: { vendor_org_id, profile_status, updated_at }
--   W5  app/api/partnerships/route.ts:285
--       claim: { vendor_org_id }
--
-- ALL FIVE PASS. W1, W2 and W3 move only permitted columns and leave at
-- exit 1. W4 and W5 move vendor_org_id on the claim transition, which
-- adds profile_status to the list for that write only.
--
-- SERVICE-ROLE WRITERS ARE EXEMPT AT EXIT 2, NOT PERMITTED. They are
-- lib/partnership-award-claim.ts, lib/server/partner-pool-import.ts:282,
-- app/api/agency/email-scan/import/route.ts:106 and
-- app/api/rfp/guest/[token]/route.ts:89. They still pass through 087's
-- four refusals above, which have no exemption and never had one.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE
-- =====================================================================
--
-- NO CODE CHANGE IS REQUIRED BY THIS MIGRATION, IN EITHER ORDER. It
-- removes an ability nothing in this repository uses. Every one of W1 to
-- W5 keeps working, which is what the pre-apply test proves before you
-- commit anything.
--
-- The one behaviour a reader might expect to break and which does not:
-- the vendor RFP-list and dashboard fixes shipped on
-- fix/acting-role-read-scope read `partnerships` and never write it.
--
-- ROLLBACK: supabase/migrations/093_partnership_claim_and_column_guard_down.sql
-- restores both the ILIKE predicate and 087's function body exactly as
-- they are today. Read its header before running it - restoring HOLE 1
-- is a deliberate act.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1. HOLE 1. The claim policy, by equality.
--
-- ALTER, not DROP-then-CREATE. See WHY ALTER POLICY in the header: on a
-- drifted name this raises 42704 and aborts, where DROP IF EXISTS +
-- CREATE would leave the ILIKE policy live beside a new one and close
-- nothing while reporting success.
--
-- The EXISTS form rather than a scalar subquery, because it makes the
-- NULL handling explicit instead of leaving it to three-valued logic:
-- `pr.email IS NOT NULL` and `partner_email IS NOT NULL` are stated, so
-- a reader does not have to reason about what `NULL = NULL` does inside
-- a USING clause. Same shape as the live recipient-email policy on
-- partner_rfp_inbox.
--
-- WITH CHECK IS UNCHANGED from 079:1500 and is restated only so this
-- file can be read without opening that one.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 2. HOLE 2. 087's guard, extended with a vendor-side permit list.
--
-- CREATE OR REPLACE, NEVER DROP-THEN-CREATE. Dropping this function
-- would require dropping the trigger that depends on it, and would
-- discard its ACL. Replacing it keeps both, and the trigger created by
-- 087 goes on pointing at the same name.
--
-- >>> THE FIRST FOUR BLOCKS BELOW ARE 087:606-648, REPRODUCED CHARACTER
-- >>> FOR CHARACTER INCLUDING THEIR COMMENTS. CREATE OR REPLACE REPLACES
-- >>> A BODY WHOLESALE, SO OMITTING ONE WOULD SILENTLY REOPEN THE HOLE
-- >>> IT CLOSES. Diff against 087 before changing anything here.
--
-- STILL NOT SECURITY DEFINER, and still for 087's stated reason: it
-- reads only NEW and OLD, and the two functions it calls -
-- org_has_member_with_email() and current_user_org_ids() - are each
-- already SECURITY DEFINER and already granted to authenticated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partnerships_guard_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- THE PERMIT LIST. THE ONLY PLACE IT EXISTS IN THIS FUNCTION - there is
  -- no second chain to keep in step with it, which is the point.
  -- Derived from THE CENSUS in this file's header, writers W1 to W5.
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
  -- ===== 087:606-648 BEGINS. DO NOT EDIT WITHOUT DIFFING 087. =====

  -- HOLE 5 AND 6. lead_org_id is immutable. A vendor holding one real
  -- partnership must not be able to repoint it at an organization it has
  -- no relationship with and become that organization's commercial
  -- counterparty. No write path anywhere updates this column.
  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION
      'partnerships.lead_org_id is immutable (attempted % -> %)',
      OLD.lead_org_id, NEW.lead_org_id
      USING ERRCODE = '42501';
  END IF;

  -- THE VALUE -> NULL RESIDUAL. The transition block below is entered only
  -- when the new value IS NOT NULL, so clearing a linked vendor back to
  -- NULL falls straight through it - and a cleared row is then a ghost row
  -- again, relinkable to any organization by the claim path. vendor_org_id
  -- is pinned in both directions or it is not pinned. No writer in this
  -- repository clears it: all four sites that write NULL are INSERTs.
  IF OLD.vendor_org_id IS NOT NULL AND NEW.vendor_org_id IS NULL THEN
    RAISE EXCEPTION
      'partnerships.vendor_org_id cannot be cleared once set (attempted % -> NULL)',
      OLD.vendor_org_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.vendor_org_id IS DISTINCT FROM OLD.vendor_org_id
     AND NEW.vendor_org_id IS NOT NULL THEN

    -- Repointing an already-linked vendor is refused outright. Every
    -- writer already guards on the old value being null; none of them
    -- needs this and an appearance of it is a defect worth surfacing.
    IF OLD.vendor_org_id IS NOT NULL THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id cannot be repointed once set (attempted % -> %)',
        OLD.vendor_org_id, NEW.vendor_org_id
        USING ERRCODE = '42501';
    END IF;

    -- HOLE 3. The insert-a-ghost-then-update bypass. Without this line the
    -- new INSERT policy above is decorative.
    IF NOT public.org_has_member_with_email(NEW.vendor_org_id, NEW.partner_email) THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id % has no member whose email matches partner_email %',
        NEW.vendor_org_id, NEW.partner_email
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ===== 087:606-648 ENDS. 093 ADDS EVERYTHING BELOW. =====

  -- THE CLAIM TRANSITION WIDENS THE LIST BY EXACTLY ONE COLUMN, and only
  -- on the write that performs it. W4 and W5 set profile_status = 'active'
  -- in the same statement that links the vendor. Afterwards the column is
  -- guarded again, because 'removed' is how an agency hides a row from its
  -- own pool and a claimed vendor must not be able to write it.
  --
  -- The condition is the SAME transition 087's block above already
  -- authorised: by the time this line runs, a NULL -> value move has
  -- passed org_has_member_with_email(). This does not re-authorise
  -- anything, it only decides which columns may travel with it.
  v_permitted := v_vendor_permitted;
  IF OLD.vendor_org_id IS NULL AND NEW.vendor_org_id IS NOT NULL THEN
    v_permitted := v_permitted || 'profile_status';
  END IF;

  -- THE ROW, MINUS THE PERMITTED COLUMNS, ON BOTH SIDES.
  v_old_rest := to_jsonb(OLD) - v_permitted;
  v_new_rest := to_jsonb(NEW) - v_permitted;

  -- EXIT 1. NOTHING GUARDED MOVED. Every legitimate vendor write leaves
  -- here, including a whole-row read-modify-write that names all
  -- twenty-six columns and alters only `status`. One jsonb comparison,
  -- no auth.uid() call, no query.
  --
  -- This is a VALUE comparison, not a SET-clause comparison. See THE
  -- SHAPE in the header; it is the property this whole design depends on.
  IF v_new_rest = v_old_rest THEN
    RETURN NEW;
  END IF;

  -- EXIT 2. NO END-USER SESSION. The service role, a database function,
  -- this migration, and every migration after it. Trusted code that has
  -- already made its own authorization decision.
  --
  -- >>> EXEMPT IS NOT THE SAME AS PERMITTED. The service-role writers
  -- >>> named in THE CENSUS write partnership_notes and profile_status
  -- >>> and those are deliberately NOT on the permit list: those callers
  -- >>> pass HERE, before the list is ever consulted. Adding their columns
  -- >>> to v_vendor_permitted would additionally let a BROWSER write them,
  -- >>> and the browser is the entire threat model.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- EXIT 3. THE CALLER IS THE LEAD AGENCY. Their writes are authorised by
  -- "Agencies can update their partnerships" and this guard is about the
  -- vendor side.
  --
  -- OLD.lead_org_id, not NEW: the first block in this function has already
  -- refused any write that moved it, so the two are equal here, and OLD is
  -- the value that says who the caller was before the write.
  --
  -- IN (SELECT fn()), never = ANY. House convention: the six
  -- current_user_* helpers return SETOF uuid.
  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller who is not the lead agency moved a
  -- column that is not on the permit list. That is the vendor. RAISE,
  -- never silently revert to OLD - an RLS update that matches no row
  -- returns HTTP 200 with no error and this project has lost real
  -- behaviour to exactly that five times.
  SELECT array_agg(k ORDER BY k)
    INTO v_moved
  FROM jsonb_object_keys(v_new_rest) AS k
  WHERE v_new_rest -> k IS DISTINCT FROM v_old_rest -> k;

  RAISE EXCEPTION 'That is not a field you can change on this partnership.'
    USING ERRCODE = 'LG009',
          DETAIL  = format(
            'partnerships.%s may not be written by the vendor on the partnership. Migration 093 guards every column on this table except %s, which are the only ones a vendor session legitimately writes, plus profile_status on the claim transition. The lead agency, the service role, a database function and a migration may all write the rest.',
            array_to_string(v_moved, ', partnerships.'),
            array_to_string(v_permitted, ', ')
          );
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_identity_columns() IS
  'BEFORE UPDATE guard on public.partnerships. TWO HALVES, BOTH LOAD-BEARING. '
  'HALF ONE, from migration 087: lead_org_id never changes, vendor_org_id is only ever '
  'written NULL -> value, is never cleared or repointed, and the value written must be the '
  'organization of the person the row is addressed to. It has NO exemption and applies to '
  'the service role too. HALF TWO, from migration 093: a VENDOR-SIDE COLUMN PERMIT LIST. A '
  'caller with an end-user session who is not a member of lead_org_id may change only '
  'status, accepted_at, updated_at, payment_terms_requests and vendor_org_id, plus '
  'profile_status on the claim transition; every other column - nda_confirmed_at, '
  'msa_confirmed_at, partnership_notes, reliability_summary, partner_email, the 068 contact '
  'columns, AND ANY COLUMN ADDED LATER - is refused with LG009. The list lives in '
  'v_vendor_permitted and nowhere else; the comparison is to_jsonb(NEW) - permitted against '
  'to_jsonb(OLD) - permitted, so a new column is guarded from the moment it exists with no '
  'edit to this function. IT COMPARES VALUES, NEVER THE SET CLAUSE, which is what lets a '
  'whole-row read-modify-write pass when only a permitted column moved. Half two exempts the '
  'service role, database functions and migrations (auth.uid() IS NULL) and the lead agency '
  '(OLD.lead_org_id IN current_user_org_ids()) - EXEMPT IS NOT PERMITTED, which is why '
  'partnership_notes is written by the pool-import service path and is still not on the list. '
  'IT EXISTS BECAUSE "Partners can update partnership status" RESTRICTS NO COLUMN DESPITE ITS '
  'NAME: RLS has no column granularity and a WITH CHECK has no OLD. DO NOT AMEND THIS TO LET '
  'THE VENDOR THROUGH ON A WIDER SET - a column joins v_vendor_permitted only when a real '
  'vendor-session writer needs it, in the same commit, with the census in 093''s header '
  'updated. Permit list derived from that census, writers W1 to W5.';

COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. READ ONLY - every query below is a
-- SELECT and none of them writes. EXPECTED VALUES STATED.
--
-- >>> RUN THESE. "Success. No rows returned" from the apply above is the
-- >>> SAME MESSAGE the editor gives for a dry run, for a real apply, and
-- >>> for a query pasted into the wrong tab. It distinguishes nothing.
-- >>> These six queries are what tell you which of the three happened.
-- =====================================================================
--
-- V1. THE CLAIM POLICY NO LONGER MATCHES BY PATTERN.
--     EXPECTED: 1 row. `qual` contains 'btrim' and does NOT contain '~~*'.
--     If it still contains '~~*', the ALTER did not run and HOLE 1 is open.
--
--     SELECT policyname,
--            qual LIKE '%btrim%' AS uses_btrim,
--            qual LIKE '%~~*%'   AS still_uses_ilike
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename  = 'partnerships'
--       AND policyname = 'Partners can claim partnership by email';
--
-- V2. THE POLICY COUNT DID NOT MOVE.
--     EXPECTED: 6 on partnerships, 117 across public.
--     093 ALTERs one policy and adds none. A 7 here means a DROP-then-
--     CREATE crept in somewhere and there are now two claim policies
--     OR-ing together, which would close nothing.
--
--     SELECT count(*) FILTER (WHERE tablename = 'partnerships') AS partnerships,
--            count(*)                                            AS public_total
--     FROM pg_policies WHERE schemaname = 'public';
--
-- V3. THE FUNCTION CARRIES BOTH HALVES.
--     EXPECTED: 1 row, all four booleans true. If has_permit_list is
--     false the CREATE OR REPLACE did not run. If any of the other three
--     is false, 087's refusals were dropped while this file was edited
--     and migration 087 has been silently undone.
--
--     SELECT p.proname,
--            pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%'      AS has_permit_list,
--            pg_get_functiondef(p.oid) LIKE '%lead_org_id is immutable%' AS has_087_immutable,
--            pg_get_functiondef(p.oid) LIKE '%cannot be cleared once set%' AS has_087_clear,
--            pg_get_functiondef(p.oid) LIKE '%cannot be repointed once set%' AS has_087_repoint
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname = 'partnerships_guard_identity_columns';
--
-- V4. THE TRIGGER IS STILL THERE, STILL ENABLED, AND THERE IS STILL ONLY
--     ONE ON THIS TABLE.
--     EXPECTED: 1 row. partnerships_guard_identity_columns, tgenabled 'O'.
--     A SECOND row would mean somebody added a second guard trigger, and
--     alphabetical firing order would then decide which message a vendor
--     sees. 093 adds no trigger.
--
--     SELECT t.tgname, t.tgenabled
--     FROM pg_trigger t
--     WHERE t.tgrelid = 'public.partnerships'::regclass
--       AND NOT t.tgisinternal
--     ORDER BY t.tgname;
--
-- V5. THE FUNCTION IS STILL NOT SECURITY DEFINER, AND STILL PINS ITS
--     search_path.
--     EXPECTED: prosecdef = false, proconfig = {"search_path=public, pg_temp"}.
--     A true here means somebody made it SECURITY DEFINER, which would
--     run current_user_org_ids() as the OWNER and resolve auth.uid() for
--     whoever the owner is - breaking exit 3 in a way nothing else would
--     report.
--
--     SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname = 'partnerships_guard_identity_columns';
--
-- V6. THE ACL EXIT 3 DEPENDS ON IS INTACT.
--     EXPECTED: 1 row, has_authenticated_execute = true.
--     The guard calls current_user_org_ids() as the INVOKER. If
--     authenticated ever loses EXECUTE on it, this trigger starts raising
--     42501 instead of LG009 for every vendor write that touches a
--     guarded column, and the error will look like a permissions bug
--     somewhere else entirely.
--
--     SELECT p.proname,
--            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS has_authenticated_execute
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname = 'current_user_org_ids';
--
-- =====================================================================
