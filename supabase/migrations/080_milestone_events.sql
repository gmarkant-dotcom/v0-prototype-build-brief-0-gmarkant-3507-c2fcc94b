-- =====================================================================
-- Migration 080: milestone_events. The breadcrumb table.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. Greg runs this in the Supabase SQL Editor.
-- =====================================================================
--
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------
-- Greg's ruling: attribution belongs in M1, scoped to milestones rather
-- than a created_by column on every table. Who sent the RFP to vendors,
-- who awarded the bid, who wrote the feedback. Visible to every member of
-- the same company. The actor is NAMED to the vendor as well, but contact
-- details stay tier-scoped, so a vendor cannot harvest a whole team's
-- contacts from an activity feed.
--
-- WHY A TABLE AND NOT AN EXTENSION OF WHAT EXISTS
-- ---------------------------------------------------------------------
-- docs/milestone-attribution-map.md section 1 ruled both alternatives out
-- and this migration exists because of that finding, not in spite of it:
--
--   * "Recent Activity" on the dashboard is DERIVED. It is a union of four
--     timestamp columns computed in memory per request
--     (app/api/agency/dashboard/route.ts:370-418) and never persisted.
--     Every line's subject is the COUNTERPARTY - the vendor who viewed,
--     the vendor who bid. There is no column anywhere in that union naming
--     which person on the agency side did anything, and adding an actor
--     column to the four source tables would not create one, because those
--     columns record when a VENDOR acted.
--
--   * `notifications` is per RECIPIENT, not per event. It has no actor
--     column (the actor is prose inside `title`), no event identity tying
--     one event's rows together, its INSERT policy is partnership-scoped
--     so a colleague cannot be notified at all, and nothing in the product
--     reads it.
--
-- THE APPEND-ONLY RULE, AND WHY IT IS ENFORCED IN THE POLICY SET
-- ---------------------------------------------------------------------
-- There is NO UPDATE policy and NO DELETE policy on this table, for
-- anybody, deliberately. A breadcrumb that can be edited is not a
-- breadcrumb. Corrections are new rows.
--
-- This also fixes two milestones that are actively destructive today:
-- resending an invitation overwrites `partnerships.invitation_sent_at` and
-- discards the original send time, and changing a response deadline
-- overwrites the old one while the vendor is the party most affected. An
-- actor column on either row would record only who did it LAST. Only an
-- append-only table records both facts.
--
-- ---------------------------------------------------------------------
-- THE 079 SEAM IS CLOSED. THIS FILE IS POST-079.
-- ---------------------------------------------------------------------
-- 079 IS APPLIED. A company is an `organizations` row, membership lives in
-- `org_members`, and `public.current_user_org_ids()` resolves the caller's
-- organizations. `org_id` below holds an `organizations.id`, and so does
-- `vendor_org_id` - not a `profiles.id`, and not by way of a later
-- backfill, but from the first row this table ever takes.
--
-- The COLUMNS were always named for this world. 079 renamed 30 columns
-- across 23 tables against a census of 707+ references in application
-- source; what changed here at 079 was the VALUE these columns hold, not
-- their name, so the rename never touched this table and no reference in
-- application source had to move.
--
-- The three things this file's earlier header said 079 still owed the
-- table are all settled here, in this file, before it is applied:
--
--   1. THE POLICIES: REWRITTEN BELOW. Both SELECT policies and the INSERT
--      policy resolve membership through `public.current_user_org_ids()`
--      instead of comparing a company column to auth.uid(). They are no
--      longer bucket (a) of docs/policy-rewrite-surface.md and
--      `pnpm policy-audit` has nothing here to flag. The counterparty
--      policy in particular had to change for this file to apply AT ALL:
--      it tested `partnerships.partner_id`, which 079 renamed to
--      `vendor_org_id`, so the file as written raised 42703
--      undefined_column at CREATE POLICY and took the whole transaction
--      down with it.
--
--      ON THE SPELLING. The predicate is
--      `IN (SELECT public.current_user_org_ids())` and NOT the
--      `= ANY (public.current_user_org_ids())` the old instruction
--      comments asked for. `current_user_org_ids()` RETURNS SETOF uuid,
--      not uuid[]; `= ANY (f())` over a set-returning function raises
--      42809, "op ANY/ALL (array) requires array on right side of ANY".
--      Every policy predicate 079 actually shipped uses the IN (SELECT)
--      form. The `= ANY` spelling never existed anywhere but in
--      instruction comments, here and in 081.
--
--   2. THE BACKFILL: MOOT. THERE ARE NO ROWS TO BACKFILL. This migration
--      has never been applied, so `milestone_events` does not exist and
--      holds nothing - confirmed live, where every emit from
--      lib/milestone-events.ts is dropped against a PostgREST PGRST205 for
--      a table absent from the schema cache. There are no user ids in
--      these columns to convert to organization ids, because there are no
--      values in these columns at all. The table is created holding
--      organization ids and has never held anything else. No backfill
--      statement belongs in this migration or in any later one.
--
--   3. THE FOREIGN KEYS: ADDED HERE, pointing at `organizations(id)`. They
--      were left off because 079 repoints existing FKs through a DO block
--      generated from a table list that predates this file, so an FK to
--      `profiles` written here would have survived 079 unseen. 079 is now
--      applied and its DO block never named this table, so if this file
--      does not add them nothing ever will. The ON DELETE actions follow
--      079 PHASE 7's own stated rule - CASCADE on a NOT NULL company
--      column, SET NULL on a nullable one - and the constraint names
--      follow its `<table>_<column>_org_fkey` convention, so a future
--      audit that reads either finds this table where it expects it. Each
--      action is argued at its column declaration below.
--
-- ---------------------------------------------------------------------
-- SNAPSHOT NOTE
-- ---------------------------------------------------------------------
-- This migration drops nothing and renames nothing, so it cannot collide
-- with a stale policy name. It is still worth re-taking pg_policies AFTER
-- applying it and committing the result as docs/schema-snapshot-<date>.md,
-- because the repo cannot reproduce the live policy set from its own
-- history and this migration adds three policies to it. Split the export
-- by table-name range or count the rows: Supabase truncates at 100 rows
-- silently.
--
--   SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--     -- 104 on 2026-08-13; expect 107 after this migration.
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The vendor-visible whitelist.
-- ---------------------------------------------------------------------
-- An EXPLICIT WHITELIST of event types, never "everything not marked
-- private". The difference matters on the day someone adds an event type
-- and forgets the flag: a whitelist fails closed and the vendor sees
-- nothing new; a blacklist fails open and the vendor sees the agency's
-- internal AI scoring of their competitors.
--
-- It is a FUNCTION and not a boolean column for the same reason. A column
-- can be set by whatever performs the INSERT; a function is a constant
-- that only a migration can change.
--
-- The list is the (V) set from docs/capabilities.md section 5, "Milestone
-- event alignment", transcribed without addition. Every string is
-- simultaneously a capability name in lib/capabilities.ts and an event
-- type here, on purpose: "who may do this" and "who did this" must never
-- drift into two spellings.
--
-- RULED VENDOR-VISIBLE 2026-08-17: msa.confirm. This entry was previously
-- absent because docs/capabilities.md section 5 marked it not
-- vendor-visible while docs/milestone-attribution-map.md section 2 marked
-- the same milestone with a (V), and an unresolved disagreement had to
-- fail closed. Greg has ruled: confirming a vendor's NDA or MSA is a fact
-- about that vendor's OWN paperwork, and they already see the resulting
-- state. Withholding the breadcrumb hid who confirmed it, not whether it
-- was confirmed. msa.confirm is now in the list under "Onboarding and
-- delivery". The disagreement is settled in favour of the attribution
-- map; docs/capabilities.md section 5 is the document now out of date.
CREATE OR REPLACE FUNCTION public.vendor_visible_event_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ARRAY[
    -- Vendor pool
    'vendor.invite',
    'vendor.invite_resend',
    -- RFP
    'rfp.broadcast',
    'rfp.magic_link_send',
    'rfp.deadline_set',
    'rfp.deadline_change',
    -- Bids, agency side
    'bid.shortlist',
    'bid.meeting_request',
    'bid.award',
    'bid.decline',
    'bid.feedback',
    -- Onboarding and delivery
    'onboarding.package_send',
    'onboarding.deploy',
    'msa.confirm',
    'status_update.resolve',
    -- Money
    'payment.mark_paid',
    -- Vendor side, where the lead agency is the counterparty
    'bid.submit',
    'bid.revise',
    'rfp.view',
    'invitation.accept',
    'invitation.decline',
    'nda.acknowledge',
    'status_update.post'
  ]::text[];
$$;

COMMENT ON FUNCTION public.vendor_visible_event_types() IS
  'Explicit whitelist of milestone_events.event_type values a counterparty may read. '
  'Fails closed: an event type absent from this list is invisible to the counterparty. '
  'Seeded from docs/capabilities.md section 5. Changing it is a migration, not an INSERT.';

REVOKE EXECUTE ON FUNCTION public.vendor_visible_event_types() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.vendor_visible_event_types() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.milestone_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The lead agency organization this event belongs to.
  --
  -- ON DELETE CASCADE, per 079 PHASE 7's rule for a NOT NULL company
  -- column. This does not weaken the append-only rule: that rule governs
  -- what a CALLER may do to a row, and it is enforced by the absence of an
  -- UPDATE policy and a DELETE policy for anybody. An organization ceasing
  -- to exist is not a caller editing a breadcrumb. Once it is gone, no
  -- policy on this table can match these rows ever again - the read
  -- predicate is `org_id IN (SELECT public.current_user_org_ids())` and
  -- there is nothing left to match - so CASCADE removes rows already
  -- unreadable by every role. RESTRICT would make an organization with one
  -- breadcrumb permanently undeletable, and SET NULL is not available on a
  -- NOT NULL column.
  org_id          uuid        NOT NULL
    CONSTRAINT milestone_events_org_id_org_fkey
    REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The counterparty organization, or NULL: events with no counterparty at
  -- all, and guest recipients who have no account and therefore no
  -- organization.
  --
  -- ON DELETE SET NULL, per the same 079 rule for a nullable column, and
  -- the same action `partnership_id` below already carries for the same
  -- situation. CASCADE would be wrong here in a way it is not on org_id:
  -- it would delete a LEAD AGENCY's own breadcrumbs because a counterparty
  -- was removed, destroying the log of an organization that still exists
  -- and can still read it. RESTRICT would block deleting any organization
  -- that had ever been on the receiving end of a milestone. SET NULL is
  -- the only action that leaves the owning agency's record standing: the
  -- actor, the event type, the subject and the payload are untouched. It
  -- costs no visibility either, because counterparty reads were never
  -- keyed on this column - they are keyed on `partnership_id`, in the
  -- policy below.
  vendor_org_id   uuid        NULL
    CONSTRAINT milestone_events_vendor_org_id_org_fkey
    REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Drives counterparty visibility. NULL means agency-internal: the
  -- counterparty SELECT policy below cannot match it under any event type.
  partnership_id  uuid        NULL REFERENCES public.partnerships(id) ON DELETE SET NULL,

  -- The acting USER. Nullable on purpose and it must stay that way: three
  -- vendor-side milestones arrive through the guest / magic-link path
  -- (app/api/rfp/guest/[token]/route.ts) where there is no authenticated
  -- user at all and the actor is identified only by the email the token
  -- was issued to. Modelling this NOT NULL breaks the guest bid flow.
  -- The actor is the acting user either way, before and after 079, so this
  -- column is NOT part of the rename.
  actor_id        uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Identity fallback for those guest actors. NEVER rendered to a
  -- counterparty: see the contact-tiering note at the bottom of this file.
  actor_email     text        NULL,

  actor_side      text        NOT NULL CHECK (actor_side IN ('agency', 'vendor')),

  -- The dotted vocabulary from docs/capabilities.md. Deliberately NOT
  -- constrained by a CHECK: the visibility rule is what has to fail
  -- closed, and it does, in vendor_visible_event_types(). Constraining the
  -- write side as well would mean a migration for every new event type
  -- while buying nothing the whitelist does not already buy.
  event_type      text        NOT NULL,

  subject_type    text        NOT NULL,
  -- Nullable because not every milestone has one row to point at. An RFP
  -- broadcast sent outside a project context has no project id, and the
  -- wizard permits that today.
  subject_id      uuid        NULL,

  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.milestone_events IS
  'Append-only attribution log. INSERT and SELECT only - there is no UPDATE policy and no '
  'DELETE policy for anybody, deliberately. Corrections are new rows.';
COMMENT ON COLUMN public.milestone_events.org_id IS
  'The lead agency organization the event belongs to. An organizations.id - this table is '
  'post-079 and has never held a profiles.id. FK to organizations(id) ON DELETE CASCADE.';
COMMENT ON COLUMN public.milestone_events.vendor_org_id IS
  'The counterparty organization, or NULL for an event with no counterparty and for guest '
  'recipients who have no account. FK to organizations(id) ON DELETE SET NULL, so removing a '
  'counterparty does not delete the owning agency''s own breadcrumbs. Counterparty visibility '
  'is NOT keyed on this column - it is keyed on partnership_id.';
COMMENT ON COLUMN public.milestone_events.actor_id IS
  'The acting user, not a company: a profiles.id, and 079 did not rename it. NULL for guest / '
  'magic-link actors, who have no account.';
COMMENT ON COLUMN public.milestone_events.event_type IS
  'A capability name from docs/capabilities.md. One vocabulary for "who may do this" and '
  '"who did this", so the two cannot drift into different spellings.';

-- Newest-first for one company is the only read pattern the feed has.
CREATE INDEX IF NOT EXISTS milestone_events_org_created_idx
  ON public.milestone_events (org_id, created_at DESC);

-- The counterparty read path: partnership first, then the whitelist test.
CREATE INDEX IF NOT EXISTS milestone_events_partnership_type_idx
  ON public.milestone_events (partnership_id, event_type)
  WHERE partnership_id IS NOT NULL;

-- "What has this person done", the reason the table exists.
CREATE INDEX IF NOT EXISTS milestone_events_actor_idx
  ON public.milestone_events (actor_id)
  WHERE actor_id IS NOT NULL;

-- Subject lookups: "the history of this bid".
CREATE INDEX IF NOT EXISTS milestone_events_subject_idx
  ON public.milestone_events (subject_type, subject_id)
  WHERE subject_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Row level security, in this same migration. Not a follow-up.
-- ---------------------------------------------------------------------
-- docs/schema-truth.md records that this repository cannot reliably replay
-- its own policy history. A table that ships without policies for even one
-- deploy is a table whose real policy set nobody can reconstruct later.
ALTER TABLE public.milestone_events ENABLE ROW LEVEL SECURITY;

-- Deny by default: RLS is on and only the three policies below grant
-- anything. There is no policy for `anon` and none for `public`, so the
-- anon key reads nothing here. That is the defect this product already has
-- live on partner_vouches (see migration 082) and it is not repeated.

CREATE POLICY "Members read own company milestone events"
  ON public.milestone_events
  FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

-- No status predicate on the partnership, deliberately, and consistent
-- with `current_user_counterparty_org_ids()` which 085 left status-free on
-- purpose. 085 drew its boundary around COMMERCIAL TERMS. A milestone is
-- not a commercial term: it is the record of an act the counterparty was a
-- party to, and a vendor whose partnership later went 'removed' does not
-- stop having been sent that RFP. The whitelist, not the status, is what
-- fails closed here.
CREATE POLICY "Counterparty reads whitelisted milestone events"
  ON public.milestone_events
  FOR SELECT
  TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND event_type = ANY (public.vendor_visible_event_types())
    AND EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = milestone_events.partnership_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())
    )
  );

-- Agency-side writes only, and the actor must be the caller.
--
-- There is deliberately no vendor-side INSERT policy yet. Nothing in the
-- application emits a vendor-side event, and a policy that grants a write
-- nobody makes is a policy nobody has reviewed against a real caller. The
-- vendor-side INSERT policy ships with the first vendor-side emitter, in
-- the same commit, and it will have to permit the guest path's NULL
-- actor_id without permitting an authenticated caller to write somebody
-- else's name.
CREATE POLICY "Members insert own company milestone events"
  ON public.milestone_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_side = 'agency'
    AND org_id IN (SELECT public.current_user_org_ids())
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

-- NO UPDATE POLICY. NO DELETE POLICY. See the file header.

COMMIT;

-- =====================================================================
-- VERIFICATION. Run each of these after COMMIT. Expected results stated.
-- =====================================================================
--
-- 1. The table exists and RLS is on. Expect one row, rowsecurity = true.
--
--    SELECT relname, relrowsecurity
--    FROM pg_class
--    WHERE relname = 'milestone_events' AND relnamespace = 'public'::regnamespace;
--
-- 2. Exactly three policies, and NONE of them UPDATE or DELETE.
--    Expect 3 rows: two SELECT, one INSERT.
--
--    SELECT policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'milestone_events'
--    ORDER BY cmd, policyname;
--
-- 3. No policy grants anything to anon or public. Expect ZERO rows.
--
--    SELECT policyname, roles
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'milestone_events'
--      AND (roles && ARRAY['anon', 'public']::name[]);
--
-- 4. The whitelist function returns the expected set. Expect 23 rows,
--    INCLUDING one reading 'msa.confirm' (ruled vendor-visible
--    2026-08-17; the count was 22 before that ruling).
--
--    SELECT unnest(public.vendor_visible_event_types()) AS event_type
--    ORDER BY 1;
--
-- 5. The function is not executable by anon. Expect false.
--
--    SELECT has_function_privilege('anon', 'public.vendor_visible_event_types()', 'EXECUTE');
--
-- 6. Total policy count across the schema. Expect 107 if the last capture
--    was 104 and nothing else has changed. If it is not 107, something
--    changed outside this repository and the next migration that drops a
--    policy by name is unsafe until a fresh snapshot is taken.
--
--    SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- 7. Both company columns are foreign keys to organizations, with the
--    stated ON DELETE actions. Expect exactly 2 rows:
--      org_id        -> milestone_events_org_id_org_fkey        ... c (CASCADE)
--      vendor_org_id -> milestone_events_vendor_org_id_org_fkey ... n (SET NULL)
--    Zero rows means the FKs were lost and nothing else will add them.
--
--    SELECT a.attname AS column_name, c.conname, c.confdeltype
--    FROM pg_constraint c
--    JOIN pg_class      r ON r.oid = c.conrelid
--    JOIN pg_class      f ON f.oid = c.confrelid
--    JOIN pg_attribute  a ON a.attrelid = r.oid AND a.attnum = c.conkey[1]
--    WHERE c.contype = 'f'
--      AND r.relname = 'milestone_events'
--      AND f.relname = 'organizations'
--    ORDER BY 1;
--
-- =====================================================================
-- CONTACT TIERING IS A SEPARATE CONTROL AND IS NOT ENFORCED HERE
-- =====================================================================
-- The ruling names the actor to the vendor but keeps contact details tier
-- scoped: only the named engagement contact's email and preferred channel
-- are ever shared, so a vendor cannot harvest a team's contacts.
--
-- This table carries `actor_id` and, for guests, `actor_email`. Resolving
-- `actor_id` to a DISPLAY NAME is one lookup. Resolving it to an email
-- address is a different lookup with a different permission, and this
-- table grants neither.
--
-- Any vendor-facing endpoint that renders these rows MUST route the actor
-- through the lead agency profile tiering shipped in commit 0016d33 and
-- return a display name only. Joining milestone_events to profiles and
-- selecting `email` re-opens the harvest that tiering exists to prevent,
-- one join at a time - and `actor_email` must never be rendered to a
-- counterparty at all, since a guest actor's address is a person's inbox
-- with no tiering in front of it.
-- =====================================================================
