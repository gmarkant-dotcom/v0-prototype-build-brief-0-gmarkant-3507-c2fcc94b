import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { SupabaseClient, User } from "@supabase/supabase-js"

// Helper function to sync user profile after auth
async function syncUserProfile(supabase: any, user: any) {
  const metadata = user.user_metadata || {}
  // Force partner role when the user arrived via an RFP invite or partnership invite
  const hasInviteContext = !!(metadata.invite || metadata.invite_token || metadata.invite_type)
  const role = hasInviteContext ? 'partner' : (metadata.role || 'partner')

  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, role, active_role, is_paid, demo_access')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    // Create profile if it doesn't exist
    await supabase.from('profiles').insert({
      id: user.id,
      email: user.email,
      full_name: metadata.full_name || '',
      company_name: metadata.company_name || '',
      company_linkedin_url: metadata.company_linkedin_url || null,
      role: role,
      active_role: role,
      is_admin: false,
      // is_paid and demo_access are deliberately absent. Both columns default to
      // FALSE, matching migration 078: a new account lands unpaid and without demo
      // access, and stays that way until an admin grants it. This insert exists only
      // because the on_auth_user_created trigger does not always fire - it must create
      // the profile row, never grant access.
    })
  } else {
    const updatePayload: Record<string, unknown> = {}
    // migration 056's handle_new_user() trigger inserts every brand-new profile with
    // role='agency'/active_role='agency' unconditionally, ignoring signup metadata - so by
    // the time this route runs (right after email confirmation), existingProfile.role is
    // never null and the old "only set role if not set" guard never fired, silently keeping
    // every vendor-flavored signup (RFP invite, partnership invite, magic-link "Create
    // profile") on the agency side. This route only runs once per confirmation link (not on
    // routine logins - those go through /auth/login directly), so correcting role/active_role
    // here whenever the signup's own metadata says "partner" cannot clobber an established
    // dual-role user's later, deliberate active_role choice.
    if (role === 'partner' && (existingProfile.role !== 'partner' || existingProfile.active_role !== 'partner')) {
      updatePayload.role = 'partner'
      updatePayload.active_role = 'partner'
    } else if (!existingProfile.role) {
      updatePayload.role = role
    }
    if (metadata.company_linkedin_url) updatePayload.company_linkedin_url = metadata.company_linkedin_url
    // No access flags are written here. This branch previously re-granted is_paid and
    // demo_access whenever they were falsy, which meant an admin restricting a user was
    // silently undone the next time that user hit this callback. Access is granted
    // deliberately, from the admin panel or the grant-access route, and nowhere else.
    if (Object.keys(updatePayload).length > 0) {
      await supabase.from('profiles').update(updatePayload).eq('id', user.id)
    }
  }

  return role
}

async function claimPartnershipInvitations(supabase: SupabaseClient, user: User) {
  const loadProfileEmail = async (): Promise<string> => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle()
    return (profile?.email || "").trim().toLowerCase()
  }

  let email = await loadProfileEmail()
  if (!email) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    email = await loadProfileEmail()
  }
  if (!email) {
    email = (user?.email || "").trim().toLowerCase()
    if (email) {
      console.warn("claimPartnershipInvitations: profile not found, using auth email fallback")
    }
  }
  if (!email) return

  await supabase
    .from("partnerships")
    .update({ partner_id: user.id, profile_status: "active", updated_at: new Date().toISOString() })
    .is("partner_id", null)
    .in("status", ["pending", "active"])
    .ilike("partner_email", email)
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")
  const next = searchParams.get("next") ?? "/"
  const invite = searchParams.get("invite")
  const inviteType = (searchParams.get("invite_type") || "").trim().toLowerCase()
  const nda = searchParams.get("nda")
  const scope = searchParams.get("scope")
  const agency = searchParams.get("agency")

  // Handle error responses from Supabase (like expired OTP)
  if (error) {
    const errorMessage = encodeURIComponent(errorDescription || error)
    return NextResponse.redirect(`${origin}/auth/error?message=${errorMessage}`)
  }

  const supabase = await createClient()

  // Handle token hash flow (email confirmation without PKCE)
  // This allows users to click the link from any browser/device
  if (token_hash && type) {
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "signup" | "email" | "recovery" | "invite" | "email_change",
    })
    
    if (verifyError) {
      const errorMessage = encodeURIComponent(verifyError.message)
      return NextResponse.redirect(`${origin}/auth/error?message=${errorMessage}`)
    }
    
    if (data.user) {
      // Sync profile and get role
      const role = await syncUserProfile(supabase, data.user)

      // Claim any partnerships (including ghost partnerships auto-added from a magic-link
      // guest bid) waiting on this email - unconditional, not just for invite_type=partnership
      // signups, since a ghost vendor discovering Ligament on their own carries no such param.
      await claimPartnershipInvitations(supabase, data.user)

      if (inviteType === "partnership") {
        const destination = next && next !== "/" ? next : "/partner/invitations"
        return NextResponse.redirect(`${origin}${destination}`)
      }

      if (invite) {
        const claimUrl = new URL(`${origin}/api/partner/rfps/claim`)
        claimUrl.searchParams.set("token", invite)
        if (nda) claimUrl.searchParams.set("nda", nda)
        if (scope) claimUrl.searchParams.set("scope", scope)
        if (agency) claimUrl.searchParams.set("agency", agency)
        if (next) claimUrl.searchParams.set("next", next)
        return NextResponse.redirect(claimUrl.toString())
      }

      // If a specific next path was provided (e.g. the guest-bid "Create profile" flow
      // pointing back at /partner/rfps), use that instead of falling through to the signed-
      // out confirmation page - matches the PKCE branch below, which already does this.
      if (next && next !== "/") {
        return NextResponse.redirect(`${origin}${next}`)
      }

      // Sign out the user so they need to log in manually after confirmation
      await supabase.auth.signOut()

      // Redirect to confirmation success page
      return NextResponse.redirect(`${origin}/auth/confirmed?role=${role}`)
    }
  }

  // Handle PKCE code exchange flow (same browser only)
  if (code) {
    const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

    if (!sessionError && data.user) {
      // Sync profile and get role
      const role = await syncUserProfile(supabase, data.user)

      // Claim any partnerships (including ghost partnerships auto-added from a magic-link
      // guest bid) waiting on this email - unconditional, not just for invite_type=partnership
      // signups, since a ghost vendor discovering Ligament on their own carries no such param.
      await claimPartnershipInvitations(supabase, data.user)

      if (inviteType === "partnership") {
        const destination = next && next !== "/" ? next : "/partner/invitations"
        return NextResponse.redirect(`${origin}${destination}`)
      }

      if (invite) {
        const claimUrl = new URL(`${origin}/api/partner/rfps/claim`)
        claimUrl.searchParams.set("token", invite)
        if (nda) claimUrl.searchParams.set("nda", nda)
        if (scope) claimUrl.searchParams.set("scope", scope)
        if (agency) claimUrl.searchParams.set("agency", agency)
        if (next) claimUrl.searchParams.set("next", next)
        return NextResponse.redirect(claimUrl.toString())
      }

      // If a specific next path was provided (e.g., password reset), use that
      if (next && next !== "/") {
        return NextResponse.redirect(`${origin}${next}`)
      }
      
      // Sign out the user so they need to log in manually after confirmation
      await supabase.auth.signOut()
      
      // Redirect to confirmation success page
      return NextResponse.redirect(`${origin}/auth/confirmed?role=${role}`)
    }
    
    // Session exchange failed
    const errorMessage = encodeURIComponent(sessionError?.message || "Failed to verify email")
    return NextResponse.redirect(`${origin}/auth/error?message=${errorMessage}`)
  }

  // No code provided
  return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent("No verification code provided")}`)
}
