import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * Does this email already belong to a Ligament account?
 *
 * Why this cannot use the caller's session client. Per docs/schema-snapshot-2026-08-13.md,
 * profiles carries four SELECT policies and an agency can read a profile row only when it is
 * their own, when is_discoverable is true, or when a partnership already links the two
 * accounts. Inviting someone is by definition the case where no partnership exists yet, so a
 * session-scoped lookup of an invitee returns null for every vendor who has an account but
 * has not made themselves discoverable. The invitation flows read that null as "no account"
 * and send signup copy to someone who already has a login.
 *
 * The service role is used for exactly one boolean and nothing else. No row, no id and no
 * profile field is returned to any caller, so this cannot become a way to read profiles the
 * caller is not entitled to see. Callers must already be authenticated and authorized; the
 * boolean only ever selects which email copy to send, and is never echoed in a response,
 * because "is this address registered" is not something to hand back to a caller who could
 * enumerate it.
 */
export async function hasLigamentAccount(email: string): Promise<boolean> {
  const normalized = email.trim()
  if (!normalized) return false

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    // Fail closed to the signup-flavored copy rather than throwing. A misconfigured
    // environment should not take down an invitation send.
    console.error("[account-existence] service role not configured; assuming no account")
    return false
  }

  const service = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await service.from("profiles").select("id").ilike("email", normalized).maybeSingle()

  if (error) {
    console.error("[account-existence] lookup failed", error.message)
    return false
  }
  return Boolean(data?.id)
}
