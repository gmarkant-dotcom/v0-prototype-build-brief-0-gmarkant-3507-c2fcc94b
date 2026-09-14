import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { orgIdFromColumn, resolveCallerWriteOrgId } from "@/lib/entitlements"
import {
  RFP_CLOSABLE_STATUSES,
  isRfpClosureUnit,
  statusForUnit,
  type RfpClosureStatus,
  type RfpClosureUnit,
} from "@/lib/rfp-closure"
import {
  buildBrandedEmailHtml,
  resolveOrgNotificationRecipients,
  sendTransactionalEmail,
  siteBaseUrl,
} from "@/lib/email"
import { notifyRfpClosed, notifyRfpNotSelected } from "@/lib/notifications"
import { closureEmailCopy } from "@/lib/rfp-closure-copy"

export const dynamic = "force-dynamic"

/**
 * POST /api/agency/rfp-closure
 *
 * R7's two closure actions, in one route:
 *
 *   { inbox_item_id, unit: "rfp"    }  close the whole RFP for every vendor
 *   { inbox_item_id, unit: "vendor" }  decline this one vendor, others stay open
 *
 * ---------------------------------------------------------------------------
 * WHY ONE ROUTE AND NOT TWO
 *
 * The two actions differ by four lines: which rows they select and which status
 * they write. They share the authentication, the ownership verification, the
 * closable-status allow-list, the idempotency rule and the notification
 * emission. Two routes would be two copies of the ownership check, and a
 * security check that exists twice is a security check that will eventually
 * exist in two versions.
 *
 * ---------------------------------------------------------------------------
 * >>> THE SECURITY REQUIREMENT. READ THIS BEFORE CHANGING ANYTHING BELOW.
 *
 * `inbox_item_id` ARRIVES FROM THE CLIENT AND IS A CLAIM, NOT A FACT. Nothing
 * about it is trusted. Before any write, this route resolves the caller's own
 * organization through MEMBERSHIP and re-reads the row with that organization
 * as an explicit filter. A row that is not the caller's simply is not found,
 * and the response is a 404 rather than a 403 - a 403 would confirm the row
 * exists to somebody who may not know that.
 *
 * THIS CODEBASE HAS ALREADY SHIPPED THE DEFECT THIS PREVENTS. Migration 085's
 * header documents the unconstrained vendor_org_id on partnership insert: an
 * identifier taken from a request body and written without checking who owned
 * it. Without the check below, any lead agency closes another agency's requests
 * by changing one value in a fetch.
 *
 * >>> resolveCallerWriteOrgId, NEVER A VISIBILITY SET.
 * current_user_counterparty_org_ids() and current_user_visible_profile_ids()
 * are VISIBILITY sets: they answer "whose rows may this caller see". A vendor
 * partnered with an agency is INSIDE both of them. Scoping a write with either
 * would let a vendor close the agency's own requests. resolveCallerWriteOrgId
 * resolves through org_members, which is an AUTHORITY set, and it refuses
 * outright when a caller belongs to several organizations and none is selected
 * rather than picking one (see lib/acting-org.ts).
 *
 * THE DATABASE IS THE SECOND LINE, NOT THE FIRST. Migration 099's
 * "Agencies update own partner RFP inbox rows" policy is scoped to
 * lead_org_id IN (current_user_org_ids()), so a cross-organization write is
 * also refused by RLS. That is a backstop. This check is the one that produces
 * a comprehensible answer instead of a silent zero-row success.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY. 3d.
 *
 * Both actions filter on `status IN (new, viewed)`. A row that is already
 * closed, already not_selected, or that carries a bid is NOT in that set, so it
 * is not updated, generates no notification, and costs nothing. Closing an
 * already-closed RFP returns 200 with `closed: 0`. That is a no-op, not an
 * error: an agency who clicks twice, or two colleagues who click at once,
 * should see the same calm result as an agency who clicked once.
 *
 * The filter is part of the UPDATE statement rather than a read-then-write, so
 * two concurrent requests cannot both pass a check and both notify. PostgreSQL
 * serialises the row locks and the second UPDATE sees the first one's status.
 *
 * ---------------------------------------------------------------------------
 * ORDERING AGAINST MIGRATION 099. THIS ROUTE DOES NOT WORK WITHOUT IT.
 *
 * Before 099 is applied:
 *   - the status write raises 23514 and this route returns 500. Visible.
 *   - closed_at does not exist, so the write raises 42703. Also visible.
 *   - there is no lead-agency UPDATE policy, so even a permitted status would
 *     match ZERO ROWS and PostgREST would not call that an error. Invisible.
 * The third is why this route reports the affected count rather than assuming
 * its own success, and why a zero count on a row this route just read as
 * closable is logged as the anomaly it is.
 */

type Body = {
  inbox_item_id?: unknown
  unit?: unknown
}

type InboxRow = {
  id: string
  lead_org_id: string
  vendor_org_id: string | null
  recipient_email: string | null
  project_id: string | null
  scope_item_name: string | null
  status: string
}

export async function POST(req: Request) {
  const route = "/api/agency/rfp-closure"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase, profile } = auth

    const body = (await req.json().catch(() => ({}))) as Body

    const inboxItemId = typeof body.inbox_item_id === "string" ? body.inbox_item_id.trim() : ""
    if (!inboxItemId) {
      return NextResponse.json({ error: "inbox_item_id is required" }, { status: 400 })
    }
    if (!isRfpClosureUnit(body.unit)) {
      return NextResponse.json({ error: 'unit must be "rfp" or "vendor"' }, { status: 400 })
    }
    const unit: RfpClosureUnit = body.unit
    const nextStatus = statusForUnit(unit)

    // ─── THE OWNERSHIP CHECK. NOTHING BELOW THIS RUNS WITHOUT IT. ───────────
    //
    // resolveCallerWriteOrgId goes through org_members. It returns null when
    // the caller belongs to no organization, and ALSO when they belong to
    // several and none is selected - which is a refusal rather than a guess,
    // because guessing here would attribute one customer's closure to another
    // customer's company.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      console.error("[api] failure", {
        route, method: "POST", code: 403, userId: user.id,
        message: "caller belongs to no organization, or to several with none selected",
      })
      return NextResponse.json(
        { error: "Your account is not linked to an organization yet" },
        { status: 403 }
      )
    }

    // THE IDENTIFIER IS RE-READ UNDER THE CALLER'S OWN ORGANIZATION.
    // `.eq("lead_org_id", writeOrgId)` is the whole check. A row belonging to
    // another agency returns zero rows here and never reaches a write.
    const { data: subjectRaw, error: subjectErr } = await supabase
      .from("partner_rfp_inbox")
      .select("id, lead_org_id, vendor_org_id, recipient_email, project_id, scope_item_name, status")
      .eq("id", inboxItemId)
      .eq("lead_org_id", writeOrgId)
      .maybeSingle()

    if (subjectErr) {
      console.error("[api] failure", {
        route, method: "POST", userId: user.id, inboxItemId,
        code: subjectErr.code, message: subjectErr.message,
      })
      return NextResponse.json({ error: "Failed to load the request" }, { status: 500 })
    }

    if (!subjectRaw) {
      // 404 AND NOT 403, DELIBERATELY. "Forbidden" tells a caller probing other
      // agencies' identifiers that the row exists. "Not found" tells them
      // nothing they did not already supply.
      console.warn("[api] rfp-closure: identifier did not resolve under the caller's organization", {
        route, userId: user.id, orgId: writeOrgId, inboxItemId,
      })
      return NextResponse.json({ error: "Request not found" }, { status: 404 })
    }

    const subject = subjectRaw as InboxRow
    const now = new Date().toISOString()

    // ─── SELECT THE ROWS TO CLOSE ───────────────────────────────────────────
    //
    // Both branches carry `.eq("lead_org_id", writeOrgId)` on the UPDATE itself
    // as well as on the read above. That is not redundant: between the read and
    // the write, the only thing tying the second statement to the ownership
    // check is that predicate. Dropping it would make the read decorative.
    let query = supabase
      .from("partner_rfp_inbox")
      .update({ status: nextStatus, closed_at: now, updated_at: now })
      .eq("lead_org_id", writeOrgId)
      // 3a AND 3d IN ONE CLAUSE. Rows carrying a bid are outside this set and
      // are left alone; rows already closed are outside it and re-closing is a
      // no-op. See RFP_CLOSABLE_STATUSES for why it is an allow-list.
      .in("status", RFP_CLOSABLE_STATUSES as unknown as string[])

    if (unit === "vendor") {
      // ONE ROW. Every other vendor on this RFP is untouched.
      query = query.eq("id", subject.id)
    } else {
      // THE WHOLE RFP. The unit of an RFP in this codebase is
      // (project_id, scope_item_name) - the same key lib/bid-shared.ts's
      // scopeKeyForRow builds to decide which bids are comparable.
      //
      // >>> BOTH HALVES OF THE KEY ARE TAKEN FROM THE ROW THIS ROUTE JUST READ
      // >>> UNDER THE CALLER'S OWN ORGANIZATION, NEVER FROM THE REQUEST BODY.
      // A client that could name the project and scope directly could close a
      // scope it does not own by pairing it with an id it does.
      query = query.eq("scope_item_name", subject.scope_item_name)
      if (subject.project_id === null) {
        // A magic-link row can carry a null project_id. `.eq(col, null)` sends
        // `col=eq.null`, which matches nothing - it has to be IS NULL, or the
        // whole-RFP close would silently affect zero rows on exactly the flow
        // that produced most of the deadline-less backlog.
        query = query.is("project_id", null)
      } else {
        query = query.eq("project_id", subject.project_id)
      }
    }

    const { data: affected, error: updateErr } = await query.select(
      "id, vendor_org_id, recipient_email, scope_item_name, project_id"
    )

    if (updateErr) {
      console.error("[api] failure", {
        route, method: "POST", userId: user.id, orgId: writeOrgId,
        inboxItemId, unit, nextStatus,
        code: updateErr.code, message: updateErr.message,
      })
      // 23514 means migration 099 is not applied. 42703 means the same thing
      // about closed_at. Both are the deploy-order mistake, not a user error,
      // and both are worth naming in the log rather than in the response.
      if (updateErr.code === "23514" || updateErr.code === "42703") {
        console.error(
          "[api] rfp-closure: this looks like migration 099 not being applied. " +
            "The route cannot write 'closed'/'not_selected' or set closed_at until it is.",
          { route, code: updateErr.code }
        )
      }
      return NextResponse.json({ error: "Failed to close the request" }, { status: 500 })
    }

    const affectedRows = (affected ?? []) as Array<{
      id: string
      vendor_org_id: string | null
      recipient_email: string | null
      scope_item_name: string | null
      project_id: string | null
    }>

    // >>> THE ANOMALY WORTH LOGGING. The subject row was read as closable a few
    // lines ago and nothing was updated. Either a concurrent request got there
    // first - which is fine and is what idempotency is for - or the lead-agency
    // UPDATE policy from migration 099 is missing and this route is reporting
    // success while writing nothing. The two are indistinguishable from here,
    // so the log says so rather than picking one.
    if (affectedRows.length === 0 && (subject.status === "new" || subject.status === "viewed")) {
      console.warn(
        "[api] rfp-closure: the subject row read as closable but the UPDATE affected zero rows. " +
          "Either a concurrent close won, or migration 099's agency UPDATE policy is not applied.",
        { route, userId: user.id, orgId: writeOrgId, inboxItemId, unit, subjectStatus: subject.status }
      )
    }

    // ─── PHASE 4. TELL THE VENDOR. EMAIL AND IN-APP, BOTH EVENTS. ──────────
    //
    // >>> R7: "A request vanishing silently reads as a bug." Every row this
    // route just closed is a request a vendor is still expecting to act on.
    //
    // FIRE AND FORGET, PER ROW, EACH IN ITS OWN try/catch. The write has already
    // committed. A notification that fails must never turn a completed closure
    // into a 500, because the caller would retry, the retry would be a no-op by
    // idempotency, and the agency would be told their action failed when it did
    // not. Every failure is logged with enough to find the row again.
    const notified = await emitClosureNotifications({
      supabase,
      rows: affectedRows,
      status: nextStatus,
      leadOrgId: writeOrgId,
      route,
    })

    console.log("[api] success", {
      route, method: "POST", userId: user.id, role: profile.role,
      orgId: writeOrgId, unit, nextStatus,
      subjectStatus: subject.status, closed: affectedRows.length,
      emailed: notified.emailed, inApp: notified.inApp, unreachable: notified.unreachable,
    })

    return NextResponse.json({
      ok: true,
      unit,
      status: nextStatus,
      closed: affectedRows.length,
      // Reported so an agency can be told the truth about who was reached,
      // rather than shown a count of rows and left to assume mail went with it.
      emailed: notified.emailed,
      unreachable: notified.unreachable,
      scope_item_name: subject.scope_item_name,
      // The caller uses this to refresh the right SWR key without a full reload.
      inbox_item_ids: affectedRows.map((r) => r.id),
    })
  } catch (e) {
    console.error("[api] failure", {
      route, method: "POST", code: 500,
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: "Failed to close the request" }, { status: 500 })
  }
}


type ClosureRow = {
  id: string
  vendor_org_id: string | null
  recipient_email: string | null
  scope_item_name: string | null
  project_id: string | null
}

/**
 * ONE EMAIL AND ONE IN-APP NOTIFICATION PER CLOSED ROW.
 *
 * ---------------------------------------------------------------------------
 * HOW A RECIPIENT IS RESOLVED, AND WHY THE ORDER IS THIS WAY ROUND
 *
 * 1. vendor_org_id set -> resolveOrgNotificationRecipients(). THIS IS THE PATH
 *    THAT RESPECTS THE PREFERENCE TOGGLE: that helper skips any profile whose
 *    notification_preferences.email is exactly false (lib/email.ts:449). Reading
 *    recipient_email directly would bypass it, which is why that is not the
 *    first branch even though it is the simpler one.
 *
 * 2. It returned nobody AND recipient_email is set -> send to recipient_email,
 *    and LOG THAT THE PREFERENCE COULD NOT BE CHECKED. This is not a loophole,
 *    it is lib/email.ts:370-372's own standing ruling applied here: "the failure
 *    direction for a notification system is to send one too many, never to go
 *    quiet." It matters because org_members has a self-row-only SELECT policy,
 *    so an AGENCY reading a VENDOR organization's members legitimately gets zero
 *    rows, and without this branch a closure would go unannounced to exactly the
 *    vendors it most needs to reach.
 *
 * 3. vendor_org_id null -> recipient_email. A manual or magic-link recipient
 *    with no account has no preference to respect. This is the same population
 *    broadcast-rfp already emails directly.
 *
 * ---------------------------------------------------------------------------
 * THE IN-APP HALF HAS A LIMIT THAT IS NOT THIS ROUTE'S TO FIX, AND IT IS STATED
 * RATHER THAN DISCOVERED.
 *
 * The notifications INSERT policy's counterparty arm is
 * current_user_commercial_counterparty_user_ids(), which requires a
 * `partnerships` row between the two organizations at status pending, active or
 * suspended (096:302-327). A vendor reached as a manual recipient or a magic
 * link who never became a partnership IS NOT IN THAT SET, so their bell row is
 * refused by RLS and createOrgNotification returns false.
 *
 * >>> THEY GET THE EMAIL AND NO BELL. That is a pre-existing boundary, widening
 * it is a separate decision on a different predicate, and this function counts
 * the two channels separately so the gap is measurable instead of assumed.
 */
async function emitClosureNotifications({
  supabase,
  rows,
  status,
  leadOrgId,
  route,
}: {
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>
  rows: ClosureRow[]
  status: RfpClosureStatus
  leadOrgId: string
  route: string
}): Promise<{ emailed: number; inApp: number; unreachable: number }> {
  let emailed = 0
  let inApp = 0
  let unreachable = 0

  if (rows.length === 0) return { emailed, inApp, unreachable }

  // The agency's own display name, read once for the whole batch. Falls back to
  // a neutral noun rather than an empty string: "  has closed the RFP" is worse
  // than "The lead agency has closed the RFP".
  let agencyName = "The lead agency"
  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", leadOrgId)
      .maybeSingle<{ name: string | null }>()
    if (org?.name && org.name.trim()) agencyName = org.name.trim()
  } catch (nameErr) {
    console.warn("[api] rfp-closure: could not read the acting organization's name", {
      route, leadOrgId, message: nameErr instanceof Error ? nameErr.message : String(nameErr),
    })
  }

  const baseUrl = siteBaseUrl()

  for (const row of rows) {
    const scopeItemName = (row.scope_item_name || "").trim() || "a scope item"
    const copy = closureEmailCopy(status, { agencyName, scopeItemName })

    // ── IN-APP ────────────────────────────────────────────────────────────
    if (row.vendor_org_id) {
      try {
        const ok =
          status === "closed"
            ? await notifyRfpClosed(supabase, row.vendor_org_id, scopeItemName, agencyName)
            : await notifyRfpNotSelected(supabase, row.vendor_org_id, scopeItemName, agencyName)
        if (ok) inApp += 1
      } catch (notifyErr) {
        console.error("[api] rfp-closure: in-app notification threw", {
          route, inboxItemId: row.id, vendorOrgId: row.vendor_org_id, status,
          message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        })
      }
    }

    // ── EMAIL ─────────────────────────────────────────────────────────────
    // {email, name} pairs rather than bare addresses: buildBrandedEmailHtml
    // requires a recipientName, and a greeting that says "Hi ," is worse than
    // one that says "Hi there".
    let addresses: { email: string; name: string }[] = []
    let preferenceChecked = true
    const vendorOrgId = orgIdFromColumn(row.vendor_org_id)
    if (vendorOrgId) {
      try {
        const recipients = await resolveOrgNotificationRecipients(vendorOrgId, supabase)
        addresses = recipients.map((r) => ({
          email: r.email,
          name: (r.full_name || r.company_name || "").trim() || "there",
        }))
      } catch (lookupErr) {
        console.error("[api] rfp-closure: recipient lookup threw", {
          route, inboxItemId: row.id, vendorOrgId: row.vendor_org_id,
          message: lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
        })
      }
    }
    if (addresses.length === 0 && row.recipient_email && row.recipient_email.trim()) {
      addresses = [{ email: row.recipient_email.trim(), name: "there" }]
      preferenceChecked = !vendorOrgId
      if (!preferenceChecked) {
        console.warn(
          "[api] rfp-closure: falling back to recipient_email because the vendor organization " +
            "resolved no recipients. The notification_preferences opt-out could NOT be checked " +
            "for this send. See lib/email.ts:370-372 for why sending anyway is the ruling.",
          { route, inboxItemId: row.id, vendorOrgId: row.vendor_org_id }
        )
      }
    }

    if (addresses.length === 0) {
      unreachable += 1
      console.error(
        "[api] rfp-closure: the request was closed and NOBODY COULD BE TOLD. No resolvable " +
          "recipient on the vendor organization and no recipient_email on the row.",
        { route, inboxItemId: row.id, vendorOrgId: row.vendor_org_id, status }
      )
      continue
    }

    for (const to of addresses) {
      try {
        await sendTransactionalEmail({
          to: to.email,
          subject: copy.subject,
          html: buildBrandedEmailHtml({
            title: copy.title,
            recipientName: to.name,
            body: copy.body,
            ctaText: "View your requests",
            ctaUrl: `${baseUrl}/partner/rfps`,
          }),
        })
        emailed += 1
      } catch (emailErr) {
        console.error("[api] rfp-closure: Resend send failed", {
          route, inboxItemId: row.id, to: to.email, status,
          message: emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
      }
    }
  }

  return { emailed, inApp, unreachable }
}
