-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — lotação do fiscal × unidade (`capacity`) no histórico
--
-- Decisão A (2026-09-16): unidade do fiscal = gerência de LOTAÇÃO. As funções atuais já fazem
-- isso por texto: último trecho de processos.sigla_suite (preenchida pelo trigger
-- trg_definir_sigla_suite a partir de app_users) comparado com historico_suite_eventos
-- .unidade_sigla. Esta consulta mostra, por lotação:
--
--   · qual `capacity` corresponde a essa sigla (se aparecer mais de um, o texto é ambíguo);
--   · quantos processos passam pela unidade, quantos têm histórico sem nunca passar por ela
--     (tempo_suite sai zero) e quantos não têm histórico nenhum.
--
-- Só processos não excluídos. Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
with pf as (
  select p.id,
         coalesce(nullif(trim(u.gerencia), ''), '(vazio)') as gerencia,
         coalesce(p.sigla_suite, '(nula)')                 as sigla_suite,
         upper(trim(regexp_replace(coalesce(p.sigla_suite, ''), '^.*/', ''))) as unidade
  from public.processos p
  left join lateral (
    select au.gerencia
    from public.app_users au
    where au.matricula = p.fiscal_matricula
    order by au.id limit 1
  ) u on true
  where p.excluido_por is null
),
cap as (
  select pf.id, h.capacity, count(*) as eventos
  from pf
  join public.historico_suite_eventos h
    on h.processo_id = pf.id
   and upper(trim(h.unidade_sigla)) = pf.unidade
  group by pf.id, h.capacity
),
com_historico as (
  select distinct processo_id from public.historico_suite_eventos
)
select pf.gerencia,
       pf.sigla_suite,
       case
         when ch.processo_id is null then '3 sem histórico'
         when cap.id is null         then '2 histórico sem passar pela unidade'
         else                             '1 passa pela unidade'
       end                        as situacao,
       cap.capacity,
       count(distinct pf.id)      as processos,
       coalesce(sum(cap.eventos), 0) as eventos_na_unidade
from pf
left join cap on cap.id = pf.id
left join com_historico ch on ch.processo_id = pf.id
group by 1, 2, 3, 4
order by 1, 3, 4;
