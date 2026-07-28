export type DefaultScoringCriterion = {
  name: string
  description: string
  category: string
  default_weight: number
}

export const DEFAULT_SCORING_CRITERIA: DefaultScoringCriterion[] = [
  {
    name: "Creative Approach & Strategy",
    description:
      "How well does the vendor's creative concept align with the brief? Does the approach demonstrate strategic thinking and originality?",
    category: "quality",
    default_weight: 1.5,
  },
  {
    name: "Production Capability",
    description:
      "Does the vendor have the team, equipment, experience, and track record to deliver this scope at the required quality level?",
    category: "quality",
    default_weight: 1.5,
  },
  {
    name: "Budget Competitiveness",
    description:
      "Does the budget represent fair value for the proposed scope? Not just lowest price, but best value considering quality and completeness.",
    category: "commercial",
    default_weight: 1.0,
  },
  {
    name: "Timeline Feasibility",
    description:
      "Is the proposed schedule realistic given the scope complexity? Are milestones well-defined and achievable?",
    category: "delivery",
    default_weight: 1.0,
  },
  {
    name: "Business Criteria Compliance",
    description:
      "Does the vendor meet required certifications, insurance coverage, and diversity requirements?",
    category: "compliance",
    default_weight: 0.5,
  },
  {
    name: "Vendor Track Record",
    description:
      "Based on past projects with this agency (if any), how reliable and consistent is this vendor's delivery?",
    category: "reliability",
    default_weight: 1.0,
  },
  {
    name: "Risk Assessment",
    description:
      "Are there red flags, missing information, single points of failure, or unclear assumptions that could impact delivery?",
    category: "risk",
    default_weight: 1.0,
  },
]

export const DEFAULT_TEMPLATE_NAME = "Standard Evaluation"
export const DEFAULT_TEMPLATE_DESCRIPTION = "All seven default criteria at their standard weights."
