-- =====================================================================
-- docs/schema-baseline-2026-08-13.sql
--
-- THIS IS A REFERENCE ARTIFACT. IT IS NOT A MIGRATION. DO NOT RUN IT.
--
-- It deliberately does NOT live in supabase/migrations/. A file in that
-- directory will eventually be run by someone working through the sequence
-- in order, and running this one against the live database would attempt to
-- create 104 policies that already exist. Every statement below would fail
-- with 42710 duplicate_object, or - worse, if someone "helpfully" adds
-- DROP POLICY IF EXISTS in front of each - would briefly drop and recreate
-- every access rule in the system.
--
-- WHAT IT IS FOR
-- The on-disk migration history cannot reproduce the live database
-- (docs/organizations-m1-discovery.md, Finding Zero). This file closes that
-- gap for row level security specifically: it is every policy that is live
-- in production on 2026-08-13, expressed as the CREATE POLICY statement that
-- would produce it, with a comment on each recording whether an equivalent
-- exists on disk today and where.
--
-- SOURCE OF TRUTH
-- docs/schema-snapshot-2026-08-13.md, a pg_policies dump taken directly from
-- the live Supabase database. Where that snapshot and the repository disagree,
-- the snapshot wins. Predicates below are reproduced as Postgres normalized
-- them, which is why they carry column qualification and no "public." schema
-- prefix - that is what the database actually holds, not a transcription
-- choice.
--
-- SCOPE AND LIMITS
--   - Policies only. No CREATE TABLE, no columns, no indexes, no triggers,
--     no grants. Those are NOT captured anywhere and remain unreconstructed.
--   - 38 tables, 104 policies. All 38 tables have RLS enabled and at least
--     one policy. No table is exposed and none is locked out.
--   - The table "rfps" does not exist in the public schema despite appearing
--     in the migration log and in application code comments.
--
-- READ WITH: docs/schema-truth.md
-- =====================================================================


-- ---------------------------------------------------------------------
-- agency_library_documents
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:67
CREATE POLICY "Agency manages own library documents"
  ON public.agency_library_documents
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- agency_partner_invitations
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/003_agency_partner_invitations.sql:34
CREATE POLICY "Agencies can create invitations"
  ON public.agency_partner_invitations
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/003_agency_partner_invitations.sql:27
CREATE POLICY "Agencies can view their sent invitations"
  ON public.agency_partner_invitations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((agency_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/003_agency_partner_invitations.sql:48 as "Partners can
--          view invitations to them"
CREATE POLICY "Partners can view their received invitations"
  ON public.agency_partner_invitations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
    FROM profiles
    WHERE (profiles.id = auth.uid())))));

-- on disk: YES, same name, at scripts/003_agency_partner_invitations.sql:41
CREATE POLICY "Agencies can update their invitations"
  ON public.agency_partner_invitations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((agency_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/003_agency_partner_invitations.sql:58 as "Partners can
--          update invitations to them"
CREATE POLICY "Partners can update received invitations"
  ON public.agency_partner_invitations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
    FROM profiles
    WHERE (profiles.id = auth.uid())))));


-- ---------------------------------------------------------------------
-- assignment_agreements
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/012-onboarding-nda-sow.sql:58
CREATE POLICY "Agencies manage agreements for their project assignments"
  ON public.assignment_agreements
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN projects pr ON ((pa.project_id = pr.id)))
    WHERE (pr.agency_id = auth.uid()))))
  WITH CHECK ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN projects pr ON ((pa.project_id = pr.id)))
    WHERE (pr.agency_id = auth.uid()))));

-- on disk: YES, same name, at scripts/012-onboarding-nda-sow.sql:75
CREATE POLICY "Partners read and update own assignment agreements"
  ON public.assignment_agreements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE (p.partner_id = auth.uid()))));

-- on disk: YES, same name, at scripts/012-onboarding-nda-sow.sql:85
CREATE POLICY "Partners update agreement signature fields"
  ON public.assignment_agreements
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE (p.partner_id = auth.uid()))))
  WITH CHECK ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE (p.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- bid_comparisons
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/064_bid_analysis_schema.sql:49
CREATE POLICY "Agencies manage own bid comparisons"
  ON public.bid_comparisons
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- bid_decompositions
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/064_bid_analysis_schema.sql:40
CREATE POLICY "Agencies manage own bid decompositions"
  ON public.bid_decompositions
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- bid_evaluation_scores
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/065_bid_scoring_schema.sql:101
CREATE POLICY "Agencies manage own bid evaluation scores"
  ON public.bid_evaluation_scores
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM bid_evaluations e
    WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
    FROM bid_evaluations e
    WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid())))));


-- ---------------------------------------------------------------------
-- bid_evaluations
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/065_bid_scoring_schema.sql:92
CREATE POLICY "Agencies manage own bid evaluations"
  ON public.bid_evaluations
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- bid_scoring_criteria
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/065_bid_scoring_schema.sql:74
CREATE POLICY "Agencies manage own scoring criteria"
  ON public.bid_scoring_criteria
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- bid_scoring_templates
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/065_bid_scoring_schema.sql:83
CREATE POLICY "Agencies manage own scoring templates"
  ON public.bid_scoring_templates
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- brief_interpretations
-- ---------------------------------------------------------------------
-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can manage their own interpretations"
  ON public.brief_interpretations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));


-- ---------------------------------------------------------------------
-- client_cash_flow
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/037-client-cash-flow.sql:21
CREATE POLICY "Agencies manage own client cash flow"
  ON public.client_cash_flow
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/077_client_profiles.sql:73
CREATE POLICY "Agencies manage own clients"
  ON public.clients
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- contact_submissions
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/026-security-fixes.sql:9
CREATE POLICY "Anyone can insert contact submissions"
  ON public.contact_submissions
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- on disk: YES, same name, at scripts/026-security-fixes.sql:16
CREATE POLICY "Admins can read contact submissions"
  ON public.contact_submissions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM profiles
    WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));


-- ---------------------------------------------------------------------
-- delivery_review_scores
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/066_delivery_review_schema.sql:86
CREATE POLICY "Agencies manage own delivery review scores"
  ON public.delivery_review_scores
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM delivery_reviews r
    WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
    FROM delivery_reviews r
    WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid())))));


-- ---------------------------------------------------------------------
-- delivery_reviews
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/066_delivery_review_schema.sql:64
CREATE POLICY "Agencies manage own delivery reviews"
  ON public.delivery_reviews
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: YES, same name, at
--          supabase/migrations/066_delivery_review_schema.sql:71
CREATE POLICY "Partners view own complete delivery reviews"
  ON public.delivery_reviews
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((status = 'complete'::text) AND (EXISTS ( SELECT 1
    FROM partnerships p
    WHERE ((p.id = delivery_reviews.partnership_id) AND (p.partner_id = auth.uid()))))));


-- ---------------------------------------------------------------------
-- email_connections
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/062_email_connections.sql:35
CREATE POLICY "Users manage their own email connections"
  ON public.email_connections
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));


-- ---------------------------------------------------------------------
-- invitation_requests
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/009-comprehensive-auth-setup.SKIP:146
CREATE POLICY "Partners can create requests"
  ON public.invitation_requests
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/009-comprehensive-auth-setup.SKIP:152 as "Agencies can
--          view requests sent to their email"
CREATE POLICY "Agencies can view requests to their email"
  ON public.invitation_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_email = ( SELECT profiles.email
    FROM profiles
    WHERE (profiles.id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/009-comprehensive-auth-setup.SKIP:140 as "Partners can
--          view their own requests"
CREATE POLICY "Partners can view own requests"
  ON public.invitation_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/009-comprehensive-auth-setup.SKIP:162 as "Agencies can
--          update requests sent to them"
CREATE POLICY "Agencies can update requests to their email"
  ON public.invitation_requests
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((agency_email = ( SELECT profiles.email
    FROM profiles
    WHERE (profiles.id = auth.uid()))));


-- ---------------------------------------------------------------------
-- msa_agreements
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/029-msa-
--          payments.SKIP:33 as "Agencies manage own MSA agreements" (file
--          is marked .SKIP, i.e. never to be run)
CREATE POLICY "Agency can manage their MSAs"
  ON public.msa_agreements
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Partners can view their MSAs"
  ON public.msa_agreements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/026-security-fixes.sql:45
CREATE POLICY "Scoped insert notifications"
  ON public.notifications
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
    FROM partnerships p
    WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = notifications.user_id) AND (p.status = 'active'::text)))) OR (EXISTS ( SELECT 1
    FROM partnerships p
    WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = notifications.user_id) AND (p.status = 'active'::text))))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can view own notifications"
  ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()));


-- ---------------------------------------------------------------------
-- onboarding_deployments
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/012-onboarding-nda-sow.sql:37
CREATE POLICY "Agencies manage onboarding deployments for own projects"
  ON public.onboarding_deployments
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- on disk: YES, same name, at scripts/012-onboarding-nda-sow.sql:47
CREATE POLICY "Partners read onboarding deployments for their assignments"
  ON public.onboarding_deployments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((assignment_id IN ( SELECT pa.id
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE (p.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- onboarding_package_documents
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:105
CREATE POLICY "Agency full access package document rows"
  ON public.onboarding_package_documents
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((package_id IN ( SELECT op.id
    FROM (onboarding_packages op
    JOIN projects p ON ((p.id = op.project_id)))
    WHERE (p.agency_id = auth.uid()))))
  WITH CHECK ((package_id IN ( SELECT op.id
    FROM (onboarding_packages op
    JOIN projects p ON ((p.id = op.project_id)))
    WHERE (p.agency_id = auth.uid()))));

-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:124
CREATE POLICY "Partner reads documents for their packages"
  ON public.onboarding_package_documents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((package_id IN ( SELECT onboarding_packages.id
    FROM onboarding_packages
    WHERE (onboarding_packages.partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))))));


-- ---------------------------------------------------------------------
-- onboarding_packages
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:74
CREATE POLICY "Agency full access onboarding packages for own projects"
  ON public.onboarding_packages
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK (((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))) AND (agency_id = auth.uid())));

-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:86
CREATE POLICY "Partner reads onboarding packages for their partnership"
  ON public.onboarding_packages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- on disk: YES, same name, at scripts/024-onboarding-documents.sql:94
CREATE POLICY "Partner updates review fields on own packages"
  ON public.onboarding_packages
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- partner_access_requests
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/008-partner-access-requests.sql:32
CREATE POLICY "Partners can create requests"
  ON public.partner_access_requests
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/008-partner-access-requests.sql:39
CREATE POLICY "Agencies can view requests to them"
  ON public.partner_access_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/008-partner-access-requests.sql:25
CREATE POLICY "Partners can view their requests"
  ON public.partner_access_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/008-partner-access-requests.sql:46
CREATE POLICY "Agencies can update requests to them"
  ON public.partner_access_requests
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- partner_rfp_inbox
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/013-partner-rfp-inbox.sql:35
CREATE POLICY "Agencies insert partner RFP inbox rows"
  ON public.partner_rfp_inbox
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/013-partner-rfp-inbox.sql:40
CREATE POLICY "Agencies select own partner RFP inbox rows"
  ON public.partner_rfp_inbox
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/013-partner-rfp-inbox.sql:45
CREATE POLICY "Partners select inbox rows by partner_id"
  ON public.partner_rfp_inbox
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/013-partner-rfp-inbox.sql:50
CREATE POLICY "Partners select inbox rows by recipient email"
  ON public.partner_rfp_inbox
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
    FROM profiles pr
    WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.recipient_email))))))));

-- on disk: YES, same name, at scripts/013-partner-rfp-inbox.sql:62
CREATE POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((partner_id = auth.uid()) OR ((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
    FROM profiles pr
    WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.recipient_email)))))))));


-- ---------------------------------------------------------------------
-- partner_rfp_response_versions
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/021-bid-response-versions.sql:24,
--          scripts/023-version-history-rls-fix.sql:12
CREATE POLICY "Partners insert own response versions"
  ON public.partner_rfp_response_versions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/021-bid-response-versions.sql:38,
--          scripts/023-version-history-rls-fix.sql:19
CREATE POLICY "Agencies read owned response versions"
  ON public.partner_rfp_response_versions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/021-bid-response-versions.sql:31,
--          scripts/023-version-history-rls-fix.sql:5
CREATE POLICY "Partners read own response versions"
  ON public.partner_rfp_response_versions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));


-- ---------------------------------------------------------------------
-- partner_rfp_responses
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at scripts/014-partner-rfp-responses.sql:37
CREATE POLICY "Partners insert RFP responses for their inbox"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((partner_id = auth.uid()) AND (EXISTS ( SELECT 1
    FROM partner_rfp_inbox i
    WHERE ((i.id = partner_rfp_responses.inbox_item_id) AND (i.agency_id = partner_rfp_responses.agency_id) AND ((i.partner_id = auth.uid()) OR ((i.recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
    FROM profiles pr
    WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM i.recipient_email)))))))))))));

-- on disk: YES, same name, at scripts/014-partner-rfp-responses.sql:65
CREATE POLICY "Agencies select RFP responses they own"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/018-bid-status-and-feedback.sql:34
CREATE POLICY "Partners read response status and feedback"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/014-partner-rfp-responses.sql:32
CREATE POLICY "Partners select own RFP responses"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/018-bid-status-and-feedback.sql:25
CREATE POLICY "Agencies update response status and feedback"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/014-partner-rfp-responses.sql:60
CREATE POLICY "Partners update own RFP responses"
  ON public.partner_rfp_responses
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((partner_id = auth.uid()));


-- ---------------------------------------------------------------------
-- partner_status_updates
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/028-partner-
--          status-updates.sql:29 as "Partners insert status updates for own
--          assignment"
CREATE POLICY "Partners can insert their own status updates"
  ON public.partner_status_updates
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/028-partner-
--          status-updates.sql:41 as "Agency read status updates for own
--          projects"
CREATE POLICY "Agencies can view status updates for their projects"
  ON public.partner_status_updates
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/028-partner-
--          status-updates.sql:23 as "Partners read own status updates"
CREATE POLICY "Partners can view their own status updates"
  ON public.partner_status_updates
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/028-partner-
--          status-updates.sql:47 as "Agency update resolve flag on status
--          updates"
CREATE POLICY "Agencies can resolve status updates"
  ON public.partner_status_updates
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Partners can update their own status updates"
  ON public.partner_status_updates
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- partner_vouches
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at
--          supabase/migrations/053_create_partner_vouches.sql:19
CREATE POLICY "Agencies can remove their vouch"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = voucher_agency_id));

-- on disk: YES, same name, at
--          supabase/migrations/053_create_partner_vouches.sql:16
CREATE POLICY "Agencies can vouch"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = voucher_agency_id));

-- on disk: YES, same name, at
--          supabase/migrations/053_create_partner_vouches.sql:13
CREATE POLICY "Anyone can count vouches"
  ON public.partner_vouches
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);


-- ---------------------------------------------------------------------
-- partnership_profile_context
-- ---------------------------------------------------------------------
-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can insert their own context"
  ON public.partnership_profile_context
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can read their own context"
  ON public.partnership_profile_context
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can update their own context"
  ON public.partnership_profile_context
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()));


-- ---------------------------------------------------------------------
-- partnerships
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:180 as "Agencies can create partnerships
--          (invite)"
CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/010-closed-ecosystem-schema.sql:172
CREATE POLICY "Agencies can view their partnerships"
  ON public.partnerships
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at scripts/010-closed-ecosystem-schema.sql:176
CREATE POLICY "Partners can view their partnerships"
  ON public.partnerships
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partner_id = auth.uid()));

-- on disk: YES, same name, at scripts/010-closed-ecosystem-schema.sql:184
CREATE POLICY "Agencies can update their partnerships"
  ON public.partnerships
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: YES, same name, at
--          supabase/migrations/045_partnerships_claim_by_email_policy.sql:1
CREATE POLICY "Partners can claim partnership by email"
  ON public.partnerships
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((partner_id IS NULL) AND (partner_email ~~* ( SELECT profiles.email
    FROM profiles
    WHERE (profiles.id = auth.uid())))))
  WITH CHECK ((partner_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:188 as "Partners can accept partnerships"
CREATE POLICY "Partners can update partnership status"
  ON public.partnerships
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((partner_id = auth.uid()))
  WITH CHECK ((partner_id = auth.uid()));


-- ---------------------------------------------------------------------
-- payment_milestones
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/029-msa-
--          payments.SKIP:63 as "Agencies manage own payment milestones"
--          (file is marked .SKIP)
CREATE POLICY "Agency can manage payment milestones"
  ON public.payment_milestones
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id
    FROM projects
    WHERE (projects.agency_id = auth.uid()))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Partners can view their payment milestones"
  ON public.payment_milestones
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- on disk: YES, same name, at scripts/030-partner-payments-rls.sql:9
CREATE POLICY "Partners read payment milestones for their partnerships"
  ON public.payment_milestones
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((partnership_id IS NOT NULL) AND (partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid())))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Partners read their payment milestones"
  ON public.payment_milestones
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor:
--          scripts/001_create_profiles.sql:22 as "profiles_insert_own"
CREATE POLICY "Enable insert for authenticated users only"
  ON public.profiles
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = id));

-- on disk: YES, same name, at scripts/029-msa-payments.SKIP:6
CREATE POLICY "Agencies read profiles of their partners"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM partnerships p
    WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = profiles.id)))));

-- on disk: YES, same name, at scripts/016-marketplace-discoverability.sql:8
CREATE POLICY "Authenticated users can read discoverable profiles"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_discoverable = true));

-- on disk: YES, same name, at scripts/030-partner-payments-rls.sql:20
CREATE POLICY "Partners read lead agency profiles for their partnerships"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM partnerships p
    WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = profiles.id)))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Users can view profiles of partnership members"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = auth.uid()) OR (EXISTS ( SELECT 1
    FROM partnerships
    WHERE ((partnerships.partner_id = auth.uid()) AND (partnerships.agency_id = profiles.id)))) OR (EXISTS ( SELECT 1
    FROM partnerships
    WHERE ((partnerships.agency_id = auth.uid()) AND (partnerships.partner_id = profiles.id))))));

-- on disk: YES, same name, at scripts/009-comprehensive-auth-setup.SKIP:179
CREATE POLICY "Users can update own profile"
  ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = id));


-- ---------------------------------------------------------------------
-- project_assignments
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:208 as "Agencies can manage assignments for
--          their projects"
CREATE POLICY "assignments_agency_all"
  ON public.project_assignments
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.agency_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.agency_id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:214 as "Partners can view their
--          assignments"
CREATE POLICY "assignments_partner_select"
  ON public.project_assignments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:220 as "Partners can update their
--          assignments (submit bids)"
CREATE POLICY "assignments_partner_update"
  ON public.project_assignments
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))))
  WITH CHECK ((partnership_id IN ( SELECT partnerships.id
    FROM partnerships
    WHERE (partnerships.partner_id = auth.uid()))));


-- ---------------------------------------------------------------------
-- project_documents
-- ---------------------------------------------------------------------
-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Uploaders can delete their documents"
  ON public.project_documents
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((uploaded_by = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:238 on the differently-named table
--          shared_documents ("Users can upload documents to their
--          assignments"); shared_documents does not exist live
CREATE POLICY "Users can upload documents"
  ON public.project_documents
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((uploaded_by = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:227 on the differently-named table
--          shared_documents ("Users can view documents in their
--          assignments"); shared_documents does not exist live
CREATE POLICY "Agencies can view documents for their projects"
  ON public.project_documents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM projects p
    WHERE ((p.id = project_documents.project_id) AND (p.agency_id = auth.uid())))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:227 on the differently-named table
--          shared_documents; shared_documents does not exist live
CREATE POLICY "Partners can view documents for their assignments"
  ON public.project_documents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((((visibility = 'all_partners'::text) AND (EXISTS ( SELECT 1
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.project_id = project_documents.project_id) AND (p.partner_id = auth.uid()))))) OR ((visibility = 'assignment'::text) AND (EXISTS ( SELECT 1
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.id = project_documents.assignment_id) AND (p.partner_id = auth.uid())))))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Uploaders can update their documents"
  ON public.project_documents
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((uploaded_by = auth.uid()));


-- ---------------------------------------------------------------------
-- project_messages
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:261 on the differently-named table
--          assignment_messages ("Users can send messages in their
--          assignments"); assignment_messages does not exist live
CREATE POLICY "Users can send messages"
  ON public.project_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((sender_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:251 on the differently-named table
--          assignment_messages; assignment_messages does not exist live
CREATE POLICY "Agencies can view messages for their projects"
  ON public.project_messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM projects p
    WHERE ((p.id = project_messages.project_id) AND (p.agency_id = auth.uid())))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:251 on the differently-named table
--          assignment_messages; assignment_messages does not exist live
CREATE POLICY "Partners can view messages for their assignments"
  ON public.project_messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM (project_assignments pa
    JOIN partnerships p ON ((pa.partnership_id = p.id)))
    WHERE ((pa.id = project_messages.assignment_id) AND (p.partner_id = auth.uid())))));

-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Senders can update their messages"
  ON public.project_messages
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((sender_id = auth.uid()));


-- ---------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------
-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:193 as "Agencies can manage their projects"
--          (one FOR ALL policy; live has it split into four)
CREATE POLICY "projects_agency_delete"
  ON public.projects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:193 as "Agencies can manage their projects"
--          (one FOR ALL policy; live has it split into four)
CREATE POLICY "projects_agency_insert"
  ON public.projects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((agency_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:193 as "Agencies can manage their projects"
--          (one FOR ALL policy; live has it split into four)
CREATE POLICY "projects_agency_select"
  ON public.projects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((agency_id = auth.uid()));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:197 as "Partners can view assigned
--          projects"
CREATE POLICY "projects_partner_select_assigned"
  ON public.projects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
    FROM (project_assignments pa
    JOIN partnerships p ON ((p.id = pa.partnership_id)))
    WHERE ((pa.project_id = projects.id) AND (p.partner_id = auth.uid())))));

-- on disk: NO policy of this name. Nearest ancestor: scripts/010-closed-
--          ecosystem-schema.sql:193 as "Agencies can manage their projects"
--          (one FOR ALL policy; live has it split into four)
CREATE POLICY "projects_agency_update"
  ON public.projects
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- rfp_magic_tokens
-- ---------------------------------------------------------------------
-- on disk: NO. This policy exists nowhere in the repository, under any
--          name.
CREATE POLICY "Agency can manage their own tokens"
  ON public.rfp_magic_tokens
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((agency_id = auth.uid()));


-- ---------------------------------------------------------------------
-- usage_tracking
-- ---------------------------------------------------------------------
-- on disk: YES, same name, at supabase/migrations/067_usage_tracking.sql:21
CREATE POLICY "Agencies manage own usage tracking"
  ON public.usage_tracking
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((agency_id = auth.uid()))
  WITH CHECK ((agency_id = auth.uid()));

