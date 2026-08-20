"use client"

import { resolveCallerOrgIds } from "@/lib/entitlements"
import { useState, useRef, useEffect } from "react"
import { PartnerChrome } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Camera, Loader2, Upload, Zap } from "lucide-react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { fetchVouchCount } from "@/lib/vouch-counts"
import { resolveOrgIdForUser } from "@/lib/entitlements"
import { ORG_CONTACT_SELECT, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"
import { saveCompanyIdentity } from "@/lib/company-identity"

const disciplines = [
  "Video Production",
  "Photography",
  "Motion Design",
  "Social Media",
  "Copywriting",
  "Public Relations",
  "Event Production",
  "Audio Production",
  "Brand Design",
  "Talent Relations",
  "Media Planning",
  "Strategy",
]

const capabilities = [
  "Documentary",
  "Commercial",
  "Sports Content",
  "Creator Content",
  "Social First",
  "Long Form",
  "Short Form",
  "Live Events",
  "Podcasts",
  "Editorial",
  "Branded Content",
  "UGC",
]

type CredentialItem = {
  id: string
  title: string
  client: string
  year: string
  relevant_context: string
}

type WorkExampleItem = {
  id: string
  title: string
  url: string
  file_url: string
}

type ActivePartnershipOption = {
  partnership_id: string
  agency_name: string
}

type PartnershipContextForm = {
  bio: string
  reel_url: string
  capabilities_tags_input: string
  credentials_notes: string
  deposit_percent: string
  net_days: string
  schedule_preference: string
  payment_notes: string
}

function emptyPartnershipContextForm(): PartnershipContextForm {
  return {
    bio: "",
    reel_url: "",
    capabilities_tags_input: "",
    credentials_notes: "",
    deposit_percent: "",
    net_days: "",
    schedule_preference: "",
    payment_notes: "",
  }
}

export default function PartnerProfilePage() {
  const router = useRouter()
  const isDemo = isDemoMode()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [profileId, setProfileId] = useState("")
  const [accountEmail, setAccountEmail] = useState("")
  const [accountFullName, setAccountFullName] = useState("")
  const [discoverable, setDiscoverable] = useState(false)
  const [discoverabilitySaving, setDiscoverabilitySaving] = useState(false)
  const [discoverabilityMsg, setDiscoverabilityMsg] = useState<string | null>(null)
  const [vouchCount, setVouchCount] = useState(0)
  const [vouchLoading, setVouchLoading] = useState(false)
  const [customCapability, setCustomCapability] = useState("")
  const [customCapabilities, setCustomCapabilities] = useState<string[]>([])
  const [showCustomDiscipline, setShowCustomDiscipline] = useState(false)
  const [customDisciplineInput, setCustomDisciplineInput] = useState("")
  const [customDisciplines, setCustomDisciplines] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('customDisciplines')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  
  // Combined disciplines list (default + custom)
  const allDisciplines = [...disciplines, ...customDisciplines]
  
  const addCustomDiscipline = () => {
    if (customDisciplineInput.trim() && !allDisciplines.includes(customDisciplineInput.trim())) {
      const newDiscipline = customDisciplineInput.trim()
      const updated = [...customDisciplines, newDiscipline]
      setCustomDisciplines(updated)
      localStorage.setItem('customDisciplines', JSON.stringify(updated))
      setFormData(prev => ({ ...prev, primaryDiscipline: newDiscipline }))
      setCustomDisciplineInput("")
      setShowCustomDiscipline(false)
    }
  }
  const [formData, setFormData] = useState({
    companyName: "",
    companyWebsite: "",
    companyLinkedin: "",
    type: "",
    primaryDiscipline: disciplines[0],
    bio: "",
    location: "",
    selectedCapabilities: [] as string[],
    teamSize: "",
    yearFounded: "",
  })

  const [credentials, setCredentials] = useState<CredentialItem[]>([])
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null)
  const [showAddProject, setShowAddProject] = useState(false)
  const [newProject, setNewProject] = useState({
    title: "",
    client: "",
    year: new Date().getFullYear().toString(),
    relevant_context: "",
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const [companyLogoUrl, setCompanyLogoUrl] = useState("")
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isUploadingReel, setIsUploadingReel] = useState(false)
  const [reelUrl, setReelUrl] = useState("")
  const [isUploadingCapabilitiesOverview, setIsUploadingCapabilitiesOverview] = useState(false)
  const [capabilitiesOverviewUrl, setCapabilitiesOverviewUrl] = useState("")
  const [workExamples, setWorkExamples] = useState<WorkExampleItem[]>([])
  const [showAddWorkExample, setShowAddWorkExample] = useState(false)
  const [newWorkExample, setNewWorkExample] = useState({
    title: "",
    url: "",
    file_url: "",
  })
  const [uploadingWorkExampleId, setUploadingWorkExampleId] = useState<string | null>(null)
  const [activePartnershipOptions, setActivePartnershipOptions] = useState<ActivePartnershipOption[]>([])
  const [partnershipContextById, setPartnershipContextById] = useState<Record<string, PartnershipContextForm>>({})
  const [selectedPartnershipId, setSelectedPartnershipId] = useState("")
  const [contextSaving, setContextSaving] = useState(false)
  const [contextSaved, setContextSaved] = useState(false)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const reelInputRef = useRef<HTMLInputElement>(null)
  const capabilitiesInputRef = useRef<HTMLInputElement>(null)
  const newWorkExampleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ensurePartnerAuth = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Fprofile")
        return
      }

      // 079: an organization column is not a user id. Reads scope to the caller's memberships.
      const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
      const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).maybeSingle()
      const isPartner = profile?.role === "partner" || profile?.active_role === "partner"
      if (!isPartner) {
        router.push("/partner")
        return
      }
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, role, email, full_name, company_name, company_website, company_linkedin_url, is_discoverable, bio, location, agency_type, company_logo_url, reel_url, capabilities_overview_url, capabilities, credentials, work_examples"
        )
        .eq("id", user.id)
        .maybeSingle()
      setAccountEmail(user.email || "")
      setAccountFullName(data?.full_name || "")
      setProfileId(data?.id || user.id)
      setDiscoverable(!!data?.is_discoverable)

      // Fetch own vouch count (aggregate only — partner never sees who vouched).
      // Routed through lib/vouch-counts.ts; see migration 082.
      //
      // 079 PARAMETER CLASS: partner_vouches.vendor_org_id is an ORGANIZATION column and
      // `user.id` is a user id - equal only for the sixteen accounts 079 backfilled, and a
      // silent zero for every account created since. The subject here is the caller
      // themselves, so their own membership row is readable under the self-row-only SELECT
      // policy on org_members and this resolves. Null leaves the count at zero, which is what
      // an account with no organization genuinely has.
      setVouchLoading(true)
      const ownOrgId = await resolveOrgIdForUser(user.id, supabase)
      setVouchCount(ownOrgId ? await fetchVouchCount(supabase, ownOrgId) : 0)
      setVouchLoading(false)
      setFormData((prev) => ({
        ...prev,
        companyName: data?.company_name || data?.full_name || "",
        companyWebsite: (data as { company_website?: string | null } | null)?.company_website || "",
        companyLinkedin: (data as any)?.company_linkedin_url || "",
        primaryDiscipline:
          data?.agency_type?.trim() ? data.agency_type : prev.primaryDiscipline,
        bio: data?.bio || "",
        location: data?.location || "",
        selectedCapabilities: Array.isArray((data as { capabilities?: unknown } | null)?.capabilities)
          ? ((data as { capabilities?: unknown[] }).capabilities?.map((x) => String(x)) || [])
          : [],
      }))
      const loadedCaps = Array.isArray((data as { capabilities?: unknown } | null)?.capabilities)
        ? ((data as { capabilities?: unknown[] }).capabilities?.map((x) => String(x)) || [])
        : []
      setCustomCapabilities(loadedCaps.filter((x) => !capabilities.includes(x)))
      setCompanyLogoUrl((data as { company_logo_url?: string | null } | null)?.company_logo_url || "")
      setReelUrl((data as { reel_url?: string | null } | null)?.reel_url || "")
      setCapabilitiesOverviewUrl((data as { capabilities_overview_url?: string | null } | null)?.capabilities_overview_url || "")
      const savedCredentialsFromDb = ((data as { credentials?: unknown } | null)?.credentials || []) as Array<Partial<CredentialItem>>
      setCredentials(
        (Array.isArray(savedCredentialsFromDb) ? savedCredentialsFromDb : []).map((c, idx) => ({
          id: String(c.id || `cred-${idx}`),
          title: String(c.title || ""),
          client: String(c.client || ""),
          year: String(c.year || ""),
          relevant_context: String(c.relevant_context || ""),
        })),
      )
      const savedWorkExamplesFromDb = ((data as { work_examples?: unknown } | null)?.work_examples || []) as Array<
        Partial<WorkExampleItem>
      >
      setWorkExamples(
        (Array.isArray(savedWorkExamplesFromDb) ? savedWorkExamplesFromDb : []).map((w, idx) => ({
          id: String(w.id || `we-${idx}`),
          title: String(w.title || ""),
          url: String(w.url || ""),
          file_url: String(w.file_url || ""),
        })),
      )
      if (typeof window !== "undefined") {
        const savedDiscipline = localStorage.getItem("partnerPrimaryDiscipline")
        const savedTeamSize = localStorage.getItem("partnerTeamSize")
        const savedYearFounded = localStorage.getItem("partnerYearFounded")
        if (savedDiscipline) setFormData((prev) => ({ ...prev, primaryDiscipline: savedDiscipline }))
        if (savedTeamSize) setFormData((prev) => ({ ...prev, teamSize: savedTeamSize }))
        if (savedYearFounded) setFormData((prev) => ({ ...prev, yearFounded: savedYearFounded }))
      }

      const { data: activePartnerships } = await supabase
        .from("partnerships")
        .select("id, lead_org_id")
        .in("vendor_org_id", callerOrgIds)
        .eq("status", "active")

      const partnershipRows = Array.isArray(activePartnerships) ? activePartnerships : []
      const agencyIds = Array.from(
        new Set(partnershipRows.map((row) => String(row.lead_org_id || "")).filter(Boolean))
      )

      // PHASE 3: was `.from("profiles").in("id", <lead org ids>)`. Those are ORGANIZATION
      // ids. Partnership Context named every lead agency "Lead Agency" for any agency
      // created after 079. Same organizations read as every other vendor surface.
      let agencyNameById: Record<string, string> = {}
      if (agencyIds.length > 0) {
        const { data: agencyOrgs } = await supabase
          .from("organizations")
          .select(ORG_CONTACT_SELECT)
          .in("id", agencyIds)

        agencyNameById = Object.fromEntries(
          ((agencyOrgs || []) as unknown[])
            .map((org) => resolveOrgContact(org as OrgEmbed, null))
            .filter((c) => Boolean(c.orgId))
            .map((c) => [
            String(c.orgId),
            String(c.orgName || c.contactFullName || "Lead Agency"),
          ])
        )
      }

      const partnershipOptions = partnershipRows.map((row) => ({
        partnership_id: String(row.id),
        agency_name: agencyNameById[String(row.lead_org_id || "")] || "Lead Agency",
      }))
      setActivePartnershipOptions(partnershipOptions)
      setSelectedPartnershipId((prev) => prev || partnershipOptions[0]?.partnership_id || "")

      const partnershipIds = partnershipOptions.map((row) => row.partnership_id)
      if (partnershipIds.length > 0) {
        const { data: contextRows } = await supabase
          .from("partnership_profile_context")
          .select("partnership_id, bio, reel_url, capabilities, credentials, payment_terms")
          .eq("user_id", user.id)
          .in("partnership_id", partnershipIds)

        const contextById = Object.fromEntries(
          (contextRows || []).map((row) => {
            const capabilitiesValue =
              row && typeof row === "object" && "capabilities" in row ? (row.capabilities as unknown) : null
            const credentialsValue =
              row && typeof row === "object" && "credentials" in row ? (row.credentials as unknown) : null
            const paymentTermsValue =
              row && typeof row === "object" && "payment_terms" in row ? (row.payment_terms as unknown) : null

            const tags =
              capabilitiesValue && typeof capabilitiesValue === "object" && !Array.isArray(capabilitiesValue)
                ? Array.isArray((capabilitiesValue as { tags?: unknown }).tags)
                  ? ((capabilitiesValue as { tags?: unknown[] }).tags || []).map((tag) => String(tag).trim()).filter(Boolean)
                  : []
                : []

            const credentialsNotes =
              credentialsValue && typeof credentialsValue === "object" && !Array.isArray(credentialsValue)
                ? String((credentialsValue as { notes?: unknown }).notes || "")
                : ""

            const paymentTerms =
              paymentTermsValue && typeof paymentTermsValue === "object" && !Array.isArray(paymentTermsValue)
                ? (paymentTermsValue as {
                    deposit_percent?: unknown
                    net_days?: unknown
                    schedule_preference?: unknown
                    notes?: unknown
                  })
                : {}

            return [
              String(row.partnership_id),
              {
                bio: String(row.bio || ""),
                reel_url: String(row.reel_url || ""),
                capabilities_tags_input: tags.join(", "),
                credentials_notes: credentialsNotes,
                deposit_percent:
                  paymentTerms.deposit_percent == null || paymentTerms.deposit_percent === ""
                    ? ""
                    : String(paymentTerms.deposit_percent),
                net_days:
                  paymentTerms.net_days == null || paymentTerms.net_days === ""
                    ? ""
                    : String(paymentTerms.net_days),
                schedule_preference: String(paymentTerms.schedule_preference || ""),
                payment_notes: String(paymentTerms.notes || ""),
              } satisfies PartnershipContextForm,
            ]
          })
        ) as Record<string, PartnershipContextForm>

        setPartnershipContextById(contextById)
      }
      setLoading(false)
    }
    ensurePartnerAuth()
  }, [isDemo, router])

  const initAutocomplete = () => {
    if (!locationInputRef.current || autocompleteRef.current) return
    if (!window.google?.maps?.places) return

    const autocomplete = new window.google.maps.places.Autocomplete(locationInputRef.current, {
      types: ["(cities)"],
    })
    autocompleteRef.current = autocomplete

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace()
      const components = place.address_components || []
      const city =
        components.find((c: any) => c.types.includes("locality"))?.long_name?.trim() || ""
      const state =
        components.find((c: any) => c.types.includes("administrative_area_level_1"))?.long_name?.trim() || ""
      const country = components.find((c: any) => c.types.includes("country"))?.long_name?.trim() || ""
      const parts = [city, state, country].filter(Boolean)
      const formatted = parts.join(", ")
      if (formatted) {
        setFormData((p) => ({ ...p, location: formatted }))
        if (locationInputRef.current) {
          locationInputRef.current.value = formatted
        }
      }
    })
  }

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return

    if (document.getElementById("google-maps-script")) {
      initAutocomplete()
      return
    }

    const script = document.createElement("script")
    script.id = "google-maps-script"
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => initAutocomplete()
    document.head.appendChild(script)

    return () => {
      const ac = autocompleteRef.current
      if (ac && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(ac)
      }
      autocompleteRef.current = null
    }
  }, [loading])

  const selectedPartnershipContext =
    selectedPartnershipId && partnershipContextById[selectedPartnershipId]
      ? partnershipContextById[selectedPartnershipId]
      : emptyPartnershipContextForm()

  const toggleDiscoverability = async (checked: boolean) => {
    setDiscoverabilityMsg(null)
    setDiscoverable(checked)
    if (isDemo) {
      setDiscoverabilityMsg("Demo mode - discoverability preference is not persisted.")
      return
    }
    setDiscoverabilitySaving(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Fprofile")
        return
      }
      const { error } = await supabase
        .from("profiles")
        .update({ is_discoverable: checked, updated_at: new Date().toISOString() })
        .eq("id", user.id)
      if (error) throw error
      setDiscoverabilityMsg("Marketplace discoverability updated.")
    } catch (error) {
      setDiscoverabilityMsg(error instanceof Error ? error.message : "Failed to update discoverability.")
    } finally {
      setDiscoverabilitySaving(false)
    }
  }

  const handleReelUpload = async (file: File) => {
    setIsUploadingReel(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "partner-reels")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Upload failed")
      }
      const result = await response.json()
      setReelUrl(result.url)
    } catch (error) {
      console.error("Upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setIsUploadingReel(false)
    }
  }

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "partner-logos")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to upload logo")
      setCompanyLogoUrl(payload.url || "")
      if (typeof window !== "undefined" && (window as any).__ligamentRefreshAvatar) {
        ;(window as any).__ligamentRefreshAvatar()
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setUploadingLogo(false)
    }
  }

  const uploadProfileAsset = async (file: File, folder: string): Promise<string> => {
    const uploadData = new FormData()
    uploadData.append("file", file)
    uploadData.append("folder", folder)

    const response = await fetch("/api/upload", {
      method: "POST",
      body: uploadData,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || "Upload failed")
    }
    const result = await response.json()
    return String(result.url || "")
  }

  const handleCapabilitiesOverviewUpload = async (file: File) => {
    setIsUploadingCapabilitiesOverview(true)
    setUploadError(null)
    try {
      const url = await uploadProfileAsset(file, "partner-capabilities-overview")
      setCapabilitiesOverviewUrl(url)
    } catch (error) {
      console.error("Capabilities overview upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setIsUploadingCapabilitiesOverview(false)
    }
  }

  const handleWorkExampleFileUpload = async (workExampleId: string, file: File) => {
    setUploadingWorkExampleId(workExampleId)
    setUploadError(null)
    try {
      const url = await uploadProfileAsset(file, "partner-work-examples")
      if (workExampleId === "__new__") {
        setNewWorkExample((prev) => ({ ...prev, file_url: url }))
      } else {
        setWorkExamples((prev) =>
          prev.map((w) => (w.id === workExampleId ? { ...w, file_url: url } : w)),
        )
      }
    } catch (error) {
      console.error("Work example upload error:", error)
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.")
    } finally {
      setUploadingWorkExampleId(null)
    }
  }

  const addProject = () => {
    if (newProject.title && newProject.client) {
      setCredentials(prev => [...prev, { id: Date.now().toString(), ...newProject }])
      setNewProject({
        title: "",
        client: "",
        year: new Date().getFullYear().toString(),
        relevant_context: "",
      })
      setShowAddProject(false)
    }
  }

  const updateCredential = (id: string, patch: Partial<CredentialItem>) => {
    setCredentials((prev) => prev.map((cred) => (cred.id === id ? { ...cred, ...patch } : cred)))
  }

  const removeCredential = (id: string) => {
    setCredentials((prev) => prev.filter((cred) => cred.id !== id))
    if (editingCredentialId === id) setEditingCredentialId(null)
  }

  const addWorkExample = () => {
    if (!newWorkExample.title.trim()) return
    setWorkExamples((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        title: newWorkExample.title.trim(),
        url: newWorkExample.url.trim(),
        file_url: newWorkExample.file_url.trim(),
      },
    ])
    setNewWorkExample({ title: "", url: "", file_url: "" })
    setShowAddWorkExample(false)
  }
  
  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      if (!isDemo) {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          router.push("/auth/login?redirect=%2Fpartner%2Fprofile")
          return
        }
        const { data: roleProfile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).maybeSingle()
        const isPartner = roleProfile?.role === "partner" || roleProfile?.active_role === "partner"
        if (!isPartner) {
          setMessage("Only vendor users can save this profile.")
          return
        }
        const targetProfileId = profileId || user.id
        // THE COMPANY NAME DOES NOT GO IN THIS PAYLOAD. organizations.name is the name every
        // lead agency actually reads for this vendor, and this form used to write only the
        // profiles.company_name mirror, so a rename here never reached them. Both columns
        // now move together through lib/company-identity.ts, which also trims - this form
        // previously wrote formData.companyName raw, with no normalisation anywhere.
        const result = await saveCompanyIdentity(
          supabase,
          targetProfileId,
          {
            hasCompanyName: true,
            companyName: formData.companyName,
            fallbackName: accountFullName,
          },
          {
            company_website: formData.companyWebsite || null,
            company_linkedin_url: formData.companyLinkedin || null,
            company_logo_url: companyLogoUrl || null,
            agency_type: formData.primaryDiscipline,
            bio: formData.bio,
            location: formData.location,
            capabilities: formData.selectedCapabilities,
            reel_url: reelUrl || null,
            capabilities_overview_url: capabilitiesOverviewUrl || null,
            credentials,
            work_examples: workExamples,
            is_discoverable: discoverable,
          }
        )
        if (!result.ok) throw new Error(result.error)
        // Echo the normalized name back, so the field shows what the database holds rather
        // than the untrimmed string that was typed.
        if (result.name) setFormData((prev) => ({ ...prev, companyName: result.name as string }))
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("partnerPrimaryDiscipline", formData.primaryDiscipline)
        localStorage.setItem("partnerTeamSize", formData.teamSize)
        localStorage.setItem("partnerYearFounded", formData.yearFounded)
      }
      setSaved(true)
      setMessage("Profile saved successfully.")
      setTimeout(() => setSaved(false), 3000)
    } catch (error) {
      console.error("[partner/profile] save failure", error)
      setMessage(error instanceof Error ? error.message : "Failed to save profile.")
    } finally {
      setSaving(false)
    }
  }

  const updateSelectedPartnershipContext = (patch: Partial<PartnershipContextForm>) => {
    if (!selectedPartnershipId) return
    setPartnershipContextById((prev) => ({
      ...prev,
      [selectedPartnershipId]: {
        ...(prev[selectedPartnershipId] || emptyPartnershipContextForm()),
        ...patch,
      },
    }))
  }

  const handleSavePartnershipContext = async () => {
    if (!selectedPartnershipId) return
    setContextSaving(true)
    setContextSaved(false)
    setMessage(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Fprofile")
        return
      }

      const context = partnershipContextById[selectedPartnershipId] || emptyPartnershipContextForm()
      const tags = context.capabilities_tags_input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)

      const depositPercent = context.deposit_percent.trim()
      const netDays = context.net_days.trim()

      const { error } = await supabase.from("partnership_profile_context").upsert(
        {
          partnership_id: selectedPartnershipId,
          user_id: user.id,
          bio: context.bio.trim() || null,
          reel_url: context.reel_url.trim() || null,
          capabilities: { tags },
          credentials: { notes: context.credentials_notes.trim() },
          payment_terms: {
            deposit_percent: depositPercent === "" ? null : Number(depositPercent),
            net_days: netDays === "" ? null : Number(netDays),
            schedule_preference: context.schedule_preference.trim() || "",
            notes: context.payment_notes.trim() || "",
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "partnership_id,user_id" }
      )

      if (error) throw error

      setContextSaved(true)
      setTimeout(() => setContextSaved(false), 2000)
    } catch (error) {
      console.error("[partner/profile] partnership context save failure", error)
      setMessage(error instanceof Error ? error.message : "Failed to save partnership context.")
    } finally {
      setContextSaving(false)
    }
  }
  
  const addCustomCapability = () => {
    if (customCapability.trim() && !customCapabilities.includes(customCapability.trim()) && !capabilities.includes(customCapability.trim())) {
      setCustomCapabilities(prev => [...prev, customCapability.trim()])
      setFormData(prev => ({
        ...prev,
        selectedCapabilities: [...prev.selectedCapabilities, customCapability.trim()]
      }))
      setCustomCapability("")
    }
  }
  
  const removeCustomCapability = (cap: string) => {
    setCustomCapabilities(prev => prev.filter(c => c !== cap))
    setFormData(prev => ({
      ...prev,
      selectedCapabilities: prev.selectedCapabilities.filter(c => c !== cap)
    }))
  }
  
  const toggleCapability = (cap: string) => {
    setFormData(prev => ({
      ...prev,
      selectedCapabilities: prev.selectedCapabilities.includes(cap)
        ? prev.selectedCapabilities.filter(c => c !== cap)
        : [...prev.selectedCapabilities, cap]
    }))
  }
  
  if (loading) {
    return (
      <PartnerChrome>
        <div className="max-w-4xl mx-auto p-8 text-vendor-muted-strong">Loading profile...</div>
      </PartnerChrome>
    )
  }

  return (
    <PartnerChrome>
      <div className="max-w-4xl mx-auto space-y-8">
        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {uploadError}
          </div>
        )}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-vendor-foreground">Profile & Capabilities</h1>
            <p className="text-vendor-muted-strong mt-1">
              Tell agencies about your company, expertise, and past work.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "transition-all min-w-[140px] rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60",
              saved
                ? "bg-success hover:bg-success text-accent-foreground"
                : "bg-vendor-foreground hover:bg-vendor-foreground/90 text-white"
            )}
          >
            {saving ? "Saving..." : saved ? "Saved Successfully" : "Save Changes"}
          </button>
        </div>

        {/* Vouch status — count only, never reveals who vouched (by design) */}
        {!vouchLoading && (
          <div className="bg-vendor-surface rounded-xl border border-vendor-border p-5 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-display font-bold text-base text-vendor-foreground flex items-center gap-2 flex-wrap">
                {vouchCount >= 3 ? (
                  <>
                    <span className="flex items-center gap-0.5">
                      <Zap className="w-4 h-4 text-yellow-500" />
                      <Zap className="w-4 h-4 text-yellow-500" />
                      <Zap className="w-4 h-4 text-yellow-500" />
                    </span>
                    Triple-Vouched
                  </>
                ) : (
                  "Community Vouching"
                )}
              </div>
              <p className="text-sm text-vendor-muted mt-1">
                {vouchCount >= 3
                  ? `${vouchCount} lead agencies have vouched for your work.`
                  : vouchCount === 0
                  ? "No lead agencies have vouched for you yet."
                  : `${vouchCount} lead ${vouchCount === 1 ? "agency has" : "agencies have"} vouched for your work.`}
              </p>
            </div>
          </div>
        )}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Account Email</label>
              <Input value={accountEmail} readOnly className="border-vendor-border bg-gray-100 text-vendor-foreground" />
            </div>
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Account Full Name</label>
              <Input value={accountFullName} readOnly className="border-vendor-border bg-gray-100 text-vendor-foreground" />
            </div>
          </div>
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <div className="font-display font-bold text-lg text-vendor-foreground">
                Allow agencies to discover me on the Marketplace
              </div>
              <p className="text-sm text-vendor-muted-strong mt-1">
                When enabled, your agency profile can appear in Marketplace discovery for lead agencies.
              </p>
              {discoverabilityMsg && <p className="text-xs text-vendor-muted mt-2">{discoverabilityMsg}</p>}
            </div>
            <Switch checked={discoverable} onCheckedChange={toggleDiscoverability} disabled={discoverabilitySaving} />
          </label>
        </div>
        
        {/* Basic Info */}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <h2 className="font-display font-bold text-lg text-vendor-foreground mb-6">Company profile & basic information</h2>

          <div className="flex items-center gap-5 mb-6">
            <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
              {companyLogoUrl ? (
                <img src={companyLogoUrl} alt="Company logo" className="w-full h-full object-cover" />
              ) : (
                <span className="font-display font-bold text-xl text-vendor-foreground">
                  {(formData.companyName || "P").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                type="file"
                ref={fileRef}
                className="sr-only"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadLogo(file)
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="border-vendor-border text-vendor-foreground hover:bg-vendor-foreground/5 w-fit"
                onClick={() => fileRef.current?.click()}
              >
                {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Upload logo
              </Button>
              <p className="text-xs text-vendor-muted">PNG, JPG, or WebP. Shown in your sidebar and on your public profile.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Company Name
              </label>
              <Input
                value={formData.companyName}
                onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
                className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
              />
            </div>

            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Company Website
              </label>
              <Input
                type="text"
                value={formData.companyWebsite}
                onChange={(e) => setFormData(prev => ({ ...prev, companyWebsite: e.target.value }))}
                placeholder="https://youragency.com"
                className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
              />
            </div>
            <div>
              <label className="font-mono text-2xs uppercase text-vendor-muted block mb-2">Company LinkedIn URL</label>
              <Input
                type="url"
                value={formData.companyLinkedin ?? ""}
                onChange={(e) => setFormData((p) => ({ ...p, companyLinkedin: e.target.value }))}
                placeholder="https://linkedin.com/company/your-company"
                className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
              />
            </div>
            
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Company Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground"
              >
                <option value="production">Production Company</option>
                <option value="agency">Agency</option>
                <option value="freelancer">Freelancer / Individual</option>
                <option value="studio">Studio</option>
              </select>
            </div>
            
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Primary Discipline
              </label>
              {showCustomDiscipline ? (
                <div className="flex gap-2">
                  <Input
                    value={customDisciplineInput}
                    onChange={(e) => setCustomDisciplineInput(e.target.value)}
                    placeholder="Enter custom discipline"
                    className="border-vendor-border flex-1 text-vendor-foreground placeholder:text-vendor-muted"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustomDiscipline()
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={addCustomDiscipline}
                    className="bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowCustomDiscipline(false)
                      setCustomDisciplineInput("")
                    }}
                    className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <select
                  value={formData.primaryDiscipline}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setShowCustomDiscipline(true)
                    } else {
                      setFormData(prev => ({ ...prev, primaryDiscipline: e.target.value }))
                    }
                  }}
                  className="w-full h-10 px-3 rounded-md border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground"
                >
                  {allDisciplines.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value="__custom__">+ Add Custom Discipline</option>
                </select>
              )}
            </div>
            
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Location
              </label>
              <input
                ref={locationInputRef}
                defaultValue={formData.location || ""}
                onChange={(e) => setFormData((p) => ({ ...p, location: e.target.value }))}
                placeholder="Start typing a city..."
                autoComplete="off"
                className="flex h-10 w-full rounded-md border border-vendor-border bg-vendor-surface px-3 py-2 text-sm text-vendor-foreground placeholder:text-vendor-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                  Team Size
                </label>
                <select
                  value={formData.teamSize}
                  onChange={(e) => setFormData(prev => ({ ...prev, teamSize: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground"
                >
                  <option value="1">Solo</option>
                  <option value="2-4">2-4</option>
                  <option value="5-10">5-10</option>
                  <option value="11-25">11-25</option>
                  <option value="25+">25+</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                  Year Founded
                </label>
                <Input
                  value={formData.yearFounded}
                  onChange={(e) => setFormData(prev => ({ ...prev, yearFounded: e.target.value }))}
                  className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                />
              </div>
            </div>
            
            <div className="col-span-2">
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Company Bio
              </label>
              <Textarea
                value={formData.bio}
                onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                className="min-h-[120px] border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                placeholder="Describe your company, expertise, and what makes you unique..."
              />
            </div>
          </div>
        </div>

        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display font-bold text-lg text-vendor-foreground">Partnership context</h2>
              <p className="text-sm text-vendor-muted-strong mt-1">
                Tailor your profile details for each active lead agency partnership.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleSavePartnershipContext}
              disabled={!selectedPartnershipId || contextSaving}
              className={cn(
                "min-w-[120px] bg-vendor-foreground text-white hover:bg-vendor-foreground/90",
                contextSaved && "bg-success hover:bg-success text-accent-foreground"
              )}
            >
              {contextSaving ? "Saving..." : contextSaved ? "Saved ✓" : "Save Context"}
            </Button>
          </div>

          {activePartnershipOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-vendor-border p-4 text-sm text-vendor-muted">
              No active partnerships found.
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                  Partnership
                </label>
                <select
                  value={selectedPartnershipId}
                  onChange={(e) => {
                    setContextSaved(false)
                    setSelectedPartnershipId(e.target.value)
                  }}
                  className="w-full h-10 px-3 rounded-md border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground"
                >
                  {activePartnershipOptions.map((option) => (
                    <option key={option.partnership_id} value={option.partnership_id}>
                      {option.agency_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                  Bio
                </label>
                <Textarea
                  value={selectedPartnershipContext.bio}
                  onChange={(e) => updateSelectedPartnershipContext({ bio: e.target.value })}
                  className="min-h-[120px] border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  placeholder="Describe how you'd like to present yourself for this specific partnership."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Reel URL
                  </label>
                  <Input
                    value={selectedPartnershipContext.reel_url}
                    onChange={(e) => updateSelectedPartnershipContext({ reel_url: e.target.value })}
                    placeholder="https://vimeo.com/partnership-specific-reel"
                    className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                </div>

                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Capabilities Tags
                  </label>
                  <Input
                    value={selectedPartnershipContext.capabilities_tags_input}
                    onChange={(e) => updateSelectedPartnershipContext({ capabilities_tags_input: e.target.value })}
                    placeholder="Production, Motion Design, Creator Content"
                    className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                  <p className="text-xs mt-2 text-vendor-muted">
                    Enter comma-separated tags.
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                  Credentials Notes
                </label>
                <Textarea
                  value={selectedPartnershipContext.credentials_notes}
                  onChange={(e) => updateSelectedPartnershipContext({ credentials_notes: e.target.value })}
                  className="min-h-[100px] border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  placeholder="Plain-text credentials notes for this partnership."
                />
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-display font-bold text-base text-vendor-foreground">Payment terms</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                      Deposit Percent
                    </label>
                    <Input
                      type="number"
                      value={selectedPartnershipContext.deposit_percent}
                      onChange={(e) => updateSelectedPartnershipContext({ deposit_percent: e.target.value })}
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                      Net Days
                    </label>
                    <Input
                      type="number"
                      value={selectedPartnershipContext.net_days}
                      onChange={(e) => updateSelectedPartnershipContext({ net_days: e.target.value })}
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                      Schedule Preference
                    </label>
                    <Input
                      value={selectedPartnershipContext.schedule_preference}
                      onChange={(e) => updateSelectedPartnershipContext({ schedule_preference: e.target.value })}
                      placeholder="Milestone-based, Net 30, etc."
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                      Notes
                    </label>
                    <Input
                      value={selectedPartnershipContext.payment_notes}
                      onChange={(e) => updateSelectedPartnershipContext({ payment_notes: e.target.value })}
                      placeholder="Additional payment notes"
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Capabilities */}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <h2 className="font-display font-bold text-lg text-vendor-foreground mb-2">Capabilities</h2>
          <p className="text-sm text-vendor-muted-strong mb-6">
            Select all the capabilities that apply to your work. This helps agencies find you for relevant projects.
          </p>
          
          <div className="flex flex-wrap gap-2 mb-6">
            {capabilities.map((cap) => (
              <button
                key={cap}
                onClick={() => toggleCapability(cap)}
                className={cn(
                  "px-4 py-2 rounded-full font-mono text-xs transition-all border",
                  formData.selectedCapabilities.includes(cap)
                    ? "bg-vendor-foreground text-white border-vendor-foreground"
                    : "bg-vendor-surface text-vendor-foreground border-vendor-border hover:border-vendor-foreground/30"
                )}
              >
                {formData.selectedCapabilities.includes(cap) && "✓ "}
                {cap}
              </button>
            ))}
            {/* Custom Capabilities */}
            {customCapabilities.map((cap) => (
              <button
                key={cap}
                onClick={() => removeCustomCapability(cap)}
                className="px-4 py-2 rounded-full font-mono text-xs transition-all border bg-vendor-foreground/80 text-white border-vendor-foreground hover:bg-vendor-foreground"
              >
                ✓ {cap} ×
              </button>
            ))}
          </div>
          
          {/* Add Custom Capability */}
          <div className="pt-4 border-t border-vendor-border">
            <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
              Add Custom Capability
            </label>
            <div className="flex gap-2">
              <Input
                value={customCapability}
                onChange={(e) => setCustomCapability(e.target.value)}
                placeholder="e.g., Aerial Cinematography, VR/360 Video..."
                className="flex-1 border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addCustomCapability()
                  }
                }}
              />
              <Button
                type="button"
                onClick={addCustomCapability}
                variant="outline"
                className="border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/5"
              >
                + Add
              </Button>
            </div>
            <p className="text-xs mt-2 text-vendor-muted">
              Custom capabilities are highlighted. Click to remove.
            </p>
          </div>
        </div>
        
        {/* Credentials / Portfolio */}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-bold text-lg text-vendor-foreground">Credentials & portfolio</h2>
              <p className="text-sm text-vendor-muted-strong">
                Showcase your best work to potential agency partners.
              </p>
            </div>
            <Button
              variant="outline" 
              className="border-vendor-border text-vendor-foreground hover:bg-vendor-foreground/5"
              onClick={() => setShowAddProject(true)}
            >
              + Add project
            </Button>
          </div>
          
          {showAddProject && (
            <div className="mb-6 p-4 rounded-lg border border-vendor-foreground/20 bg-vendor-foreground/5">
              <h3 className="font-display font-bold text-sm text-vendor-foreground mb-4">Add new project</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Project Title
                  </label>
                  <Input
                    value={newProject.title}
                    onChange={(e) => setNewProject(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Project name"
                    className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                </div>
                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Client
                  </label>
                  <Input
                    value={newProject.client}
                    onChange={(e) => setNewProject(prev => ({ ...prev, client: e.target.value }))}
                    placeholder="Client name"
                    className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                </div>
                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Year
                  </label>
                  <Input
                    value={newProject.year}
                    onChange={(e) => setNewProject(prev => ({ ...prev, year: e.target.value }))}
                    placeholder="2024"
                    className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Relevant Context
                  </label>
                  <Textarea
                    value={newProject.relevant_context}
                    onChange={(e) => setNewProject(prev => ({ ...prev, relevant_context: e.target.value }))}
                    placeholder="Share context about objectives, your contribution, outcomes, and why this work is relevant."
                    className="min-h-[90px] border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={addProject}
                  className="bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
                >
                  Add project
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAddProject(false)}
                  className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          
          <div className="space-y-3">
            {credentials.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-vendor-border text-sm text-vendor-muted">
                No credentials added yet.
              </div>
            ) : (
              credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="p-4 rounded-lg border border-vendor-border bg-vendor-background space-y-3"
                >
                  {editingCredentialId === cred.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Input
                          value={cred.title}
                          onChange={(e) => updateCredential(cred.id, { title: e.target.value })}
                          placeholder="Project title"
                          className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                        />
                        <Input
                          value={cred.client}
                          onChange={(e) => updateCredential(cred.id, { client: e.target.value })}
                          placeholder="Client"
                          className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                        />
                        <Input
                          value={cred.year}
                          onChange={(e) => updateCredential(cred.id, { year: e.target.value })}
                          placeholder="Year"
                          className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                        />
                      </div>
                      <Textarea
                        value={cred.relevant_context}
                        onChange={(e) => updateCredential(cred.id, { relevant_context: e.target.value })}
                        placeholder="Relevant context for this project."
                        className="min-h-[90px] border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="font-display font-bold text-sm text-vendor-foreground">{cred.title}</div>
                      <div className="font-mono text-2xs text-vendor-muted">
                        {cred.client} • {cred.year}
                      </div>
                      {cred.relevant_context?.trim() ? (
                        <p className="text-sm text-vendor-foreground mt-2 whitespace-pre-wrap">{cred.relevant_context}</p>
                      ) : null}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                    className="text-vendor-foreground hover:text-vendor-foreground hover:bg-vendor-foreground/10"
                      onClick={() => setEditingCredentialId((prev) => (prev === cred.id ? null : cred.id))}
                    >
                      {editingCredentialId === cred.id ? "Done" : "Edit"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeCredential(cred.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Reel / Work Examples */}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <h2 className="font-display font-bold text-lg text-vendor-foreground mb-6">Reel & work examples</h2>

          <div className="space-y-6">
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Primary Reel URL or Upload
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={reelUrl}
                  onChange={(e) => setReelUrl(e.target.value)}
                  placeholder="https://vimeo.com/your-reel"
                  className="border-vendor-border flex-1 text-vendor-foreground placeholder:text-vendor-muted"
                />
                <div className="relative">
                  <input
                    type="file"
                    ref={reelInputRef}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleReelUpload(file)
                    }}
                    accept="video/*"
                    className="sr-only"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reelInputRef.current?.click()}
                    disabled={isUploadingReel}
                    className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                  >
                    {isUploadingReel ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Video
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Capabilities Overview
              </label>
              <p className="text-sm text-vendor-muted-strong mb-2">
                Upload a PDF or document that summarizes your capabilities.
              </p>
              <div className="flex gap-2">
                <Input
                  value={capabilitiesOverviewUrl}
                  onChange={(e) => setCapabilitiesOverviewUrl(e.target.value)}
                  placeholder="Capabilities overview file URL"
                  className="border-vendor-border flex-1 text-vendor-foreground placeholder:text-vendor-muted"
                />
                <input
                  type="file"
                  ref={capabilitiesInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleCapabilitiesOverviewUpload(file)
                  }}
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.rtf,.key"
                  className="sr-only"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => capabilitiesInputRef.current?.click()}
                  disabled={isUploadingCapabilitiesOverview}
                  className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                >
                  {isUploadingCapabilitiesOverview ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload File
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                Additional Work Examples
              </label>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-vendor-border text-vendor-foreground hover:bg-vendor-foreground/5"
                  onClick={() => setShowAddWorkExample(true)}
                >
                  + Add work example
                </Button>

                {showAddWorkExample ? (
                  <div className="rounded-lg border border-vendor-foreground/20 bg-vendor-foreground/5 p-4 space-y-3">
                    <Input
                      value={newWorkExample.title}
                      onChange={(e) => setNewWorkExample((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Work example title"
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                    <Input
                      value={newWorkExample.url}
                      onChange={(e) => setNewWorkExample((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="https://example.com/work-item"
                      className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={newWorkExample.file_url}
                        onChange={(e) => setNewWorkExample((prev) => ({ ...prev, file_url: e.target.value }))}
                        placeholder="Uploaded file URL (optional)"
                        className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted flex-1"
                      />
                      <input
                        type="file"
                        ref={newWorkExampleInputRef}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleWorkExampleFileUpload("__new__", file)
                        }}
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.rtf,.key"
                        className="sr-only"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => newWorkExampleInputRef.current?.click()}
                        disabled={uploadingWorkExampleId === "__new__"}
                        className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                      >
                        {uploadingWorkExampleId === "__new__" ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Upload
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={addWorkExample}
                        className="bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
                      >
                        Add work example
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                        onClick={() => setShowAddWorkExample(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {workExamples.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-vendor-border text-sm text-vendor-muted">
                    No work examples added yet.
                  </div>
                ) : (
                  workExamples.map((example) => (
                    <div key={example.id} className="rounded-lg border border-vendor-border bg-vendor-background p-4 space-y-3">
                      <Input
                        value={example.title}
                        onChange={(e) =>
                          setWorkExamples((prev) =>
                            prev.map((w) => (w.id === example.id ? { ...w, title: e.target.value } : w)),
                          )
                        }
                        placeholder="Title"
                        className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                      />
                      <Input
                        value={example.url}
                        onChange={(e) =>
                          setWorkExamples((prev) =>
                            prev.map((w) => (w.id === example.id ? { ...w, url: e.target.value } : w)),
                          )
                        }
                        placeholder="URL"
                        className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted"
                      />
                      <div className="flex gap-2">
                        <Input
                          value={example.file_url}
                          onChange={(e) =>
                            setWorkExamples((prev) =>
                              prev.map((w) => (w.id === example.id ? { ...w, file_url: e.target.value } : w)),
                            )
                          }
                          placeholder="Uploaded file URL (optional)"
                          className="border-vendor-border text-vendor-foreground placeholder:text-vendor-muted flex-1"
                        />
                        <input
                          id={`work-example-file-${example.id}`}
                          type="file"
                          className="sr-only"
                          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.rtf,.key"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleWorkExampleFileUpload(example.id, file)
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="border-vendor-border text-vendor-foreground hover:bg-vendor-background"
                          disabled={uploadingWorkExampleId === example.id}
                          onClick={() =>
                            (document.getElementById(`work-example-file-${example.id}`) as HTMLInputElement | null)?.click()
                          }
                        >
                          {uploadingWorkExampleId === example.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Upload
                            </>
                          )}
                        </Button>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setWorkExamples((prev) => prev.filter((w) => w.id !== example.id))}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        {message && <p className="text-sm text-vendor-muted-strong">{message}</p>}
      </div>
    </PartnerChrome>
  )
}
