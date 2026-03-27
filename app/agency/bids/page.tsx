"use client"

import { AgencyLayout } from "@/components/agency-layout"
import { Stage02Bids } from "@/components/stages/stage-02-bids"
import { SelectedProjectHeader } from "@/components/selected-project-header"

export default function AgencyBidsPage() {
  return (
    <AgencyLayout>
      <div className="p-8">
        <SelectedProjectHeader />
        <Stage02Bids />
      </div>
    </AgencyLayout>
  )
}
