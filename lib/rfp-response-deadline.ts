/**
 * THE DEFAULT RESPONSE DEADLINE. R1.
 *
 * ---------------------------------------------------------------------------
 * WHY A DEFAULT AND NOT A REQUIREMENT
 *
 * Measured live on 2026-09-14: 78 of 97 partner_rfp_inbox rows carry
 * response_deadline IS NULL - 80% of the platform. The field has always been
 * optional and the wizard's own helper text said so, so nobody set one. A
 * deadline-less RFP has no urgency signal, no order, no expiry, and there is no
 * mechanism by which it can leave a vendor's queue.
 *
 * Making it REQUIRED would block an agency who genuinely has no date from
 * broadcasting at all, which is a bigger behaviour change than the problem
 * warrants. Defaulting makes the common case correct and leaves the field
 * editable, including to a date the agency picks or clears in the wizard.
 *
 * ---------------------------------------------------------------------------
 * WHY FOURTEEN DAYS, AND NOT SEVEN OR THIRTY
 *
 * The horizon is not arbitrary and it is not a round number picked for looking
 * like one. It is chosen to make an urgency signal that already exists start
 * working:
 *
 *   app/partner/page.tsx `queueIsUrgent` treats an RFP as urgent at
 *   `daysLeft != null && daysLeft <= 7`.
 *
 * That predicate has never fired on a deadline, because daysLeft is null for
 * every row without one. At FOURTEEN days a defaulted RFP spends its first week
 * ordinary and its second week urgent, which is exactly the two-state signal
 * that code was written to give and has never been able to give.
 *
 *   SEVEN days would make every RFP urgent from the moment it is sent, which
 *   makes the urgent state meaningless - a queue where everything is urgent is
 *   a queue with no priority at all.
 *
 *   THIRTY days is longer than the agency work it describes. A creative or
 *   production scope quoted a month out is quoted against stale availability,
 *   and a vendor who reads "respond by" a month away does not read it as a
 *   deadline.
 *
 * Fourteen days is also long enough to scope and price real production work,
 * which seven is not for anything with subcontractors in it.
 *
 * ---------------------------------------------------------------------------
 * ONE CONSTANT, THREE CALLERS. Do not inline this number.
 *
 *   app/agency/page.tsx                       the wizard's initial value
 *   app/api/agency/broadcast-rfp/route.ts     the standard broadcast fallback
 *   app/api/agency/rfp/magic-link/route.ts    the Lightning / magic-link fallback
 *
 * The two routes need their own fallback and not just the wizard's initial
 * value, because a route is a trust boundary: a caller that posts no
 * response_deadline at all must still get one, and both routes previously wrote
 * null in that case.
 */
export const RFP_RESPONSE_DEADLINE_DEFAULT_DAYS = 14

/** Human-readable horizon, for helper text. Kept beside the number so the copy
 *  cannot drift away from the value it describes. */
export const RFP_RESPONSE_DEADLINE_DEFAULT_LABEL = "two weeks"

/**
 * The wizard's initial value: a `YYYY-MM-DD` string for `<input type="date">`,
 * computed in the AGENCY USER'S LOCAL TIME because that is the calendar the date
 * picker shows them.
 *
 * Built by hand from the local getFullYear/getMonth/getDate rather than through
 * toISOString().slice(0,10), which converts to UTC first and therefore lands on
 * the previous day for every agency west of Greenwich for most of their working
 * day.
 */
export function defaultResponseDeadlineDateInput(now: Date = new Date()): string {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() + RFP_RESPONSE_DEADLINE_DEFAULT_DAYS)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/**
 * The two routes' fallback: a full ISO timestamp, end of day.
 *
 * ON PURPOSE, THE SAME END-OF-DAY CONVENTION THE WIZARD USES. The wizard sends
 * `new Date(`${date}T23:59:59`).toISOString()` (app/agency/page.tsx), so a
 * deadline of the 28th means the end of the 28th and not its first second. A
 * fallback that used midnight would silently give a caller most of a day less
 * than the wizard gives, for the same nominal horizon.
 *
 * THE ONE HONEST DIFFERENCE: this runs on the server, so its end-of-day is the
 * server's, and the wizard's is the agency user's. The gap is at most one day's
 * timezone offset on a fourteen-day horizon. It is not worth a timezone column
 * to close, and it only applies to a caller that sent no date at all - the
 * wizard always sends one.
 */
export function defaultResponseDeadlineIso(now: Date = new Date()): string {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() + RFP_RESPONSE_DEADLINE_DEFAULT_DAYS)
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}
