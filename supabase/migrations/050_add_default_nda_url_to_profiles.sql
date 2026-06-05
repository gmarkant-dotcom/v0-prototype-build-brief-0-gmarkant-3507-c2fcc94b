-- Migration 050: add default_nda_url to profiles
-- Stores the agency's default NDA signing link, auto-populated on RFP broadcast.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_nda_url text;
