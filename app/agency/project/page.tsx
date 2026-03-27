"use client"

import { Suspense } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { Stage04Dashboard } from "@/components/stages/stage-04-dashboard"
import { DashboardAlertBanner } from "@/components/dashboard-alert-banner"
import { SelectedProjectHeader } from "@/components/selected-project-header"

function ProjectContent() {
  return (
    <div className="p-8">
      <SelectedProjectHeader />
      <DashboardAlertBanner />
      <Stage04Dashboard />
    </div>
  )
}

export default function AgencyProjectPage() {
  return (
    <AgencyLayout>
      <Suspense fallback={<div className="p-8"><Stage04Dashboard /></div>}>
        <ProjectContent />
      </Suspense>
    </AgencyLayout>
  )
}
