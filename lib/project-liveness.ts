/**
 * One definition of "is this project still live", shared by every surface that
 * counts or labels active work.
 *
 * Lifted verbatim from app/api/agency/utilization/route.ts, which held the only
 * copy that was actually applied to a customer-facing number. Two other copies
 * existed - app/api/projects/route.ts and, by omission, the vendor dashboard
 * tile, which selected end_date and filtered on neither. All three now call
 * this. The three originals were byte-identical in logic and differed only in
 * their doc comment and quote style, which is the state a rule is in one rename
 * before it silently diverges.
 *
 * Deliberately NOT built on projects.status: that column carries an eleven-entry
 * STATUS_LEGACY_MAP folding ten spellings onto five canonical values
 * (app/agency/projects/[id]/page.tsx), so a liveness rule on it would be a
 * second normalization table that has to stay in step with the first. The date
 * is one field with one meaning.
 */

/** Project still "active": no end_date, an unparseable end_date, or end_date today or later (UTC). */
export function projectActiveByEndDate(endDate: string | null | undefined): boolean {
  if (endDate == null || String(endDate).trim() === "") return true
  const d = new Date(endDate)
  if (!Number.isFinite(d.getTime())) return true
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return end >= today
}
