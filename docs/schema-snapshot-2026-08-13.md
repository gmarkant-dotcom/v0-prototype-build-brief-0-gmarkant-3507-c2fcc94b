# Schema snapshot, 2026 08 13

Source: pg_policies dump run directly against the live Supabase database by Greg.
This file is authoritative. The migration history on disk cannot reproduce the live
database (see docs/organizations-m1-discovery.md, Finding Zero), so any migration that
drops or replaces a policy must be authored against this file, not against the repo.

Captured with:

    SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;

Also captured: all 38 public tables have row level security enabled and at least one
policy. No table is exposed (rls disabled) and none is locked out (zero policies).
The table "rfps" does not exist in the public schema.

## Policies

tablename,policyname,cmd,roles,permissive,qual,with_check
agency_library_documents,Agency manages own library documents,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
agency_partner_invitations,Agencies can create invitations,INSERT,{public},PERMISSIVE,null,(agency_id = auth.uid())
agency_partner_invitations,Agencies can update their invitations,UPDATE,{public},PERMISSIVE,(agency_id = auth.uid()),null
agency_partner_invitations,Agencies can view their sent invitations,SELECT,{public},PERMISSIVE,(agency_id = auth.uid()),null
agency_partner_invitations,Partners can update received invitations,UPDATE,{public},PERMISSIVE,"((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = auth.uid()))))",null
agency_partner_invitations,Partners can view their received invitations,SELECT,{public},PERMISSIVE,"((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = auth.uid()))))",null
assignment_agreements,Agencies manage agreements for their project assignments,ALL,{authenticated},PERMISSIVE,"(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN projects pr ON ((pa.project_id = pr.id)))
  WHERE (pr.agency_id = auth.uid())))","(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN projects pr ON ((pa.project_id = pr.id)))
  WHERE (pr.agency_id = auth.uid())))"
assignment_agreements,Partners read and update own assignment agreements,SELECT,{authenticated},PERMISSIVE,"(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE (p.partner_id = auth.uid())))",null
assignment_agreements,Partners update agreement signature fields,UPDATE,{authenticated},PERMISSIVE,"(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE (p.partner_id = auth.uid())))","(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE (p.partner_id = auth.uid())))"
bid_comparisons,Agencies manage own bid comparisons,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
bid_decompositions,Agencies manage own bid decompositions,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
bid_evaluation_scores,Agencies manage own bid evaluation scores,ALL,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM bid_evaluations e
  WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid()))))","(EXISTS ( SELECT 1
   FROM bid_evaluations e
  WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid()))))"
bid_evaluations,Agencies manage own bid evaluations,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
bid_scoring_criteria,Agencies manage own scoring criteria,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
bid_scoring_templates,Agencies manage own scoring templates,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
brief_interpretations,Users can manage their own interpretations,ALL,{public},PERMISSIVE,(auth.uid() = user_id),(auth.uid() = user_id)
client_cash_flow,Agencies manage own client cash flow,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
clients,Agencies manage own clients,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
contact_submissions,Admins can read contact submissions,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))))",null
contact_submissions,Anyone can insert contact submissions,INSERT,"{anon,authenticated}",PERMISSIVE,null,true
delivery_review_scores,Agencies manage own delivery review scores,ALL,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM delivery_reviews r
  WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid()))))","(EXISTS ( SELECT 1
   FROM delivery_reviews r
  WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid()))))"
delivery_reviews,Agencies manage own delivery reviews,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
delivery_reviews,Partners view own complete delivery reviews,SELECT,{authenticated},PERMISSIVE,"((status = 'complete'::text) AND (EXISTS ( SELECT 1
   FROM partnerships p
  WHERE ((p.id = delivery_reviews.partnership_id) AND (p.partner_id = auth.uid())))))",null
email_connections,Users manage their own email connections,ALL,{public},PERMISSIVE,(auth.uid() = user_id),(auth.uid() = user_id)
invitation_requests,Agencies can update requests to their email,UPDATE,{authenticated},PERMISSIVE,"(agency_email = ( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = auth.uid())))",null
invitation_requests,Agencies can view requests to their email,SELECT,{authenticated},PERMISSIVE,"(agency_email = ( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = auth.uid())))",null
invitation_requests,Partners can create requests,INSERT,{authenticated},PERMISSIVE,null,(partner_id = auth.uid())
invitation_requests,Partners can view own requests,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
msa_agreements,Agency can manage their MSAs,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
msa_agreements,Partners can view their MSAs,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
notifications,Scoped insert notifications,INSERT,{authenticated},PERMISSIVE,null,"((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM partnerships p
  WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = notifications.user_id) AND (p.status = 'active'::text)))) OR (EXISTS ( SELECT 1
   FROM partnerships p
  WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = notifications.user_id) AND (p.status = 'active'::text)))))"
notifications,Users can update own notifications,UPDATE,{authenticated},PERMISSIVE,(user_id = auth.uid()),null
notifications,Users can view own notifications,SELECT,{authenticated},PERMISSIVE,(user_id = auth.uid()),null
onboarding_deployments,Agencies manage onboarding deployments for own projects,ALL,{authenticated},PERMISSIVE,"(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))","(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))"
onboarding_deployments,Partners read onboarding deployments for their assignments,SELECT,{authenticated},PERMISSIVE,"(assignment_id IN ( SELECT pa.id
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE (p.partner_id = auth.uid())))",null
onboarding_package_documents,Agency full access package document rows,ALL,{authenticated},PERMISSIVE,"(package_id IN ( SELECT op.id
   FROM (onboarding_packages op
     JOIN projects p ON ((p.id = op.project_id)))
  WHERE (p.agency_id = auth.uid())))","(package_id IN ( SELECT op.id
   FROM (onboarding_packages op
     JOIN projects p ON ((p.id = op.project_id)))
  WHERE (p.agency_id = auth.uid())))"
onboarding_package_documents,Partner reads documents for their packages,SELECT,{authenticated},PERMISSIVE,"(package_id IN ( SELECT onboarding_packages.id
   FROM onboarding_packages
  WHERE (onboarding_packages.partnership_id IN ( SELECT partnerships.id
           FROM partnerships
          WHERE (partnerships.partner_id = auth.uid())))))",null
onboarding_packages,Agency full access onboarding packages for own projects,ALL,{authenticated},PERMISSIVE,"(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))","((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid()))) AND (agency_id = auth.uid()))"
onboarding_packages,Partner reads onboarding packages for their partnership,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
onboarding_packages,Partner updates review fields on own packages,UPDATE,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))","(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))"
partner_access_requests,Agencies can update requests to them,UPDATE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partner_access_requests,Agencies can view requests to them,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partner_access_requests,Partners can create requests,INSERT,{authenticated},PERMISSIVE,null,(partner_id = auth.uid())
partner_access_requests,Partners can view their requests,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_rfp_inbox,Agencies insert partner RFP inbox rows,INSERT,{authenticated},PERMISSIVE,null,(agency_id = auth.uid())
partner_rfp_inbox,Agencies select own partner RFP inbox rows,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partner_rfp_inbox,Partners select inbox rows by partner_id,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_rfp_inbox,Partners select inbox rows by recipient email,SELECT,{authenticated},PERMISSIVE,"((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.recipient_email)))))))",null
partner_rfp_inbox,Partners update own inbox rows,UPDATE,{authenticated},PERMISSIVE,"((partner_id = auth.uid()) OR ((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.recipient_email))))))))",null
partner_rfp_response_versions,Agencies read owned response versions,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partner_rfp_response_versions,Partners insert own response versions,INSERT,{authenticated},PERMISSIVE,null,(partner_id = auth.uid())
partner_rfp_response_versions,Partners read own response versions,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_rfp_responses,Agencies select RFP responses they own,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partner_rfp_responses,Agencies update response status and feedback,UPDATE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
partner_rfp_responses,Partners insert RFP responses for their inbox,INSERT,{authenticated},PERMISSIVE,null,"((partner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM partner_rfp_inbox i
  WHERE ((i.id = partner_rfp_responses.inbox_item_id) AND (i.agency_id = partner_rfp_responses.agency_id) AND ((i.partner_id = auth.uid()) OR ((i.recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM profiles pr
          WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM i.recipient_email))))))))))))"
partner_rfp_responses,Partners read response status and feedback,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_rfp_responses,Partners select own RFP responses,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_rfp_responses,Partners update own RFP responses,UPDATE,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
partner_status_updates,Agencies can resolve status updates,UPDATE,{authenticated},PERMISSIVE,"(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))",null
partner_status_updates,Agencies can view status updates for their projects,SELECT,{authenticated},PERMISSIVE,"(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))",null
partner_status_updates,Partners can insert their own status updates,INSERT,{authenticated},PERMISSIVE,null,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))"
partner_status_updates,Partners can update their own status updates,UPDATE,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
partner_status_updates,Partners can view their own status updates,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
partner_vouches,Agencies can remove their vouch,DELETE,{public},PERMISSIVE,(auth.uid() = voucher_agency_id),null
partner_vouches,Agencies can vouch,INSERT,{public},PERMISSIVE,null,(auth.uid() = voucher_agency_id)
partner_vouches,Anyone can count vouches,SELECT,{public},PERMISSIVE,true,null
partnership_profile_context,Users can insert their own context,INSERT,{public},PERMISSIVE,null,(user_id = auth.uid())
partnership_profile_context,Users can read their own context,SELECT,{public},PERMISSIVE,(user_id = auth.uid()),null
partnership_profile_context,Users can update their own context,UPDATE,{public},PERMISSIVE,(user_id = auth.uid()),null
partnerships,Agencies can create partnerships,INSERT,{authenticated},PERMISSIVE,null,(agency_id = auth.uid())
partnerships,Agencies can update their partnerships,UPDATE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partnerships,Agencies can view their partnerships,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
partnerships,Partners can claim partnership by email,UPDATE,{public},PERMISSIVE,"((partner_id IS NULL) AND (partner_email ~~* ( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = auth.uid()))))",(partner_id = auth.uid())
partnerships,Partners can update partnership status,UPDATE,{authenticated},PERMISSIVE,(partner_id = auth.uid()),(partner_id = auth.uid())
partnerships,Partners can view their partnerships,SELECT,{authenticated},PERMISSIVE,(partner_id = auth.uid()),null
payment_milestones,Agency can manage payment milestones,ALL,{authenticated},PERMISSIVE,"(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))","(project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.agency_id = auth.uid())))"
payment_milestones,Partners can view their payment milestones,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
payment_milestones,Partners read payment milestones for their partnerships,SELECT,{authenticated},PERMISSIVE,"((partnership_id IS NOT NULL) AND (partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid()))))",null
payment_milestones,Partners read their payment milestones,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
profiles,Agencies read profiles of their partners,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM partnerships p
  WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = profiles.id))))",null
profiles,Authenticated users can read discoverable profiles,SELECT,{authenticated},PERMISSIVE,(is_discoverable = true),null
profiles,Enable insert for authenticated users only,INSERT,{public},PERMISSIVE,null,(auth.uid() = id)
profiles,Partners read lead agency profiles for their partnerships,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM partnerships p
  WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = profiles.id))))",null
profiles,Users can update own profile,UPDATE,{public},PERMISSIVE,(auth.uid() = id),null
profiles,Users can view profiles of partnership members,SELECT,{authenticated},PERMISSIVE,"((id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM partnerships
  WHERE ((partnerships.partner_id = auth.uid()) AND (partnerships.agency_id = profiles.id)))) OR (EXISTS ( SELECT 1
   FROM partnerships
  WHERE ((partnerships.agency_id = auth.uid()) AND (partnerships.partner_id = profiles.id)))))",null
project_assignments,assignments_agency_all,ALL,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.agency_id = auth.uid())))","(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.agency_id = auth.uid())))"
project_assignments,assignments_partner_select,SELECT,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))",null
project_assignments,assignments_partner_update,UPDATE,{authenticated},PERMISSIVE,"(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))","(partnership_id IN ( SELECT partnerships.id
   FROM partnerships
  WHERE (partnerships.partner_id = auth.uid())))"
project_documents,Agencies can view documents for their projects,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_documents.project_id) AND (p.agency_id = auth.uid()))))",null
project_documents,Partners can view documents for their assignments,SELECT,{authenticated},PERMISSIVE,"(((visibility = 'all_partners'::text) AND (EXISTS ( SELECT 1
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE ((pa.project_id = project_documents.project_id) AND (p.partner_id = auth.uid()))))) OR ((visibility = 'assignment'::text) AND (EXISTS ( SELECT 1
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE ((pa.id = project_documents.assignment_id) AND (p.partner_id = auth.uid()))))))",null
project_documents,Uploaders can delete their documents,DELETE,{authenticated},PERMISSIVE,(uploaded_by = auth.uid()),null
project_documents,Uploaders can update their documents,UPDATE,{authenticated},PERMISSIVE,(uploaded_by = auth.uid()),null
project_documents,Users can upload documents,INSERT,{authenticated},PERMISSIVE,null,(uploaded_by = auth.uid())
project_messages,Agencies can view messages for their projects,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_messages.project_id) AND (p.agency_id = auth.uid()))))",null
project_messages,Partners can view messages for their assignments,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM (project_assignments pa
     JOIN partnerships p ON ((pa.partnership_id = p.id)))
  WHERE ((pa.id = project_messages.assignment_id) AND (p.partner_id = auth.uid()))))",null
project_messages,Senders can update their messages,UPDATE,{authenticated},PERMISSIVE,(sender_id = auth.uid()),null
project_messages,Users can send messages,INSERT,{authenticated},PERMISSIVE,null,(sender_id = auth.uid())
projects,projects_agency_delete,DELETE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
projects,projects_agency_insert,INSERT,{authenticated},PERMISSIVE,null,(agency_id = auth.uid())
projects,projects_agency_select,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
tablename,policyname,cmd,roles,permissive,qual,with_check
projects,projects_agency_delete,DELETE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
projects,projects_agency_insert,INSERT,{authenticated},PERMISSIVE,null,(agency_id = auth.uid())
projects,projects_agency_select,SELECT,{authenticated},PERMISSIVE,(agency_id = auth.uid()),null
projects,projects_agency_update,UPDATE,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
projects,projects_partner_select_assigned,SELECT,{authenticated},PERMISSIVE,"(EXISTS ( SELECT 1
   FROM (project_assignments pa
     JOIN partnerships p ON ((p.id = pa.partnership_id)))
  WHERE ((pa.project_id = projects.id) AND (p.partner_id = auth.uid()))))",null
rfp_magic_tokens,Agency can manage their own tokens,ALL,{public},PERMISSIVE,(agency_id = auth.uid()),null
usage_tracking,Agencies manage own usage tracking,ALL,{authenticated},PERMISSIVE,(agency_id = auth.uid()),(agency_id = auth.uid())
## Capture note

Supabase truncated the full-table export at 100 rows, silently and without warning, in both
the clipboard and the CSV download. This file was therefore assembled from two exports:
tablename < 'projects', and tablename >= 'projects'. Any future schema query in this
workflow must be split or row-counted before its output is trusted. This is the same class
of silent truncation that produced Finding Zero.
