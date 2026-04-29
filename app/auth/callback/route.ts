import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { SupabaseClient, User } from "@supabase/supabase-js"

// Helper function to sync user profile after auth
async function syncUserProfile(supabase: any, user: any) {
  const metadata = user.user_metadata || {}
  const role = metadata.role || 'partner'
  
  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, role')
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
      is_paid: false,
      is_admin: false,
      demo_access: false,
    })
  } else {
    // Update role if not set, and always sync company_linkedin_url if present
    const updatePayload: Record<string, unknown> = {}
    if (!existingProfile.role) updatePayload.role = role
    if (metadata.company_linkedin_url) updatePayload.company_linkedin_url = metadata.company_linkedin_url
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
    .update({ partner_id: user.id, updated_at: new Date().toISOString() })
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

      if (inviteType === "partnership") {
        await claimPartnershipInvitations(supabase, data.user)
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

      if (inviteType === "partnership") {
        await claimPartnershipInvitations(supabase, data.user)
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
