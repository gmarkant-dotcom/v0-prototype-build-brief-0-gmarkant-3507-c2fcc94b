-- Migration 027: add awarded_at to project_assignments
ALTER TABLE project_assignments
ADD COLUMN IF NOT EXISTS awarded_at timestamptz;
