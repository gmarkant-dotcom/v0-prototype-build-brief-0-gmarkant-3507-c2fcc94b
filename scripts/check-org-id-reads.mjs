#!/usr/bin/env node
/**
 * THE THIRD BLIND SPOT. A `profiles` row fetched BY AN ORGANIZATION ID.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the third distinct class of 079 breakage found in three days, and each one was
 * invisible to the tool built to catch the previous one:
 *
 *   1. scripts/check-identity-columns.mjs   matches `\bagency_id\b` / `\bpartner_id\b`.
 *      Catches columns that were not renamed. BLIND to constraint names, because
 *      `partnerships_partner_id_fkey` has no word boundary before `partner_id`.
 *   2. scripts/check-embed-targets.mjs      matches `table!hint(` embeds.
 *      Catches embeds traversing a repointed foreign key. BLIND to a separate query,
 *      because there is no embed hint anywhere in it.
 *   3. this file                            matches a profiles read keyed on an org id:
 *
 *          .from("profiles").select("id, company_name").in("id", <vendor org ids>)
 *
 *      The column name is ALREADY the post-079 one, so guard 1 sees nothing. There is no
 *      `!hint(`, so guard 2 sees nothing. Both report zero and both are correct.
 *
 * WHY IT IS A BUG THAT NOTHING ELSE FINDS. Every organization migration 079 backfills
 * carries its founding user's id (PHASE 2), so an organization id and a user id are the
 * same value for all sixteen live accounts and the query returns exactly what it always
 * did. The PHASE 12 trigger mints `gen_random_uuid()` for every organization created
 * AFTER the migration. From that moment the same query matches no profiles row, returns
 * an empty result at HTTP 200, and the product renders a blank or a placeholder name with
 * no error in any log. 079's own comment on the `organizations` table warns against
 * relying on the id coincidence; this check is the mechanical form of that warning.
 *
 * WHAT THIS CHECKS
 * ----------------
 * Every `.from('profiles')` query in application source that filters on `id` - via
 * `.in('id', ...)` or `.eq('id', ...)` - where an organization-valued identifier appears
 * in the surrounding window. The organization tokens are the three post-079 column names
 * and their camelCase forms:
 *
 *     org_id  lead_org_id  vendor_org_id      orgId  leadOrgId  vendorOrgId
 *     orgIds  leadOrgIds   vendorOrgIds       ...Id / ...Ids suffixes of the above
 *
 * WHAT IT CANNOT DO, STATED PLAINLY. THIS IS THE IMPORTANT PARAGRAPH.
 * -------------------------------------------------------------------
 * This is a PROXIMITY HEURISTIC over source text, not dataflow analysis. It flags a
 * profiles-by-id read that has an organization identifier NEARBY. It therefore:
 *
 *   - MISSES a site where the org id travels far enough from the read to fall outside the
 *     window, is renamed to something with no `org` in it, arrives as a function argument
 *     from another module, or is carried on an object property (`row.partnerId`) whose own
 *     origin is an org column several hops away. app/agency/pool/page.tsx is exactly that
 *     shape and is caught here only because the same file mentions vendor_org_id
 *     elsewhere - which is luck, not detection.
 *   - CANNOT distinguish a correct profiles read that merely sits next to org code. Those
 *     are the allow-list below. Every entry is a claim a human made after reading the code.
 *   - CANNOT see a query built by string concatenation at run time.
 *   - CANNOT tell you whether the fixed query RETURNS ANYTHING. A row that row level
 *     security filters comes back as an empty array at HTTP 200, never as an error. That
 *     question is answerable only from a live authenticated session.
 *
 * A HUMAN MUST STILL INSPECT, and no script replaces this:
 *
 *   1. Every `.from('profiles')` in the repository, once, against the question "where did
 *      this id come from". There are ~209 of them. The ones that matter are the ones whose
 *      id came out of a *_org_id column, and the only reliable way to know is to read the
 *      chain. This check is a net under that reading, not a substitute for it.
 *   2. Every `.eq('<any *_org_id column>', user.id)`. That is the mirror image of this
 *      bug - an ORG column compared to a USER id - and it is the same coincidence in the
 *      opposite direction. scripts/check-identity-columns.mjs does not look at the
 *      right-hand side of a filter, so it does not see these either.
 *
 * MODES
 * -----
 *   node scripts/check-org-id-reads.mjs             inventory. Always exits 0.
 *   node scripts/check-org-id-reads.mjs --guard     exits 1 on any NON-allow-listed find.
 *   --json      machine-readable
 *   --all       show allow-listed sites too
 *   --root DIR  scan a different checkout
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const argv = process.argv.slice(2)
const guard = argv.includes("--guard")
const json = argv.includes("--json")
const showAll = argv.includes("--all")
const rootFlag = argv.indexOf("--root")
const REPO_ROOT =
  rootFlag !== -1 && argv[rootFlag + 1]
    ? resolve(argv[rootFlag + 1])
    : resolve(new URL("..", import.meta.url).pathname)

const ROOTS = ["app", "lib", "components", "contexts", "hooks"]
const EXTENSIONS = [".ts", ".tsx"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"])

/** How many lines above the `id` filter count as "nearby". */
const WINDOW = 40

/**
 * Filter arguments that are a USER id by construction and can never be an organization id.
 * These are the caller reading their own row, which is the single most common profiles
 * query in the codebase and is never this bug. Excluded by ARGUMENT, not by file, so a
 * genuine finding elsewhere in the same file is still reported.
 */
const USER_ID_ARGS = [
  /^user\.id$/,
  /^userId$/,
  /^auth\.uid\(\)$/,
  /^session(\.data)?\.user\.id$/,
  /^targetProfileId$/,
  /^[A-Za-z_$][\w$]*[Uu]serId$/,
  /^[A-Za-z_$][\w$]*\.user_id$/,
]

function isUserIdArg(arg) {
  return USER_ID_ARGS.some((re) => re.test(arg))
}

/**
 * Organization-valued identifiers. The snake_case forms are the post-079 column names;
 * the camelCase forms are what the routes call them once they are in a variable.
 */
const ORG_TOKEN_RE =
  /(^|[^a-zA-Z0-9])(org_id|lead_org_id|vendor_org_id|orgIds?|leadOrgIds?|vendorOrgIds?|callerOrgIds?|OrgIds?)([^a-zA-Z0-9]|$)/

/**
 * VERIFIED-CORRECT profiles reads that sit near organization code.
 *
 * Every entry is a promise that a human read the chain and established that the id
 * reaching `.in('id')` / `.eq('id')` is a USER id and always will be. Adding an entry is
 * a decision, not a way to make the check quiet. Each carries the reason in full, because
 * an allow-list whose entries do not say why is a list nobody can re-audit.
 */
const ALLOWED = [
  {
    file: "lib/email.ts",
    why:
      "resolveOrgNotificationRecipients(). The ids are org_members.user_id - real user ids " +
      "resolved from the organization one line earlier. The single-element [orgId] fallback " +
      "is deliberate, is reached only when org_members is absent (pre-079), logs at warn, " +
      "and is documented at the call site as byte-for-byte today's behaviour.",
  },
  {
    file: "app/api/partnerships/route.ts",
    lines: [186],
    why:
      "domain_match_profile_id and notes.matched_profile_id are profiles ids by definition - " +
      "they record WHICH PERSON a magic-link email domain matched. They are not organization " +
      "columns and 079 does not rename them. NOTE the line scoping: the other profiles reads " +
      "in this same file, keyed on partnership.vendor_org_id and partnership.lead_org_id, are " +
      "NOT allow-listed and are real findings.",
  },
]

/**
 * KNOWN OPEN. Sites that ARE this bug, are reported in
 * docs/079-embed-closure-report.md, and are deliberately NOT fixed on this branch.
 *
 * THIS IS NOT AN ALLOW-LIST AND MUST NOT BE READ AS ONE. Every entry below is broken for
 * any organization created after 079 - which is every account that signs up after the
 * release. They are recorded here so that `--guard` can do the one job it can do
 * honestly: fail when the class GROWS. A release-night branch is the wrong place to make
 * twenty-two unreviewed edits to routes nobody asked for; a silent thirty-first instance
 * appearing next week is the thing worth blocking.
 *
 * Keyed on FILE AND COUNT, not on line number, so an unrelated edit that shifts lines
 * does not turn the guard into noise. A file with MORE findings than its recorded count
 * fails. Fixing a site and lowering its count is the intended direction of travel; when a
 * count reaches zero, delete the entry.
 */
const KNOWN_OPEN = [
  { file: "app/api/agency/msa/ai-schedule/route.ts", count: 1 },
  { file: "app/api/agency/msa/milestones/route.ts", count: 1 },
  { file: "app/api/agency/msa/route.ts", count: 1 },
  { file: "app/api/agency/payment-synthesis/route.ts", count: 1 },
  { file: "app/api/agency/pool/[partnerId]/route.ts", count: 2 },
  { file: "app/api/agency/projects/[projectId]/status-updates/route.ts", count: 1 },
  { file: "app/api/agency/rfp-responses/route.ts", count: 1 },
  { file: "app/api/partner/network/[agencyId]/route.ts", count: 1 },
  { file: "app/api/partner/payments/route.ts", count: 1 },
  { file: "app/api/partner/projects/[projectId]/active-engagement/route.ts", count: 1 },
  { file: "app/api/partner/projects/route.ts", count: 1 },
  { file: "app/api/partner/rfps/[id]/route.ts", count: 1 },
  { file: "app/api/partner/rfps/route.ts", count: 1 },
  { file: "app/api/partnerships/route.ts", count: 4 },
  { file: "app/api/projects/[id]/assignments/route.ts", count: 2 },
  { file: "app/api/projects/[id]/partner/route.ts", count: 1 },
  { file: "app/api/rfp/guest/[token]/route.ts", count: 2 },
  { file: "app/partner/profile/page.tsx", count: 1 },
  { file: "lib/magic-token-attach.ts", count: 1 },
]

function isAllowed(file, line) {
  return ALLOWED.find((a) => a.file === file && (!a.lines || a.lines.includes(line)))
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
 * Blank comment bodies while preserving line and column positions, so reported line
 * numbers stay true and this file's own prose - which quotes the broken query verbatim -
 * does not flag itself. Same approach as scripts/check-embed-targets.mjs.
 */
function stripComments(text) {
  const out = text.split("")
  let i = 0
  let state = "code"
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

const FROM_PROFILES_RE = /\.from\(\s*["'`]profiles["'`]\s*\)/g
/** `.in("id", X)` or `.eq("id", X)` - the two ways a profiles row is fetched by key. */
const ID_FILTER_RE = /\.(in|eq)\(\s*["'`]id["'`]\s*,\s*([^)]*)\)/g

function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath)
  const raw = readFileSync(absPath, "utf8")
  const text = stripComments(raw)
  const lines = text.split("\n")

  // Line index of every `.from('profiles')` in this file.
  const profileLines = []
  FROM_PROFILES_RE.lastIndex = 0
  let m
  while ((m = FROM_PROFILES_RE.exec(text)) !== null) {
    profileLines.push(text.slice(0, m.index).split("\n").length - 1)
  }
  if (profileLines.length === 0) return []

  const findings = []
  ID_FILTER_RE.lastIndex = 0
  while ((m = ID_FILTER_RE.exec(text)) !== null) {
    const lineIdx = text.slice(0, m.index).split("\n").length - 1

    // The filter must belong to a profiles query: the nearest preceding `.from(...)` in
    // the file must be `.from('profiles')`, and within a few lines of it.
    const owner = profileLines.filter((l) => l <= lineIdx).pop()
    if (owner === undefined || lineIdx - owner > 8) continue
    const between = lines.slice(owner, lineIdx + 1).join("\n")
    if (/\.from\(\s*["'`](?!profiles["'`])/.test(between.slice(between.indexOf(".from") + 5))) continue

    const arg = m[2].trim()
    if (isUserIdArg(arg)) continue

    // An argument that NAMES an organization column is a finding on its own evidence and
    // does not need the proximity window at all.
    const argIsOrg = ORG_TOKEN_RE.test(` ${arg} `)
    const windowText = lines.slice(Math.max(0, lineIdx - WINDOW), lineIdx + 1).join("\n")
    if (!argIsOrg && !ORG_TOKEN_RE.test(windowText)) continue

    findings.push({
      file: rel,
      line: lineIdx + 1,
      op: m[1],
      arg: arg.slice(0, 60),
      evidence: argIsOrg ? "DIRECT" : "NEARBY",
      allowed: Boolean(isAllowed(rel, lineIdx + 1)),
      why: "a profiles row fetched by an id that an organization column may have supplied",
    })
  }
  return findings
}

function main() {
  const files = []
  for (const root of ROOTS) walk(join(REPO_ROOT, root), files)
  files.sort()

  const all = files.flatMap(scanFile)
  const allowed = all.filter((f) => f.allowed)
  const open = all.filter((f) => !f.allowed)

  // Regressions: a file with MORE findings than its recorded known-open count, or any
  // finding in a file that is on neither list at all.
  const countByFile = new Map()
  for (const f of open) countByFile.set(f.file, (countByFile.get(f.file) || 0) + 1)
  const regressions = []
  for (const [file, count] of countByFile) {
    const known = KNOWN_OPEN.find((k) => k.file === file)
    if (!known) {
      regressions.push({ file, count, known: 0 })
    } else if (count > known.count) {
      regressions.push({ file, count, known: known.count })
    }
  }
  const fixed = KNOWN_OPEN.filter((k) => (countByFile.get(k.file) || 0) < k.count)
  const flagged = open
  const shown = showAll ? all : open

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          total: all.length,
          flagged: flagged.length,
          allowed: allowed.length,
          regressions,
          fixed,
          findings: all,
        },
        null,
        2
      ) +
        "\n"
    )
  } else {
    console.log("profiles rows fetched by an id an organization column may have supplied")
    console.log(`Roots: ${ROOTS.join(", ")}`)
    console.log(`Proximity window: ${WINDOW} lines. THIS IS A HEURISTIC - read the header.`)
    console.log(`DIRECT = the filter argument itself names an organization column.`)
    console.log(`NEARBY = an organization identifier appears within the window. Read the chain.`)
    console.log(`Scanned ${files.length} files.`)
    console.log("")
    let lastFile = null
    for (const f of shown) {
      if (f.file !== lastFile) {
        console.log(`  ${f.file}${f.allowed ? "   [ALLOW-LISTED]" : ""}`)
        lastFile = f.file
      }
      console.log(`    ${String(f.line).padStart(5)}  ${f.evidence.padEnd(6)} .${f.op}("id", ${f.arg})`)
    }
    if (shown.length > 0) console.log("")
    console.log("Summary")
    console.log(`  OPEN          ${String(open.length).padStart(5)}  known, reported, deliberately unfixed on this branch`)
    console.log(`  ALLOW-LISTED  ${String(allowed.length).padStart(5)}  read and established to be user ids`)
    console.log(`  REGRESSIONS   ${String(regressions.length).padStart(5)}  files with MORE findings than recorded`)
    console.log(`  IMPROVED      ${String(fixed.length).padStart(5)}  files with FEWER - lower the count in KNOWN_OPEN`)
    console.log("")
  }

  if (guard) {
    if (fixed.length > 0 && !json) {
      console.log("These files now have FEWER findings than KNOWN_OPEN records. Lower the count:")
      for (const k of fixed) console.log(`  ${k.file}   recorded ${k.count}, found ${countByFile.get(k.file) || 0}`)
      console.log("")
    }
    if (regressions.length > 0) {
      if (!json) {
        console.error("ORG-ID-READ GUARD FAILED. NEW instances of the class:")
        console.error("")
        for (const r of regressions) {
          console.error(`  ${r.file}   found ${r.count}, KNOWN_OPEN records ${r.known}`)
        }
        console.error("")
        console.error("A read above may be fetching a PERSON by a COMPANY id. It returns the")
        console.error("right rows today only because every organization 079 backfilled carries its")
        console.error("founding user's id. Organizations created after 079 get gen_random_uuid(),")
        console.error("match nothing, and the result is an empty array at HTTP 200 - no error.")
        console.error("")
        console.error("Fix: read the organization, not the person.")
        console.error("")
        console.error('  .from("organizations").select(ORG_CONTACT_SELECT).in("id", orgIds)')
        console.error("")
        console.error("then resolveOrgContact() from lib/org-contact.ts. The company name is")
        console.error("organizations.name; a person's name or email comes from the designated")
        console.error("primary contact and is NOT a property of the company.")
        console.error("")
        console.error("If the id really is a user id, add the file to ALLOWED in this script WITH")
        console.error("THE REASON. An allow-list entry with no reason is a check nobody can re-audit.")
      }
      process.exit(1)
    }
    if (!json) {
      console.log("ORG-ID-READ GUARD PASSED. No NEW instance of the class.")
      console.log(`${open.length} known-open sites remain. They are NOT fixed - see KNOWN_OPEN above`)
      console.log("and docs/079-embed-closure-report.md. Passing here means the class did not grow.")
    }
  }
}

main()
