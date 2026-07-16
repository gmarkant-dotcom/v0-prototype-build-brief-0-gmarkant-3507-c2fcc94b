"use client"

import { AgencyLayout } from "@/components/agency-layout"
// AgencyMsaContent is misnamed - it renders the Cash Flow & Payments feature, not MSA agreement content. See LIGAMENT_CONTEXT.md backlog P7.
import { AgencyMsaContent } from "../msa/page"

export default function AgencyCashflowPage() {
  return (
    <AgencyLayout>
      <AgencyMsaContent />
    </AgencyLayout>
  )
}
