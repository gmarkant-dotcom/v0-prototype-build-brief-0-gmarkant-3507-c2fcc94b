import { installPdfNodePolyfills } from "@/lib/pdf-node-polyfills"

const MIN_MEANINGFUL_CHARS = 40

function normalize(raw: string): string {
  return raw.replace(/\u0000/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Prefer pdfjs-dist **non-legacy** build (no separate worker file). If that fails or returns
 * almost nothing, fall back to unpdf (serverless-oriented PDF.js wrapper).
 */
async function extractWithPdfjsNonLegacy(uint8: Uint8Array, fileName: string): Promise<string> {
  installPdfNodePolyfills()
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
  const gwo = (pdfjs as { GlobalWorkerOptions?: { workerSrc: string } }).GlobalWorkerOptions
  if (gwo) {
    gwo.workerSrc = "suppressed"
  }
  const loadingTask = (pdfjs as { getDocument: (opts: unknown) => { promise: Promise<unknown> } }).getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
    disableWorker: true,
  })

  const pdf = (await loadingTask.promise) as {
    numPages: number
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{ items: unknown[] }>
      cleanup?: () => void
    }>
    destroy?: () => Promise<void>
  }

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
      page.cleanup?.()
    }
  } finally {
    if (typeof pdf.destroy === "function") await pdf.destroy()
  }

  const normalized = normalize(full)
  return normalized
}

async function extractWithUnpdf(uint8: Uint8Array, fileName: string): Promise<string> {
  const { extractText } = await import("unpdf")
  const result = await extractText(uint8, { mergePages: true })
  const raw = typeof result.text === "string" ? result.text : ""
  const normalized = normalize(raw)
  return normalized
}

export async function extractPdfTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const uint8 = new Uint8Array(buffer)

  try {
    const fromPdfjs = await extractWithPdfjsNonLegacy(uint8, fileName)
    if (fromPdfjs.length >= MIN_MEANINGFUL_CHARS) {
      return fromPdfjs
    }
    console.warn("[extract-text][pdfjs-short-or-empty]", {
      fileName,
      extractedChars: fromPdfjs.length,
      tryingUnpdf: true,
    })
  } catch (error) {
    console.warn("[extract-text][pdfjs-failed]", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
      tryingUnpdf: true,
    })
  }

  try {
    return await extractWithUnpdf(uint8, fileName)
  } catch (error) {
    console.error("[extract-text][unpdf-error]", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return ""
  }
}
