import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    let userId: string | null = null

    const serverSupabase = await createServerClient()
    const { data: { user: serverUser } } = await serverSupabase.auth.getUser()

    if (serverUser) {
      userId = serverUser.id
    } else {
      const authHeader = req.headers.get("authorization") ?? ""
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
      if (token) {
        const serviceVerifier = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const { data: { user: tokenUser } } = await serviceVerifier.auth.getUser(token)
        if (tokenUser) userId = tokenUser.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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

    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      brief_text,
      brief_title,
      analyses_requested,
    }
    if (project_id) insertPayload.project_id = project_id

    const { data: row, error } = await serviceClient
      .from("brief_interpretations")
      .insert(insertPayload)
      .select("id")
      .single()

    if (error) {
      console.error("[api/brief/save] insert error", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ id: row.id })
  } catch (e) {
    console.error("[api/brief/save] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
