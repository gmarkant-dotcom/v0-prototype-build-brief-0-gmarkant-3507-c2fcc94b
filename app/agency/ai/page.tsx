import { redirect } from "next/navigation"

/** AI tools live in the 01–06 workflow (RFP, bids, onboarding, utilization, payments). */
export default function AgencyAIRedirectPage() {
  redirect("/agency")
}
