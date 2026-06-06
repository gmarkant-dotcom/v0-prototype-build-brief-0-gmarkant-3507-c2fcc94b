"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"
import { type MasterProject } from "@/contexts/selected-project-context"

type InlineProjectSelectorProps = {
  selectedProject: MasterProject | null
  projects: MasterProject[]
  isLoadingProjects: boolean
  onSelect: (project: MasterProject | null) => void
  label?: string
}

export function InlineProjectSelector({ selectedProject, projects, isLoadingProjects, onSelect, label = "Working on project" }: InlineProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const unique = Array.from(new Map(projects.map(p => [p.id, p])).values())

  if (isLoadingProjects) {
    return <div className="mb-6 font-mono text-xs text-foreground-muted animate-pulse">Loading projects…</div>
  }

  if (unique.length === 0) {
    return (
      <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-xs">
        No projects yet.{" "}
        <a href="/agency/dashboard" className="underline">Create one on the dashboard</a> first.
      </div>
    )
  }

  return (
    <div className="relative mb-6">
      <div className="font-mono text-[10px] text-foreground-muted/60 uppercase tracking-wider mb-1.5">{label}</div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-left max-w-sm",
          selectedProject ? "bg-accent/10 border-accent/30 hover:border-accent/50" : "bg-white/5 border-border hover:border-accent/30"
        )}
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0", selectedProject ? "bg-accent" : "bg-foreground-muted")} />
        <div className="flex-1 min-w-0">
          {selectedProject ? (
            <>
              <div className="font-display font-bold text-sm text-foreground truncate">{selectedProject.name}</div>
              <div className="font-mono text-[10px] text-foreground-muted">{selectedProject.client}</div>
            </>
          ) : (
            <div className="text-sm text-foreground-muted">Select a project…</div>
          )}
        </div>
        <ChevronDown className={cn("w-4 h-4 text-foreground-muted shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-background border border-border rounded-lg shadow-xl overflow-hidden z-50 min-w-[260px] max-h-[240px] overflow-y-auto">
          {unique.map(project => (
            <button
              key={project.id}
              type="button"
              onClick={() => { onSelect(project); setOpen(false) }}
              className={cn("w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left", selectedProject?.id === project.id && "bg-accent/10")}
            >
              <div className={cn("w-2 h-2 rounded-full shrink-0", project.status === "active" ? "bg-green-400" : project.status === "on_hold" ? "bg-gray-400" : "bg-yellow-400")} />
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm text-foreground truncate">{project.name}</div>
                <div className="font-mono text-[10px] text-foreground-muted">{project.client}</div>
              </div>
              {selectedProject?.id === project.id && <span className="text-accent text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
