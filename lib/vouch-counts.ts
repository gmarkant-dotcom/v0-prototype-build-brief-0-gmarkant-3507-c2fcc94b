/**
 * Vouch counts, read as a projection rather than as a table scan.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `partner_vouches` currently carries a policy reading
 *
 *   "Anyone can count vouches"  SELECT  {public}  USING (true)
 *
 * A policy grants access to ROWS, never to an aggregate, so `USING (true)` for
 * role `public` hands the complete who-vouched-for-whom graph of the whole
 * platform to anyone holding the publishable anon key. Migration 082 closes
 * that. See supabase/migrations/082_partner_vouches_containment.sql.
 *
 * 082 phase 1 creates two SECURITY DEFINER functions that return the NUMBER
 * without granting row access:
 *
 *   partner_vouch_count(p_partner_id uuid)      -> bigint
 *   partner_vouch_counts(p_partner_ids uuid[])  -> (vendor_org_id, vouch_count)
 *
 * 082 phase 2 then drops the `USING (true)` policy. The STOP GATE in that file
 * exists because dropping the policy does not make a counting query FAIL - it
 * makes it return 0. PostgREST filters the rows out and reports the count of
 * what survived, which is nothing. Every vouch badge in the product would read
 * zero with no error, no log line and no 500, and a vendor with no vouches
 * looks exactly like a vendor whose count stopped working.
 *
 * THE ORDERING PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * This code ships to production on `main` and deploys immediately. 082 has not
 * been applied, so on the day this lands the two RPCs DO NOT EXIST. A bare
 * `supabase.rpc("partner_vouch_count", ...)` would fail against today's
 * database, which is exactly the failure the STOP GATE is trying to prevent,
 * only in the other direction.
 *
 * So both functions below try the RPC first and fall back to the direct table
 * read ONLY when PostgREST reports that the function is not in the schema
 * cache (error code PGRST202). That makes them correct in all three states:
 *
 *   before 082 phase 1   RPC absent  -> PGRST202 -> table read, permitted by
 *                        the `USING (true)` policy. Correct count.
 *   after phase 1,       RPC present -> RPC used. Correct count. The table is
 *   before phase 2       still readable but is no longer read.
 *   after phase 2        RPC present -> RPC used. Correct count. The fallback
 *                        cannot trigger, because phase 2 never drops the
 *                        functions phase 1 created.
 *
 * The fallback is narrow on purpose. Any other RPC error - a permission
 * failure, a network failure - is NOT swallowed into a table read; it returns
 * an empty count the same way the previous code did on a failed query, and it
 * logs. Falling back on a permission error is how a post-phase-2 silent zero
 * would get reintroduced.
 *
 * AFTER 082 PHASE 2 IS APPLIED AND VERIFIED, DELETE THE FALLBACK.
 * Both fallbacks are marked `082-FALLBACK` so they are greppable. Deleting
 * them is the last step of the 082 rollout and it is a two-function edit in
 * this one file, not a hunt across three call sites.
 *
 * 079 SEAM
 * ---------------------------------------------------------------------------
 * `partner_vouches.vendor_org_id` and `lead_org_id` are the post-079 names of the two
 * pre-079 vouched-partner / voucher-agency columns. The fallback query below names
 * the old column and is marked "079:" at the site. The RPC parameter names do
 * not change; what changes is that the id passed becomes an organization id
 * rather than a profile id.
 */

/**
 * Shape shared by the browser and server Supabase clients, narrowed to what is used
 * here. Deliberately loose: naming the real builder types drags the full generated
 * PostgREST type graph in and tsc reports TS2589, "type instantiation is excessively
 * deep". These two functions read a count and nothing else, so the loose shape costs
 * no real safety - and the repository has no generated `Database` types for the
 * strict version to have checked against anyway (docs/079-rename-plan.md, "The one
 * thing to read before anything else").
 */
type PostgrestErrorish = { code?: string; message?: string } | null

type VouchCapableClient = {
  rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestErrorish }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

/**
 * PostgREST's "function not found in the schema cache" code. This is the one and
 * only condition under which the pre-082 table read is still the right answer.
 */
const FUNCTION_NOT_FOUND = "PGRST202"

function isFunctionMissing(error: PostgrestErrorish): boolean {
  if (!error) return false
  if (error.code === FUNCTION_NOT_FOUND) return true
  // Some PostgREST versions surface the same condition without the code set.
  return typeof error.message === "string" && /Could not find the function/i.test(error.message)
}

/**
 * Vouch count for one vendor. Returns 0 rather than throwing, which is what all
 * three previous call sites did.
 */
export async function fetchVouchCount(supabase: VouchCapableClient, partnerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("partner_vouch_count", { p_partner_id: partnerId })

  if (!error) {
    const n = typeof data === "number" ? data : Number(data)
    return Number.isFinite(n) ? n : 0
  }

  if (!isFunctionMissing(error)) {
    console.error("[vouch-counts] partner_vouch_count failed", { code: error.code, message: error.message })
    return 0
  }

  // 082-FALLBACK: the RPC does not exist yet, so 082 phase 1 has not been applied
  // and the `USING (true)` policy is still in place. Delete this block once phase 2
  // is applied and verified.
  // 079: this names partner_vouches.vendor_org_id - the pre-079 vouched-partner column -
  // and the id passed is an organization id rather than a profile id.
  const { count, error: tableError } = (await supabase
    .from("partner_vouches")
    .select("*", { count: "exact", head: true })
    .eq("vendor_org_id", partnerId)) as { count: number | null; error: PostgrestErrorish }
  if (tableError) {
    console.error("[vouch-counts] partner_vouches count fallback failed", {
      code: tableError.code,
      message: tableError.message,
    })
    return 0
  }
  return count ?? 0
}

/**
 * Vouch counts for a set of vendors, as a map. Vendors with no vouches are absent
 * from the map; every caller reads a missing key as 0.
 */
export async function fetchVouchCounts(
  supabase: VouchCapableClient,
  partnerIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (partnerIds.length === 0) return counts

  const { data, error } = await supabase.rpc("partner_vouch_counts", { p_partner_ids: partnerIds })

  if (!error) {
    // 079-DEPENDENCY: this reads `vendor_org_id` off the RPC result, which means the
    // 082 function must have been RECREATED after 079. As authored, partner_vouch_counts()
    // declares its returned column under the PRE-079 vouched-partner name, not this one.
    // Re-running 082 phase 1 after 079 is a required step of the release runbook.
    // If it is skipped, every key here is undefined and every count reads 0, silently.
    for (const row of (data as Array<{ vendor_org_id?: string; vouch_count?: number | string }> | null) ?? []) {
      const pid = row?.vendor_org_id
      if (!pid) continue
      const n = Number(row.vouch_count)
      counts.set(pid, Number.isFinite(n) ? n : 0)
    }
    return counts
  }

  if (!isFunctionMissing(error)) {
    console.error("[vouch-counts] partner_vouch_counts failed", { code: error.code, message: error.message })
    return counts
  }

  // 082-FALLBACK: see fetchVouchCount above. Delete once 082 phase 2 is applied.
  // 079: this names partner_vouches.vendor_org_id - the pre-079 vouched-partner column -
  // and the id passed is an organization id rather than a profile id.
  const { data: rows, error: tableError } = (await supabase
    .from("partner_vouches")
    .select("vendor_org_id")
    .in("vendor_org_id", partnerIds)) as {
    data: Array<{ vendor_org_id?: string }> | null
    error: PostgrestErrorish
  }
  if (tableError) {
    console.error("[vouch-counts] partner_vouches rows fallback failed", {
      code: tableError.code,
      message: tableError.message,
    })
    return counts
  }
  for (const row of rows ?? []) {
    const pid = row?.vendor_org_id
    if (!pid) continue
    counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }
  return counts
}
