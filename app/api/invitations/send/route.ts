import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { email, message } = body

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Get agency profile and enforce role
    const { data: agencyProfile } = await supabase
      .from("profiles")
      .select("role, company_name, full_name")
      .eq("id", user.id)
      .single()

    if (agencyProfile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const agencyName = agencyProfile?.company_name || agencyProfile?.full_name || "A Lead Agency"

    // Check if invitation already exists
    const { data: existingInvite } = await supabase
      .from("agency_partner_invitations")
      .select("id, status")
      .eq("agency_id", user.id)
      .eq("partner_email", email.toLowerCase())
      .single()

    if (existingInvite) {
      return NextResponse.json({ 
        error: "An invitation has already been sent to this email",
        existing: true,
        status: existingInvite.status
      }, { status: 400 })
    }

    // Create invitation record
    const { data: invitation, error: insertError } = await supabase
      .from("agency_partner_invitations")
      .insert({
        agency_id: user.id,
        partner_email: email.toLowerCase(),
        invitation_message: message || null,
        status: "pending",
      })
      .select()
      .single()

    if (insertError) {
      console.error("Error creating invitation:", insertError)
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
    }

    // Generate invitation link
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://withligament.com"
    const inviteLink = `${baseUrl}/auth/signup?invite=${invitation.id}&email=${encodeURIComponent(email)}`

    // Send invitation email via Supabase Auth
    // This uses Supabase's built-in email service
    const { error: emailError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${baseUrl}/auth/callback?next=/partner/invitations`,
      data: {
        role: "partner",
        invited_by: user.id,
        invitation_id: invitation.id,
      }
    })

    // If admin invite fails (likely due to permissions), try magic link approach
    if (emailError) {
      // Update invitation to include the invite link for manual sending
      await supabase
        .from("agency_partner_invitations")
        .update({ 
          invitation_message: `${message || ""}\n\nInvitation link: ${inviteLink}`.trim()
        })
        .eq("id", invitation.id)

      return NextResponse.json({ 
        success: true, 
        invitation,
        inviteLink,
        emailSent: false,
        message: "Invitation created. Email delivery requires SMTP configuration."
      })
    }

    console.log("[invitations/send] POST success", { invitationId: invitation.id })
    return NextResponse.json({ 
      success: true, 
      invitation,
      emailSent: true,
      message: "Invitation sent successfully"
    })
  } catch (error) {
    console.error("[invitations/send] POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
