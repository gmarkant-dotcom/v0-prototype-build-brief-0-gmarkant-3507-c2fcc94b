ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '[]'::jsonb;
