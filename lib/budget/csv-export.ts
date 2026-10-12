/**
 * FINANCE EXPORT, CSV. Browser-side: the rows come from the gated budget API the page already read.
 *
 * Formula injection: a spreadsheet treats a cell that begins with =, +, -, @, a tab or a carriage
 * return as a formula. Every such cell is prefixed with a single quote. That includes negative
 * amounts ("-80.00" becomes "'-80.00"): the rule is applied to every cell without exception, so no
 * column can be the one that was missed. Every field is quoted, and quotes inside a field are
 * doubled (RFC 4180).
 */

const FORMULA_START = /^[=+\-@\t\r]/

export function neutraliseCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return `"${neutraliseCell(text).replace(/"/g, '""')}"`
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n"
}

export function downloadCsv(fileName: string, csv: string): void {
  // BOM so Excel reads UTF-8 names correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A file-name-safe slug: letters, digits and hyphens only. */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  )
}
