import type { SupabaseClient } from "@supabase/supabase-js"
import { createNotification } from "@/lib/notifications"
import { mapResponseStatusToInboxStatus } from "@/lib/bid-status"

/** Fields this module actually reads off a rfp_magic_tokens row - callers pass whatever
 *  shape they already have (select("*") or a narrower select), this just documents the
 *  subset that matters here. */
export type MagicTokenForAttach = {
  token: string
  agency_id: string
  project_id: string | null
  vendor_email: string
  scope_item_id: string | null
  scope_item_name: string | null
  scope_item_description: string | null
  business_criteria_required: unknown
  require_terms_disclosure?: boolean | null
  response_deadline?: string | null
  expires_at: string
  /** H3: when this token already has a submitted bid, that response gets backfilled with
   *  this attach's inbox row/partner id below - without this, "My Bids" and Delivery &
   *  Projects never pick up a guest-origin response even after its RFP is visible in the
   *  portal, since they key off partner_rfp_responses.partner_id / inbox_item_id directly,
   *  not off partner_rfp_inbox at all. */
  response_id?: string | null
}

/** Every column attachMagicTokenToPartnerInbox reads. Shared by all four callers so a row
 *  synthesized by one of them is never poorer than one synthesized by another - which one wins
 *  is a race (the RFP list and the bids list are fetched in parallel), and the row is only
 *  created once. The _NO_DEADLINE variant is the pre-migration-074 fallback (42703). */
export const MAGIC_TOKEN_ATTACH_COLUMNS =
  "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, response_deadline, expires_at, response_id"
export const MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE =
  "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, expires_at, response_id"

export type AttachResult =
  | { attached: true; inboxId: string; created: boolean }
  | { attached: false; reason: string }

/**
 * H4 - the actual reason no magic-link RFP has ever reached a vendor's portal inbox.
 *
 * `partner_rfp_inbox.scope_item_id` is `text NOT NULL`: an opaque id minted by the agency UI
 * (`Date.now().toString()` - see app/api/agency/broadcast-rfp/route.ts, which rejects a
 * broadcast item without one). `rfp_magic_tokens.scope_item_id` is a `uuid` column, and
 * app/api/agency/rfp/magic-link/route.ts deliberately stores null there for exactly those
 * non-uuid ids. Passing that null straight through to the insert below made every attach fail
 * with 23502 not_null_violation - silently, since both the sweep and the send-time attach only
 * log a failed result. Live data confirms it: all 15 rfp_magic_tokens rows have a null
 * scope_item_id, and none of the 61 partner_rfp_inbox rows carries a _magic_token marker.
 *
 * Derived from the token instead: non-null, stable across every call for the same invitation
 * (so repeat sweeps keep hitting the same row rather than minting new ones), and unique per
 * invitation, so it never collides with a real scope item id from the broadcast flow.
 */
function inboxScopeItemId(tokenRow: MagicTokenForAttach): string {
  return (tokenRow.scope_item_id || "").trim() || `magic:${tokenRow.token}`
}

type ExistingResponse = { id: string; partner_id: string | null; inbox_item_id: string | null; status: string | null }

/**
 * Attaches a magic-link RFP invitation into the matching vendor's portal inbox
 * (partner_rfp_inbox) - the same table/mechanism the standard broadcast flow uses - so a
 * vendor with an existing account sees it in /partner/rfps instead of only in the
 * invitation email (G1).
 *
 * Idempotency: partner_rfp_inbox has no magic_token_id-shaped column (a real schema gap -
 * flagged, not fixed here since no migrations are permitted this pass). Instead the
 * originating token is stashed at master_rfp_json._magic_token on the synthesized row, and
 * that's the dedupe key this function checks before inserting - safe to call repeatedly
 * from send-time, the on-login sweep, the bids-list backfill, and a logged-in vendor opening
 * the link directly, with no risk of a duplicate inbox row from any combination of the four.
 * H4 adds a second, independent key on the same row: scope_item_id is now derived from the
 * token (see inboxScopeItemId), so a row whose master_rfp_json is later replaced wholesale by
 * some other write is still recognised rather than duplicated. Both lookups take limit(1) -
 * if a duplicate ever does exist, this must still resolve to one of them rather than error
 * out on every call from then on and leave the vendor's portal permanently empty.
 *
 * Callers are responsible for having already verified vendorEmail matches the target
 * profile's email (this function trusts partnerId, it does not re-derive it) - the one
 * thing it does re-check itself is expiry, since "attach an expired invitation" is never
 * correct regardless of which caller reached here.
 */
export async function attachMagicTokenToPartnerInbox(
  supabase: SupabaseClient,
  params: { tokenRow: MagicTokenForAttach; partnerId: string }
): Promise<AttachResult> {
  const { tokenRow, partnerId } = params

  // H3: an expired token still needs attaching (and its response backfilled below) once it
  // already has a submitted bid - the invite link's 72-hour window is about how long it
  // stays open to a NEW response, not about whether an answer already given should stay
  // visible in the vendor's portal. Only a genuinely-expired, never-answered invite refuses.
  if (!tokenRow.response_id && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { attached: false, reason: "expired" }
  }

  // Read once, used twice: to seed the synthesized row's own status below (a bid that was
  // already decided must not land in the vendor's portal reading "New"), and to backfill the
  // response's linkage afterwards.
  let existingResponse: ExistingResponse | null = null
  if (tokenRow.response_id) {
    const { data: responseRow } = await supabase
      .from("partner_rfp_responses")
      .select("id, partner_id, inbox_item_id, status")
      .eq("id", tokenRow.response_id)
      .maybeSingle()
    existingResponse = (responseRow as ExistingResponse | null) ?? null
  }

  const backfillResponseLinkage = async (inboxId: string) => {
    if (!existingResponse) return
    const patch: Record<string, unknown> = {}
    if (!existingResponse.partner_id) patch.partner_id = partnerId
    if (!existingResponse.inbox_item_id) patch.inbox_item_id = inboxId
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

  const scopeItemId = inboxScopeItemId(tokenRow)
  const { data: existing, error: existingErr } = await supabase
    .from("partner_rfp_inbox")
    .select("id")
    .eq("agency_id", tokenRow.agency_id)
    .contains("master_rfp_json", { _magic_token: tokenRow.token })
    .limit(1)
    .maybeSingle()
  if (existingErr) {
    console.error("[magic-token-attach] idempotency check failed", {
      token: tokenRow.token,
      message: existingErr.message,
    })
    return { attached: false, reason: existingErr.message }
  }
  let existingId = (existing?.id as string | undefined) ?? null
  // Only the synthetic `magic:<token>` form is safe to match on. A token carrying a real uuid
  // scope_item_id shares that id with the broadcast flow's own rows for the same scope item,
  // and matching there would attach this invitation onto someone else's inbox row.
  if (!existingId && scopeItemId.startsWith("magic:")) {
    const { data: byScope, error: byScopeErr } = await supabase
      .from("partner_rfp_inbox")
      .select("id")
      .eq("agency_id", tokenRow.agency_id)
      .eq("scope_item_id", scopeItemId)
      .limit(1)
      .maybeSingle()
    if (byScopeErr) {
      console.error("[magic-token-attach] secondary idempotency check failed", {
        token: tokenRow.token,
        message: byScopeErr.message,
      })
      return { attached: false, reason: byScopeErr.message }
    }
    existingId = (byScope?.id as string | undefined) ?? null
  }
  if (existingId) {
    await backfillResponseLinkage(existingId)
    return { attached: true, inboxId: existingId, created: false }
  }

  const [{ data: agencyProfile }, { data: project }] = await Promise.all([
    supabase
      .from("profiles")
      .select("company_name, full_name, display_name")
      .eq("id", tokenRow.agency_id)
      .maybeSingle(),
    tokenRow.project_id
      ? supabase.from("projects").select("name, client_name, budget_range").eq("id", tokenRow.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const agencyCompanyName =
    agencyProfile?.company_name?.trim() ||
    agencyProfile?.full_name?.trim() ||
    agencyProfile?.display_name?.trim() ||
    "Lead agency"

  // Best-effort master RFP snapshot - a magic token carries scope/criteria data, not the
  // full master-RFP shape the standard broadcast flow writes, so this is deliberately
  // partial rather than fabricated. _magic_token is the dedupe marker described above.
  const masterRfpJson: Record<string, unknown> = {
    _magic_token: tokenRow.token,
    projectName: project?.name ?? null,
    client: project?.client_name ?? null,
    totalBudget: project?.budget_range ?? null,
    business_criteria_required: tokenRow.business_criteria_required ?? null,
  }

  const insertRow: Record<string, unknown> = {
    agency_id: tokenRow.agency_id,
    partner_id: partnerId,
    recipient_email: tokenRow.vendor_email,
    project_id: tokenRow.project_id,
    // Both NOT NULL on partner_rfp_inbox - see inboxScopeItemId above for scope_item_id, and
    // note the magic-link wizard does not require a scope item name at all, unlike the
    // broadcast flow, so the project name is the honest fallback rather than a fabricated one.
    scope_item_id: scopeItemId,
    scope_item_name: (tokenRow.scope_item_name || "").trim() || project?.name?.trim() || "Scope item",
    scope_item_description: tokenRow.scope_item_description,
    master_rfp_json: masterRfpJson,
    agency_company_name: agencyCompanyName,
    // A retroactively attached invitation whose bid was already submitted (and possibly already
    // awarded or declined) must carry that outcome, not "new" - the award PATCH's own inbox
    // status sync could not have run for it, since no inbox row existed at award time.
    status: existingResponse?.status ? mapResponseStatusToInboxStatus(existingResponse.status) : "new",
    nda_gate_enforced: false,
  }
  if (typeof tokenRow.require_terms_disclosure === "boolean") {
    insertRow.require_terms_disclosure = tokenRow.require_terms_disclosure
  }
  if (tokenRow.response_deadline) {
    insertRow.response_deadline = tokenRow.response_deadline
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("partner_rfp_inbox")
    .insert(insertRow)
    .select("id")
    .single()
  if (insertErr || !inserted) {
    console.error("[magic-token-attach] insert failed", {
      token: tokenRow.token,
      message: insertErr?.message,
    })
    return { attached: false, reason: insertErr?.message || "insert failed" }
  }

  const inboxId = inserted.id as string
  await backfillResponseLinkage(inboxId)
  // Only a genuinely new invitation is announced. A retroactive attach is backfilling history
  // the vendor already lived through - they answered this RFP, so "New RFP in your inbox"
  // would be false, and for an awarded bid it would arrive after the award notification.
  if (!existingResponse) {
    try {
      await createNotification({
        supabase,
        userId: partnerId,
        type: "project_assignment",
        title: "New RFP in your inbox",
        message: `${agencyCompanyName} sent you an RFP${tokenRow.scope_item_name ? ` for ${tokenRow.scope_item_name}` : ""}.`,
        link: `/partner/rfps/${inboxId}`,
        data: { inboxId, magicToken: tokenRow.token },
      })
    } catch (notifyErr) {
      console.error("[magic-token-attach] in-app notification failed", {
        inboxId,
        message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      })
    }
  }

  return { attached: true, inboxId, created: true }
}
