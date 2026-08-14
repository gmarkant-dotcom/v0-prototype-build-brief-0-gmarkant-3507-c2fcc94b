# Schema snapshot, 2026 08 13

Source: pg_policies dump run directly against the live Supabase database by Greg.
This file is authoritative. The migration history on disk cannot reproduce the live
database (see docs/organizations-m1-discovery.md, Finding Zero), so any migration that
drops or replaces a policy must be authored against this file, not against the repo.

Captured with:

    SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;

Also captured: all 38 public tables have row level security enabled and at least one
policy. No table is exposed (rls disabled) and none is locked out (zero policies).
The table "rfps" does not exist in the public schema.

## Policies

<PASTE THE FULL A0 OUTPUT HERE>
