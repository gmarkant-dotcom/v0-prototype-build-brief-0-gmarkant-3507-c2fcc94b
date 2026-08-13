"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { BidFormCollapsibleSection } from "@/components/bid-form-collapsible-section"
import { BusinessCriteriaEditor } from "@/components/business-criteria-editor"
import { EvaluationCriteriaEditor } from "@/components/evaluation-criteria-editor"
import { ClientDocumentsPanel } from "@/components/client-documents-panel"
import { HelpTerm } from "@/components/help-term"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ChevronLeft, Loader2 } from "lucide-react"
import {
  normalizeBusinessCriteriaRequired,
  summarizeRequirementTiers,
  type BusinessCriteriaRequired,
  type DesignationKey,
  type InsuranceKey,
  type InsuranceRequirement,
  type RequirementPriority,
} from "@/lib/business-criteria"
import { MAX_RFP_EVALUATION_CRITERIA, type RfpEvaluationCriterion } from "@/lib/rfp-evaluation-criteria"
import { normalizeClientProfile, type ClientProfile } from "@/lib/clients"

export default function ClientProfileDetailPage() {
  const params = useParams()
  const id = String(params?.id ?? "")

  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(true)
  const [client, setClient] = useState<ClientProfile | null>(null)
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [criteria, setCriteria] = useState<BusinessCriteriaRequired>(normalizeBusinessCriteriaRequired(null))
  const [evaluation, setEvaluation] = useState<RfpEvaluationCriterion[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState({ details: true, documents: true, business: true, evaluation: true })

  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agency/clients/${id}`, { credentials: "same-origin", cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (data?.available === false) {
        setAvailable(false)
        return
      }
      const profile = normalizeClientProfile(data?.client)
      setClient(profile)
      if (profile) {
        setName(profile.name)
        setNotes(profile.notes ?? "")
        setCriteria(profile.default_business_criteria ?? normalizeBusinessCriteriaRequired(null))
        setEvaluation(profile.default_evaluation_criteria)
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/agency/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name,
          notes,
          default_business_criteria: criteria,
          default_evaluation_criteria: evaluation,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError((data?.error as string) || "Could not save this client profile.")
        return
      }
      setSaved(true)
    } catch {
      setSaveError("Could not save this client profile.")
    } finally {
      setSaving(false)
    }
  }

  // Same handler shapes BusinessCriteriaEditor takes in the wizard and the magic-link flow, so
  // the shared component is reused as-is rather than re-implemented for a third caller.
  const updateDesignation = (key: DesignationKey, required: boolean) =>
    setCriteria((prev) => {
      const designations = { ...prev.designations }
      const designationPriority = { ...prev.designationPriority }
      if (required) {
        designations[key] = true
        if (!designationPriority[key]) designationPriority[key] = "preferred"
      } else {
        delete designations[key]
        delete designationPriority[key]
      }
      return { ...prev, designations, designationPriority }
    })
  const updateDesignationPriority = (key: DesignationKey, priority: RequirementPriority) =>
    setCriteria((prev) => ({ ...prev, designationPriority: { ...prev.designationPriority, [key]: priority } }))
  const updateInsurance = (key: InsuranceKey, patch: Partial<InsuranceRequirement>) =>
    setCriteria((prev) => {
      const current = prev.insurance[key] || { required: false, minimum: null }
      const insurance = { ...prev.insurance, [key]: { ...current, ...patch } }
      const insurancePriority = { ...prev.insurancePriority }
      if (patch.required === true && !insurancePriority[key]) insurancePriority[key] = "preferred"
      if (patch.required === false) delete insurancePriority[key]
      return { ...prev, insurance, insurancePriority }
    })
  const updateInsurancePriority = (key: InsuranceKey, priority: RequirementPriority) =>
    setCriteria((prev) => ({ ...prev, insurancePriority: { ...prev.insurancePriority, [key]: priority } }))
  const updateCoi = (required: boolean) =>
    setCriteria((prev) => ({
      ...prev,
      insurance: { ...prev.insurance, coi_on_file: required },
      coiPriority: required ? prev.coiPriority || "preferred" : undefined,
    }))
  const updateCoiPriority = (priority: RequirementPriority) =>
    setCriteria((prev) => ({ ...prev, coiPriority: priority }))
  const updateNotes = (value: string) => setCriteria((prev) => ({ ...prev, notes: value }))

  return (
    <AgencyLayout>
      <div className="p-8 max-w-4xl space-y-6">
        <Link
          href="/agency/clients"
          className="inline-flex items-center gap-1 font-mono text-2xs text-foreground-muted transition-colors [@media(hover:hover)]:hover:text-foreground"
        >
          <ChevronLeft className="w-3 h-3" />
          All client profiles
        </Link>

        {loading ? (
          <div className="flex items-center gap-3 text-foreground-muted py-12">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="font-mono text-sm">Loading client profile...</span>
          </div>
        ) : !available ? (
          <GlassCard>
            <p className="text-sm text-foreground-muted">
              Client profiles are not set up on this database yet. Apply migration 077 to use
              them.
            </p>
          </GlassCard>
        ) : !client ? (
          <GlassCard>
            <p className="text-sm text-foreground-muted">
              This client profile does not exist, or it belongs to another agency.
            </p>
          </GlassCard>
        ) : (
          <>
            <div>
              <h1 className="font-display font-bold text-3xl text-foreground">{client.name}</h1>
              <p className="text-sm text-foreground-muted mt-1">
                Everything here applies as an editable starting point the next time you name this
                client on an RFP. Editing an RFP afterwards never changes this profile.
              </p>
            </div>

            <BidFormCollapsibleSection
              title="Details"
              open={open.details}
              onToggle={() => toggle("details")}
              theme="dark"
            >
              <div>
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block mb-1.5">
                  Client name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-background border-border text-foreground"
                />
              </div>
              <div>
                <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block mb-1.5">
                  Internal notes
                </label>
                <Textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="How this client works, who to talk to, anything worth remembering"
                  className="bg-background border-border text-foreground"
                />
                <p className="font-mono text-2xs text-foreground-muted mt-1.5">
                  Internal to your agency. Vendors never see notes, on any surface. Only documents
                  and criteria you place into an RFP reach them.
                </p>
              </div>
            </BidFormCollapsibleSection>

            <BidFormCollapsibleSection
              title="Documents"
              open={open.documents}
              onToggle={() => toggle("documents")}
              theme="dark"
            >
              <ClientDocumentsPanel clientId={client.id} />
            </BidFormCollapsibleSection>

            <BidFormCollapsibleSection
              title="Default business criteria"
              summary={summarizeRequirementTiers(criteria)}
              open={open.business}
              onToggle={() => toggle("business")}
              theme="dark"
            >
              <p className="text-sm text-foreground-muted">
                What you normally require of vendors working for this client. Pre-filled onto new
                RFPs and fully editable there.
              </p>
              <BusinessCriteriaEditor
                value={criteria}
                onChangeDesignation={updateDesignation}
                onChangeDesignationPriority={updateDesignationPriority}
                onChangeInsurance={updateInsurance}
                onChangeInsurancePriority={updateInsurancePriority}
                onChangeCoi={updateCoi}
                onChangeCoiPriority={updateCoiPriority}
                onChangeNotes={updateNotes}
              />
            </BidFormCollapsibleSection>

            <BidFormCollapsibleSection
              title="Default evaluation criteria"
              summary={evaluation.length === 0 ? "Standard criteria" : `${evaluation.length} of ${MAX_RFP_EVALUATION_CRITERIA}`}
              open={open.evaluation}
              onToggle={() => toggle("evaluation")}
              theme="dark"
            >
              <p className="text-sm text-foreground-muted">
                The dimensions you normally score bids on for this client. Leave empty and RFPs
                use your standard criteria.
              </p>
              <EvaluationCriteriaEditor value={evaluation} onChange={setEvaluation} />
            </BidFormCollapsibleSection>

            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                {saving ? "Saving..." : "Save client profile"}
              </Button>
              {saved && <span className="font-mono text-2xs text-success">Saved</span>}
              {saveError && <span className="font-mono text-2xs text-destructive">{saveError}</span>}
            </div>

            <p className="text-xs text-foreground-muted">
              A <HelpTerm term="client_profile">client profile</HelpTerm> is a starting point, not
              a lock. Every RFP can change what it inherits without changing this.
            </p>
          </>
        )}
      </div>
    </AgencyLayout>
  )
}
