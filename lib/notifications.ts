import { SupabaseClient } from "@supabase/supabase-js"

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

// Helper functions for common notification types
export async function notifyPartnershipInvitation(
  supabase: SupabaseClient,
  partnerId: string,
  agencyName: string,
  partnershipId: string
) {
  return createNotification({
    supabase,
    userId: partnerId,
    type: 'partnership_invitation',
    title: 'New Partnership Invitation',
    message: `${agencyName} has invited you to become a partner agency.`,
    link: '/partner/invitations',
    data: { partnershipId, agencyName }
  })
}

export async function notifyPartnershipAccepted(
  supabase: SupabaseClient,
  agencyId: string,
  partnerName: string,
  partnershipId: string
) {
  return createNotification({
    supabase,
    userId: agencyId,
    type: 'partnership_accepted',
    title: 'Partnership Accepted',
    message: `${partnerName} has accepted your partnership invitation.`,
    link: '/agency/pool',
    data: { partnershipId, partnerName }
  })
}

export async function notifyPartnershipDeclined(
  supabase: SupabaseClient,
  agencyId: string,
  partnerName: string,
  partnershipId: string
) {
  return createNotification({
    supabase,
    userId: agencyId,
    type: 'partnership_declined' as NotificationType,
    title: 'Partnership Declined',
    message: `${partnerName} has declined your partnership invitation.`,
    link: '/agency/pool',
    data: { partnershipId, partnerName }
  })
}

export async function notifyProjectAssignment(
  supabase: SupabaseClient,
  partnerId: string,
  projectName: string,
  agencyName: string,
  assignmentId: string,
  projectId: string
) {
  return createNotification({
    supabase,
    userId: partnerId,
    type: 'project_assignment',
    title: 'New Project Assignment',
    message: `${agencyName} has invited you to bid on "${projectName}".`,
    link: `/partner/projects/${projectId}`,
    data: { assignmentId, projectId, projectName, agencyName }
  })
}

export async function notifyProjectResponse(
  supabase: SupabaseClient,
  agencyId: string,
  partnerName: string,
  projectName: string,
  accepted: boolean,
  projectId: string
) {
  return createNotification({
    supabase,
    userId: agencyId,
    type: accepted ? 'project_accepted' : 'project_declined',
    title: accepted ? 'Project Bid Accepted' : 'Project Bid Declined',
    message: `${partnerName} has ${accepted ? 'accepted' : 'declined'} the invitation to bid on "${projectName}".`,
    link: `/agency/bids`,
    data: { projectId, projectName, partnerName, accepted }
  })
}

export async function notifyNewMessage(
  supabase: SupabaseClient,
  recipientId: string,
  senderName: string,
  projectName: string,
  projectId: string,
  assignmentId?: string
) {
  return createNotification({
    supabase,
    userId: recipientId,
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
  recipientId: string,
  uploaderName: string,
  documentName: string,
  projectName: string,
  projectId: string
) {
  return createNotification({
    supabase,
    userId: recipientId,
    type: 'document_uploaded',
    title: 'New Document Uploaded',
    message: `${uploaderName} uploaded "${documentName}" to "${projectName}".`,
    link: `/agency/project?tab=documents`,
    data: { projectId, projectName, documentName, uploaderName }
  })
}

export async function notifyProjectAwarded(
  supabase: SupabaseClient,
  partnerId: string,
  projectName: string,
  agencyName: string,
  projectId: string
) {
  return createNotification({
    supabase,
    userId: partnerId,
    type: 'project_awarded',
    title: 'Project Awarded!',
    message: `Congratulations! ${agencyName} has awarded you the project "${projectName}".`,
    link: `/partner/projects/${projectId}`,
    data: { projectId, projectName, agencyName }
  })
}
