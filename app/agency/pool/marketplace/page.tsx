"use client"

import { useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ExternalLink, Star, Plus, Edit3, Trash2, ArrowLeft, Globe, Briefcase, Palette, Code, Video, Megaphone, PenTool } from "lucide-react"

type MarketplaceCategory = "general" | "creative" | "tech" | "marketing" | "video"

type Marketplace = {
  id: string
  name: string
  url: string
  description: string
  category: MarketplaceCategory
  isCustom: boolean
}

const defaultMarketplaces: Marketplace[] = [
  { id: "1", name: "Upwork", url: "https://www.upwork.com", description: "Global freelance marketplace for all disciplines", category: "general", isCustom: false },
  { id: "2", name: "Fiverr", url: "https://www.fiverr.com", description: "Freelance services starting at $5", category: "general", isCustom: false },
  { id: "3", name: "Freelancer", url: "https://www.freelancer.com", description: "Global freelance and crowdsourcing marketplace", category: "general", isCustom: false },
  { id: "4", name: "MarketerHire", url: "https://www.marketerhire.com", description: "Pre-vetted marketing talent", category: "marketing", isCustom: false },
  { id: "5", name: "Toptal", url: "https://www.toptal.com", description: "Top 3% of freelance talent", category: "tech", isCustom: false },
  { id: "6", name: "Right Side Up", url: "https://www.rightsideup.com", description: "Growth marketing experts", category: "marketing", isCustom: false },
  { id: "7", name: "Working Not Working", url: "https://www.workingnotworking.com", description: "Creative talent network", category: "creative", isCustom: false },
  { id: "8", name: "Contently", url: "https://www.contently.com", description: "Content marketing and freelance writers", category: "creative", isCustom: false },
  { id: "9", name: "99designs", url: "https://www.99designs.com", description: "Design contests and freelance designers", category: "creative", isCustom: false },
  { id: "10", name: "Dribbble", url: "https://www.dribbble.com", description: "Designer community and job board", category: "creative", isCustom: false },
  { id: "11", name: "Behance", url: "https://www.behance.net", description: "Adobe creative portfolio network", category: "creative", isCustom: false },
  { id: "12", name: "Creative Circle", url: "https://www.creativecircle.com", description: "Creative staffing agency", category: "creative", isCustom: false },
  { id: "13", name: "Contra", url: "https://www.contra.com", description: "Commission-free freelance platform", category: "general", isCustom: false },
  { id: "14", name: "Mayple", url: "https://www.mayple.com", description: "Vetted marketing experts", category: "marketing", isCustom: false },
  { id: "15", name: "CloudPeeps", url: "https://www.cloudpeeps.com", description: "Freelance marketing and content talent", category: "marketing", isCustom: false },
]

const categoryConfig: Record<MarketplaceCategory, { label: string; icon: typeof Globe; color: string }> = {
  general: { label: "General", icon: Globe, color: "text-foreground-muted" },
  creative: { label: "Creative", icon: Palette, color: "text-purple-400" },
  tech: { label: "Tech", icon: Code, color: "text-blue-400" },
  marketing: { label: "Marketing", icon: Megaphone, color: "text-accent" },
  video: { label: "Video", icon: Video, color: "text-red-400" },
}

export default function MarketplacePage() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>(defaultMarketplaces)
  const [selectedCategory, setSelectedCategory] = useState<MarketplaceCategory | "all">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingMarketplace, setEditingMarketplace] = useState<Marketplace | null>(null)
  const [newMarketplace, setNewMarketplace] = useState({
    name: "",
    url: "",
    description: "",
    category: "general" as MarketplaceCategory
  })

  const filteredMarketplaces = marketplaces.filter(m => {
    if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (selectedCategory !== "all" && m.category !== selectedCategory) return false
    return true
  })

  const addMarketplace = () => {
    const marketplace: Marketplace = {
      id: `custom-${Date.now()}`,
      name: newMarketplace.name,
      url: newMarketplace.url.startsWith("http") ? newMarketplace.url : `https://${newMarketplace.url}`,
      description: newMarketplace.description,
      category: newMarketplace.category,
      isCustom: true
    }
    setMarketplaces(prev => [...prev, marketplace])
    setNewMarketplace({ name: "", url: "", description: "", category: "general" })
    setShowAddModal(false)
  }

  const updateMarketplace = () => {
    if (!editingMarketplace) return
    setMarketplaces(prev => prev.map(m => 
      m.id === editingMarketplace.id 
        ? { 
            ...m, 
            name: newMarketplace.name,
            url: newMarketplace.url.startsWith("http") ? newMarketplace.url : `https://${newMarketplace.url}`,
            description: newMarketplace.description,
            category: newMarketplace.category
          }
        : m
    ))
    setEditingMarketplace(null)
    setNewMarketplace({ name: "", url: "", description: "", category: "general" })
    setShowAddModal(false)
  }

  const deleteMarketplace = (id: string) => {
    setMarketplaces(prev => prev.filter(m => m.id !== id))
  }

  const openEditModal = (marketplace: Marketplace) => {
    setEditingMarketplace(marketplace)
    setNewMarketplace({
      name: marketplace.name,
      url: marketplace.url,
      description: marketplace.description,
      category: marketplace.category
    })
    setShowAddModal(true)
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl">
        {/* Back Link */}
        <Link href="/agency/pool" className="inline-flex items-center gap-2 font-mono text-sm text-foreground-muted hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Partner Pool
        </Link>

        <StageHeader
          stageNumber="◈"
          title="Browse Marketplace"
          subtitle="Find new partners from top talent marketplaces. Customize this list with your preferred sources."
        />
        
        {/* Filters */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedCategory("all")}
              className={cn(
                "font-mono text-xs px-4 py-2 rounded-lg border transition-colors",
                selectedCategory === "all"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-foreground-muted hover:border-white/30"
              )}
            >
              All
            </button>
            {Object.entries(categoryConfig).map(([key, config]) => {
              const Icon = config.icon
              return (
                <button
                  key={key}
                  onClick={() => setSelectedCategory(key as MarketplaceCategory)}
                  className={cn(
                    "font-mono text-xs px-4 py-2 rounded-lg border transition-colors flex items-center gap-1.5",
                    selectedCategory === key
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {config.label}
                </button>
              )
            })}
          </div>
          
          <div className="flex gap-3">
            <Input
              placeholder="Search marketplaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
            <Button
              onClick={() => {
                setEditingMarketplace(null)
                setNewMarketplace({ name: "", url: "", description: "", category: "general" })
                setShowAddModal(true)
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Plus className="w-4 h-4 mr-1" /> Add Marketplace
            </Button>
          </div>
        </div>
        
        {/* Marketplace Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMarketplaces.map((marketplace) => {
            const categoryInfo = categoryConfig[marketplace.category]
            const Icon = categoryInfo.icon
            return (
              <GlassCard key={marketplace.id} className="group relative">
                {marketplace.isCustom && (
                  <div className="absolute top-3 right-3 flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditModal(marketplace)
                      }}
                      className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-foreground-muted hover:text-foreground transition-colors"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteMarketplace(marketplace.id)
                      }}
                      className="p-1.5 rounded bg-white/5 hover:bg-red-500/20 text-foreground-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
                
                <div className="flex items-start gap-3 mb-3">
                  <div className={cn("w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center", categoryInfo.color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-foreground group-hover:text-accent transition-colors">
                      {marketplace.name}
                    </div>
                    <div className={cn("font-mono text-[10px] uppercase", categoryInfo.color)}>
                      {categoryInfo.label}
                    </div>
                  </div>
                </div>
                
                <p className="font-mono text-xs text-foreground-muted mb-4 line-clamp-2">
                  {marketplace.description}
                </p>
                
                <a 
                  href={marketplace.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-mono text-xs"
                >
                  <ExternalLink className="w-3 h-3" />
                  Visit {marketplace.name}
                </a>
              </GlassCard>
            )
          })}
        </div>
        
        {filteredMarketplaces.length === 0 && (
          <GlassCard className="text-center py-12">
            <div className="font-mono text-foreground-muted">No marketplaces match your search</div>
          </GlassCard>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <GlassCard className="w-full max-w-lg">
            <GlassCardHeader
              title={editingMarketplace ? "Edit Marketplace" : "Add Marketplace"}
              description={editingMarketplace ? "Update this marketplace listing" : "Add a custom marketplace to your list"}
            />
            
            <div className="space-y-4 mt-4">
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Marketplace Name
                </label>
                <Input
                  placeholder="e.g., My Talent Network"
                  value={newMarketplace.name}
                  onChange={(e) => setNewMarketplace(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-white/5 border-border text-foreground"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  URL
                </label>
                <Input
                  placeholder="https://example.com"
                  value={newMarketplace.url}
                  onChange={(e) => setNewMarketplace(prev => ({ ...prev, url: e.target.value }))}
                  className="bg-white/5 border-border text-foreground"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Description
                </label>
                <Input
                  placeholder="Brief description of this marketplace"
                  value={newMarketplace.description}
                  onChange={(e) => setNewMarketplace(prev => ({ ...prev, description: e.target.value }))}
                  className="bg-white/5 border-border text-foreground"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Category
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(categoryConfig).map(([key, config]) => {
                    const Icon = config.icon
                    return (
                      <button
                        key={key}
                        onClick={() => setNewMarketplace(prev => ({ ...prev, category: key as MarketplaceCategory }))}
                        className={cn(
                          "flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors",
                          newMarketplace.category === key
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-white/30"
                        )}
                      >
                        <Icon className={cn("w-4 h-4", newMarketplace.category === key ? "text-accent" : config.color)} />
                        <span className={cn("font-mono text-[10px]", newMarketplace.category === key ? "text-accent" : "text-foreground-muted")}>
                          {config.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                className="flex-1 border-border text-foreground hover:bg-white/5"
                onClick={() => {
                  setShowAddModal(false)
                  setEditingMarketplace(null)
                }}
              >
                Cancel
              </Button>
              <Button 
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={editingMarketplace ? updateMarketplace : addMarketplace}
                disabled={!newMarketplace.name || !newMarketplace.url}
              >
                {editingMarketplace ? "Save Changes" : "Add Marketplace"}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </AgencyLayout>
  )
}
