import type { createClient } from "./supabase/server"
import type { Capability } from "./capabilities"

/**
 * Milestone attribution: the breadcrumb of who did what at a key stage.
 *
 * Greg's ruling this implements: attribution belongs in M1, scoped to milestones rather than
 * a created_by column on every table. Who sent the RFP, who awarded the bid, who wrote the
 * feedback - visible to every member of the same company, and the actor NAMED to the vendor
 * without exposing the team's contact details.
 *
 * ---------------------------------------------------------------------------
 * WHAT BACKS THIS, AND WHY IT IS A NEW TABLE
 *
 * docs/milestone-attribution-map.md section 1 examined the two mechanisms that already exist
 * and ruled both out. The dashboard's "Recent Activity" feed is DERIVED - a union of four
 * timestamp columns computed per request in app/api/agency/dashboard/route.ts:370-418, never
 * persisted, and every line's subject is the counterparty rather than an agency-side actor.
 * `notifications` is per recipient rather than per event, has no actor column, has a
 * partnership-scoped INSERT policy that cannot reach a colleague, and nothing reads it.
 *
 * So this writes to `milestone_events`, created by supabase/migrations/080_milestone_events.sql.
 *
 * ---------------------------------------------------------------------------
 * 080 IS AUTHORED AND NOT APPLIED, WHICH IS WHY NOTHING HERE THROWS
 *
 * Until Greg runs 080, `milestone_events` does not exist and every insert from this module
 * returns Postgres 42P01, undefined_table. That is expected, and it must not take down a
 * broadcast, an award or an invitation with it.
 *
 * Every function here is fire-and-forget: it catches everything, returns void, and logs. A
 * breadcrumb is strictly less important than the action it describes, and this follows the
 * same rule the email sends in this codebase already follow - the award is recorded, then the
 * mail is attempted inside try/catch, and a failed mail never rolls back the award.
 *
 * The one behaviour worth knowing: a missing table logs at WARN, once per call, with a
 * message naming migration 080. Everything else logs at ERROR. So an unapplied migration
 * reads as an unapplied migration in the logs, not as a fault.
 *
 * ---------------------------------------------------------------------------
 * WHAT MIGRATION 079 CHANGES HERE
 *
 * `orgId` and `vendorOrgId` hold profile ids today, because one user is one company. At 079
 * they hold organization ids. The COLUMN NAMES already match the post-079 world, so this
 * file is not part of the 707-reference rename - only the values change, and they change
 * wherever the caller resolves them. Each call site passes `user.id`, which is the same
 * expression every other company-scoped write in this codebase uses today and the same one
 * 079 has to revisit everywhere. Marked "079:" at each site.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NOT GO IN A PAYLOAD
 *
 * The vendor-visible event types are readable by the counterparty, whole row included. A
 * payload on one of those types is vendor-readable data - so it carries names, counts and
 * scope titles, never internal scoring, never a colleague's email address, never anything
 * the agency would not put in the email it already sends for the same act.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The kind of row a milestone points at. Free-form in the database, a union here, because
 * the compiler is the only thing in this repository that can keep the two in step and it
 * only gets the chance where a type exists.
 */
export type MilestoneSubjectType =
  | "project"
  | "partnership"
  | "bid"
  | "rfp_inbox"
  | "msa"
  | "payment_milestone"

export type MilestoneEvent = {
  /**
   * The capability name for the action that produced this. One vocabulary for "who may do
   * this" and "who did this", so the two can never drift into two spellings of one idea.
   * Typing it as Capability is what enforces that.
   */
  eventType: Capability
  /** 079: the acting company. A profiles.id today, organizations.id after. */
  orgId: string
  /** The acting USER. Null only for guest / magic-link actors, who have no account. */
  actorId: string | null
  /** Identity fallback for those actors. Never rendered to a counterparty. */
  actorEmail?: string | null
  /** 079: the counterparty company, when there is one. */
  vendorOrgId?: string | null
  /** Set this whenever a vendor is a party. It is what makes the event reachable by them. */
  partnershipId?: string | null
  subjectType: MilestoneSubjectType
  subjectId?: string | null
  /** Vendor-readable on a whitelisted event type. Names, counts and titles only. */
  payload?: Record<string, unknown>
}

type MilestoneRow = {
  org_id: string
  vendor_org_id: string | null
  partnership_id: string | null
  actor_id: string | null
  actor_email: string | null
  actor_side: "agency"
  event_type: string
  subject_type: string
  subject_id: string | null
  payload: Record<string, unknown>
}

function toRow(event: MilestoneEvent): MilestoneRow {
  return {
    org_id: event.orgId,
    vendor_org_id: event.vendorOrgId ?? null,
    partnership_id: event.partnershipId ?? null,
    actor_id: event.actorId,
    actor_email: event.actorEmail ?? null,
    // Only the agency side emits today, and migration 080's INSERT policy permits only the
    // agency side. The vendor-side policy and the vendor-side emitters ship together.
    actor_side: "agency",
    event_type: event.eventType,
    subject_type: event.subjectType,
    subject_id: event.subjectId ?? null,
    payload: event.payload ?? {},
  }
}

/**
 * Record one milestone. Never throws, never returns a failure, never blocks the caller's
 * result. Await it, or do not - either is correct.
 */
export async function recordMilestone(
  supabase: SupabaseServerClient,
  event: MilestoneEvent
): Promise<void> {
  await recordMilestones(supabase, [event])
}

/**
 * Record many milestones in one insert.
 *
 * An RFP broadcast is one act producing one row PER RECIPIENT, because vendor visibility is
 * per partnership: a single row with no partnership_id would be invisible to every vendor it
 * was actually sent to, and `rfp.broadcast` is on the vendor-visible whitelist precisely so
 * they can see it. One insert, not N.
 */
export async function recordMilestones(
  supabase: SupabaseServerClient,
  events: MilestoneEvent[]
): Promise<void> {
  if (events.length === 0) return

  try {
    const { error } = await supabase.from("milestone_events").insert(events.map(toRow))
    if (!error) return

    if (error.code === "42P01") {
      console.warn(
        "[milestone] milestone_events table not present - migration 080 is authored and not applied. Event(s) dropped.",
        { eventTypes: [...new Set(events.map((e) => e.eventType))], count: events.length }
      )
      return
    }

    console.error("[milestone] insert failed (the action itself succeeded)", {
      eventTypes: [...new Set(events.map((e) => e.eventType))],
      count: events.length,
      code: error.code,
      message: error.message,
    })
  } catch (e) {
    console.error("[milestone] insert threw (the action itself succeeded)", {
      eventTypes: [...new Set(events.map((e) => e.eventType))],
      count: events.length,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
