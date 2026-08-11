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
  /** H5: when this invitation was actually sent. The synthesized inbox row's created_at is
   *  what /partner/rfps renders as "Received", so defaulting it to now() dated every
   *  retroactively attached RFP to the day the sweep happened to run rather than the day the
   *  agency sent it. Survives a resend: the magic-link route upserts on
   *  (agency_id, project_id, vendor_email) without touching created_at. */
  created_at?: string | null
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
  "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, response_deadline, expires_at, created_at, response_id"
export const MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE =
  "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, expires_at, created_at, response_id"

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
 * Derived from the token instead: non-null, stable across every call for the same invitation,
 * and namespaced so it can never collide with a real scope item id from the broadcast flow.
 */
function inboxScopeItemId(tokenRow: MagicTokenForAttach): string {
  return (tokenRow.scope_item_id || "").trim() || `magic:${tokenRow.token}`
}

type ExistingResponse = { id: string; partner_id: string | null; inbox_item_id: string | null; status: string | null }

/** Linkage worth preserving when two rows for the same invitation are collapsed into one.
 *  invite_token is deliberately absent: it is UNIQUE, only the manual-invite broadcast flow
 *  ever sets it, and a magic-attach row never has one, so moving it could only ever collide. */
const MERGEABLE_LINKAGE = [
  "partner_id",
  "partnership_id",
  "viewed_at",
  "partner_intent",
  "intent_set_at",
  "nda_confirmed_at",
  "agency_nda_notified_at",
  "claimed_at",
  "response_deadline",
] as const

const INBOX_CANDIDATE_COLUMNS = `id, created_at, status, ${MERGEABLE_LINKAGE.join(", ")}`

type InboxCandidate = { id: string; created_at: string | null; status: string | null } & Record<string, unknown>

/**
 * Every partner_rfp_inbox row that represents this one invitation, by either key.
 *
 * Two independent keys, because they were introduced at different times and a row may carry
 * only one of them: `master_rfp_json._magic_token` (the original marker) and the derived
 * `scope_item_id` (H4). The scope-id probe only runs for the synthetic `magic:` form - a token
 * carrying a real uuid shares that id with the broadcast flow's own rows for the same scope
 * item, and matching there would collapse someone else's row into this invitation.
 *
 * Sorted by (created_at, id): an immutable, total order that every concurrent caller computes
 * identically, which is what makes the collapse below safe to run from two requests at once.
 */
async function findInvitationRows(
  supabase: SupabaseClient,
  tokenRow: MagicTokenForAttach,
  scopeItemId: string
): Promise<{ rows: InboxCandidate[]; error: string | null }> {
  const byToken = await supabase
    .from("partner_rfp_inbox")
    .select(INBOX_CANDIDATE_COLUMNS)
    .eq("agency_id", tokenRow.agency_id)
    .contains("master_rfp_json", { _magic_token: tokenRow.token })
  if (byToken.error) return { rows: [], error: byToken.error.message }

  const byId = new Map<string, InboxCandidate>()
  for (const row of (byToken.data || []) as unknown as InboxCandidate[]) byId.set(row.id, row)

  if (scopeItemId.startsWith("magic:")) {
    const byScope = await supabase
      .from("partner_rfp_inbox")
      .select(INBOX_CANDIDATE_COLUMNS)
      .eq("agency_id", tokenRow.agency_id)
      .eq("scope_item_id", scopeItemId)
    if (byScope.error) return { rows: [], error: byScope.error.message }
    for (const row of (byScope.data || []) as unknown as InboxCandidate[]) byId.set(row.id, row)
  }

  const rows = [...byId.values()].sort((a, b) => {
    const at = a.created_at || ""
    const bt = b.created_at || ""
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  return { rows, error: null }
}

/**
 * H5 self-heal: collapse every row for this invitation into one canonical row.
 *
 * The winner is the first in the (created_at, id) order above, NOT "whichever row currently
 * has the richest linkage". Richness is a moving target - two concurrent requests reading it a
 * few milliseconds apart can disagree about which row is richer and then delete each other's
 * pick, losing both. The order here is computed from immutable columns, so every caller agrees
 * without coordination. Richness is preserved by moving it onto the winner instead: linkage is
 * merged field by field, and the only foreign key into this table
 * (partner_rfp_responses.inbox_item_id) is repointed before anything is deleted.
 */
async function collapseInvitationRows(
  supabase: SupabaseClient,
  rows: InboxCandidate[],
  token: string
): Promise<InboxCandidate> {
  const winner = rows[0]
  const losers = rows.slice(1)
  if (losers.length === 0) return winner

  console.warn("[magic-token-attach] collapsing duplicate invitation rows", {
    token,
    keep: winner.id,
    remove: losers.map((r) => r.id),
  })

  // Merge linkage: first non-null wins, winner's own value taking precedence.
  const patch: Record<string, unknown> = {}
  for (const field of MERGEABLE_LINKAGE) {
    if (winner[field] != null) continue
    const donor = losers.find((r) => r[field] != null)
    if (donor) patch[field] = donor[field]
  }
  if (Object.keys(patch).length > 0) {
    const { error: mergeErr } = await supabase.from("partner_rfp_inbox").update(patch).eq("id", winner.id)
    if (mergeErr) {
      console.error("[magic-token-attach] duplicate merge failed, leaving duplicates in place", {
        token,
        winnerId: winner.id,
        message: mergeErr.message,
      })
      return winner
    }
    Object.assign(winner, patch)
  }

  // Repoint the only FK into partner_rfp_inbox before deleting anything, so no response is
  // ever left pointing at a row that is about to disappear.
  const loserIds = losers.map((r) => r.id)
  const { error: repointErr } = await supabase
    .from("partner_rfp_responses")
    .update({ inbox_item_id: winner.id })
    .in("inbox_item_id", loserIds)
  if (repointErr) {
    console.error("[magic-token-attach] duplicate repoint failed, leaving duplicates in place", {
      token,
      winnerId: winner.id,
      message: repointErr.message,
    })
    return winner
  }

  const { error: deleteErr } = await supabase.from("partner_rfp_inbox").delete().in("id", loserIds)
  if (deleteErr) {
    console.error("[magic-token-attach] duplicate delete failed (non-fatal, retried next load)", {
      token,
      winnerId: winner.id,
      message: deleteErr.message,
    })
  }
  return winner
}

/**
 * Attaches a magic-link RFP invitation into the matching vendor's portal inbox
 * (partner_rfp_inbox) - the same table/mechanism the standard broadcast flow uses - so a
 * vendor with an existing account sees it in /partner/rfps instead of only in the
 * invitation email (G1).
 *
 * Idempotency: partner_rfp_inbox has no magic_token_id-shaped column (a real schema gap -
 * flagged, not fixed here since no migrations are permitted this pass), so the invitation is
 * identified by the two keys findInvitationRows probes. Checking those keys before inserting
 * is not on its own enough: /partner/rfps and /partner/rfps/bids are fetched in parallel by
 * app/partner/rfps/page.tsx, so two requests ran this check-then-insert 11ms apart, both saw
 * no row, and both inserted - which is exactly how partner71 ended up with the same awarded
 * bid listed twice. Nothing in the schema forbids it; there is no unique constraint to lean
 * on. So the invariant is enforced by convergence instead: every call re-scans and collapses
 * whatever it finds, including immediately after its own insert, so the loser of a race is
 * cleaned up by the winner of it. Safe to call repeatedly from send-time, the on-login sweep,
 * the bids-list backfill, and a logged-in vendor opening the link directly.
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
    // Repointed rather than only filled: after a collapse, a response may still be pointing
    // at a row that no longer exists.
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

  const scopeItemId = inboxScopeItemId(tokenRow)
  const initial = await findInvitationRows(supabase, tokenRow, scopeItemId)
  if (initial.error) {
    console.error("[magic-token-attach] idempotency check failed", { token: tokenRow.token, message: initial.error })
    return { attached: false, reason: initial.error }
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

  let rows = initial.rows
  let created = false
  let insertedId: string | null = null

  if (rows.length === 0) {
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
      .select("id")
      .single()
    // 23505 means a unique constraint caught a concurrent twin first. Nothing enforces one
    // today, but it is the natural hardening for this table, and it must read as "someone else
    // already created it" rather than as a failed attach if it is ever added.
    if (insertErr && insertErr.code !== "23505") {
      console.error("[magic-token-attach] insert failed", { token: tokenRow.token, message: insertErr.message })
      return { attached: false, reason: insertErr.message }
    }
    created = !insertErr
    insertedId = (inserted?.id as string | undefined) ?? null

    // Re-scan rather than trusting the inserted id: this is the window in which a parallel
    // request may have inserted its own copy, and the collapse below is what closes it.
    const after = await findInvitationRows(supabase, tokenRow, scopeItemId)
    if (after.error || after.rows.length === 0) {
      console.error("[magic-token-attach] post-insert rescan found no row", {
        token: tokenRow.token,
        message: after.error,
      })
      return { attached: false, reason: after.error || "insert produced no readable row" }
    }
    rows = after.rows
  }

  const winner = await collapseInvitationRows(supabase, rows, tokenRow.token)
  await backfillResponseLinkage(winner.id)

  // Self-heal the two things a row created before this pass got wrong: an attach-time
  // received date, and a status frozen at whatever it was when the row was synthesized.
  const heal: Record<string, unknown> = {}
  if (tokenRow.created_at && winner.created_at !== tokenRow.created_at) heal.created_at = tokenRow.created_at
  const derivedStatus = existingResponse?.status ? mapResponseStatusToInboxStatus(existingResponse.status) : null
  if (derivedStatus && winner.status !== derivedStatus) heal.status = derivedStatus
  // Filled, never reassigned: an invitation row already owned by a different account is not
  // this vendor's to claim, and silently repointing it would be a misattribution.
  if (winner.partner_id == null) heal.partner_id = partnerId
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
  // only the request whose own row survived the collapse announces the invitation.
  if (created && !existingResponse && winner.id === insertedId) {
    try {
      await createNotification({
        supabase,
        userId: partnerId,
        type: "project_assignment",
        title: "New RFP in your inbox",
        message: `${agencyCompanyName} sent you an RFP${tokenRow.scope_item_name ? ` for ${tokenRow.scope_item_name}` : ""}.`,
        link: `/partner/rfps/${winner.id}`,
        data: { inboxId: winner.id, magicToken: tokenRow.token },
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
