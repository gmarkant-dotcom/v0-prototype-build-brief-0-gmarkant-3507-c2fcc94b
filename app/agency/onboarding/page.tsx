"use client"

import { AgencyLayout } from "@/components/agency-layout"
import { Stage03Onboarding } from "@/components/stages/stage-03-onboarding"
import { SelectedProjectHeader } from "@/components/selected-project-header"

export default function AgencyOnboardingPage() {
  return (
    <AgencyLayout>
      <div className="p-8">
        <SelectedProjectHeader />
        <Stage03Onboarding />
      </div>
    </AgencyLayout>
  )
}
