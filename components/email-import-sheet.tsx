"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, Check } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn, formatDateTime } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"

type ScannedContact = {
  email: string
  name: string | null
  subjects: string[]
  snippets?: string[]
  message_count: number
  has_attachments: boolean
  attachment_types: string[]
  last_contact_date: string | null
  score: number
  signals: string[]
  is_free_email: boolean
  has_ligament_account: boolean
  profile_id: string | null
  already_in_pool: boolean
}

type ScanResults = {
  contacts: ScannedContact[]
  processed_count: number
  failed_count: number
  complete: boolean
} | null

type ConnectionInfo = {
  connected_at: string | null
  last_scan_at: string | null
}

type View = "loading" | "no_connection" | "ready_to_scan" | "scanning" | "results" | "error"

const MAX_MESSAGES_ESTIMATE = 200

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09a6.99 6.99 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

function signalLabel(signal: string): string {
  if (signal.startsWith("keyword:")) {
    const rest = signal.slice("keyword:".length)
    const separatorIndex = rest.lastIndexOf(":")
    const keyword = separatorIndex >= 0 ? rest.slice(0, separatorIndex) : rest
    const source = separatorIndex >= 0 ? rest.slice(separatorIndex + 1) : "subject"
    return `"${keyword.toUpperCase()}" in ${source === "snippet" ? "preview" : "subject"}`
  }
  switch (signal) {
    case "pdf_or_docx_attachment":
      return "Has attachment"
    case "5+_messages":
      return "5+ emails"
    case "10+_messages":
      return "10+ emails"
    case "contact_within_6mo":
      return "Contact within 6mo"
    case "contact_within_3mo":
      return "Recent contact"
    case "newsletter_or_marketing":
      return "Newsletter/marketing"
    case "system_address":
      return "System address"
    default:
      return signal
  }
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-green-500/15 text-green-400 border-green-500/30"
  if (score >= 40) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
  return "bg-white/5 text-foreground-muted border-border"
}

function ContactRow({
  contact,
  checked,
  onToggle,
  readOnly,
}: {
  contact: ScannedContact
  checked: boolean
  onToggle: () => void
  readOnly?: boolean
}) {
  const domain = contact.email.split("@")[1] || ""
  return (
    <div
      className={cn(
        "rounded-lg border border-border p-3 flex items-start gap-3",
        contact.already_in_pool && "opacity-60"
      )}
    >
      {!readOnly && (
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          disabled={contact.already_in_pool}
          className="mt-1"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-display font-bold text-foreground truncate">
            {contact.name || contact.email}
          </span>
          <Badge className={cn("border", scoreBadgeClass(contact.score))}>{contact.score}</Badge>
        </div>
        {contact.name && <div className="text-xs text-foreground-muted truncate">{contact.email}</div>}
        {contact.signals.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {contact.signals.slice(0, 4).map((signal) => (
              <span
                key={signal}
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border text-foreground-muted"
              >
                {signalLabel(signal)}
              </span>
            ))}
          </div>
        )}
        {(contact.already_in_pool || contact.has_ligament_account || contact.is_free_email) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {contact.already_in_pool && (
              <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border text-foreground-muted">
                Already in pool
              </span>
            )}
            {contact.has_ligament_account && !contact.already_in_pool && (
              <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent">
                Has Ligament account
              </span>
            )}
            {contact.is_free_email && (
              <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border text-foreground-muted">
                Freelancer ({domain})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface EmailImportSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
}

export function EmailImportSheet({ open, onOpenChange, onImported }: EmailImportSheetProps) {
  const [view, setView] = useState<View>("loading")
  const [connection, setConnection] = useState<ConnectionInfo | null>(null)
  const [scanResults, setScanResults] = useState<ScanResults>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const preselect = (contacts: ScannedContact[]) =>
    new Set(contacts.filter((c) => c.score >= 60 && !c.already_in_pool).map((c) => c.email))

  const beginPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/agency/email-scan?provider=google", { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        setScanResults(data.scan_results ?? null)
        if (data.scan_status === "complete") {
          stopPolling()
          const results = data.scan_results as ScanResults
          setSelected(preselect(results?.contacts || []))
          setView("results")
        } else if (data.scan_status === "error") {
          stopPolling()
          setErrorMessage("The scan encountered an error.")
          setView("error")
        }
      } catch (err) {
        console.error("Scan status poll failed:", err)
      }
    }, 3000)
  }, [stopPolling])

  const loadConnectionState = useCallback(async () => {
    setView("loading")
    setErrorMessage(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setView("no_connection")
        return
      }
      const { data: conn } = await supabase
        .from("email_connections")
        .select("status, connected_at, last_scan_at, scan_status, scan_results")
        .eq("user_id", user.id)
        .eq("provider", "google")
        .maybeSingle()

      if (!conn || conn.status !== "active") {
        setConnection(null)
        setView("no_connection")
        return
      }
      setConnection({ connected_at: conn.connected_at, last_scan_at: conn.last_scan_at })

      const results = conn.scan_results as ScanResults
      if (conn.scan_status === "scanning") {
        setScanResults(results)
        setView("scanning")
        beginPolling()
      } else if (conn.scan_status === "error") {
        setScanResults(results)
        setErrorMessage("The last scan didn't complete.")
        setView("error")
      } else if (conn.scan_status === "complete" && results?.contacts?.length) {
        setScanResults(results)
        setSelected(preselect(results.contacts))
        setView("results")
      } else {
        setView("ready_to_scan")
      }
    } catch (err) {
      console.error("Failed to load email connection state:", err)
      setView("no_connection")
    }
  }, [beginPolling])

  useEffect(() => {
    if (open) {
      setImportedCount(null)
      loadConnectionState()
    } else {
      stopPolling()
    }
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startScan = async () => {
    setView("scanning")
    setErrorMessage(null)
    setScanResults(null)
    try {
      const startRes = await fetch("/api/agency/email-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      })
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) throw new Error(startData?.error || "Failed to start scan")

      const token = startData.scan_run_token
      // Fired but not awaited - the run request can take up to 120s. Progress comes from
      // polling GET /api/agency/email-scan instead, which reflects the checkpoints the run
      // endpoint writes as it works through the inbox.
      fetch(`/api/agency/email-scan/run?token=${encodeURIComponent(token)}`).catch((err) => {
        console.error("Scan run request failed:", err)
      })
      beginPolling()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start scan")
      setView("error")
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/agency/email-connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Failed to disconnect")
      }
      stopPolling()
      setConnection(null)
      setScanResults(null)
      setSelected(new Set())
      setView("no_connection")
    } catch (err) {
      console.error("Disconnect failed:", err)
      setErrorMessage(err instanceof Error ? err.message : "Failed to disconnect")
    } finally {
      setDisconnecting(false)
    }
  }

  const toggleContact = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  const eligibleContacts = (scanResults?.contacts || []).filter((c) => !c.already_in_pool)
  const selectAll = () => setSelected(new Set(eligibleContacts.map((c) => c.email)))
  const deselectAll = () => setSelected(new Set())

  const handleImport = async () => {
    const contacts = (scanResults?.contacts || [])
      .filter((c) => selected.has(c.email))
      .map((c) => ({ email: c.email, name: c.name, profile_id: c.profile_id, has_ligament_account: c.has_ligament_account }))
    if (contacts.length === 0) return
    setImporting(true)
    setErrorMessage(null)
    try {
      const res = await fetch("/api/agency/email-scan/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to add vendors")
      setImportedCount(typeof data.added === "number" ? data.added : contacts.length)
      onImported?.()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to add vendors")
    } finally {
      setImporting(false)
    }
  }

  const connectGmail = () => {
    const returnUrl = encodeURIComponent("/agency/pool?import=email")
    window.location.href = `/api/auth/google-email?returnUrl=${returnUrl}`
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-full sm:max-w-[520px] flex flex-col"
      >
        <SheetHeader>
          <SheetTitle>Import from Email</SheetTitle>
        </SheetHeader>

        {view === "loading" && (
          <div className="flex items-center justify-center py-16">
            <Spinner className="w-6 h-6 text-accent" />
          </div>
        )}

        {view === "no_connection" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
              <Mail className="w-8 h-8 text-accent mx-auto" />
              <p className="text-sm text-foreground">Connect your email to discover vendors in your inbox.</p>
            </div>
            <div className="space-y-2">
              <Button
                onClick={connectGmail}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 flex items-center justify-center gap-2"
              >
                <GoogleIcon className="w-4 h-4" />
                Connect Gmail
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button
                      disabled
                      variant="outline"
                      className="w-full flex items-center justify-center gap-2 opacity-60 cursor-not-allowed border-border text-foreground"
                    >
                      <MicrosoftIcon className="w-4 h-4" />
                      Connect Outlook
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Coming soon</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-foreground-muted leading-relaxed">
              Ligament scans email subjects and brief previews to identify vendors. Full message content is never
              read or stored.
            </p>
          </div>
        )}

        {view === "ready_to_scan" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
              <GoogleIcon className="w-6 h-6 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-display font-bold text-foreground">Gmail connected</div>
                <div className="text-xs text-foreground-muted">
                  {connection?.connected_at ? `Connected ${formatDateTime(connection.connected_at)}` : "Connected"}
                  {connection?.last_scan_at ? ` · Last scanned ${formatDateTime(connection.last_scan_at)}` : ""}
                </div>
              </div>
            </div>
            <Button onClick={startScan} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              Scan Inbox
            </Button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full text-center text-xs text-foreground-muted hover:text-red-400 transition-colors"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect Gmail"}
            </button>
          </div>
        )}

        {view === "scanning" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
              <Spinner className="w-6 h-6 mx-auto text-accent" />
              <p className="text-sm text-foreground">Scanning your inbox for vendor contacts...</p>
              <Progress
                value={Math.min(100, ((scanResults?.processed_count || 0) / MAX_MESSAGES_ESTIMATE) * 100)}
                className="h-1.5"
              />
              <p className="text-xs text-foreground-muted">
                {scanResults?.processed_count
                  ? `${scanResults.processed_count} messages processed`
                  : "Starting..."}
              </p>
            </div>
          </div>
        )}

        {view === "results" && importedCount == null && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 pb-2 flex items-center justify-between">
              <p className="text-xs text-foreground-muted">
                {scanResults?.contacts?.length || 0} vendor{scanResults?.contacts?.length !== 1 ? "s" : ""} found
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={selectAll} className="text-xs text-accent hover:underline">
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-foreground-muted hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 space-y-2">
              {(scanResults?.contacts || []).map((contact) => (
                <ContactRow
                  key={contact.email}
                  contact={contact}
                  checked={selected.has(contact.email)}
                  onToggle={() => toggleContact(contact.email)}
                />
              ))}
            </div>
            {errorMessage && <p className="px-4 py-2 text-xs text-red-400">{errorMessage}</p>}
            <div className="px-4 py-3 border-t border-border space-y-2">
              <Button
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {importing
                  ? "Adding..."
                  : `Add ${selected.size} vendor${selected.size !== 1 ? "s" : ""} to Pool`}
              </Button>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={startScan}
                  className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                >
                  Rescan Inbox
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-xs text-foreground-muted hover:text-red-400 transition-colors"
                >
                  {disconnecting ? "Disconnecting..." : "Disconnect Gmail"}
                </button>
              </div>
            </div>
          </div>
        )}

        {view === "results" && importedCount != null && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-accent/30 bg-accent/10 p-6 text-center space-y-3">
              <Check className="w-8 h-8 text-accent mx-auto" />
              <p className="text-sm font-display font-bold text-foreground">
                Added {importedCount} vendor{importedCount !== 1 ? "s" : ""} to your pool
              </p>
              <p className="text-xs text-foreground-muted">
                New vendors without a Ligament account appear in Pending Profiles.
              </p>
              <Button onClick={() => onOpenChange(false)} className="bg-accent text-accent-foreground hover:bg-accent/90">
                Done
              </Button>
            </div>
          </div>
        )}

        {view === "error" && (
          <div className="px-4 pb-4 space-y-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-center space-y-2">
              <p className="text-sm text-foreground">{errorMessage || "The scan encountered an error."}</p>
            </div>
            {scanResults?.contacts?.length ? (
              <div className="space-y-2">
                <p className="text-xs text-foreground-muted">
                  Scan partially completed - showing results from the {scanResults.processed_count} messages
                  processed before the error.
                </p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {scanResults.contacts.map((contact) => (
                    <ContactRow
                      key={contact.email}
                      contact={contact}
                      checked={false}
                      onToggle={() => {}}
                      readOnly
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <Button onClick={startScan} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              Retry Scan
            </Button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full text-center text-xs text-foreground-muted hover:text-red-400 transition-colors"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect Gmail"}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
