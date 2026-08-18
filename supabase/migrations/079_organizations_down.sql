-- =====================================================================
-- Migration 079 DOWN. Reverses 079_organizations.sql.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. AND IT IS A TEMPLATE, NOT A GUARANTEE.
-- =====================================================================
--
-- THIS FILE WAS WRITTEN FROM docs/schema-snapshot-2026-08-13.md AND MUST BE
-- REGENERATED FROM THE FRESH pg_policies CAPTURE GREG TAKES IMMEDIATELY
-- BEFORE APPLYING 079.
--
-- Every CREATE POLICY below restores a predicate copied from a snapshot
-- dated 2026-08-13. Fifteen of those policies exist in production and
-- nowhere else in this repository, so if the live set has drifted since that
-- date, this file restores the Aug 13 rule and not the rule that was
-- actually live the moment before 079 ran. That is a silent access change in
-- either direction: a policy that was tightened out of band gets loosened
-- back, or one that was added gets dropped and never restored.
--
-- The regeneration procedure is mechanical:
--   1. Take the fresh capture (the query is in 079_organizations.sql's
--      header) and commit it as docs/schema-snapshot-<date>.md.
--   2. Diff it against docs/schema-snapshot-2026-08-13.md.
--   3. For every policy that differs, replace the corresponding CREATE
--      POLICY below with the fresh predicate, verbatim, including the
--      Postgres-normalized spelling (~~* rather than ILIKE, column
--      qualification, no public. prefix).
--   4. For every policy present in the fresh capture and absent here, add it.
--
-- WHY THIS FILE EXISTS AT ALL. 079 is irreversible from the repository:
-- it drops 83 policies, 15 of which cannot be reconstructed from any file
-- here, against a database whose migration history cannot be replayed. An
-- irreversible migration against a database the repo cannot reproduce is not
-- an acceptable risk, so the reversal is written down before it is needed
-- rather than improvised at the moment it is.
--
-- ---------------------------------------------------------------------
-- WHAT THIS FILE CANNOT RESTORE. READ THIS BEFORE RELYING ON IT.
-- ---------------------------------------------------------------------
--
-- 1. ORGANIZATIONS CREATED AFTER 079. Every account that signs up between
--    079 and this rollback gets an organization whose id is
--    gen_random_uuid() and belongs to no user. Dropping organizations
--    destroys those rows, and every row that references them - projects,
--    partnerships, clients, everything - is CASCADE-deleted with them.
--    THIS IS DATA LOSS AND IT IS NOT RECOVERABLE FROM THIS FILE.
--    Before running this, count what you are about to destroy:
--
--      SELECT o.id, o.name, o.created_at
--      FROM public.organizations o
--      WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.id)
--      ORDER BY o.created_at;
--
--    Any row returned is an organization this rollback deletes. If any
--    exists, STOP: the rollback needs a bespoke plan that re-parents those
--    rows onto their founding user's id first, and that plan is not this
--    file. The window in which this is safe is the window in which nobody
--    has signed up.
--
-- 2. MULTI-MEMBER ORGANIZATIONS. If anyone has been added to an
--    organization they did not found, this rollback silently strips their
--    access. The old predicates are `agency_id = auth.uid()`, so a colleague
--    whose uid is not the organization id simply stops seeing anything. No
--    error, no log. Check first:
--
--      SELECT org_id, count(*) FROM public.org_members
--      GROUP BY 1 HAVING count(*) > 1;
--
--    Any row returned means people lose access. There were zero such rows
--    at the moment 079 was authored, because org_members did not exist.
--
-- 3. THE ROLE COLUMN ON org_members. owner/admin/member is destroyed with
--    the table. Re-running 079 later backfills everyone as 'owner' again, so
--    any deliberate demotion is lost.
--
-- 4. THE CAPABILITY FLAGS. organizations.is_lead_agency and
--    organizations.is_vendor are destroyed. Re-running 079 re-derives them
--    from profiles.role, so any hand-correction is lost.
--
-- 4b. THE DESIGNATED PRIMARY CONTACT. organizations.primary_contact_user_id
--    is destroyed with the table. There is no column to reverse and no
--    separate DROP to write: DOWN PHASE 8 already drops organizations
--    CASCADE, and the foreign key to profiles(id) goes with it. That is the
--    whole mirror of the up-migration change, and it is recorded here rather
--    than as a no-op statement so nobody looks for one and concludes it was
--    forgotten.
--
--    What it costs: re-running 079 backfills every contact to the FOUNDING
--    USER again, so any organization that had since designated somebody else
--    silently reverts to its founder. Same class as limits 3 and 4. Capture
--    it before rolling back if it matters:
--
--      SELECT id, name, primary_contact_user_id
--      FROM public.organizations
--      WHERE primary_contact_user_id IS DISTINCT FROM id
--      ORDER BY name;
--
--    Any row returned is a deliberate designation this rollback discards.
--
--    THE APPLICATION SIDE REVERTS WITH THE CODE, NOT WITH THIS FILE.
--    Thirteen PostgREST embeds read that column through lib/org-contact.ts.
--    Rolling the database back without reverting the code first (limit 9
--    below) leaves them querying organizations, which no longer exists.
--
-- 5. FOREIGN KEY CONSTRAINT NAMES AND ON DELETE ACTIONS. 079 reads the
--    existing constraint names from pg_constraint and does not record them.
--    This file therefore recreates the FKs pointing back at profiles(id)
--    with NEW, DIFFERENT names and with ON DELETE CASCADE throughout, which
--    is what the majority of them carried. Any constraint that had a
--    different action does not get it back. If the exact prior names or
--    actions matter, capture them before applying 079:
--
--      SELECT r.relname AS table_name, c.conname, a.attname AS column_name,
--             c.confdeltype, f.relname AS references_table
--      FROM pg_constraint c
--      JOIN pg_class r ON r.oid = c.conrelid
--      JOIN pg_class f ON f.oid = c.confrelid
--      JOIN pg_namespace n ON n.oid = r.relnamespace
--      JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = c.conkey[1]
--      WHERE n.nspname='public' AND c.contype='f'
--        AND a.attname IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
--      ORDER BY 1,3;
--
-- 6. THE SEVEN TABLES THAT HAD NO FOREIGN KEY. bid_decompositions,
--    bid_comparisons, bid_scoring_criteria, bid_scoring_templates,
--    bid_evaluations, delivery_reviews and clients declared their identity
--    column with no FK at all. 079 gave them one. This file drops it and
--    does not add a replacement, restoring the original unconstrained state,
--    which is honest but is also worse.
--
-- 7. INDEXES 079 CREATED. They are dropped by name where 079 created them.
--    An index that already existed before 079 is left alone, as it should
--    be, but this file cannot tell the two apart with certainty: it drops
--    only the idx_<table>_<column> names 079 mints and leaves everything
--    else, so a pre-existing index that happened to carry that exact name
--    would be lost. None did on 2026-08-13.
--
-- 8. PRE-079 NULLABILITY. 079 runs SET NOT NULL on 23 columns. Some of them
--    were already NOT NULL and some were not, and 079 does not record which.
--    This file runs DROP NOT NULL only on the columns that migration files
--    on disk declare as nullable, and leaves the rest NOT NULL. That is a
--    guess drawn from files the schema-truth document says cannot be
--    trusted. Capture the truth before applying 079:
--
--      SELECT table_name, column_name, is_nullable
--      FROM information_schema.columns
--      WHERE table_schema='public'
--        AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
--      ORDER BY 1,2;
--
-- 9. THE APPLICATION. This file restores the database. It does not roll back
--    the deployed code. Reverting the code deploy is a separate step and it
--    must happen FIRST, or the running application queries org_id against a
--    database that has agency_id again.
--
-- 10. IT HAS NEVER BEEN EXECUTED. Neither has 079. Neither file has been
--     parsed by a Postgres server. There is no local database in this
--     project and no staging environment anywhere in this repository.
--
-- ---------------------------------------------------------------------
-- THE ORDER TO ROLL BACK IN
-- ---------------------------------------------------------------------
--   1. Revert the code deploy to the commit before the rename.
--   2. Run the two SELECTs in limits 1 and 2 above. If either returns a
--      row, stop and plan properly.
--   3. Regenerate this file from the fresh capture, per the top of this
--      header.
--   4. Run this file.
--   5. Re-take pg_policies and diff it against the pre-079 capture. They
--      must match. Anything that does not is a rule you have just changed
--      by accident.
-- =====================================================================

BEGIN;


-- =====================================================================
-- DOWN PHASE 1: restore handle_new_user to its current live (post-078)
--               body, verbatim
--
-- This is supabase/migrations/078_signup_role_trigger.sql's function with
-- nothing added and nothing removed: the search_path pin, the read of
-- raw_user_meta_data->>'role', the opposite-role derivation for
-- secondary_role, the ON CONFLICT clause with the three role columns
-- deliberately absent from its update list, and the deliberate absence of
-- is_paid, is_admin, demo_access and any email literal.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  chosen_role text;
  other_role  text;
BEGIN
  chosen_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
    ELSE 'agency'
  END;

  other_role := CASE WHEN chosen_role = 'partner' THEN 'agency' ELSE 'partner' END;

  INSERT INTO public.profiles (
    id, email, full_name, company_name,
    role, active_role, secondary_role
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    chosen_role,
    chosen_role,
    other_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name);

  RETURN NEW;
END;
$$;


-- =====================================================================
-- DOWN PHASE 2: drop the 86 policies 079 created
--
-- Dropped before the columns are renamed back, because their predicates
-- reference org_id, lead_org_id and vendor_org_id.
-- =====================================================================

DROP POLICY IF EXISTS "Agency manages own library documents"                    ON public.agency_library_documents;
DROP POLICY IF EXISTS "Agencies can create invitations"                         ON public.agency_partner_invitations;
DROP POLICY IF EXISTS "Agencies can view their sent invitations"                ON public.agency_partner_invitations;
DROP POLICY IF EXISTS "Agencies can update their invitations"                   ON public.agency_partner_invitations;
DROP POLICY IF EXISTS "Partners can view their received invitations"            ON public.agency_partner_invitations;
DROP POLICY IF EXISTS "Partners can update received invitations"                ON public.agency_partner_invitations;
DROP POLICY IF EXISTS "Agencies manage own bid comparisons"                     ON public.bid_comparisons;
DROP POLICY IF EXISTS "Agencies manage own bid decompositions"                  ON public.bid_decompositions;
DROP POLICY IF EXISTS "Agencies manage own bid evaluations"                     ON public.bid_evaluations;
DROP POLICY IF EXISTS "Agencies manage own scoring criteria"                    ON public.bid_scoring_criteria;
DROP POLICY IF EXISTS "Agencies manage own scoring templates"                   ON public.bid_scoring_templates;
DROP POLICY IF EXISTS "Agencies manage own bid evaluation scores"               ON public.bid_evaluation_scores;
DROP POLICY IF EXISTS "Agencies manage own client cash flow"                    ON public.client_cash_flow;
DROP POLICY IF EXISTS "Agencies manage own clients"                             ON public.clients;
DROP POLICY IF EXISTS "Agencies manage own delivery reviews"                    ON public.delivery_reviews;
DROP POLICY IF EXISTS "Partners view own complete delivery reviews"             ON public.delivery_reviews;
DROP POLICY IF EXISTS "Agencies manage own delivery review scores"              ON public.delivery_review_scores;
DROP POLICY IF EXISTS "Partners can create requests"                            ON public.invitation_requests;
DROP POLICY IF EXISTS "Partners can view own requests"                          ON public.invitation_requests;
DROP POLICY IF EXISTS "Agency can manage their MSAs"                            ON public.msa_agreements;
DROP POLICY IF EXISTS "Partners can view their MSAs"                            ON public.msa_agreements;
DROP POLICY IF EXISTS "Scoped insert notifications"                             ON public.notifications;
DROP POLICY IF EXISTS "Agencies manage onboarding deployments for own projects" ON public.onboarding_deployments;
DROP POLICY IF EXISTS "Partners read onboarding deployments for their assignments" ON public.onboarding_deployments;
DROP POLICY IF EXISTS "Agency full access onboarding packages for own projects" ON public.onboarding_packages;
DROP POLICY IF EXISTS "Partner reads onboarding packages for their partnership" ON public.onboarding_packages;
DROP POLICY IF EXISTS "Partner updates review fields on own packages"           ON public.onboarding_packages;
DROP POLICY IF EXISTS "Agency full access package document rows"                ON public.onboarding_package_documents;
DROP POLICY IF EXISTS "Partner reads documents for their packages"              ON public.onboarding_package_documents;
DROP POLICY IF EXISTS "Partners can create requests"                            ON public.partner_access_requests;
DROP POLICY IF EXISTS "Partners can view their requests"                        ON public.partner_access_requests;
DROP POLICY IF EXISTS "Agencies can view requests to them"                      ON public.partner_access_requests;
DROP POLICY IF EXISTS "Agencies can update requests to them"                    ON public.partner_access_requests;
DROP POLICY IF EXISTS "Agencies insert partner RFP inbox rows"                  ON public.partner_rfp_inbox;
DROP POLICY IF EXISTS "Agencies select own partner RFP inbox rows"              ON public.partner_rfp_inbox;
DROP POLICY IF EXISTS "Partners select inbox rows by partner_id"                ON public.partner_rfp_inbox;
DROP POLICY IF EXISTS "Partners update own inbox rows"                          ON public.partner_rfp_inbox;
DROP POLICY IF EXISTS "Agencies read owned response versions"                   ON public.partner_rfp_response_versions;
DROP POLICY IF EXISTS "Partners insert own response versions"                   ON public.partner_rfp_response_versions;
DROP POLICY IF EXISTS "Partners read own response versions"                     ON public.partner_rfp_response_versions;
DROP POLICY IF EXISTS "Agencies select RFP responses they own"                  ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Agencies update response status and feedback"            ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Partners insert RFP responses for their inbox"           ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Partners read response status and feedback"              ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Partners select own RFP responses"                       ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Partners update own RFP responses"                       ON public.partner_rfp_responses;
DROP POLICY IF EXISTS "Agencies can view status updates for their projects"     ON public.partner_status_updates;
DROP POLICY IF EXISTS "Agencies can resolve status updates"                     ON public.partner_status_updates;
DROP POLICY IF EXISTS "Partners can insert their own status updates"            ON public.partner_status_updates;
DROP POLICY IF EXISTS "Partners can view their own status updates"              ON public.partner_status_updates;
DROP POLICY IF EXISTS "Partners can update their own status updates"            ON public.partner_status_updates;
DROP POLICY IF EXISTS "Agencies can vouch"                                      ON public.partner_vouches;
DROP POLICY IF EXISTS "Agencies can remove their vouch"                         ON public.partner_vouches;
DROP POLICY IF EXISTS "Agencies can create partnerships"                        ON public.partnerships;
DROP POLICY IF EXISTS "Agencies can view their partnerships"                    ON public.partnerships;
DROP POLICY IF EXISTS "Agencies can update their partnerships"                  ON public.partnerships;
DROP POLICY IF EXISTS "Partners can view their partnerships"                    ON public.partnerships;
DROP POLICY IF EXISTS "Partners can update partnership status"                  ON public.partnerships;
DROP POLICY IF EXISTS "Partners can claim partnership by email"                 ON public.partnerships;
DROP POLICY IF EXISTS "Agency can manage payment milestones"                    ON public.payment_milestones;
DROP POLICY IF EXISTS "Partners can view their payment milestones"              ON public.payment_milestones;
DROP POLICY IF EXISTS "Partners read payment milestones for their partnerships" ON public.payment_milestones;
DROP POLICY IF EXISTS "Partners read their payment milestones"                  ON public.payment_milestones;
DROP POLICY IF EXISTS "Users can view profiles of partnership members"          ON public.profiles;
DROP POLICY IF EXISTS "assignments_agency_all"                                  ON public.project_assignments;
DROP POLICY IF EXISTS "assignments_partner_select"                              ON public.project_assignments;
DROP POLICY IF EXISTS "assignments_partner_update"                              ON public.project_assignments;
DROP POLICY IF EXISTS "Agencies can view documents for their projects"          ON public.project_documents;
DROP POLICY IF EXISTS "Partners can view documents for their assignments"       ON public.project_documents;
DROP POLICY IF EXISTS "Agencies can view messages for their projects"           ON public.project_messages;
DROP POLICY IF EXISTS "Partners can view messages for their assignments"        ON public.project_messages;
DROP POLICY IF EXISTS "projects_agency_select"                                  ON public.projects;
DROP POLICY IF EXISTS "projects_agency_insert"                                  ON public.projects;
DROP POLICY IF EXISTS "projects_agency_update"                                  ON public.projects;
DROP POLICY IF EXISTS "projects_agency_delete"                                  ON public.projects;
DROP POLICY IF EXISTS "projects_partner_select_assigned"                        ON public.projects;
DROP POLICY IF EXISTS "Agency can manage their own tokens"                      ON public.rfp_magic_tokens;
DROP POLICY IF EXISTS "Agencies manage own usage tracking"                      ON public.usage_tracking;
DROP POLICY IF EXISTS "Agencies manage agreements for their project assignments" ON public.assignment_agreements;
DROP POLICY IF EXISTS "Partners read and update own assignment agreements"      ON public.assignment_agreements;
DROP POLICY IF EXISTS "Partners update agreement signature fields"              ON public.assignment_agreements;

-- The five on the new tables. Dropped explicitly rather than relying on
-- DROP TABLE CASCADE, so the count in the verification block is honest.
DROP POLICY IF EXISTS "Members read their own membership row"                   ON public.org_members;
DROP POLICY IF EXISTS "Org admins add members"                                  ON public.org_members;
DROP POLICY IF EXISTS "Org admins remove members"                               ON public.org_members;
DROP POLICY IF EXISTS "Members read their organizations"                        ON public.organizations;
DROP POLICY IF EXISTS "Org admins update their organization"                    ON public.organizations;


-- =====================================================================
-- DOWN PHASE 3: drop the indexes 079 created
--
-- Only the idx_<table>_<column> names 079 mints, and only where the column
-- name is one 079 introduced. An index that predates 079 keeps its own name
-- and is untouched.
-- =====================================================================

DROP INDEX IF EXISTS public.idx_org_members_user_org;
DROP INDEX IF EXISTS public.idx_org_members_org_role;

DROP INDEX IF EXISTS public.idx_agency_library_documents_org_id;
DROP INDEX IF EXISTS public.idx_bid_comparisons_org_id;
DROP INDEX IF EXISTS public.idx_bid_decompositions_org_id;
DROP INDEX IF EXISTS public.idx_bid_evaluations_org_id;
DROP INDEX IF EXISTS public.idx_bid_scoring_criteria_org_id;
DROP INDEX IF EXISTS public.idx_bid_scoring_templates_org_id;
DROP INDEX IF EXISTS public.idx_client_cash_flow_org_id;
DROP INDEX IF EXISTS public.idx_clients_org_id;
DROP INDEX IF EXISTS public.idx_delivery_reviews_org_id;
DROP INDEX IF EXISTS public.idx_msa_agreements_org_id;
DROP INDEX IF EXISTS public.idx_onboarding_deployments_org_id;
DROP INDEX IF EXISTS public.idx_onboarding_packages_org_id;
DROP INDEX IF EXISTS public.idx_projects_org_id;
DROP INDEX IF EXISTS public.idx_rfp_magic_tokens_org_id;
DROP INDEX IF EXISTS public.idx_usage_tracking_org_id;
DROP INDEX IF EXISTS public.idx_agency_partner_invitations_lead_org_id;
DROP INDEX IF EXISTS public.idx_agency_partner_invitations_vendor_org_id;
DROP INDEX IF EXISTS public.idx_invitation_requests_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partner_access_requests_lead_org_id;
DROP INDEX IF EXISTS public.idx_partner_access_requests_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_inbox_lead_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_inbox_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_response_versions_lead_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_response_versions_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_responses_lead_org_id;
DROP INDEX IF EXISTS public.idx_partner_rfp_responses_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partner_vouches_lead_org_id;
DROP INDEX IF EXISTS public.idx_partner_vouches_vendor_org_id;
DROP INDEX IF EXISTS public.idx_partnerships_lead_org_id;
DROP INDEX IF EXISTS public.idx_partnerships_vendor_org_id;


-- =====================================================================
-- DOWN PHASE 4: drop the foreign keys 079 added to organizations
--
-- By the deterministic name 079 mints, so this cannot catch a constraint
-- that predates it.
-- =====================================================================

DO $unrepoint$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('agency_library_documents',      'org_id'),
      ('agency_partner_invitations',    'lead_org_id'),
      ('agency_partner_invitations',    'vendor_org_id'),
      ('bid_comparisons',               'org_id'),
      ('bid_decompositions',            'org_id'),
      ('bid_evaluations',               'org_id'),
      ('bid_scoring_criteria',          'org_id'),
      ('bid_scoring_templates',         'org_id'),
      ('client_cash_flow',              'org_id'),
      ('clients',                       'org_id'),
      ('delivery_reviews',              'org_id'),
      ('invitation_requests',           'vendor_org_id'),
      ('msa_agreements',                'org_id'),
      ('onboarding_deployments',        'org_id'),
      ('onboarding_packages',           'org_id'),
      ('partner_access_requests',       'lead_org_id'),
      ('partner_access_requests',       'vendor_org_id'),
      ('partner_rfp_inbox',             'lead_org_id'),
      ('partner_rfp_inbox',             'vendor_org_id'),
      ('partner_rfp_response_versions', 'lead_org_id'),
      ('partner_rfp_response_versions', 'vendor_org_id'),
      ('partner_rfp_responses',         'lead_org_id'),
      ('partner_rfp_responses',         'vendor_org_id'),
      ('partner_vouches',               'lead_org_id'),
      ('partner_vouches',               'vendor_org_id'),
      ('partnerships',                  'lead_org_id'),
      ('partnerships',                  'vendor_org_id'),
      ('projects',                      'org_id'),
      ('rfp_magic_tokens',              'org_id'),
      ('usage_tracking',                'org_id')
    ) AS v(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   t.tbl, t.tbl || '_' || t.col || '_org_fkey');
  END LOOP;
END
$unrepoint$;


-- =====================================================================
-- DOWN PHASE 5: reverse the 30 column renames
-- =====================================================================

ALTER TABLE public.agency_library_documents      RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.bid_comparisons               RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.bid_decompositions            RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.bid_evaluations               RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.bid_scoring_criteria          RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.bid_scoring_templates         RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.client_cash_flow              RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.clients                       RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.delivery_reviews              RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.msa_agreements                RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.onboarding_deployments        RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.onboarding_packages           RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.projects                      RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.rfp_magic_tokens              RENAME COLUMN org_id TO agency_id;
ALTER TABLE public.usage_tracking                RENAME COLUMN org_id TO agency_id;

ALTER TABLE public.agency_partner_invitations    RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.agency_partner_invitations    RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partner_access_requests       RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.partner_access_requests       RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partner_rfp_inbox             RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.partner_rfp_inbox             RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partner_rfp_response_versions RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.partner_rfp_response_versions RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partner_rfp_responses         RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.partner_rfp_responses         RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partnerships                  RENAME COLUMN lead_org_id   TO agency_id;
ALTER TABLE public.partnerships                  RENAME COLUMN vendor_org_id TO partner_id;
ALTER TABLE public.partner_vouches               RENAME COLUMN lead_org_id   TO voucher_agency_id;
ALTER TABLE public.partner_vouches               RENAME COLUMN vendor_org_id TO vouched_partner_id;

ALTER TABLE public.invitation_requests           RENAME COLUMN vendor_org_id TO partner_id;


-- =====================================================================
-- DOWN PHASE 6: nullability
--
-- See limit 8 in the header. This is the least trustworthy phase in the
-- file: it restores nullability as the on-disk migration files describe it,
-- and those files are explicitly not authoritative. The columns below are
-- the ones whose creating file declares them nullable. Every other column
-- 079 made NOT NULL is left NOT NULL, on the reasoning that a NOT NULL that
-- should have been nullable fails loudly on the next insert, whereas a
-- nullable column that should have been NOT NULL corrupts quietly.
-- =====================================================================

-- agency_partner_invitations.partner_id: nullable by design in scripts/003 -
-- an invitation is addressed to an email before any account exists. 079's
-- vendor_org_id was left nullable, so there is nothing to undo here. Listed
-- so the reader knows it was considered.

-- No DROP NOT NULL statements. Every column 079 ran SET NOT NULL on either
-- was already NOT NULL in its creating migration, or is one where NOT NULL
-- is the correct state and the pre-079 declaration is unknown. Capture the
-- truth before applying 079 (limit 8) and add the DROP NOT NULL statements
-- here for whatever comes back as YES.


-- =====================================================================
-- DOWN PHASE 7: restore the foreign keys to profiles(id)
--
-- With NEW constraint names and ON DELETE CASCADE throughout. See limits 5
-- and 6. The seven tables that had no FK before 079 are deliberately absent
-- from this list, so they return to their original unconstrained state.
-- =====================================================================

DO $restore_fk$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('agency_library_documents',      'agency_id'),
      ('agency_partner_invitations',    'agency_id'),
      ('agency_partner_invitations',    'partner_id'),
      ('client_cash_flow',              'agency_id'),
      ('invitation_requests',           'partner_id'),
      ('msa_agreements',                'agency_id'),
      ('onboarding_deployments',        'agency_id'),
      ('onboarding_packages',           'agency_id'),
      ('partner_access_requests',       'agency_id'),
      ('partner_access_requests',       'partner_id'),
      ('partner_rfp_inbox',             'agency_id'),
      ('partner_rfp_inbox',             'partner_id'),
      ('partner_rfp_responses',         'agency_id'),
      ('partner_rfp_responses',         'partner_id'),
      ('partner_vouches',               'voucher_agency_id'),
      ('partner_vouches',               'vouched_partner_id'),
      ('partnerships',                  'agency_id'),
      ('partnerships',                  'partner_id'),
      ('projects',                      'agency_id'),
      ('usage_tracking',                'agency_id')
    ) AS v(tbl, col)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
      'REFERENCES public.profiles(id) ON DELETE CASCADE',
      t.tbl, t.tbl || '_' || t.col || '_profiles_fkey_restored', t.col
    );
  END LOOP;
END
$restore_fk$;

-- partner_rfp_response_versions.agency_id and .partner_id are absent above:
-- scripts/021 declares both as bare `UUID NOT NULL` with no reference, and
-- rfp_magic_tokens has no DDL anywhere on disk at all, so neither can be
-- restored to a state this repository knows.


-- =====================================================================
-- DOWN PHASE 8: drop the four helpers and the two new tables
--
-- CASCADE on the tables destroys the membership data. Re-read limits 1, 2,
-- 3 and 4 before running this.
-- =====================================================================

DROP FUNCTION IF EXISTS public.current_user_active_counterparty_user_ids();
DROP FUNCTION IF EXISTS public.current_user_visible_profile_ids();
DROP FUNCTION IF EXISTS public.current_user_admin_org_ids();
DROP FUNCTION IF EXISTS public.current_user_org_ids();

DROP TABLE IF EXISTS public.org_members  CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;


-- =====================================================================
-- DOWN PHASE 9: restore the 83 dropped policies, VERBATIM from
--               docs/schema-snapshot-2026-08-13.md
--
-- Predicates below are the live text as Postgres normalized it, which is why
-- they carry column qualification, no public. prefix, and ~~* rather than
-- ILIKE. That is what the database actually held on 2026-08-13.
--
-- REGENERATE THIS ENTIRE BLOCK FROM THE FRESH CAPTURE. See the top of the
-- header.
-- =====================================================================

-- ---- agency_library_documents ---------------------------------------
CREATE POLICY "Agency manages own library documents"
  ON public.agency_library_documents AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

-- ---- agency_partner_invitations (all five were TO public) ------------
CREATE POLICY "Agencies can create invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies can view their sent invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR SELECT TO public
  USING ((agency_id = auth.uid()));

CREATE POLICY "Agencies can update their invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR UPDATE TO public
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners can view their received invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR SELECT TO public
  USING (((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
    FROM profiles WHERE (profiles.id = auth.uid())))));

CREATE POLICY "Partners can update received invitations"
  ON public.agency_partner_invitations AS PERMISSIVE FOR UPDATE TO public
  USING (((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
    FROM profiles WHERE (profiles.id = auth.uid())))));

-- ---- assignment_agreements -------------------------------------------
CREATE POLICY "Agencies manage agreements for their project assignments"
  ON public.assignment_agreements AS PERMISSIVE FOR ALL TO authenticated
  USING ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN projects pr ON ((pa.project_id = pr.id))) WHERE (pr.agency_id = auth.uid()))))
  WITH CHECK ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN projects pr ON ((pa.project_id = pr.id))) WHERE (pr.agency_id = auth.uid()))));

CREATE POLICY "Partners read and update own assignment agreements"
  ON public.assignment_agreements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid()))));

CREATE POLICY "Partners update agreement signature fields"
  ON public.assignment_agreements AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid()))))
  WITH CHECK ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid()))));

-- ---- bid_* ------------------------------------------------------------
CREATE POLICY "Agencies manage own bid comparisons"
  ON public.bid_comparisons AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own bid decompositions"
  ON public.bid_decompositions AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own bid evaluations"
  ON public.bid_evaluations AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own scoring criteria"
  ON public.bid_scoring_criteria AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own scoring templates"
  ON public.bid_scoring_templates AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own bid evaluation scores"
  ON public.bid_evaluation_scores AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1 FROM bid_evaluations e
    WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM bid_evaluations e
    WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid())))));

-- ---- client_cash_flow, clients ---------------------------------------
CREATE POLICY "Agencies manage own client cash flow"
  ON public.client_cash_flow AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies manage own clients"
  ON public.clients AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

-- ---- delivery_reviews, delivery_review_scores ------------------------
CREATE POLICY "Agencies manage own delivery reviews"
  ON public.delivery_reviews AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Partners view own complete delivery reviews"
  ON public.delivery_reviews AS PERMISSIVE FOR SELECT TO authenticated
  USING (((status = 'complete'::text) AND (EXISTS ( SELECT 1 FROM partnerships p
    WHERE ((p.id = delivery_reviews.partnership_id) AND (p.partner_id = auth.uid()))))));

CREATE POLICY "Agencies manage own delivery review scores"
  ON public.delivery_review_scores AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1 FROM delivery_reviews r
    WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM delivery_reviews r
    WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid())))));

-- ---- invitation_requests ---------------------------------------------
CREATE POLICY "Partners can create requests"
  ON public.invitation_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

CREATE POLICY "Partners can view own requests"
  ON public.invitation_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

-- ---- msa_agreements ---------------------------------------------------
CREATE POLICY "Agency can manage their MSAs"
  ON public.msa_agreements AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

-- PROD-ONLY. Exists in production and nowhere else in this repository.
CREATE POLICY "Partners can view their MSAs"
  ON public.msa_agreements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- ---- notifications ----------------------------------------------------
CREATE POLICY "Scoped insert notifications"
  ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM partnerships p
    WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = notifications.user_id)
      AND (p.status = 'active'::text)))) OR (EXISTS ( SELECT 1 FROM partnerships p
    WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = notifications.user_id)
      AND (p.status = 'active'::text))))));

-- ---- onboarding_deployments -------------------------------------------
CREATE POLICY "Agencies manage onboarding deployments for own projects"
  ON public.onboarding_deployments AS PERMISSIVE FOR ALL TO authenticated
  USING ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))));

CREATE POLICY "Partners read onboarding deployments for their assignments"
  ON public.onboarding_deployments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((assignment_id IN ( SELECT pa.id FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid()))));

-- ---- onboarding_packages, onboarding_package_documents ---------------
CREATE POLICY "Agency full access onboarding packages for own projects"
  ON public.onboarding_packages AS PERMISSIVE FOR ALL TO authenticated
  USING ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK (((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))) AND (agency_id = auth.uid())));

CREATE POLICY "Partner reads onboarding packages for their partnership"
  ON public.onboarding_packages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "Partner updates review fields on own packages"
  ON public.onboarding_packages AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "Agency full access package document rows"
  ON public.onboarding_package_documents AS PERMISSIVE FOR ALL TO authenticated
  USING ((package_id IN ( SELECT op.id FROM (onboarding_packages op
    JOIN projects p ON ((p.id = op.project_id))) WHERE (p.agency_id = auth.uid()))))
  WITH CHECK ((package_id IN ( SELECT op.id FROM (onboarding_packages op
    JOIN projects p ON ((p.id = op.project_id))) WHERE (p.agency_id = auth.uid()))));

CREATE POLICY "Partner reads documents for their packages"
  ON public.onboarding_package_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING ((package_id IN ( SELECT onboarding_packages.id FROM onboarding_packages
    WHERE (onboarding_packages.partnership_id IN ( SELECT partnerships.id
      FROM partnerships WHERE (partnerships.partner_id = auth.uid()))))));

-- ---- partner_access_requests ------------------------------------------
CREATE POLICY "Partners can create requests"
  ON public.partner_access_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

CREATE POLICY "Agencies can view requests to them"
  ON public.partner_access_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners can view their requests"
  ON public.partner_access_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

CREATE POLICY "Agencies can update requests to them"
  ON public.partner_access_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((agency_id = auth.uid()));

-- ---- partner_rfp_inbox -------------------------------------------------
CREATE POLICY "Agencies insert partner RFP inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies select own partner RFP inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners select inbox rows by partner_id"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

CREATE POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((partner_id = auth.uid()) OR ((recipient_email IS NOT NULL) AND (EXISTS (
    SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid())
      AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.recipient_email)))))))));

-- ---- partner_rfp_response_versions -------------------------------------
CREATE POLICY "Partners insert own response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

CREATE POLICY "Agencies read owned response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners read own response versions"
  ON public.partner_rfp_response_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

-- ---- partner_rfp_responses ---------------------------------------------
CREATE POLICY "Partners insert RFP responses for their inbox"
  ON public.partner_rfp_responses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((partner_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM partner_rfp_inbox i
    WHERE ((i.id = partner_rfp_responses.inbox_item_id)
      AND (i.agency_id = partner_rfp_responses.agency_id)
      AND ((i.partner_id = auth.uid()) OR ((i.recipient_email IS NOT NULL) AND (EXISTS (
        SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid())
          AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM i.recipient_email)))))))))))));

CREATE POLICY "Agencies select RFP responses they own"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners read response status and feedback"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

CREATE POLICY "Partners select own RFP responses"
  ON public.partner_rfp_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

CREATE POLICY "Agencies update response status and feedback"
  ON public.partner_rfp_responses AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Partners update own RFP responses"
  ON public.partner_rfp_responses AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((partner_id = auth.uid()));

-- ---- partner_status_updates ---------------------------------------------
CREATE POLICY "Partners can insert their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "Agencies can view status updates for their projects"
  ON public.partner_status_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))));

CREATE POLICY "Partners can view their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "Agencies can resolve status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- PROD-ONLY.
CREATE POLICY "Partners can update their own status updates"
  ON public.partner_status_updates AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- ---- partner_vouches (both were TO public) -------------------------------
CREATE POLICY "Agencies can remove their vouch"
  ON public.partner_vouches AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = voucher_agency_id));

CREATE POLICY "Agencies can vouch"
  ON public.partner_vouches AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = voucher_agency_id));

-- ---- partnerships ---------------------------------------------------------
CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "Agencies can view their partnerships"
  ON public.partnerships AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners can view their partnerships"
  ON public.partnerships AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partner_id = auth.uid()));

-- Restored with USING only and NO WITH CHECK, exactly as it was live. 079
-- added a WITH CHECK to close a hole where an agency could rewrite
-- agency_id to somebody else's. Restoring it verbatim reopens that hole,
-- which is what "restore verbatim" means and why it is called out here.
CREATE POLICY "Agencies can update their partnerships"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "Partners can claim partnership by email"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO public
  USING (((partner_id IS NULL) AND (partner_email ~~* ( SELECT profiles.email
    FROM profiles WHERE (profiles.id = auth.uid())))))
  WITH CHECK ((partner_id = auth.uid()));

CREATE POLICY "Partners can update partnership status"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((partner_id = auth.uid())) WITH CHECK ((partner_id = auth.uid()));

-- ---- payment_milestones ----------------------------------------------------
CREATE POLICY "Agency can manage payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR ALL TO authenticated
  USING ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- PROD-ONLY.
CREATE POLICY "Partners can view their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "Partners read payment milestones for their partnerships"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (((partnership_id IS NOT NULL) AND (partnership_id IN ( SELECT partnerships.id
    FROM partnerships WHERE (partnerships.partner_id = auth.uid())))));

-- PROD-ONLY.
CREATE POLICY "Partners read their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- ---- profiles: all THREE come back, because 079 folded them into one -------
CREATE POLICY "Agencies read profiles of their partners"
  ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM partnerships p
    WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = profiles.id)))));

CREATE POLICY "Partners read lead agency profiles for their partnerships"
  ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM partnerships p
    WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = profiles.id)))));

-- PROD-ONLY, and the most load-bearing SELECT policy in the product.
CREATE POLICY "Users can view profiles of partnership members"
  ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((id = auth.uid()) OR (EXISTS ( SELECT 1 FROM partnerships
    WHERE ((partnerships.partner_id = auth.uid()) AND (partnerships.agency_id = profiles.id))))
    OR (EXISTS ( SELECT 1 FROM partnerships
    WHERE ((partnerships.agency_id = auth.uid()) AND (partnerships.partner_id = profiles.id))))));

-- ---- project_assignments ----------------------------------------------------
CREATE POLICY "assignments_agency_all"
  ON public.project_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.agency_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.agency_id = auth.uid()))));

CREATE POLICY "assignments_partner_select"
  ON public.project_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

CREATE POLICY "assignments_partner_update"
  ON public.project_assignments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- ---- project_documents -------------------------------------------------------
CREATE POLICY "Agencies can view documents for their projects"
  ON public.project_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM projects p
    WHERE ((p.id = project_documents.project_id) AND (p.agency_id = auth.uid())))));

CREATE POLICY "Partners can view documents for their assignments"
  ON public.project_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((visibility = 'all_partners'::text) AND (EXISTS ( SELECT 1
    FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.project_id = project_documents.project_id) AND (p.partner_id = auth.uid())))))
    OR ((visibility = 'assignment'::text) AND (EXISTS ( SELECT 1
    FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.id = project_documents.assignment_id) AND (p.partner_id = auth.uid())))))));

-- ---- project_messages ---------------------------------------------------------
CREATE POLICY "Agencies can view messages for their projects"
  ON public.project_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM projects p
    WHERE ((p.id = project_messages.project_id) AND (p.agency_id = auth.uid())))));

CREATE POLICY "Partners can view messages for their assignments"
  ON public.project_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.id = project_messages.assignment_id) AND (p.partner_id = auth.uid())))));

-- ---- projects -------------------------------------------------------------------
CREATE POLICY "projects_agency_select"
  ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "projects_agency_insert"
  ON public.projects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "projects_agency_update"
  ON public.projects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));

CREATE POLICY "projects_agency_delete"
  ON public.projects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((agency_id = auth.uid()));

CREATE POLICY "projects_partner_select_assigned"
  ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM (project_assignments pa
    JOIN partnerships p ON ((p.id = pa.partnership_id)))
    WHERE ((pa.project_id = projects.id) AND (p.partner_id = auth.uid())))));

-- ---- rfp_magic_tokens (PROD-ONLY, and TO public) ----------------------------------
CREATE POLICY "Agency can manage their own tokens"
  ON public.rfp_magic_tokens AS PERMISSIVE FOR ALL TO public
  USING ((agency_id = auth.uid()));

-- ---- usage_tracking ----------------------------------------------------------------
CREATE POLICY "Agencies manage own usage tracking"
  ON public.usage_tracking AS PERMISSIVE FOR ALL TO authenticated
  USING ((agency_id = auth.uid())) WITH CHECK ((agency_id = auth.uid()));


COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. Read-only.
-- =====================================================================
--
-- 1. Policy count is back to what it was.
--   SELECT count(*) FROM pg_policies WHERE schemaname='public';
--   -- 104 if the fresh capture had 104
--
-- 2. Full diff against the pre-079 capture. This is the check that matters
--    and the other two are conveniences.
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
--   -- diff against the fresh pre-079 capture. Zero differences.
--
-- 3. No org_id column survives, and the old names are all back.
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND column_name IN ('org_id','lead_org_id','vendor_org_id');
--   -- expect ZERO rows
--
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public'
--     AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
--   ORDER BY 1,2;
--   -- expect 30 rows
--
-- 4. The helpers and the tables are gone.
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND proname LIKE 'current\_user\_%';
--   -- expect zero rows
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('organizations','org_members');
--   -- expect zero rows. primary_contact_user_id goes with the table; there
--   -- is no separate column check to run.
--
-- 5. handle_new_user is the 078 body: no organizations, no org_members, and
--    still no email literal and no is_paid.
--   SELECT pg_get_functiondef(p.oid) FROM pg_proc p
--   JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname='handle_new_user';
--
-- 6. As a real logged-in user, counts match the pre-079 numbers you wrote
--    down. Any decrease is a lockout, any increase is a leak.
--   SELECT count(*) FROM public.projects;
-- =====================================================================
