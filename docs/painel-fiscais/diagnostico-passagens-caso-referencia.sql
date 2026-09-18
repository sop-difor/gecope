-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — passagens por unidade, lidas de historico_suite_eventos
--
-- Resultado 04 (2026-09-16): o histórico do SUITE já está no banco (24.644 eventos, com
-- `capacity`). Esta consulta agrupa eventos seguidos da mesma unidade em PASSAGENS e confere,
-- sem tocar no SUITE, se a regra do usuário sai da tabela existente:
--
--   · 22001.146169/2025-02 (caso de referência, GEDOP-LNO) deve dar duas passagens na
--     unidade do fiscal, 100,22 + 17,91 = 118,13 dias, última saída em 13/03/2026;
--   · 22001.034103/2026-43 — fiscal lotado na GECOPE;
--   · 43022.009563/2026-65 — fiscal lotado na DIFOR;
--   · 22001.089693/2026-41 — fiscal lotado na GERED.
--
-- "unidade_do_fiscal" usa a mesma leitura das funções atuais: último trecho de
-- processos.sigla_suite comparado com unidade_sigla. "antes_da_aprovacao" compara a entrada
-- (dia em America/Fortaleza) com data_aprovacao_gecope.
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with alvo as (
  select p.id, p.processo as nup, p.sigla_suite, p.data_aprovacao_gecope, p.tempo_suite,
         upper(trim(regexp_replace(coalesce(p.sigla_suite, ''), '^.*/', ''))) as unidade_fiscal
  from public.processos p
  where p.processo in ('22001.146169/2025-02', '22001.034103/2026-43',
                       '43022.009563/2026-65', '22001.089693/2026-41')
),
ev as (
  select a.nup, a.sigla_suite, a.data_aprovacao_gecope, a.tempo_suite, a.unidade_fiscal,
         h.capacity, upper(trim(h.unidade_sigla)) as unidade_sigla, h.data_evento,
         lag(h.capacity) over w  as capacity_anterior,
         lead(h.data_evento) over w as proxima_data,
         row_number() over w as seq
  from alvo a
  join public.historico_suite_eventos h on h.processo_id = a.id
  where h.data_evento is not null
  window w as (partition by h.processo_id order by h.data_evento, h.ordem_evento desc, h.id)
),
marcado as (
  select *,
         sum(case when capacity_anterior is distinct from capacity then 1 else 0 end)
           over (partition by nup order by seq) as passagem
  from ev
),
passagens as (
  select nup, passagem,
         min(sigla_suite) as sigla_suite, min(data_aprovacao_gecope) as data_aprovacao_gecope,
         min(tempo_suite) as tempo_suite_atual, min(unidade_fiscal) as unidade_fiscal,
         min(capacity) as capacity, min(unidade_sigla) as unidade_sigla,
         count(*) as eventos,
         min(data_evento) as entrada,
         case when bool_or(proxima_data is null) then null else max(proxima_data) end as saida
  from marcado
  group by nup, passagem
)
select nup,
       passagem,
       capacity,
       unidade_sigla,
       eventos,
       to_char(entrada at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') as entrada,
       coalesce(to_char(saida at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'), '(em aberto)') as saida,
       round(extract(epoch from (coalesce(saida, now()) - entrada)) / 86400.0, 2) as dias,
       unidade_sigla = unidade_fiscal                                            as unidade_do_fiscal,
       (entrada at time zone 'America/Fortaleza')::date <= data_aprovacao_gecope::date as antes_da_aprovacao,
       sigla_suite,
       data_aprovacao_gecope,
       tempo_suite_atual
from passagens
order by nup, passagem;
