import { canUploadVendorFiles } from "@/lib/entitlements"
import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateUploadFile } from "@/lib/upload-validation"

/**
 * Standalone partner document upload (Certificate of Insurance, and future documents that
 * aren't tied to a specific RFP inbox item). Same Vercel Blob private-access pattern as
 * /api/partner/rfp-bid/upload, including filename sanitization - unlike the generic
 * /api/upload route, which builds its blob pathname directly from file.name and can throw
 * (falling through to a generic 500) when the name has spaces, parentheses, or other
 * characters a raw pathname segment doesn't like. Common for real-world scanned COI PDFs.
 */
export async function POST(request: NextRequest) {
  const route = "/api/partner/documents/upload"
  try {
    // put() throws an opaque error if this is unset (e.g. a local .env.local that was never
    // synced with `vercel env pull`), which previously surfaced as a generic 500 with no
    // indication of the actual cause. Check explicitly so the failure is diagnosable.
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("[api] failure", {
        route,
        method: "POST",
        code: 500,
        message: "BLOB_READ_WRITE_TOKEN is not configured in this environment",
      })
      return NextResponse.json(
        { error: "File storage is not configured for this environment (BLOB_READ_WRITE_TOKEN missing)." },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
      .select("role, active_role, is_paid, is_admin")
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
    // account with active_role="partner" is legitimately uploading a document in this session.
    if (profile?.role === "agency" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Vendors only" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File
    const docId = ((formData.get("docId") as string) || "document").trim()

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
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

    const safeDocId = docId.replace(/[^a-zA-Z0-9_-]/g, "_") || "document"
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_")
    const timestamp = Date.now()
    const pathname = `partner-documents/${user.id}/${safeDocId}/${timestamp}-${safeName}`

    const blob = await put(pathname, file, { access: "private" })

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
    const message = error instanceof Error ? error.message : String(error)
    console.error("[api] failure", { route, method: "POST", code: 500, message })
    // Surface the real failure reason (e.g. a put() error) instead of a generic string that
    // hides what actually broke - this is what made the original bug hard to diagnose.
    return NextResponse.json({ error: message || "Upload failed" }, { status: 500 })
  }
}
