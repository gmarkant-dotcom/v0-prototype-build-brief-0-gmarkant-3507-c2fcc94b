import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { resolveActingOrgId, type ActingOrgLookupClient } from "@/lib/acting-org"
import type { ColleagueEvidence } from "@/lib/colleague-connection"

export const dynamic = "force-dynamic"

/**
 * M4: which vendors is each colleague connected to, and why.
 *
 * Sibling of app/api/agency/pool/client-history/route.ts, deliberately: same directory,
 * same `{ options, by... }` wire shape, same "a filter that cannot load is a filter that
 * does not render" failure rule. One colleague filter, three sources of evidence.
 *
 * ---------------------------------------------------------------------------
 * >>> WHERE THE ORGANIZATION PREDICATE SITS, PER ARM. READ THIS FIRST.
 *
 * NEITHER `project_leads` NOR `partnership_owners` HAS AN ORGANIZATION COLUMN. 097 and 098
 * scope both tables through a parent - projects.org_id and partnerships.lead_org_id - and
 * express that scope in ROW LEVEL SECURITY. This route does NOT rely on that policy. It
 * filters on the acting organization in the query itself, every arm, because a read that
 * leans on the policy instead of naming the predicate is THE EXACT DEFECT that made
 * /partner/rfps list 96 of the agency's own outbound RFPs to the vendor.
 *
 *   ARM 1  lead         projects.org_id = actingOrgId          (query A)
 *          contributor  -> projectIds -> .in("project_id", ...) on project_leads (query C)
 *   ARM 2  the vendor   -> projectIds -> .in("project_id", ...) on project_assignments (D)
 *   ARM 3  owner        partnerships.lead_org_id = actingOrgId  (query E)
 *                       -> partnershipIds -> .in("partnership_id", ...) on
 *                          partnership_owners (query F)
 *   ROSTER              org_members.org_id = actingOrgId        (query B)
 *
 * Every id that reaches an M3 table is therefore an id this organization owns, established
 * by an equality on a column that names the organization, in the same request. RLS is a
 * second wall behind that, not the first one.
 *
 * >>> AND THE ROSTER IS AN INTERSECTION, NOT A LABEL LOOKUP. A `user_id` found in
 * project_leads or partnership_owners that is NOT in query B's result never becomes a
 * filter option and never contributes evidence. That is what closes (f): a colleague picker
 * that could surface somebody from another organization is worse than no filter at all.
 *
 * ---------------------------------------------------------------------------
 * THE ORGANIZATION IS RESOLVED, NEVER DERIVED FROM A USER ID. `resolveActingOrgId` reads
 * org_members keyed by the authenticated user id and has no parameter for a candidate
 * organization. Sixteen accounts in this database have `organizations.id` EQUAL TO
 * `profiles.id` from the 079 backfill, so substituting one for the other returns the right
 * rows on Greg's own account and the wrong rows on everybody else's.
 *
 * NOTE THE DIVERGENCE FROM THE SIBLING ROUTE, WHICH IS DELIBERATE. client-history uses
 * `resolveCallerOrgIds`, which is every organization the caller belongs to. This uses
 * `resolveActingOrgId`, which is the ONE they are currently acting for and which FAILS
 * CLOSED when that is ambiguous. The two agree for every live account today - all 18 have
 * exactly one membership - and they stop agreeing on the day colleague invitations create a
 * second one. A filter that names PEOPLE has to be certain whose colleagues it is naming.
 *
 * ---------------------------------------------------------------------------
 * WHAT "WORKED WITH" MEANS: `project_assignments.status = 'awarded'`, matching
 * client-history exactly, so the two filters on the same page cannot disagree about which
 * assignments count. 'completed' is accepted by the assignments PATCH handler but is
 * written by nothing in the product, so including it here would widen one filter and not
 * the other on the strength of rows that do not exist. Recorded as an open item instead.
 */

type Colleague = { userId: string; name: string; email: string | null; isYou: boolean; vendorCount: number }

/** PostgREST codes that mean 097 or 098 is not applied. Logged loudly, never worked around. */
const UNDEFINED_TABLE = "42P01"
const UNDEFINED_COLUMN = "42703"

const EMPTY = { colleagues: [] as Colleague[], byColleague: {} as Record<string, Record<string, ColleagueEvidence[]>> }

function personLabel(row: Record<string, unknown>): { name: string; email: string | null } {
  const dn = typeof row.display_name === "string" ? row.display_name.trim() : ""
  const fn = typeof row.full_name === "string" ? row.full_name.trim() : ""
  const em = typeof row.email === "string" ? row.email.trim() : ""
  return { name: dn || fn || em || "Unnamed colleague", email: em || null }
}

/**
 * DISPLAY NAMES FOR A SET OF USER IDS.
 *
 * ITS OWN FUNCTION, AND DELIBERATELY ABOVE EVERY LINE IN THIS FILE THAT NAMES AN
 * ORGANIZATION - the same separation, for the same reason, as loadDisplayNames() in
 * components/project-lead-picker.tsx. The ids that reach here are PEOPLE:
 * `org_members.user_id`, a foreign key to profiles(id). Nothing in this scope holds an
 * organization id, and that is the point rather than a detail. 079's whole defect class is a
 * COMPANY id arriving at a `profiles` read and returning the right rows anyway, because the
 * backfill gave sixteen organizations their founding user's id. A function that never holds
 * an organization id cannot commit it.
 *
 * It is also what keeps scripts/check-org-id-reads.mjs quiet on this read, which flagged it
 * NEARBY while it sat inline beside three organization-scoped queries. That is a consequence
 * of the structure, not the reason for it: the check is a proximity heuristic, and moving
 * code to satisfy it would be worthless if the code did not genuinely become person-only.
 * It did.
 */
async function loadDisplayNames(
  // The same narrowed client shape lib/acting-org.ts declares, reused rather than restated:
  // naming the real PostgREST builder type reaches TS2589 in this repository.
  client: ActingOrgLookupClient,
  userIds: string[]
): Promise<Map<string, { name: string; email: string | null }>> {
  const out = new Map<string, { name: string; email: string | null }>()
  if (userIds.length === 0) return out
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name, display_name, email")
    .in("id", userIds)
  if (error) {
    // Names are cosmetic here. A colleague with no readable profile still filters correctly,
    // so this is logged rather than surfaced.
    console.error("[agency/pool/colleague-connections] profile read failed", {
      code: error.code,
      message: error.message,
    })
    return out
  }
  for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
    if (typeof row.id === "string") out.set(row.id, personLabel(row))
  }
  return out
}

export async function GET() {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const acting = await resolveActingOrgId(user.id, supabase)
    if (!acting.orgId) {
      // Not a blocking error - the filter simply does not render. Logged because
      // "ambiguous" and "preference-refused" are states somebody has to act on.
      console.error("[agency/pool/colleague-connections] no acting organization", {
        reason: acting.reason,
        memberOrgCount: acting.memberOrgIds.length,
      })
      return NextResponse.json(EMPTY)
    }
    const orgId = acting.orgId

    // -----------------------------------------------------------------
    // QUERY A + B: the organization's projects, and the organization's people.
    // Both carry the org predicate directly. Everything downstream is keyed off
    // their results and nothing else.
    // -----------------------------------------------------------------
    const [projectResult, memberResult, partnershipResult] = await Promise.all([
      supabase.from("projects").select("id, title").eq("org_id", orgId),
      supabase.from("org_members").select("user_id").eq("org_id", orgId),
      // QUERY E. lead_org_id, never vendor_org_id: a partnership row is readable from both
      // sides, and scoping on "an org on this partnership" would let the vendor's own
      // ownership tags reach the agency's filter. Same boundary 098's policy draws.
      supabase.from("partnerships").select("id").eq("lead_org_id", orgId),
    ])

    if (memberResult.error) {
      console.error("[agency/pool/colleague-connections] roster read failed", {
        orgId,
        code: memberResult.error.code,
        message: memberResult.error.message,
      })
      return NextResponse.json(EMPTY)
    }

    const memberIds = [
      ...new Set(
        ((memberResult.data ?? []) as Array<{ user_id?: string | null }>)
          .map((r) => r.user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ]
    if (memberIds.length === 0) return NextResponse.json(EMPTY)
    // THE INTERSECTION SET. Nothing becomes evidence unless its user_id is in here.
    const memberSet = new Set(memberIds)

    if (projectResult.error) {
      console.error("[agency/pool/colleague-connections] projects read failed", {
        orgId,
        code: projectResult.error.code,
        message: projectResult.error.message,
      })
      return NextResponse.json(EMPTY)
    }
    const projectTitleById = new Map<string, string>()
    for (const row of (projectResult.data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.id === "string") projectTitleById.set(row.id, String(row.title ?? "").trim())
    }
    const projectIds = [...projectTitleById.keys()]

    if (partnershipResult.error) {
      console.error("[agency/pool/colleague-connections] partnerships read failed", {
        orgId,
        code: partnershipResult.error.code,
        message: partnershipResult.error.message,
      })
      return NextResponse.json(EMPTY)
    }
    const partnershipIds = ((partnershipResult.data ?? []) as Array<{ id?: string | null }>)
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    const partnershipSet = new Set(partnershipIds)

    // -----------------------------------------------------------------
    // QUERIES C, D, F: the three evidence sources, each bounded by an id list
    // that came out of a query carrying the org predicate.
    // -----------------------------------------------------------------
    const [leadResult, assignmentResult, ownerResult, labelById] = await Promise.all([
      projectIds.length > 0
        ? supabase
            .from("project_leads")
            // ended_at is SELECTED, not filtered on. Closed rows are evidence too - see
            // lib/colleague-connection.ts. The value is what makes the line say "until".
            .select("project_id, user_id, role, ended_at")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length > 0
        ? supabase
            .from("project_assignments")
            .select("project_id, partnership_id")
            .eq("status", "awarded")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      partnershipIds.length > 0
        ? supabase
            .from("partnership_owners")
            .select("partnership_id, user_id, added_at")
            .in("partnership_id", partnershipIds)
        : Promise.resolve({ data: [], error: null }),
      loadDisplayNames(supabase, memberIds),
    ])

    // 097/098 not applied would arrive here as 42P01 / 42703. Both are applied live, so
    // either would mean a schema regression underneath a running deployment. The filter
    // does not render and the reason is named in the log rather than swallowed.
    for (const [label, err] of [
      ["project_leads", leadResult.error],
      ["partnership_owners", ownerResult.error],
      ["project_assignments", assignmentResult.error],
    ] as const) {
      if (!err) continue
      const missing = err.code === UNDEFINED_TABLE || err.code === UNDEFINED_COLUMN
      console.error(
        `[agency/pool/colleague-connections] ${label} read failed${missing ? " - migration 097/098 not applied" : ""}`,
        { orgId, code: err.code, message: err.message }
      )
      return NextResponse.json(EMPTY)
    }

    // -----------------------------------------------------------------
    // THE PROJECT -> VENDOR JOIN, DEDUPLICATED.
    //
    // A project reaches a vendor only through an AWARDED project_assignments row, and the
    // vendor's identity on /agency/pool is its partnership id - the key every other filter
    // on that page uses, including client-history's byPartnership. Nothing here needs
    // organizations or profiles to identify a vendor.
    //
    // >>> THIS PATH DUPLICATES AND THE SET IS WHY. project_assignments has no unique
    // constraint on (project_id, partnership_id): the POST handler checks for an existing
    // row before inserting, and the award branch of rfp-responses updates-then-inserts, but
    // one scope item awarded per assignment row means the same vendor can legitimately hold
    // several awarded rows on one project. Without the Set, a vendor awarded three scope
    // items would produce the same evidence line three times.
    // -----------------------------------------------------------------
    const partnershipsByProject = new Map<string, Set<string>>()
    for (const row of ((assignmentResult.data ?? []) as Array<Record<string, unknown>>)) {
      const pid = typeof row.project_id === "string" ? row.project_id : null
      const partnershipId = typeof row.partnership_id === "string" ? row.partnership_id : null
      if (!pid || !partnershipId) continue
      if (!projectTitleById.has(pid)) continue
      let set = partnershipsByProject.get(pid)
      if (!set) partnershipsByProject.set(pid, (set = new Set()))
      set.add(partnershipId)
    }

    // -----------------------------------------------------------------
    // COLLAPSING project_leads.
    //
    // >>> THE SECOND DUPLICATING PATH, AND THE ONE THAT MATTERS MORE. A handover writes a
    // NEW row and closes the old one, so a colleague who led a project, handed it over and
    // later took it back holds THREE rows on one project - two closed, one open. Rendered
    // naively that is three evidence lines saying almost the same thing.
    //
    // They collapse to one line per (project, role, person), and the rule for which line is
    // NOT "the newest row": if ANY row for that triple is open, the involvement is CURRENT
    // and the line carries no "until". Only when every row is closed does the line say
    // "until", and then with the LATEST ended_at - the last time they actually stepped off,
    // not the first.
    // -----------------------------------------------------------------
    type LeadFact = { open: boolean; latestEnded: string | null }
    const leadFacts = new Map<string, LeadFact>() // key: userId|projectId|role
    for (const row of ((leadResult.data ?? []) as Array<Record<string, unknown>>)) {
      const userId = typeof row.user_id === "string" ? row.user_id : null
      const projectId = typeof row.project_id === "string" ? row.project_id : null
      const role = row.role === "contributor" ? "contributor" : row.role === "lead" ? "lead" : null
      if (!userId || !projectId || !role) continue
      // user_id is NULLABLE on project_leads so its foreign key can SET NULL when an account
      // is deleted. Such a row is real history with no person attached and cannot be
      // attributed to anybody, so it is skipped above rather than bucketed under a blank.
      if (!memberSet.has(userId)) continue
      if (!projectTitleById.has(projectId)) continue
      const endedAt = typeof row.ended_at === "string" && row.ended_at ? row.ended_at : null
      const key = `${userId}|${projectId}|${role}`
      const prev = leadFacts.get(key)
      if (!prev) {
        leadFacts.set(key, { open: endedAt === null, latestEnded: endedAt })
        continue
      }
      if (endedAt === null) prev.open = true
      else if (!prev.latestEnded || endedAt > prev.latestEnded) prev.latestEnded = endedAt
    }

    // -----------------------------------------------------------------
    // BUILDING THE EVIDENCE, keyed colleague -> partnership -> lines.
    // -----------------------------------------------------------------
    const byColleague: Record<string, Record<string, ColleagueEvidence[]>> = {}
    const push = (userId: string, partnershipId: string, evidence: ColleagueEvidence) => {
      const perVendor = byColleague[userId] || (byColleague[userId] = {})
      const list = perVendor[partnershipId] || (perVendor[partnershipId] = [])
      list.push(evidence)
    }

    for (const [key, fact] of leadFacts) {
      const [userId, projectId, role] = key.split("|") as [string, string, "lead" | "contributor"]
      const vendors = partnershipsByProject.get(projectId)
      // A project this colleague ran that never awarded anybody connects them to no vendor.
      // It contributes nothing rather than an empty row.
      if (!vendors || vendors.size === 0) continue
      for (const partnershipId of vendors) {
        push(userId, partnershipId, {
          kind: role,
          projectId,
          projectTitle: projectTitleById.get(projectId) ?? "",
          endedAt: fact.open ? null : fact.latestEnded,
        })
      }
    }

    // ARM 3. UNIQUE (partnership_id, user_id) on the table, so this arm cannot duplicate
    // against itself. It can and should duplicate against arms 1 and 2 - owning a
    // relationship and having led a job for that vendor are two true things about the same
    // pair, and both lines are shown.
    for (const row of ((ownerResult.data ?? []) as Array<Record<string, unknown>>)) {
      const userId = typeof row.user_id === "string" ? row.user_id : null
      const partnershipId = typeof row.partnership_id === "string" ? row.partnership_id : null
      if (!userId || !partnershipId) continue
      if (!memberSet.has(userId)) continue
      if (!partnershipSet.has(partnershipId)) continue
      push(userId, partnershipId, {
        kind: "owner",
        addedAt: typeof row.added_at === "string" ? row.added_at : "",
      })
    }

    // EVERY member is an option, including those with no connected vendor at all. Dropping
    // them would make "Chris has not worked with anyone yet" indistinguishable from "Chris
    // is not on this team", and the first of those is the normal state of a new colleague.
    // The count is what the filter will actually show, so the empty case reads "(0)" and
    // the honest empty state below the list explains it.
    const colleagues: Colleague[] = memberIds
      .map((id) => {
        const label = labelById.get(id) ?? { name: "Unnamed colleague", email: null }
        return {
          userId: id,
          name: label.name,
          email: label.email,
          isYou: id === user.id,
          vendorCount: Object.keys(byColleague[id] ?? {}).length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ colleagues, byColleague })
  } catch (e) {
    console.error("[agency/pool/colleague-connections] GET", e)
    return NextResponse.json(EMPTY)
  }
}
