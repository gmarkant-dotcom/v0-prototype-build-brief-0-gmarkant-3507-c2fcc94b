import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateUploadFile } from "@/lib/upload-validation"
import { partnerCanAccessPartnerRfpInbox } from "@/lib/partner-inbox-access"

/**
 * Partner bid attachment upload — same pattern as /api/upload:
 * Vercel Blob with access: 'private', path scoped by user + inbox.
 */
export async function POST(request: NextRequest) {
  try {
    const route = "/api/partner/rfp-bid/upload"
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_paid, is_admin, email")
      .eq("id", user.id)
      .single()
    console.log("[api] start", { route, method: "POST", userId: user.id, role: profile?.role ?? null })

    const isDemoMode = process.env.NEXT_PUBLIC_IS_DEMO === "true"
    const canUpload =
      isDemoMode || profile?.role === "partner" || profile?.is_admin || profile?.is_paid

    if (!canUpload) {
      return NextResponse.json({ error: "Upgrade to upload files" }, { status: 403 })
    }

    if (profile?.role === "agency") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File
    const inboxId = ((formData.get("inboxId") as string) || "").trim()

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!inboxId || inboxId === "general") {
      return NextResponse.json({ error: "inboxId required" }, { status: 400 })
    }

    const { data: inboxRow, error: inboxLookupErr } = await supabase
      .from("partner_rfp_inbox")
      .select("id, partner_id, recipient_email, nda_gate_enforced, nda_confirmed_at")
      .eq("id", inboxId)
      .maybeSingle()

    if (inboxLookupErr || !inboxRow) {
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const access = partnerCanAccessPartnerRfpInbox(
      {
        partner_id: (inboxRow.partner_id as string | null) ?? null,
        recipient_email: (inboxRow.recipient_email as string | null) ?? null,
        nda_gate_enforced: (inboxRow.nda_gate_enforced as boolean | null) ?? false,
        nda_confirmed_at: (inboxRow.nda_confirmed_at as string | null) ?? null,
      },
      user.id,
      profile?.email
    )
    if (!access.allowed) {
      if (access.reason === "nda_required") {
        return NextResponse.json({ error: "nda_required", inboxItemId: inboxId }, { status: 403 })
      }
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const validation = validateUploadFile(file)
    if (!validation.ok) {
      console.error("[api] failure", {
        route,
        method: "POST",
        userId: user.id,
        role: profile?.role ?? null,
        code: 400,
        message: validation.message,
      })
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_")
    const timestamp = Date.now()
    const pathname = `partner-rfp-bids/${user.id}/${inboxRow.id}/${timestamp}-${safeName}`

    const blob = await put(pathname, file, {
      access: "private",
    })

    console.log("[api] success", {
      route,
      method: "POST",
      userId: user.id,
      role: profile?.role ?? null,
      pathname: blob.pathname,
    })

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name,
      size: file.size,
      contentType: file.type,
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/partner/rfp-bid/upload",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
