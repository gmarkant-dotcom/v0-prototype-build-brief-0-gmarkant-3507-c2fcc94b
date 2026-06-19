#!/usr/bin/env node
// scripts/verify-rls.mjs
//
// Audits every RLS-enabled table in the public schema and warns if any
// has zero policies attached. The "RLS enabled, zero policies" state causes
// a silent total lockout: all reads and writes return 403/permission-denied.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=service_role_... \
//   node scripts/verify-rls.mjs
//
// Or via npm: npm run verify-rls (after adding the env vars to .env.local)
//
// Exit code 0 = all tables OK
// Exit code 1 = one or more tables have RLS enabled with no policies (blocked state)
// Exit code 2 = could not connect

import { createClient } from "@supabase/supabase-js"

const url   = process.env.NEXT_PUBLIC_SUPABASE_URL
const key   = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
  process.exit(2)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

// Supabase exposes pg_catalog through PostgREST when using the service role key.
// pg_class contains relrowsecurity (RLS enabled flag) for each table.
// pg_policy contains one row per policy. We join them to find tables with 0 policies.

// Step 1: get all public-schema tables with RLS enabled
const { data: rlsTables, error: e1 } = await supabase
  .from("pg_class")
  .select("oid, relname, relrowsecurity")
  .eq("relrowsecurity", true)
  .returns()
  .catch(() => ({ data: null, error: new Error("pg_class not accessible") }))

if (e1 || !rlsTables) {
  // pg_class might not be directly exposed. Fall back to information_schema + a known view.
  console.log("Could not access pg_class directly. Trying information_schema approach...")
  
  // Use the Supabase management SQL endpoint if SUPABASE_ACCESS_TOKEN is available
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = url.replace(/^https?:\/\//, "").replace(".supabase.co", "").split(".")[0]
  
  if (accessToken) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({
        query: `
          SELECT c.relname AS table_name, COUNT(p.polname)::int AS policy_count
          FROM pg_class c
          JOIN pg_namespace n ON c.relnamespace = n.oid
          LEFT JOIN pg_policy p ON p.polrelid = c.oid
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          GROUP BY c.relname ORDER BY c.relname`
      }),
    })
    if (res.ok) {
      const rows = await res.json()
      printResults(rows.map(r => ({ table_name: r.table_name, policy_count: parseInt(r.policy_count, 10) })))
      process.exit(0)
    }
  }

  console.error("ERROR: Cannot query pg_class. Provide SUPABASE_ACCESS_TOKEN for management API access.")
  console.error("       Get one at: https://supabase.com/dashboard/account/tokens")
  process.exit(2)
}

// Step 2: filter to public schema only (relnamespace = public oid)
// First get the oid for public namespace
const { data: ns } = await supabase
  .from("pg_namespace")
  .select("oid")
  .eq("nspname", "public")
  .maybeSingle()

const publicOid = ns?.oid
const publicTables = publicOid
  ? rlsTables.filter(t => t.relnamespace === publicOid)
  : rlsTables // fallback: include all

// Step 3: for each RLS-enabled table, count its policies
const tableNames = publicTables.map(t => t.relname)
const oids = publicTables.map(t => t.oid)

const { data: policies } = await supabase
  .from("pg_policy")
  .select("polrelid, polname")
  .in("polrelid", oids)

const policyCounts = new Map()
for (const p of policies ?? []) {
  policyCounts.set(p.polrelid, (policyCounts.get(p.polrelid) ?? 0) + 1)
}

const results = publicTables.map(t => ({
  table_name: t.relname,
  policy_count: policyCounts.get(t.oid) ?? 0,
})).sort((a, b) => a.table_name.localeCompare(b.table_name))

printResults(results)

function printResults(rows) {
  let failed = false
  console.log("\nRLS policy audit - public schema tables with RLS enabled:\n")
  console.log("  Table                                  Policies")
  console.log("  " + "-".repeat(55))
  for (const { table_name, policy_count } of rows) {
    const name = table_name.padEnd(38)
    if (policy_count === 0) {
      console.log(`  ${name} WARNING: 0 policies -- LOCKED OUT`)
      failed = true
    } else {
      console.log(`  ${name} ${policy_count} policy${policy_count !== 1 ? "ies" : "y"}`)
    }
  }
  if (rows.length === 0) console.log("  (no tables with RLS enabled found)")
  console.log()
  if (failed) {
    console.error("FAIL: Tables with RLS enabled and zero policies will block ALL access.")
    console.error("      Add at least one policy or run: ALTER TABLE <name> DISABLE ROW LEVEL SECURITY;")
    process.exit(1)
  } else {
    console.log("PASS: All RLS-enabled tables have at least one policy.")
  }
}
