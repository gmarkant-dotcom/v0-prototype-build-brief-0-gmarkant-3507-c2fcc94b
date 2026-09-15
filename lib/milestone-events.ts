import * as Sentry from "@sentry/nextjs"

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
 * FIRE-AND-FORGET IS NOT THE SAME AS UNOBSERVED. EVERY DROP NOW REACHES SENTRY.
 *
 * The four drop paths below all returned `undefined` and all wrote a console line. Nothing
 * read those lines. `grep -rn "\[milestone\]"` outside this file finds documentation and
 * nothing else, so a refused insert was, in practice, a breadcrumb that vanished with no
 * observer anywhere - the same shape as the onboarding send that mailed "your documents are
 * ready" while writing zero document rows.
 *
 * SENTRY IS THE OBSERVER, AND IT IS NOT A NEW DEPENDENCY OR AN ASPIRATION. `@sentry/nextjs`
 * is in package.json, `sentry.server.config.ts` calls `Sentry.init` with
 * NEXT_PUBLIC_SENTRY_DSN, `instrumentation.ts` imports it on every Node server boot,
 * next.config.mjs wraps the build in `withSentryConfig`, and the DSN is set in
 * .env.production.local. Six routes already call `Sentry.captureException` for exactly this
 * reason - see app/api/agency/payment-synthesis/route.ts:384. This file now joins them.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. The contract is identical: still `Promise<void>`, still
 * catches everything, still never throws, still never blocks the caller. A vendor's bid must
 * submit whether or not its feed row lands, and every one of the 22 call sites can keep
 * ignoring the result. Making the failure OBSERVABLE and making it FATAL are different
 * changes and only the first one is wanted.
 *
 * A RETURN VALUE WAS CONSIDERED AND NOT ADDED. `createOrgNotification()` returns a boolean
 * and that shape was offered for this module in docs/101-phase0-baseline.md section 4. It is
 * declined for now because no caller would act on it: all 22 sites emit AFTER the act they
 * describe has committed and none of them has a second thing to do on failure. A returned
 * boolean that 22 sites ignore is a wider signature with the same number of observers, which
 * is the theatre this change exists to avoid. The reporting is where the observer is.
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
  /**
   * Which side of the relationship acted. Defaults to "agency", which every emitter written
   * before the vendor side existed relied on and none of them pass.
   *
   * TWO WRITE PATHS REACH A "vendor" ROW, AND THEY ARE CONSTRAINED DIFFERENTLY.
   *
   * A service-role client (the magic-link guest path) is not subject to RLS at all; what
   * constrains it is the token check the route already performed, which no policy could
   * express. A session client (the authenticated portal) goes through migration 088's
   * "Vendors insert own company milestone events", which requires `actor_side = 'vendor'`,
   * `actor_id = auth.uid()`, `actor_email IS NULL`, a `vendorOrgId` the caller is a member
   * of, an event type on `vendor_emittable_event_types()`, and a `partnershipId` whose row
   * ties that vendor to the `orgId` being written.
   *
   * Note what `orgId` is NOT doing on a vendor row: carrying the membership test. It names
   * the AGENCY, because it is the column the agency's own SELECT policy reads and the whole
   * point of a vendor-side event is that it lands on the agency's feed. The acting company
   * is carried by `vendorOrgId`. 080's agency-only INSERT policy therefore refuses a vendor
   * row twice over - wrong side, and an `org_id` that is not one of the vendor's
   * organizations - and that is correct rather than a gap.
   */
  actorSide?: "agency" | "vendor"
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
  actor_side: "agency" | "vendor"
  event_type: string
  subject_type: string
  subject_id: string | null
  payload: Record<string, unknown>
}

/**
 * Report a dropped breadcrumb to Sentry.
 *
 * ONE FUNCTION SO THE FOUR PATHS ARE COMPARABLE. Each drop reason is a distinct `reason`
 * tag, so "how often does gate 1 refuse a vendor row" is a Sentry query rather than a
 * database one - which matters because the RLS refusal is invisible from every other angle:
 * the route succeeded, the user saw success, and the only trace is the row that is not there.
 *
 * `captureMessage`, not `captureException`. Three of the four paths have no Error to attach;
 * PostgREST hands back a plain object, and manufacturing an Error for it would put this
 * file's own line numbers on the stack rather than the call site's, which is the opposite of
 * useful. The route and the event types are on the event as tags and context instead, and
 * those are what a reader actually groups by.
 *
 * NOTHING IDENTIFYING GOES IN. Event types, subject types, codes, counts and PostgREST
 * messages only. No payloads, no emails, no organization ids, no subject ids - the same rule
 * the payload doc at the head of this file states for the counterparty, applied to the error
 * tracker, which has a wider audience than any vendor does.
 *
 * IT CANNOT THROW. Sentry is initialized by instrumentation.ts on the Node server and not at
 * all in some contexts (a unit test, a script, an unconfigured preview). A reporter that
 * threw would convert a silently lost breadcrumb into a thrown one inside a function whose
 * entire contract is that it never throws, so the call is wrapped.
 */
function reportMilestoneDrop(
  reason: "no-organization" | "schema-cache-miss" | "insert-failed" | "insert-threw" | "actor-email-conflict",
  level: "warning" | "error",
  context: Record<string, unknown>
): void {
  try {
    Sentry.captureMessage(`[milestone] breadcrumb dropped: ${reason}`, {
      level,
      tags: { subsystem: "milestone_events", drop_reason: reason },
      extra: context,
    })
  } catch {
    // An unreachable or unconfigured Sentry must never be the thing that breaks an emitter.
  }
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
  // The EVENT survives here; only the address is dropped. Reported anyway, because this one
  // means a call site is passing a field it is not allowed to pass, and that is a code defect
  // rather than a data condition. subjectId is deliberately not sent.
  reportMilestoneDrop("actor-email-conflict", "error", {
    eventType: event.eventType,
    subjectType: event.subjectType,
  })
  return null
}

function toRow(event: MilestoneEvent & { orgId: OrgId }): MilestoneRow {
  return {
    org_id: event.orgId,
    vendor_org_id: event.vendorOrgId ?? null,
    partnership_id: event.partnershipId ?? null,
    actor_id: event.actorId,
    actor_email: resolveActorEmail(event),
    // Defaults to the agency, because every emitter written before the vendor side existed
    // omits it. A "vendor" row reaches the database either through a service-role client
    // (the guest path) or through migration 088's vendor INSERT policy (the portal path) -
    // see the field's doc on MilestoneEvent for what each one constrains.
    actor_side: event.actorSide ?? "agency",
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
    const droppedTypes = [...new Set(events.filter((e) => !e.orgId).map((e) => e.eventType))]
    console.error("[milestone] dropped event(s) with no resolvable organization", {
      eventTypes: droppedTypes,
      dropped: events.length - usable.length,
    })
    // NO LIVE CALL SITE CAN REACH THIS TODAY, and it is reported loudly for that exact
    // reason. All 22 emit sites either guard `resolveCallerWriteOrgId` with an early 403 or
    // read org_id off a column migration 079 made NOT NULL, so an event arriving here means
    // a NEW emitter was written that resolves a membership SET and never a single write id -
    // the shape docs/emitter-rulings-owed.md rulings 3 and 4 would produce. It compiles, it
    // runs, it returns success, and it writes nothing. This is how that gets noticed on the
    // first request instead of on the first person to ask why the feed is short.
    reportMilestoneDrop("no-organization", "error", {
      eventTypes: droppedTypes,
      dropped: events.length - usable.length,
      submitted: events.length,
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
      reportMilestoneDrop("schema-cache-miss", "warning", {
        eventTypes: [...new Set(usable.map((e) => e.eventType))],
        count: usable.length,
        code: error.code,
      })
      return
    }

    console.error("[milestone] insert failed (the action itself succeeded)", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      code: error.code,
      message: error.message,
    })
    // THE ONE PATH THAT IS REACHABLE IN PRODUCTION TODAY, and the reason this change exists.
    // An RLS refusal arrives here as 42501. The live case is migration 088's vendor INSERT
    // policy, whose `partnership_id IS NOT NULL` clause refuses rfp.view, bid.submit,
    // bid.revise and nda.acknowledge from a vendor who has no partnership row with the
    // agency yet - which is the normal state of a vendor early in the journey, and is
    // docs/emitter-rulings-owed.md ruling 6. `vendorPartnershipMissing` separates that known
    // case from an unknown refusal, so ruling 6's ongoing cost can be counted without
    // burying a genuinely new failure inside the same number.
    reportMilestoneDrop("insert-failed", "error", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      code: error.code,
      message: error.message,
      actorSides: [...new Set(usable.map((e) => e.actorSide ?? "agency"))],
      vendorPartnershipMissing: usable.some((e) => (e.actorSide ?? "agency") === "vendor" && !e.partnershipId),
    })
  } catch (e) {
    console.error("[milestone] insert threw (the action itself succeeded)", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      message: e instanceof Error ? e.message : String(e),
    })
    // The only branch with a real Error, so the exception goes too - it carries the stack,
    // which for a transport-level throw is the whole diagnostic. The message event is kept
    // beside it so all four drop reasons stay queryable under one tag.
    try {
      Sentry.captureException(e, { tags: { subsystem: "milestone_events", drop_reason: "insert-threw" } })
    } catch {
      // See reportMilestoneDrop.
    }
    reportMilestoneDrop("insert-threw", "error", {
      eventTypes: [...new Set(usable.map((e) => e.eventType))],
      count: usable.length,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
