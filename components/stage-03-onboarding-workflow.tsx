"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { StageHeader } from "@/components/stage-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { usePaidUser } from "@/contexts/paid-user-context"
import { EmptyState } from "@/components/empty-state"
import { createClient } from "@/lib/supabase/client"
import { cn, normalizeMeetingUrlForHref } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { Loader2, Send, Link2, Upload, Plus, Trash2 } from "lucide-react"

type OnboardingPartnerRow = {
  assignmentId: string | null
  partnershipId: string
  status: string
  source: "assignment" | "awarded_bid"
  partner: {
    id: string
    email: string | null
    full_name: string | null
    company_name: string | null
  } | null
  scopeLabel: string | null
}

function partnerOptionKey(p: OnboardingPartnerRow): string {
  return p.assignmentId ? `a:${p.assignmentId}` : `p:${p.partnershipId}`
}

type LibraryRow = {
  id: string
  section: string
  kind: string
  label: string
  source_type: string
  external_url: string | null
  blob_url: string | null
  file_name: string | null
  updated_at: string
}

type ProjectAttach = { localId: string; label: string; urlInput: string; storedUrl: string | null; source: "url" | "file" }

type MsaAgreement = {
  id: string
  partnership_id: string
  status: string
  document_url: string | null
  signed_at: string | null
  created_at: string
}

function newAttach(): ProjectAttach {
  return {
    localId: typeof crypto !== "undefined" ? crypto.randomUUID() : `a-${Date.now()}`,
    label: "",
    urlInput: "",
    storedUrl: null,
    source: "url",
  }
}

function libraryUrl(row: LibraryRow): string {
  if (row.source_type === "url" && row.external_url) return row.external_url
  return row.blob_url || ""
}

function msaStatusBadge(status: string) {
  const s = status.toLowerCase()
  const base = "font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
  if (s === "signed") return cn(base, "border-emerald-500/50 bg-emerald-500/15 text-emerald-200")
  if (s === "sent") return cn(base, "border-amber-500/50 bg-amber-500/15 text-amber-200")
  if (s === "expired") return cn(base, "border-red-500/50 bg-red-500/15 text-red-200")
  return cn(base, "border-border bg-white/5 text-foreground-muted")
}

export function Stage03OnboardingWorkflow() {
  const { checkFeatureAccess } = usePaidUser()
  const searchParams = useSearchParams()
  const qProjectId = searchParams.get("projectId")
  const missedProjectRefreshRef = useRef(false)
  const { selectedProject, setSelectedProject, projects, refreshProjects } = useSelectedProject()
  const [onboardingPartners, setOnboardingPartners] = useState<OnboardingPartnerRow[]>([])
  const [library, setLibrary] = useState<LibraryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadLib, setLoadLib] = useState(false)
  const [partnerSelectionKey, setPartnerSelectionKey] = useState("")
  const [selectedLibIds, setSelectedLibIds] = useState<string[]>([])
  const [projectItems, setProjectItems] = useState<ProjectAttach[]>([])
  const [kickoffType, setKickoffType] = useState<"calendly" | "availability" | "none">("none")
  const [kickoffUrl, setKickoffUrl] = useState("")
  const [kickoffAvailability, setKickoffAvailability] = useState("")
  const [customMessage, setCustomMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [uploadingAttach, setUploadingAttach] = useState<string | null>(null)
  const [meetingUrlProfile, setMeetingUrlProfile] = useState<string | null>(null)
  const [agreements, setAgreements] = useState<MsaAgreement[]>([])
  const [docUrlDraft, setDocUrlDraft] = useState<Record<string, string>>({})
  const [savingMsa, setSavingMsa] = useState<string | null>(null)
  const [msaError, setMsaError] = useState<string | null>(null)

  useEffect(() => {
    missedProjectRefreshRef.current = false
  }, [qProjectId])

  useEffect(() => {
    const pid = qProjectId?.trim()
    if (!pid || isDemoMode()) return
    const match = projects.find((p) => p.id === pid)
    if (match && selectedProject?.id !== pid) {
      setSelectedProject(match)
    }
  }, [qProjectId, projects, selectedProject?.id, setSelectedProject])

  useEffect(() => {
    const pid = qProjectId?.trim()
    if (!pid || isDemoMode()) return
    if (projects.some((p) => p.id === pid)) return
    if (missedProjectRefreshRef.current) return
    missedProjectRefreshRef.current = true
    void refreshProjects()
  }, [qProjectId, projects, refreshProjects])

  const loadOnboardingPartners = useCallback(async () => {
    if (!selectedProject?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/onboarding-partners`, {
        credentials: "same-origin",
      })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        console.error("[onboarding] onboarding-partners fetch failed", {
          projectId: selectedProject.id,
          status: res.status,
          bodyPreview: bodyText.slice(0, 500),
        })
        return
      }
      const data = await res.json().catch(() => ({}))
      const rows = (data.partners || []) as OnboardingPartnerRow[]
      setOnboardingPartners(rows)
      const awarded = rows.find((a) => a.status === "awarded")
      const first = awarded || rows[0]
      if (first) {
        setPartnerSelectionKey(partnerOptionKey(first))
      } else {
        setPartnerSelectionKey("")
      }
    } finally {
      setLoading(false)
    }
  }, [selectedProject?.id])

  const refreshLibrary = useCallback(async () => {
    setLoadLib(true)
    try {
      const res = await fetch("/api/agency/library-documents", { credentials: "same-origin" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setLibrary((data.documents || []) as LibraryRow[])
      } else {
        console.error("[onboarding] library-documents fetch failed", {
          status: res.status,
          error: (data as { error?: string }).error,
        })
      }
    } finally {
      setLoadLib(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedProject?.id) return
    void loadOnboardingPartners()
  }, [selectedProject?.id, loadOnboardingPartners])

  useEffect(() => {
    refreshLibrary()
  }, [refreshLibrary])

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser()
      if (authErr) {
        console.error("[onboarding] profiles meeting_url: auth.getUser failed", {
          message: authErr.message,
        })
        return
      }
      const uid = user?.id || ""
      if (!uid) return
      const { data, error } = await supabase.from("profiles").select("meeting_url").eq("id", uid).maybeSingle()
      if (error) {
        console.error("[onboarding] profiles meeting_url select failed", {
          userId: uid,
          message: error.message,
          code: error.code,
        })
        return
      }
      if (data?.meeting_url) {
        setMeetingUrlProfile(data.meeting_url)
        setKickoffUrl((u) => u || data.meeting_url || "")
      }
    })()
  }, [])

  useEffect(() => {
    if (kickoffType === "calendly" && meetingUrlProfile && !kickoffUrl) {
      setKickoffUrl(meetingUrlProfile)
    }
  }, [kickoffType, meetingUrlProfile, kickoffUrl])

  const selectedPartnerRow = useMemo(
    () => onboardingPartners.find((p) => partnerOptionKey(p) === partnerSelectionKey),
    [onboardingPartners, partnerSelectionKey]
  )

  const latestAgreementByPartnership = useMemo(() => {
    const map = new Map<string, MsaAgreement>()
    const sorted = [...agreements].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    for (const agreement of sorted) {
      if (!map.has(agreement.partnership_id)) {
        map.set(agreement.partnership_id, agreement)
      }
    }
    return map
  }, [agreements])

  const partnershipId = selectedPartnerRow?.partnershipId
  const assignmentIdForSend = selectedPartnerRow?.assignmentId ?? ""
  const selectedPartnerAgreement = partnershipId ? latestAgreementByPartnership.get(partnershipId) : undefined

  const agencyDocs = useMemo(() => library.filter((d) => d.section === "agency"), [library])
  const templateDocs = useMemo(() => library.filter((d) => d.section === "templates"), [library])

  const toggleLib = (id: string) => {
    setSelectedLibIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const uploadForAttach = async (localId: string, file: File) => {
    setUploadingAttach(localId)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "onboarding-project")
      const res = await fetch("/api/upload", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string }
      if (!res.ok) {
        throw new Error(data?.error || `Upload failed (${res.status})`)
      }
      if (!data.url) {
        throw new Error("Upload succeeded but no file URL was returned")
      }
      setProjectItems((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, storedUrl: data.url as string, urlInput: "", source: "file" }
            : p
        )
      )
    } catch (e) {
      console.error("[onboarding] /api/upload failed", {
        localId,
        message: e instanceof Error ? e.message : String(e),
      })
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploadingAttach(null)
    }
  }

  const loadMsaAgreements = useCallback(async () => {
    setMsaError(null)
    try {
      const res = await fetch("/api/agency/msa", { credentials: "same-origin" })
      const data = (await res.json().catch(() => ({}))) as { agreements?: MsaAgreement[]; error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to load MSA agreements")
      }
      setAgreements(data.agreements || [])
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load MSA agreements"
      setMsaError(message)
    }
  }, [])

  useEffect(() => {
    void loadMsaAgreements()
  }, [loadMsaAgreements])

  const createMsa = async (targetPartnershipId: string) => {
    setSavingMsa(targetPartnershipId)
    setMsaError(null)
    try {
      const res = await fetch("/api/agency/msa", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnership_id: targetPartnershipId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create MSA record")
      await loadMsaAgreements()
    } catch (e) {
      setMsaError(e instanceof Error ? e.message : "Failed to create MSA record")
    } finally {
      setSavingMsa(null)
    }
  }

  const patchMsa = async (id: string, patch: Record<string, unknown>) => {
    setSavingMsa(id)
    setMsaError(null)
    try {
      const res = await fetch("/api/agency/msa", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to update MSA")
      await loadMsaAgreements()
    } catch (e) {
      setMsaError(e instanceof Error ? e.message : "Failed to update MSA")
    } finally {
      setSavingMsa(null)
    }
  }

  const saveDocumentUrl = async (agreement: MsaAgreement) => {
    const url = (docUrlDraft[agreement.id] ?? agreement.document_url ?? "").trim()
    await patchMsa(agreement.id, { document_url: url || null })
  }

  const handleSaveSend = async () => {
    setError(null)
    setSuccess(null)
    if (!checkFeatureAccess("onboarding package send")) return
    if (!selectedProject?.id || !partnershipId) {
      setError("Select a partner assignment.")
      return
    }

    const docs: { documentRole: "agency_doc" | "project_doc" | "template"; libraryDocumentId: string | null; label: string; url: string }[] = []

    for (const id of selectedLibIds) {
      const row = library.find((l) => l.id === id)
      if (!row) continue
      const u = libraryUrl(row)
      if (!u) continue
      const role: "agency_doc" | "template" = row.section === "agency" ? "agency_doc" : "template"
      docs.push({
        documentRole: role,
        libraryDocumentId: row.id,
        label: row.label,
        url: u,
      })
    }

    for (const p of projectItems) {
      const raw = p.source === "file" ? (p.storedUrl || "").trim() : p.urlInput.trim()
      if (!p.label.trim() || !raw) continue
      const url = normalizeMeetingUrlForHref(raw) || raw
      docs.push({
        documentRole: "project_doc",
        libraryDocumentId: null,
        label: p.label.trim(),
        url,
      })
    }

    const projectCount = docs.filter((d) => d.documentRole === "project_doc").length
    if (projectCount > 10) {
      setError("Maximum 10 project documents.")
      return
    }

    setSending(true)
    try {
      const onboardingUrl = `/api/projects/${selectedProject.id}/onboarding-packages`
      const res = await fetch(onboardingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          partnershipId,
          assignmentId: assignmentIdForSend || undefined,
          kickoffType,
          kickoffUrl:
            kickoffType === "calendly" ? normalizeMeetingUrlForHref(kickoffUrl.trim()) || kickoffUrl.trim() : "",
          kickoffAvailability: kickoffType === "availability" ? kickoffAvailability : "",
          customMessage,
          documents: docs,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = (data?.error as string) || `Save failed (${res.status})`
        console.error("[onboarding] POST onboarding-packages failed", {
          projectId: selectedProject.id,
          partnershipId,
          assignmentId: assignmentIdForSend,
          status: res.status,
          error: msg,
        })
        setError(msg)
        return
      }
      setSuccess("Onboarding package sent. Your partner was emailed and can open /partner/onboarding.")
      setSelectedLibIds([])
      setProjectItems([])
      setCustomMessage("")
    } catch (e) {
      console.error("[onboarding] POST onboarding-packages threw", {
        projectId: selectedProject.id,
        partnershipId,
        assignmentId: assignmentIdForSend,
        message: e instanceof Error ? e.message : String(e),
      })
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setSending(false)
    }
  }

  if (!selectedProject) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="03"
          title="Onboarding + Ways of Working"
          subtitle="Build onboarding packages from your document library and send to assigned partners."
          aiPowered={false}
        />
        <EmptyState
          title="Select a project"
          description="Choose a project from the sidebar to send onboarding materials."
          icon="onboarding"
        />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="03"
        title="Onboarding + Ways of Working"
        subtitle="Select agency library documents, add project files or links, set kickoff preferences, and send to a partner."
        aiPowered={false}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-foreground-muted py-12">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading…
        </div>
      ) : onboardingPartners.length === 0 ? (
        <EmptyState
          title="No awarded partner found for onboarding"
          description="Award a bid in Bid Management (with the broadcast linked to this project), or ensure an active project assignment exists. Awarded bids without an assignment row still appear here when the inbox is tied to this project."
          icon="onboarding"
        />
      ) : (
        <div className="space-y-6 mt-6">
          <GlassCard className="p-6 space-y-4">
            <GlassCardHeader title="Partner" description="One package per send — pick the partner (assignment or awarded bid)." />
            <div className="space-y-2">
              <Label>Partner</Label>
              <Select value={partnerSelectionKey} onValueChange={setPartnerSelectionKey}>
                <SelectTrigger className="bg-white/5 border-border">
                  <SelectValue placeholder="Select partner" />
                </SelectTrigger>
                <SelectContent>
                  {onboardingPartners.map((a) => {
                    const name =
                      a.partner?.company_name?.trim() ||
                      a.partner?.full_name?.trim() ||
                      a.partner?.email?.trim() ||
                      "Partner"
                    const scope = a.scopeLabel ? ` · ${a.scopeLabel}` : ""
                    const src = a.source === "awarded_bid" ? "awarded bid" : a.status
                    return (
                      <SelectItem key={partnerOptionKey(a)} value={partnerOptionKey(a)}>
                        {name} ({src}){scope}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <GlassCardHeader
              title="Agency documents"
              description="From your library (NDA, MSA, SOW). Upload missing files under Agency → Documents."
            />
            {loadLib ? (
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
            ) : agencyDocs.length === 0 ? (
              <p className="text-sm text-foreground-muted font-mono">
                No agency library documents yet. Add NDA / MSA / SOW on the Documents page.
              </p>
            ) : (
              <div className="space-y-2">
                {agencyDocs.map((d) => {
                  const u = libraryUrl(d)
                  const disabled = !u
                  return (
                    <label
                      key={d.id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border border-border/60 p-3",
                        disabled && "opacity-50"
                      )}
                    >
                      <Checkbox
                        checked={selectedLibIds.includes(d.id)}
                        onCheckedChange={() => !disabled && toggleLib(d.id)}
                        disabled={disabled}
                      />
                      <div>
                        <div className="font-display font-semibold text-foreground">{d.label}</div>
                        <div className="font-mono text-[10px] text-foreground-muted uppercase">{d.kind}</div>
                        {!u && <div className="text-xs text-amber-400 mt-1">No file or URL on record</div>}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <GlassCardHeader
              title="Templates (optional)"
              description="Include key templates from your library in this package."
            />
            {templateDocs.length === 0 ? (
              <p className="text-sm text-foreground-muted font-mono">No template rows in library yet.</p>
            ) : (
              <div className="space-y-2">
                {templateDocs.map((d) => {
                  const u = libraryUrl(d)
                  const disabled = !u
                  return (
                    <label
                      key={d.id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border border-border/60 p-3",
                        disabled && "opacity-50"
                      )}
                    >
                      <Checkbox
                        checked={selectedLibIds.includes(d.id)}
                        onCheckedChange={() => !disabled && toggleLib(d.id)}
                        disabled={disabled}
                      />
                      <div>
                        <div className="font-display font-semibold text-foreground">{d.label}</div>
                        <div className="font-mono text-[10px] text-foreground-muted">{d.kind}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <GlassCardHeader
              title="Project documents"
              description="Up to 10 items — paste a link or upload PDF/DOCX (same pattern as partner bid attachments)."
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-border/60"
                disabled={projectItems.length >= 10}
                onClick={() => setProjectItems((prev) => [...prev, newAttach()])}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add item
              </Button>
            </div>
            <div className="space-y-4">
              {projectItems.map((p) => (
                <div key={p.localId} className="rounded-lg border border-border/60 p-4 space-y-3 bg-white/5">
                  <div className="flex justify-between gap-2">
                    <Input
                      placeholder="Label (e.g. Creative Brief)"
                      value={p.label}
                      onChange={(e) =>
                        setProjectItems((prev) =>
                          prev.map((x) => (x.localId === p.localId ? { ...x, label: e.target.value } : x))
                        )
                      }
                      className="bg-white/5 border-border max-w-md"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setProjectItems((prev) => prev.filter((x) => x.localId !== p.localId))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={p.source === "url" ? "default" : "outline"}
                      className={p.source === "url" ? "bg-accent text-accent-foreground" : "border-border/60"}
                      onClick={() =>
                        setProjectItems((prev) =>
                          prev.map((x) => (x.localId === p.localId ? { ...x, source: "url" } : x))
                        )
                      }
                    >
                      <Link2 className="w-3.5 h-3.5 mr-1" />
                      URL
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={p.source === "file" ? "default" : "outline"}
                      className={p.source === "file" ? "bg-accent text-accent-foreground" : "border-border/60"}
                      onClick={() =>
                        setProjectItems((prev) =>
                          prev.map((x) =>
                            x.localId === p.localId ? { ...x, source: "file", urlInput: "", storedUrl: null } : x
                          )
                        )
                      }
                    >
                      <Upload className="w-3.5 h-3.5 mr-1" />
                      Upload
                    </Button>
                  </div>
                  {p.source === "url" ? (
                    <Input
                      placeholder="https://…"
                      value={p.urlInput}
                      onChange={(e) =>
                        setProjectItems((prev) =>
                          prev.map((x) => (x.localId === p.localId ? { ...x, urlInput: e.target.value } : x))
                        )
                      }
                      className="bg-white/5 border-border"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept=".pdf,.docx"
                        className="text-sm text-foreground-muted"
                        disabled={uploadingAttach === p.localId}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void uploadForAttach(p.localId, f)
                          e.target.value = ""
                        }}
                      />
                      {uploadingAttach === p.localId && <Loader2 className="w-4 h-4 animate-spin" />}
                      {p.storedUrl && <span className="text-xs text-green-400 font-mono">Uploaded</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <GlassCardHeader title="Kickoff meeting" />
            <RadioGroup
              value={kickoffType}
              onValueChange={(v) => setKickoffType(v as typeof kickoffType)}
              className="space-y-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="calendly" id="k-cal" />
                <Label htmlFor="k-cal">Send Calendly link</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="availability" id="k-av" />
                <Label htmlFor="k-av">Share my availability</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="k-no" />
                <Label htmlFor="k-no">Skip for now</Label>
              </div>
            </RadioGroup>
            {kickoffType === "calendly" && (
              <div>
                <Label className="text-xs font-mono text-foreground-muted">Calendly or scheduling URL</Label>
                <Input
                  value={kickoffUrl}
                  onChange={(e) => setKickoffUrl(e.target.value)}
                  placeholder="https://calendly.com/…"
                  className="mt-1 bg-white/5 border-border"
                />
              </div>
            )}
            {kickoffType === "availability" && (
              <Textarea
                value={kickoffAvailability}
                onChange={(e) => setKickoffAvailability(e.target.value)}
                placeholder="Enter your available times…"
                className="min-h-[100px] bg-white/5 border-border"
              />
            )}
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <Label className="text-xs font-mono text-foreground-muted">Optional message</Label>
            <Textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="bg-white/5 border-border min-h-[80px]"
            />
            <Button
              className="bg-accent text-accent-foreground"
              disabled={sending || !partnershipId}
              onClick={() => void handleSaveSend()}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Save &amp; send
            </Button>
            {error && <p className="text-sm text-red-400 font-mono">{error}</p>}
            {success && <p className="text-sm text-green-400 font-mono">{success}</p>}
          </GlassCard>

          {selectedPartnerRow ? (
            <GlassCard className="p-6 space-y-4">
              <GlassCardHeader
                title="MSA tracker"
                description="Track MSA status for this selected partnership without leaving onboarding."
              />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display font-bold text-base text-foreground">
                    {(selectedPartnerRow.partner?.company_name || "").trim() ||
                      (selectedPartnerRow.partner?.full_name || "").trim() ||
                      (selectedPartnerRow.partner?.email || "").trim() ||
                      "Partner"}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted mt-1">Partnership</div>
                </div>
                <span className={msaStatusBadge(selectedPartnerAgreement?.status || "pending")}>
                  {selectedPartnerAgreement?.status || "pending"}
                </span>
              </div>

              {!selectedPartnerAgreement ? (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={savingMsa === selectedPartnerRow.partnershipId}
                  onClick={() => createMsa(selectedPartnerRow.partnershipId)}
                >
                  {savingMsa === selectedPartnerRow.partnershipId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Start MSA record"
                  )}
                </Button>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="font-mono text-[9px] uppercase text-foreground-muted">Document URL</label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-foreground"
                        placeholder="https://…"
                        value={docUrlDraft[selectedPartnerAgreement.id] ?? selectedPartnerAgreement.document_url ?? ""}
                        onChange={(e) =>
                          setDocUrlDraft((prev) => ({ ...prev, [selectedPartnerAgreement.id]: e.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={savingMsa === selectedPartnerAgreement.id}
                        onClick={() => saveDocumentUrl(selectedPartnerAgreement)}
                      >
                        Save
                      </Button>
                    </div>
                    {selectedPartnerAgreement.document_url ? (
                      <a
                        href={selectedPartnerAgreement.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        Open document
                      </a>
                    ) : null}
                  </div>

                  {selectedPartnerAgreement.signed_at ? (
                    <p className="font-mono text-[10px] text-foreground-muted">
                      Signed {new Date(selectedPartnerAgreement.signed_at).toLocaleDateString()}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {selectedPartnerAgreement.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingMsa === selectedPartnerAgreement.id}
                        onClick={() => patchMsa(selectedPartnerAgreement.id, { status: "sent" })}
                      >
                        Mark sent
                      </Button>
                    )}
                    {selectedPartnerAgreement.status === "sent" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingMsa === selectedPartnerAgreement.id}
                        onClick={() => patchMsa(selectedPartnerAgreement.id, { status: "signed" })}
                      >
                        Mark signed
                      </Button>
                    )}
                    {selectedPartnerAgreement.status !== "expired" && selectedPartnerAgreement.status !== "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-foreground-muted"
                        disabled={savingMsa === selectedPartnerAgreement.id}
                        onClick={() => patchMsa(selectedPartnerAgreement.id, { status: "expired" })}
                      >
                        Mark expired
                      </Button>
                    )}
                    {selectedPartnerAgreement.status === "expired" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingMsa === selectedPartnerAgreement.id}
                        onClick={() => patchMsa(selectedPartnerAgreement.id, { status: "pending" })}
                      >
                        Reset to pending
                      </Button>
                    )}
                  </div>
                </>
              )}
              {msaError ? (
                <p className="text-xs text-red-400 font-mono">{msaError}</p>
              ) : null}
            </GlassCard>
          ) : null}
        </div>
      )}
    </div>
  )
}
