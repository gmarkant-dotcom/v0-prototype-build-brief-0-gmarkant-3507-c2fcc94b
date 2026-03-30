import { installPdfNodePolyfills } from "@/lib/pdf-node-polyfills"

/**
 * Text-only extraction using pdfjs-dist directly (no pdf-parse wrapper).
 * pdfjs-dist must stay external in next.config.mjs so Turbopack/Webpack do not bundle it.
 */
export async function extractPdfTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  installPdfNodePolyfills()

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    } as any)

    const pdf = await loadingTask.promise
    let full = ""
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        for (const item of textContent.items) {
          if (item && typeof item === "object" && "str" in item) {
            const s = (item as { str?: string }).str
            if (s) full += `${s} `
          }
        }
        full += "\n"
      }
    } finally {
      if (typeof (pdf as { destroy?: () => Promise<void> }).destroy === "function") {
        await (pdf as { destroy: () => Promise<void> }).destroy()
      }
    }

    const normalized = full.replace(/\u0000/g, "").replace(/\s+/g, " ").trim()
    console.log("[extract-text][pdfjs-dist]", {
      fileName,
      extractedChars: normalized.length,
      preview: normalized.slice(0, 200),
    })
    return normalized
  } catch (error) {
    console.error("[extract-text][pdfjs-dist-error]", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return ""
  }
}
