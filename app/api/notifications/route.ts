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
// Deliberately unchanged here: nothing about the queries, the shape, or the headers. The
// consumer was built to fit this route, not the other way round.
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/api-auth"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

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
    const limit = parseInt(searchParams.get('limit') || '20')

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error("[api] failure", { route, method: "GET", userId: user.id, role: null, code: 500, message: error.message })
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStoreHeaders })
    }

    // Get unread count
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false)

    console.log("[api] success", { route, method: "GET", userId: user.id, role: null, rowCount: notifications?.length ?? 0, unreadCount: count || 0 })
    return NextResponse.json({ 
      notifications: notifications || [],
      unreadCount: count || 0
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
