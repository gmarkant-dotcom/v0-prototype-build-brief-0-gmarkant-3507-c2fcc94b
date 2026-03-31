"use client"

import { useState, useRef, useEffect } from "react"
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
    type: "",
    primaryDiscipline: disciplines[0],
    bio: "",
    location: "",
    website: "",
    selectedCapabilities: [] as string[],
    teamSize: "",
    yearFounded: "",
  })

  const [credentials, setCredentials] = useState<{ id: string; title: string; client: string; year: string }[]>([])
  const [showAddProject, setShowAddProject] = useState(false)
  const [newProject, setNewProject] = useState({ title: "", client: "", year: new Date().getFullYear().toString() })
  const [isUploadingReel, setIsUploadingReel] = useState(false)
  const [reelUrl, setReelUrl] = useState("")
  const reelInputRef = useRef<HTMLInputElement>(null)

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
        .select("*")
        .eq("id", user.id)
        .maybeSingle()
      setAccountEmail(user.email || "")
      setAccountFullName(data?.full_name || "")
      setProfileId(data?.id || user.id)
      setDiscoverable(!!data?.is_discoverable)
      setFormData((prev) => ({
        ...prev,
        companyName: data?.company_name || data?.full_name || "",
        type: data?.agency_type || "",
        bio: data?.bio || "",
        location: data?.location || "",
        website: data?.website || "",
      }))
      if (typeof window !== "undefined") {
        const savedDiscipline = localStorage.getItem("partnerPrimaryDiscipline")
        const savedCaps = localStorage.getItem("partnerSelectedCapabilities")
        const savedCustomCaps = localStorage.getItem("partnerCustomCapabilities")
        const savedCredentials = localStorage.getItem("partnerCredentials")
        const savedTeamSize = localStorage.getItem("partnerTeamSize")
        const savedYearFounded = localStorage.getItem("partnerYearFounded")
        if (savedDiscipline) setFormData((prev) => ({ ...prev, primaryDiscipline: savedDiscipline }))
        if (savedCaps) setFormData((prev) => ({ ...prev, selectedCapabilities: JSON.parse(savedCaps) }))
        if (savedCustomCaps) setCustomCapabilities(JSON.parse(savedCustomCaps))
        if (savedCredentials) setCredentials(JSON.parse(savedCredentials))
        if (savedTeamSize) setFormData((prev) => ({ ...prev, teamSize: savedTeamSize }))
        if (savedYearFounded) setFormData((prev) => ({ ...prev, yearFounded: savedYearFounded }))
      }
      setLoading(false)
    }
    ensurePartnerAuth()
  }, [isDemo, router])

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

  const addProject = () => {
    if (newProject.title && newProject.client) {
      setCredentials(prev => [...prev, { id: Date.now().toString(), ...newProject }])
      setNewProject({ title: "", client: "", year: new Date().getFullYear().toString() })
      setShowAddProject(false)
    }
  }
  
  const handleSave = async () => {
    console.log("[partner/profile] save clicked", { isDemo, hasProfileId: !!profileId })
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
            agency_type: formData.type,
            bio: formData.bio,
            location: formData.location,
            website: formData.website,
            is_discoverable: discoverable,
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetProfileId)
        if (error) throw error
        console.log("[partner/profile] save success", { targetProfileId })
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("partnerPrimaryDiscipline", formData.primaryDiscipline)
        localStorage.setItem("partnerSelectedCapabilities", JSON.stringify(formData.selectedCapabilities))
        localStorage.setItem("partnerCustomCapabilities", JSON.stringify(customCapabilities))
        localStorage.setItem("partnerCredentials", JSON.stringify(credentials))
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
              <Input
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Website
              </label>
              <Input
                type="url"
                value={formData.website}
                onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
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
              className="border-gray-300 text-[#0C3535]"
              onClick={() => setShowAddProject(true)}
            >
              + Add Project
            </Button>
          </div>
          
          {showAddProject && (
            <div className="mb-6 p-4 rounded-lg border border-[#0C3535]/20 bg-[#0C3535]/5">
              <h3 className="font-display font-bold text-sm text-[#0C3535] mb-4">Add New Project</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
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
              </div>
              <div className="flex gap-2">
                <Button onClick={addProject} className="bg-[#0C3535] hover:bg-[#0C3535]/90">
                  Add Project
                </Button>
                <Button variant="outline" onClick={() => setShowAddProject(false)}>
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
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 bg-gray-50"
              >
                <div>
                  <div className="font-display font-bold text-sm text-[#0C3535]">{cred.title}</div>
                  <div className="font-mono text-[10px] text-gray-500">
                    {cred.client} • {cred.year}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-gray-500 hover:text-[#0C3535]">
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600">
                    Remove
                  </Button>
                </div>
              </div>
              ))
            )}
          </div>
        </div>
        
        {/* Reel / Demo Links */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Reel & Demo Links</h2>
          
          <div className="space-y-4">
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
                    className="border-gray-300"
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
                Additional Demo Links (one per line)
              </label>
              <Textarea
                placeholder="https://vimeo.com/project-1&#10;https://youtube.com/project-2"
                className="min-h-[80px] border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>
        </div>
        {message && <p className="text-sm text-gray-600">{message}</p>}
      </div>
    </PartnerChrome>
  )
}
