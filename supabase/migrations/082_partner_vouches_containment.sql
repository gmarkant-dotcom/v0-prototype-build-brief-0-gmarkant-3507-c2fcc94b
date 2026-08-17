-- =====================================================================
-- Migration 082: partner_vouches stops handing the whole vouch graph to
--                anyone holding the anon key.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. Greg runs this in the Supabase SQL Editor.
--
-- THIS FILE HAS TWO PHASES AND A STOP GATE BETWEEN THEM.
-- PHASE 1 IS SAFE TO APPLY TODAY. PHASE 2 IS NOT, UNTIL A CODE CHANGE
-- SHIPS FIRST. Read "THE ORDER OF OPERATIONS" below before running any
-- of it.
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
--     select voucher_agency_id, vouched_partner_id from partner_vouches
--
-- and read the complete who-vouched-for-whom graph of the entire platform.
-- Not a count. The edges, with both endpoints.
--
-- The application has never surfaced this because the application only
-- ever asks for a count (three sites, listed below). But the policy, not
-- the caller, is the permission. This is the same class of defect as an
-- interface-only gate, and it is live right now.
--
-- What it discloses: which lead agencies rate which vendors, for every
-- customer at once. That is a competitive-intelligence dataset about
-- Ligament's customers, assembled by Ligament, published by accident.
--
-- ---------------------------------------------------------------------
-- WHAT THE FIX CLOSES, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------
-- CLOSES: row access. After phase 2 nobody reads a `voucher_agency_id`
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
--   * The INSERT and DELETE policies are re-granted to `authenticated`
--     instead of `public`. They were never actually reachable by `anon`
--     (auth.uid() is NULL there, so the predicate is NULL, so the write is
--     denied), but a write policy addressed to `public` on a table that
--     just leaked its whole contents is not a shape to leave in place.
--
-- DOES NOT CLOSE, AND MUST NOT BE MISTAKEN FOR IT:
--
--   * BLIND TWO-WAY VOUCHING IS RULED BUT NOT BUILT. The ruled product is
--     mutual: each side vouches without seeing whether the other has, and
--     the pairing is revealed only when both have. Nothing in this table
--     supports that - it has one direction, one row, no reveal state, and
--     no notion of a vendor vouching back.
--   * WHEN IT IS BUILT, THIS TABLE IS RESHAPED COMPANY-TO-COMPANY.
--     `voucher_agency_id` becomes the organization key, and a separate
--     `voucher_member_id` is added, because under the ruled model the
--     COMPANY vouches and a PERSON presses the button, and colleagues need
--     to know which person. That is a different table from this one.
--
-- **THIS MIGRATION IS A CONTAINMENT MEASURE, NOT THE FINAL SHAPE.** It
-- stops a live disclosure. It does not design the feature.
--
-- ---------------------------------------------------------------------
-- 079 SEAM
-- ---------------------------------------------------------------------
-- `partner_vouches` is one of the seven two-column tables:
-- `voucher_agency_id` becomes `lead_org_id` and `vouched_partner_id`
-- becomes `vendor_org_id` at 079. Every occurrence below is marked "079:".
-- The colleague-scoped SELECT policy created in phase 2 is keyed on
-- `voucher_agency_id = auth.uid()`, which is bucket (a) and which
-- `pnpm policy-audit` will flag. THAT IS CORRECT. It is degenerate today -
-- one member per company - and it is exactly the "visible to colleagues"
-- half of the ruling the moment 079 makes it resolve through membership.
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
--   2. DEPLOY A CODE CHANGE moving all three read sites onto the RPCs.
--      They are, exactly:
--        a. app/api/marketplace/discoverable/route.ts:80-87
--             .from("partner_vouches").select("vouched_partner_id")
--             .in("vouched_partner_id", profileIds)  -- counted in JS
--           becomes  supabase.rpc("partner_vouch_counts", { p_partner_ids: profileIds })
--        b. app/partner/profile/page.tsx:209-213
--             .from("partner_vouches").select("*", { count: "exact", head: true })
--             .eq("vouched_partner_id", user.id)
--           becomes  supabase.rpc("partner_vouch_count", { p_partner_id: user.id })
--        c. app/agency/pool/[partnerId]/page.tsx:227-231, the same head
--           count for one partner
--           becomes  supabase.rpc("partner_vouch_count", { p_partner_id: partnerId })
--
--      The "have I vouched?" read at app/agency/pool/[partnerId]/page.tsx:234-239
--      does NOT change. It selects rows where voucher_agency_id = the
--      caller, which the colleague-scoped policy in phase 2 still permits.
--
--   3. CONFIRM in production that the vouch counts still render, before
--      touching phase 2. A wrong count after phase 2 is indistinguishable
--      from a vendor with no vouches.
--
--   4. APPLY PHASE 2.
--
-- Phase 1 and phase 2 are separate transactions on purpose. Do not paste
-- this file into the SQL editor as one block.
--
-- ---------------------------------------------------------------------
-- CAPTURE A FRESH pg_policies SNAPSHOT IMMEDIATELY BEFORE PHASE 2
-- ---------------------------------------------------------------------
-- Phase 2 DROPS three policies BY THEIR LIVE NAME. A DROP that matches
-- nothing reports success, and here the failure mode is the worst
-- available: the new restrictive SELECT policy would be created BESIDE the
-- surviving `USING (true)` one, RLS would OR them together, and the whole
-- graph would still be public while the fix looked applied.
--
--   SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--   ORDER BY policyname;
--
-- Confirm all three names below appear EXACTLY as written. If any has
-- changed since 2026-08-13, stop and regenerate this file.
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
-- 079: vouched_partner_id becomes vendor_org_id, and the parameter becomes
--      an organization id rather than a profile id.
CREATE OR REPLACE FUNCTION public.partner_vouch_count(p_partner_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM public.partner_vouches v
  WHERE v.vouched_partner_id = p_partner_id;
$$;

COMMENT ON FUNCTION public.partner_vouch_count(uuid) IS
  'Vouch count for one vendor. Returns a NUMBER and never a voucher identity. Exists so the '
  'count can survive without granting row access to partner_vouches. See migration 082.';

REVOKE EXECUTE ON FUNCTION public.partner_vouch_count(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.partner_vouch_count(uuid) TO authenticated;

-- The counts for many vendors, for the marketplace listing, which needs
-- one number per row and must not make one round trip per card.
--
-- Vendors with zero vouches are simply absent from the result. The caller
-- treats a missing key as 0, which is what the JS aggregation at
-- app/api/marketplace/discoverable/route.ts:84-87 already does.
--
-- 079: same rename as above.
CREATE OR REPLACE FUNCTION public.partner_vouch_counts(p_partner_ids uuid[])
RETURNS TABLE (vouched_partner_id uuid, vouch_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.vouched_partner_id, count(*)::bigint AS vouch_count
  FROM public.partner_vouches v
  WHERE v.vouched_partner_id = ANY (p_partner_ids)
  GROUP BY v.vouched_partner_id;
$$;

COMMENT ON FUNCTION public.partner_vouch_counts(uuid[]) IS
  'Vouch counts for a set of vendors, one row each. Returns NUMBERS and never a voucher '
  'identity. Vendors with no vouches are absent; the caller reads a missing key as 0.';

REVOKE EXECUTE ON FUNCTION public.partner_vouch_counts(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.partner_vouch_counts(uuid[]) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- PHASE 1 VERIFICATION. Run before going anywhere near phase 2.
-- ---------------------------------------------------------------------
--
-- 1. Both functions exist, are SECURITY DEFINER, and have a pinned
--    search_path. Expect 2 rows, prosecdef = true, proconfig NOT NULL.
--
--    SELECT proname, prosecdef, proconfig
--    FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('partner_vouch_count', 'partner_vouch_counts');
--
-- 2. anon cannot execute either. Expect false, false.
--
--    SELECT has_function_privilege('anon', 'public.partner_vouch_count(uuid)', 'EXECUTE'),
--           has_function_privilege('anon', 'public.partner_vouch_counts(uuid[])', 'EXECUTE');
--
-- 3. The function agrees with the table. Pick any vendor id that has at
--    least one vouch and expect the two numbers to match.
--
--    SELECT vouched_partner_id, count(*) FROM public.partner_vouches
--    GROUP BY vouched_partner_id ORDER BY 2 DESC LIMIT 5;
--
--    SELECT public.partner_vouch_count('<paste an id from above>');
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
-- =====================================================================
-- =====================================================================


-- =====================================================================
-- PHASE 2. Removes the row exposure. Apply only after the STOP GATE.
-- =====================================================================

BEGIN;

-- The exposure itself.
DROP POLICY IF EXISTS "Anyone can count vouches" ON public.partner_vouches;

-- The "visible to colleagues, anonymous to everyone outside" half of the
-- ruling. Degenerate today, since a company has exactly one member, so it
-- resolves to "the caller reads the vouches they wrote" - which is what
-- the "have I vouched?" check at app/agency/pool/[partnerId]/page.tsx:234
-- needs and all it needs.
--
-- THE VENDOR IS NEVER A READER. No policy on this table matches
-- vouched_partner_id, deliberately: anonymity to the subject is the
-- feature, and the vendor gets their own number through
-- partner_vouch_count() without ever touching a row.
--
-- 079: voucher_agency_id becomes lead_org_id, and the predicate becomes
--      `lead_org_id = ANY (public.current_user_org_ids())`.
CREATE POLICY "Vouchers read their own company vouches"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (voucher_agency_id = auth.uid());

-- The two write policies, re-granted to `authenticated` instead of
-- `public`. The predicates are unchanged, character for character.
-- 079: voucher_agency_id becomes lead_org_id in both.
DROP POLICY IF EXISTS "Agencies can vouch" ON public.partner_vouches;
CREATE POLICY "Agencies can vouch"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = voucher_agency_id);

DROP POLICY IF EXISTS "Agencies can remove their vouch" ON public.partner_vouches;
CREATE POLICY "Agencies can remove their vouch"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (auth.uid() = voucher_agency_id);

COMMIT;

-- =====================================================================
-- PHASE 2 VERIFICATION. Run each of these after COMMIT.
-- =====================================================================
--
-- 1. THE ONE THAT MATTERS. No policy on this table grants anything to
--    anon or public, and no policy has a `true` qual. Expect ZERO rows.
--    A row here means the exposure survived the fix.
--
--    SELECT policyname, cmd, roles, qual
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--      AND (roles && ARRAY['anon', 'public']::name[] OR qual = 'true');
--
-- 2. Exactly three policies remain: one SELECT, one INSERT, one DELETE,
--    all to {authenticated}. Expect 3 rows.
--
--    SELECT policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--    ORDER BY cmd, policyname;
--
-- 3. There is still no UPDATE policy, as before. Expect zero rows.
--
--    SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'partner_vouches'
--      AND cmd = 'UPDATE';
--
-- 4. Total policy count across the schema. Three dropped, three created,
--    so it is UNCHANGED by phase 2.
--
--    SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- 5. Live smoke test, in the browser. All three are read paths this
--    migration governs and none is covered by the queries above:
--      a. /partner/profile shows the vendor's own vouch count, non-zero
--         for a vendor known to have vouches.
--      b. /agency/pool/<partnerId> shows the count AND the correct
--         vouched / not-vouched button state.
--      c. The marketplace listing shows per-vendor counts.
--    A zero where a number is expected means step 2 of the order of
--    operations was skipped. Restore the old policy from the header of
--    this file, ship the code change, then re-apply phase 2.
-- =====================================================================
