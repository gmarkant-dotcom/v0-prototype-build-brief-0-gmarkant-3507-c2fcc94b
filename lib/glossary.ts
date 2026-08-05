/**
 * Ligament Glossary v1. Generated from docs/glossary-content.md - term entries only
 * (the intro/editing-guide preamble and the "Open questions for your review" section are
 * review notes, not content, and are not represented here). Definitions and "why it
 * matters" text are verbatim from that doc.
 *
 * Keys mirror the existing code constants they correspond to where one exists
 * (lib/business-criteria.ts's DESIGNATION_KEYS/INSURANCE_KEYS, lib/terms-disclosure.ts's
 * term shapes) so call sites can pass the same key they're already iterating over.
 */

export type GlossaryEntry = {
  term: string
  definition: string
  whyItMatters: string
  legal?: boolean
}

export type GlossaryKey =
  | "net_days"
  | "deposit_required"
  | "kill_fee"
  | "work_for_hire"
  | "licensed_usage"
  | "retained_negotiable"
  | "rate_validity"
  | "term_flexibility"
  | "mbe"
  | "wbe"
  | "mwbe"
  | "dbe"
  | "veteran_owned"
  | "sdvob"
  | "lgbtbe"
  | "dobe"
  | "sbe"
  | "general_liability"
  | "workers_comp"
  | "commercial_auto"
  | "umbrella_excess"
  | "professional_liability_eo"
  | "cyber_liability"
  | "coi"
  | "nda"
  | "msa"
  | "rfp"
  | "composite_score"
  | "delivery_performance"

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  net_days: {
    term: "Net days (payment terms)",
    definition:
      "How long after invoicing the payment is due. Net 30 means the invoice is payable within 30 days of being issued.",
    whyItMatters:
      "longer net terms mean the vendor finances the work; shorter terms mean faster cash out the door for you.",
  },
  deposit_required: {
    term: "Deposit required",
    definition: "The percentage of the fee the vendor needs paid up front before work begins.",
    whyItMatters:
      "deposits protect vendors on custom work, but high deposits shift cash-flow risk to you before anything is delivered.",
  },
  kill_fee: {
    term: "Kill fee / cancellation fee",
    definition:
      "What the vendor is owed if the project is cancelled after award but before completion. Can be a percentage of the fee or a flat amount.",
    whyItMatters:
      "campaigns get cancelled. Knowing the cost of walking away before you award avoids the worst kind of surprise.",
    legal: true,
  },
  work_for_hire: {
    term: "Work-for-hire",
    definition:
      "You (and your client) own everything the vendor creates, outright, from the moment it's made. The vendor keeps no rights to the work.",
    whyItMatters:
      "the cleanest option for client work, and usually what client MSAs require. Vendors often price it higher because they give up everything.",
    legal: true,
  },
  licensed_usage: {
    term: "Licensed usage",
    definition:
      "The vendor keeps ownership and grants you specific rights: certain channels, regions, and a time period. Using the work beyond the license means renegotiating.",
    whyItMatters:
      "often cheaper up front, but check the license covers everywhere your client will actually run the work, including renewals.",
    legal: true,
  },
  retained_negotiable: {
    term: "Retained, negotiable",
    definition: "The vendor keeps ownership by default and is open to discussing rights as part of the deal.",
    whyItMatters: "a starting position, not a final answer. Pin down actual usage rights before award, not after.",
    legal: true,
  },
  rate_validity: {
    term: "Rate validity",
    definition: "How long the bid's pricing stays good. After this window, the vendor may requote.",
    whyItMatters:
      "if your client decision will take longer than the validity window, you may be re-bidding at new rates.",
  },
  term_flexibility: {
    term: "Firm / Negotiable / Flexible",
    definition:
      "How movable the stated term is. Firm means take it as stated. Negotiable means there's room within reason. Flexible means the vendor will work with what you need.",
    whyItMatters:
      "tells you where a deal can bend before you start the conversation, so negotiation effort goes where it can actually move something.",
  },
  mbe: {
    term: "Minority Business Enterprise (MBE)",
    definition:
      "A business majority-owned and controlled by members of a recognized minority group, certified by a body such as the NMSDC or a state agency.",
    whyItMatters:
      "many clients carry supplier-diversity commitments; certified vendors help you meet them and document it.",
  },
  wbe: {
    term: "Women Business Enterprise (WBE)",
    definition: "A business majority-owned and controlled by women, certified by a body such as WBENC.",
    whyItMatters: "same supplier-diversity credit, with certification you can show the client.",
  },
  mwbe: {
    term: "Minority/Women-Owned Business Enterprise (MWBE)",
    definition:
      "A combined designation used by many states and cities for businesses that qualify as minority- and/or women-owned.",
    whyItMatters: "some client and government contracts specify MWBE participation targets by name.",
  },
  dbe: {
    term: "Disadvantaged Business Enterprise (DBE)",
    definition:
      "A federal designation (primarily transportation-related contracting) for small businesses owned by socially and economically disadvantaged individuals.",
    whyItMatters: "mostly relevant when your client's work touches federally funded projects.",
  },
  veteran_owned: {
    term: "Veteran-Owned Business (VBE)",
    definition: "A business majority-owned and controlled by one or more veterans.",
    whyItMatters: "satisfies veteran-inclusion goals some clients and government contracts carry.",
  },
  sdvob: {
    term: "Service-Disabled Veteran-Owned Business (SDVOB)",
    definition: "A business majority-owned and controlled by one or more service-disabled veterans.",
    whyItMatters: "a distinct set-aside category in government and some corporate contracting, separate from VBE.",
  },
  lgbtbe: {
    term: "LGBT Business Enterprise (LGBTBE)",
    definition: "A business majority-owned and controlled by LGBT individuals, typically certified by the NGLCC.",
    whyItMatters: "an increasingly common category in corporate supplier-diversity programs.",
  },
  dobe: {
    term: "Disability-Owned Business Enterprise (DOBE)",
    definition:
      "A business majority-owned and controlled by persons with disabilities, typically certified by Disability:IN.",
    whyItMatters: "counts toward disability-inclusion goals in supplier-diversity programs.",
  },
  sbe: {
    term: "Small Business Enterprise (SBE)",
    definition:
      "A business that meets small-business size standards (by revenue or headcount) set by the certifying jurisdiction or the SBA.",
    whyItMatters: "some contracts carry small-business participation requirements independent of other designations.",
  },
  general_liability: {
    term: "General Liability",
    definition:
      "Covers third-party bodily injury and property damage arising from the vendor's operations - someone hurt on a shoot, a damaged location.",
    whyItMatters:
      "the baseline coverage almost every production engagement should carry. $1M/$2M (per occurrence / aggregate) is a common ask.",
  },
  workers_comp: {
    term: "Workers' Compensation",
    definition:
      "Covers the vendor's own employees if they're injured on the job. Required by law for employers in nearly every state.",
    whyItMatters: "without it, an on-set injury to the vendor's crew can become your problem and your client's.",
  },
  commercial_auto: {
    term: "Commercial Auto",
    definition: "Covers vehicles used for business - production trucks, equipment vans, crew transport.",
    whyItMatters:
      "personal auto policies typically exclude business use. Relevant any time the engagement puts vehicles to work.",
  },
  umbrella_excess: {
    term: "Umbrella / Excess",
    definition: "Extra coverage that sits on top of the underlying policies, raising the total available limit.",
    whyItMatters: "how a vendor with $1M base coverage meets a client's $5M requirement without rewriting every policy.",
  },
  professional_liability_eo: {
    term: "Professional Liability / E&O",
    definition:
      "Covers claims arising from the work itself: errors, omissions, missed clearances, alleged infringement in deliverables.",
    whyItMatters:
      "the coverage that responds when the problem is in the content, not the production. Especially relevant for creative and post work.",
  },
  cyber_liability: {
    term: "Cyber Liability",
    definition:
      "Covers data breaches and cyber incidents - relevant when a vendor handles client data, customer information, or embargoed material.",
    whyItMatters: "increasingly required by enterprise clients for any vendor touching their systems or data.",
  },
  coi: {
    term: "Certificate of Insurance (COI)",
    definition: "The one-page document from the vendor's insurer proving their coverage: types, limits, and dates.",
    whyItMatters:
      "\"we're insured\" isn't verification. The COI is, and clients often require you to have it on file before work starts.",
  },
  nda: {
    term: "NDA (Non-Disclosure Agreement)",
    definition:
      "A confidentiality agreement: the vendor agrees not to share what they learn about your client's business, plans, or materials.",
    whyItMatters:
      "standard protection before sharing briefs, embargoed launches, or anything the client would mind seeing leak.",
    legal: true,
  },
  msa: {
    term: "MSA (Master Services Agreement)",
    definition:
      "The umbrella contract setting the standing legal terms between you and a vendor, so each project only needs a scope and price on top.",
    whyItMatters: "negotiate the hard stuff once. Repeat engagements move much faster with an MSA in place.",
    legal: true,
  },
  rfp: {
    term: "RFP (Request for Proposal)",
    definition:
      "Your scoped invitation to bid: what you need done, for whom, by when, and what a response should include.",
    whyItMatters: "sharper RFPs get comparable bids. Vague ones get quotes you can't line up against each other.",
  },
  composite_score: {
    term: "Composite score",
    definition:
      "The weighted overall 0-100 score for a bid, combining your scoring criteria - AI pre-scored, adjustable by you.",
    whyItMatters: "makes bids comparable at a glance, but it's an input to your judgment, not a verdict.",
  },
  delivery_performance: {
    term: "Delivery performance / reliability score",
    definition: "A vendor's track record from completed project reviews: how delivery matched what was bid.",
    whyItMatters: "past delivery is the best predictor you have. This is the evidence layer behind awarding with confidence.",
  },
}
