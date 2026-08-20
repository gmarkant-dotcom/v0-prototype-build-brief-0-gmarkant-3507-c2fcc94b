/**
 * The Recent Activity feed: grouping, mapping and merging.
 *
 * Implements docs/recent-activity-merge-design.md. Read that first - the reasoning behind
 * the grouping key in particular is not recoverable from this code.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN lib/ AND NOT IN THE ROUTE
 *
 * Design section 6.2. `milestone_events` has a counterparty SELECT policy, a 23-type
 * whitelist and a (partnership_id, event_type) partial index that exists for exactly one
 * query, so a vendor-side feed is clearly intended. If the grouping rule and the row ->
 * item mapper are written inline in app/api/agency/dashboard/route.ts, the vendor feed
 * reimplements both, and the grouping rule - which rests on a subtle transaction-timestamp
 * argument (section 1.1) - gets reimplemented by someone reading the OUTPUT rather than
 * the reasoning.
 *
 * So: same grouping, same shape, DIFFERENT RESOLVER. The actor resolver is injected. The
 * agency resolver returns `self` for the signed-in user, `teammate` for a colleague,
 * `counterparty` for the vendor org. The vendor resolver returns `counterparty` for any
 * agency-side actor and never touches `actor_email`.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THAT MUST NOT CROSS THIS BOUNDARY
 *
 * 1. `actor_email`. It is NOT on `ActivityItem` and there is no code path here that reads
 *    it. `MilestoneFeedRow.actor_email` is optional precisely so the vendor feed can OMIT
 *    IT FROM ITS SELECT LIST - "never in hand" is enforced by the column list a caller
 *    asks for, not by a filter applied afterwards. The agency resolver may return it
 *    inside its own actor type; nothing here puts it anywhere else.
 *
 * 2. `payload`. It is NOT passed through to the client. `buildMilestonePredicate` reads
 *    exactly ONE key out of it - `scope_item_name` - through `payloadString`, which is the
 *    only function in this file that touches a payload at all. `rfp.broadcast` is on the
 *    vendor-visible whitelist and RLS is row level, so the counterparty reads that whole
 *    payload: it already carries `recipient_email`, and a passthrough would ship that to
 *    the browser. This is the same class as the `recipient_count` finding closed on
 *    2026-08-20 (docs/broadcast-payload-leak-fix.md), and a passthrough is exactly how
 *    that class comes back.
 */

// =====================================================================
// ACTORS
// =====================================================================

/**
 * Named by RELATION TO THE VIEWER, not by side. Design section 6.1, the decision the
 * document rates most expensive to unwind.
 *
 * Kinds named `agency`/`vendor` are named from the agency's seat and INVERT on the
 * vendor's: an agency actor is the counterparty there, and "colleague" would mean a
 * vendor's own teammate. Ship those names and the vendor feed either reuses them with
 * inverted meaning - a bug factory, because the renderer branch that de-emphasises "your
 * own action" would silently de-emphasise the counterparty's - or a second parallel type
 * appears and the two drift.
 *
 * `guest` carries a DISPLAY NAME ONLY. A resolver may widen it with private identity
 * detail for its own feed (the agency one attaches the raw email, for a hover), but the
 * shared shape never has anywhere to put one, so a resolver that forgets cannot leak one.
 */
export type ActivityActor =
  | { kind: "self" }
  | { kind: "teammate"; name: string }
  | { kind: "counterparty"; name: string }
  | { kind: "guest"; name: string }
  | { kind: "system" }

/**
 * A feed line.
 *
 * `A` is the actor type this feed's resolver returns. It defaults to the shared union and
 * is widened by the agency feed only, which adds the guest email. Nothing else about the
 * item differs between feeds.
 */
export type ActivityItem<A extends ActivityActor = ActivityActor> = {
  id: string
  /**
   * The PREDICATE ONLY. No leading subject - the renderer composes actor + predicate, so
   * that "You" / "Dana Whitfield" / "Acme Post" is a rendering decision rather than
   * baked into a string on the server.
   *
   * The one exception is `kind: "system"`, which has no actor at all: there the predicate
   * IS the whole line and the renderer capitalises its first letter.
   */
  text: string
  href: string
  timestamp: string
  actor: A
  /** >1 when this line stands for a grouped batch: DISTINCT VENDORS, not rows. Absent means 1. */
  count?: number
  /** True when the batch was cut by the fetch ceiling and `count` is a floor. Section 1.6. */
  countIsPartial?: boolean
  /**
   * Explicit, replacing the href regex the route used to run over this array. Null when
   * the item has no project. Section 1.5.
   */
  projectId?: string | null
  /** Provenance, so the source-by-source retirement in section 2 stays observable. */
  source: "milestone" | "derived"
}

/**
 * A milestone row, as much of it as the feed needs.
 *
 * `actor_email` is OPTIONAL on purpose. See the header: the vendor feed leaves it out of
 * its select list entirely, so its resolver is never handed one.
 */
export type MilestoneFeedRow = {
  id: string
  event_type: string
  actor_id: string | null
  actor_side: string
  vendor_org_id: string | null
  partnership_id: string | null
  subject_type: string
  subject_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
  /** Agency feed only. Never rendered in the line; never placed on `ActivityItem`. */
  actor_email?: string | null
}

/** Injected per feed. This is the whole difference between the agency and vendor feeds. */
export type ActorResolver<A extends ActivityActor = ActivityActor> = (row: MilestoneFeedRow) => A

// =====================================================================
// GROUPING
// =====================================================================

/**
 * The group key. Design section 1.1.
 *
 *   event_type | actor_id ?? actor_email ?? "guest" | subject_type | subject_id ?? "-" | created_at
 *
 * with `created_at` compared EXACTLY, as a string, not bucketed.
 *
 * The exactness is not a heuristic. `recordMilestones` (lib/milestone-events.ts:147)
 * issues ONE `.insert()` for the whole batch - one statement, therefore one transaction,
 * therefore one `now()`. `created_at timestamptz NOT NULL DEFAULT now()` resolves to
 * transaction start time, so all 49 rows of a broadcast carry a byte-identical timestamp.
 * Two different broadcasts are two different transactions and differ at microsecond
 * resolution. So exact equality groups what belongs together and can merge nothing that
 * does not.
 *
 * A time window would be worse in both directions: a 5-second bucket merges two genuinely
 * separate broadcasts by the same person on the same project.
 *
 * `subject_id` is null for an RFP broadcast sent outside a project context, which the
 * wizard permits (migration 080, the `subject_id` column comment). The literal sentinel
 * "-" goes in that position and the timestamp carries the whole discriminating load -
 * sound for the same reason, because one route call is one transaction.
 *
 * NOTE that `actor_email` participates in the KEY but is never rendered. Two different
 * guests acting in the same transaction is not a thing that happens today; including it
 * costs nothing and keeps the key honest.
 */
export function milestoneGroupKey(row: MilestoneFeedRow): string {
  const actor = row.actor_id ?? row.actor_email ?? "guest"
  return [row.event_type, actor, row.subject_type, row.subject_id ?? "-", row.created_at].join("|")
}

export type MilestoneGroup = {
  /** The row every field of the line is read from. All rows in a group agree on the key. */
  head: MilestoneFeedRow
  /** How many ROWS the group stands for. 1 for an ungrouped event. */
  count: number
  /**
   * How many DISTINCT VENDORS those rows are addressed to. Never larger than `count`.
   *
   * This is the number "to N vendors" renders, and it is not `count`. An RFP broadcast
   * writes one row per RECIPIENT PER SCOPE ITEM - `rows` in
   * app/api/agency/broadcast-rfp/route.ts is built by iterating scope items and recipients -
   * and the whole broadcast is one insert, so one transaction, so one `created_at`, so one
   * group. Three scope items sent to twenty vendors is therefore sixty rows in a single
   * group, and counting rows rendered "broadcast the RFP for Key Art to 60 vendors" to an
   * agency that had invited twenty companies.
   *
   * Counting distinct vendors instead needs no migration, no emitter change and no batch
   * id: the identity is already on every row. See `vendorIdentity`.
   */
  vendorCount: number
  /**
   * True when this group was cut by the fetch ceiling, so both counts are FLOORS and the
   * line must render "200+" rather than a bare, wrong "200". Section 1.6.
   */
  countIsPartial: boolean
}

export type GroupingCeilingInfo = {
  /** How many rows came back. Equal to the limit, which is what makes it suspicious. */
  fetched: number
  limit: number
  /** True when the whole window is one timestamp, i.e. one batch larger than the limit. */
  singleBatchOverflow: boolean
  /** Rows discarded because their tie group straddled the boundary. */
  discarded: number
}

/**
 * Who a milestone row is ADDRESSED TO, as one comparable string. Used only to count
 * distinct vendors inside a group; never rendered, never returned to a caller.
 *
 * The precedence is most-identifying first, and every step of it is already on the row:
 *
 *   1. `vendor_org_id` - the vendor's organization. Set on every pool-path broadcast row,
 *      and on a manual-email row whose address matched a claimed profile.
 *   2. `partnership_id` - set when the relationship exists but the organization is not
 *      resolved on this row.
 *   3. `payload.recipient_email` - the GHOST case, and it is not an edge case: a broadcast
 *      to addresses with no Ligament account writes rows with both ids null
 *      (app/api/agency/broadcast-rfp/route.ts:373-380). Without this step every ghost in a
 *      broadcast would collapse to one identity and the line would say "to 1 vendor",
 *      which is worse than the over-count it replaces.
 *   4. The row id - each row that carries no vendor identity at all counts as its own
 *      recipient, which is exactly the pre-existing behaviour for rows this cannot key.
 *
 * READING A SECOND PAYLOAD KEY IS DELIBERATE AND BOUNDED. `payloadString` above is the only
 * function that puts a payload value anywhere a caller can see it, and that is still true:
 * the address read here is hashed into a Set, counted, and discarded inside this module. It
 * never reaches `PredicateInput`, `ActivityItem`, or the wire. The file header's rule is
 * "no payload passthrough", and a local cardinality count is not a passthrough.
 *
 * Known and accepted: one vendor reached BOTH through the pool path and, in the same
 * broadcast, as a manual address that did not resolve to their organization would count
 * twice. That requires a duplicate recipient in one request, and it over-counts by one
 * rather than by a factor of the scope-item count.
 */
function vendorIdentity(row: MilestoneFeedRow): string {
  if (row.vendor_org_id) return `org:${row.vendor_org_id}`
  if (row.partnership_id) return `pship:${row.partnership_id}`
  const email = row.payload?.recipient_email
  if (typeof email === "string" && email.trim()) return `email:${email.trim().toLowerCase()}`
  return `row:${row.id}`
}

/**
 * Group milestone rows, honouring the fetch ceiling.
 *
 * `rows` must arrive ORDER BY created_at DESC LIMIT `limit`, which is what the route asks
 * for. Design section 1.6 fixes the three cases exactly, because the failure is otherwise
 * silent - `payload.recipient_count` is gone (it leaked competitor counts to vendors), so
 * "to 49 vendors" is GROUP SIZE, computed from the rows actually fetched, and that makes
 * the number a function of the ceiling:
 *
 *   - rows.length < limit
 *       The query exhausted the table. Every group is complete, every count exact. This is
 *       the only case that occurs at current volume (~25 lines all time, largest batch 49).
 *
 *   - rows.length === limit, more than one distinct created_at
 *       A batch shares one timestamp, so it is a contiguous run in this ordering, and only
 *       the OLDEST timestamp in the window can straddle the LIMIT cut - ties have no
 *       deterministic order within them. Discard every row at that oldest timestamp. It is
 *       the only group that can be short and it is the group the display cap was most
 *       likely to drop anyway. Every surviving count is then exact.
 *
 *   - rows.length === limit, exactly one distinct created_at
 *       One batch is larger than the whole fetch. Discarding it would delete the largest
 *       broadcast in the product from the feed, which is worse than an approximate number.
 *       Keep it and mark it partial: the line renders "200+", never a bare "200".
 *
 * An exact count independent of the fetch would need a GROUP BY, which PostgREST cannot
 * express without an RPC, or one `count: "exact"` query per group. Neither is worth a
 * migration or N round trips for a number that is decoration on a feed line.
 */
export function groupMilestoneRows(
  rows: MilestoneFeedRow[],
  limit: number,
  onCeiling?: (info: GroupingCeilingInfo) => void
): MilestoneGroup[] {
  let usable = rows
  let partialAll = false

  if (rows.length >= limit && rows.length > 0) {
    const timestamps = new Set(rows.map((r) => r.created_at))
    if (timestamps.size > 1) {
      // The oldest timestamp is the only tie group the LIMIT can have cut into.
      let oldest = rows[0].created_at
      for (const r of rows) if (r.created_at < oldest) oldest = r.created_at
      usable = rows.filter((r) => r.created_at !== oldest)
      onCeiling?.({
        fetched: rows.length,
        limit,
        singleBatchOverflow: false,
        discarded: rows.length - usable.length,
      })
    } else {
      partialAll = true
      onCeiling?.({ fetched: rows.length, limit, singleBatchOverflow: true, discarded: 0 })
    }
  }

  // Two parallel maps rather than a Set on the group object, so `MilestoneGroup` stays a
  // plain data shape a caller can construct in a test without knowing how counting works.
  const groups = new Map<string, MilestoneGroup>()
  const vendorsByKey = new Map<string, Set<string>>()
  for (const row of usable) {
    const key = milestoneGroupKey(row)
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, { head: row, count: 1, vendorCount: 1, countIsPartial: partialAll })
      vendorsByKey.set(key, new Set())
    }
    vendorsByKey.get(key)!.add(vendorIdentity(row))
  }
  for (const [key, group] of groups) {
    group.vendorCount = vendorsByKey.get(key)?.size ?? group.count
  }
  return Array.from(groups.values())
}

// =====================================================================
// PREDICATES
// =====================================================================

/**
 * The one and only place a payload is read, and it reads ONE key.
 *
 * See the file header. The payload of a whitelisted event type is counterparty-readable in
 * full, so nothing in it may be handed to the client wholesale. `scope_item_name` is a
 * title the vendor was already sent in the RFP itself; it is named here explicitly rather
 * than reached for generically, so that adding a payload field to an emitter can never
 * silently widen what the feed returns.
 */
function payloadString(payload: Record<string, unknown> | null, key: "scope_item_name"): string | null {
  const value = payload?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

type PredicateInput = {
  /** payload.scope_item_name, already narrowed to a non-empty string or null. */
  scope: string | null
  /** The counterparty organization's display name, resolved by the caller. Never an email. */
  vendor: string | null
  /** The project's display name, resolved by the caller from an id, never from a payload. */
  project: string | null
  /** Group size in ROWS. 1 for an ungrouped event. */
  count: number
  /** Distinct vendors the group is addressed to. This is what "to N vendors" renders. */
  recipientCount: number
  /** True when the counts are floors - render "N+". Section 1.6. */
  countIsPartial: boolean
}

function scopeOf(input: PredicateInput): string {
  return input.scope || "a scope item"
}

function vendorOf(input: PredicateInput): string {
  return input.vendor || "a vendor"
}

/**
 * "to 49 vendors" is DERIVED and never stored - the stored version leaked how many
 * competitors each vendor was bidding against. The suffix is dropped entirely at one
 * recipient, because "to 1 vendor" reads as a defect rather than as a fact.
 *
 * DERIVED FROM DISTINCT VENDORS, NOT FROM GROUP SIZE. A broadcast writes one row per
 * recipient PER SCOPE ITEM, so group size is recipients times scope items: three scopes to
 * twenty vendors counted sixty. See `MilestoneGroup.vendorCount`. A single-scope broadcast
 * has one row per vendor, so the two numbers are equal there and that line is unchanged.
 */
function recipients(input: PredicateInput): string {
  if (input.recipientCount <= 1) return ""
  return ` to ${input.recipientCount}${input.countIsPartial ? "+" : ""} vendors`
}

/**
 * event_type -> predicate. All 23 whitelisted types plus `project.create`.
 *
 * Six have emitters today (vendor.invite, msa.confirm, rfp.broadcast, bid.feedback,
 * bid.award, bid.decline - docs/080-emitter-coverage-report.md). The other eighteen are
 * written now for two reasons: the whitelist is closed and only a migration can add to it,
 * so full coverage is actually achievable; and every vendor-side type here is what the
 * vendor feed will render, with the SAME predicate and a different actor.
 *
 * A type absent from this table renders NO LINE, and the caller is told so it can log.
 * Copy invented on the fly for an unrecognised event type is worse than a missing line.
 */
const MILESTONE_PREDICATES: Record<string, (i: PredicateInput) => string> = {
  // ── Agency side ──────────────────────────────────────────────────────────
  "project.create": (i) => `created project ${i.project || "a project"}`,
  "vendor.invite": (i) => `invited ${vendorOf(i)}`,
  "vendor.invite_resend": (i) => `resent the invitation to ${vendorOf(i)}`,
  "rfp.broadcast": (i) => `broadcast the RFP for ${scopeOf(i)}${recipients(i)}`,
  "rfp.magic_link_send": (i) => `sent an RFP link for ${scopeOf(i)}${recipients(i)}`,
  "rfp.deadline_set": (i) => `set the deadline for ${scopeOf(i)}`,
  "rfp.deadline_change": (i) => `changed the deadline for ${scopeOf(i)}`,
  "bid.shortlist": (i) => `shortlisted a bid on ${scopeOf(i)}`,
  "bid.meeting_request": (i) => `requested a meeting about ${scopeOf(i)}`,
  "bid.award": (i) => `awarded the bid on ${scopeOf(i)}`,
  "bid.decline": (i) => `declined a bid on ${scopeOf(i)}`,
  "bid.feedback": (i) => `sent feedback on ${scopeOf(i)}`,
  "onboarding.package_send": (i) => `sent the onboarding package to ${vendorOf(i)}`,
  "onboarding.deploy": (i) => `deployed onboarding for ${i.project || "a project"}`,
  "msa.confirm": (i) => `confirmed the MSA with ${vendorOf(i)}`,
  "status_update.resolve": (i) => `resolved a status update on ${i.project || "a project"}`,
  "payment.mark_paid": (i) => `marked a payment milestone paid for ${vendorOf(i)}`,
  // ── Vendor side. No emitter and no INSERT policy yet (080 withheld both); these exist
  //    so the vendor feed and the phase-3 retirements inherit copy rather than invent it.
  "bid.submit": (i) => `submitted a bid on ${scopeOf(i)}`,
  "bid.revise": (i) => `revised a bid on ${scopeOf(i)}`,
  "rfp.view": (i) => `viewed the RFP for ${scopeOf(i)}`,
  "invitation.accept": (i) => `accepted the invitation${i.project ? ` for ${i.project}` : ""}`,
  "invitation.decline": (i) => `declined the invitation${i.project ? ` for ${i.project}` : ""}`,
  "nda.acknowledge": (i) => `acknowledged the NDA for ${scopeOf(i)}`,
  "status_update.post": (i) => `posted a status update on ${i.project || "a project"}`,
}

/**
 * Everything a feed must supply that is specific to WHOSE feed it is: name lookups, link
 * targets, and the actor resolver. Nothing here reads a payload or an email.
 */
export type MilestoneFeedContext<A extends ActivityActor = ActivityActor> = {
  actor: ActorResolver<A>
  /** Display name for the counterparty organization on this row. Never an email address. */
  counterpartyName: (row: MilestoneFeedRow) => string | null
  /** Which project this row belongs to, resolved from ids the caller already holds. */
  projectId: (row: MilestoneFeedRow) => string | null
  /** Display name for a project id. */
  projectName: (projectId: string | null) => string | null
  /** Where the line links. */
  href: (row: MilestoneFeedRow, projectId: string | null) => string
  /** Called once per unrecognised event type so a missing predicate is not silent. */
  onUnknownEventType?: (eventType: string) => void
}

/**
 * One group -> one line, or null when the event type has no predicate.
 *
 * The `id` is the head row's id. That is stable across requests (it is a real primary key)
 * and unique across groups, since a row belongs to exactly one group.
 */
export function mapMilestoneGroup<A extends ActivityActor>(
  group: MilestoneGroup,
  ctx: MilestoneFeedContext<A>
): ActivityItem<A> | null {
  const row = group.head
  const build = MILESTONE_PREDICATES[row.event_type]
  if (!build) {
    ctx.onUnknownEventType?.(row.event_type)
    return null
  }
  const projectId = ctx.projectId(row)
  const input: PredicateInput = {
    scope: payloadString(row.payload, "scope_item_name"),
    vendor: ctx.counterpartyName(row),
    project: ctx.projectName(projectId),
    count: group.count,
    recipientCount: group.vendorCount,
    countIsPartial: group.countIsPartial,
  }
  return {
    id: `milestone:${row.id}`,
    text: build(input),
    href: ctx.href(row, projectId),
    timestamp: row.created_at,
    actor: ctx.actor(row),
    // The RECIPIENT count, not the row count, so `count` and the rendered "to N vendors"
    // can never disagree. They differ only for a multi-scope broadcast; for every other
    // event type each group is one row addressed to one vendor and the two are identical.
    ...(group.vendorCount > 1 ? { count: group.vendorCount } : {}),
    ...(group.countIsPartial ? { countIsPartial: true } : {}),
    projectId,
    source: "milestone" as const,
  }
}

// =====================================================================
// DEDUPE
// =====================================================================

/**
 * Event types that STAND IN FOR a derived union source, and the subject_type each must
 * carry to do so. Design section 3.2.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TABLE EXISTS AND SECTION 3.3'S RULE ALONE IS NOT ENOUGH
 *
 * Section 3.3 says every item gets `dedupeKey = subject_type:subject_id`. Applied to
 * milestones without this table it is WRONG TODAY, and silently: three emitters already
 * write `subject_type: "bid", subject_id: <response_id>` - bid.feedback, bid.award and
 * bid.decline (app/api/agency/rfp-responses/[id]/route.ts:701, :866, :963). Under a bare
 * subject-identity key:
 *
 *   - `bid.award` on response X collides with the DERIVED "Acme Post submitted a bid on X"
 *     line, milestone wins, and the vendor's submission disappears from the feed; and
 *   - award, decline and feedback on the same response collapse into each other.
 *
 * Those are four different real-world events about one row. Subject identity is the right
 * KEY but only between an event and the union source it REPLACES, which is a much smaller
 * relation than "shares a subject". Hence an explicit list, and hence `project.create`
 * being on it before its emitter exists (section 2, phase 2).
 *
 * THE HARD REQUIREMENT ON EVERY FUTURE EMITTER, restated where it is executable: an
 * emitter named here MUST set `subject_id` to the same row id the union source keys on. A
 * `bid.submit` that sets `subject_id` to the inbox id instead of the response id makes the
 * two undedupeable by anything except timestamp guessing, and the duplicate ships silently
 * - both lines are true, they just say the same thing twice. `milestoneDedupeKey` checks
 * the subject_type half of that and warns; the id half is not checkable from here.
 */
export const UNION_REPLACING_EVENT_TYPES: Record<string, string> = {
  "project.create": "project",
  "bid.submit": "bid",
  "rfp.view": "rfp_inbox",
  "onboarding.acknowledge": "onboarding_package",
}

/**
 * The dedupe key for a milestone row, or null when it cannot collide with anything.
 *
 * Null is the common case and the safe one: items with a null key are never deduped and
 * are always kept. A null-subject milestone cannot collide with a union item anyway,
 * because every union item is derived from a specific row.
 */
export function milestoneDedupeKey(
  row: MilestoneFeedRow,
  onSubjectMismatch?: (info: { eventType: string; expected: string; actual: string }) => void
): string | null {
  const expected = UNION_REPLACING_EVENT_TYPES[row.event_type]
  if (!expected) return null
  if (!row.subject_id) return null
  if (row.subject_type !== expected) {
    onSubjectMismatch?.({ eventType: row.event_type, expected, actual: row.subject_type })
    return null
  }
  return `${row.subject_type}:${row.subject_id}`
}

export type ActivityEntry<A extends ActivityActor = ActivityActor> = {
  /** Null means "cannot collide", which is most items. */
  dedupeKey: string | null
  item: ActivityItem<A>
}

/**
 * Merge every source into one array, newest first.
 *
 * Dedupe is BY SUBJECT IDENTITY, NEVER BY TIMESTAMP PROXIMITY. `bid.submit` would be
 * emitted after the response row is written, so its `created_at` is milliseconds later
 * than `submitted_at`, and the tolerance you would have to allow is exactly wide enough to
 * merge two genuine revisions.
 *
 * On collision MILESTONE WINS - it carries an actor and the derived item does not, which
 * is the entire point of the merge. Decided on `source`, not on argument order, so a
 * caller cannot change the outcome by reordering its concats.
 *
 * There are ZERO collisions today and that is provable (design section 3.1): the six
 * emitting types are all agency acts, the four union sources are three vendor acts plus
 * project creation, and the sets are disjoint. This is built now anyway, because it is
 * unverifiable later without contriving data.
 */
export function mergeActivityEntries<A extends ActivityActor>(entries: ActivityEntry<A>[]): ActivityItem<A>[] {
  const out: ActivityItem<A>[] = []
  const byKey = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.dedupeKey) {
      out.push(entry.item)
      continue
    }
    const at = byKey.get(entry.dedupeKey)
    if (at === undefined) {
      byKey.set(entry.dedupeKey, out.length)
      out.push(entry.item)
      continue
    }
    if (out[at].source === "derived" && entry.item.source === "milestone") out[at] = entry.item
    // Otherwise the incumbent stays: milestone beats derived, and first wins among equals.
  }
  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return out
}

// =====================================================================
// IDENTITY
// =====================================================================

/**
 * The domain half of an email address, or null.
 *
 * Design section 5. The domain is the identifying half and the local part is the person's
 * inbox - the harvestable half. Never the local part, never the full address, on EITHER
 * feed. One rule beats two: this is the formatter most likely to be shared with the vendor
 * feed, and a branch that emits a raw address for guests is a branch that ships to a
 * vendor-facing surface with a latent harvest in it and gets reviewed once, here, and
 * never again.
 */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf("@")
  if (at < 0) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  return domain && domain.includes(".") ? domain : null
}

/**
 * The display name for an actor with no account, in the precedence design section 5 sets:
 * the vendor organization name, then the domain, then "A guest".
 *
 * "(via link)" on the resolved-organization case is not decoration. It distinguishes an
 * unauthenticated actor from a portal user, which is real information a colleague wants.
 */
export function guestDisplayName(orgName: string | null, email: string | null | undefined): string {
  if (orgName && orgName.trim()) return `${orgName.trim()} (via link)`
  const domain = emailDomain(email)
  if (domain) return `A guest at ${domain}`
  return "A guest"
}
