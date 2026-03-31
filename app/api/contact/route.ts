import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const productLabels: Record<string, string> = {
    core: "Core ($299/month)",
    studio: "Studio ($699/month)",
    network: "Network (Custom)",
    enterprise: "Enterprise (Custom)",
    demo: "Demo Request",
  }

  try {
    const body = await request.json()
    const { name, title, email, phone, companyType, companySize, interestedProduct, message, plan } = body
    const selectedProduct = interestedProduct || plan || "general"

    console.log("[api/contact] start", {
      hasName: !!name,
      hasEmail: !!email,
      selectedProduct,
      hasStructuredLeadFields: !!(title && companyType && companySize),
      hasMessage: !!message,
    })

    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
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
            title: title || "Not provided",
            email,
            phone: phone || null,
            company_type: companyType || "Not provided",
            company_size: companySize || "Not provided",
            interested_product: selectedProduct,
          })

        if (dbError) {
          console.log("[api/contact] database save failed", { message: dbError.message })
        } else {
          console.log("[api/contact] database save success")
        }
      } catch (dbErr) {
        console.log("[api/contact] database connection error", {
          message: dbErr instanceof Error ? dbErr.message : String(dbErr),
        })
      }
    } else {
      console.log("[api/contact] supabase not configured, skipping database save")
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
          subject: `New Contact: ${name} - ${productLabels[selectedProduct] || selectedProduct}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Interested In:</strong> ${productLabels[selectedProduct] || selectedProduct}</p>
            <hr />
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Title:</strong> ${title || "Not provided"}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p><strong>Phone:</strong> ${phone || "Not provided"}</p>
            <p><strong>Company Type:</strong> ${companyType || "Not provided"}</p>
            <p><strong>Company Size:</strong> ${companySize || "Not provided"}</p>
            <p><strong>Message:</strong> ${message || "Not provided"}</p>
            <hr />
            <p style="color: #666; font-size: 12px;">Submitted at ${new Date().toLocaleString()}</p>
          `,
        })

        if (emailError) {
          console.log("[api/contact] resend failed", { message: emailError.message })
        } else {
          console.log("[api/contact] email sent")
        }
      } catch (emailErr) {
        console.log("[api/contact] email sending exception", {
          message: emailErr instanceof Error ? emailErr.message : String(emailErr),
        })
      }
    } else {
      console.log("[api/contact] resend not configured, skipping email")
    }

    console.log("[api/contact] success", { selectedProduct })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api/contact] failure", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to submit form" }, { status: 500 })
  }
}
