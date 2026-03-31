const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
])

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

  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    return { ok: false, message: UPLOAD_VALIDATION_MESSAGE }
  }

  return { ok: true }
}
