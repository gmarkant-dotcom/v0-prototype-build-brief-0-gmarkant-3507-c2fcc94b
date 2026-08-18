import { resolveCallerOrgIds } from "@/lib/entitlements"
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/acting-role'
import { reconcileProjectClientFields } from '@/lib/clients-server'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
} as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role')
      .eq('id', user.id)
      .single()

    if (!canActAs(profile, 'agency')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .in('org_id', callerOrgIds)
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({ project }, { headers: noStoreHeaders })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active_role')
      .eq('id', user.id)
      .single()

    if (!canActAs(profile, 'agency')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    // client_name is deliberately OUT of the allow-list now. Both client fields go through the
    // one reconciler so this route cannot leave them disagreeing - see lib/clients-server.ts.
    const allowed = ['name', 'status', 'description', 'budget_range', 'start_date', 'end_date']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key] ?? null
    }

    if ('client_id' in body || 'client_name' in body) {
      const reconciled = await reconcileProjectClientFields(supabase, callerOrgIds, {
        hasClientId: 'client_id' in body,
        clientId: (body as Record<string, unknown>).client_id as string | null,
        hasClientName: 'client_name' in body,
        clientName: (body as Record<string, unknown>).client_name as string | null,
      })
      if (!reconciled.ok) {
        return NextResponse.json({ error: reconciled.error }, { status: reconciled.status })
      }
      Object.assign(updates, reconciled.fields)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: project, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .in('org_id', callerOrgIds)
      .select('*')
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ project }, { headers: noStoreHeaders })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}