-- Support no-auth guest bid submissions via rfp_magic_tokens.
-- Additive only: relaxes two NOT NULL constraints that assumed an authenticated
-- partner submission (inbox_item_id, partner_id), and adds scope-item text
-- snapshot columns to rfp_magic_tokens (mirrors the existing partner_rfp_inbox
-- scope_item_name/scope_item_description snapshot pattern, since there is no
-- canonical scope_items table to join against).

ALTER TABLE partner_rfp_responses ALTER COLUMN inbox_item_id DROP NOT NULL;
ALTER TABLE partner_rfp_responses ALTER COLUMN partner_id DROP NOT NULL;

ALTER TABLE rfp_magic_tokens ADD COLUMN IF NOT EXISTS scope_item_name text;
ALTER TABLE rfp_magic_tokens ADD COLUMN IF NOT EXISTS scope_item_description text;

-- Required for upsert(..., { onConflict: 'agency_id,project_id,vendor_email' })
-- in the magic-link generation/resend API.
CREATE UNIQUE INDEX IF NOT EXISTS rfp_magic_tokens_agency_project_vendor_idx
  ON rfp_magic_tokens (agency_id, project_id, vendor_email);
