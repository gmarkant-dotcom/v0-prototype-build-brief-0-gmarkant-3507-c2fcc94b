// Demo mode detection
// Only enables demo mode on demo.withligament.com OR when NEXT_PUBLIC_IS_DEMO=true
// Production uses real data from the database
export const isDemoMode = () => {
  // Check environment variable first
  if (process.env.NEXT_PUBLIC_IS_DEMO === "true") {
    return true
  }
  
  // Check hostname for demo subdomain only (client-side only)
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname
    // Enable demo mode ONLY on explicit demo subdomain
    return hostname.startsWith("demo.") || 
           hostname === "demo.withligament.com"
  }
  
  return false
}

// Types
export type PartnerNote = {
  id: string
  content: string
  author: string
  date: string
  type: "general" | "project" | "warning"
}

export type ProjectRating = {
  projectName: string
  date: string
  budget: string
  rating: number
  review?: string
}

export type PartnerAvailability = {
  availableFrom?: string
  availableTo?: string
  workingHoursStart?: string
  workingHoursEnd?: string
  timezone?: string
  notes?: string
}

export type Partner = {
  id: string
  name: string
  type: "agency" | "freelancer" | "production"
  discipline: string
  rate: "$" | "$$" | "$$$"
  location: string
  email: string
  phone?: string
  website?: string
  experience: string
  tags: string[]
  bookmarked: boolean
  status: "active" | "pending" | "new" | "blacklisted"
  ndaSigned: boolean
  ndaSignedDate?: string
  ndaExpiryDate?: string
  msaApproved: boolean
  msaApprovedDate?: string
  msaExpiryDate?: string
  rating?: number
  pastProjects: ProjectRating[]
  credentials: string[]
  portfolio?: string[]
  joinedDate: string
  totalProjectValue?: string
  notes: PartnerNote[]
  blacklistReason?: string
  blacklistDate?: string
  availability?: PartnerAvailability
}

/** Minimal project shape for selected-project context & demo project picker */
export type MasterProject = {
  id: string
  name: string
  client: string
  status: "active" | "onboarding" | "completed" | "on_hold"
}

// Demo Projects
export const demoProjects: MasterProject[] = [
  { id: "1", name: "NWSL Creator Content Series", client: "National Women's Soccer League", status: "active" },
  { id: "2", name: "Q2 Brand Campaign", client: "Sample Client Inc.", status: "onboarding" },
  { id: "3", name: "Holiday Campaign 2025", client: "RetailMax", status: "completed" },
  { id: "4", name: "Summer Festival Activation", client: "BevCo International", status: "active" },
  { id: "5", name: "Product Launch - Series X", client: "TechStart Inc", status: "on_hold" },
]

// Demo Partners
export const demoPartners: Partner[] = [
  {
    id: "1",
    name: "Sample Production Studio",
    type: "production",
    discipline: "Video Production",
    rate: "$$",
    location: "Los Angeles, CA",
    email: "contact@demo.withligament.com",
    phone: "(310) 555-0123",
    website: "demo.withligament.com",
    experience: "5+ years sports content, documentary-style storytelling, on-location production across 20+ markets",
    tags: ["Documentary", "Sports", "Social Content", "Live Events"],
    bookmarked: true,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2023-06-15",
    ndaExpiryDate: "2025-06-15",
    msaApproved: true,
    msaApprovedDate: "2023-07-01",
    msaExpiryDate: "2025-07-01",
    rating: 4.8,
    pastProjects: [
      { projectName: "Q4 Brand Campaign", date: "Oct 2023", budget: "$85,000", rating: 5, review: "Exceptional work. Delivered ahead of schedule with outstanding quality." },
      { projectName: "Summer Series", date: "Jun 2023", budget: "$120,000", rating: 4.5, review: "Great collaboration. Minor communication delays but excellent final product." },
      { projectName: "Product Launch", date: "Mar 2023", budget: "$45,000", rating: 5 },
    ],
    credentials: ["SAG-AFTRA Signatory", "Drone Licensed (Part 107)", "Insured $2M"],
    portfolio: ["Netflix Documentary", "Nike Campaign", "ESPN Feature"],
    joinedDate: "2023-03-01",
    totalProjectValue: "$250,000",
    notes: [
      { id: "n1", content: "Preferred vendor for sports content. Always reliable.", author: "Sarah Chen", date: "Mar 15, 2024", type: "general" },
      { id: "n2", content: "Has connections with NWSL production teams - valuable for upcoming projects.", author: "Mike R.", date: "Feb 10, 2024", type: "project" },
    ],
    availability: {
      availableFrom: "2026-06-01",
      availableTo: "2026-08-31",
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      timezone: "America/Los_Angeles",
      notes: "Limited availability in July due to existing commitments"
    }
  },
  {
    id: "2",
    name: "Tandem Social",
    type: "agency",
    discipline: "Social Media",
    rate: "$",
    location: "New York, NY",
    email: "partnerships@tandemsocial.com",
    website: "tandemsocial.com",
    experience: "Creator campaigns, influencer strategy, community management for sports and lifestyle brands",
    tags: ["Social Strategy", "Creator Content", "Paid Media", "Community"],
    bookmarked: true,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2023-08-20",
    ndaExpiryDate: "2025-08-20",
    msaApproved: true,
    msaApprovedDate: "2023-09-01",
    msaExpiryDate: "2025-09-01",
    rating: 4.5,
    pastProjects: [
      { projectName: "Brand Launch Q4", date: "Nov 2023", budget: "$35,000", rating: 4.5, review: "Strong strategic thinking. Recommend for social-first campaigns." },
      { projectName: "Influencer Campaign", date: "Aug 2023", budget: "$50,000", rating: 4, review: "Good execution but scope management could improve." },
    ],
    credentials: ["Meta Business Partner", "TikTok Marketing Partner"],
    joinedDate: "2023-08-01",
    totalProjectValue: "$85,000",
    notes: [
      { id: "n3", content: "Currently expanding TikTok capabilities. Consider for upcoming TikTok-heavy projects.", author: "Sarah Chen", date: "Mar 10, 2024", type: "general" },
    ]
  },
  {
    id: "3",
    name: "Roster Agency",
    type: "agency",
    discipline: "Talent Relations",
    rate: "$$",
    location: "Chicago, IL",
    email: "info@rosteragency.com",
    experience: "Athlete partnerships, talent booking, endorsement negotiations",
    tags: ["Talent", "Athletes", "Endorsements", "Negotiations"],
    bookmarked: false,
    status: "pending",
    ndaSigned: false,
    msaApproved: false,
    pastProjects: [],
    credentials: ["Licensed Talent Agency"],
    joinedDate: "2024-01-10",
    notes: []
  },
  {
    id: "4",
    name: "Sarah Chen",
    type: "freelancer",
    discipline: "Motion Design",
    rate: "$",
    location: "Remote (Seattle, WA)",
    email: "sarah@sarahchendesign.com",
    website: "sarahchendesign.com",
    experience: "After Effects, Cinema 4D specialist. Brand animations, title sequences, social graphics.",
    tags: ["Motion Graphics", "3D Animation", "Titles", "Brand"],
    bookmarked: true,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2023-05-10",
    ndaExpiryDate: "2025-05-10",
    msaApproved: false,
    rating: 4.9,
    pastProjects: [
      { projectName: "Brand Refresh", date: "Dec 2023", budget: "$12,000", rating: 5, review: "Incredible attention to detail. Top-tier motion design." },
      { projectName: "Product Launch", date: "Sep 2023", budget: "$8,000", rating: 5 },
      { projectName: "Social Templates", date: "Jul 2023", budget: "$5,000", rating: 4.5 },
    ],
    credentials: ["Adobe Certified Expert", "School of Motion Alumni"],
    portfolio: ["Apple Event Graphics", "Spotify Wrapped", "Nike Animation"],
    joinedDate: "2023-05-01",
    totalProjectValue: "$25,000",
    notes: [
      { id: "n4", content: "Best motion designer we've worked with. Always first choice for animation.", author: "Creative Director", date: "Jan 5, 2024", type: "general" },
    ],
    availability: {
      availableFrom: "2026-04-01",
      availableTo: "2026-12-31",
      workingHoursStart: "10:00",
      workingHoursEnd: "19:00",
      timezone: "America/Los_Angeles",
      notes: "Taking off 2 weeks in August for vacation"
    }
  },
  {
    id: "5",
    name: "Groundswell PR",
    type: "agency",
    discipline: "Public Relations",
    rate: "$$$",
    location: "Miami, FL",
    email: "new-business@groundswellpr.com",
    experience: "Sports, entertainment, lifestyle brands. Media relations, crisis communications, launch campaigns.",
    tags: ["Media Relations", "Crisis Comms", "Launches", "Press"],
    bookmarked: false,
    status: "new",
    ndaSigned: false,
    msaApproved: false,
    pastProjects: [],
    credentials: ["PRSA Member", "Sports PR Awards 2023"],
    joinedDate: "2024-01-15",
    notes: []
  },
  {
    id: "6",
    name: "Mike Rodriguez",
    type: "freelancer",
    discipline: "Copywriting",
    rate: "$",
    location: "Austin, TX",
    email: "mike@mikerodriguezwrites.com",
    experience: "Brand voice development, social copy, video scripts, campaign messaging",
    tags: ["Copy", "Scripts", "Brand Voice", "Social"],
    bookmarked: false,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2024-01-05",
    ndaExpiryDate: "2026-01-05",
    msaApproved: false,
    rating: 4.3,
    pastProjects: [
      { projectName: "Campaign Messaging", date: "Jan 2024", budget: "$6,000", rating: 4, review: "Good work but needed more rounds of revision than expected." },
    ],
    credentials: ["Former Agency CD", "Cannes Lions Winner"],
    joinedDate: "2024-01-01",
    totalProjectValue: "$6,000",
    notes: [
      { id: "n5", content: "Great for quick-turn copy needs. Not ideal for complex brand strategy.", author: "Account Lead", date: "Feb 20, 2024", type: "warning" },
    ]
  },
  {
    id: "7",
    name: "Wavelength Audio",
    type: "production",
    discipline: "Audio Production",
    rate: "$$",
    location: "Nashville, TN",
    email: "studio@wavelengthaudio.com",
    website: "wavelengthaudio.com",
    experience: "Podcast production, music supervision, sound design, mixing & mastering",
    tags: ["Audio", "Podcast", "Sound Design", "Music"],
    bookmarked: true,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2023-04-22",
    ndaExpiryDate: "2025-04-22",
    msaApproved: true,
    msaApprovedDate: "2023-05-15",
    msaExpiryDate: "2025-05-15",
    rating: 4.7,
    pastProjects: [
      { projectName: "Brand Podcast S2", date: "Nov 2023", budget: "$28,000", rating: 5, review: "Flawless production quality. Elevated our podcast significantly." },
      { projectName: "Campaign Soundtrack", date: "Aug 2023", budget: "$15,000", rating: 4.5 },
    ],
    credentials: ["Grammy Nominated", "Dolby Atmos Certified"],
    portfolio: ["NPR", "Spotify Original", "HBO"],
    joinedDate: "2023-04-01",
    totalProjectValue: "$43,000",
    notes: []
  },
  {
    id: "8",
    name: "Pixel Perfect Post",
    type: "production",
    discipline: "Post-Production",
    rate: "$$",
    location: "Atlanta, GA",
    email: "projects@pixelperfectpost.com",
    website: "pixelperfectpost.com",
    experience: "Fast-turnaround editing, color grading, VFX, social-first optimization",
    tags: ["Editing", "Color", "VFX", "Social"],
    bookmarked: true,
    status: "active",
    ndaSigned: true,
    ndaSignedDate: "2023-07-18",
    ndaExpiryDate: "2025-07-18",
    msaApproved: true,
    msaApprovedDate: "2023-08-01",
    msaExpiryDate: "2025-08-01",
    rating: 4.6,
    pastProjects: [
      { projectName: "Summer Series", date: "Jul 2023", budget: "$32,000", rating: 4.5 },
      { projectName: "Holiday Campaign", date: "Dec 2023", budget: "$18,000", rating: 5, review: "48-hour turnaround as promised. Excellent quality under pressure." },
    ],
    credentials: ["DaVinci Resolve Certified", "48-hr Turnaround Guarantee"],
    joinedDate: "2023-07-01",
    totalProjectValue: "$50,000",
    notes: []
  },
  {
    id: "9",
    name: "Velocity Media",
    type: "agency",
    discipline: "Video Production",
    rate: "$$$",
    location: "Denver, CO",
    email: "contact@velocitymedia.co",
    experience: "High-end commercial production, broadcast quality content",
    tags: ["Commercial", "Broadcast", "TV Spots", "High-End"],
    bookmarked: false,
    status: "blacklisted",
    ndaSigned: true,
    ndaSignedDate: "2022-03-01",
    ndaExpiryDate: "2024-03-01",
    msaApproved: true,
    msaApprovedDate: "2022-04-01",
    msaExpiryDate: "2024-04-01",
    rating: 2.5,
    pastProjects: [
      { projectName: "Summer Campaign", date: "Jun 2023", budget: "$150,000", rating: 2, review: "Significant delays, budget overruns, and poor communication." },
      { projectName: "Product Launch", date: "Feb 2023", budget: "$75,000", rating: 3, review: "Acceptable quality but difficult to work with." },
    ],
    credentials: ["Emmy Winner 2019"],
    joinedDate: "2022-03-01",
    totalProjectValue: "$225,000",
    notes: [
      { id: "n6", content: "Do not engage. Repeated issues with timeline and budget management.", author: "VP Operations", date: "Jul 15, 2023", type: "warning" },
    ],
    blacklistReason: "Repeated contract violations, budget overruns exceeding 40%, and failure to meet delivery deadlines on multiple projects.",
    blacklistDate: "Aug 1, 2023"
  },
]

// Demo RFP Vendors (for Stage01RFP component)
export const demoRfpVendors = [
  { id: "1", name: "Sample Production Studio", discipline: "Video Production", rate: "$$", experience: "5+ years sports content" },
  { id: "2", name: "Tandem Social", discipline: "Social Media", rate: "$", experience: "Creator campaigns" },
  { id: "3", name: "Roster Agency", discipline: "Talent Relations", rate: "$$", experience: "Athlete partnerships" },
  { id: "4", name: "Sarah Chen", discipline: "Motion Design", rate: "$", experience: "After Effects, Cinema 4D specialist" },
  { id: "5", name: "Groundswell PR", discipline: "Public Relations", rate: "$$$", experience: "Sports, entertainment, lifestyle brands" },
  { id: "6", name: "Mike Rodriguez", discipline: "Copywriting", rate: "$", experience: "Brand voice, scripts, campaign messaging" },
  { id: "7", name: "Wavelength Audio", discipline: "Audio Production", rate: "$$", experience: "Podcast production, sound design" },
  { id: "8", name: "Pixel Perfect Post", discipline: "Post-Production", rate: "$$", experience: "Fast-turnaround editing, color grading" },
]

// Demo Master Projects (for Agency Dashboard)
export type ProjectAlert = {
  id: string
  type: "utilization" | "payment" | "deadline" | "scope" | "partner"
  severity: "warning" | "critical"
  title: string
  description: string
  section: string
  actionUrl: string
  createdAt: string
}

/** Rich demo row for agency dashboard cards (demo mode only) */
export type DashboardDemoProject = {
  id: string
  name: string
  client: string
  clientLogo?: string
  status: "active" | "onboarding" | "completed" | "on_hold"
  budget: number
  spent: number
  startDate: string
  endDate: string
  partnerCount: number
  activeRfps: number
  pendingBids: number
  alerts: ProjectAlert[]
  progress: number
  lastActivity: string
  stage: string
  /** Workflow pill on dashboard cards (matches /api/projects dashboard_workflow_*) */
  workflowStageKey: "active_engagements" | "bid_management" | "rfp_broadcast" | "setup"
  workflowStageLabel: string
  /** Unresolved partner status updates (excl. on_track / complete) for dashboard demo */
  partnerStatusAlertCount?: number
  partnerStatusAlertPreview?: {
    status: string
    budget_status: string
    completion_pct: number
    notes_preview: string | null
    created_at: string
  } | null
}

export const demoMasterProjects: DashboardDemoProject[] = [
  {
    id: "1",
    name: "NWSL Creator Content Series",
    client: "National Women's Soccer League",
    status: "active",
    budget: 250000,
    spent: 127000,
    startDate: "Feb 2026",
    endDate: "Jul 2026",
    partnerCount: 3,
    activeRfps: 0,
    pendingBids: 2,
    alerts: [
      {
        id: "a1",
        type: "utilization",
        severity: "warning",
        title: "Tandem Social approaching budget cap",
        description: "Social media management partner has used 85% of allocated budget with 35% of work remaining.",
        section: "Utilization",
        actionUrl: "/agency/utilization",
        createdAt: "2026-03-20"
      },
      {
        id: "a2",
        type: "payment",
        severity: "critical",
        title: "Sample Production Studio payment overdue",
        description: "Invoice #DEMO-2026-003 for $24,500 is 5 days overdue.",
        section: "Payments",
        actionUrl: "/agency/payments",
        createdAt: "2026-03-22"
      },
    ],
    progress: 45,
    lastActivity: "2 hours ago",
    stage: "Production",
    workflowStageKey: "active_engagements",
    workflowStageLabel: "Active Engagements",
    partnerStatusAlertCount: 2,
    partnerStatusAlertPreview: {
      status: "at_risk",
      budget_status: "incremental_needed",
      completion_pct: 58,
      notes_preview: "Waiting on revised scope sign-off; may need one extra sprint for deliverable B.",
      created_at: new Date().toISOString(),
    },
  },
  {
    id: "2",
    name: "Q2 Brand Refresh Campaign",
    client: "TechStart Inc.",
    status: "onboarding",
    budget: 175000,
    spent: 8500,
    startDate: "Mar 2026",
    endDate: "Jun 2026",
    partnerCount: 1,
    activeRfps: 2,
    pendingBids: 0,
    alerts: [],
    progress: 5,
    lastActivity: "Yesterday",
    stage: "RFP",
    workflowStageKey: "rfp_broadcast",
    workflowStageLabel: "RFP Broadcast",
    partnerStatusAlertCount: 1,
    partnerStatusAlertPreview: {
      status: "delayed",
      budget_status: "over_budget",
      completion_pct: 22,
      notes_preview: "Post vendor requested additional week for color; budget impact under review.",
      created_at: new Date().toISOString(),
    },
  },
  {
    id: "3",
    name: "Annual Report Video Series",
    client: "Global Finance Corp",
    status: "active",
    budget: 85000,
    spent: 62000,
    startDate: "Jan 2026",
    endDate: "Apr 2026",
    partnerCount: 2,
    activeRfps: 0,
    pendingBids: 1,
    alerts: [
      {
        id: "a3",
        type: "deadline",
        severity: "warning",
        title: "Delivery milestone approaching",
        description: "Final cut due in 5 business days. Post-production at 70% complete.",
        section: "Documents",
        actionUrl: "/agency/documents",
        createdAt: "2026-03-21"
      }
    ],
    progress: 73,
    lastActivity: "5 hours ago",
    stage: "Post-Production",
    workflowStageKey: "bid_management",
    workflowStageLabel: "Bid Management",
  }
]

// Filter options
export const disciplines = ["All", "Video Production", "Social Media", "Talent Relations", "Motion Design", "Public Relations", "Copywriting", "Audio Production", "Post-Production"]
export const partnerTypes = ["All", "Agency", "Freelancer", "Production"]

// Lead Agency types for partner view
export type LeadAgencyInvitation = {
  id: string
  agencyId: string
  agencyName: string
  agencyLogo?: string
  agencyLocation: string
  status: "pending" | "accepted" | "confirmed" | "declined"
  invitedAt: string
  acceptedAt?: string
  confirmedAt?: string
  invitationMessage?: string
}

export type LeadAgency = {
  id: string
  name: string
  logo?: string
  location: string
  website?: string
  industry?: string
  description?: string
}

// Demo Lead Agencies (agencies that invite partner agencies)
export const demoLeadAgencies: LeadAgency[] = [
  {
    id: "la-1",
    name: "Electric Animal",
    location: "New York, NY",
    website: "electricanimal.com",
    industry: "Sports & Entertainment Marketing",
    description: "Full-service creative agency specializing in sports, entertainment, and lifestyle brands."
  },
  {
    id: "la-2",
    name: "Momentum Worldwide",
    location: "Chicago, IL",
    website: "momentumww.com",
    industry: "Experiential Marketing",
    description: "Global experiential agency creating brand experiences that move people."
  },
  {
    id: "la-3",
    name: "Octagon",
    location: "Stamford, CT",
    website: "octagon.com",
    industry: "Sports Marketing & Talent",
    description: "Global sports, entertainment and lifestyle marketing agency."
  },
  {
    id: "la-4",
    name: "R/GA",
    location: "San Francisco, CA",
    website: "rga.com",
    industry: "Digital & Innovation",
    description: "Business transformation company combining consulting and agency expertise."
  }
]

// Demo Partner Invitations (from lead agencies to partners)
export const demoPartnerInvitations: LeadAgencyInvitation[] = [
  {
    id: "inv-1",
    agencyId: "la-1",
    agencyName: "Electric Animal",
    agencyLocation: "New York, NY",
    status: "confirmed",
    invitedAt: "2025-12-15",
    acceptedAt: "2025-12-18",
    confirmedAt: "2025-12-20",
    invitationMessage: "We'd love to have you join our partner network for upcoming sports content projects."
  },
  {
    id: "inv-2",
    agencyId: "la-2",
    agencyName: "Momentum Worldwide",
    agencyLocation: "Chicago, IL",
    status: "accepted",
    invitedAt: "2026-01-10",
    acceptedAt: "2026-01-15",
    invitationMessage: "Looking for production partners for our Q2 experiential campaigns."
  },
  {
    id: "inv-3",
    agencyId: "la-3",
    agencyName: "Octagon",
    agencyLocation: "Stamford, CT",
    status: "pending",
    invitedAt: "2026-03-20",
    invitationMessage: "Interested in collaborating on athlete content series. Please review and accept our invitation."
  },
  {
    id: "inv-4",
    agencyId: "la-4",
    agencyName: "R/GA",
    agencyLocation: "San Francisco, CA",
    status: "pending",
    invitedAt: "2026-03-22",
    invitationMessage: "We're expanding our production network and would like you to join."
  }
]

// Demo RFPs with lead agency attribution for partner view
export type PartnerRFPWithAgency = {
  id: string
  leadAgencyId: string
  leadAgencyName: string
  title: string
  discipline: string
  budget: string
  deadline: string
  status: "open" | "submitted" | "awarded" | "closed"
  projectName: string
  description?: string
}

export const demoPartnerRFPsWithAgency: PartnerRFPWithAgency[] = [
  {
    id: "rfp-1",
    leadAgencyId: "la-1",
    leadAgencyName: "Electric Animal",
    title: "Video Production for NWSL Content Series",
    discipline: "Video Production",
    budget: "$80,000 - $120,000",
    deadline: "Apr 15, 2026",
    status: "open",
    projectName: "NWSL Creator Content Series",
    description: "Seeking production partner for 12-part athlete content series."
  },
  {
    id: "rfp-2",
    leadAgencyId: "la-1",
    leadAgencyName: "Electric Animal",
    title: "Motion Graphics Package",
    discipline: "Motion Design",
    budget: "$15,000 - $25,000",
    deadline: "Apr 10, 2026",
    status: "submitted",
    projectName: "NWSL Creator Content Series",
    description: "Animated lower thirds, transitions, and branded elements."
  },
  {
    id: "rfp-3",
    leadAgencyId: "la-2",
    leadAgencyName: "Momentum Worldwide",
    title: "Post-Production Support",
    discipline: "Post-Production",
    budget: "$30,000 - $45,000",
    deadline: "Apr 20, 2026",
    status: "open",
    projectName: "Q2 Experiential Campaign",
    description: "Fast-turnaround editing for event recap content."
  }
]

// Demo Active Projects with lead agency for partner view
export type PartnerProjectWithAgency = {
  id: string
  leadAgencyId: string
  leadAgencyName: string
  projectName: string
  role: string
  status: "onboarding" | "active" | "completed"
  startDate: string
  endDate?: string
  budget: string
  invoiced: string
}

export const demoPartnerProjectsWithAgency: PartnerProjectWithAgency[] = [
  {
    id: "proj-1",
    leadAgencyId: "la-1",
    leadAgencyName: "Electric Animal",
    projectName: "NWSL Creator Content Series",
    role: "Video Production Partner",
    status: "active",
    startDate: "Feb 2026",
    endDate: "Jul 2026",
    budget: "$95,000",
    invoiced: "$42,000"
  },
  {
    id: "proj-2",
    leadAgencyId: "la-2",
    leadAgencyName: "Momentum Worldwide",
    projectName: "Holiday Brand Activation",
    role: "Post-Production",
    status: "completed",
    startDate: "Oct 2025",
    endDate: "Dec 2025",
    budget: "$28,000",
    invoiced: "$28,000"
  }
]
