"use client"

import { Suspense } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { Stage05Utilization } from "@/components/stages/stage-05-utilization"
import { DashboardAlertBanner } from "@/components/dashboard-alert-banner"
import { SelectedProjectHeader } from "@/components/selected-project-header"

function UtilizationContent() {
  return (
    <div className="p-8">
      <SelectedProjectHeader />
      <DashboardAlertBanner />
      <Stage05Utilization />
    </div>
  )
}

export default function AgencyUtilizationPage() {
  return (
    <AgencyLayout>
      <Suspense fallback={<div className="p-8"><Stage05Utilization /></div>}>
        <UtilizationContent />
      </Suspense>
    </AgencyLayout>
  )
}
