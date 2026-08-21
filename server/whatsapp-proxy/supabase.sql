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

-- Controle do watchdog do WhatsApp: linha única com o estado de saúde da conexão e
-- pedidos de reinício vindos do painel do GECOPE (botão "Reiniciar Conexão" em
-- Administração). Só o service role (proxy/watchdog) lê/escreve aqui — o front-end nunca
-- acessa esta tabela diretamente, sempre por meio de /api/whatsapp/status e
-- /api/whatsapp/instance/restart-request.
create table if not exists whatsapp_control (
  id smallint primary key default 1,
  degraded_since timestamptz,
  restart_requested_at timestamptz,
  restart_requested_by text,
  last_restarted_at timestamptz,
  updated_at timestamptz default now(),
  constraint whatsapp_control_singleton check (id = 1)
);

insert into whatsapp_control (id) values (1)
  on conflict (id) do nothing;

alter table whatsapp_control enable row level security;
-- Sem policies: RLS ligado + nenhuma policy = ninguém além do service role (que ignora
-- RLS por design) consegue ler ou escrever, nem mesmo com a anon/authenticated key.
