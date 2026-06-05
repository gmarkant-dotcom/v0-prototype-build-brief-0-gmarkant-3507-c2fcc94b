-- Migration 051: add MSA confirmation fields to partnerships
-- Tracks when a lead agency confirms an MSA is signed with a partner,
-- mirroring the NDA confirmation pattern (nda_confirmed_at / nda_confirmed_by).
ALTER TABLE partnerships
  ADD COLUMN IF NOT EXISTS msa_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS msa_confirmed_by uuid REFERENCES auth.users(id);
