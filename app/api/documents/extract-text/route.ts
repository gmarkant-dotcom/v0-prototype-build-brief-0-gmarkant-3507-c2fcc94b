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

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const lower = file.name.toLowerCase()
    let text = ""

    if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv")) {
      text = buffer.toString("utf-8")
    } else if (lower.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (lower.endsWith(".doc")) {
      return NextResponse.json(
        {
          error:
            "Legacy .doc format is not supported. Please save as .docx or PDF and upload again.",
        },
        { status: 415 }
      )
    } else if (lower.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse")
      const parser = new PDFParse({ data: buffer })
      const textResult = await parser.getText()
      text = textResult.text
      await parser.destroy()
    } else if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) {
      return NextResponse.json(
        {
          error:
            "PowerPoint files cannot be read automatically. Export to PDF or copy the outline into Paste Text.",
        },
        { status: 415 }
      )
    } else {
      return NextResponse.json(
        {
          error: "Unsupported type. Use PDF, Word (.docx), or plain text (.txt / .md).",
        },
        { status: 415 }
      )
    }

    const trimmed = text.replace(/\u0000/g, "").trim()
    if (!trimmed) {
      return NextResponse.json(
        { error: "No readable text was found in this file. Try another format or paste the content." },
        { status: 422 }
      )
    }

    let out = trimmed
    if (out.length > MAX_CHARS) {
      out = `${out.slice(0, MAX_CHARS)}\n\n[... truncated for processing ...]`
    }

    return NextResponse.json({ text: out, fileName: file.name })
  } catch (error) {
    console.error("extract-text error:", error)
    return NextResponse.json({ error: "Failed to extract text from document" }, { status: 500 })
  }
}
