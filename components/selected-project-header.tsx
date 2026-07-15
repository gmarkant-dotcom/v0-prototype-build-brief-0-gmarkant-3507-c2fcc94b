"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useSelectedProject, type MasterProject } from "@/contexts/selected-project-context"
import { cn } from "@/lib/utils"
import { FolderOpen, ChevronRight, ChevronDown, AlertCircle, Check } from "lucide-react"

interface SelectedProjectHeaderProps {
  className?: string
  /** Renders "Switch Project" as an inline dropdown instead of a link to /agency/dashboard —
   *  use on pages where navigating away would lose in-progress form state. */
  dropdown?: boolean
}

function formatProjectLabel(project: MasterProject, duplicateNameCounts: Map<string, number>): string {
  const key = project.name.trim().toLowerCase()
  if ((duplicateNameCounts.get(key) || 0) <= 1) return project.name
  if (project.createdAt) {
    const date = new Date(project.createdAt)
    if (!Number.isNaN(date.getTime())) {
      return `${project.name} (${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
    }
  }
  return project.name
}

function ProjectSwitcherDropdown({ projects, selectedProject }: { projects: MasterProject[]; selectedProject: MasterProject }) {
  const { setSelectedProject } = useSelectedProject()
  const [open, setOpen] = useState(false)

  const uniqueProjects = useMemo(
    () => Array.from(new Map(projects.map((p) => [p.id, p])).values()),
    [projects]
  )
  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const project of uniqueProjects) {
      const key = project.name.trim().toLowerCase()
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [uniqueProjects])
  const activeProjects = useMemo(
    () => uniqueProjects.filter((p) => p.status === "active" || p.status === "onboarding"),
    [uniqueProjects]
  )
  const onHoldProjects = useMemo(() => uniqueProjects.filter((p) => p.status === "on_hold"), [uniqueProjects])

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
      >
        Switch Project <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-72 bg-background border border-border rounded-lg shadow-xl overflow-hidden z-50 max-h-[320px] overflow-y-auto">
            <div className="p-1.5">
              {activeProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setSelectedProject(project)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left",
                    selectedProject.id === project.id && "bg-accent/10"
                  )}
                >
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      project.status === "active" ? "bg-green-400" : "bg-yellow-400"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-sm text-foreground truncate">
                      {formatProjectLabel(project, duplicateNameCounts)}
                    </div>
                    <div className="font-mono text-[10px] text-foreground-muted truncate">{project.client}</div>
                  </div>
                  {selectedProject.id === project.id && <Check className="w-4 h-4 text-accent shrink-0" />}
                </button>
              ))}
            </div>
            {onHoldProjects.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-white/5 border-t border-border/50">
                  <span className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider">On Hold</span>
                </div>
                <div className="p-1.5">
                  {onHoldProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setSelectedProject(project)
                        setOpen(false)
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left opacity-60",
                        selectedProject.id === project.id && "bg-accent/10 opacity-100"
                      )}
                    >
                      <div className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-sm text-foreground truncate">
                          {formatProjectLabel(project, duplicateNameCounts)}
                        </div>
                        <div className="font-mono text-[10px] text-foreground-muted truncate">{project.client}</div>
                      </div>
                      {selectedProject.id === project.id && <Check className="w-4 h-4 text-accent shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function SelectedProjectHeader({ className, dropdown }: SelectedProjectHeaderProps) {
  const { selectedProject, isLoadingProjects, projects } = useSelectedProject()

  if (isLoadingProjects) return null

  if (!selectedProject && projects.length > 0) return null

  if (!selectedProject) {
    return (
      <div className={cn("mb-6", className)}>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-display font-bold text-sm text-yellow-400 mb-1">
              No Project Selected
            </div>
            <p className="text-xs text-yellow-400/80 mb-2">
              Select a project from the sidebar to view workflow details for that specific project.
            </p>
            <Link 
              href="/agency/dashboard"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-yellow-400 hover:text-yellow-300 transition-colors"
            >
              Go to Dashboard <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("mb-6", className)}>
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
          <FolderOpen className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              selectedProject.status === "active" ? "bg-green-400" :
              selectedProject.status === "onboarding" ? "bg-yellow-400" :
              selectedProject.status === "on_hold" ? "bg-gray-400" : "bg-blue-400"
            )} />
            <span className="font-mono text-[10px] text-foreground-muted uppercase">
              {selectedProject.status.replace("_", " ")}
            </span>
          </div>
          <div className="font-display font-bold text-lg text-foreground truncate">
            {selectedProject.name}
          </div>
          <div className="font-mono text-xs text-foreground-muted truncate">
            {selectedProject.client}
          </div>
        </div>
        {dropdown ? (
          <ProjectSwitcherDropdown projects={projects} selectedProject={selectedProject} />
        ) : (
          <Link
            href="/agency/dashboard"
            className="font-mono text-[10px] text-accent hover:text-accent/80 transition-colors flex items-center gap-1 shrink-0"
          >
            Switch Project <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  )
}
