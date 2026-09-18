-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — por que o tempo médio quase não muda entre períodos
--
-- Pergunta do usuário (2026-09-16): ao trocar Hoje / 2 anos / 1 ano / 6 meses, vários
-- distritos mantêm praticamente o mesmo tempo médio. Isso é real ou é defeito?
--
-- Duas hipóteses, uma consulta para cada:
--   1. As janelas se sobrepõem quase inteiras: se a maior parte dos despachos é recente,
--      "1 ano", "2 anos" e "Hoje" (histórico inteiro) são quase o mesmo conjunto.
--   2. A DATA DE DESPACHO está concentrada artificialmente: ela é
--      coalesce(data_aprovacao_gecope, ultima_atualizacao::date), a mesma da view. Se
--      muitos despachados não têm data_aprovacao_gecope e a ultima_atualizacao deles foi
--      gravada em lote (importação, sincronização com o SUITE), os despachos antigos
--      aparecem com data recente e caem em todas as janelas.
--
-- Mesmas regras do painel: excluido_por is null; despachado = APROVADO ou ARQUIVADO;
-- tempo = tempo_suite (dias); distrito do fiscal = app_users.gedop, FORTALEZA → RM
-- FORTALEZA; janela = data de despacho >= hoje menos N meses.
--
-- O SQL Editor mostra só o resultado da ÚLTIMA consulta: selecione a consulta 1 inteira
-- e execute; depois a 2. Cada uma é autônoma. Não altera nada no banco.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONSULTA 1 — por distrito (régua "Fiscal"): despachos e tempo médio em cada janela,
-- e de onde veio a data de despacho.
-- ---------------------------------------------------------------------------
with d as (
  select
    pr.tempo_suite,
    coalesce(pr.data_aprovacao_gecope, pr.ultima_atualizacao::date) as data_despacho,
    (pr.data_aprovacao_gecope is not null)                            as data_da_aprovacao,
    coalesce(nullif(case
      when upper(trim(u.gedop)) = 'FORTALEZA' then 'RM FORTALEZA'
      else upper(trim(u.gedop)) end, ''), '(sem lotação)')            as distrito
  from public.processos pr
  left join lateral (
    select au.gedop from public.app_users au
    where au.matricula = pr.fiscal_matricula
    order by au.id limit 1
  ) u on true
  where pr.excluido_por is null
    and upper(trim(coalesce(pr.status, ''))) in ('APROVADO', 'ARQUIVADO')
),
j as (
  select d.*,
    data_despacho >= (current_date - interval '6 months')::date  as em_6m,
    data_despacho >= (current_date - interval '12 months')::date as em_12m,
    data_despacho >= (current_date - interval '24 months')::date as em_24m
  from d
),
agg as (
  select distrito,
    count(*) filter (where em_6m)                                        as n_6m,
    round(avg(tempo_suite) filter (where em_6m), 1)                      as tempo_6m,
    count(*) filter (where em_12m)                                       as n_12m,
    round(avg(tempo_suite) filter (where em_12m), 1)                     as tempo_12m,
    count(*) filter (where em_24m)                                       as n_24m,
    round(avg(tempo_suite) filter (where em_24m), 1)                     as tempo_24m,
    count(*)                                                             as n_hoje,
    round(avg(tempo_suite), 1)                                           as tempo_hoje,
    round(100.0 * count(*) filter (where em_12m) / nullif(count(*), 0))  as pct_hist_em_12m,
    round(100.0 * count(*) filter (where data_da_aprovacao) / nullif(count(*), 0)) as pct_data_aprovacao,
    min(data_despacho)                                                   as despacho_mais_antigo,
    count(*) filter (where data_despacho is null)                        as sem_data
  from j
  group by grouping sets ((distrito), ())
)
select coalesce(distrito, 'TOTAL') as distrito, n_6m, tempo_6m, n_12m, tempo_12m, n_24m, tempo_24m,
       n_hoje, tempo_hoje, pct_hist_em_12m, pct_data_aprovacao, despacho_mais_antigo, sem_data
from agg
order by (distrito is null), distrito;


-- ---------------------------------------------------------------------------
-- CONSULTA 2 — despachos por mês e origem da data. Um mês com um pico de despachos
-- vindos de ultima_atualizacao (e não de data_aprovacao_gecope) é sinal de data gravada
-- em lote, não de despacho real naquele mês.
-- ---------------------------------------------------------------------------
select
  to_char(date_trunc('month', coalesce(pr.data_aprovacao_gecope, pr.ultima_atualizacao::date)), 'YYYY-MM') as mes,
  count(*)                                                        as despachos,
  count(*) filter (where pr.data_aprovacao_gecope is not null)    as data_da_aprovacao,
  count(*) filter (where pr.data_aprovacao_gecope is null)        as data_da_ultima_atualizacao,
  count(*) filter (where upper(trim(pr.status)) = 'ARQUIVADO')    as arquivados,
  round(avg(pr.tempo_suite), 1)                                   as tempo_medio
from public.processos pr
where pr.excluido_por is null
  and upper(trim(coalesce(pr.status, ''))) in ('APROVADO', 'ARQUIVADO')
group by 1
order by 1;
