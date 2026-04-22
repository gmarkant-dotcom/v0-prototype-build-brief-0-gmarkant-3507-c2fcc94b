"use client"

/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { importLibrary, setOptions } from "@googlemaps/js-api-loader"
import { AgencyShell } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { Camera, Loader2 } from "lucide-react"
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

type ProfileState = {
  id: string
  full_name: string
  email: string
  company_name: string
  company_website: string
  bio: string
  location: string
  website: string
  agency_type: string
  avatar_url: string
  meeting_url: string
  is_discoverable: boolean
  payment_terms: string
  payment_terms_custom: string
}

export default function AgencyProfileSettingsPage() {
  const router = useRouter()
  const isDemo = isDemoMode()
  const fileRef = useRef<HTMLInputElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [primaryDiscipline, setPrimaryDiscipline] = useState(disciplines[0])
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([])
  const [customCapability, setCustomCapability] = useState("")
  const [customCapabilities, setCustomCapabilities] = useState<string[]>([])
  const [form, setForm] = useState<ProfileState>({
    id: "",
    full_name: "",
    email: "",
    company_name: "",
    company_website: "",
    bio: "",
    location: "",
    website: "",
    agency_type: "",
    avatar_url: "",
    meeting_url: "",
    is_discoverable: false,
    payment_terms: "net_30",
    payment_terms_custom: "",
  })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fagency%2Fsettings%2Fprofile")
        return
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select(
          "id, role, email, full_name, company_name, company_website, is_discoverable, bio, location, website, agency_type, avatar_url, meeting_url, payment_terms, payment_terms_custom"
        )
        .eq("id", user.id)
        .maybeSingle()
      if (profile?.role !== "agency") {
        router.push("/agency")
        return
      }
      setForm({
        id: profile.id,
        full_name: profile.full_name || "",
        email: user.email || "",
        company_name: profile.company_name || profile.full_name || "",
        company_website: (profile as { company_website?: string | null }).company_website || "",
        bio: profile.bio || "",
        location: profile.location || "",
        website: profile.website || "",
        agency_type: profile.agency_type || "",
        avatar_url: profile.avatar_url || "",
        meeting_url: profile.meeting_url || "",
        is_discoverable: !!profile.is_discoverable,
        payment_terms: (profile as { payment_terms?: string | null }).payment_terms || "net_30",
        payment_terms_custom: (profile as { payment_terms_custom?: string | null }).payment_terms_custom || "",
      })
      if (typeof window !== "undefined") {
        const savedDiscipline = localStorage.getItem("agencyPrimaryDiscipline")
        const savedCaps = localStorage.getItem("agencySelectedCapabilities")
        const savedCustomCaps = localStorage.getItem("agencyCustomCapabilities")
        if (savedDiscipline) setPrimaryDiscipline(savedDiscipline)
        if (savedCaps) setSelectedCapabilities(JSON.parse(savedCaps))
        if (savedCustomCaps) setCustomCapabilities(JSON.parse(savedCustomCaps))
      }
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey || loading) return

    let placeChangedListener: google.maps.MapsEventListener | null = null
    let isDisposed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const setupAutocomplete = () => {
      if (!locationInputRef.current || autocompleteRef.current) return
      try {
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
          if (locationInputRef.current) {
            locationInputRef.current.value = formattedLocation
          }
          setForm((p) => ({ ...p, location: formattedLocation }))
        })
      } catch (err) {
        console.error("Google Places failed to load:", err)
      }
    }

    const trySetupAfterPaint = () => {
      if (isDisposed) return
      setupAutocomplete()
      if (!autocompleteRef.current && locationInputRef.current) {
        requestAnimationFrame(() => {
          if (isDisposed) return
          setupAutocomplete()
          if (!autocompleteRef.current && locationInputRef.current) {
            retryTimer = window.setTimeout(() => {
              retryTimer = null
              if (isDisposed) return
              setupAutocomplete()
            }, 150)
          }
        })
      }
    }

    const initAutocomplete = async () => {
      try {
        setOptions({ key: apiKey, v: "weekly" })
        await importLibrary("places")
        if (isDisposed) return
        trySetupAfterPaint()
      } catch (err) {
        console.error("Google Places failed to load:", err)
      }
    }

    void initAutocomplete()

    return () => {
      isDisposed = true
      if (retryTimer != null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
      placeChangedListener?.remove()
      autocompleteRef.current = null
    }
  }, [loading])

  const saveProfile = async () => {
    setSaving(true)
    setMessage(null)
    if (isDemo) {
      setMessage("Demo mode - profile changes are not persisted.")
      setSaving(false)
      return
    }
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({
        company_name: form.company_name || form.full_name || null,
        company_website: form.company_website || null,
        bio: form.bio,
        location: form.location,
        website: form.website,
        agency_type: form.agency_type,
        avatar_url: form.avatar_url || null,
        meeting_url: form.meeting_url || null,
        is_discoverable: form.is_discoverable,
        payment_terms: form.payment_terms || "net_30",
        payment_terms_custom:
          form.payment_terms === "custom" ? form.payment_terms_custom.trim() || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", form.id)
    if (!error && typeof window !== "undefined") {
      localStorage.setItem("agencyPrimaryDiscipline", primaryDiscipline)
      localStorage.setItem("agencySelectedCapabilities", JSON.stringify(selectedCapabilities))
      localStorage.setItem("agencyCustomCapabilities", JSON.stringify(customCapabilities))
    }
    setMessage(error ? error.message : "Agency profile updated.")
    setSaving(false)
  }

  const toggleDiscoverable = async (checked: boolean) => {
    setForm((prev) => ({ ...prev, is_discoverable: checked }))
    if (isDemo || !form.id) return
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({ is_discoverable: checked, updated_at: new Date().toISOString() })
      .eq("id", form.id)
    if (error) {
      setMessage(error.message)
      setForm((prev) => ({ ...prev, is_discoverable: !checked }))
      return
    }
    setMessage("Marketplace discoverability updated.")
  }

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true)
    setMessage(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "agency-logos")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to upload logo")
      setForm((prev) => ({ ...prev, avatar_url: payload.url || prev.avatar_url }))
      setMessage("Logo uploaded.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload logo.")
    } finally {
      setUploadingLogo(false)
    }
  }

  if (loading) {
    return (
      <AgencyShell>
        <div className="p-8 flex items-center justify-center text-foreground-muted">Loading profile...</div>
      </AgencyShell>
    )
  }

  const toggleCapability = (cap: string) => {
    setSelectedCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]))
  }

  const addCustomCapability = () => {
    const value = customCapability.trim()
    if (!value || capabilities.includes(value) || customCapabilities.includes(value)) return
    setCustomCapabilities((prev) => [...prev, value])
    setSelectedCapabilities((prev) => [...prev, value])
    setCustomCapability("")
  }

  const removeCustomCapability = (cap: string) => {
    setCustomCapabilities((prev) => prev.filter((c) => c !== cap))
    setSelectedCapabilities((prev) => prev.filter((c) => c !== cap))
  }

  return (
    <AgencyShell>
      <div className="p-8 max-w-4xl space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Agency Profile</h1>
          <p className="text-foreground-muted mt-1">
            Manage your public marketplace profile and company information.
          </p>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Account Full Name</label>
              <Input value={form.full_name} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Account Email</label>
              <Input value={form.email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="Agency logo" className="w-full h-full object-cover" />
              ) : (
                <span className="font-display font-bold text-xl text-accent">
                  {(form.company_name || "A")
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
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
              <Button variant="outline" className="border-border text-foreground" onClick={() => fileRef.current?.click()}>
                {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Upload Logo
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-5">
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Name</label>
            <Input
              value={form.company_name}
              onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Website</label>
            <Input
              type="text"
              value={form.company_website}
              onChange={(e) => setForm((p) => ({ ...p, company_website: e.target.value }))}
              placeholder="https://youragency.com"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Agency Type / Specialization</label>
            <Input
              value={form.agency_type}
              onChange={(e) => setForm((p) => ({ ...p, agency_type: e.target.value }))}
              placeholder="e.g. Sports Marketing, Production, Brand Strategy"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Primary Discipline</label>
            <select
              value={primaryDiscipline}
              onChange={(e) => setPrimaryDiscipline(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
            >
              {disciplines.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Description / Bio</label>
            <Textarea
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              className="min-h-[120px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Capabilities</label>
            <div className="flex flex-wrap gap-2">
              {capabilities.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCapability(cap)}
                  className={
                    selectedCapabilities.includes(cap)
                      ? "px-3 py-1.5 rounded-full text-xs border bg-[#0C3535] text-white border-[#0C3535]"
                      : "px-3 py-1.5 rounded-full text-xs border bg-white text-gray-700 border-gray-200 hover:border-[#0C3535]/40"
                  }
                >
                  {selectedCapabilities.includes(cap) ? "✓ " : ""}
                  {cap}
                </button>
              ))}
              {customCapabilities.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => removeCustomCapability(cap)}
                  className="px-3 py-1.5 rounded-full text-xs border bg-purple-600 text-white border-purple-600"
                >
                  ✓ {cap} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Input
                value={customCapability}
                onChange={(e) => setCustomCapability(e.target.value)}
                placeholder="Add custom capability"
                className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
              <Button type="button" variant="outline" className="border-border text-foreground" onClick={addCustomCapability}>
                Add
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form
              className="contents"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
              }}
            >
              <div>
                <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Location</label>
                <input
                  key={`${form.id || "pending"}-location`}
                  ref={locationInputRef}
                  type="text"
                  name="agency_profile_location"
                  autoComplete="off"
                  defaultValue={form.location}
                  onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  placeholder="Start typing a city..."
                  className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
                />
              </div>
            </form>
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Website URL</label>
              <Input
                value={form.website}
                onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))}
                placeholder="https://example.com"
                className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">
              Preferred payment terms
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Used when generating MSA payment schedules (e.g. Net 30 = payment due 30 days after invoice).
            </p>
            <select
              value={form.payment_terms}
              onChange={(e) => setForm((p) => ({ ...p, payment_terms: e.target.value }))}
              className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
            >
              <option value="net_15">Net 15</option>
              <option value="net_30">Net 30</option>
              <option value="net_45">Net 45</option>
              <option value="custom">Custom</option>
            </select>
            {form.payment_terms === "custom" ? (
              <Input
                value={form.payment_terms_custom}
                onChange={(e) => setForm((p) => ({ ...p, payment_terms_custom: e.target.value }))}
                placeholder="Describe your standard payment terms"
                className="mt-2 bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            ) : null}
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Scheduling Link</label>
            <Input
              value={form.meeting_url}
              onChange={(e) => setForm((p) => ({ ...p, meeting_url: e.target.value }))}
              placeholder="https://calendly.com/your-team/intro"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Paste your Calendly or scheduling link here — partners will see this when you request a meeting.
            </p>
          </div>
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <div className="text-foreground font-medium">Make my agency discoverable on the Ligament Marketplace</div>
              <p className="text-xs text-foreground-muted mt-1">
                Discoverable agencies can be found by partner agencies and other lead agencies on the platform.
              </p>
            </div>
            <Switch checked={form.is_discoverable} onCheckedChange={toggleDiscoverable} />
          </label>
          {message && <p className="text-sm text-foreground-muted">{message}</p>}
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </div>
    </AgencyShell>
  )
}
