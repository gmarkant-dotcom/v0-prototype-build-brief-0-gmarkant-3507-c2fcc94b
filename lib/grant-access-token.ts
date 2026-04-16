import { createHmac, timingSafeEqual } from "node:crypto"

const MAX_TOKEN_AGE_SECONDS = 60 * 60 * 24

function getSecret(): string {
  const secret = process.env.GRANT_ACCESS_SECRET
  if (!secret) {
    throw new Error("GRANT_ACCESS_SECRET is not configured")
  }
  return secret
}

function signGrantAccessPayload(userId: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${userId}:${timestamp}`).digest("hex")
}

export function generateGrantAccessToken(userId: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const normalizedUserId = userId.trim()
  const secret = getSecret()
  const signature = signGrantAccessPayload(normalizedUserId, timestamp, secret)
  return `${timestamp}.${signature}`
}

export function verifyGrantAccessToken(userId: string, token: string): boolean {
  const normalizedUserId = userId.trim()
  const normalizedToken = token.trim()
  const [timestampPart, signaturePart] = normalizedToken.split(".")

  if (!normalizedUserId || !timestampPart || !signaturePart) {
    return false
  }

  const timestamp = Number(timestampPart)
  if (!Number.isFinite(timestamp)) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  if (timestamp > now || now - timestamp > MAX_TOKEN_AGE_SECONDS) {
    return false
  }

  const secret = getSecret()
  const expectedSignature = signGrantAccessPayload(normalizedUserId, timestamp, secret)

  const expectedBuffer = Buffer.from(expectedSignature, "hex")
  const providedBuffer = Buffer.from(signaturePart, "hex")

  if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}
