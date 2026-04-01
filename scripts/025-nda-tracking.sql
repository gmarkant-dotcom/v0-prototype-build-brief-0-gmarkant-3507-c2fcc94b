-- Track NDA confirmation at the partnership level.
ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS nda_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS nda_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partnerships_nda_confirmed_at
  ON public.partnerships(nda_confirmed_at);
