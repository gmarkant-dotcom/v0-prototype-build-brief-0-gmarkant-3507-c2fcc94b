"use client"

import { useState, useRef, useEffect } from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { PartnerChrome } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Loader2, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"

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
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
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
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
      if (profile?.role !== "partner") {
        router.push("/partner")
        return
      }
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, role, email, full_name, company_name, company_website, is_discoverable, bio, location, agency_type, avatar_url, reel_url, capabilities_overview_url, capabilities, credentials, work_examples"
        )
        .eq("id", user.id)
        .maybeSingle()
      setAccountEmail(user.email || "")
      setAccountFullName(data?.full_name || "")
      setProfileId(data?.id || user.id)
      setDiscoverable(!!data?.is_discoverable)
      setFormData((prev) => ({
        ...prev,
        companyName: data?.company_name || data?.full_name || "",
        companyWebsite: (data as { company_website?: string | null } | null)?.company_website || "",
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
        .select("id, agency_id")
        .eq("partner_id", user.id)
        .eq("status", "active")

      const partnershipRows = Array.isArray(activePartnerships) ? activePartnerships : []
      const agencyIds = Array.from(
        new Set(partnershipRows.map((row) => String(row.agency_id || "")).filter(Boolean))
      )

      let agencyNameById: Record<string, string> = {}
      if (agencyIds.length > 0) {
        const { data: agencyProfiles } = await supabase
          .from("profiles")
          .select("id, company_name, full_name")
          .in("id", agencyIds)

        agencyNameById = Object.fromEntries(
          (agencyProfiles || []).map((profile) => [
            String(profile.id),
            String(profile.company_name || profile.full_name || "Lead Agency"),
          ])
        )
      }

      const partnershipOptions = partnershipRows.map((row) => ({
        partnership_id: String(row.id),
        agency_name: agencyNameById[String(row.agency_id || "")] || "Lead Agency",
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

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()
    if (!apiKey) return

    let placeChangedListener: google.maps.MapsEventListener | null = null
    let isDisposed = false

    const loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
      version: "weekly",
      libraries: ["places"],
    })

    loader
      .load()
      .then(() => {
        if (isDisposed || !locationInputRef.current) return
        const autocomplete = new google.maps.places.Autocomplete(locationInputRef.current, {
          types: ["(cities)"],
        })
        autocompleteRef.current = autocomplete
        placeChangedListener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace()
          const components = place.address_components || []
          const cityComponent =
            components.find((component) => component.types.includes("locality")) ||
            components.find((component) => component.types.includes("administrative_area_level_1"))
          const countryComponent = components.find((component) => component.types.includes("country"))
          const city = cityComponent?.long_name?.trim()
          const country = countryComponent?.long_name?.trim()
          const formattedLocation = city && country ? `${city}, ${country}` : city || country || ""
          if (!formattedLocation) return
          setFormData((prev) => ({ ...prev, location: formattedLocation }))
        })
      })
      .catch(() => {
        // Allow manual typing if Google Places fails to load.
      })

    return () => {
      isDisposed = true
      placeChangedListener?.remove()
      autocompleteRef.current = null
    }
  }, [])

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
        const { data: roleProfile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
        if (roleProfile?.role !== "partner") {
          setMessage("Only partner users can save this profile.")
          return
        }
        const targetProfileId = profileId || user.id
        const { error } = await supabase
          .from("profiles")
          .update({
            company_name: formData.companyName,
            company_website: formData.companyWebsite || null,
            agency_type: formData.primaryDiscipline,
            bio: formData.bio,
            location: formData.location,
            capabilities: formData.selectedCapabilities,
            reel_url: reelUrl || null,
            capabilities_overview_url: capabilitiesOverviewUrl || null,
            credentials,
            work_examples: workExamples,
            is_discoverable: discoverable,
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetProfileId)
        if (error) throw error
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
        <div className="max-w-4xl mx-auto p-8 text-gray-600">Loading profile...</div>
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
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Profile & Capabilities</h1>
            <p className="text-gray-600 mt-1">
              Tell agencies about your company, expertise, and past work.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "transition-all min-w-[140px] rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60",
              saved 
                ? "bg-green-600 hover:bg-green-600" 
                : "bg-[#0C3535] hover:bg-[#0C3535]/90"
            )}
          >
            {saving ? "Saving..." : saved ? "Saved Successfully" : "Save Changes"}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Account Email</label>
              <Input value={accountEmail} readOnly className="border-gray-200 bg-gray-100 text-gray-700" />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Account Full Name</label>
              <Input value={accountFullName} readOnly className="border-gray-200 bg-gray-100 text-gray-700" />
            </div>
          </div>
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <div className="font-display font-bold text-lg text-[#0C3535]">
                Allow agencies to discover me on the Marketplace
              </div>
              <p className="text-sm text-gray-600 mt-1">
                When enabled, your agency profile can appear in Marketplace discovery for lead agencies.
              </p>
              {discoverabilityMsg && <p className="text-xs text-gray-500 mt-2">{discoverabilityMsg}</p>}
            </div>
            <Switch checked={discoverable} onCheckedChange={toggleDiscoverability} disabled={discoverabilitySaving} />
          </label>
        </div>
        
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Company Profile & Basic Information</h2>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Company Name
              </label>
              <Input
                value={formData.companyName}
                onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Company Website
              </label>
              <Input
                type="text"
                value={formData.companyWebsite}
                onChange={(e) => setFormData(prev => ({ ...prev, companyWebsite: e.target.value }))}
                placeholder="https://youragency.com"
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Company Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
              >
                <option value="production">Production Company</option>
                <option value="agency">Agency</option>
                <option value="freelancer">Freelancer / Individual</option>
                <option value="studio">Studio</option>
              </select>
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Primary Discipline
              </label>
              {showCustomDiscipline ? (
                <div className="flex gap-2">
                  <Input
                    value={customDisciplineInput}
                    onChange={(e) => setCustomDisciplineInput(e.target.value)}
                    placeholder="Enter custom discipline"
                    className="border-gray-200 flex-1 text-gray-900 placeholder:text-gray-500"
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
                    className="bg-[#0C3535] text-white hover:bg-[#0C3535]/90"
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
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
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
                  className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                >
                  {allDisciplines.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value="__custom__">+ Add Custom Discipline</option>
                </select>
              )}
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Location
              </label>
              <input
                ref={locationInputRef}
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                placeholder="Start typing a city..."
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Team Size
                </label>
                <select
                  value={formData.teamSize}
                  onChange={(e) => setFormData(prev => ({ ...prev, teamSize: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                >
                  <option value="1">Solo</option>
                  <option value="2-4">2-4</option>
                  <option value="5-10">5-10</option>
                  <option value="11-25">11-25</option>
                  <option value="25+">25+</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Year Founded
                </label>
                <Input
                  value={formData.yearFounded}
                  onChange={(e) => setFormData(prev => ({ ...prev, yearFounded: e.target.value }))}
                  className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
            </div>
            
            <div className="col-span-2">
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Company Bio
              </label>
              <Textarea
                value={formData.bio}
                onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                className="min-h-[120px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                placeholder="Describe your company, expertise, and what makes you unique..."
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Partnership Context</h2>
              <p className="text-sm text-gray-600 mt-1">
                Tailor your profile details for each active lead agency partnership.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleSavePartnershipContext}
              disabled={!selectedPartnershipId || contextSaving}
              className={cn(
                "min-w-[120px] bg-[#0C3535] text-white hover:bg-[#0C3535]/90",
                contextSaved && "bg-green-600 hover:bg-green-600"
              )}
              style={{ color: "inherit" }}
            >
              {contextSaving ? "Saving..." : contextSaved ? "Saved ✓" : "Save Context"}
            </Button>
          </div>

          {activePartnershipOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
              No active partner partnerships found.
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Partnership
                </label>
                <select
                  value={selectedPartnershipId}
                  onChange={(e) => {
                    setContextSaved(false)
                    setSelectedPartnershipId(e.target.value)
                  }}
                  className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                >
                  {activePartnershipOptions.map((option) => (
                    <option key={option.partnership_id} value={option.partnership_id}>
                      {option.agency_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Bio
                </label>
                <Textarea
                  value={selectedPartnershipContext.bio}
                  onChange={(e) => updateSelectedPartnershipContext({ bio: e.target.value })}
                  className="min-h-[120px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                  placeholder="Describe how you'd like to present yourself for this specific partnership."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Reel URL
                  </label>
                  <Input
                    value={selectedPartnershipContext.reel_url}
                    onChange={(e) => updateSelectedPartnershipContext({ reel_url: e.target.value })}
                    placeholder="https://vimeo.com/partnership-specific-reel"
                    className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Capabilities Tags
                  </label>
                  <Input
                    value={selectedPartnershipContext.capabilities_tags_input}
                    onChange={(e) => updateSelectedPartnershipContext({ capabilities_tags_input: e.target.value })}
                    placeholder="Production, Motion Design, Creator Content"
                    className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                  <p className="text-xs text-gray-400 mt-2">Enter comma-separated tags.</p>
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Credentials Notes
                </label>
                <Textarea
                  value={selectedPartnershipContext.credentials_notes}
                  onChange={(e) => updateSelectedPartnershipContext({ credentials_notes: e.target.value })}
                  className="min-h-[100px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                  placeholder="Plain-text credentials notes for this partnership."
                />
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-display font-bold text-base text-[#0C3535]">Payment Terms</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Deposit Percent
                    </label>
                    <Input
                      type="number"
                      value={selectedPartnershipContext.deposit_percent}
                      onChange={(e) => updateSelectedPartnershipContext({ deposit_percent: e.target.value })}
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Net Days
                    </label>
                    <Input
                      type="number"
                      value={selectedPartnershipContext.net_days}
                      onChange={(e) => updateSelectedPartnershipContext({ net_days: e.target.value })}
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Schedule Preference
                    </label>
                    <Input
                      value={selectedPartnershipContext.schedule_preference}
                      onChange={(e) => updateSelectedPartnershipContext({ schedule_preference: e.target.value })}
                      placeholder="Milestone-based, Net 30, etc."
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Notes
                    </label>
                    <Input
                      value={selectedPartnershipContext.payment_notes}
                      onChange={(e) => updateSelectedPartnershipContext({ payment_notes: e.target.value })}
                      placeholder="Additional payment notes"
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Capabilities */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-2">Capabilities</h2>
          <p className="text-sm text-gray-600 mb-6">
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
                    ? "bg-[#0C3535] text-white border-[#0C3535]"
                    : "bg-white text-gray-600 border-gray-200 hover:border-[#0C3535]/30"
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
                className="px-4 py-2 rounded-full font-mono text-xs transition-all border bg-purple-600 text-white border-purple-600 hover:bg-purple-700"
              >
                ✓ {cap} ×
              </button>
            ))}
          </div>
          
          {/* Add Custom Capability */}
          <div className="pt-4 border-t border-gray-200">
            <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
              Add Custom Capability
            </label>
            <div className="flex gap-2">
              <Input
                value={customCapability}
                onChange={(e) => setCustomCapability(e.target.value)}
                placeholder="e.g., Aerial Cinematography, VR/360 Video..."
                className="flex-1 border-gray-200 text-gray-900 placeholder:text-gray-500"
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
                className="border-[#0C3535] text-[#0C3535] hover:bg-[#0C3535]/5"
                style={{ color: "inherit" }}
              >
                + Add
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Custom capabilities appear in purple. Click to remove.
            </p>
          </div>
        </div>
        
        {/* Credentials / Portfolio */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Credentials & Portfolio</h2>
              <p className="text-sm text-gray-600">
                Showcase your best work to potential agency partners.
              </p>
            </div>
            <Button
              variant="outline" 
              className="border-gray-300 text-[#0C3535] hover:bg-[#0C3535]/5"
              style={{ color: "inherit" }}
              onClick={() => setShowAddProject(true)}
            >
              + Add Project
            </Button>
          </div>
          
          {showAddProject && (
            <div className="mb-6 p-4 rounded-lg border border-[#0C3535]/20 bg-[#0C3535]/5">
              <h3 className="font-display font-bold text-sm text-[#0C3535] mb-4">Add New Project</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Project Title
                  </label>
                  <Input
                    value={newProject.title}
                    onChange={(e) => setNewProject(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Project name"
                    className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Client
                  </label>
                  <Input
                    value={newProject.client}
                    onChange={(e) => setNewProject(prev => ({ ...prev, client: e.target.value }))}
                    placeholder="Client name"
                    className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Year
                  </label>
                  <Input
                    value={newProject.year}
                    onChange={(e) => setNewProject(prev => ({ ...prev, year: e.target.value }))}
                    placeholder="2024"
                    className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Relevant Context
                  </label>
                  <Textarea
                    value={newProject.relevant_context}
                    onChange={(e) => setNewProject(prev => ({ ...prev, relevant_context: e.target.value }))}
                    placeholder="Share context about objectives, your contribution, outcomes, and why this work is relevant."
                    className="min-h-[90px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={addProject}
                  className="bg-[#0C3535] text-white hover:bg-[#0C3535]/90"
                  style={{ color: "inherit" }}
                >
                  Add Project
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAddProject(false)}
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          
          <div className="space-y-3">
            {credentials.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500">
                No credentials added yet.
              </div>
            ) : (
              credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="p-4 rounded-lg border border-gray-200 bg-gray-50 space-y-3"
                >
                  {editingCredentialId === cred.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Input
                          value={cred.title}
                          onChange={(e) => updateCredential(cred.id, { title: e.target.value })}
                          placeholder="Project title"
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                        />
                        <Input
                          value={cred.client}
                          onChange={(e) => updateCredential(cred.id, { client: e.target.value })}
                          placeholder="Client"
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                        />
                        <Input
                          value={cred.year}
                          onChange={(e) => updateCredential(cred.id, { year: e.target.value })}
                          placeholder="Year"
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                        />
                      </div>
                      <Textarea
                        value={cred.relevant_context}
                        onChange={(e) => updateCredential(cred.id, { relevant_context: e.target.value })}
                        placeholder="Relevant context for this project."
                        className="min-h-[90px] border-gray-200 text-gray-900 placeholder:text-gray-500"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="font-display font-bold text-sm text-[#0C3535]">{cred.title}</div>
                      <div className="font-mono text-[10px] text-gray-500">
                        {cred.client} • {cred.year}
                      </div>
                      {cred.relevant_context?.trim() ? (
                        <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{cred.relevant_context}</p>
                      ) : null}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#0C3535] hover:text-[#0C3535] hover:bg-[#0C3535]/10"
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
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Reel & Work Examples</h2>

          <div className="space-y-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Primary Reel URL or Upload
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={reelUrl}
                  onChange={(e) => setReelUrl(e.target.value)}
                  placeholder="https://vimeo.com/your-reel"
                  className="border-gray-200 flex-1 text-gray-900 placeholder:text-gray-500"
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
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    style={{ color: "inherit" }}
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
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Capabilities Overview
              </label>
              <p className="text-sm text-gray-600 mb-2">
                Upload a PDF or document that summarizes your capabilities.
              </p>
              <div className="flex gap-2">
                <Input
                  value={capabilitiesOverviewUrl}
                  onChange={(e) => setCapabilitiesOverviewUrl(e.target.value)}
                  placeholder="Capabilities overview file URL"
                  className="border-gray-200 flex-1 text-gray-900 placeholder:text-gray-500"
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
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  style={{ color: "inherit" }}
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
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Additional Work Examples
              </label>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-300 text-[#0C3535] hover:bg-[#0C3535]/5"
                  style={{ color: "inherit" }}
                  onClick={() => setShowAddWorkExample(true)}
                >
                  + Add Work Example
                </Button>

                {showAddWorkExample ? (
                  <div className="rounded-lg border border-[#0C3535]/20 bg-[#0C3535]/5 p-4 space-y-3">
                    <Input
                      value={newWorkExample.title}
                      onChange={(e) => setNewWorkExample((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Work example title"
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                    <Input
                      value={newWorkExample.url}
                      onChange={(e) => setNewWorkExample((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="https://example.com/work-item"
                      className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={newWorkExample.file_url}
                        onChange={(e) => setNewWorkExample((prev) => ({ ...prev, file_url: e.target.value }))}
                        placeholder="Uploaded file URL (optional)"
                        className="border-gray-200 text-gray-900 placeholder:text-gray-500 flex-1"
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
                        className="border-gray-300 text-gray-700 hover:bg-gray-50"
                        style={{ color: "inherit" }}
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
                        className="bg-[#0C3535] text-white hover:bg-[#0C3535]/90"
                        style={{ color: "inherit" }}
                      >
                        Add Work Example
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-gray-300 text-gray-700 hover:bg-gray-50"
                        onClick={() => setShowAddWorkExample(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {workExamples.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500">
                    No work examples added yet.
                  </div>
                ) : (
                  workExamples.map((example) => (
                    <div key={example.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                      <Input
                        value={example.title}
                        onChange={(e) =>
                          setWorkExamples((prev) =>
                            prev.map((w) => (w.id === example.id ? { ...w, title: e.target.value } : w)),
                          )
                        }
                        placeholder="Title"
                        className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                      />
                      <Input
                        value={example.url}
                        onChange={(e) =>
                          setWorkExamples((prev) =>
                            prev.map((w) => (w.id === example.id ? { ...w, url: e.target.value } : w)),
                          )
                        }
                        placeholder="URL"
                        className="border-gray-200 text-gray-900 placeholder:text-gray-500"
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
                          className="border-gray-200 text-gray-900 placeholder:text-gray-500 flex-1"
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
                          className="border-gray-300 text-gray-700 hover:bg-gray-50"
                          disabled={uploadingWorkExampleId === example.id}
                          style={{ color: "inherit" }}
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
        {message && <p className="text-sm text-gray-600">{message}</p>}
      </div>
    </PartnerChrome>
  )
}
