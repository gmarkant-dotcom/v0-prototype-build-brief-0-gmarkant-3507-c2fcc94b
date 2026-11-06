/**
 * G1, G2, G3. WHAT THE AGENCY'S TWO GUEST-INVITE SURFACES SEND, AND WHAT THEY TELL THE AGENCY.
 * Pure, so the rules are tested without a browser or a database (lib/agency-invite-request.test.ts).
 *
 * Both surfaces POST /api/agency/rfp/magic-link. That route has two paths: a first send, which
 * writes every content column of the token from the body (an absent field is written as empty),
 * and an explicit resend (`resend: true`, F7, lib/magic-link-resend.ts), which renews the link and
 * writes no content at all.
 *
 *  G1. The card's "Send Invitation" form (components/agency-rfp-magic-link-invite.tsx) carries no
 *      RFP content, only the address, a name and the terms flag. As a first send to an address that
 *      already has an invitation on the project, it blanked that invitation's criteria, categories,
 *      materials and scope. It therefore resends when an invitation exists, and is a first send,
 *      byte for byte as before, only when none does.
 *  G2. The /agency wizard's guest send (app/agency/page.tsx) is a real send with new content, so it
 *      stays a first send, but now carries the criteria, categories, business criteria and close
 *      flag the wizard holds, so it no longer writes them as empty.
 *  G3. describeInviteOutcome turns a route response into one message the agency can read.
 */

import { pickVendorCopy } from "./rfp-vendor-copy"

/** GET /api/agency/rfp/magic-link?check_email=...&project_id=... */
export type InviteCheck = {
  is_existing_partner?: boolean
  has_pending_invite?: boolean
  has_expired_invite?: boolean
}

/** True when the address already has an invitation on the project, live or lapsed. */
export function hasExistingInvitation(check: InviteCheck | null | undefined): boolean {
  return !!check && (check.has_pending_invite === true || check.has_expired_invite === true)
}

export type InviteMode = "first" | "resend"

export type CardInviteRequest = {
  mode: InviteMode
  body: Record<string, unknown>
}

/**
 * G1. The card form's request. With an existing invitation it is a resend: the stored content and
 * terms setting stay, the link is renewed and mailed again. Without one it is the same first send
 * as before this change (same keys, same values).
 */
export function buildCardInviteRequest(input: {
  email: string
  name: string
  projectId: string
  requireTermsDisclosure: boolean
  check: InviteCheck | null
}): CardInviteRequest {
  const vendor_email = input.email.trim()
  const vendor_name = input.name.trim() || undefined
  if (hasExistingInvitation(input.check)) {
    return { mode: "resend", body: { vendor_email, vendor_name, project_id: input.projectId, resend: true } }
  }
  return {
    mode: "first",
    body: {
      vendor_email,
      vendor_name,
      project_id: input.projectId,
      require_terms_disclosure: input.requireTermsDisclosure,
    },
  }
}

/** The parts of the wizard's master RFP a guest send carries. */
export type WizardMasterRfpForGuest = {
  business_criteria_required?: unknown
  budget_categories?: unknown
  evaluation_criteria?: unknown
} & Record<string, unknown>

/**
 * G2. The wizard's guest send for one recipient on one scope item. Every key the wizard sent
 * before is unchanged; four are added so an existing token is not blanked:
 *  - business_criteria_required and budget_categories are vendor-facing, so they are taken from
 *    the master RFP only through the vendor-copy allow-list (pickVendorCopy, lib/rfp-vendor-copy.ts).
 *  - evaluation_criteria is the agency's rubric. It is not vendor-facing (the guest page never
 *    shows it); it goes to the token and the RFP record for scoring, exactly as Lightning sends it.
 *  - close_bidding_at_deadline is explicit true only, the route's own rule.
 * The route normalizes all four again; nothing here is trusted on the server.
 */
export function buildWizardGuestInviteBody(input: {
  email: string
  name: string
  projectId: string
  scopeItem: { id: string; name: string; description: string; estimatedBudget?: string | null }
  referenceMaterials: readonly unknown[]
  requireTermsDisclosure: boolean
  responseDeadline: string | null
  showClientToVendors: boolean
  releaseBudget: boolean
  closeBiddingAtDeadline: boolean
  masterRfp: WizardMasterRfpForGuest | null
}): Record<string, unknown> {
  const vendorCopy = pickVendorCopy(input.masterRfp)
  const evaluation = input.masterRfp?.evaluation_criteria
  return {
    vendor_email: input.email,
    vendor_name: input.name || undefined,
    project_id: input.projectId,
    scope_item_name: input.scopeItem.name,
    scope_item_description: input.scopeItem.description,
    reference_materials: input.referenceMaterials,
    require_terms_disclosure: input.requireTermsDisclosure,
    response_deadline: input.responseDeadline,
    show_client_to_vendors: input.showClientToVendors,
    release_budget: input.releaseBudget,
    estimated_budget: (input.scopeItem.estimatedBudget || "").slice(0, 200) || undefined,
    business_criteria_required: vendorCopy.business_criteria_required,
    budget_categories: Array.isArray(vendorCopy.budget_categories) ? vendorCopy.budget_categories : [],
    evaluation_criteria: Array.isArray(evaluation) ? evaluation : [],
    close_bidding_at_deadline: input.closeBiddingAtDeadline === true,
  }
}

export type InviteOutcomeTone = "success" | "warning" | "error"

export type InviteOutcome = {
  tone: InviteOutcomeTone
  message: string
}

/**
 * G3. One message per response. `status` 0 means the request never got a response (network).
 * `data` is the parsed JSON body, or {} when it was not JSON.
 */
export function describeInviteOutcome(input: {
  mode: InviteMode
  status: number
  data: Record<string, unknown> | null | undefined
}): InviteOutcome {
  const { mode, status } = input
  const data = input.data ?? {}
  const verb = mode === "resend" ? "resent" : "sent"

  if (status === 0) {
    return { tone: "error", message: "Network error. Check your connection and try again." }
  }
  if (status >= 200 && status < 300) {
    if (data.email_sent === true) {
      return { tone: "success", message: `Invitation ${verb}. The link expires in 72 hours.` }
    }
    if (data.attached === true) {
      return {
        tone: "warning",
        message: `Invitation ${verb} to the vendor's Ligament inbox, but the email did not go out. Try again in a few minutes if they need it by email.`,
      }
    }
    return {
      tone: "warning",
      message: "The invitation is saved, but the email did not go out. Use Resend in a few minutes to try again.",
    }
  }
  if (status === 404 && mode === "resend") {
    return {
      tone: "error",
      message: "There is no invitation to resend for this vendor. Send a new invitation instead.",
    }
  }
  if (status === 401) {
    return { tone: "error", message: "Your session has expired. Sign in again, then retry." }
  }
  const serverError = typeof data.error === "string" && data.error.trim() ? data.error.trim() : null
  return {
    tone: "error",
    message: serverError || (mode === "resend" ? "Could not resend the invitation. Please try again." : "Could not send the invitation. Please try again."),
  }
}
