"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { ArrowLeft, Save, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type Project = {
  id: string
  name: string
  client_name: string | null
  status: string
  description: string | null
  budget_range: string | null
  start_date: string | null
  end_date: string | null
}

const STATUS_OPTIONS = ["draft", "onboarding", "active", "on_hold", "completed"]

function toDateInput(val: string | null): string {
  if (!val) return ""
  const d = new Date(val)
  if (isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

function ProjectDetailContent() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [form, setForm] = useState<Partial<Project>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/projects`)
      .then((r) => r.json())
      .then((data) => {
        const list = data.projects || []
        const found = list.find((p: Record<string, unknown>) => p.id === id)
        if (found) {
          setProject(found as Project)
          setForm(found as Project)
        } else {
          setError("Project not found")
        }
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = useCallback(async () => {
    if (!project || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data, error } = await supabase
        .from('projects')
        .update({
          name: form.name,
          client_name: form.client_name,
          status: form.status,
          description: form.description,
          budget_range: form.budget_range,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error || !data) {
        setSaveError(error?.message || 'Save failed')
        return
      }
      setProject(data as Project)
      setForm(data as Project)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Save failed')
    } finally {
      setSaving(false)
    }
  }, [project, saving, id, form])

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-foreground-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading project…
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error || "Project not found"}
        </div>
        <Button
          variant="outline"
          className="mt-4 border-border"
          onClick={() => router.push("/agency/dashboard")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <Button
          variant="outline"
          size="sm"
          className="border-border text-foreground-muted hover:bg-white/5"
          onClick={() => router.push("/agency/dashboard")}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Dashboard
        </Button>
        <h1 className="font-display font-black text-3xl text-foreground truncate">
          {project.name}
        </h1>
      </div>

      <div className="glass rounded-xl p-8 space-y-6">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
            Project Name
          </Label>
          <Input
            value={form.name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="bg-white/5 border-border text-foreground"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
            Client
          </Label>
          <Input
            value={form.client_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
            className="bg-white/5 border-border text-foreground"
            placeholder="Client or brand name"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
            Status
          </Label>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider transition-colors",
                  form.status === s
                    ? "bg-accent text-accent-foreground"
                    : "bg-white/5 text-foreground-muted hover:bg-white/10"
                )}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
            Description
          </Label>
          <Textarea
            value={form.description ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="bg-white/5 border-border text-foreground min-h-[100px]"
            placeholder="Project scope and objectives…"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
            Budget
          </Label>
          <Input
            value={form.budget_range ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, budget_range: e.target.value }))}
            className="bg-white/5 border-border text-foreground"
            placeholder="e.g. $150,000"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              Start Date
            </Label>
            <Input
              type="date"
              value={toDateInput(form.start_date ?? null)}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value || null }))}
              className="bg-white/5 border-border text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              End Date
            </Label>
            <Input
              type="date"
              value={toDateInput(form.end_date ?? null)}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value || null }))}
              className="bg-white/5 border-border text-foreground"
            />
          </div>
        </div>

        {saveError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {saveError}
          </div>
        )}

        <div className="pt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                Saved
              </>
            ) : saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  return (
    <AgencyLayout>
      <ProjectDetailContent />
    </AgencyLayout>
  )
}
