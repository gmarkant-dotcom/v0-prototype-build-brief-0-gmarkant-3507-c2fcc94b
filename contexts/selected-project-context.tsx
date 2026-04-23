"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react"
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
  isLoadingProjects: boolean
}

const SelectedProjectContext = createContext<SelectedProjectContextType | undefined>(undefined)

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProjectState] = useState<MasterProject | null>(null)
  const [projects, setProjects] = useState<MasterProject[]>([])
  const [isDemo, setIsDemo] = useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const requestCounterRef = useRef(0)

  const getSavedProjectId = () =>
    typeof window !== "undefined" ? window.localStorage.getItem("selectedProjectId") : null

  const persistSelectedProjectId = (project: MasterProject | null) => {
    if (typeof window === "undefined") return
    if (project) {
      window.localStorage.setItem("selectedProjectId", project.id)
    } else {
      window.localStorage.removeItem("selectedProjectId")
    }
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const refreshProjects = useCallback(async () => {
    if (isDemoMode()) return
    const requestId = ++requestCounterRef.current
    setIsLoadingProjects(true)
    let mapped: MasterProject[] | null = null
    try {
      const retryDelays = [0, 200, 500]
      for (const delay of retryDelays) {
        if (delay > 0) await sleep(delay)
        try {
          const res = await fetch("/api/projects", { credentials: "same-origin", cache: "no-store" })
          if (!res.ok) continue
          const data = await res.json()
          const rows = data.projects || []
          mapped = rows.map((p: Parameters<typeof mapDbProjectToMaster>[0]) => mapDbProjectToMaster(p))
          break
        } catch {
          // ignore and retry
        }
      }
    } catch {
      // ignore
    } finally {
      if (requestId !== requestCounterRef.current) return
      if (mapped) {
        setProjects(mapped)
        const savedId = getSavedProjectId()
        setSelectedProjectState((prev) => {
          let nextSelection: MasterProject | null = null
          if (prev) {
            nextSelection = mapped?.find((x) => x.id === prev.id) || null
          }
          if (!nextSelection && savedId) {
            nextSelection = mapped?.find((x) => x.id === savedId) || null
          }
          if (!nextSelection && mapped && mapped.length > 0) {
            // Default to most recently updated/created project (first API row ordering).
            nextSelection = mapped[0]
          }
          persistSelectedProjectId(nextSelection)
          return nextSelection
        })
      }
      setIsLoadingProjects(false)
    }
  }, [])

  useEffect(() => {
    const demo = isDemoMode()
    setIsDemo(demo)

    if (demo) {
      setProjects(demoProjects)
      const savedSelection = getSavedProjectId()
      if (savedSelection) {
        const project = demoProjects.find((p) => p.id === savedSelection)
        if (project) {
          setSelectedProjectState(project)
          setIsLoadingProjects(false)
          return
        }
      }
      if (demoProjects.length > 0) {
        setSelectedProjectState(demoProjects[0])
        persistSelectedProjectId(demoProjects[0])
      } else {
        setSelectedProjectState(null)
        persistSelectedProjectId(null)
      }
      setIsLoadingProjects(false)
      return
    }

    refreshProjects()
  }, [refreshProjects])

  const setSelectedProject = (project: MasterProject | null) => {
    setSelectedProjectState(project)
    persistSelectedProjectId(project)
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
        isLoadingProjects,
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
