/**
 * Plain assertion test for lib/rfp-vendor-text-check.ts (ruling OV-A) - no test framework, run with:
 *   npx tsx lib/rfp-vendor-text-check.test.ts
 */
import assert from "node:assert/strict"
import {
  checkVendorText,
  clientNamePattern,
  diffWords,
  lineVendorTextFields,
  sharedVendorTextFields,
  summarizeVendorTextMatches,
  type VendorTextField,
} from "./rfp-vendor-text-check"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

const shared = (text: string): VendorTextField => ({ field: "overview", label: "Overview", text, scope: "shared" })
const line = (text: string, released: boolean): VendorTextField => ({
  field: "line.a.description",
  label: "Film: description",
  text,
  scope: "line",
  lineBudgetReleased: released,
})

/** The matched strings for one field and one set of client names. */
function matched(text: string, names: string[], opts: { hidden?: boolean; field?: VendorTextField } = {}) {
  return checkVendorText({
    clientHidden: opts.hidden !== false,
    clientNames: names,
    fields: [opts.field ?? shared(text)],
  }).map((m) => `${m.reason}:${m.matched}`)
}

// ── Client name: variants ───────────────────────────────────────────────────
check("exact name", matched("A launch film for Nike this spring.", ["Nike"]), ["client_name:Nike"])
check("case-insensitive", matched("for NIKE and nike", ["Nike"]), ["client_name:NIKE", "client_name:nike"])
check("possessive", matched("Nike's spring launch", ["Nike"]), ["client_name:Nike"])
check("hyphen variant", matched("A Coca-Cola summer", ["Coca Cola"]), ["client_name:Coca-Cola"])
check("space variant", matched("A Coca Cola summer", ["Coca-Cola"]), ["client_name:Coca Cola"])
check("joined variant", matched("The CocaCola brief", ["Coca-Cola"]), ["client_name:CocaCola"])
check("ampersand as and", matched("Procter and Gamble wants", ["Procter & Gamble"]), ["client_name:Procter and Gamble"])
check("and as ampersand", matched("Procter & Gamble wants", ["Procter and Gamble"]), ["client_name:Procter & Gamble"])
check("company suffix optional", matched("Work for Acme next year", ["Acme Inc."]), ["client_name:Acme"])
check("company suffix kept when written", matched("Work for Acme, Inc. next year", ["Acme Inc"]), ["client_name:Acme, Inc."])
check("profile name and alias", matched("Made for Oatly and The Oat Company", ["Oatly", "The Oat Company"]), [
  "client_name:Oatly",
  "client_name:The Oat Company",
])
check("duplicate names count once", matched("Nike", ["Nike", "nike ", " NIKE"]), ["client_name:Nike"])
check("one-character name ignored", clientNamePattern("X"), null)
check("blank name ignored", matched("anything", ["", "   "]), [])

// ── Client name: word boundaries ────────────────────────────────────────────
check("no match inside a longer word", matched("Nikesh will direct", ["Nike"]), [])
check("no match as a suffix of a word", matched("Bethany shoots", ["Beth"]), [])
check("no match for Ford inside Oxford", matched("Shot in Oxford", ["Ford"]), [])
check("matches at the end of the text", matched("Directed for Ford", ["Ford"]), ["client_name:Ford"])

// ── Client name only while hidden ───────────────────────────────────────────
check("client shown: name not flagged", matched("A Nike launch", ["Nike"], { hidden: false }), [])
check("client hidden: name flagged", matched("A Nike launch", ["Nike"], { hidden: true }), ["client_name:Nike"])

// ── Figures: currency ───────────────────────────────────────────────────────
check("dollar amount", matched("Total investment is $250,000.", []), ["figure:$250,000"])
check("pound with k", matched("Up to £40k for post", []), ["figure:£40k"])
check("euro with space and M", matched("€ 1.2M overall", []), ["figure:€ 1.2M"])
check("code before", matched("USD 75,000 programme", []), ["figure:USD 75,000"])
check("code after", matched("1.5m EUR across markets", []), ["figure:1.5m EUR"])
check("currency word", matched("about 900 dollars a day", []), ["figure:900 dollars"])
check("dollar with million", matched("a $3 million programme", []), ["figure:$3 million"])

// ── Figures: k / m / M suffixes and scale words ─────────────────────────────
check("k suffix", matched("budget of 250k", []), ["figure:250k"])
check("M suffix", matched("1.5M impressions target", []), ["figure:1.5M"])
check("bn suffix", matched("a 2bn brand", []), ["figure:2bn"])
check("scale word", matched("reach 3 million people", []), ["figure:3 million"])
check("mm is a unit", matched("Shot on 35mm film", []), [])
check("ml is a unit", matched("a 500ml can", []), [])
check("Phase 2b is not money", matched("Phase 2b starts in May", []), [])
check("4K resolution is not money", matched("Deliver in 4K and HD", []), [])
check("$4K is money", matched("A $4K kit fee", []), ["figure:$4K"])
check("bare number not flagged", matched("Deliver 12 cutdowns by 2026", []), [])
check("number inside a word not flagged", matched("Model X5k2 and A4", []), [])

// ── Figures: percentages ────────────────────────────────────────────────────
check("percent sign", matched("Agency fee is 12%.", []), ["figure:12%"])
check("percent with space", matched("a 7.5 % margin", []), ["figure:7.5 %"])
check("percent word", matched("15 percent of the total", []), ["figure:15 percent"])
check("per cent", matched("15 per cent of the total", []), ["figure:15 per cent"])

// ── Released versus hidden lines ────────────────────────────────────────────
check("shared text: figures always", matched("", [], { field: shared("Fee 10% on $50k") }), ["figure:10%", "figure:$50k"])
check("line not released: figures flagged", matched("", [], { field: line("Budget around $50k", false) }), ["figure:$50k"])
check("line released: figures not flagged", matched("", [], { field: line("Budget around $50k", true) }), [])
check("line released: client still flagged while hidden", matched("", ["Nike"], { field: line("Nike film, $50k", true) }), ["client_name:Nike"])
check("line not released, client shown", matched("", ["Nike"], { hidden: false, field: line("Nike film, $50k", false) }), ["figure:$50k"])

// ── Overlaps count once ─────────────────────────────────────────────────────
check("currency and suffix overlap once", matched("$250k", []), ["figure:$250k"])

// ── Shape: field, label, excerpt ────────────────────────────────────────────
{
  const [m] = checkVendorText({ clientHidden: true, clientNames: ["Nike"], fields: [shared("The brief: Nike wants a film.")] })
  check("match carries field", m.field, "overview")
  check("match carries label", m.label, "Overview")
  check("excerpt shows context", m.excerpt, "The brief: Nike wants a film.")
}
{
  const long = `${"word ".repeat(30)}Nike${" more".repeat(30)}`
  const [m] = checkVendorText({ clientHidden: true, clientNames: ["Nike"], fields: [shared(long)] })
  check("long excerpt is trimmed both sides", m.excerpt.startsWith("...") && m.excerpt.endsWith("..."), true)
}

// ── Builders ────────────────────────────────────────────────────────────────
check(
  "shared fields from a master RFP",
  sharedVendorTextFields({ projectName: "P", overview: "O", objectives: ["a", "b"], timeline: "T", client: "never read" }).map((f) => f.field),
  ["projectName", "overview", "objectives.0", "objectives.1", "timeline"]
)
check(
  "line fields carry the release",
  lineVendorTextFields({ key: "k1", name: "Film", description: "D", timeline: null, budgetReleased: true }).every(
    (f) => f.scope === "line" && f.lineBudgetReleased === true
  ),
  true
)
check(
  "summary flags",
  summarizeVendorTextMatches(
    checkVendorText({ clientHidden: true, clientNames: ["Nike"], fields: sharedVendorTextFields({ overview: "Nike, 10%" }) })
  ),
  { namesClient: true, showsFigures: true }
)
check("non-string text is skipped", checkVendorText({ clientHidden: true, clientNames: ["Nike"], fields: [{ field: "x", label: "x", text: null, scope: "shared" }] }), [])

// ── Word diff ───────────────────────────────────────────────────────────────
check("diff: unchanged", diffWords("a b", "a b"), [{ kind: "same", text: "a b" }])
{
  const before = "Total programme investment for Nike is $2M with a 12% fee."
  const after = "Total programme investment for the client is set out in your brief."
  const parts = diffWords(before, after)
  const join = (kinds: string[]) => parts.filter((p) => kinds.includes(p.kind)).map((p) => p.text).join("")
  check("diff: same + removed rebuilds the original", join(["same", "removed"]), before)
  check("diff: same + added rebuilds the rewrite", join(["same", "added"]), after)
  check("diff: the client name is in a removed part", parts.some((p) => p.kind === "removed" && p.text.includes("Nike")), true)
}
check("diff: all removed", diffWords("gone", ""), [{ kind: "removed", text: "gone" }])

console.log(`rfp-vendor-text-check: ${passed} assertions passed`)
