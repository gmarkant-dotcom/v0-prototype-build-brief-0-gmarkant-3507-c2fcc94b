"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import type { PartnerRateInfoPayload } from "@/lib/partner-rate-info-read"
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Shield,
  Star,
  Video,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const PAYMENT_TERM_LABELS: Record<string, string> = {
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  net_60: "Net 60",
  net_90: "Net 90",
  due_on_receipt: "Due on receipt",
  custom: "Custom",
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

function paymentTermsLabel(ri: PartnerRateInfoPayload): string {
  if (ri.payment_terms === "custom" && ri.payment_terms_custom?.trim()) {
    return ri.payment_terms_custom.trim()
  }
  return PAYMENT_TERM_LABELS[ri.payment_terms] || ri.payment_terms || "—"
}

function websiteHref(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  return `https://${u}`
}

type NotesLogEntry = {
  text: string
  timestamp: string
}

type PartnershipNotesShape = {
  notes?: string
  notes_log?: NotesLogEntry[]
  overall_rating?: number | null
  would_work_again?: boolean | null
  blacklisted?: boolean
}

function initials(company: string | null | undefined, full: string | null | undefined): string {
  const src = (company || full || "").trim()
  if (!src) return "P"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

type ProfilePayload = {
  partnership: { id: string; status: string; nda_confirmed_at: string | null }
  partner: {
    id: string
    full_name: string | null
    company_name: string | null
    display_name: string | null
    email: string | null
    bio: string
    location: string | null
    website: string | null
    agency_type: string | null
    avatar_url: string | null
    meeting_url: string | null
    rate_info: PartnerRateInfoPayload
    tags: string[]
  }
  engagement_history: Array<{
    id: string
    status: string
    scope_item_name: string
    project_name: string
    awarded_amount: number | null
    currency: string
  }>
}

export default function AgencyPartnerProfilePage() {
  const params = useParams()
  const router = useRouter()
  const partnerId = typeof params?.partnerId === "string" ? params.partnerId : ""
  const isDemo = isDemoMode()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfilePayload | null>(null)

  const [notesState, setNotesState] = useState<PartnershipNotesShape>({})
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [blacklistDialogOpen, setBlacklistDialogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!partnerId || isDemo) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [prRes, nRes] = await Promise.all([
        fetch(`/api/agency/pool/${encodeURIComponent(partnerId)}`, { credentials: "same-origin" }),
        fetch(`/api/agency/pool/${encodeURIComponent(partnerId)}/notes`, { credentials: "same-origin" }),
      ])
      if (!prRes.ok) {
        const j = await prRes.json().catch(() => ({}))
        setError((j as { error?: string }).error || "Could not load partner profile")
        setProfile(null)
        setLoading(false)
        return
      }
      const pr = (await prRes.json()) as ProfilePayload
      setProfile(pr)
      if (nRes.ok) {
        const n = (await nRes.json()) as { notes?: PartnershipNotesShape }
        setNotesState(n.notes || {})
      } else {
        setNotesState({})
      }
    } catch {
      setError("Failed to load profile")
      setProfile(null)
    }
    setLoading(false)
  }, [partnerId, isDemo])

  useEffect(() => {
    load()
  }, [load])

  const saveNotes = async () => {
    if (!partnerId || isDemo) return
    setSavingNotes(true)
    setNotesSaved(false)
    try {
      const res = await fetch(`/api/agency/pool/${encodeURIComponent(partnerId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          notes: notesState.notes ?? "",
          overall_rating: notesState.overall_rating ?? null,
          would_work_again: notesState.would_work_again ?? null,
          blacklisted: notesState.blacklisted ?? false,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError((j as { error?: string }).error || "Save failed")
        return
      }
      const j = (await res.json()) as { notes: PartnershipNotesShape }
      setNotesState(j.notes || {})
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2500)
    } catch {
      setError("Save failed")
    } finally {
      setSavingNotes(false)
    }
  }

  if (isDemo) {
    return (
      <AgencyLayout>
        <div className="p-8 max-w-4xl mx-auto">
          <Link
            href="/agency/pool"
            className="inline-flex items-center gap-2 font-mono text-xs text-foreground-muted hover:text-accent mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Partner Pool
          </Link>
          <GlassCard className="p-8 text-center">
            <p className="text-foreground-muted">
              Partner profile pages load from your live partner relationships. Switch out of demo mode to view a
              profile.
            </p>
            <Button className="mt-6 bg-accent text-accent-foreground" onClick={() => router.push("/agency/pool")}>
              Return to pool
            </Button>
          </GlassCard>
        </div>
      </AgencyLayout>
    )
  }

  if (loading) {
    return (
      <AgencyLayout>
        <div className="p-8 max-w-6xl mx-auto flex items-center justify-center gap-2 text-foreground-muted py-24">
          <Loader2 className="w-6 h-6 animate-spin shrink-0" />
          Loading partner…
        </div>
      </AgencyLayout>
    )
  }

  if (error || !profile) {
    return (
      <AgencyLayout>
        <div className="p-8 max-w-4xl mx-auto">
          <Link
            href="/agency/pool"
            className="inline-flex items-center gap-2 font-mono text-xs text-foreground-muted hover:text-accent mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Partner Pool
          </Link>
          <GlassCard className="p-8 border-red-500/20">
            <p className="text-red-300">{error || "Partner not found"}</p>
          </GlassCard>
        </div>
      </AgencyLayout>
    )
  }

  const p = profile.partner
  const displayCompany = (p.company_name || "").trim()
  const displayPerson = (p.full_name || "").trim()
  const headerTitle = displayCompany || displayPerson || p.display_name?.trim() || "Partner"
  const subTitle = displayCompany && displayPerson ? displayPerson : p.email || ""
  const web = websiteHref(p.website)
  const meet = websiteHref(p.meeting_url)
  const ndaOk = !!profile.partnership.nda_confirmed_at
  const ri = p.rate_info

  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <Link
          href="/agency/pool"
          className="inline-flex items-center gap-2 font-mono text-xs text-foreground-muted hover:text-accent"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Partner Pool
        </Link>

        {/* Header */}
        <GlassCard className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            <div className="shrink-0">
              {p.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.avatar_url}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover border border-border"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center font-display font-bold text-2xl text-accent">
                  {initials(p.company_name, p.full_name)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display font-black text-3xl text-foreground tracking-tight">{headerTitle}</h1>
                {p.agency_type?.trim() && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-border bg-white/5 text-foreground-muted uppercase tracking-wider">
                    {p.agency_type}
                  </span>
                )}
                <span
                  className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider",
                    ndaOk ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  )}
                >
                  <Shield className="w-3 h-3 inline mr-1 align-text-bottom" />
                  {ndaOk ? "NDA signed" : "NDA pending"}
                </span>
              </div>
              {subTitle && <p className="text-foreground-muted text-sm">{subTitle}</p>}
              {p.email && (
                <p className="font-mono text-sm text-accent">
                  <a href={`mailto:${p.email}`} className="hover:underline">
                    {p.email}
                  </a>
                </p>
              )}
              <div className="flex flex-wrap gap-4 text-sm text-foreground-muted">
                {p.location?.trim() && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 shrink-0" />
                    {p.location}
                  </span>
                )}
                {web && (
                  <a
                    href={web}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-accent hover:underline"
                  >
                    <Globe className="w-4 h-4 shrink-0" />
                    Website
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {meet && (
                <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 w-fit">
                  <a href={meet} target="_blank" rel="noopener noreferrer">
                    <Video className="w-4 h-4 mr-2" />
                    Meeting link
                  </a>
                </Button>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Three columns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <GlassCard className="p-6">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted mb-4">
              Capabilities & Bio
            </h2>
            <p className="text-sm text-foreground whitespace-pre-wrap mb-4">
              {p.bio?.trim() ? p.bio : "No bio provided."}
            </p>
            {p.agency_type?.trim() && (
              <p className="text-xs text-foreground-muted mb-2">
                <span className="font-mono text-foreground-muted uppercase">Type: </span>
                {p.agency_type}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {p.tags.length > 0 ? (
                p.tags.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-foreground-muted border border-border"
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span className="font-mono text-[10px] text-foreground-muted">No tags on file</span>
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted mb-4">
              Rate information
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-mono text-[10px] text-foreground-muted uppercase">Hourly rate</dt>
                <dd className="text-foreground">{ri.hourly_rate?.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] text-foreground-muted uppercase">Project minimum</dt>
                <dd className="text-foreground">{ri.project_minimum?.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] text-foreground-muted uppercase">Payment terms</dt>
                <dd className="text-foreground">{paymentTermsLabel(ri)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] text-foreground-muted uppercase">Notes</dt>
                <dd className="text-foreground whitespace-pre-wrap">{ri.notes?.trim() || "—"}</dd>
              </div>
            </dl>
          </GlassCard>

          <GlassCard className="p-6 lg:col-span-1">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted mb-4">
              Engagement history
            </h2>
            {profile.engagement_history.length === 0 ? (
              <p className="text-sm text-foreground-muted">No awarded scopes yet.</p>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {profile.engagement_history.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border bg-white/5 p-3 text-sm space-y-1"
                  >
                    <div className="font-medium text-foreground">{row.project_name}</div>
                    <div className="font-mono text-xs text-foreground-muted">{row.scope_item_name}</div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="font-mono text-xs text-accent">
                        {formatMoney(row.awarded_amount, row.currency)}
                      </span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 capitalize">
                        {row.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Agency notes */}
        <GlassCard className="p-6 md:p-8 border-amber-500/20">
          <h2 className="font-display font-bold text-lg text-foreground mb-1">Agency notes</h2>
          <p className="font-mono text-[10px] text-amber-400/90 uppercase tracking-wider mb-6">
            Private to your agency — not visible to the partner
          </p>

          <div className="space-y-5">
            <div>
              <Label className="font-mono text-[10px] text-foreground-muted uppercase">Notes</Label>
              <Textarea
                value={notesState.notes ?? ""}
                onChange={(e) => setNotesState((s) => ({ ...s, notes: e.target.value }))}
                rows={4}
                className="mt-1.5 bg-white/5 border-border text-foreground"
                placeholder="Internal notes about this partner…"
              />
              {Array.isArray(notesState.notes_log) && notesState.notes_log.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider">
                    Notes history ({notesState.notes_log.length})
                  </div>
                  <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {[...notesState.notes_log].reverse().map((entry, idx) => (
                      <div key={idx} className="rounded-lg border border-border/50 bg-white/5 p-3">
                        <div className="font-mono text-[9px] text-foreground-muted mb-1">
                          {new Date(entry.timestamp).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{entry.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                Overall rating
              </Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      setNotesState((s) => ({
                        ...s,
                        overall_rating: s.overall_rating === n ? null : n,
                      }))
                    }
                    className="p-1 rounded hover:bg-white/5"
                    aria-label={`${n} stars`}
                  >
                    <Star
                      className={cn(
                        "w-7 h-7",
                        (notesState.overall_rating ?? 0) >= n
                          ? "fill-amber-400 text-amber-400"
                          : "text-foreground-muted"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="font-mono text-[10px] text-foreground-muted uppercase block mb-2">
                Would work with again
              </Label>
              <div className="flex gap-2">
                {(
                  [
                    { v: true, label: "Yes" },
                    { v: false, label: "No" },
                  ] as const
                ).map(({ v, label }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      notesState.would_work_again === v && "border-accent bg-accent/10 text-accent"
                    )}
                    onClick={() => setNotesState((s) => ({ ...s, would_work_again: s.would_work_again === v ? null : v }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
              <div className="flex items-center gap-3">
                <Label className="font-mono text-[10px] text-foreground-muted uppercase">Blacklist</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    notesState.blacklisted && "border-red-500/50 bg-red-500/10 text-red-300"
                  )}
                  onClick={() => {
                    if (notesState.blacklisted) {
                      setNotesState((s) => ({ ...s, blacklisted: false }))
                      return
                    }
                    setBlacklistDialogOpen(true)
                  }}
                >
                  {notesState.blacklisted ? "Blacklisted (click to clear)" : "Mark blacklisted"}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {notesSaved && <span className="text-xs text-emerald-400">Saved</span>}
                <Button
                  type="button"
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {savingNotes ? "Saving…" : "Save notes"}
                </Button>
              </div>
            </div>
          </div>
        </GlassCard>

        <Dialog open={blacklistDialogOpen} onOpenChange={setBlacklistDialogOpen}>
          <DialogContent className="bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="font-display">Blacklist this partner?</DialogTitle>
              <DialogDescription className="text-foreground-muted">
                This flag is stored in your private agency notes. Confirm to mark the partner as blacklisted for your
                team&apos;s reference.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setBlacklistDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  setNotesState((s) => ({ ...s, blacklisted: true }))
                  setBlacklistDialogOpen(false)
                }}
              >
                Confirm blacklist
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AgencyLayout>
  )
}
