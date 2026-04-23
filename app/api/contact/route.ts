import { createClient } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { buildBrandedEmailHtml, sendTransactionalEmail } from "@/lib/email"

/**
 * Public marketing lead capture. Uses service role only to insert into contact_submissions;
 * no end-user session. Rate limiting should live at edge/WAF if abuse becomes an issue.
 */
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
    const { fullName, workEmail, companyName, role } = body
    const normalizedName = fullName || name
    const normalizedEmail = workEmail || email
    const normalizedCompanyType = companyType || role || "Not provided"
    const normalizedCompanySize = companySize || "Not provided"
    const normalizedTitle = title || role || "Not provided"
    const selectedProduct = interestedProduct || plan || "general"

    console.log("[api/contact] start", {
      hasName: !!normalizedName,
      hasEmail: !!normalizedEmail,
      selectedProduct,
      hasStructuredLeadFields: !!(title && companyType && companySize),
      hasMessage: !!message,
    })

    if (!normalizedName || !normalizedEmail) {
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
            name: normalizedName,
            title: normalizedTitle,
            email: normalizedEmail,
            phone: phone || null,
            company_type: normalizedCompanyType,
            company_size: normalizedCompanySize,
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

    // Send email notification (non-blocking)
    try {
      const interested = productLabels[selectedProduct] || selectedProduct
      const contactBody = [
        `Interested in: ${interested}`,
        "",
        `Name: ${normalizedName}`,
        `Title or role: ${normalizedTitle}`,
        `Email: ${normalizedEmail}`,
        `Phone: ${phone || "Not provided"}`,
        `Company: ${companyName || "Not provided"}`,
        `Company type: ${normalizedCompanyType}`,
        `Company size: ${normalizedCompanySize}`,
        `Message: ${message || "Not provided"}`,
        "",
        `Submitted at: ${new Date().toLocaleString("en-US")}`,
      ].join("\n")
      await sendTransactionalEmail({
        to: "hello@withligament.com",
        subject: `New Contact: ${normalizedName} - ${interested}`,
        html: buildBrandedEmailHtml({
          title: "New contact form submission",
          recipientName: "Ligament team",
          body: contactBody,
        }),
      })
    } catch (emailErr) {
      console.log("[api/contact] email sending exception", {
        message: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
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
