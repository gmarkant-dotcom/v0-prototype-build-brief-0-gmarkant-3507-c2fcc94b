"use client"

import { useState, useRef, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  DESIGNATION_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_KEYS,
  INSURANCE_LABELS,
  type BusinessCriteriaHolds,
  type DesignationHolds,
  type InsuranceHolds,
  emptyBusinessCriteriaHolds,
  withBusinessCriteriaDefaults,
} from "@/lib/business-criteria"

type Document = {
  id: string
  name: string
  description: string
  status: "complete" | "pending" | "not_started"
  uploadedDate?: string
  expirationDate?: string
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoRequiredDocuments: Document[] = [
  {
    id: "w9",
    name: "W-9 Form",
    description: "Required for US-based vendors. Tax identification form.",
    status: "complete",
    uploadedDate: "Jan 5, 2026",
  },
  {
    id: "coi",
    name: "Certificate of Insurance (COI)",
    description: "General liability insurance certificate. Minimum $1M coverage required.",
    status: "complete",
    uploadedDate: "Jan 5, 2026",
    expirationDate: "Jan 5, 2027",
  },
  {
    id: "nda",
    name: "Master NDA",
    description: "Standard non-disclosure agreement covering all engagements.",
    status: "complete",
    uploadedDate: "Jan 8, 2026",
  },
  {
    id: "msa",
    name: "Master Services Agreement",
    description: "Standard contract terms for all project work.",
    status: "pending",
  },
  {
    id: "ein",
    name: "EIN Verification",
    description: "Employer Identification Number documentation.",
    status: "not_started",
  },
]

// Empty state documents for production
const emptyDocuments: Document[] = [
  { id: "w9", name: "W-9 Form", description: "Required for US-based vendors. Tax identification form.", status: "not_started" },
  { id: "coi", name: "Certificate of Insurance (COI)", description: "General liability insurance certificate. Minimum $1M coverage required.", status: "not_started" },
  { id: "nda", name: "Master NDA", description: "Standard non-disclosure agreement covering all engagements.", status: "not_started" },
  { id: "msa", name: "Master Services Agreement", description: "Standard contract terms for all project work.", status: "not_started" },
  { id: "ein", name: "EIN Verification", description: "Employer Identification Number documentation.", status: "not_started" },
]

export default function PartnerLegalPage() {
  const isDemo = isDemoMode()
  const router = useRouter()
  const requiredDocuments = isDemo ? demoRequiredDocuments : emptyDocuments
  
  const [documents, setDocuments] = useState(requiredDocuments)
  const [profileId, setProfileId] = useState("")
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null)
  const [savingEntityInfo, setSavingEntityInfo] = useState(false)
  const [entityInfoMsg, setEntityInfoMsg] = useState<string | null>(null)
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})
  const [entityInfo, setEntityInfo] = useState(isDemo ? {
    legalName: "Sample Production Studio LLC",
    entityType: "llc",
    ein: "XX-XXXXXXX",
    address: "1234 Studio Way, Los Angeles, CA 90028",
    stateOfIncorporation: "California",
  } : {
    legalName: "",
    entityType: "",
    ein: "",
    address: "",
    stateOfIncorporation: "",
  })
  
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [coiSaved, setCoiSaved] = useState(false)
  const [businessCriteria, setBusinessCriteria] = useState<BusinessCriteriaHolds>(emptyBusinessCriteriaHolds())
  const [savingBusinessCriteria, setSavingBusinessCriteria] = useState(false)
  const [savedBusinessCriteria, setSavedBusinessCriteria] = useState(false)
  const [businessCriteriaMsg, setBusinessCriteriaMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isDemo) return
    const ensurePartnerAuth = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Flegal")
        return
      }
      const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).maybeSingle()
      const isPartner = profile?.role === "partner" || profile?.active_role === "partner"
      if (!isPartner) {
        router.push("/partner")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select(
          "id, legal_entity_name, legal_entity_type, legal_ein, legal_address, legal_state_of_incorporation, business_criteria",
        )
        .eq("id", user.id)
        .maybeSingle()
      setProfileId(data?.id || user.id)
      if (data) {
        setEntityInfo((prev) => ({
          ...prev,
          legalName: (data as { legal_entity_name?: string | null }).legal_entity_name || "",
          entityType: (data as { legal_entity_type?: string | null }).legal_entity_type || "",
          ein: (data as { legal_ein?: string | null }).legal_ein || "",
          address: (data as { legal_address?: string | null }).legal_address || "",
          stateOfIncorporation:
            (data as { legal_state_of_incorporation?: string | null }).legal_state_of_incorporation || "",
        }))
      }
      const loadedCriteria = withBusinessCriteriaDefaults((data as { business_criteria?: unknown } | null)?.business_criteria)
      setBusinessCriteria(loadedCriteria)
      if (loadedCriteria.insurance.coi_on_file && loadedCriteria.insurance.coi_document_url) {
        setDocuments((prev) => prev.map((doc) => (doc.id === "coi" ? { ...doc, status: "complete" } : doc)))
      }
    }
    ensurePartnerAuth()
  }, [isDemo, router])

  const updateDesignation = (key: (typeof DESIGNATION_KEYS)[number], patch: Partial<DesignationHolds>) => {
    setBusinessCriteria((prev) => ({
      ...prev,
      designations: {
        ...prev.designations,
        [key]: { ...prev.designations[key], ...patch },
      },
    }))
  }

  const updateCompanyFacts = (patch: Partial<BusinessCriteriaHolds["company_facts"]>) => {
    setBusinessCriteria((prev) => ({
      ...prev,
      company_facts: { ...prev.company_facts, ...patch },
    }))
  }

  const updateInsurance = (key: (typeof INSURANCE_KEYS)[number], patch: Partial<InsuranceHolds>) => {
    setBusinessCriteria((prev) => ({
      ...prev,
      insurance: {
        ...prev.insurance,
        [key]: { ...prev.insurance[key], ...patch },
      },
    }))
  }

  const updateCoiOnFile = (coi_on_file: boolean) => {
    setBusinessCriteria((prev) => ({
      ...prev,
      insurance: { ...prev.insurance, coi_on_file },
    }))
  }

  const saveBusinessCriteria = async () => {
    setBusinessCriteriaMsg(null)
    setSavedBusinessCriteria(false)
    if (isDemo) {
      setBusinessCriteriaMsg("Demo mode - business criteria is not persisted.")
      return
    }
    setSavingBusinessCriteria(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Flegal")
        return
      }
      const target = profileId || user.id
      const { error } = await supabase
        .from("profiles")
        .update({
          business_criteria: businessCriteria,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target)
      if (error) throw error
      setBusinessCriteriaMsg("Business criteria saved.")
      setSavedBusinessCriteria(true)
      setTimeout(() => setSavedBusinessCriteria(false), 2500)
    } catch (error) {
      setBusinessCriteriaMsg(error instanceof Error ? error.message : "Failed to save business criteria.")
    } finally {
      setSavingBusinessCriteria(false)
    }
  }
  const completedCount = documents.filter(d => d.status === "complete").length
  const totalCount = documents.length
  const completionPercentage = Math.round((completedCount / totalCount) * 100)

  const handleFileUpload = async (docId: string, file: File) => {
    setUploadingDocId(docId)
    setUploadError(null)
    
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "partner-legal")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Upload failed")
      }
      
      // Update document status
      setDocuments(prev => prev.map(doc => 
        doc.id === docId 
          ? { 
              ...doc, 
              status: "complete" as const, 
              uploadedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            }
          : doc
      ))
    } catch (error) {
      console.error("Upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setUploadingDocId(null)
    }
  }

  /**
   * COI is the only Required Documents row wired to real persistence (P10 backlog item covers
   * the rest, e.g. EIN Verification, which stay local-only status like handleFileUpload above).
   * Uploads through /api/partner/documents/upload (sanitizes the filename before building the
   * blob pathname, unlike the generic /api/upload route), then saves the URL and
   * coi_on_file=true onto profiles.business_criteria in the same action, so the checklist
   * survives a reload.
   */
  const handleCoiUpload = async (file: File) => {
    setUploadingDocId("coi")
    setUploadError(null)
    setCoiSaved(false)

    let url = ""
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("docId", "coi")

      const response = await fetch("/api/partner/documents/upload", {
        method: "POST",
        body: formData,
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Upload failed")
      }
      url = String(payload?.url || "")
      if (!url) {
        throw new Error("Upload succeeded but no file URL was returned")
      }
    } catch (error) {
      console.error("COI upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
      setUploadingDocId(null)
      return
    }

    const updatedCriteria: BusinessCriteriaHolds = {
      ...businessCriteria,
      insurance: { ...businessCriteria.insurance, coi_on_file: true, coi_document_url: url },
    }
    setBusinessCriteria(updatedCriteria)
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === "coi"
          ? {
              ...doc,
              status: "complete" as const,
              uploadedDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            }
          : doc
      )
    )

    if (isDemo) {
      setUploadingDocId(null)
      return
    }

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        throw new Error("Could not confirm your session")
      }
      const target = profileId || user.id
      const { error } = await supabase
        .from("profiles")
        .update({ business_criteria: updatedCriteria, updated_at: new Date().toISOString() })
        .eq("id", target)
      if (error) throw error
      setCoiSaved(true)
      setTimeout(() => setCoiSaved(false), 2500)
    } catch (error) {
      console.error("COI auto-save error:", error)
      setUploadError(
        "Your file uploaded, but saving it to your profile failed. Click Save Business Criteria below to finish."
      )
    } finally {
      setUploadingDocId(null)
    }
  }

  const handleUploadClick = (docId: string) => {
    fileInputRefs.current[docId]?.click()
  }

  const handleFileChange = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (docId === "coi") {
      handleCoiUpload(file)
    } else {
      handleFileUpload(docId, file)
    }
  }

  const saveEntityInfo = async () => {
    setEntityInfoMsg(null)
    if (isDemo) {
      setEntityInfoMsg("Demo mode - entity information is not persisted.")
      return
    }
    setSavingEntityInfo(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Flegal")
        return
      }
      const target = profileId || user.id
      const { error } = await supabase
        .from("profiles")
        .update({
          legal_entity_name: entityInfo.legalName.trim() || null,
          legal_entity_type: entityInfo.entityType.trim() || null,
          legal_ein: entityInfo.ein.trim() || null,
          legal_address: entityInfo.address.trim() || null,
          legal_state_of_incorporation: entityInfo.stateOfIncorporation.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target)
      if (error) throw error
      setEntityInfoMsg("Entity information saved.")
    } catch (error) {
      setEntityInfoMsg(error instanceof Error ? error.message : "Failed to save entity information.")
    } finally {
      setSavingEntityInfo(false)
    }
  }
  
  return (
    <PartnerLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Legal & Compliance</h1>
            <p className="text-gray-600 mt-1">
              Manage your legal documents, insurance, and compliance requirements.
            </p>
          </div>
          <div className="flex items-start gap-4">
            <div className="text-right">
              <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">Compliance</div>
              <div className={cn(
                "font-display font-bold text-3xl",
                completionPercentage === 100 ? "text-green-600" : "text-yellow-600"
              )}>
                {completionPercentage}%
              </div>
            </div>
          </div>
        </div>
        
        {/* Progress Alert */}
        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {uploadError}
          </div>
        )}
        
        {completionPercentage < 100 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                <span className="text-yellow-600 text-xl">!</span>
              </div>
              <div>
                <h3 className="font-display font-bold text-lg text-yellow-800">Complete Your Legal Setup</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  You have {totalCount - completedCount} document{totalCount - completedCount > 1 ? 's' : ''} remaining. 
                  Complete all requirements to be eligible for all RFP opportunities.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Entity Information */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Entity Information</h2>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Legal Entity Name
              </label>
              <Input
                value={entityInfo.legalName}
                onChange={(e) => setEntityInfo(prev => ({ ...prev, legalName: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Entity Type
              </label>
              <select
                value={entityInfo.entityType}
                onChange={(e) => setEntityInfo(prev => ({ ...prev, entityType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
              >
                <option value="llc">LLC</option>
                <option value="corporation">Corporation (C-Corp)</option>
                <option value="s_corp">S-Corporation</option>
                <option value="partnership">Partnership</option>
                <option value="sole_prop">Sole Proprietorship</option>
              </select>
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                EIN
              </label>
              <Input
                value={entityInfo.ein}
                onChange={(e) => setEntityInfo(prev => ({ ...prev, ein: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                placeholder="XX-XXXXXXX"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                State of Incorporation
              </label>
              <Input
                value={entityInfo.stateOfIncorporation}
                onChange={(e) => setEntityInfo(prev => ({ ...prev, stateOfIncorporation: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            <div className="col-span-2">
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Business Address
              </label>
              <Input
                value={entityInfo.address}
                onChange={(e) => setEntityInfo(prev => ({ ...prev, address: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>
          
          <div className="flex justify-end mt-6">
            <Button
              onClick={saveEntityInfo}
              disabled={savingEntityInfo}
              className="bg-[#0C3535] text-white hover:bg-[#0C3535]/90"
            >
              {savingEntityInfo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Entity Info
            </Button>
          </div>
          {entityInfoMsg ? <p className="text-xs text-gray-600 mt-3">{entityInfoMsg}</p> : null}
        </div>
        
        {/* Required Documents */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Required Documents</h2>
          
          <div className="space-y-4">
            {documents.map((doc) => (
              <div 
                key={doc.id}
                className={cn(
                  "p-4 rounded-lg border",
                  doc.status === "complete" && "bg-green-50 border-green-200",
                  doc.status === "pending" && "bg-yellow-50 border-yellow-200",
                  doc.status === "not_started" && "bg-gray-50 border-gray-200"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      doc.status === "complete" && "bg-green-500 text-white",
                      doc.status === "pending" && "bg-yellow-500 text-white",
                      doc.status === "not_started" && "bg-gray-300 text-gray-600"
                    )}>
                      {doc.status === "complete" ? "✓" : doc.status === "pending" ? "…" : "○"}
                    </div>
                    <div>
                      <div className="font-display font-bold text-sm text-[#0C3535]">{doc.name}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{doc.description}</div>
                      {doc.uploadedDate && (
                        <div className="font-mono text-[10px] text-gray-500 mt-2">
                          Uploaded: {doc.uploadedDate}
                          {doc.expirationDate && ` • Expires: ${doc.expirationDate}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    {doc.status === "complete" ? (
                      <div className="flex items-center gap-2">
                        {doc.id === "coi" && coiSaved && (
                          <span className="text-xs font-medium text-green-600">Saved</span>
                        )}
                        <Button variant="ghost" size="sm" className="text-gray-800 hover:text-[#0C3535]">
                          View
                        </Button>
                        <Button variant="ghost" size="sm" className="text-gray-800 hover:text-[#0C3535]">
                          Replace
                        </Button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="file"
                          ref={(el) => { fileInputRefs.current[doc.id] = el }}
                          onChange={(e) => handleFileChange(doc.id, e)}
                          accept=".pdf,.docx,.pptx"
                          className="sr-only"
                        />
                        <Button 
                          size="sm" 
                          onClick={() => handleUploadClick(doc.id)}
                          disabled={uploadingDocId === doc.id}
                          className={cn(
                            doc.status === "pending" 
                              ? "bg-yellow-600 hover:bg-yellow-700" 
                              : "bg-[#0C3535] hover:bg-[#0C3535]/90",
                            "text-white"
                          )}
                        >
                          {uploadingDocId === doc.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            doc.status === "pending" ? "Complete Signing" : "Upload"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Business Criteria: shared header + save action governs both cards below */}
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-xl text-[#0C3535]">Business Criteria</h2>
              <p className="text-sm text-gray-600 mt-1">
                Diversity designations, company facts, and insurance coverage used for procurement requirements.
              </p>
            </div>
            <Button
              onClick={saveBusinessCriteria}
              disabled={savingBusinessCriteria}
              className={cn(
                "shrink-0 min-w-[190px] text-white",
                savedBusinessCriteria ? "bg-green-600 hover:bg-green-600" : "bg-[#0C3535] hover:bg-[#0C3535]/90"
              )}
            >
              {savingBusinessCriteria ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {savingBusinessCriteria ? "Saving..." : savedBusinessCriteria ? "Saved" : "Save Business Criteria"}
            </Button>
          </div>
          {businessCriteriaMsg ? <p className="text-xs text-gray-600">{businessCriteriaMsg}</p> : null}

          {/* Business Designations & Company Facts */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-display font-bold text-lg text-[#0C3535] mb-2">Business Designations & Company Facts</h3>
          <p className="text-sm text-gray-600 mb-6">
            Diversity and ownership designations, plus company facts agencies use for procurement requirements.
          </p>

          <div className="space-y-3 mb-8">
            {DESIGNATION_KEYS.map((key) => {
              const designation = businessCriteria.designations[key]
              return (
                <div key={key} className="rounded-lg border border-gray-200 p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={designation.holds}
                      onCheckedChange={(checked) => updateDesignation(key, { holds: checked === true })}
                      className="mt-0.5 border-gray-400 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                    />
                    <div className="font-display font-bold text-sm text-[#0C3535]">{DESIGNATION_LABELS[key]}</div>
                  </label>
                  {designation.holds && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pl-7">
                      <div>
                        <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                          Certifying Body
                        </label>
                        <Input
                          value={designation.certifying_body || ""}
                          onChange={(e) => updateDesignation(key, { certifying_body: e.target.value || null })}
                          placeholder="e.g. NMSDC, WBENC, NGLCC"
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                          disabled={designation.self_certified}
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                          Certification Number
                        </label>
                        <Input
                          value={designation.certification_number || ""}
                          onChange={(e) => updateDesignation(key, { certification_number: e.target.value || null })}
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                          disabled={designation.self_certified}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={designation.self_certified}
                            onCheckedChange={(checked) =>
                              updateDesignation(key, {
                                self_certified: checked === true,
                                ...(checked === true ? { certifying_body: null, certification_number: null } : {}),
                              })
                            }
                            className="border-gray-400 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                          />
                          <span className="text-sm text-gray-700">Self-certified (no third-party certification)</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Years in Business
              </label>
              <Input
                type="number"
                value={businessCriteria.company_facts.years_in_business ?? ""}
                onChange={(e) => {
                  const raw = e.target.value
                  updateCompanyFacts({ years_in_business: raw === "" ? null : Number(raw) })
                }}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Union Signatory
              </label>
              <Input
                value={businessCriteria.company_facts.union_signatory}
                onChange={(e) => updateCompanyFacts({ union_signatory: e.target.value })}
                placeholder="e.g. SAG-AFTRA, IATSE"
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Sustainability Approach
              </label>
              <Textarea
                value={businessCriteria.company_facts.sustainability_approach}
                onChange={(e) => updateCompanyFacts({ sustainability_approach: e.target.value })}
                className="min-h-[90px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                placeholder="Describe your sustainability practices."
              />
            </div>
            <div className="md:col-span-2">
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Workforce Diversity Summary
              </label>
              <Textarea
                value={businessCriteria.company_facts.workforce_diversity_summary}
                onChange={(e) => updateCompanyFacts({ workforce_diversity_summary: e.target.value })}
                className="min-h-[90px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                placeholder="Describe your team's diversity."
              />
            </div>
          </div>
          </div>

          {/* Insurance Requirements */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-display font-bold text-lg text-[#0C3535] mb-1">Insurance Requirements</h3>
          <p className="text-sm text-gray-600 mb-4">
            Confirm the insurance coverages your company carries, with limits, for project eligibility.
          </p>

          <div className="space-y-3">
            {INSURANCE_KEYS.map((key) => {
              const coverage = businessCriteria.insurance[key]
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg bg-gray-50 border border-gray-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      checked={coverage.has_coverage}
                      onCheckedChange={(checked) => updateInsurance(key, { has_coverage: checked === true })}
                      className="border-gray-400 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                    />
                    <div className="font-display font-bold text-sm text-[#0C3535] truncate">
                      {INSURANCE_LABELS[key]}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Input
                      value={coverage.limit || ""}
                      onChange={(e) => {
                        const value = e.target.value
                        updateInsurance(key, {
                          limit: value || null,
                          ...(value.trim() ? { has_coverage: true } : {}),
                        })
                      }}
                      placeholder="e.g. $1M/$2M"
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500 w-36"
                    />
                    <span
                      className={cn(
                        "font-mono text-[10px] px-2 py-0.5 rounded-full",
                        coverage.has_coverage ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      )}
                    >
                      {coverage.has_coverage ? "Covered" : "Not Covered"}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={businessCriteria.insurance.coi_on_file}
                onCheckedChange={(checked) => updateCoiOnFile(checked === true)}
                className="border-gray-400 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
              />
              <span className="text-sm text-gray-700">Certificate of Insurance (COI) on file</span>
            </label>
            <p className="text-xs text-gray-500 mt-2 pl-7">
              A Certificate of Insurance is the standard proof-of-coverage document issued by your insurance broker.
              Checking this confirms you can provide a current COI on request.
            </p>
          </div>
          </div>
        </div>
      </div>
    </PartnerLayout>
  )
}
