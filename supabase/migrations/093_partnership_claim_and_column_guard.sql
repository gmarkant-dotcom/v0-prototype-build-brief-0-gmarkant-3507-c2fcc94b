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
--   >>> A caller acting as the VENDOR on a partnership may change exactly
--   >>> five columns - status, accepted_at, updated_at,
--   >>> payment_terms_requests and vendor_org_id - plus profile_status on
--   >>> the claim transition only. EVERY OTHER COLUMN IS REFUSED WITH
--   >>> LG009, INCLUDING COLUMNS THAT DO NOT EXIST YET. See THE SHAPE and
--   >>> THE RECONCILIATION below.
--
--   >>> contact_name, company_name, phone and website ARE GUARDED. They
--   >>> were briefly left permitted while the question was open; Greg
--   >>> ruled on 2026-08-25 and RULED-093-1 records the reasoning. The
--   >>> lead-agency path exits ABOVE the permit list, so guarding them
--   >>> forecloses nothing about the parked "agency edits ghost contact
--   >>> details" item.
--
--   >>> THE GUARDED SET IS RECONCILED AGAINST THE LIVE TABLE, 24 columns
--   >>> queried 2026-08-21, NOT against the migration files. The first
--   >>> draft was derived from the files and named two columns that do
--   >>> not exist on this table. See (b) in THE RECONCILIATION.
--
--   POLICIES ADDED: NONE. DROPPED: NONE. Count UNCHANGED (117 on 08-25).
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
-- >>> BORROWED. THIS FILE GUARDS NINETEEN OF THE TWENTY-FOUR LIVE
-- >>> COLUMNS, ALL TWENTY-FOUR EXIST TODAY, AND FIVE OF THEM ARE
-- >>> WRITTEN BY LIVE VENDOR SESSIONS EVERY DAY. The risk is the
-- >>> OPPOSITE direction from a hole: a column a vendor legitimately
-- >>> writes, left off the list, is a write that STARTS RAISING LG009
-- >>> ON APPLY. That is why the list is reconciled against THE LIVE
-- >>> TABLE below rather than derived from the migration files, and why
-- >>> the test exercises the live vendor writers individually rather
-- >>> than as a group.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE
-- 612 and an explicit COMMIT; on LINE 860. Those are the
-- only EXECUTABLE occurrences of either word.
--
-- TO DRY RUN: change the COMMIT; on line 860 to ROLLBACK; and run
-- the whole file. Every statement executes, every error surfaces,
-- nothing persists. Verify the line numbers before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/093_partnership_claim_and_column_guard.sql
--
-- THAT GREP RETURNS THREE HITS, AND THREE IS CORRECT:
--     612  BEGIN;    <- executable. The transaction.
--     695  BEGIN     <- plpgsql, partnerships_guard_identity_columns's
--                       body. No semicolon; matched by the
--                       case-insensitive form only, not a transaction
--                       statement.
--     860  COMMIT;   <- executable. Change this one to ROLLBACK; to dry
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
-- LIVE column list, column by column, below. The four that make this worth
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
-- THE RECONCILIATION: THE LIVE TABLE AGAINST THE GUARDED SET
-- =====================================================================
--
-- >>> THE COLUMN LIST BELOW WAS QUERIED FROM THE LIVE DATABASE ON
-- >>> 2026-08-21 AND IS AUTHORITATIVE. TWENTY-FOUR COLUMNS.
--
-- THE FIRST VERSION OF THIS BLOCK WAS DERIVED FROM THE MIGRATION FILES AND
-- IT WAS WRONG. It listed twenty-six columns, two of which do not exist on
-- this table at all. The mistake is worth naming because it is repeatable:
-- migration 061 carries TWO `ALTER TABLE` statements, and the ADD COLUMN
-- lines were read without checking which one they belonged to. 061:13-14
-- adds `profile_status` to `partnerships`; 061:21-23 adds `pool_status` and
-- `domain_match_profile_id` to `rfp_magic_tokens`. A migration file says
-- what was INTENDED at one moment. Only the database says what is there.
--
-- ---------------------------------------------------------------------
-- WHICH DIRECTION AN INVENTORY ERROR HURTS, UNDER **THIS** MECHANISM
--
-- For a DENY list, a live column nobody inventoried is UNGUARDED - a gap a
-- later migration closes.
--
-- 093 IS NOT A DENY LIST. The guard subtracts the permit list from the row
-- on both sides (`to_jsonb(OLD) - v_permitted`), so a column nobody
-- inventoried is REFUSED, not admitted. The uninventoried column therefore
-- lands in the OTHER direction: not a gap, A LIVE BREAKAGE THE MOMENT 093
-- APPLIES.
--
-- That inverts which mistake to fear here, and it points the same way the
-- asymmetry rule does: WHERE THE EVIDENCE IS AMBIGUOUS, PERMIT, AND RECORD
-- AN OPEN ITEM. A column left permitted is a known gap somebody can close
-- with a one-line migration. A column wrongly refused is a customer whose
-- save button stopped working, with no error anybody reads.
--
-- It also means (c) below being EMPTY is reassuring but is not the thing
-- protecting us. What protects us is that the permit list is SHORT and
-- every entry on it is justified by a named writer or a named ruling.
--
-- ---------------------------------------------------------------------
-- (a) EVERY LIVE COLUMN, AND ITS DISPOSITION.  24 of 24 accounted for.
--
--   COLUMN                            DISPOSITION       WHY
--   --------------------------------  ----------------  ------------------
--   id                                GUARDED-BY-093    primary key
--   lead_org_id                       GUARDED-BY-087    immutable, 087:606
--   vendor_org_id                     PERMITTED-093     see THE ONE THAT
--                                     + GUARDED-BY-087  READS LIKE A
--                                                       CONTRADICTION
--   status                            PERMITTED-093     W1 accept, W2 decline
--   invitation_message                GUARDED-BY-093    the agency's message
--   invited_at                        GUARDED-BY-093    agency timestamp
--   accepted_at                       PERMITTED-093     W1 accept
--   created_at                        GUARDED-BY-093    immutable by convention
--   updated_at                        PERMITTED-093     W2, W4, W5
--   partner_email                     GUARDED-BY-093    THE PRE-CLAIM
--                                                       IDENTIFIER. It is the
--                                                       right-hand side of the
--                                                       claim policy this file
--                                                       is fixing. A vendor
--                                                       rewriting it rewrites
--                                                       who may claim the row.
--   nda_confirmed_at                  GUARDED-BY-093    THE AGENCY CONFIRMS
--                                                       THE NDA. A vendor
--                                                       writing it confirms
--                                                       its own.
--   nda_confirmed_by                  GUARDED-BY-093    same
--   partnership_notes                 GUARDED-BY-093    the agency's private
--                                                       notes; holds the
--                                                       {blacklisted} flag
--   msa_confirmed_at                  GUARDED-BY-093    THE AGENCY CONFIRMS
--                                                       THE MSA
--   msa_confirmed_by                  GUARDED-BY-093    same
--   payment_terms_requests            PERMITTED-093     W3, the rate request
--   profile_status                    PERMITTED-093     W4, W5 - BUT ONLY ON
--                                     ON THE CLAIM      THE CLAIM TRANSITION.
--                                     TRANSITION        It also holds
--                                                       'removed', which is
--                                                       how an agency hides a
--                                                       row from its own pool
--                                                       (063), so a CLAIMED
--                                                       vendor writing it
--                                                       could delete itself
--                                                       from the agency's view
--                                                       of its own network.
--   invitation_sent_at                GUARDED-BY-093    agency timestamp (063)
--   reliability_summary               GUARDED-BY-093    the cached AI
--                                                       performance narrative
--                                                       the AGENCY reads. A
--                                                       vendor writing it
--                                                       authors its own
--                                                       delivery record.
--   reliability_summary_generated_at  GUARDED-BY-093    same
--   contact_name                      GUARDED-BY-093    RULED 2026-08-25.
--   company_name                      GUARDED-BY-093    No vendor writer, and
--   phone                             GUARDED-BY-093    permitting would let a
--   website                           GUARDED-BY-093    vendor rename itself
--                                                       inside the agency's own
--                                                       pool record and put a
--                                                       vendor-controlled URL
--                                                       in a trusted agency
--                                                       surface. See RULED-093-1.
--   ANY COLUMN ADDED AFTER THIS       GUARDED-BY-093    refused from the
--                                                       moment it exists, with
--                                                       no edit to the
--                                                       function
--
--   FINAL COUNTS AGAINST THE LIVE 24:
--     PERMITTED-093        5   status, accepted_at, updated_at,
--                              payment_terms_requests, vendor_org_id
--     PERMITTED ON THE
--     CLAIM TRANSITION     1   profile_status  (guarded at every other time)
--     GUARDED-BY-093      17   everything else except lead_org_id
--     GUARDED-BY-087       1   lead_org_id
--                        ----
--                          24   5 + 1 + 17 + 1 = 24. No column is unaccounted
--                               for, and none is counted twice: profile_status
--                               is listed once, on the conditional line.
--
--   vendor_org_id is counted under PERMITTED-093 and is ALSO constrained by
--   087. That is the one row in this table that carries two dispositions,
--   and it is deliberate - see THE ONE THAT READS LIKE A CONTRADICTION.
--
-- ---------------------------------------------------------------------
-- THE ONE THAT READS LIKE A CONTRADICTION: vendor_org_id
--
-- It is on the PERMIT list AND it is the column 087 constrains hardest.
-- Both are true and together they are the claim path, which is the only
-- reason this table has a policy letting a caller write a row they do not
-- yet own.
--
--   093's permit list says: MOVING THIS COLUMN IS NOT, BY ITSELF, THE KIND
--   OF WRITE THIS GUARD REFUSES. Without that, the claim - the one write a
--   vendor makes before they own the row - would raise LG009 and the whole
--   invitation flow would stop.
--
--   087's four refusals say: BUT ONLY IN ONE DIRECTION, ONCE, AND ONLY TO
--   AN ORGANIZATION THAT CAN PROVE IT OWNS THE ADDRESS. It cannot be
--   cleared once set (087:621-627). It cannot be repointed once set
--   (087:632-638). And a NULL -> value write must satisfy
--   org_has_member_with_email(NEW.vendor_org_id, NEW.partner_email)
--   (087:642-648).
--
-- 087's checks run FIRST, in the same function, above the permit list. So
-- "permitted" here means "not refused by the permit list"; it never means
-- "unchecked". The narrow gate 087 built is the only way through, and this
-- migration widens it by exactly nothing.
--
-- ---------------------------------------------------------------------
-- (b) IN THE ORIGINAL INVENTORY, NOT ON THE LIVE TABLE.  Both removed.
--
--   pool_status               NOT A COLUMN ON partnerships. Added by
--                             061:21-23 to `rfp_magic_tokens`.
--   domain_match_profile_id   NOT A COLUMN ON partnerships. Added by the
--                             same statement, 061:21-23, to
--                             `rfp_magic_tokens`.
--
-- Both were harmless to the MECHANISM - `jsonb - 'no_such_key'` is a no-op,
-- so a phantom in the deny narrative refuses nothing and breaks nothing.
-- They were not harmless to the DOCUMENT: they were the evidence that this
-- block had been derived from the wrong source, and one of them reached
-- docs/093-preapply-test.sql, where T4 wrote it and the assertion failed
-- with 42703 undefined_column. THE TEST CAUGHT IT. That is what the test
-- is for.
--
-- ---------------------------------------------------------------------
-- (c) ON THE LIVE TABLE, MISSING FROM THE ORIGINAL INVENTORY.
--
--   NONE. All 24 live columns were present in the 26-row inventory.
--
-- Checked by set difference against the live list, not by reading down two
-- columns of text. Stated as a result rather than an absence of findings,
-- because "I did not notice any" and "the difference is empty" are
-- different claims and only the second one is this.
--
-- ---------------------------------------------------------------------
-- RULED-093-1. THE FOUR GHOST-CONTACT COLUMNS ARE GUARDED. Greg, 2026-08-25.
--
--   contact_name, company_name, phone, website  (migration 068:9-12)
--
-- These hold the imported contact details of a ghost vendor - a row created
-- for somebody who has no Ligament account yet. They were left PERMITTED in
-- the first draft of this file, on the reasoning that "ghost contact details
-- not editable post-import" is a parked product item and a migration is the
-- wrong place to foreclose one. THAT REASONING WAS WRONG ON ITS OWN TERMS,
-- and the ruling says why:
--
--   1. GUARDING FORECLOSES NOTHING. The parked item is about the AGENCY
--      being able to edit these details, and the agency never reaches the
--      permit list: an agency session returns at EXIT 3, above it. So the
--      parked item is untouched either way, and the whole basis for leaving
--      them permitted evaporates.
--
--   2. THE COST IS ASYMMETRIC. Guarding now is one permit-list removal and
--      one assertion flip. Guarding later is a second migration against
--      partnerships, a second pre-apply cycle, and a second window in which
--      the hole is open. Nothing about the parked item is made harder by
--      doing it now.
--
--   3. PERMITTING HAS A REAL COST, not merely a theoretical one. A vendor
--      could rename ITSELF inside the agency's own pool record, without the
--      agency knowing: app/api/agency/pool/[partnerId]/route.ts:239 renders
--      partnerships.contact_name as the fallback for a missing full_name, so
--      the agency's own view of who it is dealing with becomes
--      vendor-controlled. And `website` puts a VENDOR-CONTROLLED URL inside a
--      TRUSTED AGENCY SURFACE, which is a different and worse class of thing
--      than a wrong name.
--
-- WHAT THE CODE SHOWS, unchanged from the first draft and still the reason
-- this needed a ruling rather than a lookup:
--
--   * NOTHING EDITS THEM POST-IMPORT TODAY. lib/server/partner-pool-import.ts
--     :277-280 writes each one ONLY when the existing value is blank
--     (`if (!existing.contact_name && row.contactName)`). The parked item is
--     already implemented, in application code, as "fill blanks, never
--     overwrite".
--   * lib/award-partnership-resolution.ts:216 writes contact_name on the
--     award path. Service role.
--   * Both are service-role callers and pass at EXIT 2, above the permit
--     list. Guarding does not touch them.
--   * There is still NO session-client writer of any of the four, on either
--     side. Guarding breaks nothing that exists.
--
-- ASSERTION T17 IN docs/093-preapply-test.sql PROVES THEY ARE REFUSED, with
-- LG009 specifically. T12 covers the agency side - read its own text for
-- what that does and does not demonstrate.
--
-- =====================================================================
-- WHY REMOVAL IS SYMMETRIC WITH ADDITION, AND WHERE IT IS NOT
-- =====================================================================
--
-- Taking a name OFF v_vendor_permitted is supposed to make that column
-- guarded, by omission, with no other edit. That is a claim about jsonb
-- subtraction, not an intention, so here is the mechanism spelled out. It
-- matters because a column that is silently NOT guarded after being removed
-- is a hole that reads as closed.
--
--   `to_jsonb(OLD)` ON A RECORD EMITS EVERY ATTRIBUTE, INCLUDING NULL ONES.
--   A SQL NULL becomes the JSON value `null`; the key is PRESENT with a null
--   value, not absent. The canonical documentation example is
--   `to_jsonb(row(1,'foo',null))` -> `{"f1":1,"f2":"foo","f3":null}`, and the
--   existence of jsonb_strip_nulls() is the other half of the proof: a
--   function whose whole job is removing null-valued keys would have nothing
--   to do if they were never emitted.
--
--   `jsonb - text[]` deletes the named keys if present and is a no-op for a
--   name that is not a key. So a name removed from the array simply stops
--   being deleted, and the key returns to BOTH v_old_rest and v_new_rest.
--
--   jsonb equality is structural over the canonicalized binary form. Key
--   ORDER is not significant, so the comparison cannot be perturbed by the
--   order columns happen to be emitted in.
--
-- THE THREE NULL CASES, WHICH ARE THE ONES WORTH CHECKING:
--
--   NULL -> value   `null` vs `"x"`. Two different jsonb scalars. DETECTED.
--   value -> NULL   `"x"` vs `null`. Same, in reverse.            DETECTED.
--   NULL -> NULL    `null` vs `null`. Equal.                  NOT detected,
--                   which is correct: nothing moved.
--
-- So the equality test at EXIT 1 is exactly as sensitive for a column that
-- is NULL as for one that is not, and removal IS symmetric with addition
-- for it. The same holds for the v_moved diagnostic below: because every
-- key is present on both sides, `v_new_rest -> k` never returns SQL NULL,
-- and `IS DISTINCT FROM` degenerates to `<>` while remaining correct if a
-- future column somehow is absent.
--
-- >>> VERIFIED BY READING THE DOCUMENTED SEMANTICS, NOT BY EXECUTION. This
-- >>> session has no database. Assertion T20 in the pre-apply test exercises
-- >>> the value -> NULL direction against a real row, so the claim is proved
-- >>> empirically on Greg's run rather than resting on this comment.
--
-- WHERE IT IS **NOT** SYMMETRIC, and this is the part worth carrying
-- forward:
--
--   THE DIRECTION OF DANGER FLIPS. A name ADDED in error permits a column
--   nobody meant to permit - a hole, silent, and it looks exactly like a
--   correct file. A name REMOVED in error refuses a column something
--   legitimately writes - a breakage, loud, and it surfaces the first time
--   that writer runs. The second is worse to ship and far easier to notice,
--   which is why the test's permitted-direction assertions (T1-T5) are the
--   most urgent ones in the file.
--
--   THE COST OF EXIT 1 MOVES. With four fewer permitted columns, a write
--   that touches one of them no longer leaves at EXIT 1; it falls through to
--   EXIT 2, which calls auth.uid(), and possibly EXIT 3, which issues a
--   query. Adding a column to the list can only make the guard cheaper;
--   removing one can only make it dearer. In practice this costs nothing
--   today, because the only writers of these four are service-role callers
--   that stop at EXIT 2 without a query.
--
--   A MISSPELLED NAME BEHAVES DIFFERENTLY IN EACH DIRECTION. Adding a name
--   that is not a column is a silent no-op that permits nothing. Removing a
--   name that is not on the list is also a silent no-op. But FORGETTING to
--   remove one leaves a column permitted, and there is no error either way -
--   which is why THE RECONCILIATION above is a table of all 24 columns with
--   a stated final count, rather than a diff.
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
  -- THE PERMIT LIST. THE ONLY PLACE IT EXISTS IN THIS FUNCTION.
  -- Reconciled against the LIVE 24-column table on 2026-08-21, not against
  -- the migration files - see THE RECONCILIATION in this file's header.
  --
  -- FIVE ENTRIES, EACH WITH A NAMED VENDOR-SESSION WRITER: W1, W2, W3, W4
  -- and W5 in the header. Nothing is on this list without one.
  --
  -- contact_name, company_name, phone and website WERE briefly here, left
  -- permitted while OPEN-093-1 was open. GREG RULED ON 2026-08-25: guard
  -- them. They are gone from this array and are therefore guarded by
  -- omission - see WHY REMOVAL IS SYMMETRIC WITH ADDITION in the header for
  -- why that is a fact about jsonb subtraction and not a hope.
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
    v_permitted := v_permitted || ARRAY['profile_status'];
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
  -- >>> named in THE RECONCILIATION write partnership_notes and profile_status
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
            'partnerships.%s may not be written by the vendor on the partnership. Migration 093 guards every column on this table except %s, plus profile_status on the claim transition. The lead agency, the service role, a database function and a migration may all write the rest.',
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
  'caller with an end-user session who is not a member of lead_org_id may change only five '
  'columns - status, accepted_at, updated_at, payment_terms_requests and vendor_org_id - '
  'plus profile_status on the claim transition; every other column - id, invitation_message, '
  'invited_at, created_at, partner_email, nda_confirmed_at, nda_confirmed_by, '
  'partnership_notes, msa_confirmed_at, msa_confirmed_by, invitation_sent_at, '
  'reliability_summary, reliability_summary_generated_at, contact_name, company_name, phone, '
  'website, AND ANY COLUMN ADDED LATER - is refused with LG009. The four contact columns are '
  'guarded per Greg''s ruling of 2026-08-25 (RULED-093-1): guarding forecloses nothing, '
  'because the lead agency exits above this list, and permitting would let a vendor rename '
  'itself inside the agency''s own pool record and put a vendor-controlled URL in a trusted '
  'agency surface. vendor_org_id is on this '
  'list AND is the column half one constrains hardest; that is not a contradiction, it is the '
  'claim path, and half one runs first. The list lives in v_vendor_permitted and nowhere '
  'else; the comparison is to_jsonb(NEW) - permitted against to_jsonb(OLD) - permitted, so a '
  'new column is guarded from the moment it exists with no edit to this function. IT COMPARES '
  'VALUES, NEVER THE SET CLAUSE, which is what lets a whole-row read-modify-write pass when '
  'only a permitted column moved. Half two exempts the service role, database functions and '
  'migrations (auth.uid() IS NULL) and the lead agency (OLD.lead_org_id IN '
  'current_user_org_ids()) - EXEMPT IS NOT PERMITTED, which is why partnership_notes is '
  'written by the pool-import service path and is still not on the list. THE GUARDED SET IS '
  'RECONCILED AGAINST THE LIVE 24-COLUMN TABLE, not against the migration files: an earlier '
  'draft was derived from the files and named pool_status and domain_match_profile_id, which '
  'migration 061 puts on rfp_magic_tokens and not on this table at all. IT EXISTS BECAUSE '
  '"Partners can update partnership status" RESTRICTS NO COLUMN DESPITE ITS NAME: RLS has no '
  'column granularity and a WITH CHECK has no OLD. DO NOT AMEND THIS TO LET THE VENDOR '
  'THROUGH ON A WIDER SET - a column joins v_vendor_permitted only when a real vendor-session '
  'writer needs it, or a ruling puts it there, in the same commit, with THE RECONCILIATION in '
  '093''s header updated. Reconciled against the live table on 2026-08-21; writers W1 to W5.';

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
--     EXPECTED: 6 on partnerships; public_total EQUAL TO WHAT YOU CAPTURED BEFORE APPLYING (117 was true on 2026-08-25; 099 has since added policies, so 117 is now WRONG).
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
