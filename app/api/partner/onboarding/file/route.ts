import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"

export const dynamic = "force-dynamic"

function safeDispositionFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200)
  return cleaned || "download"
}

/**
 * Partner download for a row in onboarding_package_documents they can access.
 * Query: documentId=<uuid>
 */
export async function GET(request: NextRequest) {
  try {
    const documentId = request.nextUrl.searchParams.get("documentId")
    if (!documentId) {
      return NextResponse.json({ error: "documentId required" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403 })
    }

    const { data: docRow, error: docErr } = await supabase
      .from("onboarding_package_documents")
      .select("id, label, url, package_id")
      .eq("id", documentId)
      .single()

    if (docErr || !docRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: pkg } = await supabase
      .from("onboarding_packages")
      .select("partnership_id")
      .eq("id", docRow.package_id as string)
      .single()

    if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { data: ship } = await supabase
      .from("partnerships")
      .select("partner_id")
      .eq("id", pkg.partnership_id as string)
      .single()

    if (!ship || ship.partner_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const url = docRow.url as string
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return NextResponse.json({ error: "Invalid stored url" }, { status: 400 })
    }

    if (!isVercelBlobStorageUrl(url)) {
      return NextResponse.redirect(url)
    }

    const result = await get(url, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })
    if (!result) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: result.blob.etag, "Cache-Control": "private, no-store" },
      })
    }

    const filename =
      safeDispositionFilename((docRow.label as string) || displayFilenameFromBlobUrl(url) || "document")

    return new NextResponse(result.stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.blob?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ETag: result.blob.etag,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[partner/onboarding/file]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
