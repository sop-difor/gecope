-- ============================================================================
-- LISTA (somente leitura) — processos por trás das lotações extras candidatas que
-- aparecem em UM processo só (dois, no caso da GEROA de um fiscal)
--
-- diagnostico-unidades-por-fiscal.sql (resultado 02, 2026-09-16) mostrou fiscais com
-- dias somados numa unidade que não é a sua lotação, mas num único processo. Pode ser
-- lotação extra de verdade, caso isolado ou troca de fiscal (o processo correu com outro
-- fiscal, de outra unidade, e foi reatribuído). Esta lista traz esses processos para a
-- decisão do usuário. As lotações extras já confirmadas (DIAES, DIRED) não estão aqui.
--
-- Pares fiscal × unidade avaliados (matrícula → unidade candidata):
--   DIAES 8245      30002695, 30002504
--   GEROA 8254      01001612, 70020416, 70013118, 70019213
--   GEDOP-IGT 8263  30002261
--   GEDOP-SOB 8261  30000811
--   GEDOP-ITC 8257  70018519, 01013017
--   DIRER 8240      30000579
--
-- Colunas de apoio:
--   dias_na_unidade_candidata  tempo do processo na unidade candidata antes da ida à GECOPE
--                              que resultou na aprovação (ou até hoje, se em tramitação)
--   dias_na_lotacao            tempo do mesmo processo na lotação do fiscal, mesmo recorte
--   trajeto                    todas as passagens do processo no mesmo recorte, em ordem,
--                              com a GECOPE marcada — mostra se a unidade candidata veio
--                              antes da lotação (troca de fiscal?) ou no meio da rota
--   atribuicoes_fiscal         linhas de historico_atribuicao_fiscal do processo, inteiras
--                              (mais de uma = houve troca de fiscal registrada; a
--                              atribuição anterior a 2026-09-11 é sintética)
--   lotados_na_unidade         outros usuários com a unidade candidata como lotação
--                              (app_users) ou lotação extra cadastrada — possível fiscal
--                              anterior do processo. Vazio em DIAES/DIRER para quem não tem
--                              extra cadastrada: essas diretorias não estão no de-para.
--
-- Rodar DEPOIS de sql/create_vw_tempo_fiscal_processo.sql (usa suite_unidades_lotacao e
-- suite_unidades_fiscal). Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with candidatos (fiscal_matricula, capacity) as (
  values ('30002695', 8245), ('30002504', 8245),
         ('01001612', 8254), ('70020416', 8254), ('70013118', 8254), ('70019213', 8254),
         ('30002261', 8263),
         ('30000811', 8261),
         ('70018519', 8257), ('01013017', 8257),
         ('30000579', 8240)
),
proc as (
  select p.id, p.processo as nup, p.status, p.data_aprovacao_gecope, p.fiscal_matricula,
         p.municipio, p.distrito_operacional,
         coalesce(nullif(trim(u.full_name), ''), nullif(trim(p.fiscal), ''), '(sem fiscal)') as fiscal,
         u.gerencia, m.capacity as unidade_lotacao,
         upper(trim(coalesce(p.status, ''))) in ('APROVADO', 'ARQUIVADO')
           and p.data_aprovacao_gecope is not null                            as despachado,
         ((p.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza') as fim_dia_aprovacao
  from public.processos p
  left join lateral (
    select au.full_name, au.gerencia from public.app_users au
    where au.matricula = p.fiscal_matricula order by au.id limit 1
  ) u on true
  left join public.suite_unidades_lotacao m
    on m.unidade = upper(trim(regexp_replace(u.gerencia, '^.*/', '')))
  where p.excluido_por is null
    and p.fiscal_matricula in (select fiscal_matricula from candidatos)
    -- arquivado no meio do trâmite e APROVADO sem data não têm tempo (mesma regra da view)
    and not (upper(trim(coalesce(p.status, ''))) in ('ARQUIVADO', 'APROVADO')
             and p.data_aprovacao_gecope is null)
),
ev as (
  select h.processo_id, h.capacity, h.data_evento, h.unidade_sigla,
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
siglas as (
  -- unidade_sigla às vezes traz o nome do evento; a sigla é a mais frequente por capacity,
  -- lida em todo o histórico
  select capacity, mode() within group (order by unidade_sigla) as sigla
  from public.historico_suite_eventos
  where capacity is not null
    and unidade_sigla ~ '^[A-Z][A-Z0-9-]*[A-Z0-9]$'
    and unidade_sigla not in ('ARQUIVADO', 'PROTOCOLO')
  group by capacity
),
corte as (
  -- mesma regra da view: última ida à GECOPE até o dia da aprovação; DIFOR se não houve
  select pr.id,
         coalesce(max(pa.entrada) filter (where pa.capacity = 10442),
                  max(pa.entrada) filter (where pa.capacity = 8244)) as corte
  from proc pr
  join passagens pa on pa.processo_id = pr.id and pa.capacity in (10442, 8244)
  where pr.despachado and pa.entrada < pr.fim_dia_aprovacao
  group by pr.id
),
contadas as (
  select pr.id, pa.passagem, pa.capacity, pa.entrada,
         extract(epoch from (coalesce(pa.saida, now()) - pa.entrada)) / 86400.0 as dias
  from proc pr
  join passagens pa on pa.processo_id = pr.id
  left join corte k on k.id = pr.id
  where not pr.despachado or (k.corte is not null and pa.entrada < k.corte)
),
alvo as (
  -- processo do fiscal que passou pela unidade candidata dele no recorte
  select distinct pr.id, c.capacity as unidade_candidata
  from proc pr
  join candidatos c on c.fiscal_matricula = pr.fiscal_matricula
  join contadas ct on ct.id = pr.id and ct.capacity = c.capacity
)
select
  pr.fiscal,
  pr.fiscal_matricula,
  pr.gerencia                                                              as lotacao_app_users,
  s.sigla                                                                  as unidade_candidata,
  a.unidade_candidata                                                      as capacity_candidata,
  pr.nup,
  pr.status,
  to_char(pr.data_aprovacao_gecope, 'DD/MM/YYYY')                          as data_aprovacao,
  pr.municipio,
  pr.distrito_operacional,
  (select round(sum(ct.dias)::numeric, 1) from contadas ct
    where ct.id = pr.id and ct.capacity = a.unidade_candidata)            as dias_na_unidade_candidata,
  (select round(sum(ct.dias)::numeric, 1) from contadas ct
    where ct.id = pr.id and ct.capacity = pr.unidade_lotacao)             as dias_na_lotacao,
  (select string_agg(
            coalesce(sg.sigla, ct.capacity::text) || ' ' ||
            to_char(ct.entrada at time zone 'America/Fortaleza', 'DD/MM/YY') || ' ' ||
            replace(round(ct.dias::numeric, 1)::text, '.', ',') || ' d',
            ' → ' order by ct.passagem)
     from contadas ct left join siglas sg on sg.capacity = ct.capacity
    where ct.id = pr.id)                                                   as trajeto,
  (select jsonb_agg(to_jsonb(af) order by to_jsonb(af)::text)
     from public.historico_atribuicao_fiscal af
    where to_jsonb(af) ->> 'processo_id' = pr.id::text)                   as atribuicoes_fiscal,
  (select string_agg(distinct au.full_name, '; ')
     from public.app_users au
    where au.matricula is distinct from pr.fiscal_matricula
      and (exists (select 1 from public.suite_unidades_lotacao lu
                    where lu.capacity = a.unidade_candidata
                      and lu.unidade = upper(trim(regexp_replace(au.gerencia, '^.*/', ''))))
        or exists (select 1 from public.suite_unidades_fiscal e
                    where e.capacity = a.unidade_candidata
                      and e.fiscal_matricula = au.matricula)))              as lotados_na_unidade
from alvo a
join proc pr on pr.id = a.id
left join siglas s on s.capacity = a.unidade_candidata
order by pr.fiscal, s.sigla, pr.nup;
