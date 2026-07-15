"use client"

import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { MarketplaceContent } from "@/components/marketplace-content"
import { ArrowLeft } from "lucide-react"

export default function AgencyMarketplacePage() {
  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl space-y-8">
        <Link href="/agency/pool" className="inline-flex items-center gap-2 font-mono text-sm text-foreground/90 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back to Partner Pool
        </Link>

        <StageHeader
          stageNumber="◍"
          title="Marketplace"
          subtitle="Discover opt-in partner agencies and trusted external resource hubs."
        />

        <MarketplaceContent />
      </div>
    </AgencyLayout>
  )
}
