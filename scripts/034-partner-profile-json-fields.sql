ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credentials JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_examples JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reel_url TEXT;
