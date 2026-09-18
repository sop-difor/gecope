-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — passagens dos casos estranhos da conferência
--
-- resultado 09.csv (2026-09-16) trouxe três padrões que só se entendem olhando o trâmite:
--   · despachados cujo tempo novo ficou perto de zero (57 de 273 com menos de 1 dia);
--   · despachados com data de aprovação que não bate com as idas à GECOPE;
--   · despachados que nunca passaram pela unidade de lotação do fiscal.
-- Mostra as passagens por unidade de 9 processos-exemplo. Compare a coluna capacity com
-- suite_unidades_lotacao (8261 = GEDOP-SOB, 8259 = SQT, 8264 = CRT, 8267 = GEFOE,
-- 8272 = GEROE, 8258 = LNO; 10442 = GECOPE).
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with alvo as (
  select p.id, p.processo as nup, p.sigla_suite, p.data_aprovacao_gecope, p.tempo_suite,
         upper(trim(regexp_replace(coalesce(p.sigla_suite, ''), '^.*/', ''))) as unidade_fiscal
  from public.processos p
  where p.excluido_por is null
    and p.processo in (
      -- tempo caiu para ~0 sem conferência (resultado 09)
      '43022.000469/2025-60', '43022.002139/2025-17', '43022.012666/2025-21',
      '43022.008426/2025-22',
      -- "voltou à unidade do fiscal entre a GECOPE e a aprovação"
      '43022.001080/2025-31',
      -- "sem ida à GECOPE até a data de aprovação" (data de aprovação anterior ao processo?)
      '22001.099992/2026-94', '43022.011330/2025-41',
      -- "não passou pela unidade do fiscal antes da GECOPE"
      '43022.009054/2025-51', '22001.000499/2026-25'
    )
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
       capacity = 10442                                                          as na_gecope,
       (entrada at time zone 'America/Fortaleza')::date <= data_aprovacao_gecope::date as antes_da_aprovacao,
       sigla_suite,
       data_aprovacao_gecope,
       tempo_suite_atual
from passagens
order by nup, processo_id, passagem;
