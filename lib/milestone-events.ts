import type { createClient } from "./supabase/server"
import type { Capability } from "./capabilities"
import type { OrgId } from "@/lib/entitlements"

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
 * 080 IS APPLIED. THE INSERT IS STILL FIRE-AND-FORGET, AND THAT IS DELIBERATE
 *
 * `milestone_events` exists. What can still fail is narrower than it was, and worth naming:
 * a foreign key violation (23503) on org_id, vendor_org_id, partnership_id or actor_id,
 * since 080 put real keys on all four; and a denial from the INSERT policy. Neither may take
 * down a broadcast, an award or an invitation with it.
 *
 * Every function here is fire-and-forget: it catches everything, returns void, and logs. A
 * breadcrumb is strictly less important than the action it describes, and this follows the
 * same rule the email sends in this codebase already follow - the award is recorded, then the
 * mail is attempted inside try/catch, and a failed mail never rolls back the award.
 *
 * The one behaviour worth knowing: a missing table logs at WARN, once per call, separately
 * from everything else, because "the table is not there" is a different thing to act on than
 * "the insert was rejected". With 080 applied it now means a broken environment rather than
 * a pending migration. Everything else logs at ERROR.
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
  orgId: OrgId | null
  /** The acting USER. Null only for guest / magic-link actors, who have no account. */
  actorId: string | null
  /**
   * Identity fallback for an actor with no account, and ONLY for one. Setting this beside a
   * non-null `actorId` is a defect: it is enforced below, not merely asked for. Only ever
   * rendered to a counterparty as a domain - see `emailDomain()` in lib/activity-feed.ts.
   */
  actorEmail?: string | null
  /** 079: the counterparty company, when there is one. */
  vendorOrgId?: OrgId | null
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

/**
 * THE actor_email RULE, ENFORCED HERE RATHER THAN ASKED FOR.
 *
 * `actor_email` may be populated only when `actor_id` is null.
 *
 * A guest has no account. The address is their only identity, it is the one the agency
 * themselves sent the invitation to, and without it the row attributes the act to nobody.
 * An authenticated actor is the opposite case in every respect: they have a profile, the
 * renderers already join it, and a stored address is a second copy of an identity that is
 * already resolvable - one that never updates when the profile does, and one sitting in a
 * column the counterparty can read on every whitelisted event type.
 *
 * So the rule is not "prefer the profile". It is that the column has exactly one purpose and
 * a row with both values set has no reading at all: two identities, one of them stale.
 *
 * The enforcement drops the address and keeps the event. A breadcrumb missing an email it was
 * never allowed to carry is correct; a dropped breadcrumb is not, and this module's whole
 * contract is that it never costs the caller anything. The drop logs at ERROR because it means
 * a call site is wrong, and a call site being wrong is something to go and fix.
 */
function resolveActorEmail(event: MilestoneEvent): string | null {
  const email = event.actorEmail ?? null
  if (email === null) return null
  if (event.actorId === null) return email
  console.error(
    "[milestone] actor_email set beside a non-null actor_id - dropping the address, keeping the event. actor_email is the identity of an actor with NO account and may only be written when actor_id is null.",
    {
      eventType: event.eventType,
      subjectType: event.subjectType,
      subjectId: event.subjectId ?? null,
    }
  )
  return null
}

function toRow(event: MilestoneEvent & { orgId: OrgId }): MilestoneRow {
  return {
    org_id: event.orgId,
    vendor_org_id: event.vendorOrgId ?? null,
    partnership_id: event.partnershipId ?? null,
    actor_id: event.actorId,
    actor_email: resolveActorEmail(event),
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

  // 079: `orgId` is typed OrgId | null because it is often read off a database column. Two
  // gates now stand behind it, and this filter is in front of both. Since 080 was applied,
  // milestone_events.org_id REFERENCES organizations(id), so an id that is not an
  // organization raises 23503 rather than passing silently; and an id that IS an
  // organization but not one of the caller's produces a row RLS hides, because the SELECT
  // predicate reads `org_id IN (SELECT public.current_user_org_ids())` - IN (SELECT ...),
  // not `= ANY (...)`, because current_user_org_ids() RETURNS SETOF uuid and `= ANY` on it
  // raises 42809. Dropping the event loudly here beats both a logged key violation and a
  // breadcrumb nobody can ever read.
  const usable = events.filter((e): e is MilestoneEvent & { orgId: OrgId } => Boolean(e.orgId))
  if (usable.length !== events.length) {
    console.error("[milestone] dropped event(s) with no resolvable organization", {
      eventTypes: [...new Set(events.filter((e) => !e.orgId).map((e) => e.eventType))],
      dropped: events.length - usable.length,
    })
  }
  if (usable.length === 0) return

  try {
    const { error } = await supabase.from("milestone_events").insert(usable.map(toRow))
    if (!error) return

    // This branch was dead for its entire working life. A PostgREST request against an
    // unknown relation never reaches the planner - the table is absent from the schema
    // cache, and the client is answered PGRST205, not Postgres 42P01. So the WARN this was
    // written to produce has never fired: not once while 080 was unapplied and this was
    // supposed to be the expected path, and not since. Every one of those drops went out at
    // ERROR through the generic branch below. lib/notifications.ts:57 already tests both
    // codes; this now matches it. 42P01 is kept rather than swapped because it is what a
    // direct SQL path would return, and this module takes whatever client it is handed.
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.warn(
        "[milestone] milestone_events is not in the schema cache. 080 IS applied on this project, so this is an environment fault - a stale cache or the wrong database - not a pending migration. Event(s) dropped.",
        {
          eventTypes: [...new Set(usable.map((e) => e.eventType))],
          // usable.length, not events.length: the ones actually handed to the insert. The
          // other two branches always counted it this way.
          count: usable.length,
          code: error.code,
        }
      )
      return
    }

    console.error("[milestone] insert failed (the action itself succeeded)", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      code: error.code,
      message: error.message,
    })
  } catch (e) {
    console.error("[milestone] insert threw (the action itself succeeded)", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
