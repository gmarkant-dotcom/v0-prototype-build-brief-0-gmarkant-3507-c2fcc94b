import { SupabaseClient, createClient as createServiceClient } from "@supabase/supabase-js"

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
 * accounts that exist. It becomes wrong the moment an organization is created after 079,
 * because PHASE 12 mints gen_random_uuid() for those - a user id that belongs to nobody.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MEMBER LOOKUP RUNS ON THE SERVICE ROLE
 *
 * Replacing those call sites was necessary and was not sufficient, because the fan-out
 * could not actually happen on the caller's own client. `org_members` carries exactly one
 * SELECT policy, and it is self-row-only:
 *
 *   "Members read their own membership row"  SELECT  USING (user_id = auth.uid())
 *
 * 079:1731 calls that out as deliberate - a policy on org_members that subqueries
 * org_members recurses to 42P17, so the self-row form is what keeps recursion out of
 * production. The consequence for this file is total:
 *
 *   - Notifying a COUNTERPARTY organization - which is what almost every call site here
 *     does, an agency telling a vendor they won, a vendor telling an agency a bid landed -
 *     matched ZERO rows, because the caller holds no membership row in the other company.
 *     The fallback below then fired and addressed the organization id itself.
 *   - Notifying the caller's OWN organization matched exactly ONE row, the caller's. So
 *     "EVERY MEMBER OF THE ORGANIZATION", the ruling this file opens with, could never
 *     have been carried out on a session client even in the best case. A colleague was
 *     never going to be notified of anything.
 *
 * So the read runs on the service role, in the narrow shape lib/server/account-existence.ts
 * already established: one query, for user ids belonging to one organization the caller has
 * already been authorized to act on by the route that got here. No row and no field is
 * returned to any caller, and nothing about WHO may act is decided here - only who is told.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK IS GONE, NOT RELOCATED
 *
 * It used to return `[orgId]` on an empty read, addressing an organization id as a user id.
 * With a read that can actually see rows, empty means the organization genuinely has no
 * members - and every organization has at least one by construction: 079:366 backfills an
 * owner row for every profile, and the PHASE 12 signup trigger (079:1918) inserts one for
 * every account created since. An empty result is therefore a broken invariant, and writing
 * a notification nobody can read is not a repair for it. It logs and writes nothing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT FIX: THE INSERT POLICY. Still Greg's call, still unchanged.
 *
 * See the note on createOrgNotification(). Resolving the right recipients does not grant
 * the right to write to them: the live INSERT policy is
 * `user_id = auth.uid() OR user_id IN (current_user_active_counterparty_user_ids())`, and
 * that helper is active-partnership-only (079:779-803). For an ACTIVE partnership the
 * resolved ids are exactly the ids that helper returns, so those notifications now land,
 * and land for every member instead of for one coincidental id. For a pending or terminated
 * one they are still refused, exactly as they are today.
 */

/**
 * A service-role client, or null when the environment has not configured one.
 *
 * Narrow by construction and by use: the only query issued through it in this module is the
 * org_members read below. See the header for why the caller's own client cannot perform it.
 * Built per call rather than memoized at module scope so that importing this file never has
 * a side effect - several of the importers are route modules that Next may evaluate during
 * a build, where the key is legitimately absent.
 */
function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

/**
 * Every member of an organization, as user ids. Empty when there is nobody to tell.
 *
 * `supabase` is accepted and used only as the degraded path when no service role is
 * configured. It cannot answer this question correctly - org_members is self-row-only - so
 * a caller reaching that branch gets a logged error rather than a plausible wrong answer.
 */
export async function resolveOrgMemberUserIds(
  supabase: SupabaseClient,
  orgId: string | null | undefined
): Promise<string[]> {
  if (!orgId) return []

  const service = getServiceClient()
  if (!service) {
    console.error(
      "[notifications] SUPABASE_SERVICE_ROLE_KEY is not configured, so org_members cannot " +
        "be read past its self-row-only SELECT policy. Falling back to the caller's client, " +
        "which resolves at most the caller themselves and nobody at a counterparty.",
      { orgId }
    )
  }

  const { data: members, error } = await (service ?? supabase)
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)

  if (error) {
    console.error("[notifications] org_members lookup failed", {
      orgId,
      code: error.code,
      message: error.message,
      usedServiceRole: Boolean(service),
    })
    return []
  }

  const userIds = ((members ?? []) as Array<{ user_id?: string | null }>)
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id))

  if (userIds.length === 0) {
    // Not a fallback point. Every organization has an owner row - 079:366 for the sixteen
    // backfilled ones, the PHASE 12 signup trigger for every one since - so an empty read
    // through the service role means the organization id is wrong or that invariant is
    // broken. Addressing the organization id as a user id, which is what used to happen
    // here, repairs neither and writes a row its own recipient cannot select.
    console.error(
      "[notifications] organization resolved no members. Every organization is created with " +
        "an owner row, so this is a bad organization id or a broken invariant - not a " +
        "reason to address the organization id as a user id. Nothing written.",
      { orgId, usedServiceRole: Boolean(service) }
    )
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

  const row = (userId: string) => ({ user_id: userId, type, title, message, link, data })

  const { error } = await supabase.from("notifications").insert(userIds.map(row))
  if (!error) return true

  // ONE BATCH, ALL-OR-NOTHING. A multi-row INSERT is a single statement, so a WITH CHECK
  // failure on any one row aborts the whole thing and rolls the rest back. That did not
  // matter while this resolved a single id; it matters now that it resolves a real member
  // list, because the INSERT policy is per recipient - `user_id = auth.uid() OR user_id IN
  // (current_user_active_counterparty_user_ids())` - and a mixed batch is entirely possible:
  // notifying your own organization permits your row and refuses every colleague's, which
  // would have discarded your own notification along with theirs.
  //
  // So retry one at a time and deliver what is permitted. Partial delivery beats none, and
  // the count that landed is logged rather than inferred. This does NOT widen anything: each
  // row faces the same policy it faced inside the batch.
  const settled = await Promise.all(
    userIds.map(async (userId) => {
      const { error: rowError } = await supabase.from("notifications").insert(row(userId))
      return rowError ? { userId, rowError } : null
    })
  )
  const refused = settled.filter((r): r is NonNullable<(typeof settled)[number]> => r !== null)

  if (refused.length === userIds.length) {
    console.error("[notifications] org notification insert failed for every recipient", {
      site,
      orgId,
      type,
      recipientCount: userIds.length,
      code: refused[0]?.rowError?.code ?? error.code,
      message: refused[0]?.rowError?.message ?? error.message,
    })
    return false
  }

  if (refused.length > 0) {
    console.warn("[notifications] org notification delivered to some recipients, refused for others", {
      site,
      orgId,
      type,
      delivered: userIds.length - refused.length,
      refused: refused.length,
      code: refused[0]?.rowError?.code,
      message: refused[0]?.rowError?.message,
    })
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
