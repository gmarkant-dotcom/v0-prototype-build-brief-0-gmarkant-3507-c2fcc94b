-- Marketplace discoverability support for profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_discoverable BOOLEAN NOT NULL DEFAULT FALSE;

-- Authenticated users can browse discoverable profiles.
DROP POLICY IF EXISTS "Authenticated users can read discoverable profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read discoverable profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (is_discoverable = TRUE);
