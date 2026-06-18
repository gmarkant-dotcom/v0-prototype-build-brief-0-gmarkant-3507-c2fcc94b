create table brief_interpretations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  brief_text text,
  brief_file_url text,
  brief_title text,
  brief_summary text,
  analyses_requested text[],
  timeline_result jsonb,
  budget_result jsonb,
  campaigns_result jsonb,
  directors_result jsonb
);

alter table brief_interpretations enable row level security;

create policy "Users can manage their own interpretations"
  on brief_interpretations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table rfps add column if not exists interpretation_id uuid references brief_interpretations(id);
