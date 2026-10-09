import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createTokenClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveCallerOrgIds, callerOwnsOrg } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

/**
 * Every read and the insert run as the CALLER, never the service role, so RLS decides.
 *
 * The brief page sends the access token as a Bearer header (the API matcher gets no middleware
 * refresh). That token is honoured by building an anon-key client that carries it, which is
 * the caller's session in every way RLS cares about. There is no service-role path left.
 */
async function callerClient(req: NextRequest): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const cookieClient = await createServerClient()
  const { data: { user: cookieUser } } = await cookieClient.auth.getUser()
  if (cookieUser) return { supabase: cookieClient, userId: cookieUser.id }

  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return null

  const tokenClient = createTokenClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
  const { data: { user: tokenUser } } = await tokenClient.auth.getUser(token)
  if (!tokenUser) return null
  return { supabase: tokenClient, userId: tokenUser.id }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await callerClient(req)
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { supabase, userId } = caller

    const body = await req.json().catch(() => ({}))
    const { brief_text, brief_title, analyses_requested, project_id } = body as {
      brief_text?: string
      brief_title?: string
      analyses_requested?: string[]
      project_id?: string | null
    }

    if (!brief_text?.trim() || !brief_title?.trim() || !Array.isArray(analyses_requested)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      brief_text,
      brief_title,
      analyses_requested,
    }

    if (project_id) {
      if (typeof project_id !== "string") {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      // The foreign key to projects is checked by Postgres as the table owner, so RLS on the
      // insert does NOT stop a row pointing at another tenant's project. Ownership is checked
      // here: the project must be readable by the caller AND belong to one of the caller's own
      // organizations. A vendor can read a project it is assigned to, so readability alone is
      // not ownership. Every failure is the same 404, so this is not an existence oracle.
      const callerOrgIds = await resolveCallerOrgIds(userId, supabase)
      const { data: project, error: projectErr } = await supabase
        .from("projects")
        .select("id, org_id")
        .eq("id", project_id)
        .maybeSingle()
      if (projectErr || !project || !callerOwnsOrg(callerOrgIds, project.org_id)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      insertPayload.project_id = project.id
    }

    const { data: row, error } = await supabase
      .from("brief_interpretations")
      .insert(insertPayload)
      .select("id")
      .single()

    if (error || !row) {
      console.error("[api/brief/save] insert error", error)
      return NextResponse.json({ error: "Could not save analysis session" }, { status: 500 })
    }

    return NextResponse.json({ id: row.id })
  } catch (e) {
    console.error("[api/brief/save] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
