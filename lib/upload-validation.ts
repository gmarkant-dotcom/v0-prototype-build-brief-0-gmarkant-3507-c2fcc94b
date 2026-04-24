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
