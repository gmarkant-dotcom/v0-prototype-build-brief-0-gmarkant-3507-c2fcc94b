-- Spreadsheet/manual partner import: ghost (Discovered) partnerships rows have no
-- profiles row to join, so there is nowhere today to store a contact's name, company,
-- phone, or website until they claim an account. These four nullable columns fill that
-- gap. Discipline/type and any other unmapped import fields intentionally do NOT get
-- dedicated columns here - they go into the existing partnership_notes jsonb under a
-- namespaced key so they never collide with the {blacklisted} flag already stored there.

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
