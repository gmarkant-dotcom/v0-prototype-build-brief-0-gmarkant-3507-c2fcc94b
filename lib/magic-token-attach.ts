import type { SupabaseClient } from "@supabase/supabase-js"
import { createNotification } from "@/lib/notifications"

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
}

export type AttachResult =
  | { attached: true; inboxId: string; created: boolean }
  | { attached: false; reason: string }

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
 * from send-time, the on-login sweep, and a logged-in vendor opening the link directly,
 * with no risk of a duplicate inbox row from any combination of the three.
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

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { attached: false, reason: "expired" }
  }

  const { data: existing, error: existingErr } = await supabase
    .from("partner_rfp_inbox")
    .select("id")
    .eq("agency_id", tokenRow.agency_id)
    .contains("master_rfp_json", { _magic_token: tokenRow.token })
    .maybeSingle()
  if (existingErr) {
    console.error("[magic-token-attach] idempotency check failed", {
      token: tokenRow.token,
      message: existingErr.message,
    })
    return { attached: false, reason: existingErr.message }
  }
  if (existing) {
    return { attached: true, inboxId: existing.id as string, created: false }
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
    scope_item_id: tokenRow.scope_item_id,
    scope_item_name: tokenRow.scope_item_name,
    scope_item_description: tokenRow.scope_item_description,
    master_rfp_json: masterRfpJson,
    agency_company_name: agencyCompanyName,
    status: "new",
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

  return { attached: true, inboxId, created: true }
}
