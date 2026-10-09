-- Migração: localização geográfica das obras (módulo Contratos / gecope_mapa_obras.html,
-- modo "Ruas e bairros" do município e cartão "Localização" da Ficha Obra).
--
-- Contexto: contratos_edificacao é um ESPELHO do SIGSOP, reescrito a cada carga
-- (sigsop_contratos.py, upsert com merge-duplicates) e o SIGSOP não fornece coordenada.
-- Por isso a localização fica numa tabela PRÓPRIA, de 1 linha por obra física cadastrada
-- (id_obra = contratos_edificacao.id_obra, mesma convenção de eletrica_vistorias: sem FK
-- física, para a localização sobreviver se a linha sumir/voltar do espelho).
--
-- Quem lê:     os mesmos papéis que leem contratos_edificacao (contratos_edificacao_pode_ler():
--              admin, gerente, fiscal, externo, eletrica).
-- Quem grava:  (versão inicial: os 5 papéis.) SUBSTITUÍDO por sql/add_autorizacao_localizacao_cadastrar.sql:
--              admin/gerente pelo papel; fiscal/externo/eletrica só com a autorização especial
--              'localizacao_cadastrar', concedida pelo Admin.
-- Quem apaga:  só admin e gerente (remover a localização é decisão de gestão; corrigir um
--              ponto errado não exige apagar, basta gravar o novo).
--
-- O que este script NÃO faz: não carrega as coordenadas da planilha. Isso está em
-- sql/import_obra_localizacao_inicial.sql (rode DEPOIS deste).
--
-- Rastreio: o gatilho carimba atualizado_em/atualizado_por (e-mail do JWT) em todo
-- INSERT/UPDATE, para saber quem mexeu por último. Não há histórico de versões: o ponto
-- anterior é sobrescrito.
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase. É idempotente.

begin;

create table if not exists public.obra_localizacao (
  id_obra        integer primary key,          -- contratos_edificacao.id_obra
  latitude       double precision not null,
  longitude      double precision not null,
  fonte          text not null default 'mapa', -- como o ponto foi informado
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,                          -- e-mail de quem gravou por último
  -- Caixa do Ceará com folga (ponto fora dela é erro de digitação/troca de sinais). A checagem
  -- fina "o ponto cai dentro do município da obra" é feita no front, que tem os polígonos.
  constraint obra_localizacao_lat_ce  check (latitude  between -7.95 and -2.70),
  constraint obra_localizacao_lng_ce  check (longitude between -41.50 and -37.20),
  constraint obra_localizacao_fonte   check (fonte in ('planilha','mapa','digitada','gps'))
);

comment on table public.obra_localizacao is
  'Coordenadas (WGS84) de cada obra, para o mapa de ruas do módulo Contratos. 1 linha por id_obra.';

-- Carimbo de autoria. Fora do JWT (SQL Editor, importação) mantém o que veio no INSERT.
create or replace function public.obra_localizacao_carimbo()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(auth.jwt() ->> 'email', new.atualizado_por);
  return new;
end;
$function$;

drop trigger if exists trg_obra_localizacao_carimbo on public.obra_localizacao;
create trigger trg_obra_localizacao_carimbo
  before insert or update on public.obra_localizacao
  for each row execute function public.obra_localizacao_carimbo();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- (select fn()) em vez de fn() solto: o Postgres avalia a função 1 vez por consulta, não 1 vez
-- por linha (mesma correção de sql/fix_rls_cache_funcoes_auxiliares.sql).
alter table public.obra_localizacao enable row level security;

drop policy if exists obra_localizacao_select on public.obra_localizacao;
create policy obra_localizacao_select on public.obra_localizacao
  for select to authenticated
  using ((select public.contratos_edificacao_pode_ler()));

drop policy if exists obra_localizacao_insert on public.obra_localizacao;
create policy obra_localizacao_insert on public.obra_localizacao
  for insert to authenticated
  with check ((select public.contratos_edificacao_pode_ler()));

drop policy if exists obra_localizacao_update on public.obra_localizacao;
create policy obra_localizacao_update on public.obra_localizacao
  for update to authenticated
  using ((select public.contratos_edificacao_pode_ler()))
  with check ((select public.contratos_edificacao_pode_ler()));

drop policy if exists obra_localizacao_delete on public.obra_localizacao;
create policy obra_localizacao_delete on public.obra_localizacao
  for delete to authenticated
  using ((select public.meu_papel()) in ('admin','gerente'));

-- Sem acesso anônimo (o padrão do Supabase concede tudo ao anon; a RLS já barraria, isto é o
-- cinto além do suspensório).
revoke all on public.obra_localizacao from anon;
grant select, insert, update, delete on public.obra_localizacao to authenticated;

commit;

-- Conferência pós-aplicação (rodar à parte):
--   select policyname, cmd, roles from pg_policies where tablename = 'obra_localizacao' order by cmd;
--   -- esperado: 4 policies (DELETE, INSERT, SELECT, UPDATE), todas {authenticated}
