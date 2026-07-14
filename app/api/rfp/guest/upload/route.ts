import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const ALLOWED_GUEST_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

const MAX_GUEST_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

function validateGuestUploadFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!file) return { ok: false, message: "No file provided." }
  if (file.size > MAX_GUEST_UPLOAD_SIZE_BYTES) {
    return { ok: false, message: "File is too large. Maximum size is 10MB." }
  }
  let effectiveType = file.type
  if (!effectiveType || !ALLOWED_GUEST_UPLOAD_MIME_TYPES.has(effectiveType)) {
    const lower = file.name.toLowerCase()
    const ext = Object.keys(EXTENSION_TO_MIME).find((e) => lower.endsWith(e))
    if (ext) effectiveType = EXTENSION_TO_MIME[ext]
  }
  if (!effectiveType || !ALLOWED_GUEST_UPLOAD_MIME_TYPES.has(effectiveType)) {
    return {
      ok: false,
      message: "Only PDF, DOC, DOCX, JPEG, PNG, GIF, or WebP files up to 10MB are allowed.",
    }
  }
  return { ok: true }
}

/** Strips path separators so a guest-supplied filename can't escape the token's blob prefix. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "file"
}

export async function POST(request: NextRequest) {
  const route = "/api/rfp/guest/upload"
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }
    // Service role required: guest uploader has no authenticated session to satisfy RLS.
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const token = (formData.get("token") as string | null)?.trim() || ""

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const { data: tokenRow, error: tokenErr } = await serviceSupabase
      .from("rfp_magic_tokens")
      .select("expires_at")
      .eq("token", token)
      .maybeSingle()

    if (tokenErr) {
      console.error("[api] failure", { route, method: "POST", code: 500, message: tokenErr.message })
      return NextResponse.json({ error: "Failed to validate token" }, { status: 500 })
    }
    if (!tokenRow || new Date(tokenRow.expires_at as string).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Invalid or expired invitation link" }, { status: 400 })
    }

    const validation = validateGuestUploadFile(file)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const filename = sanitizeFilename(file.name)
    const blob = await put(`rfp-guest-uploads/${token}/${filename}`, file, { access: "public" })

    console.log("[api] success", { route, method: "POST", pathname: blob.pathname })
    return NextResponse.json({ url: blob.url, filename: file.name, size: file.size })
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
