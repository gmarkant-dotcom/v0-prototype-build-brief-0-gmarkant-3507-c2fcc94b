"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, Check } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { cn, formatDateTime } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"

type Provider = "google" | "microsoft"

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

type ConnectionRow = {
  status: "active" | "expired" | "revoked" | null
  connected_at: string | null
  last_scan_at: string | null
  scan_status: string | null
  scan_results: ScanResults
}

type Connections = Record<Provider, ConnectionRow | null>

type View = "loading" | "connect" | "ready_to_scan" | "scanning" | "results" | "error"

const MAX_MESSAGES_ESTIMATE = 200
const EMPTY_CONNECTIONS: Connections = { google: null, microsoft: null }

function providerLabel(provider: Provider): string {
  return provider === "google" ? "Gmail" : "Outlook"
}

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

function ProviderIcon({ provider, className }: { provider: Provider; className?: string }) {
  return provider === "google" ? <GoogleIcon className={className} /> : <MicrosoftIcon className={className} />
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

/** Merges two contact lists by email, keeping whichever side scored higher for a contact
 *  seen in both - used to combine Gmail + Outlook results after "Scan All". */
function mergeContactLists(a: ScannedContact[], b: ScannedContact[]): ScannedContact[] {
  const byEmail = new Map<string, ScannedContact>()
  for (const contact of [...a, ...b]) {
    const existing = byEmail.get(contact.email)
    if (!existing || contact.score > existing.score) byEmail.set(contact.email, contact)
  }
  return Array.from(byEmail.values()).sort((x, y) => y.score - x.score)
}

interface EmailImportSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
}

export function EmailImportSheet({ open, onOpenChange, onImported }: EmailImportSheetProps) {
  const [view, setView] = useState<View>("loading")
  const [connections, setConnections] = useState<Connections>(EMPTY_CONNECTIONS)
  const [scanResults, setScanResults] = useState<ScanResults>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [disconnectingProvider, setDisconnectingProvider] = useState<Provider | null>(null)
  // Live label during a scan - "Scanning Gmail..." / "Scanning Outlook..." for Scan All,
  // just "Scanning your inbox..." for a single-provider scan.
  const [scanningLabel, setScanningLabel] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const preselect = (contacts: ScannedContact[]) =>
    new Set(contacts.filter((c) => c.score >= 60 && !c.already_in_pool).map((c) => c.email))

  /** Polls GET /api/agency/email-scan?provider=X until scan_status is complete or error.
   *  onTick fires on every poll with the latest (possibly partial) results, so callers can
   *  drive a live progress bar. Resolves with the final results, or rejects on error. */
  const pollUntilDone = useCallback(
    (provider: Provider, onTick: (results: ScanResults) => void): Promise<ScanResults> => {
      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const res = await fetch(`/api/agency/email-scan?provider=${provider}`, { cache: "no-store" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) return
            const results = (data.scan_results ?? null) as ScanResults
            onTick(results)
            if (data.scan_status === "complete") {
              clearInterval(interval)
              resolve(results)
            } else if (data.scan_status === "error") {
              clearInterval(interval)
              reject(new Error(`The ${providerLabel(provider)} scan encountered an error.`))
            }
          } catch (err) {
            console.error(`${provider} scan poll failed:`, err)
          }
        }, 3000)
      })
    },
    []
  )

  const beginSingleProviderPolling = useCallback(
    (provider: Provider) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/agency/email-scan?provider=${provider}`, { cache: "no-store" })
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
            setErrorMessage(`The ${providerLabel(provider)} scan encountered an error.`)
            setView("error")
          }
        } catch (err) {
          console.error("Scan status poll failed:", err)
        }
      }, 3000)
    },
    [stopPolling]
  )

  const loadConnectionState = useCallback(async () => {
    setView("loading")
    setErrorMessage(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setView("connect")
        return
      }
      const { data: rows } = await supabase
        .from("email_connections")
        .select("provider, status, connected_at, last_scan_at, scan_status, scan_results")
        .eq("user_id", user.id)

      const next: Connections = { google: null, microsoft: null }
      for (const row of rows || []) {
        const provider = row.provider as Provider
        if (provider !== "google" && provider !== "microsoft") continue
        next[provider] = {
          status: row.status,
          connected_at: row.connected_at,
          last_scan_at: row.last_scan_at,
          scan_status: row.scan_status,
          scan_results: row.scan_results,
        }
      }
      setConnections(next)

      const activeProviders = (["google", "microsoft"] as const).filter((p) => next[p]?.status === "active")
      if (activeProviders.length === 0) {
        setView("connect")
        return
      }

      const scanningProvider = activeProviders.find((p) => next[p]?.scan_status === "scanning")
      if (scanningProvider) {
        setScanningLabel(`Scanning ${providerLabel(scanningProvider)}...`)
        setScanResults(next[scanningProvider]?.scan_results ?? null)
        setView("scanning")
        beginSingleProviderPolling(scanningProvider)
        return
      }

      const completedResults = activeProviders
        .map((p) => next[p]?.scan_results)
        .filter((r): r is NonNullable<ScanResults> => Boolean(r?.contacts?.length))
      if (completedResults.length > 0) {
        const merged =
          completedResults.length === 1
            ? completedResults[0]
            : {
                contacts: mergeContactLists(completedResults[0].contacts, completedResults[1].contacts),
                processed_count: completedResults.reduce((sum, r) => sum + r.processed_count, 0),
                failed_count: completedResults.reduce((sum, r) => sum + r.failed_count, 0),
                complete: true,
              }
        setScanResults(merged)
        setSelected(preselect(merged.contacts))
        setView("results")
        return
      }

      setView("ready_to_scan")
    } catch (err) {
      console.error("Failed to load email connection state:", err)
      setView("connect")
    }
  }, [beginSingleProviderPolling])

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

  /** Starts a scan for one provider and returns once it completes (or throws). Used both
   *  for a plain single-provider scan and as one step of runScanAll. */
  const startProviderScan = async (provider: Provider, onTick: (results: ScanResults) => void): Promise<ScanResults> => {
    const startRes = await fetch("/api/agency/email-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
    const startData = await startRes.json().catch(() => ({}))
    if (!startRes.ok) throw new Error(startData?.error || `Failed to start ${providerLabel(provider)} scan`)

    const token = startData.scan_run_token
    // Fired but not awaited - the run request can take up to 120s. Progress comes from
    // polling GET /api/agency/email-scan instead, which reflects the checkpoints the run
    // endpoint writes as it works through the inbox.
    fetch(`/api/agency/email-scan/run?token=${encodeURIComponent(token)}&provider=${provider}`).catch((err) => {
      console.error("Scan run request failed:", err)
    })
    return pollUntilDone(provider, onTick)
  }

  const startScan = async (provider: Provider) => {
    setView("scanning")
    setErrorMessage(null)
    setScanResults(null)
    setScanningLabel(`Scanning your ${providerLabel(provider)} inbox...`)
    try {
      const startRes = await fetch("/api/agency/email-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) throw new Error(startData?.error || "Failed to start scan")

      const token = startData.scan_run_token
      fetch(`/api/agency/email-scan/run?token=${encodeURIComponent(token)}&provider=${provider}`).catch((err) => {
        console.error("Scan run request failed:", err)
      })
      beginSingleProviderPolling(provider)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start scan")
      setView("error")
    }
  }

  /** Runs both providers sequentially (not in parallel) - scan one to completion,
   *  checkpointing/polling live, then start the next. Avoids two long-running serverless
   *  scans racing against maxDuration at the same time. */
  const runScanAll = async () => {
    stopPolling()
    setView("scanning")
    setErrorMessage(null)
    setScanResults(null)
    const providers: Provider[] = ["google", "microsoft"]
    const resultsByProvider: Partial<Record<Provider, ScanResults>> = {}

    for (const provider of providers) {
      setScanningLabel(
        providers
          .map((p) => {
            if (p === provider) return `Scanning ${providerLabel(p)}...`
            if (resultsByProvider[p]) return `${providerLabel(p)} done.`
            return null
          })
          .filter(Boolean)
          .join(" ")
      )
      try {
        const results = await startProviderScan(provider, (partial) => {
          // Live progress for the provider currently scanning, keeping any already-
          // completed provider's contacts visible underneath rather than blanking them.
          const already = Object.values(resultsByProvider).filter((r): r is NonNullable<ScanResults> => Boolean(r))
          const combined = already.reduce<ScannedContact[]>((acc, r) => mergeContactLists(acc, r.contacts), [])
          setScanResults({
            contacts: mergeContactLists(combined, partial?.contacts || []),
            processed_count: already.reduce((sum, r) => sum + r.processed_count, 0) + (partial?.processed_count || 0),
            failed_count: already.reduce((sum, r) => sum + r.failed_count, 0) + (partial?.failed_count || 0),
            complete: false,
          })
        })
        resultsByProvider[provider] = results
      } catch (err) {
        console.error(`${provider} scan failed during Scan All:`, err)
        setErrorMessage(err instanceof Error ? err.message : `The ${providerLabel(provider)} scan failed`)
        // Continue to the next provider rather than aborting the whole run - partial
        // results from a failed provider are still worth showing.
      }
    }

    const completed = providers
      .map((p) => resultsByProvider[p])
      .filter((r): r is NonNullable<ScanResults> => Boolean(r))
    if (completed.length === 0) {
      setView("error")
      return
    }
    const merged =
      completed.length === 1
        ? completed[0]
        : {
            contacts: mergeContactLists(completed[0].contacts, completed[1].contacts),
            processed_count: completed.reduce((sum, r) => sum + r.processed_count, 0),
            failed_count: completed.reduce((sum, r) => sum + r.failed_count, 0),
            complete: true,
          }
    setScanResults(merged)
    setSelected(preselect(merged.contacts))
    setView("results")
  }

  const handleDisconnect = async (provider: Provider) => {
    setDisconnectingProvider(provider)
    try {
      const res = await fetch("/api/agency/email-connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Failed to disconnect")
      }
      stopPolling()
      setScanResults(null)
      setSelected(new Set())
      await loadConnectionState()
    } catch (err) {
      console.error("Disconnect failed:", err)
      setErrorMessage(err instanceof Error ? err.message : "Failed to disconnect")
    } finally {
      setDisconnectingProvider(null)
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

  const connectProvider = (provider: Provider) => {
    const returnUrl = encodeURIComponent("/agency/pool?import=email")
    const path = provider === "google" ? "/api/auth/google-email" : "/api/auth/microsoft-email"
    window.location.href = `${path}?returnUrl=${returnUrl}`
  }

  const activeProviders = (["google", "microsoft"] as const).filter((p) => connections[p]?.status === "active")

  const DisconnectLinks = () => (
    <div className="flex items-center justify-center gap-4">
      {activeProviders.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => handleDisconnect(provider)}
          disabled={disconnectingProvider === provider}
          className="text-xs text-foreground-muted hover:text-red-400 transition-colors"
        >
          {disconnectingProvider === provider ? "Disconnecting..." : `Disconnect ${providerLabel(provider)}`}
        </button>
      ))}
    </div>
  )

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

        {view === "connect" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
              <Mail className="w-8 h-8 text-accent mx-auto" />
              <p className="text-sm text-foreground">Connect your email to discover vendors in your inbox.</p>
            </div>
            <div className="space-y-2">
              {(["google", "microsoft"] as const).map((provider) => {
                const row = connections[provider]
                const isExpired = row?.status === "expired"
                return (
                  <Button
                    key={provider}
                    onClick={() => connectProvider(provider)}
                    variant={provider === "google" ? "default" : "outline"}
                    className={cn(
                      "w-full flex items-center justify-center gap-2",
                      provider === "google" && "bg-accent text-accent-foreground hover:bg-accent/90",
                      provider === "microsoft" && "border-border text-foreground"
                    )}
                  >
                    <ProviderIcon provider={provider} className="w-4 h-4" />
                    {isExpired ? `Reconnect ${providerLabel(provider)}` : `Connect ${providerLabel(provider)}`}
                  </Button>
                )
              })}
            </div>
            <p className="text-xs text-foreground-muted leading-relaxed">
              Ligament scans email subjects and brief previews to identify vendors. Full message content is never
              read or stored.
            </p>
          </div>
        )}

        {view === "ready_to_scan" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="space-y-2">
              {activeProviders.map((provider) => {
                const row = connections[provider]
                return (
                  <div key={provider} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                    <ProviderIcon provider={provider} className="w-6 h-6 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-display font-bold text-foreground">
                        {providerLabel(provider)} connected
                      </div>
                      <div className="text-xs text-foreground-muted">
                        {row?.connected_at ? `Connected ${formatDateTime(row.connected_at)}` : "Connected"}
                        {row?.last_scan_at ? ` · Last scanned ${formatDateTime(row.last_scan_at)}` : ""}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {activeProviders.length === 1 ? (
              <Button
                onClick={() => startScan(activeProviders[0])}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Scan Inbox
              </Button>
            ) : (
              <div className="space-y-2">
                <Button
                  onClick={() => startScan("google")}
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2 border-border text-foreground"
                >
                  <GoogleIcon className="w-4 h-4" />
                  Scan Gmail
                </Button>
                <Button
                  onClick={() => startScan("microsoft")}
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2 border-border text-foreground"
                >
                  <MicrosoftIcon className="w-4 h-4" />
                  Scan Outlook
                </Button>
                <Button onClick={runScanAll} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                  Scan All
                </Button>
              </div>
            )}

            <DisconnectLinks />

            {(["google", "microsoft"] as const)
              .filter((p) => !activeProviders.includes(p))
              .map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => connectProvider(provider)}
                  className="w-full text-center text-xs text-foreground-muted hover:text-foreground transition-colors flex items-center justify-center gap-2"
                >
                  <ProviderIcon provider={provider} className="w-3.5 h-3.5" />
                  {connections[provider]?.status === "expired"
                    ? `Reconnect ${providerLabel(provider)}`
                    : `Connect ${providerLabel(provider)}`}
                </button>
              ))}
          </div>
        )}

        {view === "scanning" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
              <Spinner className="w-6 h-6 mx-auto text-accent" />
              <p className="text-sm text-foreground">{scanningLabel || "Scanning your inbox for vendor contacts..."}</p>
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
                {activeProviders.length > 1 ? (
                  <button
                    type="button"
                    onClick={runScanAll}
                    className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Rescan All
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startScan(activeProviders[0])}
                    className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Rescan Inbox
                  </button>
                )}
                <DisconnectLinks />
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
            <Button
              onClick={() => (activeProviders.length > 1 ? runScanAll() : startScan(activeProviders[0]))}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Retry Scan
            </Button>
            <DisconnectLinks />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
