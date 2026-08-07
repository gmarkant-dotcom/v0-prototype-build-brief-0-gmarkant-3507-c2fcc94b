import { NextResponse } from "next/server"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { attachMagicTokenToPartnerInbox, type MagicTokenForAttach } from "@/lib/magic-token-attach"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * G1 dedupe on link-open: a logged-in vendor whose account email matches the magic link's
 * invited email calls this to attach the invitation into their portal inbox (idempotent,
 * same as send-time/sweep) and get redirected there instead of seeing the guest view. The
 * client (app/rfp/respond/[token]/page.tsx) is responsible for the email-match check before
 * calling this - this route re-verifies it anyway (never trust client payload) and 403s on
 * mismatch rather than attaching into the wrong account under any circumstance.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const route = "/api/rfp/guest/[token]/attach-existing-account"
  try {
    const { token } = await params
    const supabase = await createAnonClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle()
    const accountEmail = (profile?.email || user.email || "").trim().toLowerCase()
    if (!accountEmail) {
      return NextResponse.json({ error: "Could not verify your account email" }, { status: 400 })
    }

    const service = getServiceSupabase()
    if (!service) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }

    const { data: tokenRow, error: tokenErr } = await service
      .from("rfp_magic_tokens")
      .select(
        "token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_criteria_required, require_terms_disclosure, response_deadline, expires_at, response_id"
      )
      .eq("token", token)
      .maybeSingle()
    if (tokenErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: tokenErr.message })
      return NextResponse.json({ error: "Failed to load invitation" }, { status: 500 })
    }
    if (!tokenRow) {
      return NextResponse.json({ error: "Invalid invitation link" }, { status: 404 })
    }

    const inviteEmail = (tokenRow.vendor_email as string || "").trim().toLowerCase()
    if (!inviteEmail || inviteEmail !== accountEmail) {
      return NextResponse.json({ error: "email_mismatch" }, { status: 403 })
    }

    const result = await attachMagicTokenToPartnerInbox(service, {
      tokenRow: tokenRow as unknown as MagicTokenForAttach,
      partnerId: user.id,
    })
    if (!result.attached) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: result.reason })
      return NextResponse.json({ error: "Failed to attach invitation" }, { status: 500 })
    }

    console.log("[api] success", { route, method: "POST", userId: user.id, token, created: result.created })
    return NextResponse.json({ inboxId: result.inboxId })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to attach invitation" }, { status: 500 })
  }
}
