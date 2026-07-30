import * as XLSX from "xlsx"
import Papa from "papaparse"

/**
 * Client-side only - the raw file is never uploaded. Callers should reach this module via
 * a dynamic `import()` at the call site (not a static top-level import) so xlsx/papaparse
 * (~300KB combined) only load into the browser when a user actually opens the spreadsheet
 * import tab, not on every /agency/pool page load.
 */

export type ParsedSpreadsheet = {
  headers: string[]
  /** Data rows only - headers (or the synthetic Column A/B/C row) already stripped out. */
  rows: string[][]
  ignoredSheetNames: string[]
}

function cellToString(v: unknown): string {
  if (v == null) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

function columnLetter(index: number): string {
  let n = index
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function toParsedResult(allRows: string[][], firstRowIsHeaders: boolean, ignoredSheetNames: string[]): ParsedSpreadsheet {
  const width = allRows.reduce((max, row) => Math.max(max, row.length), 0)
  const padded = allRows.map((row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push("")
    return next
  })

  const nonEmpty = padded.filter((row) => row.some((cell) => cell.trim().length > 0))

  if (!firstRowIsHeaders) {
    return {
      headers: Array.from({ length: width }, (_, i) => `Column ${columnLetter(i)}`),
      rows: nonEmpty,
      ignoredSheetNames,
    }
  }

  const [headerRow, ...dataRows] = nonEmpty
  return {
    headers: (headerRow || []).map((h, i) => h.trim() || `Column ${columnLetter(i)}`),
    rows: dataRows,
    ignoredSheetNames,
  }
}

async function parseCsv(file: File): Promise<{ rows: string[][]; ignoredSheetNames: string[] }> {
  const buffer = await file.arrayBuffer()
  // Papa can take a File directly, but decoding as UTF-8 text ourselves first lets us strip
  // a BOM and normalize common Excel-exported-CSV mojibake before parsing.
  const decoder = new TextDecoder("utf-8")
  const text = stripBom(decoder.decode(buffer))
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const rows = (result.data || []).map((row) => row.map(cellToString))
  return { rows, ignoredSheetNames: [] }
}

async function parseExcel(file: File): Promise<{ rows: string[][]; ignoredSheetNames: string[] }> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true })
  const [firstSheetName, ...restSheetNames] = workbook.SheetNames
  const sheet = workbook.Sheets[firstSheetName]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" })
  const rows = raw.map((row) => (Array.isArray(row) ? row.map(cellToString) : []))
  return { rows, ignoredSheetNames: restSheetNames }
}

export async function parseSpreadsheetFile(file: File, firstRowIsHeaders: boolean): Promise<ParsedSpreadsheet> {
  const name = file.name.toLowerCase()
  const isCsv = name.endsWith(".csv")
  const { rows, ignoredSheetNames } = isCsv ? await parseCsv(file) : await parseExcel(file)
  return toParsedResult(rows, firstRowIsHeaders, ignoredSheetNames)
}
