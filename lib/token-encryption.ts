import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

// AES-256-GCM. Every OAuth token stored in email_connections goes through encrypt()/
// decrypt() - never store or read access_token/refresh_token as plaintext.
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12

let cachedKey: Buffer | null = null

// Lazy rather than module-top-level: a top-level throw would crash `next build`/tsc in
// any environment where TOKEN_ENCRYPTION_KEY isn't set (e.g. CI), not just runtime. This
// still throws loudly - and still never falls back to plaintext - the moment encrypt()
// or decrypt() is actually called without a valid key.
function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Refusing to encrypt/decrypt tokens - there is no plaintext fallback."
    )
  }
  const key = Buffer.from(hex, "hex")
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters); decoded to ${key.length} bytes.`
    )
  }
  cachedKey = key
  return cachedKey
}

/** Encrypts plaintext, returning "iv:authTag:ciphertext" with each part base64 encoded. */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":")
}

/** Decrypts a string produced by encrypt(). Throws if the format or auth tag is invalid. */
export function decrypt(packed: string): string {
  const key = getKey()
  const parts = packed.split(":")
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token: expected iv:authTag:ciphertext")
  }
  const [ivB64, authTagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, "base64")
  const authTag = Buffer.from(authTagB64, "base64")
  const data = Buffer.from(dataB64, "base64")
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  return plaintext.toString("utf8")
}
