-- Business Criteria / Procurement Requirements: diversity/ownership designations,
-- insurance coverage, and company facts. Structured JSONB, shape shared across
-- three roles via lib/business-criteria.ts:
--   profiles.business_criteria               - what a company holds
--   rfp_magic_tokens.business_criteria_required - what an RFP requires
--   partner_rfp_responses.business_criteria_responses - what a bidder confirmed
--
-- master_rfp_json (JSONB column on partner_rfp_inbox) also carries a
-- business_criteria_required key at the app level. It needs no DDL here since
-- the column is already freeform JSONB.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_criteria JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.rfp_magic_tokens
  ADD COLUMN IF NOT EXISTS business_criteria_required JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.partner_rfp_responses
  ADD COLUMN IF NOT EXISTS business_criteria_responses JSONB DEFAULT '{}'::jsonb;
