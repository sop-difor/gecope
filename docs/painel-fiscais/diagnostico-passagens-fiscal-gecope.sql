-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — passagens dos processos de fiscal LOTADO NA GECOPE
--
-- sql/create_vw_tempo_fiscal_processo.sql mapeia a lotação GECOPE para a GEFOE (8267):
-- a 10442 é a própria GECOPE e somaria o tempo de análise. Isso foi visto em UM processo
-- (22001.034103/2026-43, 46,6 dias na GEFOE). Esta consulta mostra as passagens de TODOS
-- os processos desses fiscais, para confirmar que a fiscalização correu na GEFOE — e não
-- num distrito, com a GEFOE só de passagem (o que daria tempo quase zero sem aviso).
--
-- Mesmas colunas de diagnostico-passagens-caso-referencia.sql, com "na_gefoe" (8267) e
-- "na_gecope" (10442) no lugar de "unidade_do_fiscal". Passagens agrupadas por processo_id e
-- eventos sem capacity ignorados — a mesma leitura de vw_tempo_fiscal_processo.
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with alvo as (
  select p.id, p.processo as nup, p.sigla_suite, p.data_aprovacao_gecope, p.tempo_suite,
         upper(trim(regexp_replace(coalesce(p.sigla_suite, ''), '^.*/', ''))) as unidade_fiscal
  from public.processos p
  where p.excluido_por is null
    and exists (select 1 from public.app_users au
                 where au.matricula = p.fiscal_matricula
                   and upper(trim(regexp_replace(au.gerencia, '^.*/', ''))) = 'GECOPE')
),
ev as (
  select a.id as processo_id, a.nup, a.sigla_suite, a.data_aprovacao_gecope, a.tempo_suite, a.unidade_fiscal,
         h.capacity, upper(trim(h.unidade_sigla)) as unidade_sigla, h.data_evento,
         lag(h.capacity) over w  as capacity_anterior,
         lead(h.data_evento) over w as proxima_data,
         row_number() over w as seq
  from alvo a
  join public.historico_suite_eventos h on h.processo_id = a.id
  where h.data_evento is not null
    and h.capacity is not null   -- mesma regra da view
  window w as (partition by h.processo_id order by h.data_evento, h.ordem_evento desc, h.id)
),
marcado as (
  select *,
         sum(case when capacity_anterior is distinct from capacity then 1 else 0 end)
           over (partition by processo_id order by seq) as passagem
  from ev
),
passagens as (
  select processo_id, nup, passagem,
         min(sigla_suite) as sigla_suite, min(data_aprovacao_gecope) as data_aprovacao_gecope,
         min(tempo_suite) as tempo_suite_atual, min(unidade_fiscal) as unidade_fiscal,
         min(capacity) as capacity, min(unidade_sigla) as unidade_sigla,
         count(*) as eventos,
         min(data_evento) as entrada,
         case when bool_or(proxima_data is null) then null else max(proxima_data) end as saida
  from marcado
  group by processo_id, nup, passagem
)
select nup,
       passagem,
       capacity,
       unidade_sigla,
       eventos,
       to_char(entrada at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') as entrada,
       coalesce(to_char(saida at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'), '(em aberto)') as saida,
       round(extract(epoch from (coalesce(saida, now()) - entrada)) / 86400.0, 2) as dias,
       capacity = 8267                                                           as na_gefoe,
       capacity = 10442                                                          as na_gecope,
       (entrada at time zone 'America/Fortaleza')::date <= data_aprovacao_gecope::date as antes_da_aprovacao,
       sigla_suite,
       data_aprovacao_gecope,
       tempo_suite_atual
from passagens
order by nup, processo_id, passagem;
