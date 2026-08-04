"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Plus, Pencil, Star, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Criterion = {
  id: string
  name: string
  description: string | null
  category: string | null
  default_weight: number
  sort_order: number
  is_active: boolean
}

type Template = {
  id: string
  name: string
  description: string | null
  criteria_weights: { criterion_id: string; weight: number }[]
  is_default: boolean
  created_at: string
}

const CRITERIA_URL = "/api/agency/scoring/criteria"

type CriterionFormState = {
  name: string
  description: string
  category: string
  weight: string
}

const EMPTY_FORM: CriterionFormState = { name: "", description: "", category: "", weight: "1.0" }

function CriterionForm({
  initial, onCancel, onSave, saving,
}: {
  initial: CriterionFormState
  onCancel: () => void
  onSave: (form: CriterionFormState) => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)
  return (
    <div className="space-y-2 p-3 rounded-lg border border-border/40 bg-white/5">
      <Input
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="Criterion name"
        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
      />
      <Textarea
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="What should this criterion evaluate?"
        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[60px]"
      />
      <div className="flex items-center gap-2">
        <Input
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          placeholder="Category (e.g. quality)"
          className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
        />
        <Input
          type="number"
          step="0.1"
          min="0.1"
          value={form.weight}
          onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
          placeholder="Weight"
          className="w-24 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !form.name.trim()}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => onSave(form)}
        >
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Save
        </Button>
        <Button size="sm" variant="outline" className="border-border text-foreground hover:bg-white/5" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function ScoringSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [loading, setLoading] = useState(false)
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addingCriterion, setAddingCriterion] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [addingTemplate, setAddingTemplate] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [templateDescription, setTemplateDescription] = useState("")
  const [savingTemplate, setSavingTemplate] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(CRITERIA_URL)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to load scoring settings")
      setCriteria(data.criteria || [])
      setTemplates(data.templates || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scoring settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const saveCriterion = async (form: CriterionFormState, id?: string) => {
    const key = id || "new"
    setSavingId(key)
    try {
      const res = await fetch(CRITERIA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          category: form.category.trim() || null,
          weight: parseFloat(form.weight) || 1.0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save criterion")
      setEditingId(null)
      setAddingCriterion(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save criterion")
    } finally {
      setSavingId(null)
    }
  }

  const toggleActive = async (criterion: Criterion) => {
    setSavingId(criterion.id)
    try {
      const res = await fetch(CRITERIA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: criterion.id, is_active: !criterion.is_active }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to update criterion")
      setCriteria((prev) => prev.map((c) => (c.id === criterion.id ? { ...c, is_active: !c.is_active } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update criterion")
    } finally {
      setSavingId(null)
    }
  }

  const saveTemplate = async () => {
    if (!templateName.trim()) return
    setSavingTemplate(true)
    setError(null)
    try {
      const activeCriteria = criteria.filter((c) => c.is_active)
      const res = await fetch("/api/agency/scoring/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          description: templateDescription.trim() || null,
          criteria_weights: activeCriteria.map((c) => ({ criterion_id: c.id, weight: c.default_weight })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to create template")
      setTemplateName("")
      setTemplateDescription("")
      setAddingTemplate(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template")
    } finally {
      setSavingTemplate(false)
    }
  }

  const setDefaultTemplate = async (template: Template) => {
    setSavingId(template.id)
    try {
      const res = await fetch("/api/agency/scoring/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, is_default: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to set default template")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set default template")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-card border-border text-foreground flex flex-col p-0 gap-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="font-display text-foreground">Scoring settings</SheetTitle>
          <SheetDescription className="text-foreground-muted">
            Manage the criteria used to score bids. Scoring is always optional.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <p className="text-sm text-foreground-muted">Loading...</p>
          ) : (
            <>
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
              )}

              <div className="space-y-2">
                <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">Criteria</div>
                {criteria.map((c) =>
                  editingId === c.id ? (
                    <CriterionForm
                      key={c.id}
                      initial={{
                        name: c.name,
                        description: c.description || "",
                        category: c.category || "",
                        weight: String(c.default_weight),
                      }}
                      saving={savingId === c.id}
                      onCancel={() => setEditingId(null)}
                      onSave={(form) => void saveCriterion(form, c.id)}
                    />
                  ) : (
                    <div
                      key={c.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-white/5",
                        !c.is_active && "opacity-50"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-bold text-sm text-foreground">{c.name}</span>
                          {c.category && (
                            <span className="font-mono text-2xs px-1.5 py-0.5 rounded-full border border-border text-foreground-muted uppercase">
                              {c.category}
                            </span>
                          )}
                          <span className="font-mono text-2xs text-foreground-muted">weight {c.default_weight}</span>
                        </div>
                        {c.description && (
                          <p className="text-xs text-foreground-muted mt-1 leading-relaxed">{c.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingId(c.id)}
                          className="p-1 rounded-md text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <Switch
                          checked={c.is_active}
                          disabled={savingId === c.id}
                          onCheckedChange={() => void toggleActive(c)}
                        />
                      </div>
                    </div>
                  )
                )}

                {addingCriterion ? (
                  <CriterionForm
                    initial={EMPTY_FORM}
                    saving={savingId === "new"}
                    onCancel={() => setAddingCriterion(false)}
                    onSave={(form) => void saveCriterion(form)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingCriterion(true)}
                    className="flex items-center gap-1.5 font-mono text-2xs text-accent hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Criterion
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">Templates</div>
                {templates.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-white/5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-sm text-foreground">{t.name}</span>
                        {t.is_default && (
                          <span className="font-mono text-2xs px-1.5 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent uppercase">
                            Default
                          </span>
                        )}
                      </div>
                      {t.description && <p className="text-xs text-foreground-muted mt-1">{t.description}</p>}
                      <p className="font-mono text-2xs text-foreground-muted/70 mt-1">
                        {t.criteria_weights.length} criteri{t.criteria_weights.length === 1 ? "on" : "a"}
                      </p>
                    </div>
                    {!t.is_default && (
                      <button
                        type="button"
                        onClick={() => void setDefaultTemplate(t)}
                        disabled={savingId === t.id}
                        className="shrink-0 flex items-center gap-1 font-mono text-2xs text-foreground-muted hover:text-accent transition-colors"
                      >
                        <Star className="w-3.5 h-3.5" /> Set Default
                      </button>
                    )}
                  </div>
                ))}

                {addingTemplate ? (
                  <div className="space-y-2 p-3 rounded-lg border border-border/40 bg-white/5">
                    <Input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Template name"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                    <Textarea
                      value={templateDescription}
                      onChange={(e) => setTemplateDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[50px]"
                    />
                    <p className="text-xs text-foreground-muted/70 italic">
                      Uses the current active criteria and their weights.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={savingTemplate || !templateName.trim()}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                        onClick={() => void saveTemplate()}
                      >
                        {savingTemplate && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border text-foreground hover:bg-white/5"
                        onClick={() => setAddingTemplate(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTemplate(true)}
                    className="flex items-center gap-1.5 font-mono text-2xs text-accent hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Template
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
