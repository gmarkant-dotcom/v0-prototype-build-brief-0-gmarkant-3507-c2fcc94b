const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024

export const UPLOAD_VALIDATION_MESSAGE =
  "Only PDF, DOCX, PPTX, JPEG, PNG, WebP, or GIF files up to 20MB are allowed."

export function validateUploadFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!file) {
    return { ok: false, message: "No file provided." }
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return { ok: false, message: "File is too large. Maximum size is 20MB." }
  }

  let effectiveType = file.type
  if (!effectiveType || !ALLOWED_UPLOAD_MIME_TYPES.has(effectiveType)) {
    const lower = file.name.toLowerCase()
    const ext = [".pdf", ".docx", ".pptx", ".jpg", ".jpeg", ".png", ".webp", ".gif"].find((e) =>
      lower.endsWith(e)
    )
    if (ext && EXTENSION_TO_MIME[ext]) {
      effectiveType = EXTENSION_TO_MIME[ext]
    }
  }

  if (!ALLOWED_UPLOAD_MIME_TYPES.has(effectiveType)) {
    return { ok: false, message: UPLOAD_VALIDATION_MESSAGE }
  }

  return { ok: true }
}

// Broader allowlist for project document uploads (app/api/documents/upload). These
// support office docs, spreadsheets, plain text, and video review files in addition
// to the PDF/image types allowed for general uploads.
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "video/mp4",
  "video/quicktime",
])

const DOCUMENT_EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
}

const MAX_DOCUMENT_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024

export const DOCUMENT_UPLOAD_VALIDATION_MESSAGE =
  "Only PDF, Word, Excel, plain text, CSV, image, or video files up to 50MB are allowed."

export function validateDocumentUploadFile(
  file: File
): { ok: true; mimeType: string } | { ok: false; message: string } {
  if (!file) {
    return { ok: false, message: "No file provided." }
  }

  if (file.size > MAX_DOCUMENT_UPLOAD_SIZE_BYTES) {
    return { ok: false, message: "File is too large. Maximum size is 50MB." }
  }

  let effectiveType = file.type
  if (!effectiveType || !ALLOWED_DOCUMENT_MIME_TYPES.has(effectiveType)) {
    const lower = file.name.toLowerCase()
    const ext = Object.keys(DOCUMENT_EXTENSION_TO_MIME).find((e) => lower.endsWith(e))
    if (ext) {
      effectiveType = DOCUMENT_EXTENSION_TO_MIME[ext]
    }
  }

  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(effectiveType)) {
    return { ok: false, message: DOCUMENT_UPLOAD_VALIDATION_MESSAGE }
  }

  return { ok: true, mimeType: effectiveType }
}

// Used when serving previously-uploaded files: never trust a stored/client-supplied
// content type directly (it may predate validation or have been set by an attacker),
// re-derive a safe Content-Type from the filename extension instead.
export function getSafeContentTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase()
  const ext = Object.keys(DOCUMENT_EXTENSION_TO_MIME).find((e) => lower.endsWith(e))
  return ext ? DOCUMENT_EXTENSION_TO_MIME[ext] : "application/octet-stream"
}

// Only image/* and PDF are safe to render inline in a browser tab; everything else
// (including HTML-adjacent or script-executable types) must be forced to download.
export function isSafeToRenderInline(contentType: string): boolean {
  return contentType.startsWith("image/") || contentType === "application/pdf"
}
