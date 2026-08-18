import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { createClient } from "@/lib/supabase/server"

type PatchBody = {
  full_name?: string
  display_name?: string
  avatar_url?: string | null
  /** 086. A job title. IDENTITY, NEVER AUTHORITY - see the column comment on profiles.title. */
  title?: string | null
  personal_linkedin_url?: string | null
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = (await req.json()) as PatchBody
    const avatar_url = body.avatar_url
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body.full_name === "string") {
      updates.full_name = body.full_name.trim()
    }
    if (typeof body.display_name === "string") {
      updates.display_name = body.display_name.trim()
    }
    if (avatar_url === null || typeof avatar_url === "string") {
      updates.avatar_url = avatar_url
    }
    // NOT PREVIOUSLY WHITELISTED, AND THEREFORE SILENTLY DISCARDED.
    // app/agency/settings/user/page.tsx has been PATCHing personal_linkedin_url to this
    // route since migration 049, the route never listed it, and the page reported success
    // every time. The value went nowhere and nothing said so. Added here because it is one
    // line in a function this change was already editing, and leaving a known silent write
    // beside a new one would be indefensible. Reported in docs/m1-foundation-report.md.
    if (body.personal_linkedin_url === null || typeof body.personal_linkedin_url === "string") {
      const v = typeof body.personal_linkedin_url === "string" ? body.personal_linkedin_url.trim() : null
      updates.personal_linkedin_url = v || null
    }
    // 086. An empty string is stored as NULL: "no title" is one state, not two.
    const wantsTitle = body.title === null || typeof body.title === "string"
    if (wantsTitle) {
      updates.title = typeof body.title === "string" ? body.title.trim() || null : null
    }

    const SELECT_WITH_TITLE = "id, full_name, display_name, avatar_url, personal_linkedin_url, title"
    const SELECT_WITHOUT_TITLE = "id, full_name, display_name, avatar_url, personal_linkedin_url"

    // Typed as the shape WITHOUT title, because the 42703 retry below produces exactly that
    // and the two branches have to share one variable. `title` is read off it optionally.
    type ProfileEcho = {
      id: string
      full_name: string | null
      display_name: string | null
      avatar_url: string | null
      personal_linkedin_url: string | null
      title?: string | null
    }

    let titleUnavailable = false
    let { data, error } = (await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select(SELECT_WITH_TITLE)
      .single()) as { data: ProfileEcho | null; error: { code?: string; message: string } | null }

    // 086 GUARD. profiles.title does not exist until 086 is applied, and PostgREST fails the
    // WHOLE statement with 42703 rather than ignoring the unknown column - both in the
    // update payload and in the select list. Without this, deploying this route before the
    // migration would break every profile save, not just the title. Retried without the
    // column, and the caller is TOLD the title did not save rather than being shown a
    // success that discarded it. Same guard shape migration 074's response_deadline uses.
    if (error?.code === "42703") {
      titleUnavailable = true
      const { title: _droppedTitle, ...withoutTitle } = updates
      void _droppedTitle
      const retry = (await supabase
        .from("profiles")
        .update(withoutTitle)
        .eq("id", user.id)
        .select(SELECT_WITHOUT_TITLE)
        .single()) as { data: ProfileEcho | null; error: { code?: string; message: string } | null }
      data = retry.data
      error = retry.error
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ profile: data, titleUnavailable })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 }
    )
  }
}
