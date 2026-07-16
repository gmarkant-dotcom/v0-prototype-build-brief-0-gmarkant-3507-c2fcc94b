/**
 * Plain assertion test for lib/insurance-limit-parser.ts - no test framework, run with:
 *   npx tsx lib/insurance-limit-parser.test.ts
 */
import assert from "node:assert/strict"
import { parseInsuranceLimit, meetsInsuranceMinimum } from "./insurance-limit-parser"

let passed = 0
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed++
}

// parseInsuranceLimit
check("slash shorthand", parseInsuranceLimit("$1M/$2M"), { perOccurrence: 1_000_000, aggregate: 2_000_000 })
check("bare million with M suffix", parseInsuranceLimit("1M"), { perOccurrence: 1_000_000, aggregate: 1_000_000 })
check("comma-formatted dollar amount", parseInsuranceLimit("$1,000,000"), { perOccurrence: 1_000_000, aggregate: 1_000_000 })
check("spelled out million", parseInsuranceLimit("2 million"), { perOccurrence: 2_000_000, aggregate: 2_000_000 })
check(
  "explicit per occurrence / aggregate labels",
  parseInsuranceLimit("$1M per occurrence / $2M aggregate"),
  { perOccurrence: 1_000_000, aggregate: 2_000_000 }
)
check("thousand suffix", parseInsuranceLimit("500k"), { perOccurrence: 500_000, aggregate: 500_000 })
check("decimal million", parseInsuranceLimit("1.5M"), { perOccurrence: 1_500_000, aggregate: 1_500_000 })
check("statutory is unparseable", parseInsuranceLimit("Statutory"), null)
check("TBD is unparseable", parseInsuranceLimit("TBD"), null)
check("empty string is unparseable", parseInsuranceLimit(""), null)
check("N/A is unparseable", parseInsuranceLimit("N/A"), null)
check("random garbage is unparseable", parseInsuranceLimit("asdkfjasldkfj"), null)
check("null input is unparseable", parseInsuranceLimit(null), null)
check("undefined input is unparseable", parseInsuranceLimit(undefined), null)
check(
  "aggregate-only label",
  parseInsuranceLimit("$2M aggregate"),
  { perOccurrence: null, aggregate: 2_000_000 }
)

// meetsInsuranceMinimum
check("held meets both dimensions", meetsInsuranceMinimum("$2M/$2M", "$1M/$2M"), "met")
check("held falls short", meetsInsuranceMinimum("$500k", "$1M"), "not_met")
check("held unparseable is unknown", meetsInsuranceMinimum("Statutory", "$1M"), "unknown")
check(
  "single-number held compared against split requirement, fails aggregate",
  meetsInsuranceMinimum("$1M", "$1M/$2M"),
  "not_met"
)
check("null held is unknown", meetsInsuranceMinimum(null, "$1M"), "unknown")
check("empty required is unknown", meetsInsuranceMinimum("$1M", ""), "unknown")
check("both sides unparseable is unknown", meetsInsuranceMinimum("TBD", "N/A"), "unknown")
check("exact match meets minimum", meetsInsuranceMinimum("$1M", "$1M"), "met")

console.log(`insurance-limit-parser.test.ts: ${passed} assertions passed`)
