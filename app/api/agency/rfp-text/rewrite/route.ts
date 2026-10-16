import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAgencyRole } from "@/lib/api-auth"
import { agencyEntitlementId, resolveCallerOrgIds } from "@/lib/entitlements"
import { checkUsageLimit, incrementAiAnalysis, usageLimitResponse } from "@/lib/usage-tracking"
import { callAnthropicAnalysis, tryParseJsonObject } from "@/lib/ai-bid-analysis"
import { readProjectClientNames } from "@/lib/server/rfp-vendor-text"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * POST /api/agency/rfp-text/rewrite - ruling OV-A's "Suggest vendor-safe rewrite".
 *
 * The same pattern as app/api/agency/bids/[responseId]/generate-summary/route.ts:
 *  1. Session, then G1 (requireAgencyRole: 401 without a session, 402 unless the active organization
 *     is a paid lead agency). Reachable by no vendor, guest or anonymous caller.
 *  2. zod on the body, with size limits (at most 30 fields, 6000 characters each, 20000 in all).
 *  3. ORGANIZATION CHECK: the project must belong to one of the caller's organizations, read on the
 *     SESSION client under RLS and filtered by org_id. Anything else is 404 (no existence oracle).
 *  4. Usage: the ai_analyses quota is checked before the model call and counted after a success.
 *  5. One model call. The client names given to the model are server-derived (the project's client
 *     name and its linked client profile's name), never taken from the request.
 *  6. NO TEXT IN LOGS: failures log the route, codes and counts only.
 *
 * It returns suggestions to the agency and writes nothing. It never sends anything to a vendor.
 */

const MAX_FIELDS = 30
const MAX_FIELD_CHARS = 6000
const MAX_TOTAL_CHARS = 20000

const bodySchema = z
  .object({
    project_id: z.string().uuid(),
    client_hidden: z.boolean(),
    fields: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(120),
            label: z.string().trim().max(200).optional(),
            text: z.string().max(MAX_FIELD_CHARS),
            reasons: z.array(z.enum(["client_name", "figure"])).max(2).optional(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_FIELDS),
  })
  .strict()
  .refine((b) => b.fields.reduce((n, f) => n + f.text.length, 0) <= MAX_TOTAL_CHARS, {
    message: "too_long",
  })
  .refine((b) => new Set(b.fields.map((f) => f.field)).size === b.fields.length, { message: "duplicate_field" })

const resultSchema = z.object({
  rewrites: z.array(z.object({ field: z.string(), text: z.string() })).max(MAX_FIELDS),
})

const SYSTEM_PROMPT = `You edit RFP text that an agency is about to send to outside vendors (production companies, studios, freelancers).
Rewrite ONLY the fields you are given. Keep each field's meaning, tone, structure and length close to the original so the brief stays useful to a vendor deciding whether and how to bid.
Remove or neutralise:
- any brand, company, product or person name that identifies the agency's client (use neutral wording such as "the client", "a global sportswear brand" only if that does not identify them, or "the brand");
- any money figure, budget, fee, rate, total investment or percentage that reveals the client's budget or the agency's fee (describe scale qualitatively instead, or drop it).
Do not invent facts, names or figures. Do not add commentary. Keep line breaks and list formatting.
Answer with JSON only, in exactly this shape: {"rewrites":[{"field":"<field id as given>","text":"<rewritten text>"}]}. Include every field you were given, once.`

export async function POST(req: Request) {
  const route = "/api/agency/rfp-text/rewrite"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Send a project and 1 to ${MAX_FIELDS} fields of at most ${MAX_FIELD_CHARS} characters (${MAX_TOTAL_CHARS} in all).` },
        { status: 400 }
      )
    }
    const body = parsed.data

    // Organization check on the session client: the project must be the caller's own.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
    if (callerOrgIds.length === 0) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    const namesByProject = await readProjectClientNames(supabase, route, [body.project_id], callerOrgIds)
    if (!namesByProject.has(body.project_id)) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    const clientNames = namesByProject.get(body.project_id) ?? []

    const entitlementId = await agencyEntitlementId(user.id, supabase)
    const usageCheck = await checkUsageLimit(entitlementId, supabase, "ai_analyses")
    if (!usageCheck.allowed) return usageLimitResponse(usageCheck)

    const instructions = [
      body.client_hidden
        ? clientNames.length > 0
          ? `The client is HIDDEN from vendors. The client is known as: ${clientNames.map((n) => JSON.stringify(n)).join(", ")}. Remove these names, their variants and anything else that identifies this client.`
          : "The client is HIDDEN from vendors. Remove any brand or company name that identifies the client."
        : "The client's name may stay; only remove money figures and percentages.",
    ].join("\n")
    const userContent = `${instructions}\n\nFields (JSON):\n${JSON.stringify(
      body.fields.map((f) => ({ field: f.field, label: f.label ?? f.field, flagged_for: f.reasons ?? [], text: f.text }))
    )}`

    const result = await callAnthropicAnalysis({
      systemPrompt: SYSTEM_PROMPT,
      userContent,
      maxTokens: 4096,
      timeoutMs: 45_000,
    })
    if (!result.success) {
      console.error("[api] failure", { route, method: "POST", reason: "model_call_failed", fieldCount: body.fields.length })
      return NextResponse.json({ error: "No suggestion this time. Please try again." }, { status: 502 })
    }

    const answer = resultSchema.safeParse(tryParseJsonObject(result.text))
    if (!answer.success) {
      console.error("[api] failure", { route, method: "POST", reason: "unparseable_answer", fieldCount: body.fields.length })
      return NextResponse.json({ error: "No suggestion this time. Please try again." }, { status: 502 })
    }

    // Only fields that were asked about, once each, capped at the same size as the input.
    const asked = new Set(body.fields.map((f) => f.field))
    const rewrites: { field: string; text: string }[] = []
    for (const r of answer.data.rewrites) {
      if (!asked.has(r.field) || rewrites.some((x) => x.field === r.field)) continue
      rewrites.push({ field: r.field, text: r.text.slice(0, MAX_FIELD_CHARS) })
    }

    await incrementAiAnalysis(entitlementId, supabase)
    console.log("[api] success", { route, method: "POST", userId: user.id, fieldCount: body.fields.length, rewriteCount: rewrites.length })
    return NextResponse.json({ rewrites })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.name : "unknown",
    })
    return NextResponse.json({ error: "No suggestion this time. Please try again." }, { status: 500 })
  }
}
