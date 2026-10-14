import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { agencyGateResponse } from "@/lib/api-auth"
import { resolveCallerOrgIds } from "@/lib/entitlements"
import { isMissingTableError } from "@/lib/server/rfp-record"

export const dynamic = "force-dynamic"

/**
 * PATCH /api/agency/rfp-records/[id] - the per-RFP client toggle on a record that already exists
 * (rulings D3, D5; docs/rfp-source-of-truth-design.md section 2). PATCH only.
 *
 *  1. Session, then G1 (402 for anyone who is not a member of a paid lead agency).
 *  2. zod on the id (uuid) and the body ({ show_client_to_vendors: boolean }, nothing else).
 *  3. ORGANIZATION SCOPE: the record is re-read on the session client under 118's RLS AND
 *     lead_org_id IN the caller's own organizations. Another organization's record, or an id that
 *     does not exist, is 404 (the same answer, so the route is not an existence oracle).
 *  4. ONE WRITE, ONE TRANSACTION: migration 119's rfp_record_set_client_visibility(record, show),
 *     called on the SESSION client (SECURITY INVOKER: 118's RLS and guards apply as the caller). It
 *     sets the record's show_client_to_vendors and rewrites client_name_released on every inbox row
 *     and token linked to the record's lines, or raises and writes nothing.
 *  5. BEFORE 119 IS APPLIED the function does not exist (42883 / PGRST202): 503 "not enabled yet",
 *     and nothing has been written (step 3 only reads). Before 118, the table read answers
 *     42P01 / PGRST205: the same 503.
 *
 * Vendors do not read client_name_released until step C; the page says so (lib/rfp-record-copy.ts).
 */

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ show_client_to_vendors: z.boolean() }).strict()

const NOT_ENABLED_BODY = {
  error: "Changing this setting is not enabled yet. Nothing was changed.",
  code: "rfp_record_toggle_not_enabled",
} as const

function isMissingFunctionError(err: { code?: string | null } | null | undefined): boolean {
  return err?.code === "42883" || err?.code === "PGRST202"
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/rfp-records/[id]"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // G1: the active organization must be a paid lead agency. 402 otherwise.
    const refused = await agencyGateResponse(user.id, supabase)
    if (refused) return refused

    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) return NextResponse.json({ error: "RFP record not found" }, { status: 404 })
    const recordId = parsedParams.data.id

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Send { show_client_to_vendors: true | false } and nothing else." }, { status: 400 })
    }
    const show = parsedBody.data.show_client_to_vendors

    // Organization scope, read only. Nothing is written before the one function call below.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    if (callerOrgIds.length === 0) return NextResponse.json({ error: "RFP record not found" }, { status: 404 })

    const { data: record, error: readErr } = await supabase
      .from("rfp_records")
      .select("id")
      .eq("id", recordId)
      .in("lead_org_id", callerOrgIds)
      .maybeSingle()
    if (readErr) {
      if (isMissingTableError(readErr)) return NextResponse.json(NOT_ENABLED_BODY, { status: 503 })
      console.error("[api] failure", { route, method: "PATCH", userId: user.id, recordId, code: readErr.code, message: readErr.message })
      return NextResponse.json({ error: "Could not load the RFP record" }, { status: 500 })
    }
    if (!record) return NextResponse.json({ error: "RFP record not found" }, { status: 404 })

    const { data: result, error: rpcErr } = await supabase.rpc("rfp_record_set_client_visibility", {
      p_record: recordId,
      p_show: show,
    })
    if (rpcErr) {
      if (isMissingFunctionError(rpcErr)) return NextResponse.json(NOT_ENABLED_BODY, { status: 503 })
      // P0002: the function found no record the caller may update (it raises before writing).
      if (rpcErr.code === "P0002") return NextResponse.json({ error: "RFP record not found" }, { status: 404 })
      console.error("[api] failure", { route, method: "PATCH", userId: user.id, recordId, code: rpcErr.code, message: rpcErr.message })
      return NextResponse.json({ error: "Could not change this setting. Nothing was changed." }, { status: 500 })
    }

    const counts = (result ?? {}) as { inbox_rows?: number; tokens?: number }
    console.log("[api] success", { route, method: "PATCH", userId: user.id, recordId, show, ...counts })
    return NextResponse.json({
      id: recordId,
      show_client_to_vendors: show,
      inbox_rows: typeof counts.inbox_rows === "number" ? counts.inbox_rows : null,
      tokens: typeof counts.tokens === "number" ? counts.tokens : null,
    })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "PATCH",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Could not change this setting. Nothing was changed." }, { status: 500 })
  }
}
