"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"
import { isDemoMode, demoProjects, type MasterProject } from "@/lib/demo-data"
import { mapDbProjectToMaster } from "@/lib/project-mapper"

export type { MasterProject } from "@/lib/demo-data"

type SelectedProjectContextType = {
  selectedProject: MasterProject | null
  setSelectedProject: (project: MasterProject | null) => void
  projects: MasterProject[]
  addProject: (project: Omit<MasterProject, "id">) => MasterProject
  refreshProjects: () => Promise<void>
  isDemo: boolean
}

const SelectedProjectContext = createContext<SelectedProjectContextType | undefined>(undefined)

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProjectState] = useState<MasterProject | null>(null)
  const [projects, setProjects] = useState<MasterProject[]>([])
  const [isDemo, setIsDemo] = useState(false)

  const refreshProjects = useCallback(async () => {
    if (isDemoMode()) return
    try {
      const res = await fetch("/api/projects")
      if (!res.ok) return
      const data = await res.json()
      const rows = data.projects || []
      const mapped: MasterProject[] = rows.map((p: Parameters<typeof mapDbProjectToMaster>[0]) =>
        mapDbProjectToMaster(p)
      )
      setProjects(mapped)
      const savedId = typeof window !== "undefined" ? localStorage.getItem("selectedProjectId") : null
      if (savedId) {
        const found = mapped.find((x) => x.id === savedId)
        if (found) {
          setSelectedProjectState(found)
        } else if (mapped.length > 0) {
          setSelectedProjectState(null)
          localStorage.removeItem("selectedProjectId")
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const demo = isDemoMode()
    setIsDemo(demo)

    if (demo) {
      setProjects(demoProjects)
      const savedSelection = localStorage.getItem("selectedProjectId")
      if (savedSelection) {
        const project = demoProjects.find((p) => p.id === savedSelection)
        if (project) {
          setSelectedProjectState(project)
        }
      }
      return
    }

    refreshProjects()
  }, [refreshProjects])

  const setSelectedProject = (project: MasterProject | null) => {
    setSelectedProjectState(project)
    if (project) {
      localStorage.setItem("selectedProjectId", project.id)
    } else {
      localStorage.removeItem("selectedProjectId")
    }
  }

  const addProject = (projectData: Omit<MasterProject, "id">): MasterProject => {
    const newProject: MasterProject = {
      ...projectData,
      id: `project-${Date.now()}`,
    }
    const updatedProjects = [newProject, ...projects]
    setProjects(updatedProjects)
    return newProject
  }

  return (
    <SelectedProjectContext.Provider
      value={{
        selectedProject,
        setSelectedProject,
        projects,
        addProject,
        refreshProjects,
        isDemo,
      }}
    >
      {children}
    </SelectedProjectContext.Provider>
  )
}

export function useSelectedProject() {
  const context = useContext(SelectedProjectContext)
  if (context === undefined) {
    throw new Error("useSelectedProject must be used within a SelectedProjectProvider")
  }
  return context
}

export function useSelectedProjectSafe() {
  return useContext(SelectedProjectContext)
}
