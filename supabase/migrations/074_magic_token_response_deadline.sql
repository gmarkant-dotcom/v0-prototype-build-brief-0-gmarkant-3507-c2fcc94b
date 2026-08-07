-- Response deadline for the magic-link / Lightning RFP flow (F2). Mirrors migration 041,
-- which added the same column to partner_rfp_inbox for the standard broadcast flow -
-- rfp_magic_tokens has never had an equivalent, which is the actual reason vendor rows on
-- that flow always render "No deadline set": there was never a column to write one into.
--
-- WRITTEN, NOT YET APPLIED. Run in the Supabase SQL Editor before deploying the code that
-- reads/writes rfp_magic_tokens.response_deadline (app/agency/page.tsx's magic-link queue
-- body, app/agency/magic-rfp/page.tsx's deadline input, app/api/agency/rfp/magic-link/route.ts,
-- app/rfp/respond/[token]/page.tsx, app/api/agency/rfp-responses/route.ts). All of that code
-- is written null-safe against this column's absence in the meantime (retries the write
-- without response_deadline on a 42703 undefined_column error, same guard pattern already
-- used for business_criteria_acknowledgments pre-migration-071).

alter table rfp_magic_tokens
  add column if not exists response_deadline timestamptz;

-- Verification (run manually after applying, not part of the migration itself):
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'rfp_magic_tokens' AND column_name = 'response_deadline';
-- -- Expected: one row, data_type = 'timestamp with time zone'
--
-- SELECT count(*) FROM rfp_magic_tokens WHERE response_deadline IS NOT NULL;
-- -- Expected: 0 immediately after applying (existing rows have no value until the next
-- -- broadcast/edit through the updated magic-link route)
