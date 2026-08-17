#!/usr/bin/env node
/**
 * The rename safety net the TypeScript compiler cannot be.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migration 079 renames agency_id and partner_id to organization columns. The Supabase
 * clients in this repository are constructed WITHOUT generated Database types
 * (lib/supabase/client.ts, lib/supabase/server.ts), so `.eq("agency_id", user.id)` is a
 * plain string argument and `row.agency_id` is a property on an untyped record.
 * `npx tsc --noEmit` exits 0 whether the column exists or not. See
 * docs/079-rename-plan.md, "The one thing to read before anything else".
 *
 * This script is the replacement for the compile-time check that does not exist. It is
 * built BEFORE the rename, so the rename run can prove completeness rather than assert it.
 *
 * TWO MODES
 * ---------
 *   node scripts/check-identity-columns.mjs            inventory. Prints every occurrence
 *                                                      grouped by target name. Always exits 0.
 *   node scripts/check-identity-columns.mjs --guard    guard. Exits 1 if ANY occurrence
 *                                                      remains. This is the definition of
 *                                                      done for the rename commit.
 *
 * Flags: --guard, --quiet (counts only), --json (machine-readable, implies --quiet)
 *
 * IT IS SUPPOSED TO FAIL TODAY. Every occurrence in the tree right now is correct, because
 * 079 has not been applied. Guard mode is therefore NOT wired into the build - a failing
 * guard must not block a deploy until the day the rename ships.
 *
 * RESOLUTION HEURISTIC
 * --------------------
 * Each hit is attributed to a table by, in order:
 *   1. an explicit `table.column` qualification,
 *   2. a PostgREST embedded selector such as `partnerships!inner(partner_id)`,
 *   3. the nearest preceding `.from("...")` in the same file.
 * The third is a heuristic and it is wrong wherever a query joins across tables, which is
 * why the fourth group - "needs a human read" - exists and is never empty. That group is
 * not a failure of the scan; it is the shape of the problem. A comment that still says
 * partner_id is how the next person reintroduces the bug, and a local type whose field is
 * partner_id silently reads undefined off a row that now carries vendor_org_id.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname)

/** Scan roots. Matches the census in docs/079-rename-plan.md so the counts are comparable. */
const ROOTS = ["app", "lib", "components", "contexts", "hooks", "middleware.ts"]
const EXTENSIONS = [".ts", ".tsx"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"])

/** The legacy company identity column names 079 renames. */
const LEGACY = ["agency_id", "partner_id", "voucher_agency_id", "vouched_partner_id"]
const LEGACY_RE = new RegExp(`\\b(${LEGACY.join("|")})\\b`, "g")

/**
 * The table map, transcribed from docs/079-rename-plan.md, "The naming rule, and the table
 * map". A table with exactly one company column gets org_id. A table with two gets
 * lead_org_id and vendor_org_id, because org_id there would not say which side.
 */
const ORG_ID_TABLES = new Set([
  "agency_library_documents",
  "bid_comparisons",
  "bid_decompositions",
  "bid_evaluations",
  "bid_scoring_criteria",
  "bid_scoring_templates",
  "client_cash_flow",
  "clients",
  "delivery_reviews",
  "msa_agreements",
  "onboarding_deployments",
  "onboarding_packages",
  "projects",
  "rfp_magic_tokens",
  "usage_tracking",
])

const TWO_COLUMN_TABLES = new Set([
  "agency_partner_invitations",
  "partner_access_requests",
  "partner_rfp_inbox",
  "partner_rfp_response_versions",
  "partner_rfp_responses",
  "partnerships",
  "partner_vouches",
])

/** invitation_requests carries partner_id and agency_email, so it has one company id column. */
const VENDOR_ONLY_TABLES = new Set(["invitation_requests"])

const ALL_TABLES = new Set([...ORG_ID_TABLES, ...TWO_COLUMN_TABLES, ...VENDOR_ONLY_TABLES])

const BUCKETS = ["org_id", "lead_org_id", "vendor_org_id", "needs-human-read"]

/** Resolve (table, legacy column) to the post-079 column name, or null when it cannot. */
function targetColumn(table, column) {
  if (!table) return null
  if (ORG_ID_TABLES.has(table)) {
    return column === "agency_id" ? "org_id" : null
  }
  if (TWO_COLUMN_TABLES.has(table)) {
    if (column === "agency_id" || column === "voucher_agency_id") return "lead_org_id"
    if (column === "partner_id" || column === "vouched_partner_id") return "vendor_org_id"
    return null
  }
  if (VENDOR_ONLY_TABLES.has(table)) {
    return column === "partner_id" ? "vendor_org_id" : null
  }
  return null
}

function walk(path, out) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return
  }
  if (stat.isFile()) {
    if (EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path)
    return
  }
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue
    walk(join(path, entry), out)
  }
}

/** True when the line is a comment line or sits inside a block comment. */
function isCommentLine(line, insideBlockComment) {
  const trimmed = line.trim()
  return insideBlockComment || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
}

/**
 * Attribution, in the documented order. Returns { table, via } or { table: null, via }.
 */
function attribute(line, column, index, nearestFrom) {
  // 1. Explicit table.column qualification, e.g. "partnerships.agency_id".
  const qualified = new RegExp(`\\b([a-z_][a-z0-9_]*)\\.${column}\\b`, "i")
  const qm = line.match(qualified)
  if (qm && ALL_TABLES.has(qm[1])) return { table: qm[1], via: "qualified" }

  // 2. PostgREST embedded selector, e.g. partnerships!inner(partner_id) or
  //    partner:profiles!partnerships_partner_id_fkey(...). Only the leading table name of
  //    an embed whose parenthesised body contains this column counts.
  const embedRe = /\b([a-z_][a-z0-9_]*)(?:!\w+)?\s*\(([^()]*)\)/gi
  let em
  while ((em = embedRe.exec(line)) !== null) {
    const [, table, body] = em
    if (!ALL_TABLES.has(table)) continue
    if (!new RegExp(`\\b${column}\\b`).test(body)) continue
    // Only attribute the occurrence that actually sits inside the embed body.
    const bodyStart = em.index + em[0].indexOf("(") + 1
    if (index >= bodyStart && index < bodyStart + body.length) {
      return { table, via: "embed" }
    }
  }

  // 3. Nearest preceding .from("...") in the same file.
  if (nearestFrom) return { table: nearestFrom, via: "nearest .from()" }

  return { table: null, via: "no .from() context" }
}

function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath)
  const text = readFileSync(absPath, "utf8")
  const lines = text.split("\n")
  const hits = []

  let nearestFrom = null
  let insideBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const comment = isCommentLine(line, insideBlockComment)
    // Crude but sufficient block-comment tracking: this repo has no block comments that
    // open and close mid-expression around an identity column.
    if (!insideBlockComment && /\/\*/.test(line) && !/\*\//.test(line)) insideBlockComment = true
    else if (insideBlockComment && /\*\//.test(line)) insideBlockComment = false

    // Track the nearest .from("table") above this line. Comments do not set it.
    if (!comment) {
      const fromMatches = [...line.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/gi)]
      if (fromMatches.length > 0) nearestFrom = fromMatches[fromMatches.length - 1][1]
    }

    LEGACY_RE.lastIndex = 0
    let m
    while ((m = LEGACY_RE.exec(line)) !== null) {
      const column = m[1]
      const { table, via } = comment
        ? { table: null, via: "comment" }
        : attribute(line, column, m.index, nearestFrom)
      const target = comment ? null : targetColumn(table, column)
      hits.push({
        file: rel,
        line: i + 1,
        column,
        table,
        via: comment ? "comment" : via,
        target,
        bucket: target ?? "needs-human-read",
        text: line.trim(),
      })
    }
  }

  return hits
}

function main() {
  const argv = process.argv.slice(2)
  const guard = argv.includes("--guard")
  const json = argv.includes("--json")
  const quiet = argv.includes("--quiet") || json

  const files = []
  for (const root of ROOTS) walk(join(REPO_ROOT, root), files)
  files.sort()

  const hits = files.flatMap(scanFile)

  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, []]))
  for (const hit of hits) byBucket[hit.bucket].push(hit)

  const touchedFiles = new Set(hits.map((h) => h.file))

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          total: hits.length,
          files: touchedFiles.size,
          byBucket: Object.fromEntries(BUCKETS.map((b) => [b, byBucket[b].length])),
          hits,
        },
        null,
        2
      ) + "\n"
    )
  } else {
    console.log("Legacy company identity columns in application source")
    console.log(`Roots: ${ROOTS.join(", ")}`)
    console.log(`Scanned ${files.length} files.`)
    console.log("")

    if (!quiet) {
      for (const bucket of BUCKETS) {
        const group = byBucket[bucket]
        if (group.length === 0) continue
        const label =
          bucket === "needs-human-read"
            ? "NEEDS A HUMAN READ - no table resolved, a comment, or a joined/embedded value"
            : `becomes ${bucket}`
        console.log(`--- ${label}  (${group.length} references in ${new Set(group.map((h) => h.file)).size} files)`)
        let lastFile = null
        for (const hit of group) {
          if (hit.file !== lastFile) {
            console.log(`  ${hit.file}`)
            lastFile = hit.file
          }
          const table = hit.table ? hit.table : "-"
          console.log(`    ${String(hit.line).padStart(5)}  ${hit.column.padEnd(20)} ${table.padEnd(30)} ${hit.via}`)
        }
        console.log("")
      }
    }

    console.log("Summary")
    for (const bucket of BUCKETS) {
      console.log(`  ${bucket.padEnd(18)} ${String(byBucket[bucket].length).padStart(5)}`)
    }
    console.log(`  ${"TOTAL".padEnd(18)} ${String(hits.length).padStart(5)}  in ${touchedFiles.size} files`)
    console.log("")
  }

  if (guard) {
    if (hits.length > 0) {
      if (!json) {
        console.error("GUARD FAILED. 079 renamed these:")
        console.error("  agency_id         -> org_id, or lead_org_id on a two-column table")
        console.error("  partner_id        -> vendor_org_id")
        console.error("  voucher_agency_id -> lead_org_id")
        console.error("  vouched_partner_id-> vendor_org_id")
        console.error(`${hits.length} occurrence(s) remain in ${touchedFiles.size} file(s).`)
        console.error("")
        console.error("If 079 has NOT shipped yet, this failure is expected and correct.")
      }
      process.exit(1)
    }
    if (!json) console.log("GUARD PASSED. No legacy company identity column names in application source.")
  }
}

main()
