"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckCircle, UserPlus, X, Send, Loader2 } from "lucide-react"
import { usePaidUser } from "@/contexts/paid-user-context"
import { isDemoMode } from "@/lib/demo-data"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

// Demo data - only shown in demo mode
const demoVendors = [
  { id: "1", name: "Sample Production Studio", discipline: "Video Production", rate: "$$", experience: "5+ years sports content" },
  { id: "2", name: "Tandem Social", discipline: "Social Media", rate: "$", experience: "Creator campaigns" },
  { id: "3", name: "Roster Agency", discipline: "Talent Relations", rate: "$$", experience: "Athlete partnerships" },
  { id: "4", name: "Sarah Chen", discipline: "Motion Design", rate: "$", experience: "After Effects, Cinema 4D specialist" },
  { id: "5", name: "Groundswell PR", discipline: "Public Relations", rate: "$$$", experience: "Sports, entertainment, lifestyle brands" },
  { id: "6", name: "Mike Rodriguez", discipline: "Copywriting", rate: "$", experience: "Brand voice, scripts, campaign messaging" },
  { id: "7", name: "Wavelength Audio", discipline: "Audio Production", rate: "$$", experience: "Podcast production, sound design" },
  { id: "8", name: "Pixel Perfect Post", discipline: "Post-Production", rate: "$$", experience: "Fast-turnaround editing, color grading" },
]

type Vendor = {
  id: string
  name: string
  discipline: string
  rate: string
  experience: string
}

const quickChips = [
  "Video Production Partner",
  "Social Media Agency",
  "Event Production Company",
  "PR/Comms Partner",
]

export function Stage01RFP() {
  const searchParams = useSearchParams()
  const invitePartnerId = searchParams.get("invitePartner")
  const { checkFeatureAccess } = usePaidUser()
  const isDemo = isDemoMode()
  
  // State for real partners from database
  const [realPartners, setRealPartners] = useState<Vendor[]>([])
  const [isLoadingPartners, setIsLoadingPartners] = useState(false)
  
  // Use demo vendors in demo mode, real partners in production
  const sampleVendors = isDemo ? demoVendors : realPartners
  
  // Fetch real partners from partnerships when not in demo mode
  useEffect(() => {
    if (!isDemo) {
      fetchPartners()
    }
  }, [isDemo])
  
  const fetchPartners = async () => {
    setIsLoadingPartners(true)
    try {
      const response = await fetch('/api/partnerships')
      if (response.ok) {
        const data = await response.json()
        // Map partnerships to vendor format - only active partnerships
        const partners = (data.partnerships || [])
          .filter((p: { status: string }) => p.status === 'active')
          .map((p: { id: string; partner?: { company_name?: string; full_name?: string; discipline?: string } }) => ({
            id: p.id,
            name: p.partner?.company_name || p.partner?.full_name || 'Unknown Partner',
            discipline: p.partner?.discipline || 'Partner',
            rate: '$$',
            experience: 'Active partner in your network',
          }))
        setRealPartners(partners)
      }
    } catch (error) {
      console.error('Error fetching partners:', error)
    }
    setIsLoadingPartners(false)
  }
  
  const [discipline, setDiscipline] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedRFP, setGeneratedRFP] = useState<string | null>(null)
  const [selectedVendors, setSelectedVendors] = useState<string[]>([])
  const [showInviteNotification, setShowInviteNotification] = useState(false)
  
  // Invite new partner to ecosystem state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteMessage, setInviteMessage] = useState("")
  const [isInviting, setIsInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  
  // Pre-select invited partner and show vendor selection
  useEffect(() => {
    if (invitePartnerId) {
      const vendor = sampleVendors.find(v => v.id === invitePartnerId)
      if (vendor) {
        setSelectedVendors([invitePartnerId])
        setShowInviteNotification(true)
        // Auto-dismiss notification after 5 seconds
        setTimeout(() => setShowInviteNotification(false), 5000)
      }
    }
  }, [invitePartnerId])
  
  const handleGenerate = async () => {
    if (!discipline.trim()) return
    if (!checkFeatureAccess()) return
    setIsGenerating(true)
    
    // Simulate AI generation
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setGeneratedRFP(`## Request for Proposal
### Video Production Partner — Sports Creator Series

**Issued by:** LIGAMENT on behalf of a brand client
**Submission Deadline:** 10 business days from receipt

---

### 1. Overview
A boutique creative agency is seeking a video production partner for a 6-month documentary-style creator content program centered on women's professional soccer. The ideal partner brings sports content experience, creator collaboration skills, and nimble production capabilities.

### 2. Scope of Work
- Pre-production planning and creative development
- On-location production for 8-12 shoot days
- Post-production including editing, color, and sound
- Delivery of assets optimized for social platforms
- Ongoing collaboration with internal creative team

### 3. Team Requirements
- Dedicated producer and director
- DP with sports/documentary experience
- Editor with quick turnaround capability
- Flexibility for last-minute schedule changes

### 4. Timeline
- Program duration: 6 months
- First deliverables due within 6 weeks of kickoff
- Rolling delivery schedule throughout program

### 5. Submission Instructions
Please include: relevant experience, proposed team, creative approach, timeline assumptions, and budget proposal. Client identity and full budget will be shared with shortlisted vendors.

*This RFP is confidential. Do not share externally.*`)
    
    setIsGenerating(false)
  }
  
  const handleChipClick = (chip: string) => {
    setDiscipline(chip)
  }
  
  const toggleVendor = (vendorId: string) => {
    setSelectedVendors(prev => 
      prev.includes(vendorId) 
        ? prev.filter(id => id !== vendorId)
        : [...prev, vendorId]
    )
  }
  
  // Handle inviting a new partner to the ecosystem
  const handleInvitePartner = async () => {
    if (!inviteEmail.trim()) return
    if (!checkFeatureAccess("partner invitations")) return
    
    setIsInviting(true)
    setInviteError(null)
    
    try {
      const response = await fetch('/api/partnerships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerEmail: inviteEmail.trim(),
          message: inviteMessage.trim() || `You're invited to join our partner network and receive RFPs for upcoming projects.`,
        }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        setInviteSuccess(`Invitation sent to ${inviteEmail}!`)
        setInviteEmail("")
        setInviteMessage("")
        // Refresh partners list if in production mode
        if (!isDemo) {
          fetchPartners()
        }
        // Auto-close dialog after 2 seconds
        setTimeout(() => {
          setShowInviteDialog(false)
          setInviteSuccess(null)
        }, 2000)
      } else {
        setInviteError(data.error || 'Failed to send invitation')
      }
    } catch (error) {
      setInviteError('Failed to send invitation. Please try again.')
    }
    
    setIsInviting(false)
  }
  
  return (
    <div className="p-8 max-w-5xl">
      <StageHeader
        stageNumber="01"
        title="RFP Broadcast + Scoring"
        subtitle="Describe the discipline you need. LIGAMENT AI generates a sanitized RFP — client identity masked, budget withheld — ready to broadcast."
        aiPowered
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />
      
      {/* Invite Notification */}
      {showInviteNotification && invitePartnerId && (
        <div className="mb-6 p-4 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-accent" />
            <div>
              <div className="font-display font-bold text-foreground">
                {sampleVendors.find(v => v.id === invitePartnerId)?.name} has been added to your broadcast list
              </div>
              <div className="font-mono text-xs text-foreground-muted">
                Generate an RFP below, or they will receive your next broadcast automatically.
              </div>
            </div>
          </div>
          <button 
            onClick={() => setShowInviteNotification(false)}
            className="text-foreground/80 hover:text-foreground transition-colors"
          >
            &times;
          </button>
        </div>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          <GlassCard>
            <GlassCardHeader
              label="Step 1"
              title="Describe the discipline"
            />
            <Textarea
              placeholder="e.g., We need a video production partner with sports content experience for a 6-month creator content series..."
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              className="min-h-[120px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 resize-none"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {quickChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleChipClick(chip)}
                  className="font-mono text-[11px] px-3 py-1 rounded-full border border-border text-foreground/80 hover:border-accent hover:text-accent transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
            <Button 
              onClick={handleGenerate}
              disabled={!discipline.trim() || isGenerating}
              className="w-full mt-4 bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <span className="ai-badge">✦</span> Generating RFP...
                </span>
              ) : (
                "Generate RFP →"
              )}
            </Button>
          </GlassCard>
        </div>
        
        {/* Output Panel */}
        <div className="space-y-4">
          <GlassCard className="min-h-[300px]">
            <GlassCardHeader
              label="AI Output"
              title="Generated RFP"
              badge={generatedRFP ? "Ready" : "Waiting"}
            />
            {isGenerating ? (
              <div className="flex items-center gap-2 text-foreground-muted">
                <span className="ai-badge text-accent">✦</span>
                <span className="font-mono text-sm streaming-cursor">LIGAMENT AI is working</span>
              </div>
            ) : generatedRFP ? (
              <div className="prose prose-invert prose-sm max-w-none">
                <div className="font-mono text-xs text-foreground-secondary whitespace-pre-wrap leading-relaxed">
                  {generatedRFP}
                </div>
              </div>
            ) : (
              <div className="text-sm text-foreground-muted/50 italic">
                Enter a discipline description and click generate to create your RFP.
              </div>
            )}
          </GlassCard>
        </div>
      </div>
      
      {/* Vendor Selection - Show when RFP is generated OR when partner is invited */}
      {(generatedRFP || invitePartnerId) && (
        <div className="mt-8">
          <GlassCard>
            <div className="flex items-start justify-between mb-4">
              <GlassCardHeader
                label="Step 2"
                title="Select vendors to broadcast"
                description="Choose which vendors from your pool should receive this RFP."
              />
              <Button
                variant="outline"
                onClick={() => setShowInviteDialog(true)}
                className="border-accent/50 text-accent hover:bg-accent/10"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite New Partner
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {sampleVendors.map((vendor) => (
                <div
                  key={vendor.id}
                  onClick={() => toggleVendor(vendor.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedVendors.includes(vendor.id)
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-white/30 bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-display font-bold text-foreground">
                      {vendor.name}
                    </div>
                    <Checkbox
                      checked={selectedVendors.includes(vendor.id)}
                      className="data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                    />
                  </div>
                  <div className="font-mono text-[10px] text-accent mb-1">
                    {vendor.discipline}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {vendor.experience}
                  </div>
                </div>
              ))}
              
              {/* Empty state when no vendors */}
              {sampleVendors.length === 0 && (
                <div className="col-span-3 text-center py-8">
                  <p className="text-foreground-muted mb-4">No partners in your pool yet.</p>
                  <Button
                    onClick={() => setShowInviteDialog(true)}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Invite Your First Partner
                  </Button>
                </div>
              )}
            </div>
            {selectedVendors.length > 0 && (
              <Button className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold">
                Broadcast to {selectedVendors.length} vendor{selectedVendors.length > 1 ? 's' : ''} →
              </Button>
            )}
          </GlassCard>
        </div>
      )}
      
      {/* Invite Partner Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Invite Partner to Your Network</DialogTitle>
            <DialogDescription className="text-foreground-muted">
              Send an invitation to join your partner pool. Once they accept, they&apos;ll be able to receive RFPs and bid on your projects.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="text-foreground">Partner Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="partner@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-white/5 border-border text-foreground"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="invite-message" className="text-foreground">Personal Message (Optional)</Label>
              <Textarea
                id="invite-message"
                placeholder="Add a personal note to your invitation..."
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                className="bg-white/5 border-border text-foreground min-h-[100px]"
              />
            </div>
            
            {inviteSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-green-400 text-sm">{inviteSuccess}</span>
              </div>
            )}
            
            {inviteError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
                <X className="w-4 h-4 text-red-400" />
                <span className="text-red-400 text-sm">{inviteError}</span>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowInviteDialog(false)
                setInviteEmail("")
                setInviteMessage("")
                setInviteError(null)
              }}
              className="border-border text-foreground/80 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvitePartner}
              disabled={!inviteEmail.trim() || isInviting}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {isInviting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
