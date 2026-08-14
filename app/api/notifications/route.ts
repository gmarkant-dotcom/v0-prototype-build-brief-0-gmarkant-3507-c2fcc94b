// TODO: GET and PATCH here have zero callers anywhere in the codebase (verified via
// repo-wide search for "/api/notifications" - no fetch/useFetch call sites in app/,
// components/, lib/, or hooks/). The write side (lib/notifications.ts's
// createNotification()) is still actively called from app/api/partnerships/route.ts
// and app/api/projects/[id]/onboarding-packages/route.ts, so the notifications table
// is being populated with no UI ever reading it back. Removal candidate once a product
// decision is made on whether to build the read-side UI or drop the feature - do not
// delete without re-checking the write side first.
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
