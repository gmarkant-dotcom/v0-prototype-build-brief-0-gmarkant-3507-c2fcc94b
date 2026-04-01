import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: row, error } = await supabase
      .from("agency_library_documents")
      .select("id, agency_id, label, blob_url, source_type, external_url")
      .eq("id", id)
      .eq("agency_id", user.id)
      .single()

    if (error || !row) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (row.source_type === "url" && row.external_url) {
      return NextResponse.redirect(row.external_url)
    }

    const url = row.blob_url as string | null
    if (!url || !isVercelBlobStorageUrl(url)) {
      return NextResponse.json({ error: "No file" }, { status: 404 })
    }

    const result = await get(url, { access: "private" })
    if (!result?.body) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const name = (row.label as string).replace(/[^\w.\- ()]+/g, "_").slice(0, 200) || "document"

    return new NextResponse(result.body as unknown as BodyInit, {
      headers: {
        "Content-Type": result.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[agency/library-documents/file]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
