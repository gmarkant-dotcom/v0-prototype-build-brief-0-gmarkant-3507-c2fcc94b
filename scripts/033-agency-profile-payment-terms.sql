-- Preferred payment terms for lead agencies (MSA AI schedule, invoicing context).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_custom TEXT;
