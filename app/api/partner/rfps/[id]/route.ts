import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (inboxError) {
      console.error("[partner/rfps/[id]] inbox:", inboxError)
      return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    }

    if (!inbox) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    let response: unknown = null
    const respQ = await supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("inbox_item_id", id)
      .eq("partner_id", user.id)
      .maybeSingle()

    if (respQ.error) {
      if (respQ.error.code !== "42P01" && !/does not exist/i.test(respQ.error.message || "")) {
        console.warn("[partner/rfps/[id]] response select:", respQ.error.message)
      }
    } else {
      response = respQ.data
    }

    return NextResponse.json(
      { inbox, response: response ?? null },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[partner/rfps/[id]] GET:", e)
    return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
  }
}
