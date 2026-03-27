import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const productLabels: Record<string, string> = {
    core: "Core ($199/month)",
    studio: "Studio ($699/month)",
    enterprise: "Enterprise (Custom)",
    demo: "Demo Request",
  }

  try {
    const body = await request.json()
    const { name, title, email, phone, companyType, companySize, interestedProduct } = body

    console.log("[v0] Contact form submission received:", { name, email, interestedProduct })

    // Validate required fields
    if (!name || !title || !email || !companyType || !companySize) {
      console.log("[v0] Missing required fields")
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Store in Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const { error: dbError } = await supabase
          .from("contact_submissions")
          .insert({
            name,
            title,
            email,
            phone: phone || null,
            company_type: companyType,
            company_size: companySize,
            interested_product: interestedProduct,
          })

        if (dbError) {
          console.log("[v0] Database error:", dbError.message)
        } else {
          console.log("[v0] Successfully saved to database")
        }
      } catch (dbErr) {
        console.log("[v0] Database connection error:", dbErr)
      }
    } else {
      console.log("[v0] Supabase not configured, skipping database save")
    }

    // Send email notification via Resend (non-blocking)
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey)
        
        const fromAddress = "Ligament <notifications@withligament.com>"
        
        const { error: emailError } = await resend.emails.send({
          from: fromAddress,
          to: "hello@withligament.com",
          subject: `New Lead: ${name} - ${productLabels[interestedProduct] || interestedProduct}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Interested In:</strong> ${productLabels[interestedProduct] || interestedProduct}</p>
            <hr />
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Title:</strong> ${title}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p><strong>Phone:</strong> ${phone || "Not provided"}</p>
            <p><strong>Company Type:</strong> ${companyType}</p>
            <p><strong>Company Size:</strong> ${companySize}</p>
            <hr />
            <p style="color: #666; font-size: 12px;">Submitted at ${new Date().toLocaleString()}</p>
          `,
        })

        if (emailError) {
          console.log("[v0] Resend error:", emailError)
        } else {
          console.log("[v0] Email sent successfully")
        }
      } catch (emailErr) {
        console.log("[v0] Email sending error:", emailErr)
      }
    } else {
      console.log("[v0] Resend not configured, skipping email")
    }

    // Always return success if we got this far - the form data was received
    console.log("[v0] Returning success response")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Contact form error:", error)
    return NextResponse.json({ error: "Failed to submit form" }, { status: 500 })
  }
}
