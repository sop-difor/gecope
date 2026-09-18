-- ============================================================================
-- diagnostico_egress.sql — medição do que o banco realmente entrega aos clientes
--
-- SOMENTE LEITURA: só SELECT em catálogos, estatísticas e tabelas. Não altera nada.
--
-- Como usar: SQL Editor do Supabase. O editor só mostra o resultado do ÚLTIMO comando,
-- então selecione e rode UM BLOCO POR VEZ ([1], [2], ...) e copie o resultado.
--
-- Por que não dá para medir bytes direto: o PostgREST embrulha cada chamada da API numa
-- única linha JSON, então pg_stat_statements.rows vale ~1 por chamada e não diz o
-- tamanho. A medição combina (a) quantas vezes cada consulta rodou [1] com (b) quanto
-- pesa ler cada tabela inteira [2] e (c) quantas vezes cada tabela foi lida inteira [3].
-- ============================================================================


-- [0] Janela das estatísticas: os números de [1] e [3] são acumulados desde esta data.
select stats_reset, now() - stats_reset as janela
from extensions.pg_stat_statements_info;


-- [1] Consultas mais frequentes vindas da API (front-end, worker, watchdog, edge functions).
--     `chamadas_por_dia` usa a janela de [0]. Procure: consultas ao whatsapp_jobs (worker),
--     processos, whatsapp_logs, orcamentos_biblioteca.
select r.rolname                                                   as papel,
       s.calls                                                     as chamadas,
       round(s.calls / greatest(extract(epoch from now() - i.stats_reset) / 86400, 1)::numeric, 0)
                                                                   as chamadas_por_dia,
       round(s.mean_exec_time::numeric, 1)                         as ms_medio,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 400)         as consulta
from extensions.pg_stat_statements s
join pg_roles r on r.oid = s.userid
cross join extensions.pg_stat_statements_info i
where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
order by s.calls desc
limit 40;


-- [2] Peso real de cada tabela do schema public: linhas × tamanho médio medido da linha.
--     `mb_select_estrela` ≈ o que um select('*') da tabela inteira transfere ANTES do
--     overhead do JSON (que costuma somar 30–100% sobre esse valor).
--     Lê todas as tabelas uma vez; o banco tem ~100 MB, então roda em segundos.
select c.relname                                                   as tabela,
       c.reltuples::bigint                                         as linhas_aprox,
       w.bytes_medio_linha,
       round((c.reltuples * w.bytes_medio_linha / 1048576.0)::numeric, 2) as mb_select_estrela
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral (
    select coalesce((xpath('/row/w/text()',
             query_to_xml(format('select avg(pg_column_size(t.*))::int as w from %I.%I t',
                                 n.nspname, c.relname), false, true, '')))[1]::text::int, 0)
           as bytes_medio_linha
) w
where n.nspname = 'public' and c.relkind = 'r'
order by mb_select_estrela desc nulls last
limit 30;


-- [3] Quantas vezes cada tabela foi lida INTEIRA (seq scan) desde o último reset.
--     `leituras_completas_equiv` = tuplas lidas por varredura ÷ linhas vivas. Tabela
--     pequena com número alto aqui = alguém baixa a tabela toda com frequência.
select relname                                                     as tabela,
       n_live_tup                                                  as linhas,
       seq_scan                                                    as varreduras,
       seq_tup_read                                                as tuplas_lidas_varredura,
       round(seq_tup_read::numeric / nullif(n_live_tup, 0), 0)     as leituras_completas_equiv,
       idx_scan                                                    as buscas_indice
from pg_stat_user_tables
where schemaname = 'public'
order by seq_tup_read desc
limit 30;

-- [3b] Data do reset das estatísticas de tabela (a janela de [3]).
select stats_reset from pg_stat_database where datname = current_database();


-- [4] Storage: volume por bucket e os 20 maiores arquivos.
select bucket_id,
       count(*)                                                    as arquivos,
       pg_size_pretty(sum((metadata->>'size')::bigint))            as total
from storage.objects
group by bucket_id
order by sum((metadata->>'size')::bigint) desc;

select bucket_id, name,
       pg_size_pretty((metadata->>'size')::bigint)                 as tamanho,
       metadata->>'mimetype'                                       as tipo,
       created_at
from storage.objects
order by (metadata->>'size')::bigint desc nulls last
limit 20;


-- [5] RLS: quais tabelas do public estão com RLS DESLIGADA e o que o papel `anon`
--     (visitante sem login, com a chave pública do config.js) consegue ler.
--     Se `processos` aparecer com rls_ativa = false e anon_pode_ler = true, a carga do
--     boot antes do login baixa a tabela inteira para qualquer visitante.
select c.relname                                                   as tabela,
       c.relrowsecurity                                            as rls_ativa,
       has_table_privilege('anon', c.oid, 'SELECT')                as anon_pode_ler
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
order by c.relrowsecurity, c.relname;

-- [5b] Políticas das tabelas mais lidas pelo front-end.
select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('processos', 'orcamentos_biblioteca', 'composicoes_biblioteca',
                    'whatsapp_logs', 'whatsapp_jobs', 'app_atividades')
order by tablename, cmd;


-- [6] whatsapp_logs: volume e tamanho das mensagens por evento (dimensiona a consulta
--     de 10.000 linhas de whatsapp.js).
select evento,
       count(*)                                                    as linhas,
       round(avg(length(mensagem)))                                as chars_medio_msg,
       pg_size_pretty(sum(pg_column_size(l.*))::bigint)            as total
from public.whatsapp_logs l
group by evento
order by count(*) desc;


-- [7] Jobs agendados no banco (pg_cron). Se der erro "schema cron does not exist",
--     não há jobs — pode ignorar.
select jobid, schedule, active, left(command, 200) as comando
from cron.job
order by jobid;


-- [8] Fecha a lacuna do bloco [0.5] do plano: aquele check filtrava grantee IN
--     ('anon','authenticated') e por isso não veria uma concessão dada a PUBLIC (que
--     vale pra todo mundo, incluindo os dois). Este aqui não filtra por papel — filtra
--     por privilégio, pra qualquer papel que tenha INSERT/UPDATE/DELETE nas tabelas de
--     preço aparecer, PUBLIC incluso.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('seinfra_composicao','sinapi_composicao','orse_composicao',
                     'seinfra_itens','sinapi_itens','orse_itens')
  and privilege_type in ('INSERT','UPDATE','DELETE')
order by table_name, privilege_type, grantee;
