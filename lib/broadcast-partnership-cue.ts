import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"
import { broadcastCuesPartnership } from "@/lib/feature-flags"
import type { BroadcastCueNote } from "@/lib/broadcast-cue-shape"

/**
 * BROADCASTING AN RFP CUES AN INVITATION TO PARTNER. It does not create the partnership.
 *
 * GREG'S RULING (2026-08-19), because the boundaries are the whole design:
 *
 *   - Broadcasting to a vendor automatically CUES an invitation. Accepting is the vendor's
 *     choice and nothing here makes it for them.
 *   - DECLINING DOES NOT CLOSE THE RFP. A vendor can bid with no partnership at all, exactly
 *     as the magic-link path already works. The partnership is required for ONGOING
 *     communication - feedback, messages, onboarding, delivery - not for the transaction.
 *   - The RFP is a TRANSACTION; the partnership is a RELATIONSHIP. Because the invitation
 *     blocks nothing, it must read as a quiet banner and never as a prompt.
 *
 * Built on public.partnerships. `agency_partner_invitations` is a DECOY - zero rows, no
 * readers anywhere in app/ or lib/ (verified by grep on 2026-08-19), and 079 dropped its
 * three policies. Nothing here touches it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE TARGET STATES, AND WHAT EACH ONE GETS
 *
 * A broadcast recipient is not necessarily an account holder. That is the whole point of the
 * magic-link path, and it is the case most likely to be got wrong.
 *
 *   (i)   ACCOUNT + EXISTING PARTNERSHIP (any status, including 'removed').
 *         NOTHING HAPPENS. The row is left exactly as it is. Re-cueing a removed
 *         relationship would resurrect it behind the agency's back, and re-cueing an active
 *         one is meaningless. This is also what makes a repeat broadcast idempotent.
 *
 *   (ii)  ACCOUNT, NO PARTNERSHIP.
 *         A pending row is written with vendor_org_id set. This is the only case where the
 *         cue grants anything: 079's current_user_counterparty_org_ids() admits partnerships
 *         AT ANY STATUS in BOTH DIRECTIONS, so from this moment each company can read the
 *         other's organizations row and every profiles row at it. Quantified in
 *         docs/vendor-visibility-report.md Phase 2d. This is why the flag exists.
 *
 *   (iii) NO ACCOUNT AT ALL.
 *         A GHOST row is written: partner_email set, vendor_org_id NULL. It grants the
 *         vendor NOTHING, in either direction, because the counterparty helper requires
 *         vendor_org_id IS NOT NULL on the lead-agency arm of its union and a NULL can never
 *         be IN the vendor arm's set either. The row is a record for the agency's pool and a
 *         claim target for later. If that person signs up, app/auth/callback/route.ts claims
 *         every vendor_org_id-null row matching their email at status pending or active, and
 *         GET /api/partnerships claims the same set on their first portal load - so the cue
 *         is promoted automatically and, crucially, still at status 'pending'. They are
 *         invited, not partnered.
 *
 * OUT OF SCOPE, NAMED RATHER THAN IMPLIED: a guest magic-link recipient who bids and never
 * creates an account. They have no organization, so there is nothing for a partnership to
 * point at and nothing for them to accept in a portal they do not have. They bid as a guest
 * today and they keep bidding as a guest. Nothing in this file changes their path.
 *
 * ---------------------------------------------------------------------------
 * HOW A CUED ROW DIFFERS FROM A DELIBERATE POOL INVITATION
 *
 * Both carry status 'pending'. They must still be distinguishable, or the deliberate ones
 * lose their meaning - an agency that chose to invite somebody has said something a
 * side effect never said.
 *
 *                          deliberate (POST /api/partnerships,   cued by broadcast
 *                          markPartnershipInvited)
 *   status                 'pending'                             'pending'
 *   invitation_sent_at     set                                   NULL
 *   partnership_notes      no cue key                            .cued_by_broadcast set
 *   email                  its own "invited you to join their    none - the RFP mail
 *                          partner network" mail                 already went
 *   /agency/pool column    Invited                               Discovered
 *
 * invitation_sent_at is the load-bearing one: lib/partnership-state.ts reads exactly that
 * column to decide Invited versus Discovered, so leaving it NULL keeps a cued row out of the
 * agency's Invited column without any new state. Nobody deliberately invited anyone.
 */

export type CueTarget = {
  /** The recipient's organization, or null when they hold no account (case iii). */
  vendorOrgId: OrgId | null
  /** Always set. It is the only identity a ghost row has, and the key the claim path uses. */
  email: string
}

export type CueOutcome = {
  created: number
  skippedExisting: number
  skippedRace: number
  failed: number
}

const EMPTY: CueOutcome = { created: 0, skippedExisting: 0, skippedRace: 0, failed: 0 }

/**
 * Cue one pending invitation per broadcast recipient that does not already have a
 * partnership with this agency.
 *
 * FIRE AND FORGET BY CONTRACT. The broadcast has already written its inbox rows and, by the
 * time this runs, may already have sent mail. A cue is a courtesy; it must never be the
 * reason a broadcast reports failure. Every path returns rather than throws.
 *
 * IDEMPOTENCY, AND THE RACE THIS PRODUCT HAS ALREADY LOST ONCE. Check-then-insert with no
 * unique constraint is exactly the shape that produced eight duplicate groups in
 * partner_rfp_inbox, one of them nineteen rows deep, from two requests eleven milliseconds
 * apart (LIGAMENT_CONTEXT.md constraint 5). The same shape is here: /agency/page.tsx can
 * broadcast twice, and two scope items in one broadcast can name the same recipient.
 *
 * So three things hold the invariant, not one:
 *
 *   1. Targets are deduplicated in memory before any query runs, so one broadcast cannot
 *      race itself across scope items.
 *   2. The existence check reads BOTH keys - vendor_org_id when known, and partner_email
 *      otherwise - because a ghost row and an account-holder row for the same person are the
 *      same relationship recorded two ways.
 *   3. 23505 is treated as "somebody else created it", which is a SUCCESS, not an error.
 *      That is the only correct reading of a unique violation on an idempotent insert, and
 *      it is what lets migration 084's partial unique indexes be added later with no code
 *      change at all - the same discipline lib/magic-token-attach.ts already follows.
 *
 * Until 084 is applied there is no index to raise 23505, so today (1) and (2) carry it
 * alone and a sufficiently unlucky pair of concurrent broadcasts could still duplicate.
 * That is stated rather than papered over, and it is why 084 is authored.
 */
export async function cuePartnershipInvitations(
  supabase: SupabaseClient,
  params: {
    leadOrgId: OrgId
    targets: CueTarget[]
    projectId: string | null
    scopeItemName: string | null
  }
): Promise<CueOutcome> {
  if (!broadcastCuesPartnership()) return EMPTY

  const { leadOrgId, targets, projectId, scopeItemName } = params
  if (!leadOrgId || targets.length === 0) return EMPTY

  // (1) Deduplicate in memory first. One broadcast naming the same vendor on three scope
  // items is one relationship, not three.
  const byKey = new Map<string, CueTarget>()
  for (const t of targets) {
    const email = (t.email || "").trim().toLowerCase()
    if (!email) continue
    const key = t.vendorOrgId ? `org:${t.vendorOrgId}` : `email:${email}`
    if (!byKey.has(key)) byKey.set(key, { vendorOrgId: t.vendorOrgId, email })
  }
  const unique = [...byKey.values()]
  if (unique.length === 0) return EMPTY

  const outcome: CueOutcome = { created: 0, skippedExisting: 0, skippedRace: 0, failed: 0 }

  // (2) One read for the whole batch rather than one per recipient. Reads BOTH keys and
  // deliberately applies NO status filter: a 'removed' relationship is still a relationship
  // this agency has had, and quietly re-cueing it would resurrect something they ended.
  const orgIds = unique.map((t) => t.vendorOrgId).filter((id): id is OrgId => Boolean(id))
  const emails = unique.map((t) => t.email)

  const existingOrgIds = new Set<string>()
  const existingEmails = new Set<string>()

  const { data: existing, error: existingErr } = await supabase
    .from("partnerships")
    .select("vendor_org_id, partner_email")
    .eq("lead_org_id", leadOrgId)
    .or(
      [
        orgIds.length > 0 ? `vendor_org_id.in.(${orgIds.join(",")})` : null,
        emails.length > 0 ? `partner_email.in.(${emails.map((e) => `"${e}"`).join(",")})` : null,
      ]
        .filter(Boolean)
        .join(",")
    )

  if (existingErr) {
    // Fail closed: without a reliable existence read there is no way to insert idempotently,
    // and creating duplicates is worse than creating nothing. The broadcast is unaffected.
    console.error("[broadcast-cue] existence check failed, cueing nothing this broadcast", {
      leadOrgId,
      targetCount: unique.length,
      code: existingErr.code,
      message: existingErr.message,
    })
    return { ...EMPTY, failed: unique.length }
  }

  for (const row of (existing ?? []) as Array<{ vendor_org_id?: string | null; partner_email?: string | null }>) {
    if (row.vendor_org_id) existingOrgIds.add(row.vendor_org_id)
    if (row.partner_email) existingEmails.add(row.partner_email.trim().toLowerCase())
  }

  const now = new Date().toISOString()
  const note: BroadcastCueNote = { at: now, project_id: projectId, scope_item_name: scopeItemName }

  for (const target of unique) {
    // Case (i): any existing row, matched on either key. Left untouched.
    if (target.vendorOrgId && existingOrgIds.has(target.vendorOrgId)) {
      outcome.skippedExisting += 1
      continue
    }
    if (existingEmails.has(target.email)) {
      outcome.skippedExisting += 1
      continue
    }

    const { error: insertErr } = await supabase.from("partnerships").insert({
      lead_org_id: leadOrgId,
      // Case (ii) sets this; case (iii) leaves it null and the row is a GHOST, granting the
      // vendor nothing until the claim path fills it in on signup.
      vendor_org_id: target.vendorOrgId,
      partner_email: target.email,
      status: "pending",
      profile_status: target.vendorOrgId ? "active" : "unclaimed",
      // DELIBERATELY NOT STAMPED. This column is what lib/partnership-state.ts reads to put a
      // row in the pool's Invited column, and nobody deliberately invited anybody here.
      invitation_sent_at: null,
      partnership_notes: { cued_by_broadcast: note },
      created_at: now,
      updated_at: now,
    })

    if (!insertErr) {
      outcome.created += 1
      continue
    }

    // (3) A unique violation means a concurrent request got there first. That is the
    // invariant holding, not failing.
    if (insertErr.code === "23505") {
      outcome.skippedRace += 1
      continue
    }

    // 23503 on vendor_org_id would mean the resolved organization does not exist. Logged
    // loudly rather than retried as a ghost: silently downgrading to a row with no vendor
    // would look like success and grant the vendor nothing.
    outcome.failed += 1
    console.error("[broadcast-cue] insert failed", {
      leadOrgId,
      hasVendorOrg: Boolean(target.vendorOrgId),
      code: insertErr.code,
      message: insertErr.message,
    })
  }

  return outcome
}
