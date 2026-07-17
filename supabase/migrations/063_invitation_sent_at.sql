-- Partner pool state redesign: distinguishes "Invited" (a real invitation email was sent
-- to the vendor) from merely "Discovered" (added to the pool via email-scan import or a
-- ghost partnership from a guest bid, with nobody actually invited yet) on /agency/pool.
--
-- Column checked before writing: invitation_sent_at does not exist on partnerships
-- (confirmed against migrations 001-062 and app/api/partnerships/route.ts's current
-- select('*') usage).
ALTER TABLE partnerships
  ADD COLUMN IF NOT EXISTS invitation_sent_at timestamptz;

-- 'removed' lets an agency hide a Discovered/Invited row from the pool without deleting the
-- row outright, since it may carry associated rfp_magic_tokens or bid history worth keeping
-- for audit. Only touches the constraint if partnerships.status is already constrained -
-- going by every existing write path (all inserts/updates use 'pending' | 'active' |
-- 'suspended' | 'terminated' with no observed constraint violations), it appears to be
-- unconstrained text from the pre-tracked schema, so this is a no-op guard, not a known-needed change.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'partnerships'
    AND con.contype = 'c'
    AND att.attname = 'status'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE partnerships DROP CONSTRAINT %I', con_name);
    ALTER TABLE partnerships
      ADD CONSTRAINT partnerships_status_check
      CHECK (status IN ('pending', 'active', 'suspended', 'terminated', 'removed'));
  END IF;
END $$;
