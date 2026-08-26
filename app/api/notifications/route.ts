// THIS ROUTE NOW HAS A CONSUMER, AND IT IS IN A LAYOUT. 2026-08-25.
//
// It carried a TODO recording that GET and PATCH had zero callers anywhere while sixteen
// write sites kept filling the table. components/notification-bell.tsx is that consumer:
// GET behind SWR for the list and the unread badge, PATCH { markAllRead: true } behind the
// "Mark all read" control. It is mounted in components/agency-layout.tsx and
// components/partner-layout.tsx, so EVERY authenticated page in BOTH portals issues this
// GET. That is the blast radius to hold in mind before changing anything below:
//
//   - THE user_id FILTER IS NOT DECORATION AND IT IS NOT REDUNDANT WITH RLS. Every query
//     here scopes explicitly to the caller. Removing one on the grounds that "the policy
//     already does that" is the exact shape that made the vendor RFP inbox hand an agency's
//     own outbound rows to the vendor portal.
//   - ZERO ROWS MUST STAY AN EMPTY ARRAY. The bell distinguishes "nothing has been sent to
//     you" from "this could not be loaded" and says different things for each. Returning an
//     error for an empty inbox would make every new account's bell claim a failure.
//
// WHAT CHANGED 2026-08-26, AND WHAT DID NOT. GET now accepts an optional `cursor`, so the
// bell can reach past the newest page. Everything the two bullets above protect is
// unchanged: every query still carries its own `.eq('user_id', user.id)`, zero rows is
// still an empty array, and the unread count still counts EVERY unread row rather than the
// loaded ones. The cursor is a FILTER ADDED TO the existing list query, never a replacement
// for its scoping. See the block above parseCursor() for the validation rules.
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/api-auth"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

const DEFAULT_LIMIT = 20
/**
 * A CALLER-SUPPLIED PAGE SIZE WITH NO CEILING IS A WAY TO PULL THE WHOLE TABLE IN ONE
 * REQUEST. Before this cap, `?limit=100000` was honoured verbatim - parseInt of the raw
 * parameter went straight into `.limit()`. RLS bounds that read to the caller's own rows, so
 * it was never a cross-user disclosure, but it is still an unbounded response funded by one
 * unauthenticated-until-checked query string, and it is the kind of thing that stops being
 * cheap the moment an account accumulates thousands of rows.
 *
 * 50 rather than 20 so the cap is not the page size: it leaves room for a caller that wants
 * a deeper page without letting anyone ask for the lot.
 */
const MAX_LIMIT = 50

/** The page size, or null when the caller sent something that is not one. */
function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  // parseInt is deliberately NOT used: it reads "20abc" as 20 and "1e9" as 1, so a
  // malformed parameter would be silently coerced into a plausible one. An integer is
  // either sent or it is not.
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LIMIT) return null
  return n
}

/**
 * THE CURSOR, AND WHY IT IS PASSED THROUGH RATHER THAN NORMALIZED.
 *
 * The cursor is a `created_at` value the caller received from this same endpoint. It is
 * validated against a strict ISO-8601 shape and then handed to `.lte()` UNCHANGED.
 *
 *   - NOTHING IS INTERPOLATED INTO A QUERY STRING. The value reaches PostgREST as an
 *     argument to `.lte('created_at', value)`, which supabase-js URL-encodes as a parameter.
 *     There is no `.or()` and no hand-built filter expression anywhere in this route, which
 *     is the only place a crafted value could smuggle in an extra operator.
 *   - MALFORMED IS REJECTED, NOT COERCED. A 400 with the parameter named. Coercing - the
 *     `new Date(x)` reflex - turns a typo into a silent jump to an arbitrary point in the
 *     feed, which reads as missing notifications rather than as a bad request.
 *   - AND IT IS NOT ROUND-TRIPPED THROUGH Date, WHICH WOULD LOSE ROWS. Postgres stores
 *     timestamptz to MICROSECONDS and PostgREST serialises all six digits; a JavaScript Date
 *     holds MILLISECONDS. Normalising `...:07.123456+00:00` through Date yields
 *     `...:07.123Z`, and `.lte` on that value silently excludes every row between the two -
 *     including the boundary row itself. The regex validates the shape; the original string
 *     is what gets used.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/

function parseCursor(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === "") return { ok: true, value: null }
  if (raw.length > 40 || !ISO_TIMESTAMP.test(raw)) return { ok: false }
  // Shape alone would accept a month of 99. Date.parse rejects that, and is used ONLY as a
  // sanity test - its output is discarded, for the microsecond reason above.
  if (!Number.isFinite(Date.parse(raw))) return { ok: false }
  return { ok: true, value: raw }
}

// GET /api/notifications - Get user's notifications
export async function GET(request: Request) {
  try {
    const route = "/api/notifications"
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth
    console.log("[api] start", { route, method: "GET", userId: user.id, role: null })

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get('unread') === 'true'

    const limit = parseLimit(searchParams.get('limit'))
    if (limit === null) {
      return NextResponse.json(
        { error: `limit must be a whole number between 1 and ${MAX_LIMIT}` },
        { status: 400, headers: noStoreHeaders }
      )
    }

    const cursor = parseCursor(searchParams.get('cursor'))
    if (!cursor.ok) {
      return NextResponse.json(
        { error: "cursor must be an ISO 8601 timestamp returned by this endpoint" },
        { status: 400, headers: noStoreHeaders }
      )
    }

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      // A DETERMINISTIC TIEBREAK, ADDED WITH THE CURSOR. `created_at` is not unique - one
      // request can write several rows to the same person inside one transaction, and they
      // share a timestamp exactly. Ordering by created_at alone leaves that group in an
      // unspecified order, so two requests could return it two different ways and a row
      // could sit on the far side of the page boundary in one and not the other. This does
      // not change which rows page one returns, only that their order is now reproducible.
      .order('id', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('read', false)
    }

    // `lte`, NOT `lt`, AND THE DIFFERENCE IS THE WHOLE TIE-HANDLING STORY. With `lt`, every
    // row sharing the boundary timestamp that did not fit on the previous page would be
    // stepped over and become unreachable - the exact defect this pagination exists to fix,
    // reintroduced one row at a time and invisibly. With `lte` the boundary row is served
    // again and the client drops it by id, so the cost of never skipping is one duplicate
    // per page. See the merge in components/notification-bell.tsx.
    if (cursor.value) {
      query = query.lte('created_at', cursor.value)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error("[api] failure", { route, method: "GET", userId: user.id, role: null, code: 500, message: error.message })
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStoreHeaders })
    }

    const rows = notifications || []

    /**
     * THE UNREAD COUNT DOES NOT MOVE, AND IT DOES NOT KNOW ABOUT THE CURSOR.
     *
     * It counts EVERY unread row addressed to this user - no cursor, no limit, `head: true`
     * so no rows travel. That is what the badge has always meant and it must keep meaning
     * it. Making it agree with the loaded page instead would turn "you have 34 unread" into
     * "you have 20 unread", which is a smaller number and a false one.
     *
     * It is recomputed on cursor pages too, rather than skipped. The saving would be one
     * head request per "load more" click; the cost would be a response whose shape depends
     * on which page it is, which is how a consumer ends up reading `unreadCount` off a body
     * that does not carry it and rendering a confident zero.
     */
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false)

    // A full page means there is at least one more row to ask for. It can be true when the
    // next page turns out to hold only the boundary duplicate; the client stops when a page
    // adds nothing new rather than trusting this flag on its own.
    const hasMore = rows.length === limit
    const nextCursor = hasMore ? ((rows[rows.length - 1] as { created_at?: string | null })?.created_at ?? null) : null

    console.log("[api] success", { route, method: "GET", userId: user.id, role: null, rowCount: rows.length, unreadCount: count || 0, paged: Boolean(cursor.value), hasMore })
    return NextResponse.json({
      notifications: rows,
      unreadCount: count || 0,
      hasMore,
      nextCursor,
    }, { headers: noStoreHeaders })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/notifications",
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: noStoreHeaders })
  }
}

// PATCH /api/notifications - Mark notifications as read
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = await request.json()
    const { notificationIds, markAllRead } = body

    if (markAllRead) {
      // Mark all as read
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as read
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .in('id', notificationIds)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating notifications:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
