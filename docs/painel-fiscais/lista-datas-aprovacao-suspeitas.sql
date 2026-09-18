-- ============================================================================
-- LISTA (somente leitura) — datas de aprovação na GECOPE provavelmente erradas, para
-- correção à mão
--
-- vw_tempo_fiscal_processo corta o tempo do fiscal na ida à GECOPE que antecede
-- data_aprovacao_gecope (ou na DIFOR, quando não houve ida à GECOPE). Data errada = tempo e despacho errados. Esta lista confronta a data
-- gravada com as passagens do processo pela GECOPE (10442) no histórico do SUITE.
--
-- Motivos (um processo pode ter mais de um):
--   A  data anterior à abertura do processo no SUITE
--   B  nenhuma ida à GECOPE nem à DIFOR até a data (ex.: 22001.099992/2026-94, aprovado
--      "05/08/2025", só foi à GECOPE em 2026). Sem GECOPE mas com DIFOR não é suspeito — a
--      GECOPE fica dentro da DIFOR e a view corta nela (usuário, 2026-09-16) —, SALVO se o
--      processo foi à GECOPE depois da data: aí a DIFOR é só rota e a data provavelmente
--      está errada.
--   C  data mais de 15 dias depois da saída da GECOPE que a antecede (a aprovação costuma
--      sair no dia da saída ou poucos dias depois — ex.: 43022.001080/2025-31, GECOPE em
--      10/02/2025 e aprovação gravada em 20/10/2025)
--
-- O antigo motivo D (voltou ao fiscal e à GECOPE depois da data) saiu da lista: o usuário
-- decidiu em 2026-09-16 que o retorno depois da aprovação é exceção, fica fora de todo
-- cálculo e não indica data errada.
--
-- Rodar DEPOIS de sql/create_vw_tempo_fiscal_processo.sql (usa suite_unidades_lotacao).
--
-- Colunas de apoio:
--   idas_gecope          todas as passagens pela GECOPE, "entrada → saída"
--   sugestao_ano_seguinte a mesma data com o ano +1, quando ela cai numa passagem pela
--                        GECOPE (ou até 5 dias depois da saída) — erro de digitação do ano
--   saida_gecope_antes / saida_gecope_depois  as saídas da GECOPE vizinhas à data gravada
--
-- Só APROVADO/ARQUIVADO com data preenchida; excluídos fora. Confira no SUITE antes de
-- corrigir. Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with proc as (
  select p.id, p.processo as nup, p.status, p.data_aprovacao_gecope,
         coalesce(nullif(trim(u.full_name), ''), nullif(trim(p.fiscal), ''), '(sem fiscal)') as fiscal,
         p.fiscal_matricula, u.gerencia, m.capacity as unidade_lotacao,
         ((p.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza') as fim_dia_aprovacao
  from public.processos p
  left join lateral (
    select au.full_name, au.gerencia from public.app_users au
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
por_processo as (
  select
    pr.id,
    min(pa.entrada)                                                           as abertura,
    string_agg(
      to_char(pa.entrada at time zone 'America/Fortaleza', 'DD/MM/YYYY') || ' → ' ||
      coalesce(to_char(pa.saida at time zone 'America/Fortaleza', 'DD/MM/YYYY'), 'em aberto'),
      '; ' order by pa.passagem) filter (where pa.capacity = 10442)           as idas_gecope,
    bool_or(pa.capacity = 10442 and pa.entrada < pr.fim_dia_aprovacao)        as tem_gecope_antes,
    bool_or(pa.capacity = 8244  and pa.entrada < pr.fim_dia_aprovacao)        as tem_difor_antes,
    bool_or(pa.capacity = 10442 and pa.entrada >= pr.fim_dia_aprovacao)       as tem_gecope_depois,
    max(coalesce(pa.saida, now())) filter (where pa.capacity = 10442
                                             and pa.entrada < pr.fim_dia_aprovacao) as saida_gecope_antes,
    min(pa.saida) filter (where pa.capacity = 10442
                            and pa.saida >= pr.fim_dia_aprovacao)             as saida_gecope_depois,
    -- ano seguinte: a data +1 ano cai dentro de uma passagem pela GECOPE ou até 5 dias depois
    bool_or(pa.capacity = 10442
            and ((pr.data_aprovacao_gecope + interval '1 year')::date + 1)::timestamp
                  at time zone 'America/Fortaleza' > pa.entrada
            and (pr.data_aprovacao_gecope + interval '1 year')::date
                  <= (coalesce(pa.saida, now()) at time zone 'America/Fortaleza')::date + 5)
                                                                              as ano_seguinte_bate
  from proc pr
  -- left join: processo sem histórico no SUITE aparece (motivo B), não some da lista.
  left join passagens pa on pa.processo_id = pr.id
  group by pr.id
),
avaliado as (
  select
    pr.*, pp.abertura, pp.idas_gecope, pp.saida_gecope_antes, pp.saida_gecope_depois,
    pp.ano_seguinte_bate,
    array_remove(array[
      case when pr.fim_dia_aprovacao <= pp.abertura then 'A data anterior à abertura do processo' end,
      case when not coalesce(pp.tem_gecope_antes, false)
            and (not coalesce(pp.tem_difor_antes, false) or coalesce(pp.tem_gecope_depois, false))
           then 'B nenhuma ida à GECOPE até a data (nem à DIFOR, ou GECOPE só depois)' end,
      case when pp.tem_gecope_antes
            and pr.data_aprovacao_gecope
                > (pp.saida_gecope_antes at time zone 'America/Fortaleza')::date + 15
           then 'C mais de 15 dias depois da saída da GECOPE' end
    ], null) as motivos
  from proc pr
  join por_processo pp on pp.id = pr.id
)
select
  array_to_string(motivos, ' · ')                                            as motivos,
  nup,
  status,
  fiscal,
  gerencia,
  to_char(data_aprovacao_gecope, 'DD/MM/YYYY')                                as data_aprovacao_atual,
  case when ano_seguinte_bate
       then to_char((data_aprovacao_gecope + interval '1 year')::date, 'DD/MM/YYYY') end
                                                                              as sugestao_ano_seguinte,
  to_char(saida_gecope_antes at time zone 'America/Fortaleza', 'DD/MM/YYYY')  as saida_gecope_antes,
  to_char(saida_gecope_depois at time zone 'America/Fortaleza', 'DD/MM/YYYY') as saida_gecope_depois,
  idas_gecope,
  to_char(abertura at time zone 'America/Fortaleza', 'DD/MM/YYYY')            as aberto_no_suite_em
from avaliado
where cardinality(motivos) > 0
order by motivos[1], nup;
