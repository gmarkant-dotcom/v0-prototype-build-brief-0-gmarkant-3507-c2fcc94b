const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
])

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024

export const UPLOAD_VALIDATION_MESSAGE =
  "Only PDF, DOCX, or PPTX files up to 20MB are allowed."

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
    const ext = [".pdf", ".docx", ".pptx"].find((e) => lower.endsWith(e))
    if (ext && EXTENSION_TO_MIME[ext]) {
      effectiveType = EXTENSION_TO_MIME[ext]
    }
  }

  if (!ALLOWED_UPLOAD_MIME_TYPES.has(effectiveType)) {
    return { ok: false, message: UPLOAD_VALIDATION_MESSAGE }
  }

  return { ok: true }
}
