-- Add optional scheduling link for agencies
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meeting_url TEXT;
