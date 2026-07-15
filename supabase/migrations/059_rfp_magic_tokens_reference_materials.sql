-- Reference materials (files/links) attached to a Lightning RFP Magic Link invitation,
-- shown to the guest vendor on the /rfp/respond/[token] page.
ALTER TABLE rfp_magic_tokens ADD COLUMN IF NOT EXISTS reference_materials JSONB DEFAULT '[]'::jsonb;
