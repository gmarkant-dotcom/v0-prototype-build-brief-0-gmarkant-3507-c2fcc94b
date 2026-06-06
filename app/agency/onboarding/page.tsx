"use client"

import { AgencyLayout } from "@/components/agency-layout"
import { Stage03Onboarding } from "@/components/stages/stage-03-onboarding"
import { InlineProjectSelector } from "@/components/agency-project-selector"
import { useSelectedProject } from "@/contexts/selected-project-context"

function OnboardingContent() {
  const { selectedProject, setSelectedProject, projects, isLoadingProjects } = useSelectedProject()

  return (
    <div className="p-8">
      <InlineProjectSelector
        selectedProject={selectedProject}
        projects={projects}
        isLoadingProjects={isLoadingProjects}
        onSelect={setSelectedProject}
        label="Onboarding for project"
      />
      <Stage03Onboarding />
    </div>
  )
}

export default function AgencyOnboardingPage() {
  return (
    <AgencyLayout>
      <OnboardingContent />
    </AgencyLayout>
  )
}
