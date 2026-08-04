"use client"

import { Suspense } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { Stage06Payments } from "@/components/stages/stage-06-payments"
import { SelectedProjectHeader } from "@/components/selected-project-header"

function PaymentsContent() {
  return (
    <div className="p-8">
      <SelectedProjectHeader />
      <Stage06Payments />
    </div>
  )
}

export default function AgencyPaymentsPage() {
  return (
    <AgencyLayout>
      <Suspense fallback={<div className="p-8"><Stage06Payments /></div>}>
        <PaymentsContent />
      </Suspense>
    </AgencyLayout>
  )
}
