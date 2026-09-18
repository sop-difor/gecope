-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — onde nasce processos.tempo_suite
--
-- Pedido do usuário (2026-09-16): a data de despacho do painel deve ser a ÚLTIMA saída do
-- processo da gerência do fiscal no histórico do SUITE — a mesma leitura que soma as
-- passagens e produz tempo_suite —, e não data_aprovacao_gecope.
--
-- O repositório não calcula tempo_suite: o job sincronizar-suite só grava sigla, data de
-- chegada e status, e não guarda o histórico. Esta consulta procura o cálculo dentro do
-- banco: funções, triggers, jobs do pg_cron e colunas relacionadas.
--
-- Uma consulta só (o SQL Editor mostra apenas o último resultado). Não altera nada.
-- ============================================================================
select 'função' as tipo,
       n.nspname || '.' || p.proname as nome,
       left(regexp_replace(p.prosrc, '\s+', ' ', 'g'), 400) as detalhe
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and (p.prosrc ilike '%tempo_suite%' or p.prosrc ilike '%public-history%')

union all
select 'trigger',
       c.relname || '.' || t.tgname,
       pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname = 'processos'

union all
select 'coluna',
       table_schema || '.' || table_name || '.' || column_name,
       data_type
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
  and (column_name ilike '%suite%' or column_name ilike '%hist%' or column_name ilike '%tramit%')

union all
select 'tabela',
       table_schema || '.' || table_name,
       table_type
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
  and (table_name ilike '%suite%' or table_name ilike '%hist%' or table_name ilike '%tramit%')

order by 1, 2;

-- Se a extensão pg_cron estiver ativa, rode também esta (separada — falha se não estiver):
-- select jobname, schedule, left(command, 300) from cron.job;
