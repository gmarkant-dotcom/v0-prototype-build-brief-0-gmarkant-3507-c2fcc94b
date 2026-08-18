import { resolveCallerOrgIds } from "@/lib/entitlements"
import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  isVercelBlobStorageUrl,
  parsePartnerRfpBlobPathFromUrl,
  parseProjectBlobPathFromUrl,
  parseGuestUploadBlobPathFromUrl,
  displayFilenameFromBlobUrl,
} from "@/lib/vercel-blob-url"

export const dynamic = "force-dynamic"

function safeDispositionFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200)
  return cleaned || "download"
}

/**
 * Stream a private Vercel Blob for agency review of partner RFP attachments.
 * Query: ?url=<encodeURIComponent(blobUrl)>
 * Auth: agency user must own the related partner_rfp_inbox row (lead_org_id = auth.uid()).
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("url")
    if (!raw) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 })
    }

    let blobUrl: string
    try {
      blobUrl = decodeURIComponent(raw)
      new URL(blobUrl)
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 })
    }

    if (!isVercelBlobStorageUrl(blobUrl)) {
      return NextResponse.json({ error: "Only Vercel Blob URLs are supported" }, { status: 400 })
    }

    const parsedRfp = parsePartnerRfpBlobPathFromUrl(blobUrl)
    const parsedProject = parseProjectBlobPathFromUrl(blobUrl)
    const parsedGuestUpload = parseGuestUploadBlobPathFromUrl(blobUrl)
    if (!parsedRfp && !parsedProject && !parsedGuestUpload) {
      return NextResponse.json({ error: "Unrecognized blob path" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()

    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    if (parsedRfp) {
      const { data: inbox, error: inboxErr } = await supabase
        .from("partner_rfp_inbox")
        .select("id, lead_org_id")
        .eq("id", parsedRfp.inboxId)
        .maybeSingle()

      if (inboxErr || !inbox || !callerOrgIds.includes(inbox.lead_org_id as string)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }

      const { data: responseRow } = await supabase
        .from("partner_rfp_responses")
        .select("id")
        .in("lead_org_id", callerOrgIds)
        .eq("inbox_item_id", parsedRfp.inboxId)
        .eq("vendor_org_id", parsedRfp.partnerId)
        .maybeSingle()

      if (!responseRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
    }

    if (parsedProject) {
      const { data: project, error: projectErr } = await supabase
        .from("projects")
        .select("id, org_id")
        .eq("id", parsedProject.projectId)
        .maybeSingle()

      if (projectErr || !project || !callerOrgIds.includes(project.org_id as string)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
    }

    if (parsedGuestUpload) {
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("rfp_magic_tokens")
        .select("org_id")
        .eq("token", parsedGuestUpload.token)
        .maybeSingle()

      if (tokenErr || !tokenRow || !callerOrgIds.includes(tokenRow.org_id as string)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
    }

    const result = await get(blobUrl, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })

    if (!result) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 })
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          "Cache-Control": "private, no-store",
        },
      })
    }

    const filename = safeDispositionFilename(displayFilenameFromBlobUrl(blobUrl))

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ETag: result.blob.etag,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[agency/blob-download]", e)
    return NextResponse.json({ error: "Failed to download" }, { status: 500 })
  }
}
