-- =====================================================================
-- Migration 093 DOWN. Restores the state 093 changed, exactly.
--
--   REVERTS  policy "Partners can claim partnership by email"
--            back to  partner_email ~~* (SELECT pr.email ...)
--
--   REVERTS  public.partnerships_guard_identity_columns()
--            back to 087's body, with NO permit list.
--
-- =====================================================================
-- >>> READ THIS BEFORE RUNNING IT. THIS FILE REOPENS TWO HOLES. <<<
-- =====================================================================
--
-- IT IS NOT A TIDY-UP AND IT IS NOT A NO-OP. Running it:
--
--   1. PUTS THE PATTERN MATCH BACK. The claim policy compares
--      partner_email against the caller's own profile email with ILIKE
--      again. `%` and `_` in that address become wildcards again, and an
--      account able to set its email to `%@example.com` can claim every
--      unclaimed ghost partnership at that domain. This is OPEN-092-8,
--      restored.
--
--   2. LETS THE VENDOR WRITE EVERY COLUMN AGAIN. nda_confirmed_at,
--      msa_confirmed_at, partnership_notes (including the {blacklisted}
--      flag), reliability_summary, partner_email and the four 068 contact
--      columns all become vendor-writable. A vendor can self-confirm
--      their own NDA and MSA, un-blacklist themselves, and rewrite the
--      cached AI narrative about their own delivery performance that the
--      lead agency reads. This is OPEN-092-9, restored.
--
-- 087 IS NOT UNDONE. lead_org_id stays immutable and vendor_org_id stays
-- pinned in both directions: those four refusals are reproduced below
-- character for character from 087:606-648, which is the whole reason
-- this file replaces the function rather than dropping it.
--
-- WHAT THIS FILE CANNOT UNDO: nothing. 093 wrote no data, added no
-- column, created no table and created no function. There is no state to
-- reconcile, so this down file is exact rather than best-effort.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 093 WAS APPLIED. ALTER POLICY and
-- CREATE OR REPLACE FUNCTION both write the stated definition regardless
-- of what was there. It will FAIL LOUDLY, with 42704, if the policy name
-- has drifted - which is the correct outcome and the same reasoning 093
-- gives for using ALTER over DROP-then-CREATE.
--
-- TRANSACTION CONTROL. Explicit BEGIN; on LINE 56 and explicit COMMIT;
-- on LINE 151. Verify with:
--
--     grep -n -i '^begin\|^commit\|^rollback' \
--       supabase/migrations/093_partnership_claim_and_column_guard_down.sql
--
-- Three hits: 56 BEGIN;, 87 BEGIN (plpgsql, no semicolon), 151 COMMIT;.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1. The claim policy, back to the pattern match.
--
-- Reproduces 079:1495-1502 exactly. ALTER rather than DROP-then-CREATE,
-- for the same reason 093 gives: on a drifted name this aborts with
-- 42704 instead of quietly leaving two policies OR-ing together.
-- ---------------------------------------------------------------------
ALTER POLICY "Partners can claim partnership by email"
  ON public.partnerships
  USING (
    vendor_org_id IS NULL
    AND partner_email ILIKE (SELECT pr.email FROM public.profiles pr WHERE pr.id = auth.uid())
  )
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));


-- ---------------------------------------------------------------------
-- 2. The guard, back to 087's body.
--
-- This is 087:596-651 verbatim. The permit list, the three exits and the
-- LG009 raise are all gone with it. Nothing else about the function
-- changes: same name, same signature, same LANGUAGE, same search_path,
-- still not SECURITY DEFINER, same trigger pointing at it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partnerships_guard_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.partnerships_guard_identity_columns() IS
  'BEFORE UPDATE guard on public.partnerships, added by migration 087. Enforces what row '
  'level security cannot: lead_org_id never changes, vendor_org_id is only ever written '
  'NULL -> value, and the value written must be the organization of the person the row is '
  'addressed to. A policy WITH CHECK sees only the new row, so immutability is not '
  'expressible as a policy, and the alternative - scoping the write by a counterparty '
  'VISIBILITY set - is forbidden in this schema. It RAISES rather than filtering, because '
  'an RLS update that matches no row returns HTTP 200 with no error and this project has '
  'lost real behaviour to exactly that five times. 093''s vendor-side column permit list '
  'has been REMOVED from this function by 093''s down file: every column on this table '
  'except lead_org_id and vendor_org_id is vendor-writable again.';

COMMIT;


-- =====================================================================
-- VERIFICATION AFTER RUNNING THE DOWN FILE. Read only.
--
-- D1. The pattern match is back. EXPECTED: still_uses_ilike = true.
--
--     SELECT policyname, qual LIKE '%~~*%' AS still_uses_ilike
--     FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'partnerships'
--       AND policyname = 'Partners can claim partnership by email';
--
-- D2. The permit list is gone and 087's refusals are not.
--     EXPECTED: has_permit_list = false, the other three true.
--
--     SELECT p.proname,
--            pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%'          AS has_permit_list,
--            pg_get_functiondef(p.oid) LIKE '%lead_org_id is immutable%'    AS has_087_immutable,
--            pg_get_functiondef(p.oid) LIKE '%cannot be cleared once set%'  AS has_087_clear,
--            pg_get_functiondef(p.oid) LIKE '%cannot be repointed once set%' AS has_087_repoint
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_identity_columns';
--
-- D3. The policy count is unchanged. EXPECTED: 6 and 117.
--
--     SELECT count(*) FILTER (WHERE tablename = 'partnerships') AS partnerships,
--            count(*)                                            AS public_total
--     FROM pg_policies WHERE schemaname = 'public';
-- =====================================================================
