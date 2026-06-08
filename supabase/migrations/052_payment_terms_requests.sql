ALTER TABLE partnerships 
  ADD COLUMN IF NOT EXISTS payment_terms_requests jsonb DEFAULT '[]'::jsonb;
