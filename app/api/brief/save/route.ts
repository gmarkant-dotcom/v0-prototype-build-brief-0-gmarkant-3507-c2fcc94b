import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    // Verify the caller is authenticated.
    // If the server client cannot read the session cookie here, getUser() returns
    // null and we fall through to the token-based fallback below.
    let userId: string | null = null

    const serverSupabase = await createServerClient()
    const { data: { user: serverUser } } = await serverSupabase.auth.getUser()

    if (serverUser) {
      userId = serverUser.id
    } else {
      // Fallback: accept the access token from the Authorization header and
      // verify it directly with the service role client (no session cookie needed).
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
    const { brief_text, brief_title, analyses_requested } = body as {
      brief_text?: string
      brief_title?: string
      analyses_requested?: string[]
    }

    if (!brief_text?.trim() || !brief_title?.trim() || !Array.isArray(analyses_requested)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Service role bypasses RLS entirely — works regardless of JWT signing algorithm
    // or PostgREST JWKS configuration on the brief_interpretations table.
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: row, error } = await serviceClient
      .from("brief_interpretations")
      .insert({
        user_id: userId,
        brief_text,
        brief_title,
        analyses_requested,
      })
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
