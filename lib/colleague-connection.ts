/**
 * M4: WHY a colleague is connected to a vendor, and the one place that sentence is written.
 *
 * ---------------------------------------------------------------------------
 * ONE FILTER, THREE KINDS OF EVIDENCE. Greg's ruling on shape: "vendors Chris led the
 * project for", "vendors Chris contributed to" and "vendors Chris owns the relationship
 * with" are DIFFERENT EVIDENCE FOR THE SAME QUESTION, and they nest - the first is a
 * subset of "vendors Chris is connected to". Three filter rows for nested sets produce
 * questions nobody asked. So the pool page gets ONE colleague filter, and the distinction
 * moves into the RESULT, where a reader can see it against a named vendor.
 *
 * ---------------------------------------------------------------------------
 * OWNING AND WORKING ARE DIFFERENT CLAIMS AND THIS FILE KEEPS THEM APART.
 *
 * `partnership_owners` says who owns the relationship with a vendor. `project_leads` says
 * who ran or worked on a project that vendor was awarded. Somebody can own a relationship
 * having led nothing in a year, and can have led three jobs with a vendor whose
 * relationship somebody else owns. A single sentence covering both - "connected to" - would
 * let a user read an ownership tag as delivery experience, which is the one mistake this
 * filter exists to prevent. The two vocabularies below share no words:
 *
 *   work       "Point person on Pfizer Rebrand"   "Contributor on Pfizer Rebrand"
 *   ownership  "Owns the vendor relationship"
 *
 * ---------------------------------------------------------------------------
 * CLOSED LEAD ROWS COUNT, AND THEY SAY SO. Greg's M3 ruling R2 made reassignment a
 * HANDOVER: `project_leads` keeps the old row with `ended_at` stamped, forever, precisely
 * so "Chris led the Pfizer job until March" stays readable. A filter that dropped those
 * rows would answer "who works with this vendor today", which is not the question - Chris
 * DID work with that vendor, and the history table exists to remember it.
 *
 * >>> BUT IT MUST NOT BE PRESENTED AS CURRENT. A closed row renders with "until <date>"
 * >>> appended, and the caller renders it muted. Silently dropping closed rows and silently
 * >>> presenting them as open are both wrong; this is the third option.
 *
 * `partnership_owners` has no closed state to distinguish - the table is add-only with no
 * UPDATE and no DELETE policy (098), so every row in it is current by construction.
 *
 * ---------------------------------------------------------------------------
 * NO EM DASHES. House rule, and every string this file returns is user-facing.
 */

/**
 * One reason a colleague is connected to one vendor.
 *
 * `endedAt` is `project_leads.ended_at` verbatim: NULL means the row is open and the
 * involvement is current. It is not a boolean because the date itself is shown.
 */
export type ColleagueEvidence =
  | {
      kind: "lead" | "contributor"
      projectId: string
      projectTitle: string
      /** NULL means current. A timestamp means it was handed over then. */
      endedAt: string | null
    }
  | { kind: "owner"; addedAt: string }

/** True when this evidence describes something the colleague is doing now. */
export function evidenceIsCurrent(e: ColleagueEvidence): boolean {
  return e.kind === "owner" ? true : e.endedAt === null
}

/**
 * Matches the date format the vendor cards on /agency/pool already render inline
 * ("Active since Mar 12, 2026"). `lib/utils.ts` exports `formatDateTime`, which adds a
 * time of day this line has no use for, and no `formatDate` despite CLAUDE.md naming one.
 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** The one sentence shown against a vendor to say why the chosen colleague is connected. */
export function describeColleagueEvidence(e: ColleagueEvidence): string {
  if (e.kind === "owner") return "Owns the vendor relationship"
  const noun = e.kind === "lead" ? "Point person" : "Contributor"
  const title = e.projectTitle.trim() || "an untitled project"
  if (e.endedAt === null) return `${noun} on ${title}`
  const until = shortDate(e.endedAt)
  // A closed row with an unreadable timestamp still must not read as current.
  return until ? `${noun} on ${title} until ${until}` : `${noun} on ${title}, since handed over`
}

/**
 * Deterministic order for the lines under one vendor: the standing claims first, the
 * history after it, newest history first.
 *
 * Ownership leads because it is the strongest claim and the only one that is not about a
 * single project. Within work, current before closed, point person before contributor, then
 * project title so two rows of the same shape never swap places between renders.
 */
export function sortColleagueEvidence(list: readonly ColleagueEvidence[]): ColleagueEvidence[] {
  const rank = (e: ColleagueEvidence): number => {
    if (e.kind === "owner") return 0
    if (e.endedAt === null) return e.kind === "lead" ? 1 : 2
    return e.kind === "lead" ? 3 : 4
  }
  return [...list].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (a.kind === "owner" || b.kind === "owner") return 0
    if (a.endedAt && b.endedAt && a.endedAt !== b.endedAt) return a.endedAt < b.endedAt ? 1 : -1
    return a.projectTitle.localeCompare(b.projectTitle)
  })
}
