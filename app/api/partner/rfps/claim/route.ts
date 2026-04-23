import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type InboxClaimRow = {
  id: string
  partner_id: string | null
  recipient_email: string | null
  invite_token: string | null
  invite_token_expires_at: string | null
  claimed_at: string | null
  nda_gate_enforced: boolean | null
}

function emailMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a || "").trim().toLowerCase()
  const right = (b || "").trim().toLowerCase()
  return Boolean(left && right && left === right)
}

async function claimByToken(
  token: string,
  userId: string,
  profileEmail: string | null | undefined
): Promise<
  | { ok: true; inboxItemId: string; ndaGateEnforced: boolean }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createClient()
  const { data: inbox, error } = await supabase
    .from("partner_rfp_inbox")
    .select(
      "id, partner_id, recipient_email, invite_token, invite_token_expires_at, claimed_at, nda_gate_enforced"
    )
    .eq("invite_token", token)
    .maybeSingle<InboxClaimRow>()

  if (error) {
    return { ok: false, status: 500, error: "Failed to load invite" }
  }
  if (!inbox) {
    return { ok: false, status: 404, error: "Invite not found" }
  }

  if (!inbox.invite_token_expires_at || new Date(inbox.invite_token_expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: "Invite has expired" }
  }

  if (inbox.claimed_at) {
    if (inbox.partner_id === userId) {
      return { ok: true, inboxItemId: inbox.id, ndaGateEnforced: inbox.nda_gate_enforced === true }
    }
    return { ok: false, status: 409, error: "Invite already claimed" }
  }

  if (!emailMatches(inbox.recipient_email, profileEmail)) {
    return { ok: false, status: 403, error: "Invite email does not match your account email" }
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("partner_rfp_inbox")
    .update({
      partner_id: userId,
      claimed_at: now,
      updated_at: now,
    })
    .eq("id", inbox.id)
    .is("claimed_at", null)

  if (updateError) {
    return { ok: false, status: 500, error: "Failed to claim invite" }
  }

  return { ok: true, inboxItemId: inbox.id, ndaGateEnforced: inbox.nda_gate_enforced === true }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle<{ email: string | null }>()

  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === "string" ? body.token.trim() : ""
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 })
  }

  const result = await claimByToken(token, user.id, profile?.email || user.email)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    inboxItemId: result.inboxItemId,
    ndaGateEnforced: result.ndaGateEnforced,
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = (url.searchParams.get("token") || "").trim()
  const nda = url.searchParams.get("nda")
  if (!token) {
    return NextResponse.redirect(`${url.origin}/partner/rfps?invite_status=missing`)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL(`${url.origin}/auth/login`)
    loginUrl.searchParams.set("invite", token)
    if (nda) loginUrl.searchParams.set("nda", nda)
    return NextResponse.redirect(loginUrl.toString())
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle<{ email: string | null }>()

  const result = await claimByToken(token, user.id, profile?.email || user.email)
  if (!result.ok) {
    return NextResponse.redirect(`${url.origin}/partner/rfps?invite_status=failed`)
  }

  const rfpUrl = new URL(`${url.origin}/partner/rfps/${encodeURIComponent(result.inboxItemId)}`)
  if (result.ndaGateEnforced || nda === "required") {
    rfpUrl.searchParams.set("nda", "required")
  }
  return NextResponse.redirect(rfpUrl.toString())
}
