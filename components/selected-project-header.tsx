"use client"

import Link from "next/link"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { cn } from "@/lib/utils"
import { FolderOpen, ChevronRight, AlertCircle } from "lucide-react"

interface SelectedProjectHeaderProps {
  className?: string
}

export function SelectedProjectHeader({ className }: SelectedProjectHeaderProps) {
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
        <Link 
          href="/agency/dashboard"
          className="font-mono text-[10px] text-accent hover:text-accent/80 transition-colors flex items-center gap-1 shrink-0"
        >
          Switch Project <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  )
}
