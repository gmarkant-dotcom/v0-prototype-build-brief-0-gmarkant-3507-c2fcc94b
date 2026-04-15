ALTER TABLE public.partner_rfp_responses
  ADD COLUMN IF NOT EXISTS payment_terms JSONB;
