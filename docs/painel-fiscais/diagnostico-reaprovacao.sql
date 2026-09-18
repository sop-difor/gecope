-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — processo que voltou ao fiscal e à GECOPE DEPOIS da data
-- de aprovação gravada
--
-- vw_tempo_fiscal_processo corta o tempo na ida à GECOPE que antecede data_aprovacao_gecope.
-- Se um processo aprovado é reaberto (diligência, devolução), volta ao fiscal, vai de novo
-- à GECOPE e é reaprovado SEM atualizar a data, o corte fica no ciclo antigo: a passagem
-- nova do fiscal some do tempo e o despacho fica na data velha — em silêncio.
--
-- Sinal no histórico: depois do dia da aprovação, uma passagem na unidade do fiscal seguida
-- de uma passagem na GECOPE. Retorno para assinatura, que não passa de novo pela GECOPE,
-- não entra. Uma linha por despachado com esse sinal.
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with proc as (
  select p.id, p.processo as nup, p.status, p.data_aprovacao_gecope,
         m.capacity as unidade_capacity, u.gerencia
  from public.processos p
  left join lateral (
    select au.gerencia from public.app_users au
    where au.matricula = p.fiscal_matricula order by au.id limit 1
  ) u on true
  left join public.suite_unidades_lotacao m
    on m.unidade = upper(trim(regexp_replace(u.gerencia, '^.*/', '')))
  where p.excluido_por is null
    and upper(trim(coalesce(p.status, ''))) in ('APROVADO', 'ARQUIVADO')
    and p.data_aprovacao_gecope is not null
),
ev as (
  select h.processo_id, h.capacity, h.data_evento,
         lag(h.capacity)     over w as capacity_anterior,
         lead(h.data_evento) over w as proxima_data,
         row_number()        over w as seq
  from public.historico_suite_eventos h
  where h.data_evento is not null and h.capacity is not null
    and h.processo_id in (select id from proc)
  window w as (partition by h.processo_id order by h.data_evento, h.ordem_evento desc, h.id)
),
marcado as (
  select ev.*, sum(case when capacity_anterior is distinct from capacity then 1 else 0 end)
                 over (partition by processo_id order by seq) as passagem
  from ev
),
passagens as (
  select processo_id, passagem, min(capacity) as capacity, min(data_evento) as entrada,
         case when bool_or(proxima_data is null) then null else max(proxima_data) end as saida
  from marcado group by processo_id, passagem
),
depois as (
  -- passagens que começaram depois do fim do dia da aprovação
  select pr.id, pr.nup, pr.status, pr.gerencia, pr.data_aprovacao_gecope, pa.passagem,
         pa.capacity = pr.unidade_capacity as no_fiscal,
         pa.capacity = 10442               as na_gecope,
         pa.entrada, pa.saida
  from proc pr
  join passagens pa on pa.processo_id = pr.id
  where pa.entrada >= ((pr.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza')
),
sinal as (
  -- exists, não join: com duas idas à GECOPE depois, um join duplicaria os dias no fiscal.
  select f.id,
         min(f.entrada)                                                             as fiscal_entrada,
         sum(extract(epoch from (coalesce(f.saida, now()) - f.entrada))) / 86400.0  as dias_fiscal_depois,
         (select min(g.entrada) from depois g
           where g.id = f.id and g.na_gecope and g.passagem > min(f.passagem))      as gecope_entrada
  from depois f
  where f.no_fiscal
    and exists (select 1 from depois g
                 where g.id = f.id and g.na_gecope and g.passagem > f.passagem)
  group by f.id
)
select d.nup, d.status, d.gerencia, d.data_aprovacao_gecope,
       to_char(s.fiscal_entrada at time zone 'America/Fortaleza', 'DD/MM/YYYY') as voltou_ao_fiscal_em,
       round(s.dias_fiscal_depois::numeric, 2)                                  as dias_no_fiscal_depois,
       to_char(s.gecope_entrada at time zone 'America/Fortaleza', 'DD/MM/YYYY') as voltou_a_gecope_em
from sinal s
join (select distinct id, nup, status, gerencia, data_aprovacao_gecope from depois) d on d.id = s.id
order by s.dias_fiscal_depois desc;
