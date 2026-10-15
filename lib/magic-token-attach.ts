import type { SupabaseClient } from "@supabase/supabase-js"
import { createOrgNotification } from "@/lib/notifications"
import { mapResponseStatusToInboxStatus } from "@/lib/bid-status"
import type { OrgId } from "@/lib/entitlements"
import { ORG_CONTACT_SELECT, resolveOrgContact, logOrgContactGap, type OrgEmbed } from "@/lib/org-contact"
import { pickVendorCopy } from "@/lib/rfp-vendor-copy"

/** Fields this module actually reads off a rfp_magic_tokens row - callers pass whatever
 *  shape they already have (select("*") or a narrower select), this just documents the
 *  subset that matters here. */
export type MagicTokenForAttach = {
  token: string
  org_id: string
  project_id: string | null
  vendor_email: string
  scope_item_id: string | null
  scope_item_name: string | null
  scope_item_description: string | null
  business_criteria_required: unknown
  require_terms_disclosure?: boolean | null
  response_deadline?: string | null
  expires_at: string
  /** H5: when this invitation was actually sent. The synthesized inbox row's created_at is
   *  what /partner/rfps renders as "Received", so defaulting it to now() dated every
   *  retroactively attached RFP to the day the sweep happened to run rather than the day the
   *  agency sent it. Survives a resend: the magic-link route upserts on
   *  (org_id, project_id, vendor_email) without touching created_at. */
  created_at?: string | null
  /** H3: when this token already has a submitted bid, that response gets backfilled with
   *  this attach's inbox row/partner id below - without this, "My Bids" and Delivery &
   *  Projects never pick up a guest-origin response even after its RFP is visible in the
   *  portal, since they key off partner_rfp_responses.vendor_org_id / inbox_item_id directly,
   *  not off partner_rfp_inbox at all. */
  response_id?: string | null
  /** 118. The RFP record line this invitation was sent from; the inbox row carries the same. */
  rfp_line_id?: string | null
  /** 118. THE JOIN (step C): the inbox row this invitation is attached to. */
  attached_inbox_id?: string | null
  /** 118. The client name when the agency shows it to vendors on this RFP (D3), else null. */
  client_name_released?: string | null
}

/** Every column attachMagicTokenToPartnerInbox reads. Shared by all four callers so a row
 *  synthesized by one of them is never poorer than one synthesized by another - which one wins
 *  is a race (the RFP list and the bids list are fetched in parallel), and the row is only
 *  created once. The _NO_DEADLINE variant is the pre-migration-074 fallback (42703). */
export const MAGIC_TOKEN_ATTACH_COLUMNS =
  "token, org_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, response_deadline, expires_at, created_at, response_id, rfp_line_id, attached_inbox_id, client_name_released"
export const MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE =
  "token, org_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, expires_at, created_at, response_id, rfp_line_id, attached_inbox_id, client_name_released"

export type AttachResult =
  | { attached: true; inboxId: string; created: boolean }
  | { attached: false; reason: string }

/**
 * H4 - the actual reason no magic-link RFP had ever reached a vendor's portal inbox.
 *
 * `partner_rfp_inbox.scope_item_id` is `text NOT NULL`: an opaque id minted by the agency UI
 * (`Date.now().toString()` - see app/api/agency/broadcast-rfp/route.ts, which rejects a
 * broadcast item without one). `rfp_magic_tokens.scope_item_id` is a `uuid` column, and
 * app/api/agency/rfp/magic-link/route.ts deliberately stores null there for exactly those
 * non-uuid ids. Passing that null straight through to the insert made every attach fail with
 * 23502 not_null_violation - silently, since every caller only logs a failed result.
 *
 * Derived from the token instead: non-null and namespaced so it can never collide with a real
 * scope item id from the broadcast flow. STEP C: it is no longer a join key (nothing reads it
 * to find a row); the format is unchanged, and a vendor read never selects it
 * (lib/rfp-vendor-copy.ts). The token inside it is reported to the owner as a finding.
 */
function inboxScopeItemId(tokenRow: MagicTokenForAttach): string {
  return (tokenRow.scope_item_id || "").trim() || `magic:${tokenRow.token}`
}

type ExistingResponse = { id: string; vendor_org_id: string | null; inbox_item_id: string | null; status: string | null }

const INBOX_CANDIDATE_COLUMNS = "id, lead_org_id, created_at, status, vendor_org_id, rfp_line_id"

type InboxCandidate = {
  id: string
  lead_org_id: string | null
  created_at: string | null
  status: string | null
  vendor_org_id: string | null
  rfp_line_id: string | null
}

async function readInboxCandidate(
  supabase: SupabaseClient,
  inboxId: string,
  orgId: string
): Promise<{ row: InboxCandidate | null; error: string | null }> {
  const { data, error } = await supabase
    .from("partner_rfp_inbox")
    .select(INBOX_CANDIDATE_COLUMNS)
    .eq("id", inboxId)
    .eq("lead_org_id", orgId)
    .maybeSingle()
  if (error) return { row: null, error: error.message }
  return { row: (data as unknown as InboxCandidate | null) ?? null, error: null }
}

/**
 * Sets rfp_magic_tokens.attached_inbox_id ONLY WHILE IT IS NULL (compare-and-set): the one
 * statement two racing attaches cannot both win. Returns the token's attached row afterwards,
 * whoever set it. 118's link-column guard admits the write on the service role's trusted path and
 * checks the row is of the token's own organization (23514).
 */
async function claimAttachedInbox(
  supabase: SupabaseClient,
  tokenRow: MagicTokenForAttach,
  inboxId: string
): Promise<{ attachedInboxId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("rfp_magic_tokens")
    .update({ attached_inbox_id: inboxId })
    .eq("token", tokenRow.token)
    .eq("org_id", tokenRow.org_id)
    .is("attached_inbox_id", null)
    .select("attached_inbox_id")
  if (error) return { attachedInboxId: null, error: error.message }
  if (Array.isArray(data) && data.length === 1) return { attachedInboxId: inboxId, error: null }
  const { data: current, error: readErr } = await supabase
    .from("rfp_magic_tokens")
    .select("attached_inbox_id")
    .eq("token", tokenRow.token)
    .eq("org_id", tokenRow.org_id)
    .maybeSingle()
  if (readErr) return { attachedInboxId: null, error: readErr.message }
  return { attachedInboxId: (current?.attached_inbox_id as string | null | undefined) ?? null, error: null }
}

/** Removes a row this call inserted and then lost the race for. Nothing can point at it yet but
 *  a response this same call repointed, so responses are repointed first, as before. */
async function discardLosingRow(supabase: SupabaseClient, loserId: string, winnerId: string) {
  const { error: repointErr } = await supabase
    .from("partner_rfp_responses")
    .update({ inbox_item_id: winnerId })
    .eq("inbox_item_id", loserId)
  if (repointErr) {
    console.error("[magic-token-attach] race loser: response repoint failed, row left in place", {
      loserId,
      winnerId,
      message: repointErr.message,
    })
    return
  }
  const { error: deleteErr } = await supabase.from("partner_rfp_inbox").delete().eq("id", loserId)
  if (deleteErr) {
    console.error("[magic-token-attach] race loser: delete failed (non-fatal)", { loserId, winnerId, message: deleteErr.message })
  }
}

/**
 * Attaches a magic-link RFP invitation into the matching vendor's portal inbox
 * (partner_rfp_inbox) - the same table/mechanism the standard broadcast flow uses - so a
 * vendor with an existing account sees it in /partner/rfps instead of only in the
 * invitation email (G1).
 *
 * STEP C (leak #8): THE JOIN IS rfp_magic_tokens.attached_inbox_id (118), and only that. The
 * master_rfp_json._magic_token marker and the 'magic:<token>' scope id are no longer read to find a
 * row, and _magic_token is no longer written (D8; migration 120 scrubs it and refuses it). In order:
 *   1. the token's attached_inbox_id, when set, is the invitation's row;
 *   2. else the row the token's own bid already points at (partner_rfp_responses.inbox_item_id),
 *      when it is of the token's organization and on the token's line or on none;
 *   3. else a new row is inserted, carrying the token's line and released client name.
 * Cases 2 and 3 then set attached_inbox_id with a compare-and-set while it is NULL. Two racing
 * calls (/partner/rfps and /partner/rfps/bids are fetched in parallel) both insert, exactly one
 * wins the compare-and-set, and the loser removes its own row and uses the winner's. Row and
 * token are on the same line and organization by construction; 118's guard re-checks both.
 *
 * The vendor copy written into a new row is the allow-listed vendor copy (lib/rfp-vendor-copy.ts):
 * the project name and the token's business criteria only. No client name and no budget in the
 * JSON; the client name only through client_name_released, copied from the token (which the
 * agency's per-RFP toggle keeps current). No budget: this vendor-triggered path does not read the
 * agency's record, so the released budget is not known here, and a vendor sees less, never more.
 *
 * Callers are responsible for having already verified vendorEmail matches the target
 * profile's email (this function trusts partnerId, it does not re-derive it) - the one
 * thing it does re-check itself is expiry, since "attach an expired invitation" is never
 * correct regardless of which caller reached here. Every caller passes the service role.
 */
export async function attachMagicTokenToPartnerInbox(
  supabase: SupabaseClient,
  params: { tokenRow: MagicTokenForAttach; partnerId: OrgId }
): Promise<AttachResult> {
  const { tokenRow, partnerId } = params

  // H3: an expired token still needs attaching (and its response backfilled below) once it
  // already has a submitted bid - the invite link's 72-hour window is about how long it
  // stays open to a NEW response, not about whether an answer already given should stay
  // visible in the vendor's portal. Only a genuinely-expired, never-answered invite refuses.
  if (!tokenRow.response_id && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { attached: false, reason: "expired" }
  }

  // Read once, used three times: to find the invitation's row (case 2), to seed a synthesized
  // row's own status below (a bid that was already decided must not land in the vendor's portal
  // reading "New"), and to backfill the response's linkage afterwards.
  let existingResponse: ExistingResponse | null = null
  if (tokenRow.response_id) {
    const { data: responseRow } = await supabase
      .from("partner_rfp_responses")
      .select("id, vendor_org_id, inbox_item_id, status")
      .eq("id", tokenRow.response_id)
      .maybeSingle()
    existingResponse = (responseRow as ExistingResponse | null) ?? null
  }

  const backfillResponseLinkage = async (inboxId: string) => {
    if (!existingResponse) return
    const patch: Record<string, unknown> = {}
    if (!existingResponse.vendor_org_id) patch.vendor_org_id = partnerId
    if (existingResponse.inbox_item_id !== inboxId) patch.inbox_item_id = inboxId
    if (Object.keys(patch).length === 0) return
    const { error: patchErr } = await supabase
      .from("partner_rfp_responses")
      .update(patch)
      .eq("id", existingResponse.id)
    if (patchErr) {
      console.error("[magic-token-attach] response linkage backfill failed (non-fatal)", {
        responseId: existingResponse.id,
        inboxId,
        message: patchErr.message,
      })
    }
  }

  const tokenLine = tokenRow.rfp_line_id ?? null
  // Set in case (3), the only case that announces the invitation.
  let agencyCompanyName = "Lead agency"
  let winner: InboxCandidate | null = null
  let created = false
  let insertedId: string | null = null

  // (1) The token's attached row.
  if (tokenRow.attached_inbox_id) {
    const found = await readInboxCandidate(supabase, tokenRow.attached_inbox_id, tokenRow.org_id)
    if (found.error) {
      console.error("[magic-token-attach] attached row read failed", { inboxId: tokenRow.attached_inbox_id, message: found.error })
      return { attached: false, reason: found.error }
    }
    winner = found.row
  }

  // (2) The row the token's own bid points at, adopted when it is of the token's organization and
  //     on the token's line or on none.
  if (!winner && existingResponse?.inbox_item_id) {
    const found = await readInboxCandidate(supabase, existingResponse.inbox_item_id, tokenRow.org_id)
    if (found.error) {
      console.error("[magic-token-attach] bid's inbox row read failed", { inboxId: existingResponse.inbox_item_id, message: found.error })
      return { attached: false, reason: found.error }
    }
    const candidate = found.row
    if (candidate && (candidate.rfp_line_id == null || candidate.rfp_line_id === tokenLine)) {
      const claim = await claimAttachedInbox(supabase, tokenRow, candidate.id)
      if (claim.error) {
        console.error("[magic-token-attach] attach claim failed", { inboxId: candidate.id, message: claim.error })
        return { attached: false, reason: claim.error }
      }
      if (claim.attachedInboxId === candidate.id) {
        winner = candidate
      } else if (claim.attachedInboxId) {
        const other = await readInboxCandidate(supabase, claim.attachedInboxId, tokenRow.org_id)
        winner = other.row
      }
    } else if (candidate) {
      console.error("[magic-token-attach] the bid's inbox row is on another RFP line; not adopted", {
        inboxId: candidate.id,
      })
    }
  }

  // (3) A new row.
  if (!winner) {
    // PHASE 3: `tokenRow.org_id` is an ORGANIZATION id; the agency's display name comes from
    // `organizations` through the shared two-hop fragment (it is denormalized onto the row and
    // never re-read, so it must be right at insert).
    const [{ data: agencyOrg }, { data: project }] = await Promise.all([
      supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT)
        .eq("id", tokenRow.org_id)
        .maybeSingle(),
      tokenRow.project_id
        ? supabase.from("projects").select("name").eq("id", tokenRow.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const agencyContact = resolveOrgContact(agencyOrg as OrgEmbed, null)
    logOrgContactGap("magic-token-attach (lead agency name)", agencyContact, { inboxFor: tokenRow.org_id })
    agencyCompanyName = agencyContact.orgName || agencyContact.contactFullName || "Lead agency"
    const projectName = (project as { name?: string | null } | null)?.name ?? null

    const insertRow: Record<string, unknown> = {
      lead_org_id: tokenRow.org_id,
      vendor_org_id: partnerId,
      recipient_email: tokenRow.vendor_email,
      project_id: tokenRow.project_id,
      // Both NOT NULL on partner_rfp_inbox - see inboxScopeItemId above for scope_item_id, and
      // note the magic-link wizard does not require a scope item name at all, unlike the
      // broadcast flow, so the project name is the honest fallback rather than a fabricated one.
      scope_item_id: inboxScopeItemId(tokenRow),
      scope_item_name: (tokenRow.scope_item_name || "").trim() || projectName?.trim() || "Scope item",
      scope_item_description: tokenRow.scope_item_description,
      // The allow-listed vendor copy (lib/rfp-vendor-copy.ts). No _magic_token, client or budget.
      master_rfp_json: pickVendorCopy({
        projectName,
        business_criteria_required: tokenRow.business_criteria_required ?? null,
      }),
      // 118: the token's line, and the client name only when the agency shows it (D3).
      rfp_line_id: tokenLine,
      client_name_released: tokenRow.client_name_released ?? null,
      agency_company_name: agencyCompanyName,
      // A retroactively attached invitation whose bid was already submitted (and possibly already
      // awarded or declined) must carry that outcome, not "new" - the award PATCH's own inbox
      // status sync could not have run for it, since no inbox row existed at award time.
      status: existingResponse?.status ? mapResponseStatusToInboxStatus(existingResponse.status) : "new",
      nda_gate_enforced: false,
    }
    // H5: the day the invitation was sent, not the day this attach happened to run.
    if (tokenRow.created_at) insertRow.created_at = tokenRow.created_at
    if (typeof tokenRow.require_terms_disclosure === "boolean") {
      insertRow.require_terms_disclosure = tokenRow.require_terms_disclosure
    }
    if (tokenRow.response_deadline) {
      insertRow.response_deadline = tokenRow.response_deadline
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("partner_rfp_inbox")
      .insert(insertRow)
      .select(INBOX_CANDIDATE_COLUMNS)
      .single()
    if (insertErr || !inserted) {
      console.error("[magic-token-attach] insert failed", { inboxFor: tokenRow.org_id, message: insertErr?.message })
      return { attached: false, reason: insertErr?.message || "insert produced no row" }
    }
    const mine = inserted as unknown as InboxCandidate
    insertedId = mine.id

    const claim = await claimAttachedInbox(supabase, tokenRow, mine.id)
    if (claim.error || !claim.attachedInboxId) {
      // Nothing points at the new row; removing it keeps the next attach from duplicating it.
      console.error("[magic-token-attach] attach claim failed; new row removed", { inboxId: mine.id, message: claim.error })
      await supabase.from("partner_rfp_inbox").delete().eq("id", mine.id)
      return { attached: false, reason: claim.error || "attach claim matched no token" }
    }
    if (claim.attachedInboxId === mine.id) {
      winner = mine
      created = true
    } else {
      // A parallel request attached its own row first: use it, and remove ours.
      const other = await readInboxCandidate(supabase, claim.attachedInboxId, tokenRow.org_id)
      await discardLosingRow(supabase, mine.id, claim.attachedInboxId)
      winner = other.row
    }
  }

  if (!winner) {
    return { attached: false, reason: "the token's attached inbox row could not be read" }
  }

  await backfillResponseLinkage(winner.id)

  // Self-heal the things a row created before this pass got wrong: an attach-time received date,
  // a status frozen at whatever it was when the row was synthesized, a missing owner, and (118) a
  // row with no line while its token has one (same organization by construction).
  const heal: Record<string, unknown> = {}
  if (tokenRow.created_at && winner.created_at !== tokenRow.created_at) heal.created_at = tokenRow.created_at
  const derivedStatus = existingResponse?.status ? mapResponseStatusToInboxStatus(existingResponse.status) : null
  if (derivedStatus && winner.status !== derivedStatus) heal.status = derivedStatus
  // Filled, never reassigned: an invitation row already owned by a different account is not
  // this vendor's to claim, and silently repointing it would be a misattribution.
  if (winner.vendor_org_id == null) heal.vendor_org_id = partnerId
  if (winner.rfp_line_id == null && tokenLine) heal.rfp_line_id = tokenLine
  if (Object.keys(heal).length > 0) {
    const { error: healErr } = await supabase.from("partner_rfp_inbox").update(heal).eq("id", winner.id)
    if (healErr) {
      console.error("[magic-token-attach] row self-heal failed (non-fatal)", {
        inboxId: winner.id,
        message: healErr.message,
      })
    }
  }

  // Only a genuinely new invitation is announced. A retroactive attach is backfilling history
  // the vendor already lived through - they answered this RFP, so "New RFP in your inbox"
  // would be false, and for an awarded bid it would arrive after the award notification.
  // winner.id === insertedId keeps this to exactly one notification when two requests race:
  // only the request whose own row won the compare-and-set announces the invitation.
  if (created && !existingResponse && winner.id === insertedId) {
    try {
      // Was createNotification({ userId: partnerId }) where partnerId is a vendor
      // ORGANIZATION id. Fans out over its members now - see lib/notifications.ts.
      // D8 (step C): no magicToken in `data`. It fanned the vendor's bearer link out to every
      // member of the vendor organization, and nothing read it.
      await createOrgNotification({
        supabase,
        orgId: partnerId,
        site: "magic-token-attach",
        type: "project_assignment",
        title: "New RFP in your inbox",
        message: `${agencyCompanyName} sent you an RFP${tokenRow.scope_item_name ? ` for ${tokenRow.scope_item_name}` : ""}.`,
        link: `/partner/rfps/${winner.id}`,
        data: { inboxId: winner.id },
      })
    } catch (notifyErr) {
      console.error("[magic-token-attach] in-app notification failed", {
        inboxId: winner.id,
        message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      })
    }
  }

  return { attached: true, inboxId: winner.id, created }
}
