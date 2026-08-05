"use client"

import { useEffect, useRef, useState } from "react"
import { Check, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { PoolReviewRow, ReviewBadge } from "@/components/pool-review-row"
import { POOL_TARGET_FIELDS, autoMapHeader, isValidEmail, type PoolTargetField } from "@/lib/pool-field-mapping"
import type { ParsedSpreadsheet } from "@/lib/spreadsheet-parse"

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_DATA_ROWS = 2000
const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"]

type Stage = "upload" | "mapping" | "review" | "importing" | "done"

type MappedRow = {
  key: string
  email: string
  contactName: string
  companyName: string
  phone: string
  website: string
  notes: string
  discipline: string
  type: string
}

type ReviewBucket = "new" | "existing" | "invalid"
type ImportFlag = "already_on_ligament" | "domain_match_flagged"
type ReviewItem = { row: MappedRow; bucket: ReviewBucket; reason?: string; flag?: ImportFlag }

type ImportResponse = {
  added: number
  duplicates: number
  invalid: number
  self?: number
  errors: { email: string; reason?: string }[]
  flags?: Record<string, string>
}

type DryRunResponse = {
  flags?: Record<string, string>
}

function flagBadgeLabel(flag: ImportFlag): string {
  return flag === "already_on_ligament" ? "Already on Ligament" : "Same domain as your agency"
}

function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function buildMappedRows(parsed: ParsedSpreadsheet, columnMap: Record<number, PoolTargetField>): MappedRow[] {
  const indexFor = (field: PoolTargetField) =>
    Object.entries(columnMap).find(([, f]) => f === field)?.[0]
  const emailIdx = indexFor("email")
  const contactIdx = indexFor("contactName")
  const companyIdx = indexFor("companyName")
  const phoneIdx = indexFor("phone")
  const websiteIdx = indexFor("website")
  const notesIdx = indexFor("notes")
  const disciplineIdx = indexFor("discipline")
  const typeIdx = indexFor("type")

  const cell = (row: string[], idx: string | undefined) => (idx != null ? (row[Number(idx)] || "").trim() : "")

  return parsed.rows.map((row, i) => ({
    key: String(i),
    email: cell(row, emailIdx),
    contactName: cell(row, contactIdx),
    companyName: cell(row, companyIdx),
    phone: cell(row, phoneIdx),
    website: cell(row, websiteIdx),
    notes: cell(row, notesIdx),
    discipline: cell(row, disciplineIdx),
    type: cell(row, typeIdx),
  }))
}

function classifyRows(rows: MappedRow[], existingStatusByEmail: Map<string, string>): ReviewItem[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const email = row.email.trim().toLowerCase()
    if (!email) return { row, bucket: "invalid", reason: "Missing email" }
    if (!isValidEmail(email)) return { row, bucket: "invalid", reason: "Invalid email format" }
    if (seen.has(email)) return { row, bucket: "invalid", reason: "Duplicate row in this file" }
    seen.add(email)
    const existingStatus = existingStatusByEmail.get(email)
    if (existingStatus) return { row, bucket: "existing", reason: existingStatus }
    return { row, bucket: "new" }
  })
}

export function SpreadsheetImportPanel({
  active,
  existingStatusByEmail,
  onDone,
  onImported,
}: {
  active: boolean
  /** Lowercased email -> display status ("Active vendor", "Invited", "Discovered") for
   *  every partnership already in this agency's pool, across all statuses. */
  existingStatusByEmail: Map<string, string>
  onDone: () => void
  onImported?: () => void
}) {
  const [stage, setStage] = useState<Stage>("upload")
  const [isDragging, setIsDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null)
  const [firstRowIsHeaders, setFirstRowIsHeaders] = useState(true)
  const [columnMap, setColumnMap] = useState<Record<number, PoolTargetField>>({})
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const [checkingRows, setCheckingRows] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!active) {
      setStage("upload")
      setUploadError(null)
      setFile(null)
      setParsed(null)
      setFirstRowIsHeaders(true)
      setColumnMap({})
      setReviewItems([])
      setSelected(new Set())
      setImportError(null)
      setImportResult(null)
    }
  }, [active])

  const parseFile = async (f: File, headerToggle: boolean) => {
    setUploadError(null)
    if (f.size > MAX_FILE_SIZE_BYTES) {
      setUploadError("File is too large - the maximum is 5MB.")
      return
    }
    if (!hasAcceptedExtension(f.name)) {
      setUploadError("Unsupported file type - upload an Excel (.xlsx, .xls) or CSV file.")
      return
    }
    try {
      const { parseSpreadsheetFile } = await import("@/lib/spreadsheet-parse")
      const result = await parseSpreadsheetFile(f, headerToggle)
      if (result.rows.length === 0) {
        setUploadError("No data rows found in this file.")
        return
      }
      if (result.rows.length > MAX_DATA_ROWS) {
        setUploadError(`This file has ${result.rows.length} data rows - the maximum is ${MAX_DATA_ROWS} per import.`)
        return
      }
      setParsed(result)
      const nextMap: Record<number, PoolTargetField> = {}
      result.headers.forEach((h, i) => {
        nextMap[i] = autoMapHeader(h)
      })
      setColumnMap(nextMap)
      setStage("mapping")
    } catch (err) {
      console.error("[spreadsheet-import] parse failed", err)
      setUploadError("Could not read this file. Make sure it's a valid Excel or CSV file.")
    }
  }

  const handleFileSelected = (f: File) => {
    setFile(f)
    parseFile(f, firstRowIsHeaders)
  }

  const toggleHeaderRow = (checked: boolean) => {
    setFirstRowIsHeaders(checked)
    if (file) parseFile(file, checked)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFileSelected(f)
  }

  const emailMapped = Object.values(columnMap).includes("email")

  /** Runs a dryRun classification against /api/agency/pool/import-spreadsheet before
   *  showing the review stage - this is the only way to know whether a "new" row (per the
   *  client-only existingStatusByEmail check) actually matches a Ligament profile, is the
   *  agency's own account, or shares the agency's own email domain, since profiles lookups
   *  can only happen server-side. Self-account rows are moved into the same "invalid"
   *  section shown for malformed rows - they were never importable in the first place. */
  const goToReview = async () => {
    if (!parsed || !emailMapped) return
    const mapped = buildMappedRows(parsed, columnMap)
    const items = classifyRows(mapped, existingStatusByEmail)

    setCheckingRows(true)
    setUploadError(null)
    try {
      const newRows = items.filter((it) => it.bucket === "new")
      if (newRows.length > 0) {
        const res = await fetch("/api/agency/pool/import-spreadsheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dryRun: true,
            rows: newRows.map((it) => ({ email: it.row.email })),
          }),
        })
        const data = (await res.json().catch(() => ({}))) as DryRunResponse
        const flags = data.flags || {}
        for (const it of items) {
          const flag = flags[it.row.email.trim().toLowerCase()]
          if (flag === "self") {
            it.bucket = "invalid"
            it.reason = "This is your own account"
          } else if (flag === "already_on_ligament" || flag === "domain_match_flagged") {
            it.flag = flag
          }
        }
      }
    } catch (err) {
      console.error("[spreadsheet-import] dry-run classification failed", err)
      // Fall through - rows just won't show Ligament-match badges, still importable.
    } finally {
      setCheckingRows(false)
    }

    setReviewItems(items)
    setSelected(new Set(items.filter((it) => it.bucket === "new").map((it) => it.row.key)))
    setStage("review")
  }

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleImport = async () => {
    const rows = reviewItems
      .filter((it) => it.bucket === "new" && selected.has(it.row.key))
      .map((it) => ({
        email: it.row.email,
        contactName: it.row.contactName,
        companyName: it.row.companyName,
        phone: it.row.phone,
        website: it.row.website,
        notes: it.row.notes,
        discipline: it.row.discipline,
        type: it.row.type,
      }))
    if (rows.length === 0) return
    setStage("importing")
    setImportError(null)
    try {
      const res = await fetch("/api/agency/pool/import-spreadsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to import vendors")
      setImportResult(data as ImportResponse)
      setStage("done")
      onImported?.()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import vendors")
      setStage("review")
    }
  }

  const newItems = reviewItems.filter((it) => it.bucket === "new")
  const existingItems = reviewItems.filter((it) => it.bucket === "existing")
  const invalidItems = reviewItems.filter((it) => it.bucket === "invalid")

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {stage === "upload" && (
        <div className="space-y-4 px-4 pb-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
              isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
            )}
          >
            <FileSpreadsheet className="w-8 h-8 text-accent mx-auto mb-3" />
            <p className="text-sm text-foreground font-display font-bold">Drop a spreadsheet here, or click to browse</p>
            <p className="text-xs text-foreground-muted mt-2 leading-relaxed">
              Upload an Excel (.xlsx) or CSV file. Using Numbers or Google Sheets? Export as Excel or CSV first.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelected(f)
                e.target.value = ""
              }}
            />
          </div>
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          <p className="text-xs text-foreground-muted">Maximum file size 5MB, 2,000 rows per import.</p>
        </div>
      )}

      {stage === "mapping" && parsed && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-4 pb-2 space-y-2">
            {parsed.ignoredSheetNames.length > 0 && (
              <p className="text-xs text-foreground-muted">
                Only the first sheet was imported. Ignored: {parsed.ignoredSheetNames.join(", ")}
              </p>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!firstRowIsHeaders} onCheckedChange={(c) => toggleHeaderRow(!c)} />
              <span className="text-xs text-foreground">First row is data, not headers</span>
            </label>
            <p className="text-xs text-foreground-muted">
              Map each column to a field. Email is required to continue.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 space-y-3">
            {parsed.headers.map((header, i) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-display font-bold text-foreground truncate">{header}</span>
                  <Select
                    value={columnMap[i] || "skip"}
                    onValueChange={(value) => setColumnMap((prev) => ({ ...prev, [i]: value as PoolTargetField }))}
                  >
                    <SelectTrigger size="sm" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POOL_TARGET_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="font-mono text-2xs text-foreground-muted truncate">
                  {parsed.rows
                    .slice(0, 3)
                    .map((row) => row[i] || "-")
                    .join(" · ")}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-border space-y-2">
            {!emailMapped && <p className="text-xs text-red-400">Map a column to Email to continue.</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStage("upload")} className="border-border text-foreground">
                Back
              </Button>
              <Button
                onClick={() => void goToReview()}
                disabled={!emailMapped || checkingRows}
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {checkingRows ? "Checking..." : "Continue"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-4 pb-2">
            <p className="text-xs text-foreground-muted">
              {newItems.length} new, {existingItems.length} already in your pool, {invalidItems.length} invalid
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            {newItems.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">New</p>
                {newItems.map((it) => (
                  <PoolReviewRow
                    key={it.row.key}
                    checked={selected.has(it.row.key)}
                    onToggle={() => toggleSelected(it.row.key)}
                    title={it.row.companyName || it.row.contactName || it.row.email}
                    subtitle={it.row.companyName || it.row.contactName ? it.row.email : undefined}
                    badges={
                      it.flag ? (
                        <ReviewBadge tone={it.flag === "already_on_ligament" ? "accent" : "warning"}>
                          {flagBadgeLabel(it.flag)}
                        </ReviewBadge>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
            {existingItems.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                  Already in your pool
                </p>
                {existingItems.map((it) => (
                  <PoolReviewRow
                    key={it.row.key}
                    checked={false}
                    onToggle={() => {}}
                    disabled
                    dimmed
                    title={it.row.companyName || it.row.contactName || it.row.email}
                    subtitle={it.row.email}
                    badges={<ReviewBadge>{it.reason}</ReviewBadge>}
                  />
                ))}
              </div>
            )}
            {invalidItems.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Invalid</p>
                {invalidItems.map((it) => (
                  <PoolReviewRow
                    key={it.row.key}
                    checked={false}
                    onToggle={() => {}}
                    disabled
                    dimmed
                    title={it.row.companyName || it.row.contactName || it.row.email || "(empty row)"}
                    subtitle={it.row.email || undefined}
                    badges={<ReviewBadge tone="warning">{it.reason}</ReviewBadge>}
                  />
                ))}
              </div>
            )}
          </div>
          {importError && <p className="px-4 py-2 text-xs text-red-400">{importError}</p>}
          <div className="px-4 py-3 border-t border-border space-y-2">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStage("mapping")} className="border-border text-foreground">
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={selected.size === 0}
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {`Add ${selected.size} vendor${selected.size !== 1 ? "s" : ""} to Pool`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {stage === "importing" && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-6 h-6 text-accent" />
        </div>
      )}

      {stage === "done" && importResult && (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-6 text-center space-y-3">
            <Check className="w-8 h-8 text-accent mx-auto" />
            <p className="text-sm font-display font-bold text-foreground">
              {importResult.added} vendor{importResult.added !== 1 ? "s" : ""} added to your pool
            </p>
            <p className="text-xs text-foreground-muted">
              {importResult.duplicates} already in your pool skipped
              {importResult.invalid > 0 ? `, ${importResult.invalid} invalid skipped` : ""}
              {importResult.errors.length > 0 ? `, ${importResult.errors.length} failed` : ""}
            </p>
            {importResult.errors.length > 0 && (
              <div className="text-left rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-1 max-h-32 overflow-y-auto">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400 truncate">
                    {e.email}: {e.reason || "Failed"}
                  </p>
                ))}
              </div>
            )}
            <Button onClick={onDone} className="bg-accent text-accent-foreground hover:bg-accent/90">
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
