/**
 * Shared response-deadline urgency (F2) - one source for the amber/red thresholds used
 * across every surface that shows an RFP response deadline (vendor RFP list, bid form
 * header, Bid Management rows, Needs Your Response queue), so two surfaces can never
 * disagree about whether a deadline is "soon" or "past". Amber = within 72 hours and not
 * yet past. Red = past. Display-only - a past deadline never blocks submission.
 */
export type DeadlineUrgency = "none" | "amber" | "red"

const URGENCY_WINDOW_MS = 72 * 60 * 60 * 1000

export function getDeadlineUrgency(deadline: string | null | undefined): DeadlineUrgency {
  if (!deadline) return "none"
  const ts = new Date(deadline).getTime()
  if (Number.isNaN(ts)) return "none"
  const diff = ts - Date.now()
  if (diff <= 0) return "red"
  if (diff <= URGENCY_WINDOW_MS) return "amber"
  return "none"
}
