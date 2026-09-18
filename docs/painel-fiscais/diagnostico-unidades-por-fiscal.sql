-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — em que unidades do SUITE os processos de cada fiscal
-- ficam antes de ir à GECOPE
--
-- Usuário (2026-09-16): há fiscais com mais de uma lotação no SUITE. Exemplos no resultado
-- 10: 22001.000499/2026-25 (fiscal lotado na GEDOP-LNO) correu na GEFOE e na DIAES, nunca na
-- LNO; 43022.009054/2025-51 (fiscal lotado na GEROE) foi aberto na DIRED.
--
-- Para cada fiscal, soma o tempo dos seus processos em cada unidade ANTES da ida à GECOPE que
-- resultou na aprovação (despachados) ou até agora (demais; arquivados no trâmite ficam de
-- fora). A GECOPE (10442) não entra. Serve para levantar as lotações extras de cada fiscal:
--   · e_lotacao             a unidade é a da lotação em app_users (suite_unidades_lotacao)
--   · fiscais_na_unidade    quantos fiscais diferentes têm processo passando por ela —
--                           unidade de rota (DIFOR, COINF, SUPER…) aparece para quase todos;
--                           lotação extra aparece para poucos, com muitos dias
--
-- Só unidades com pelo menos 1 dia somado. Uma consulta só. Não altera nada. Exporte (CSV).
-- ============================================================================
with proc as (
  select p.id, p.fiscal_matricula,
         coalesce(nullif(trim(u.full_name), ''), nullif(trim(p.fiscal), ''), '(sem fiscal)') as fiscal,
         u.gerencia, m.capacity as unidade_lotacao,
         upper(trim(coalesce(p.status, ''))) in ('APROVADO', 'ARQUIVADO')
           and p.data_aprovacao_gecope is not null                            as despachado,
         upper(trim(coalesce(p.status, ''))) = 'ARQUIVADO'
           and p.data_aprovacao_gecope is null                                as arquivado_no_tramite,
         ((p.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza') as fim_dia_aprovacao
  from public.processos p
  left join lateral (
    select au.full_name, au.gerencia from public.app_users au
    where au.matricula = p.fiscal_matricula order by au.id limit 1
  ) u on true
  left join public.suite_unidades_lotacao m
    on m.unidade = upper(trim(regexp_replace(u.gerencia, '^.*/', '')))
  where p.excluido_por is null
    and p.fiscal_matricula is not null
),
ev as (
  select h.processo_id, h.capacity, h.data_evento, h.unidade_sigla,
         lag(h.capacity)     over w as capacity_anterior,
         lead(h.data_evento) over w as proxima_data,
         row_number()        over w as seq
  from public.historico_suite_eventos h
  where h.data_evento is not null and h.capacity is not null
    and h.processo_id in (select id from proc where not arquivado_no_tramite)
  window w as (partition by h.processo_id order by h.data_evento, h.ordem_evento desc, h.id)
),
marcado as (
  select ev.*, sum(case when capacity_anterior is distinct from capacity then 1 else 0 end)
                 over (partition by processo_id order by seq) as passagem
  from ev
),
passagens as (
  select processo_id, passagem, min(capacity) as capacity, min(data_evento) as entrada,
         case when bool_or(proxima_data is null) then null else max(proxima_data) end as saida,
         -- unidade_sigla às vezes traz o nome do evento ("ARQUIVADO", "2025-41."); a sigla
         -- de verdade é a mais frequente por capacity, escolhida mais abaixo
         min(unidade_sigla) filter (where unidade_sigla ~ '^[A-Z][A-Z0-9-]*[A-Z0-9]$'
                                      and unidade_sigla not in ('ARQUIVADO', 'PROTOCOLO'))
                                                                               as sigla
  from marcado group by processo_id, passagem
),
corte as (
  select pr.id, max(pa.entrada) as corte
  from proc pr
  join passagens pa on pa.processo_id = pr.id and pa.capacity = 10442
  where pr.despachado and pa.entrada < pr.fim_dia_aprovacao
  group by pr.id
),
contadas as (
  select pr.fiscal_matricula, pr.fiscal, pr.gerencia, pr.unidade_lotacao, pr.id,
         pa.capacity, pa.sigla,
         extract(epoch from (coalesce(pa.saida, now()) - pa.entrada)) / 86400.0 as dias
  from proc pr
  join passagens pa on pa.processo_id = pr.id
  left join corte k on k.id = pr.id
  where pa.capacity <> 10442
    and (not pr.despachado or (k.corte is not null and pa.entrada < k.corte))
),
fiscais_por_unidade as (
  select capacity, count(distinct fiscal_matricula) as fiscais_na_unidade,
         mode() within group (order by sigla)                                  as sigla
  from contadas group by capacity
)
select
  c.fiscal_matricula,
  min(c.fiscal)                                 as fiscal,
  c.gerencia                                    as lotacao_app_users,
  c.capacity,
  f.sigla,
  (c.capacity = c.unidade_lotacao)              as e_lotacao,
  count(distinct c.id)                          as processos,
  round(sum(c.dias)::numeric, 1)                as dias_total,
  round((sum(c.dias) / count(distinct c.id))::numeric, 1) as dias_por_processo,
  f.fiscais_na_unidade
from contadas c
join fiscais_por_unidade f on f.capacity = c.capacity
-- agrupa por matrícula: homônimos não se juntam, e o nome de quem não está cadastrado não
-- parte um fiscal em dois
group by c.fiscal_matricula, c.gerencia, c.capacity, f.sigla, c.unidade_lotacao,
         f.fiscais_na_unidade
having sum(c.dias) >= 1
order by min(c.fiscal), c.fiscal_matricula, sum(c.dias) desc;
