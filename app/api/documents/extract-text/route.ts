import { NextResponse } from "next/server"
import mammoth from "mammoth"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const MAX_CHARS = 120_000
/** Below this, extracted text is unlikely to be a real brief (headers only, etc.) */
const THIN_EXTRACTION_THRESHOLD = 120

/** When pdf-parse returns empty (some PDFs / encodings), try raw pdf.js text content. */
async function extractPdfTextWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(buffer)
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  } as any)
  const pdf = await loadingTask.promise
  let full = ""
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    for (const item of textContent.items) {
      if (item && typeof item === "object" && "str" in item) {
        const s = (item as { str?: string }).str
        if (s) full += s + " "
      }
    }
    full += "\n"
  }
  if (typeof (pdf as any).destroy === "function") {
    await (pdf as any).destroy()
  }
  return full.replace(/\u0000/g, "").trim()
}

/** Supports both pdf-parse v1 (function export) and v2 (PDFParse class). */
async function extractPdfTextWithPdfParse(buffer: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse")

  // pdf-parse v2 style
  if (typeof mod.PDFParse === "function") {
    const parser = new mod.PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return (result?.text || "").toString()
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy()
    }
  }

  // pdf-parse v1 style
  const fn = typeof mod.default === "function" ? mod.default : typeof mod === "function" ? mod : null
  if (fn) {
    const result = await fn(buffer)
    return (result?.text || "").toString()
  }

  return ""
}

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
        text = await extractPdfTextWithPdfParse(buffer)
        if (!text.replace(/\u0000/g, "").trim()) {
          const alt = await extractPdfTextWithPdfJs(buffer)
          if (alt) {
            text = alt
            warning = "Used alternate PDF text extraction."
          }
        }
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
      const isPdf = lower.endsWith(".pdf")
      return NextResponse.json({
        text: fallback,
        fileName: file.name,
        warning:
          warning ||
          (isPdf
            ? "No selectable text was found in this PDF. Scanned/image PDFs are not supported. Please upload a text-based PDF or use Paste Text mode."
            : "Could not extract usable text from this file. Please use a text-based file or paste the content."),
        usedFallback: true,
        thinExtraction: false,
      })
    }

    let out = trimmed
    if (out.length > MAX_CHARS) {
      out = `${out.slice(0, MAX_CHARS)}\n\n[... truncated for processing ...]`
    }

    const thinExtraction = out.length > 0 && out.length < THIN_EXTRACTION_THRESHOLD
    const thinWarning = thinExtraction
      ? "Very little text was extracted (image-based PDF, complex layout, or short doc). Paste the full brief below for accurate Master RFP output."
      : null

    return NextResponse.json({
      text: out,
      fileName: file.name,
      warning: thinWarning || warning,
      usedFallback: false,
      thinExtraction,
    })
  } catch (error) {
    console.error("extract-text error:", error)
    return NextResponse.json({ error: "Failed to extract text from document" }, { status: 500 })
  }
}
