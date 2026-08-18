#!/usr/bin/env node
/**
 * The blind spot in scripts/check-identity-columns.mjs, closed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The identity-column guard matches `\bagency_id\b` and `\bpartner_id\b`. A PostgREST
 * embed does not name the column - it names the FOREIGN KEY CONSTRAINT:
 *
 *     partner:profiles!partnerships_partner_id_fkey(id, email, full_name, company_name)
 *
 * There is a `_` in front of `partner_id`, so there is no word boundary, so the guard
 * never matched it. Thirteen embeds traversing foreign keys that 079 repoints at
 * `organizations` were invisible to a guard that reported the rename complete. Twelve
 * carried a constraint name; the thirteenth, app/agency/pool/page.tsx, had been
 * half-renamed to `profiles!vendor_org_id` - the COLUMN-name hint form - which made it
 * look modern while pointing at exactly the wrong table.
 *
 * WHAT THIS CHECKS
 * ----------------
 * Every PostgREST embed hint in application source, against the list of (table, column)
 * pairs migration 079 PHASE 7 repoints. That list is PARSED OUT OF THE MIGRATION rather
 * than transcribed, so the check cannot drift from the migration it is checking.
 *
 * An embed is FLAGGED when either holds:
 *
 *   REPOINTED   the hint names a repointed column - by its post-079 name (org_id,
 *               lead_org_id, vendor_org_id) or by the pre-079 name a constraint name
 *               still carries (agency_id, partner_id, voucher_agency_id,
 *               vouched_partner_id) - and the embedded table is NOT `organizations`.
 *               After 079 that foreign key reaches organizations and nothing else, so any
 *               other target is either a constraint that no longer exists or a table the
 *               key does not lead to.
 *
 *   PERSON      the embedded table is `profiles` or `auth.users` and the hint is not one
 *               of the known person-valued foreign keys below. A company id must never
 *               reach profiles again; see the `organizations` table comment in 079.
 *
 * WHAT IT CANNOT DO, STATED PLAINLY
 * ---------------------------------
 * This is a lexical check over source text, not a schema check. It reads embed hints; it
 * does not read pg_constraint, so it cannot tell you that a constraint name is misspelled,
 * that a table has an extra foreign key on the same column, or that a hint resolves
 * ambiguously. It also cannot see an embed built by string concatenation at run time.
 *
 * A HUMAN MUST STILL INSPECT, after 079 is applied:
 *   1. Every `.select()` that embeds `organizations`: does the CALLER pass the
 *      organizations SELECT policy for the row it is embedding? A row filtered by row
 *      level security comes back as null, not as an error, so this check going green
 *      proves the query is well-formed and proves nothing about whether it returns data.
 *      That is the security matrix in docs/079-embed-closure-report.md and it is the one
 *      thing no script here can answer.
 *   2. Every embed whose target is reached with NO hint at all. Those resolve by whatever
 *      single foreign key exists; add a second one and the query starts erroring.
 *
 * MODES
 * -----
 *   node scripts/check-embed-targets.mjs             inventory. Always exits 0.
 *   node scripts/check-embed-targets.mjs --guard     exits 1 if anything is flagged.
 *   --json      machine-readable
 *   --root DIR  scan a different checkout (used to prove the check against the
 *               pre-fix tree)
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const guard = argv.includes("--guard")
const json = argv.includes("--json")
const rootFlag = argv.indexOf("--root")
const REPO_ROOT =
  rootFlag !== -1 && argv[rootFlag + 1]
    ? resolve(argv[rootFlag + 1])
    : resolve(new URL("..", import.meta.url).pathname)

const ROOTS = ["app", "lib", "components", "contexts", "hooks", "middleware.ts"]
const EXTENSIONS = [".ts", ".tsx"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"])

const MIGRATION = join(REPO_ROOT, "supabase/migrations/079_organizations.sql")

/**
 * The pre-079 names. Constraint names are minted at CREATE time and keep the column name
 * they were created with, so a repointed key is still called `..._partner_id_fkey` long
 * after the column is called vendor_org_id. That mismatch IS the blind spot.
 */
const LEGACY_COLUMNS = ["agency_id", "partner_id", "voucher_agency_id", "vouched_partner_id"]

/**
 * Foreign keys that legitimately point at a PERSON and are not touched by 079. Anything
 * else embedding profiles is a finding, not an exception. Keep this list short: every
 * entry is a promise that the column holds a user id and always will.
 */
const PERSON_FOREIGN_KEYS = new Set([
  "project_messages_sender_id_fkey", // sender_id is a user id. Explicitly out of 079's scope.
  "sender_id",
  "primary_contact_user_id", // organizations -> profiles. Added by 079 for these embeds.
  "user_id",
  "uploaded_by",
  "invited_by",
])

/** Parse the (table, column) pairs migration 079 PHASE 7 repoints at organizations. */
function repointedColumns() {
  let sql
  try {
    sql = readFileSync(MIGRATION, "utf8")
  } catch {
    console.error(`Cannot read ${MIGRATION}. This check derives its truth from that file.`)
    process.exit(2)
  }
  const start = sql.indexOf("DO $repoint$")
  const end = sql.indexOf("$repoint$;")
  if (start === -1 || end === -1) {
    console.error("Could not find the PHASE 7 repoint block in 079_organizations.sql.")
    console.error("The migration changed shape. Fix this parser rather than trusting a green run.")
    process.exit(2)
  }
  const block = sql.slice(start, end)
  const pairs = [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)]
  if (pairs.length === 0) {
    console.error("PHASE 7 parsed to zero repointed columns. Refusing to report a clean tree.")
    process.exit(2)
  }
  return {
    tables: new Set(pairs.map((p) => p[1])),
    columns: new Set(pairs.map((p) => p[2])),
    pairCount: pairs.length,
  }
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

/**
 * Blank out comment bodies, preserving line and column positions so reported line numbers
 * stay true. Without this the check flags its own explanatory comments, which quote the
 * broken embeds verbatim, and a check that flags its own documentation is a check nobody
 * runs twice.
 */
function stripComments(text) {
  const out = text.split("")
  let i = 0
  let state = "code" // code | line | block | single | double | back
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (state === "code") {
      if (c === "/" && n === "/") {
        state = "line"
        out[i] = " "
        out[i + 1] = " "
        i += 2
        continue
      }
      if (c === "/" && n === "*") {
        state = "block"
        out[i] = " "
        out[i + 1] = " "
        i += 2
        continue
      }
      if (c === "'") state = "single"
      else if (c === '"') state = "double"
      else if (c === "`") state = "back"
      i++
      continue
    }
    if (state === "line") {
      if (c === "\n") state = "code"
      else out[i] = " "
      i++
      continue
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        out[i] = " "
        out[i + 1] = " "
        state = "code"
        i += 2
        continue
      }
      if (c !== "\n") out[i] = " "
      i++
      continue
    }
    // Inside a string literal. Template literals are where the embeds actually live, so
    // they are scanned, not skipped; only the comment states blank anything out.
    if (c === "\\") {
      i += 2
      continue
    }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "back" && c === "`")) {
      state = "code"
    }
    i++
  }
  return out.join("")
}

/** Every `table!hint` embed hint in the source, with its position. */
const EMBED_RE = /\b([a-z_][a-z0-9_]*)\s*!\s*([a-z_][a-z0-9_]*)\s*\(/gi

function mentionsColumn(hint, column) {
  // Token-aware containment: `partnership_id` must NOT match `partner_id`, and
  // `partnerships_partner_id_fkey` must. Anchor on the column bounded by `_` or an end.
  return new RegExp(`(^|_)${column}($|_)`).test(hint)
}

function scanFile(absPath, repointed) {
  const rel = relative(REPO_ROOT, absPath)
  const raw = readFileSync(absPath, "utf8")
  const text = stripComments(raw)
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1)
  const lineOf = (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const findings = []
  EMBED_RE.lastIndex = 0
  let m
  while ((m = EMBED_RE.exec(text)) !== null) {
    const [, table, hint] = m
    if (hint === "inner" || hint === "left") continue

    const namesRepointed =
      [...repointed.columns].some((c) => mentionsColumn(hint, c)) ||
      LEGACY_COLUMNS.some((c) => mentionsColumn(hint, c))

    if (namesRepointed && table !== "organizations") {
      findings.push({
        file: rel,
        line: lineOf(m.index),
        kind: "REPOINTED",
        table,
        hint,
        why: `this foreign key points at organizations after 079, not at ${table}`,
      })
      continue
    }

    if ((table === "profiles" || table === "users") && !PERSON_FOREIGN_KEYS.has(hint)) {
      findings.push({
        file: rel,
        line: lineOf(m.index),
        kind: "PERSON",
        table,
        hint,
        why: "embeds profiles through a foreign key not known to hold a user id",
      })
    }
  }
  return findings
}

function main() {
  const repointed = repointedColumns()
  const files = []
  for (const root of ROOTS) walk(join(REPO_ROOT, root), files)
  files.sort()

  const findings = files.flatMap((f) => scanFile(f, repointed))
  const touched = new Set(findings.map((f) => f.file))

  if (json) {
    process.stdout.write(JSON.stringify({ total: findings.length, files: touched.size, findings }, null, 2) + "\n")
  } else {
    console.log("PostgREST embeds traversing foreign keys that 079 repoints")
    console.log(`Roots: ${ROOTS.join(", ")}`)
    console.log(`Repointed (table, column) pairs parsed from 079 PHASE 7: ${repointed.pairCount}`)
    console.log(`Scanned ${files.length} files.`)
    console.log("")
    let lastFile = null
    for (const f of findings) {
      if (f.file !== lastFile) {
        console.log(`  ${f.file}`)
        lastFile = f.file
      }
      console.log(`    ${String(f.line).padStart(5)}  ${f.kind.padEnd(10)} ${`${f.table}!${f.hint}`.padEnd(52)} ${f.why}`)
    }
    if (findings.length > 0) console.log("")
    console.log("Summary")
    console.log(`  REPOINTED  ${String(findings.filter((f) => f.kind === "REPOINTED").length).padStart(5)}`)
    console.log(`  PERSON     ${String(findings.filter((f) => f.kind === "PERSON").length).padStart(5)}`)
    console.log(`  TOTAL      ${String(findings.length).padStart(5)}  in ${touched.size} files`)
    console.log("")
  }

  if (guard) {
    if (findings.length > 0) {
      if (!json) {
        console.error("EMBED GUARD FAILED.")
        console.error("Each embed above names a foreign key that 079 PHASE 7 repoints at organizations.")
        console.error("Rewrite it to the two-hop form and use lib/org-contact.ts:")
        console.error("")
        console.error("  vendor_org:organizations!vendor_org_id(")
        console.error("    name,")
        console.error("    primary_contact:profiles!primary_contact_user_id(email, full_name)")
        console.error("  )")
        console.error("")
        console.error("A wrong constraint name returns HTTP 400 PGRST200. A row that row level")
        console.error("security filters returns null with HTTP 200. Handle the null at every site.")
      }
      process.exit(1)
    }
    if (!json) console.log("EMBED GUARD PASSED. No embed traverses a foreign key 079 repoints.")
  }
}

main()
