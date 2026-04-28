ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS secondary_role text CHECK (secondary_role IN ('agency','partner')),
  ADD COLUMN IF NOT EXISTS active_role text CHECK (active_role IN ('agency','partner'));

UPDATE profiles SET active_role = role WHERE active_role IS NULL;

ALTER TABLE profiles ALTER COLUMN active_role SET DEFAULT 'agency';
