import { SupabaseClient } from "@supabase/supabase-js"

/**
 * WHO RECEIVES AN IN-APP NOTIFICATION UNDER THE ORGANIZATION MODEL.
 *
 * RULED: EVERY MEMBER OF THE ORGANIZATION. One rule, used at all sixteen call sites.
 *
 * Why not the primary contact. `notifications` is USER-SCOPED in its own policies and
 * always has been - SELECT and UPDATE are both `user_id = auth.uid()`, so a row addressed
 * to anyone else is invisible to you. It is an in-app inbox, not an outbound message.
 * Addressing it to one designated person means the colleague who actually does the work
 * never learns the RFP arrived. Access to the underlying data is granted by MEMBERSHIP
 * everywhere in migration 079, so the notification about that data has to follow
 * membership too, or the two disagree.
 *
 * Why not "a specific person". There is no column that names one, other than
 * primary_contact_user_id, which exists for OUTBOUND correspondence: one email address so
 * a company is not mailed N times. An in-app row has no such cost.
 *
 * This matches resolveOrgNotificationRecipients() in lib/email.ts exactly, which already
 * fans out over org_members for the email side. Two different answers to "who is the
 * company" across two channels would be the same class of bug this whole migration exists
 * to close.
 *
 * THE BUG THIS REPLACES. Sixteen call sites passed an ORGANIZATION id straight into
 * `notifications.user_id`. That is live-correct today only because every organization
 * backfilled by 079 carries its founding user's id, so the two coincide for the sixteen
 * accounts that exist. It is NOT a live bug today. It becomes one the moment 079 is
 * applied AND the first organization is created afterwards, because PHASE 12 mints
 * gen_random_uuid() for those - a user id that belongs to nobody, a notification nobody
 * can read, and no error anywhere.
 */

/**
 * Every member of an organization, as user ids.
 *
 * The fallback mirrors lib/email.ts deliberately: with no org_members rows we fall back to
 * treating the org id as a user id, which is right for a backfilled organization and wrong
 * for one created after 079 - so it is logged rather than done quietly.
 */
export async function resolveOrgMemberUserIds(
  supabase: SupabaseClient,
  orgId: string | null | undefined
): Promise<string[]> {
  if (!orgId) return []

  const { data: members, error } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)

  // BEFORE 079 IS APPLIED, org_members DOES NOT EXIST. That is the expected state on this
  // branch, not a fault, so it is separated from a real lookup failure: every organization
  // id in the database today IS its founding user's id, so the fallback below is exactly
  // right and this path is the whole behaviour until the migration runs. Distinguishing the
  // two matters because the noisy version would fire on every notification in production.
  const tableMissing = error?.code === "42P01" || error?.code === "PGRST205"

  if (error && !tableMissing) {
    console.error("[notifications] org_members lookup failed", {
      orgId,
      code: error.code,
      message: error.message,
    })
  }

  const userIds = ((members ?? []) as Array<{ user_id?: string | null }>)
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id))

  if (userIds.length === 0) {
    if (tableMissing) {
      console.info(
        "[notifications] org_members does not exist yet (migration 079 unapplied), " +
          "addressing the organization id directly - correct while every organization id " +
          "is also its founding user's id.",
        { orgId }
      )
    } else {
      console.warn(
        "[notifications] no org_members rows, falling back to the pre-079 assumption that " +
          "the organization id is also a user id. Correct for a backfilled organization, " +
          "WRONG and unreadable for one created after 079.",
        { orgId }
      )
    }
    return [orgId]
  }

  return userIds
}

interface CreateOrgNotificationParams {
  supabase: SupabaseClient
  /** An ORGANIZATION id. Never a user id. */
  orgId: string | null | undefined
  type: NotificationType
  title: string
  message?: string
  link?: string
  data?: Record<string, any>
  /** For the log line when nobody resolves. */
  site: string
}

/**
 * Notify every member of an organization. One row per member.
 *
 * RLS NOTE, NOT FIXED HERE. On the session client the insert must satisfy
 * `user_id = auth.uid() OR user_id IN (current_user_active_counterparty_user_ids())`, and
 * that helper is the ACTIVE-only counterparty set. So an invitation or a decline - where
 * the partnership is pending or terminated, not active - is refused by the policy for
 * every recipient. That is true of the live policy today too (it carries the same
 * status='active' condition), so it is a PRE-EXISTING gap and not something this change
 * introduces. It is written up in docs/079-embed-closure-report.md rather than fixed,
 * because fixing it means editing the notifications INSERT policy, which is Greg's call.
 * The service-role call sites (the guest token routes) bypass RLS and are unaffected.
 */
export async function createOrgNotification({
  supabase,
  orgId,
  type,
  title,
  message,
  link,
  data = {},
  site,
}: CreateOrgNotificationParams): Promise<boolean> {
  const userIds = await resolveOrgMemberUserIds(supabase, orgId)

  if (userIds.length === 0) {
    console.warn("[notifications] resolved no recipients, nothing written", { site, orgId, type })
    return false
  }

  const { error } = await supabase.from("notifications").insert(
    userIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link,
      data,
    }))
  )

  if (error) {
    console.error("[notifications] org notification insert failed", {
      site,
      orgId,
      type,
      recipientCount: userIds.length,
      code: error.code,
      message: error.message,
    })
    return false
  }

  return true
}

export type NotificationType = 
  | 'partnership_invitation'
  | 'partnership_accepted'
  | 'partnership_declined'
  | 'project_assignment'
  | 'project_accepted'
  | 'project_declined'
  | 'new_message'
  | 'document_uploaded'
  | 'project_awarded'
  | 'onboarding_deployed'
  | 'bid_submitted'

interface CreateNotificationParams {
  supabase: SupabaseClient
  userId: string
  type: NotificationType
  title: string
  message?: string
  link?: string
  data?: Record<string, any>
}

export async function createNotification({
  supabase,
  userId,
  type,
  title,
  message,
  link,
  data = {}
}: CreateNotificationParams) {
  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      link,
      data
    })

  if (error) {
    console.error('Error creating notification:', error)
  }

  return !error
}

// Helper functions for common notification types.
//
// EVERY ONE OF THESE TAKES AN ORGANIZATION ID, not a user id, and fans out over that
// organization's members. The parameter names say so. See the ruling at the top of this
// file. The only entry point that still takes a user id is createNotification() itself,
// and after this change nothing in the repository calls it with anything else.
export async function notifyPartnershipInvitation(
  supabase: SupabaseClient,
  vendorOrgId: string,
  agencyName: string,
  partnershipId: string
) {
  return createOrgNotification({
    supabase,
    orgId: vendorOrgId,
    site: 'notifyPartnershipInvitation',
    type: 'partnership_invitation',
    title: 'New Partnership Invitation',
    message: `${agencyName} has invited you to become a vendor.`,
    link: '/partner/invitations',
    data: { partnershipId, agencyName }
  })
}

export async function notifyPartnershipAccepted(
  supabase: SupabaseClient,
  leadOrgId: string,
  partnerName: string,
  partnershipId: string
) {
  return createOrgNotification({
    supabase,
    orgId: leadOrgId,
    site: 'notifyPartnershipAccepted',
    type: 'partnership_accepted',
    title: 'Partnership Accepted',
    message: `${partnerName} has accepted your partnership invitation.`,
    link: '/agency/pool',
    data: { partnershipId, partnerName }
  })
}

export async function notifyPartnershipDeclined(
  supabase: SupabaseClient,
  leadOrgId: string,
  partnerName: string,
  partnershipId: string
) {
  return createOrgNotification({
    supabase,
    orgId: leadOrgId,
    site: 'notifyPartnershipDeclined',
    type: 'partnership_declined' as NotificationType,
    title: 'Partnership Declined',
    message: `${partnerName} has declined your partnership invitation.`,
    link: '/agency/pool',
    data: { partnershipId, partnerName }
  })
}

export async function notifyProjectAssignment(
  supabase: SupabaseClient,
  vendorOrgId: string,
  projectName: string,
  agencyName: string,
  assignmentId: string,
  projectId: string
) {
  return createOrgNotification({
    supabase,
    orgId: vendorOrgId,
    site: 'notifyProjectAssignment',
    type: 'project_assignment',
    title: 'New Project Assignment',
    message: `${agencyName} has invited you to bid on "${projectName}".`,
    link: `/partner/projects/${projectId}`,
    data: { assignmentId, projectId, projectName, agencyName }
  })
}

export async function notifyProjectResponse(
  supabase: SupabaseClient,
  leadOrgId: string,
  partnerName: string,
  projectName: string,
  accepted: boolean,
  projectId: string
) {
  return createOrgNotification({
    supabase,
    orgId: leadOrgId,
    site: 'notifyProjectResponse',
    type: accepted ? 'project_accepted' : 'project_declined',
    title: accepted ? 'Project Bid Accepted' : 'Project Bid Declined',
    message: `${partnerName} has ${accepted ? 'accepted' : 'declined'} the invitation to bid on "${projectName}".`,
    link: `/agency/bids`,
    data: { projectId, projectName, partnerName, accepted }
  })
}

// notifyNewMessage and notifyDocumentUploaded have NO call sites anywhere in the
// repository, verified by grep across app, lib and components. They are converted with the
// rest so that wiring one up later cannot reintroduce the org-id-as-user-id bug.
export async function notifyNewMessage(
  supabase: SupabaseClient,
  recipientOrgId: string,
  senderName: string,
  projectName: string,
  projectId: string,
  assignmentId?: string
) {
  return createOrgNotification({
    supabase,
    orgId: recipientOrgId,
    site: 'notifyNewMessage',
    type: 'new_message',
    title: 'New Message',
    message: `${senderName} sent a message on "${projectName}".`,
    link: assignmentId
      ? `/partner/projects/${projectId}?tab=messages`
      : `/agency/project?tab=messages`,
    data: { projectId, projectName, senderName, assignmentId }
  })
}

export async function notifyDocumentUploaded(
  supabase: SupabaseClient,
  recipientOrgId: string,
  uploaderName: string,
  documentName: string,
  projectName: string,
  projectId: string
) {
  return createOrgNotification({
    supabase,
    orgId: recipientOrgId,
    site: 'notifyDocumentUploaded',
    type: 'document_uploaded',
    title: 'New Document Uploaded',
    message: `${uploaderName} uploaded "${documentName}" to "${projectName}".`,
    link: `/agency/project?tab=documents`,
    data: { projectId, projectName, documentName, uploaderName }
  })
}

export async function notifyBidSubmitted(
  supabase: SupabaseClient,
  leadOrgId: string,
  vendorNameOrEmail: string,
  scopeItemName: string,
  responseId: string,
  isRevision: boolean
) {
  return createOrgNotification({
    supabase,
    orgId: leadOrgId,
    site: 'notifyBidSubmitted',
    type: 'bid_submitted',
    title: isRevision ? 'Vendor Bid Updated' : 'New Vendor Bid',
    message: `${vendorNameOrEmail} ${isRevision ? "updated their bid" : "submitted a bid"} on "${scopeItemName}".`,
    link: `/agency/bids`,
    data: { responseId, scopeItemName, vendorNameOrEmail, isRevision }
  })
}

export async function notifyProjectAwarded(
  supabase: SupabaseClient,
  vendorOrgId: string,
  projectName: string,
  agencyName: string,
  projectId: string
) {
  return createOrgNotification({
    supabase,
    orgId: vendorOrgId,
    site: 'notifyProjectAwarded',
    type: 'project_awarded',
    title: 'Project Awarded!',
    message: `Congratulations! ${agencyName} has awarded you the project "${projectName}".`,
    link: `/partner/projects/${projectId}`,
    data: { projectId, projectName, agencyName }
  })
}
