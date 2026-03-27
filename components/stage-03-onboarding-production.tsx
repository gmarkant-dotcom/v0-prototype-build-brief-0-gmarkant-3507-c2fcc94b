"use client"

import { useEffect, useState } from "react"
import { StageHeader } from "@/components/stage-header"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import { Loader2, Send } from "lucide-react"

type AssignmentRow = {
  id: string
  status: string
  partnership: {
    partner: { id: string; full_name: string | null; company_name: string | null } | null
  } | null
}

const DOC_OPTIONS = [
  { id: "brand-guidelines", label: "Brand guidelines" },
  { id: "comms-protocol", label: "Communications protocol" },
  { id: "ways-of-working", label: "Ways of working" },
  { id: "timeline", label: "Master timeline" },
]

export function Stage03OnboardingProduction() {
  const { checkFeatureAccess } = usePaidUser()
  const { selectedProject } = useSelectedProject()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [assignmentId, setAssignmentId] = useState<string>("")
  const [docIds, setDocIds] = useState<string[]>(DOC_OPTIONS.map((d) => d.id))
  const [customMessage, setCustomMessage] = useState("")
  const [createNda, setCreateNda] = useState(true)
  const [createSow, setCreateSow] = useState(true)

  useEffect(() => {
    if (!selectedProject?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/assignments`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const rows = (data.assignments || []) as AssignmentRow[]
        setAssignments(rows)
        const awarded = rows.find((a) => a.status === "awarded")
        const first = awarded || rows[0]
        if (first) setAssignmentId(first.id)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProject?.id])

  if (!selectedProject) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="03"
          title="Onboarding + Ways of Working"
          subtitle="Deploy materials to awarded partners."
          aiPowered={false}
        />
        <EmptyState
          title="Select a project"
          description="Choose a project from the sidebar to deploy onboarding packets."
          icon="onboarding"
        />
      </div>
    )
  }

  const handleDeploy = async () => {
    if (!checkFeatureAccess("onboarding deploy")) return
    if (!assignmentId) return
    setSending(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/onboarding/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId,
          documentIds: docIds,
          customMessage,
          createNda,
          createSow,
        }),
      })
      if (res.ok) {
        setCustomMessage("")
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="03"
        title="Onboarding + Ways of Working"
        subtitle="Send document packets and NDA / scope-of-work requests to partners on this project."
        aiPowered={false}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-foreground-muted py-12">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading partners…
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          title="No partner assignments yet"
          description="Award a bid or assign an active partner to this project first."
          icon="onboarding"
        />
      ) : (
        <GlassCard className="p-6 space-y-6 mt-6">
          <div className="space-y-2">
            <Label>Partner</Label>
            <Select value={assignmentId} onValueChange={setAssignmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select assignment" />
              </SelectTrigger>
              <SelectContent>
                {assignments.map((a) => {
                  const name =
                    a.partnership?.partner?.company_name ||
                    a.partnership?.partner?.full_name ||
                    "Partner"
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      {name} ({a.status})
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Documents in this packet</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DOC_OPTIONS.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={docIds.includes(d.id)}
                    onCheckedChange={(c) => {
                      setDocIds((prev) =>
                        c ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                      )
                    }}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createNda} onCheckedChange={(c) => setCreateNda(c === true)} />
              Include NDA tracking
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createSow} onCheckedChange={(c) => setCreateSow(c === true)} />
              Include Scope of Work tracking
            </label>
          </div>

          <div className="space-y-2">
            <Label>Message to partner (optional)</Label>
            <Textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Kickoff context, links, or scheduling notes…"
              className="min-h-[100px] bg-white/5 border-border"
            />
          </div>

          <Button
            className="bg-accent text-accent-foreground"
            disabled={sending || !assignmentId}
            onClick={handleDeploy}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Deploy onboarding packet
          </Button>
        </GlassCard>
      )}
    </div>
  )
}
