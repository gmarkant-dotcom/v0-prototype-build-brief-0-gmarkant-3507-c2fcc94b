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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, is_paid, is_admin")
      .eq("id", user.id)
      .single()
    console.log("[api] start", { route, method: "POST", userId: user.id, role: profile?.role ?? null })

    const isDemoMode = process.env.NEXT_PUBLIC_IS_DEMO === "true"
    const isPartner = profile?.role === "partner" || profile?.active_role === "partner"
    const canUpload = isDemoMode || isPartner || profile?.is_admin || profile?.is_paid

    if (!canUpload) {
      return NextResponse.json({ error: "Upgrade to upload files" }, { status: 403 })
    }

    // Only block a pure agency profile that isn't currently acting as partner - a dual-role
    // account with active_role="partner" is legitimately uploading a document in this session.
    if (profile?.role === "agency" && profile?.active_role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
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
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
