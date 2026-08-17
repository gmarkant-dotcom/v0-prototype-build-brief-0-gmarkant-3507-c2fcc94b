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
-- THE 079 SEAM. READ THIS BEFORE CHANGING ANYTHING HERE.
-- ---------------------------------------------------------------------
-- TODAY, COMPANY MEANS A USER ID. One user is one company. `org_id` below
-- holds the lead agency's `profiles.id`, and `vendor_org_id` holds the
-- vendor's, exactly as `agency_id` and `partner_id` do on every other
-- table in this schema.
--
-- The COLUMNS are nonetheless named for the post-079 world on purpose.
-- 079 renames 30 columns across 23 tables and the census counts 707+
-- references in application source; naming two more columns `agency_id`
-- and `partner_id` today would add to that surface for no benefit. What
-- changes at 079 is the VALUE these columns hold, not their name, so this
-- table costs the rename nothing.
--
-- Three things 079 (or a follow-up) MUST do to this table. Every one is
-- marked "079:" at the site below:
--
--   1. Rewrite both SELECT policies and the INSERT policy to resolve
--      membership through the organization helper functions instead of
--      comparing to auth.uid(). Until that happens these policies are
--      bucket (a) of docs/policy-rewrite-surface.md and
--      `pnpm policy-audit` will flag them. THAT IS CORRECT AND THEY ARE
--      NOT ALLOW-LISTED. A policy keyed on auth.uid() works perfectly for
--      a single-member organization and shows a colleague nothing at all.
--
--   2. Backfill `org_id` and `vendor_org_id` from user ids to
--      organization ids, in the same statement block that backfills every
--      other company column.
--
--   3. Add the foreign keys. There are DELIBERATELY none on `org_id` and
--      `vendor_org_id` today: 079 repoints existing FKs from `profiles` to
--      `organizations` through a DO block generated from a table list that
--      predates this file, so an FK to `profiles` added here would survive
--      079 unnoticed and then reject every write made by an organization
--      created after it - organizations whose ids belong to no user.
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
-- DELIBERATELY ABSENT: msa.confirm. docs/capabilities.md section 5 marks
-- it not vendor-visible; docs/milestone-attribution-map.md section 2 marks
-- the same milestone with a (V). The two documents disagree, so this
-- follows the whitelist rule and fails closed. Adding it is a one-line
-- change and a decision for Greg, recorded in
-- docs/safety-net-and-attribution-report.md.
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

  -- 079: holds a lead agency's profiles.id today, organizations.id after.
  org_id          uuid        NOT NULL,

  -- 079: holds a vendor's profiles.id today, organizations.id after. NULL
  -- for events with no counterparty, and for guest recipients who have no
  -- account at all.
  vendor_org_id   uuid        NULL,

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
  '079 SEAM. The company the event belongs to. Holds a lead agency profiles.id today because '
  'one user is one company; becomes organizations.id at 079. No FK on purpose - see the file '
  'header.';
COMMENT ON COLUMN public.milestone_events.vendor_org_id IS
  '079 SEAM. The counterparty company, or NULL. Same shape as org_id.';
COMMENT ON COLUMN public.milestone_events.actor_id IS
  'The acting user. NULL for guest / magic-link actors, who have no account. Not renamed by '
  '079: the actor is a person either way.';
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

-- 079: replace `org_id = auth.uid()` with
--      `org_id = ANY (public.current_user_org_ids())`.
CREATE POLICY "Members read own company milestone events"
  ON public.milestone_events
  FOR SELECT
  TO authenticated
  USING (org_id = auth.uid());

-- 079: replace the partnerships subquery's `p.partner_id = auth.uid()`
--      with `p.vendor_org_id = ANY (public.current_user_org_ids())`.
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
        AND p.partner_id = auth.uid()
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
--
-- 079: replace `org_id = auth.uid()` with
--      `org_id = ANY (public.current_user_org_ids())`.
CREATE POLICY "Members insert own company milestone events"
  ON public.milestone_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_side = 'agency'
    AND org_id = auth.uid()
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
-- 4. The whitelist function returns the expected set. Expect 22 rows and
--    no row reading 'msa.confirm'.
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
