-- =====================================================================
-- Migration 082: partner_vouches stops handing the whole vouch graph to
--                anyone holding the anon key.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. Greg runs this in the Supabase SQL Editor.
--
-- THIS FILE HAS TWO PHASES AND A STOP GATE BETWEEN THEM.
-- PHASE 1 IS SAFE TO APPLY TODAY. PHASE 2 IS NOT, UNTIL THE VOUCH COUNTS
-- ARE CONFIRMED RENDERING THROUGH THE RPCs IN PRODUCTION.
--
-- STATUS 2026-08-17: the code change that step 2 of "THE ORDER OF
-- OPERATIONS" demanded IS DEPLOYED (lib/vouch-counts.ts and its three
-- counting call sites, on `main`). It was written to tolerate this migration
-- being unapplied, so it is live and correct against today's database. The
-- STOP GATE below is STILL LIVE: what remains before phase 2 is applying
-- phase 1 and watching the numbers render through the RPC path.
--
-- STATUS 2026-08-19: STILL NOT APPLIED, and confirmed so against the live
-- database - neither `partner_vouch_count` nor `partner_vouch_counts`
-- exists, and `partner_vouches` still carries exactly the three policies
-- named below. This file was REPAIRED on this date: it was authored before
-- 079 and, as written, could not be applied against the post-079 schema.
-- See "079 SEAM. CLOSED." below for what was wrong and what changed. No
-- phase of it has been run.
--
-- Read "THE ORDER OF OPERATIONS" below before running any of it.
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- THE EXPOSURE TODAY, STATED PLAINLY
-- ---------------------------------------------------------------------
-- From docs/schema-snapshot-2026-08-13.md, the authoritative record:
--
--   partner_vouches  "Anyone can count vouches"
--     SELECT  {public}  USING (true)
--
-- The migration that created it (scripts/053, per
-- docs/milestone-attribution-map.md section 4) carries the comment "Count
-- queries are safe (no identifying info)". That is true of the NUMBER and
-- false of the TABLE.
--
-- A policy grants access to ROWS. It cannot grant access to an aggregate.
-- `USING (true)` for role `public` - which includes `anon` - means any
-- caller holding the publishable anon key, which every visitor to
-- withligament.com is served, can run
--
--     select lead_org_id, vendor_org_id from partner_vouches
--
-- and read the complete who-vouched-for-whom graph of the entire platform.
-- Not a count. The edges, with both endpoints.
--
-- The application has never surfaced this because the application asks for
-- a count at three of its four read sites, and the fourth reads only rows
-- the caller wrote (all four are listed below). But the policy, not the
-- caller, is the permission. This is the same class of defect as an
-- interface-only gate, and it is live right now.
--
-- What it discloses: which lead agencies rate which vendors, for every
-- customer at once. That is a competitive-intelligence dataset about
-- Ligament's customers, assembled by Ligament, published by accident.
--
-- ---------------------------------------------------------------------
-- WHAT THE FIX CLOSES, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------
-- CLOSES: row access. After phase 2 nobody reads a `lead_org_id`
-- except the company that wrote it. The count survives, delivered as a
-- projection by a SECURITY DEFINER function rather than by granting row
-- access and trusting every caller to aggregate. A count is a projection;
-- do not ship it as a table scan.
--
-- Two further tightenings ride along, both stated rather than smuggled:
--
--   * The count functions are executable by `authenticated` only, not by
--     `anon`. Today an anonymous visitor can count. After this they cannot.
--     If the public marketplace ever needs an anonymous count, that is a
--     GRANT and a decision, not a policy.
--
--     THIS TAKES TWO STATEMENTS, NOT ONE. `pg_default_acl` in this database
--     carries two rows for functions in schema `public` - one granted by
--     `postgres`, one by `supabase_admin` - and BOTH contain `anon=X`. So
--     `CREATE FUNCTION` grants `anon` EXECUTE DIRECTLY, and `REVOKE ... FROM
--     PUBLIC` is a no-op against a direct grant. 087 proved this against the
--     live database and needed the same explicit `REVOKE ... FROM anon`; see
--     087:16-23. Both functions below take arguments, so without it each is
--     an oracle any holder of the publishable key can interrogate one vendor
--     id at a time - which is the whole exposure this file exists to close,
--     re-opened through the door the fix walked in by.
--
--   * The INSERT and DELETE policies need nothing here. 079 already
--     recreated both `TO authenticated` with a membership predicate
--     (079:1455-1461), and the live database confirms that shape. Phase 2
--     therefore ASSERTS them rather than re-authoring them. Two migrations
--     must not both claim authorship of one policy; the later one would win
--     by accident rather than by decision.
--
-- DOES NOT CLOSE, AND MUST NOT BE MISTAKEN FOR IT:
--
--   * BLIND TWO-WAY VOUCHING IS RULED BUT NOT BUILT. The ruled product is
--     mutual: each side vouches without seeing whether the other has, and
--     the pairing is revealed only when both have. Nothing in this table
--     supports that - it has one direction, one row, no reveal state, and
--     no notion of a vendor vouching back.
--   * WHEN IT IS BUILT, THIS TABLE GAINS A PERSON. 079 already made it
--     company-to-company - `lead_org_id` IS the organization key now - so
--     what the ruled model still needs is a separate `voucher_member_id`,
--     because the COMPANY vouches and a PERSON presses the button, and
--     colleagues need to know which person. That is a different table from
--     this one.
--
-- **THIS MIGRATION IS A CONTAINMENT MEASURE, NOT THE FINAL SHAPE.** It
-- stops a live disclosure. It does not design the feature.
--
-- ---------------------------------------------------------------------
-- 079 SEAM. CLOSED. THIS FILE IS POST-079 THROUGHOUT.
-- ---------------------------------------------------------------------
-- `partner_vouches` was one of the seven two-column tables. At 079:674-675
-- `voucher_agency_id` became `lead_org_id` and `vouched_partner_id` became
-- `vendor_org_id`, and at 079:991-992 both became NOT NULL. 079 IS APPLIED.
-- Every executable statement below names the POST-079 columns. There is no
-- "079:" deferral left in the body of this file.
--
-- WHAT WAS WRONG BEFORE THIS EDIT, STATED SO IT IS NOT RE-INTRODUCED. The
-- file was authored pre-079 and carried the renames as notes rather than as
-- code. That was not a cosmetic lag, it was two live defects:
--
--   * `partner_vouch_counts()` declared `RETURNS TABLE (vouched_partner_id
--     uuid, ...)` while lib/vouch-counts.ts:153-154 reads `vendor_org_id`
--     off the result. Applying phase 1 unfixed would have left every key in
--     that map `undefined` and every marketplace vouch count reading 0 -
--     the exact silent zero the STOP GATE exists to prevent, arriving
--     through a different door and surviving the STOP GATE untouched,
--     because it does not need phase 2 to happen.
--   * Phase 2 recreated the write policies against `voucher_agency_id`, a
--     column that has not existed since 079. That would have raised 42703
--     mid-transaction. Loud, and therefore the lesser of the two.
--
-- The colleague-scoped SELECT policy created in phase 2 is now keyed on
-- `lead_org_id IN (SELECT public.current_user_org_ids())` - membership, not
-- `auth.uid()`. That is the "visible to colleagues" half of the ruling
-- resolving through membership exactly as the original 079 note promised,
-- and it is character-for-character the predicate 079 gave the two write
-- policies on this same table.
--
-- ---------------------------------------------------------------------
-- THE ORDER OF OPERATIONS. GETTING THIS WRONG IS A SILENT ZERO.
-- ---------------------------------------------------------------------
-- Dropping the `USING (true)` policy does NOT make the three counting call
-- sites fail. It makes them return **0**. PostgREST filters the rows out
-- and reports the count of what survived, which is nothing. No error, no
-- log line, no 500 - every vouch badge in the product silently reads zero.
--
-- So:
--
--   1. APPLY PHASE 1 of this file. It only creates two functions. Nothing
--      reads them yet and nothing changes.
--
--   2. DEPLOY A CODE CHANGE moving all three COUNTING read sites onto the
--      RPCs.
--
--      **THIS STEP IS DONE. It shipped on `main` on 2026-08-17, BEFORE
--      phase 1 was applied, and it is safe in that order.** All three
--      counting sites now go through `lib/vouch-counts.ts`:
--
--        a. app/api/marketplace/discoverable/route.ts:105 -> fetchVouchCounts()
--        b. app/partner/profile/page.tsx:225              -> fetchVouchCount()
--        c. app/agency/pool/[partnerId]/page.tsx:240      -> fetchVouchCount()
--
--      THERE IS A FOURTH READER AND IT IS NOT A COUNT:
--
--        d. app/agency/pool/[partnerId]/page.tsx:249-253  -> direct row read
--
--      It is the "have I vouched?" check. It selects `id` where
--      `lead_org_id IN callerOrgIds AND vendor_org_id = partnerId`, with
--      `callerOrgIds` coming from `resolveCallerOrgIds()`
--      (lib/entitlements.ts:156) one statement earlier. It reads ROWS, so no
--      RPC replaces it and none should: it asks about the caller's own
--      vouches, which is precisely what a caller is entitled to see. Its
--      replacement read path is the phase-2 SELECT policy, whose predicate
--      is the server-side twin of that client-side filter -
--      `lead_org_id IN (SELECT public.current_user_org_ids())` against
--      `resolveCallerOrgIds`'s `org_members` lookup for the same user. All
--      four readers are session-authenticated; the repository has no anon
--      reader of this table anywhere.
--
--      Those two helpers call the RPC and fall back to the old direct
--      table read ONLY when PostgREST answers PGRST202, "could not find
--      the function in the schema cache". That is the one condition under
--      which the pre-082 read is still the right answer, and it is exactly
--      the state production is in until phase 1 runs. Any OTHER rpc error -
--      a permission failure in particular - is logged and returns 0 rather
--      than falling back, because falling back on a permission error is how
--      a post-phase-2 silent zero gets reintroduced.
--
--      So the deployed code is correct in all three states: RPC absent
--      (fallback reads the table, which `USING (true)` still permits), RPC
--      present with the old policy still there (RPC used), and RPC present
--      with the old policy dropped (RPC used). Phase 1 and the deploy are
--      therefore order-independent. Phase 2 is NOT.
--
--      Reader (d) above does NOT change and needs no deploy. Phase 2's
--      colleague-scoped policy permits exactly the rows it asks for.
--
--   3. CONFIRM in production that the vouch counts still render, before
--      touching phase 2. A wrong count after phase 2 is indistinguishable
--      from a vendor with no vouches.
--
--      With the fallback in place, this confirmation is now a check that
--      the RPC path itself works, not that the code deployed. Confirm it
--      AFTER phase 1 and BEFORE phase 2, and confirm it by watching the
--      numbers, not the absence of errors - the fallback is silent when it
--      succeeds.
--
--   4. APPLY PHASE 2.
--
--   5. DELETE THE FALLBACK. Both blocks in lib/vouch-counts.ts are marked
--      `082-FALLBACK`. After phase 2 the fallback can never succeed - the
--      policy it depended on is gone - so leaving it in place turns a
--      would-be loud PGRST202 into a quiet 0. Removing it is the last step
--      of this rollout, and it is one file.
--
-- Phase 1 and phase 2 are separate transactions on purpose. Do not paste
-- this file into the SQL editor as one block.
--
-- ---------------------------------------------------------------------
-- CAPTURE A FRESH pg_policies SNAPSHOT IMMEDIATELY BEFORE PHASE 2
-- ---------------------------------------------------------------------
-- Phase 2 DROPS ONE POLICY BY ITS LIVE NAME: "Anyone can count vouches".
-- A DROP that matches nothing reports success, and here the failure mode is
-- the worst available: the new restrictive SELECT policy would be created
-- BESIDE the surviving `USING (true)` one, RLS would OR them together, and
-- the whole graph would still be public while the fix looked applied.
--
--   SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--   ORDER BY policyname;
--
-- CONFIRMED 2026-08-19 against the live database. Exactly three rows, and
-- these are the names to expect:
--
--   Agencies can remove their vouch          DELETE  {authenticated}
--   Agencies can vouch                       INSERT  {authenticated}
--   Anyone can count vouches                 SELECT  {public}  USING (true)
--
-- The first two are 079's, and phase 2 leaves them alone. The third is the
-- exposure, and it is the only read policy on the table - which is why the
-- SELECT policy phase 2 creates is not optional garnish. Drop the third
-- without creating a replacement and reader (d) has ZERO read access, not
-- reduced access.
--
-- If "Anyone can count vouches" does not appear EXACTLY as written, stop and
-- regenerate this file. If either write policy has drifted from the shape in
-- V2 of the phase 2 verification, stop for a different reason: phase 2 no
-- longer repairs them.
--
-- =====================================================================


-- =====================================================================
-- PHASE 1. Safe to apply today. Creates two functions, changes nothing.
-- =====================================================================

BEGIN;

-- The count for one vendor.
--
-- SECURITY DEFINER because the whole point is that the CALLER cannot read
-- these rows. STABLE because it does not write. `SET search_path = public,
-- pg_temp` is not optional: migration 078 exists precisely because a
-- SECURITY DEFINER function in this codebase shipped with proconfig NULL
-- and resolved unqualified names against the caller's search_path.
--
-- POST-079. The predicate names `vendor_org_id`, the live column, and the
-- argument is an ORGANIZATION id rather than a profile id.
--
-- THE PARAMETER NAME IS LOAD-BEARING AND DOES NOT FOLLOW THE COLUMN.
-- PostgREST matches RPC arguments BY NAME against the JSON body, and
-- lib/vouch-counts.ts:103 posts `{ p_partner_id: partnerId }`. Renaming this
-- parameter to `p_vendor_org_id` to match the column would be a tidier read
-- and would break every caller with PGRST202, which lib/vouch-counts.ts then
-- swallows into the 082-FALLBACK table read - silently correct before phase
-- 2 and silently zero after it. Leave it alone, or change both in one commit.
CREATE OR REPLACE FUNCTION public.partner_vouch_count(p_partner_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM public.partner_vouches v
  WHERE v.vendor_org_id = p_partner_id;
$$;

COMMENT ON FUNCTION public.partner_vouch_count(uuid) IS
  'Vouch count for one vendor. Returns a NUMBER and never a voucher identity. Exists so the '
  'count can survive without granting row access to partner_vouches. See migration 082.';

-- BOTH REVOKES ARE REQUIRED. `... FROM PUBLIC` does not remove the DIRECT
-- `anon` grant that `pg_default_acl` hands out at CREATE FUNCTION time. See
-- the second bullet of "WHAT THE FIX CLOSES" above, and 087:16-23 for the
-- query that proved it. V2 of the phase 1 verification asserts f, t.
REVOKE EXECUTE ON FUNCTION public.partner_vouch_count(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_vouch_count(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.partner_vouch_count(uuid) TO authenticated;

-- The counts for many vendors, for the marketplace listing, which needs
-- one number per row and must not make one round trip per card.
--
-- Vendors with zero vouches are simply absent from the result. The caller
-- treats a missing key as 0, which is what the JS aggregation at
-- app/api/marketplace/discoverable/route.ts:109 already does.
--
-- THE RETURNED COLUMN NAME IS THE ONE THIS FILE MOST HAD TO GET RIGHT.
-- lib/vouch-counts.ts:153-154 reads `row.vendor_org_id` off this result and
-- `continue`s on a falsy key. Declare it under any other name and the loop
-- skips every row, `fetchVouchCounts` returns an empty map, and each caller
-- reads its missing key as 0. No error, no log line: the marketplace simply
-- shows every vendor at zero vouches. It is declared `vendor_org_id` here,
-- matching both the live column and the reader.
--
-- Both body references below stay alias-qualified (`v.vendor_org_id`).
-- `RETURNS TABLE` makes `vendor_org_id` an OUT parameter, and in a
-- SQL-language function an UNQUALIFIED reference to a name that is both an
-- OUT parameter and a column raises 42702, "column reference is ambiguous".
-- The alias is what keeps it a column. Same reason the parameter is spelled
-- `p_partner_ids` rather than `partner_ids`.
CREATE OR REPLACE FUNCTION public.partner_vouch_counts(p_partner_ids uuid[])
RETURNS TABLE (vendor_org_id uuid, vouch_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.vendor_org_id, count(*)::bigint AS vouch_count
  FROM public.partner_vouches v
  WHERE v.vendor_org_id = ANY (p_partner_ids)
  GROUP BY v.vendor_org_id;
$$;

COMMENT ON FUNCTION public.partner_vouch_counts(uuid[]) IS
  'Vouch counts for a set of vendors, one row each. Returns NUMBERS and never a voucher '
  'identity. Vendors with no vouches are absent; the caller reads a missing key as 0.';

REVOKE EXECUTE ON FUNCTION public.partner_vouch_counts(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_vouch_counts(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.partner_vouch_counts(uuid[]) TO authenticated;

-- service_role IS DELIBERATELY NOT GRANTED HERE, AND THAT IS THE DIFFERENCE
-- FROM 087. 087 granted it explicitly because its helper is called from
-- inside a trigger that is NOT SECURITY DEFINER, so the helper executes as
-- the invoking role, and all three of its call paths are service-client
-- writes - an implicit default-ACL grant disappearing would have raised
-- 42501 from inside a trigger.
--
-- These two functions have no such caller. All four readers of
-- partner_vouches are session-authenticated (reader roster in "THE ORDER OF
-- OPERATIONS" above): two browser clients and one server route that builds
-- its client from the request cookies, never from the service key. Granting
-- service_role EXECUTE would widen a SECURITY DEFINER surface for no call
-- site, which is the opposite of what this file is for.
--
-- service_role therefore keeps whatever pg_default_acl gives it, which today
-- is EXECUTE, and the verification block below asserts that value rather
-- than pretending this file set it. IF A SERVICE-ROLE CALLER IS EVER ADDED,
-- add the explicit GRANT in the same commit - see 087:534-543 for why an
-- inherited grant is not a dependable one.

COMMIT;

-- ---------------------------------------------------------------------
-- PHASE 1 VERIFICATION. Run before going anywhere near phase 2.
-- ---------------------------------------------------------------------
--
-- V1. Both functions exist, are SECURITY DEFINER, and have a pinned
--     search_path. Expect 2 rows, prosecdef = t, provolatile = 's',
--     proconfig = {"search_path=public, pg_temp"}.
--
--     SELECT proname, prosecdef, provolatile, proconfig
--     FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN ('partner_vouch_count', 'partner_vouch_counts')
--     ORDER BY proname;
--
-- V2. THE GRANT ASSERTION. Both functions take arguments, so an executable
--     `anon` grant on either is an oracle: one vendor id per call, the count
--     back, no row access needed. `REVOKE ... FROM PUBLIC` alone does NOT
--     produce these values - the direct pg_default_acl grant survives it -
--     which is why each function above carries a second REVOKE naming `anon`.
--     This query is the check that the second REVOKE actually landed.
--
--     Expect f, t, t on each row.
--
--       SELECT 'partner_vouch_count' AS fn,
--              has_function_privilege('anon',          'public.partner_vouch_count(uuid)', 'EXECUTE') AS anon,
--              has_function_privilege('authenticated', 'public.partner_vouch_count(uuid)', 'EXECUTE') AS authenticated,
--              has_function_privilege('service_role',  'public.partner_vouch_count(uuid)', 'EXECUTE') AS service_role
--       UNION ALL
--       SELECT 'partner_vouch_counts',
--              has_function_privilege('anon',          'public.partner_vouch_counts(uuid[])', 'EXECUTE'),
--              has_function_privilege('authenticated', 'public.partner_vouch_counts(uuid[])', 'EXECUTE'),
--              has_function_privilege('service_role',  'public.partner_vouch_counts(uuid[])', 'EXECUTE');
--
--     EXPECTED: anon = f, authenticated = t, service_role = t, both rows.
--
--     A `t` under anon means the REVOKE FROM anon was dropped or the file was
--     applied from an older copy. Do not proceed to phase 2; re-run the two
--     REVOKE statements and re-check.
--
--     service_role = t is INHERITED from pg_default_acl, not set by this
--     file, and it is asserted rather than granted on purpose - see the
--     service_role note above COMMIT. An `f` there is not a defect of this
--     migration, but it does mean the default ACL has been tightened, and
--     the note above COMMIT becomes a required GRANT rather than a warning.
--
--     And the same thing read out of the acl string, which is how 087 states
--     it (087:686-693):
--
--       SELECT p.proname, p.proacl
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('partner_vouch_count', 'partner_vouch_counts');
--
--     EXPECTED: proacl contains authenticated=X/ and service_role=X/, with NO
--     bare =X/ entry (that is the PUBLIC grant) and NO anon=X/ entry.
--
-- V3. The returned column is named `vendor_org_id`. This is the assertion
--     that the 079 repair took; lib/vouch-counts.ts:153-154 reads exactly
--     this name and skips any row where it is absent.
--
--     SELECT pg_get_function_result(p.oid)
--     FROM pg_proc p
--     WHERE p.pronamespace = 'public'::regnamespace
--       AND p.proname = 'partner_vouch_counts';
--
--     EXPECTED, character for character:
--       TABLE(vendor_org_id uuid, vouch_count bigint)
--
--     `vouched_partner_id` here means the pre-079 copy of this file was
--     applied. Recreate both functions from THIS file before going near
--     phase 2 or the marketplace silently reads zero for every vendor.
--
-- V4. The function agrees with the table. Pick any vendor id that has at
--     least one vouch and expect the two numbers to match.
--
--     SELECT vendor_org_id, count(*) FROM public.partner_vouches
--     GROUP BY vendor_org_id ORDER BY 2 DESC LIMIT 5;
--
--     SELECT public.partner_vouch_count('<paste an id from above>');
--
-- V5. And the set form agrees with the same table, keyed under the name the
--     reader uses. Paste the same ids.
--
--     SELECT * FROM public.partner_vouch_counts(
--       ARRAY['<id>','<id>']::uuid[]);
--
--     EXPECTED: the column header reads `vendor_org_id`, and each count
--     matches V4.
--
-- ---------------------------------------------------------------------


-- =====================================================================
-- =====================================================================
--                          S T O P   G A T E
--
--   DO NOT RUN PHASE 2 UNTIL THE CODE CHANGE IN STEP 2 OF "THE ORDER OF
--   OPERATIONS" IS DEPLOYED AND THE VOUCH COUNTS ARE CONFIRMED RENDERING
--   IN PRODUCTION.
--
--   Running phase 2 first does not break the product loudly. It makes
--   every vouch count in it read zero, quietly, and a vendor with no
--   vouches looks exactly the same as a vendor whose count stopped
--   working.
--
--   The deployed code narrows this window but does not remove it. Its
--   fallback only fires on PGRST202 - "function not found" - so if phase 2
--   runs while phase 1 has NOT run, every count reads 0 exactly as
--   described above. Phase 1 first, always.
-- =====================================================================
-- =====================================================================


-- =====================================================================
-- PHASE 2. Removes the row exposure. Apply only after the STOP GATE.
-- =====================================================================

-- READ PATH CHECK BEFORE THE DROP. All four readers of this table are
-- accounted for, and none of them is left without one:
--
--   (a) marketplace/discoverable:105  count  -> partner_vouch_counts()  RPC, phase 1
--   (b) partner/profile:225           count  -> partner_vouch_count()   RPC, phase 1
--   (c) agency/pool/[partnerId]:240   count  -> partner_vouch_count()   RPC, phase 1
--   (d) agency/pool/[partnerId]:249   ROWS   -> the SELECT policy created below
--
-- (a)(b)(c) stop needing row access entirely: phase 1 gave them a projection.
-- (d) still needs rows and keeps them, narrowed from "every row on the
-- platform" to "the rows the caller's own organizations wrote". No reader
-- goes dark. THAT is what makes the drop below safe once the STOP GATE has
-- been cleared, and it is the only thing that does.

BEGIN;

-- The exposure itself. This is the one statement in this file that closes
-- the disclosure; everything else is scaffolding around it.
DROP POLICY IF EXISTS "Anyone can count vouches" ON public.partner_vouches;

-- The "visible to colleagues, anonymous to everyone outside" half of the
-- ruling, resolving through membership. This is the replacement read path
-- for reader (d), the "have I vouched?" check at
-- app/agency/pool/[partnerId]/page.tsx:249-253, which filters
-- `lead_org_id IN callerOrgIds` client-side. The predicate here is the
-- server-side twin of that filter: `resolveCallerOrgIds()` reads
-- `org_members` for `user.id`, and `current_user_org_ids()` (079:451) reads
-- `org_members` for `auth.uid()`. Same rows, one of them enforced.
--
-- It is also the same predicate 079 gave this table's two write policies
-- (079:1455-1461), so a caller can now read exactly the set of vouches they
-- are permitted to insert and delete. Read and write agree by construction
-- rather than by coincidence.
--
-- THE VENDOR IS NEVER A READER. No policy on this table matches
-- vendor_org_id, deliberately: anonymity to the subject is the feature, and
-- the vendor gets their own number through partner_vouch_count() without
-- ever touching a row.
CREATE POLICY "Vouchers read their own company vouches"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

-- THE TWO WRITE POLICIES ARE NOT TOUCHED, AND THIS IS A CHANGE FROM THE
-- PRE-079 DRAFT OF THIS FILE. That draft dropped and recreated both, to move
-- them from `public` to `authenticated`. 079 has since done that and more:
-- 079:557-558 dropped them and 079:1455-1461 recreated them `TO
-- authenticated` with `lead_org_id IN (SELECT public.current_user_org_ids())`,
-- which is both the role narrowing this file wanted and a membership
-- predicate it had no way to write. The live database carries exactly that
-- shape.
--
-- Re-authoring them here would recreate them from a file whose stated
-- purpose is the SELECT side, leaving two migrations claiming one policy and
-- the later one winning by accident. So phase 2 asserts them instead - see
-- V2 of the phase 2 verification. If that assertion fails, the fix belongs
-- in a migration that owns those policies, not in this one.

COMMIT;

-- =====================================================================
-- PHASE 2 VERIFICATION. Run each of these after COMMIT.
-- =====================================================================
--
-- V1. THE ONE THAT MATTERS. No policy on this table grants anything to
--     anon or public, and no policy has a `true` qual. Expect ZERO rows.
--     A row here means the exposure survived the fix.
--
--     SELECT policyname, cmd, roles, qual
--     FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--       AND (roles && ARRAY['anon', 'public']::name[] OR qual = 'true');
--
-- V2. Exactly three policies remain: one SELECT, one INSERT, one DELETE,
--     all to {authenticated}. Expect 3 rows, EXACTLY these:
--
--       Agencies can remove their vouch      DELETE  {authenticated}
--         qual       (lead_org_id IN ( SELECT current_user_org_ids() AS current_user_org_ids))
--       Agencies can vouch                   INSERT  {authenticated}
--         with_check (lead_org_id IN ( SELECT current_user_org_ids() AS current_user_org_ids))
--       Vouchers read their own company vouches  SELECT  {authenticated}
--         qual       (lead_org_id IN ( SELECT current_user_org_ids() AS current_user_org_ids))
--
--     SELECT policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--     ORDER BY cmd, policyname;
--
--     THE TWO WRITE ROWS ARE AN ASSERTION, NOT AN OUTCOME. This phase does
--     not create them; 079 did. They are listed so that a drift shows up
--     here rather than in a bug report. If either is missing, or is `TO
--     public`, or names `auth.uid()` instead of the membership predicate,
--     STOP - phase 2 did not cause it and must not be used to paper over it.
--     Note that pg_policies renders the predicate with the redundant column
--     alias shown above; that is Postgres deparsing the same expression, not
--     a difference.
--
-- V3. There is still no UPDATE policy, as before. Expect zero rows.
--
--     SELECT policyname FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--       AND cmd = 'UPDATE';
--
-- V4. Total policy count across the schema. One dropped, one created, so it
--     is UNCHANGED by phase 2. (The pre-079 draft of this file dropped three
--     and created three, which was also unchanged; the number is the same
--     for a different reason now.)
--
--     SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- V5. Live smoke test, in the browser. These are the read paths this
--     migration governs and none is covered by the queries above:
--       a. /partner/profile shows the vendor's own vouch count, non-zero
--          for a vendor known to have vouches.               reader (b)
--       b. /agency/pool/<partnerId> shows the count           reader (c)
--          AND the correct vouched / not-vouched button state. reader (d)
--       c. The marketplace listing shows per-vendor counts.   reader (a)
--
--     The button state in (b) is the ONLY live check of the new SELECT
--     policy, because it is the only reader that still reads rows. A count
--     that renders proves the RPCs; only the button proves the policy.
--
--     A zero where a number is expected means step 2 of the order of
--     operations was skipped, or that phase 1 was applied from the pre-079
--     copy of this file - check V3 of the phase 1 block before assuming the
--     former. Restore the old policy from the header of this file, fix the
--     cause, then re-apply phase 2.
-- =====================================================================
