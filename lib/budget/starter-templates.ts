import type { FeeOrCost } from "@/lib/server/budget/schema"

/**
 * THE STARTER LIBRARY. Content, defined in code, for the composition step on
 * /agency/budgeting/templates. Nothing here is written anywhere until the user check-marks
 * categories and confirms; then each chosen category is POSTed to the agency template through the
 * gated templates route, skipping names the template already has.
 *
 * FEE OR COST. Margin comes from this flag (spec 2b), so every category carries one:
 *   fee   what the agency itself earns: its fees, mark-ups and its own team's time billed as fee.
 *   cost  third-party and pass-through spend: crew, vendors, venues, media, materials.
 * A category that is sometimes either is listed as cost, the conservative reading (it never
 * inflates margin), and the note says so.
 *
 * Lessons from lib/budget-categories.ts (R3 there): a category must be a MONEY bucket. "Included
 * hours", "overage rate", "number of rounds" are terms, not categories, and are left out on purpose.
 */

export type StarterCategory = { name: string; feeOrCost: FeeOrCost; note?: string }

export type StarterTemplate = {
  slug: string
  name: string
  description: string
  categories: StarterCategory[]
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    slug: "live_action",
    name: "Live-action video production",
    description: "Commercial or branded film shoot, from pre-production through delivery.",
    categories: [
      { name: "Creative development", feeOrCost: "fee", note: "Concept, scripting and treatment by the agency." },
      { name: "Agency production fee", feeOrCost: "fee" },
      { name: "Producer and production management", feeOrCost: "fee", note: "The agency's own producers." },
      { name: "Director", feeOrCost: "cost" },
      { name: "Pre-production", feeOrCost: "cost", note: "Casting sessions, scouting, prep days." },
      { name: "Shoot crew", feeOrCost: "cost" },
      { name: "Talent and cast", feeOrCost: "cost" },
      { name: "Talent usage and residuals", feeOrCost: "cost" },
      { name: "Camera, lighting and grip", feeOrCost: "cost" },
      { name: "Art department and props", feeOrCost: "cost" },
      { name: "Wardrobe, hair and makeup", feeOrCost: "cost" },
      { name: "Locations and permits", feeOrCost: "cost" },
      { name: "Studio and stage rental", feeOrCost: "cost" },
      { name: "Catering and craft services", feeOrCost: "cost" },
      { name: "Travel and per diem", feeOrCost: "cost" },
      { name: "Insurance", feeOrCost: "cost" },
      { name: "Editorial", feeOrCost: "cost" },
      { name: "Color grading", feeOrCost: "cost" },
      { name: "Sound design and mix", feeOrCost: "cost" },
      { name: "Music licensing", feeOrCost: "cost" },
      { name: "Contingency", feeOrCost: "cost", note: "A cash amount, not a percentage." },
    ],
  },
  {
    slug: "experiential",
    name: "Experiential and live event",
    description: "Brand activation, launch event, pop-up or conference presence.",
    categories: [
      { name: "Event strategy and creative", feeOrCost: "fee" },
      { name: "Agency management fee", feeOrCost: "fee" },
      { name: "On-site event staff (agency)", feeOrCost: "fee" },
      { name: "Venue rental", feeOrCost: "cost" },
      { name: "Fabrication and build", feeOrCost: "cost" },
      { name: "Staging, AV and lighting", feeOrCost: "cost" },
      { name: "Furniture and decor rental", feeOrCost: "cost" },
      { name: "Food and beverage", feeOrCost: "cost" },
      { name: "Talent, hosts and performers", feeOrCost: "cost" },
      { name: "Brand ambassadors", feeOrCost: "cost" },
      { name: "Security and medical", feeOrCost: "cost" },
      { name: "Permits and licenses", feeOrCost: "cost" },
      { name: "Shipping, freight and storage", feeOrCost: "cost" },
      { name: "Printing and signage", feeOrCost: "cost" },
      { name: "Giveaways and merchandise", feeOrCost: "cost" },
      { name: "Photo and video capture", feeOrCost: "cost" },
      { name: "Travel and lodging", feeOrCost: "cost" },
      { name: "Insurance", feeOrCost: "cost" },
      { name: "Contingency", feeOrCost: "cost", note: "A cash amount, not a percentage." },
    ],
  },
  {
    slug: "digital_social",
    name: "Digital and social campaign",
    description: "Always-on or flighted social and digital campaign, content plus paid media.",
    categories: [
      { name: "Strategy and planning", feeOrCost: "fee" },
      { name: "Creative and copywriting", feeOrCost: "fee" },
      { name: "Design and art direction", feeOrCost: "fee" },
      { name: "Community management", feeOrCost: "fee" },
      { name: "Paid media management fee", feeOrCost: "fee" },
      { name: "Reporting and analytics", feeOrCost: "fee" },
      { name: "Content production", feeOrCost: "cost" },
      { name: "Creator and influencer fees", feeOrCost: "cost" },
      { name: "Paid media spend", feeOrCost: "cost", note: "Media bought on the client's behalf." },
      { name: "Stock assets and licensing", feeOrCost: "cost" },
      { name: "Software and tools", feeOrCost: "cost" },
      { name: "Web and landing page development", feeOrCost: "cost" },
    ],
  },
  {
    slug: "photo_shoot",
    name: "Photo shoot",
    description: "Stills campaign or product photography, studio or location.",
    categories: [
      { name: "Art direction", feeOrCost: "fee" },
      { name: "Agency production fee", feeOrCost: "fee" },
      { name: "Photographer", feeOrCost: "cost" },
      { name: "Photo assistants and digital tech", feeOrCost: "cost" },
      { name: "Models and talent", feeOrCost: "cost" },
      { name: "Image usage and licensing", feeOrCost: "cost" },
      { name: "Stylists, hair and makeup", feeOrCost: "cost" },
      { name: "Set design and props", feeOrCost: "cost" },
      { name: "Studio rental", feeOrCost: "cost" },
      { name: "Locations and permits", feeOrCost: "cost" },
      { name: "Equipment rental", feeOrCost: "cost" },
      { name: "Catering", feeOrCost: "cost" },
      { name: "Retouching", feeOrCost: "cost" },
      { name: "Travel", feeOrCost: "cost" },
    ],
  },
  {
    slug: "animation_post",
    name: "Animation and post-production",
    description: "Motion design, 2D or 3D animation, VFX and finishing.",
    categories: [
      { name: "Creative direction", feeOrCost: "fee" },
      { name: "Agency project management", feeOrCost: "fee" },
      { name: "Storyboards and animatic", feeOrCost: "cost" },
      { name: "Design and style frames", feeOrCost: "cost" },
      { name: "2D animation", feeOrCost: "cost" },
      { name: "3D modeling and animation", feeOrCost: "cost" },
      { name: "VFX and compositing", feeOrCost: "cost" },
      { name: "Editorial", feeOrCost: "cost" },
      { name: "Color grading", feeOrCost: "cost" },
      { name: "Voiceover talent", feeOrCost: "cost" },
      { name: "Sound design and mix", feeOrCost: "cost" },
      { name: "Music licensing", feeOrCost: "cost" },
      { name: "Render and cloud compute", feeOrCost: "cost" },
      { name: "Versioning and deliverables", feeOrCost: "cost" },
    ],
  },
  {
    slug: "retainer",
    name: "Agency retainer",
    description: "Ongoing monthly engagement: the recurring fee and anything billed outside it.",
    categories: [
      { name: "Monthly retainer fee", feeOrCost: "fee", note: "The recurring fee. Record hours and rates in the line name, not as a category." },
      { name: "Additional scope fees", feeOrCost: "fee", note: "Work billed outside the retainer." },
      { name: "Pass-through costs", feeOrCost: "cost", note: "Billed on at cost." },
      { name: "Freelance and contractor support", feeOrCost: "cost" },
      { name: "Software and subscriptions", feeOrCost: "cost" },
      { name: "Travel and expenses", feeOrCost: "cost" },
    ],
  },
  {
    slug: "brand_design",
    name: "Brand identity and design",
    description: "Naming, identity system, guidelines and launch assets.",
    categories: [
      { name: "Research and discovery", feeOrCost: "fee" },
      { name: "Brand strategy", feeOrCost: "fee" },
      { name: "Identity design", feeOrCost: "fee" },
      { name: "Brand guidelines", feeOrCost: "fee" },
      { name: "Copywriting and naming", feeOrCost: "fee" },
      { name: "Font and asset licensing", feeOrCost: "cost" },
      { name: "Trademark search", feeOrCost: "cost" },
      { name: "Photography and illustration", feeOrCost: "cost" },
      { name: "Printing and production", feeOrCost: "cost" },
    ],
  },
  {
    slug: "audio_podcast",
    name: "Audio and podcast production",
    description: "Branded podcast series, radio spots or audio content.",
    categories: [
      { name: "Series development", feeOrCost: "fee" },
      { name: "Producer and showrunner (agency)", feeOrCost: "fee" },
      { name: "Hosts and talent", feeOrCost: "cost" },
      { name: "Studio and recording", feeOrCost: "cost" },
      { name: "Audio editing and mixing", feeOrCost: "cost" },
      { name: "Music and sound licensing", feeOrCost: "cost" },
      { name: "Transcription and captioning", feeOrCost: "cost" },
      { name: "Hosting and distribution", feeOrCost: "cost" },
      { name: "Promotion and media", feeOrCost: "cost" },
    ],
  },
]

/** Case- and whitespace-insensitive key used to skip duplicates by name. */
export const categoryNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()
