ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS legal_entity_name TEXT,
  ADD COLUMN IF NOT EXISTS legal_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS legal_ein TEXT,
  ADD COLUMN IF NOT EXISTS legal_address TEXT,
  ADD COLUMN IF NOT EXISTS legal_state_of_incorporation TEXT;
