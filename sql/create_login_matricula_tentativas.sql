-- Revisão de segurança de 04/11/2026 (item 2): apoio da Edge Function login-matricula.
--
-- Antes, o navegador chamava app_users_lookup_by_matricula sem login e recebia nome e
-- e-mail de qualquer matrícula. Agora a função login-matricula resolve o e-mail no
-- servidor e só devolve a sessão. Como todas as tentativas de login por matrícula saem
-- do mesmo servidor (o limite por IP do Supabase Auth deixa de distinguir quem tenta),
-- a função guarda aqui cada tentativa e aplica o próprio limite por matrícula e por IP.
--
-- Só a service_role usa a tabela: RLS ligada, sem policy, sem grant para anon/authenticated.

begin;

create table if not exists public.login_matricula_tentativas (
  id          bigint generated always as identity primary key,
  acao        text        not null check (acao in ('login', 'recuperar')),
  matricula   text        not null,
  ip          text        not null,
  sucesso     boolean     not null default false,
  criado_em   timestamptz not null default now()
);

create index if not exists login_matricula_tentativas_matricula_idx
  on public.login_matricula_tentativas (acao, matricula, criado_em desc);
create index if not exists login_matricula_tentativas_ip_idx
  on public.login_matricula_tentativas (acao, ip, criado_em desc);

alter table public.login_matricula_tentativas enable row level security;
revoke all on public.login_matricula_tentativas from anon, authenticated;

commit;

-- Limpeza: a função apaga tentativas com mais de 1 dia a cada chamada (ver index.ts).

-- Rollback:
-- drop table if exists public.login_matricula_tentativas;
