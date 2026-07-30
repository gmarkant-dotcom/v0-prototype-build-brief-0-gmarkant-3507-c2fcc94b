"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { usePaidUser } from "@/contexts/paid-user-context"
import { useUsageLimitModal } from "@/contexts/usage-limit-modal-context"
import { mapDbProjectToMaster } from "@/lib/project-mapper"
import { isDemoMode } from "@/lib/demo-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"

const emptyForm = {
  name: "",
  client: "",
  budget: "",
  startDate: "",
  endDate: "",
  description: "",
}

/**
 * The single "create a new project" flow, shared by every entry point (dashboard header
 * button, sidebar "+ New Project", mobile nav) so the usage-limit wiring only lives in one
 * place. Carries the same guardAction/handleUsageLimitError pattern every other paid-feature
 * action in this codebase uses: guardAction("projects") blocks before the request fires if
 * the cached usage snapshot already reads at-limit, handleUsageLimitError catches the
 * authoritative 402 if that cache was stale - either way the user sees the upgrade modal,
 * never a dead click or a raw error.
 */
export function NewProjectDialog({ trigger }: { trigger: ReactNode }) {
  const router = useRouter()
  const isDemo = isDemoMode()
  const { addProject, refreshProjects, setSelectedProject } = useSelectedProject()
  const { checkFeatureAccess } = usePaidUser()
  const { guardAction, handleUsageLimitError } = useUsageLimitModal()

  const [open, setOpen] = useState(false)
  const [newProject, setNewProject] = useState(emptyForm)
  const [createProjectError, setCreateProjectError] = useState<string | null>(null)
  const [createProjectWarning, setCreateProjectWarning] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCreateProject = async () => {
    if (isSubmitting) return
    if (!checkFeatureAccess("project creation")) return
    setIsSubmitting(true)
    setCreateProjectError(null)
    setCreateProjectWarning(null)

    try {
      if (isDemo) {
        const createdProject = addProject({
          name: newProject.name,
          client: newProject.client,
          status: "onboarding",
        })
        setSelectedProject(createdProject)
        setOpen(false)
        setNewProject(emptyForm)
        router.push("/agency")
        return
      }

      if (!guardAction("projects")) return

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProject.name,
          clientName: newProject.client,
          description: newProject.description || undefined,
          budgetRange: newProject.budget || undefined,
          startDate: newProject.startDate || undefined,
          endDate: newProject.endDate || undefined,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        if (handleUsageLimitError(res.status, payload)) return
        const statusHint = res.status ? ` (HTTP ${res.status})` : ""
        setCreateProjectError((payload?.error || "Project creation failed. Please try again.") + statusHint)
        return
      }
      const payload = await res.json()
      const project = payload.project
      if (payload?.warning) {
        setCreateProjectWarning(String(payload.warning))
      }
      await refreshProjects()
      setSelectedProject(mapDbProjectToMaster(project))
      setOpen(false)
      setNewProject(emptyForm)
      router.push("/agency")
    } catch {
      setCreateProjectError("Project creation failed. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setCreateProjectError(null)
          setCreateProjectWarning(null)
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-2xl text-foreground">Create New Project</DialogTitle>
          <DialogDescription className="text-foreground-muted">
            Set up a new master project to begin the vendor orchestration workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-6">
          <div className="grid gap-2">
            <Label htmlFor="new-project-name" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              Project Name
            </Label>
            <Input
              id="new-project-name"
              placeholder="e.g., Q3 Brand Campaign"
              value={newProject.name}
              onChange={(e) => setNewProject((prev) => ({ ...prev, name: e.target.value }))}
              className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-client-name" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              Client Name
            </Label>
            <Input
              id="new-client-name"
              placeholder="Legal entity name"
              value={newProject.client}
              onChange={(e) => setNewProject((prev) => ({ ...prev, client: e.target.value }))}
              className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="new-budget" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                Budget
              </Label>
              <CurrencyInput
                id="new-budget"
                placeholder="$150,000"
                value={newProject.budget}
                onChange={(raw) => setNewProject((prev) => ({ ...prev, budget: raw }))}
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-start-date" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                Start Date
              </Label>
              <Input
                id="new-start-date"
                type="date"
                value={newProject.startDate}
                onChange={(e) => setNewProject((prev) => ({ ...prev, startDate: e.target.value }))}
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-end-date" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                End Date
              </Label>
              <Input
                id="new-end-date"
                type="date"
                value={newProject.endDate}
                onChange={(e) => setNewProject((prev) => ({ ...prev, endDate: e.target.value }))}
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-description" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
              Project Description
            </Label>
            <Textarea
              id="new-description"
              placeholder="Describe the project scope, objectives, and any key requirements..."
              value={newProject.description}
              onChange={(e) => setNewProject((prev) => ({ ...prev, description: e.target.value }))}
              className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[100px]"
            />
          </div>
        </div>
        {createProjectError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {createProjectError}
          </div>
        )}
        {createProjectWarning && !createProjectError && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {createProjectWarning}
          </div>
        )}
        <DialogFooter className="flex gap-3">
          <DialogClose asChild>
            <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
              Cancel
            </Button>
          </DialogClose>
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
            onClick={handleCreateProject}
            disabled={!newProject.name || !newProject.client || isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
