import { resolveCallerOrgIds, canUploadVendorFiles } from "@/lib/entitlements"
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

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase
      .from("profiles")
      // 092: THE is_paid IN THIS SELECT IS THE VESTIGIAL profiles COLUMN, ON PURPOSE.
      // Entitlement moved to organizations.is_paid at 092 and every agency gate reads it
      // there. This route is VENDOR-SIDE, and vendor organizations have no entitlement
      // concept at all - vendor access is free by the pricing copy - so it must NOT read
      // the organization flag. canUploadVendorFiles() consumes this field as the clause
      // that lets an agency-side caller fall through to the more accurate "Vendors only"
      // refusal below, not as a billing test. See its header in lib/entitlements.ts.
      // >>> THE MIGRATION THAT DROPS profiles.is_paid MUST DELETE THIS COLUMN FROM THIS
      // >>> SELECT LIST IN THE SAME CHANGE, or PostgREST fails the whole statement 42703.
      .select("role, active_role, is_paid, is_admin, email")
      .eq("id", user.id)
      .single()
    console.log("[api] start", { route, method: "POST", userId: user.id, role: profile?.role ?? null })

    // ONE DEFINITION, in lib/entitlements.ts. This expression was inlined here and in the
    // other vendor upload route, identically, and the paragraph that used to stand here
    // explained why it was NOT canUploadFiles(): that function asks
    // actingRole(profile) === "partner", where active_role decides, and would 403 an
    // account with role='partner' / active_role='agency' / is_paid=false that this route
    // has always let through. That reasoning is preserved and canUploadVendorFiles() keeps
    // the permissive canActAs() form, term for term. See its header for the proof, and for
    // the single non-identity (canActAs normalizes case and whitespace; the raw comparison
    // did not) and why no live row can reach it.
    const canUpload = canUploadVendorFiles(profile)

    if (!canUpload) {
      return NextResponse.json({ error: "Upgrade to upload files" }, { status: 403 })
    }

    // Only block a pure agency profile that isn't currently acting as partner - a dual-role
    // account with active_role="partner" is legitimately submitting a bid in this session.
    if (profile?.role === "agency" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendors only" }, { status: 403 })
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
      .select("id, vendor_org_id, recipient_email, nda_gate_enforced, nda_confirmed_at")
      .eq("id", inboxId)
      .maybeSingle()

    if (inboxLookupErr || !inboxRow) {
      return NextResponse.json({ error: "RFP not found or access denied" }, { status: 404 })
    }

    const access = partnerCanAccessPartnerRfpInbox(
      {
        vendor_org_id: (inboxRow.vendor_org_id as string | null) ?? null,
        recipient_email: (inboxRow.recipient_email as string | null) ?? null,
        nda_gate_enforced: (inboxRow.nda_gate_enforced as boolean | null) ?? false,
        nda_confirmed_at: (inboxRow.nda_confirmed_at as string | null) ?? null,
      },
      callerOrgIds,
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
