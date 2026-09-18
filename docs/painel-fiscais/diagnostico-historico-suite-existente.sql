-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — o histórico do SUITE que JÁ existe no banco
--
-- O resultado de diagnostico-origem-tempo-suite.sql (2026-09-16) mostrou que o banco já tem
-- as tabelas historico_suite_eventos e historico_atribuicao_fiscal e as funções
-- calcular_tempo_suite_processo / atualizar_tempo_suite_processo. Nada disso está no
-- repositório, e nenhum código do repositório grava historico_suite_eventos.
--
-- Antes de propor tabela nova, é preciso ler o que existe: código completo das funções,
-- estrutura, volume e amostra das duas tabelas, e quem as alimenta.
--
-- Uma consulta só (o SQL Editor mostra apenas o último resultado). Não altera nada.
-- Exporte como CSV: a coluna "detalhe" traz o código inteiro das funções.
-- ============================================================================
select 1 as ordem, 'função' as tipo,
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as nome,
       pg_get_functiondef(p.oid) as detalhe
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and p.prokind = 'f'
  and (p.prosrc ilike '%tempo_suite%'
    or p.prosrc ilike '%historico_suite_eventos%'
    or p.prosrc ilike '%historico_atribuicao_fiscal%'
    or p.proname in ('trg_definir_sigla_suite', 'registrar_historico_atribuicao_fiscal'))

union all
select 2, 'coluna',
       table_name || '.' || column_name,
       data_type || coalesce(' default ' || column_default, '') ||
       case when is_nullable = 'NO' then ' not null' else '' end
from information_schema.columns
where table_schema = 'public'
  and table_name in ('historico_suite_eventos', 'historico_atribuicao_fiscal')

union all
select 3, 'restrição',
       c.relname || '.' || con.conname,
       pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
where c.relname in ('historico_suite_eventos', 'historico_atribuicao_fiscal')

union all
select 4, 'trigger',
       c.relname || '.' || t.tgname,
       pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname in ('historico_suite_eventos', 'historico_atribuicao_fiscal')

union all
select 5, 'volume', 'historico_suite_eventos',
       (select count(*) from public.historico_suite_eventos)::text || ' linhas'

union all
select 5, 'volume', 'historico_atribuicao_fiscal',
       (select count(*) from public.historico_atribuicao_fiscal)::text || ' linhas'

union all
select 6, 'amostra', 'historico_suite_eventos',
       to_jsonb(h)::text
from (select * from public.historico_suite_eventos limit 8) h

union all
select 7, 'amostra', 'historico_atribuicao_fiscal',
       to_jsonb(h)::text
from (select * from public.historico_atribuicao_fiscal limit 5) h

union all
select 8, 'política RLS',
       tablename || '.' || policyname,
       cmd || ' · ' || array_to_string(roles, ',') || ' · ' || coalesce(qual, '')
from pg_policies
where tablename in ('historico_suite_eventos', 'historico_atribuicao_fiscal')

order by 1, 2, 3;

-- Se a extensão pg_cron estiver ativa, rode também esta (separada — falha se não estiver).
-- Serve para descobrir se algum job do próprio banco chama o SUITE ou recalcula tempo_suite:
-- select jobname, schedule, command from cron.job;
