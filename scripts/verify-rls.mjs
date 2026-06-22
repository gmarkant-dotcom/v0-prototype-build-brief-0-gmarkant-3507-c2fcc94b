#!/usr/bin/env node
// scripts/verify-rls.mjs
//
// Audits every RLS-enabled table in the public schema and warns if any
// has zero policies attached. The "RLS enabled, zero policies" state causes
// a silent total lockout: all reads and writes return 403/permission-denied.
//
// Usage: npm run verify-rls
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
// (also accepts them as shell env vars - shell env takes precedence).
//
// Exit 0: all tables OK
// Exit 1: one or more tables have RLS enabled with zero policies
// Exit 2: could not connect / missing env vars

import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

console.log("verify-rls starting...")

// Load .env.local manually - no dotenv package required, no @next/env quirks
const envPath = resolve(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n")
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 1) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    // Only set if not already in environment (shell env takes precedence)
    if (!process.env[k]) process.env[k] = v
  }
  console.log("  loaded .env.local from", envPath)
} else {
  console.log("  no .env.local found at", envPath, "-- using shell env vars")
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log("  SUPABASE_URL:", url ?? "(not set)")
console.log("  SERVICE_ROLE_KEY:", key ? key.slice(0, 12) + "..." : "(not set)")
console.log()

if (!url || !key) {
  console.log("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
  console.log("       Add them to .env.local in the project root.")
  process.exit(2)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// Query all public-schema tables that have RLS enabled, joined with their policy count.
// We use the Supabase REST API with the service role key, which can read pg_catalog.
// Supabase exposes pg_class and pg_policy via PostgREST under the service role.

console.log("Querying pg_class for RLS-enabled tables...")
const { data: rlsTables, error: classErr } = await supabase
  .from("pg_class")
  .select("oid, relname, relnamespace, relrowsecurity")
  .eq("relrowsecurity", true)

if (classErr) {
  console.log("  pg_class query error:", classErr.message)
  console.log("  (pg_class may not be accessible via PostgREST on this project)")
  console.log()
  console.log("ALTERNATIVE: Run this SQL in your Supabase SQL Editor instead:")
  console.log()
  console.log("  SELECT c.relname AS table_name,")
  console.log("         COUNT(p.polname)::int AS policy_count")
  console.log("  FROM pg_class c")
  console.log("  JOIN pg_namespace n ON c.relnamespace = n.oid")
  console.log("  LEFT JOIN pg_policy p ON p.polrelid = c.oid")
  console.log("  WHERE n.nspname = 'public'")
  console.log("    AND c.relkind = 'r'")
  console.log("    AND c.relrowsecurity = true")
  console.log("  GROUP BY c.relname")
  console.log("  ORDER BY c.relname;")
  console.log()
  console.log("Any row with policy_count = 0 is locked out.")
  process.exit(2)
}

console.log("  found", rlsTables?.length ?? 0, "RLS-enabled tables total")

// Filter to public schema (nspname = 'public')
console.log("Querying pg_namespace for public schema OID...")
const { data: ns } = await supabase
  .from("pg_namespace")
  .select("oid")
  .eq("nspname", "public")
  .maybeSingle()

if (!ns) {
  console.log("  WARNING: could not determine public schema OID, showing all RLS tables")
}

const publicOid = ns?.oid
const publicTables = (rlsTables ?? []).filter(t =>
  publicOid ? t.relnamespace === publicOid : true
)

console.log("  public schema tables with RLS:", publicTables.length)

if (publicTables.length === 0) {
  console.log()
  console.log("No public-schema tables with RLS enabled found.")
  console.log("PASS: Nothing to audit.")
  process.exit(0)
}

// Count policies per table
const oids = publicTables.map(t => t.oid)
console.log("Querying pg_policy for policy counts...")
const { data: policies, error: policyErr } = await supabase
  .from("pg_policy")
  .select("polrelid, polname")
  .in("polrelid", oids)

if (policyErr) {
  console.log("  pg_policy query error:", policyErr.message)
}

const policyCounts = new Map()
for (const p of policies ?? []) {
  policyCounts.set(p.polrelid, (policyCounts.get(p.polrelid) ?? 0) + 1)
}

const results = publicTables
  .map(t => ({ table_name: t.relname, policy_count: policyCounts.get(t.oid) ?? 0 }))
  .sort((a, b) => a.table_name.localeCompare(b.table_name))

// Print results
let failed = false
console.log()
console.log("RLS policy audit - public schema tables with RLS enabled:")
console.log()
console.log("  Table                                  Policies")
console.log("  " + "-".repeat(55))

for (const { table_name, policy_count } of results) {
  const name = table_name.padEnd(38)
  if (policy_count === 0) {
    console.log(`  ${name} WARNING: 0 policies -- LOCKED OUT`)
    failed = true
  } else {
    console.log(`  ${name} ${policy_count} policy${policy_count !== 1 ? "ies" : "y"}`)
  }
}

console.log()

if (failed) {
  console.log("FAIL: One or more tables have RLS enabled with no policies.")
  console.log("      These tables will return 403 for all reads and writes.")
  console.log("      Add at least one policy, or run: ALTER TABLE <name> DISABLE ROW LEVEL SECURITY;")
  process.exit(1)
} else {
  console.log("PASS: All RLS-enabled tables have at least one policy.")
  process.exit(0)
}
