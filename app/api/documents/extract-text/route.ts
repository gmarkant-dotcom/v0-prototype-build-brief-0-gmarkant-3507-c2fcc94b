import { NextResponse } from "next/server"
import mammoth from "mammoth"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const MAX_CHARS = 120_000

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_paid, is_admin, role")
      .eq("id", user.id)
      .single()

    const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === "true"
    const allowed =
      isDemo ||
      profile?.role === "partner" ||
      profile?.is_admin ||
      profile?.is_paid

    if (!allowed) {
      return NextResponse.json({ error: "Upgrade to extract document text" }, { status: 403 })
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file || typeof (file as any).arrayBuffer !== "function") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const lower = file.name.toLowerCase()
    let text = ""
    let warning: string | null = null

    try {
      if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv")) {
        text = buffer.toString("utf-8")
      } else if (lower.endsWith(".docx")) {
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
      } else if (lower.endsWith(".doc")) {
        warning = "Legacy .doc is not directly readable; using filename fallback."
      } else if (lower.endsWith(".pdf")) {
        const { PDFParse } = await import("pdf-parse")
        const parser = new PDFParse({ data: buffer })
        const textResult = await parser.getText()
        text = textResult.text
        await parser.destroy()
      } else if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) {
        warning = "PowerPoint text extraction is limited; using filename fallback."
      } else {
        warning = "Unsupported type for text extraction; using filename fallback."
      }
    } catch (parseError) {
      console.error("extract-text parse warning:", parseError)
      warning = "Could not parse this file format; using filename fallback."
    }

    const trimmed = text.replace(/\u0000/g, "").trim()
    if (!trimmed) {
      const fallback = `Document uploaded: ${file.name}`
      return NextResponse.json({ text: fallback, fileName: file.name, warning: warning || "Fallback used" })
    }

    let out = trimmed
    if (out.length > MAX_CHARS) {
      out = `${out.slice(0, MAX_CHARS)}\n\n[... truncated for processing ...]`
    }

    return NextResponse.json({ text: out, fileName: file.name, warning })
  } catch (error) {
    console.error("extract-text error:", error)
    return NextResponse.json({ error: "Failed to extract text from document" }, { status: 500 })
  }
}
