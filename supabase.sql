-- Table to enqueue WhatsApp jobs
create table if not exists whatsapp_jobs (
  id uuid default gen_random_uuid() primary key,
  number text not null,
  text text not null,
  meta jsonb,
  status text not null default 'pending',
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb
);

create index if not exists idx_whatsapp_jobs_status on whatsapp_jobs (status);
