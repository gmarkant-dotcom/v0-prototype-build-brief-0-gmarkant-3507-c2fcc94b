alter table brief_interpretations
  add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists idx_brief_interpretations_project_id
  on brief_interpretations(project_id);
