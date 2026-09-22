-- ============================================================================
-- verificar_backfill_historico_suite.sql — SOMENTE LEITURA. Não altera nada.
--
-- Objetivo: provar (ou desmentir) que a Edge Function `backfill-historico-suite`
-- pode ser removida do servidor, porque a `sincronizar-suite` já cobre o que ela fazia.
--
-- Contexto (revisão 22/09/2026): a `sincronizar-suite` publicada pede ao SUITE o histórico
-- COMPLETO de cada processo a cada rodada e insere todo evento que ainda não exista,
-- deduplicando por `chave_evento`. A `backfill-historico-suite` fazia o mesmo para UM NUP
-- passado no corpo da requisição. As duas calculam `chave_evento` de forma idêntica
-- (mesmos campos, mesma ordem, SHA-256), então nunca duplicaram nada entre si.
--
-- COMO LER O RESULTADO: rode os quatro blocos na ordem. O bloco [2] é o veredito.
--   - [2] retornou 0 linhas  -> nenhum processo sincronizado está sem histórico.
--                               A sincronizar-suite dá conta. Pode remover o backfill.
--   - [2] retornou N linhas  -> existem processos sincronizados sem histórico. PARE e me
--                               mande o resultado antes de remover qualquer coisa.
-- ============================================================================


-- [1] PANORAMA — quantos processos existem, quantos já foram vistos pelo SUITE e
--     quantos já têm histórico gravado. Serve para dar contexto ao bloco [2].
select
  count(*)                                                          as processos_total,
  count(*) filter (where p.suite is not null and p.suite <> 'N/D')  as ja_sincronizados,
  count(*) filter (where h.processo_id is not null)                 as com_historico,
  count(*) filter (where p.suite is null or p.suite = 'N/D')        as nunca_sincronizados
from public.processos p
left join lateral (
  select 1 as processo_id
  from public.historico_suite_eventos h
  where h.processo_id = p.id
  limit 1
) h on true;


-- [2] O VEREDITO — processos que o SUITE JÁ respondeu com sucesso (têm sigla e data de
--     chegada preenchidas pela sincronizar-suite) mas que NÃO têm nenhum evento gravado
--     em historico_suite_eventos.
--
--     Esses seriam, em tese, os casos que só o backfill manual resolveria.
--     O esperado é ZERO linhas.
select
  p.id,
  p.processo                       as nup,
  p.status,
  p.suite                          as unidade_suite,
  p.suite_data_chegada,
  p.created_at
from public.processos p
where p.suite is not null
  and p.suite <> 'N/D'
  and p.suite_data_chegada is not null
  and not exists (
    select 1
    from public.historico_suite_eventos h
    where h.processo_id = p.id
  )
order by p.created_at desc;


-- [3] CONTROLE — processos que o SUITE nunca respondeu. Eles também não têm histórico,
--     mas o backfill TAMBÉM não resolveria: ele consulta o mesmo endpoint do SUITE e
--     falharia igual. Estão aqui só para você não confundir com o bloco [2].
select
  count(*) as nunca_encontrados_no_suite
from public.processos p
where (p.suite is null or p.suite = 'N/D')
  and not exists (
    select 1
    from public.historico_suite_eventos h
    where h.processo_id = p.id
  );


-- [4] SANIDADE — confirma que não há evento duplicado, ou seja, que as duas funções
--     realmente compartilhavam a mesma chave. Esperado: ZERO linhas.
select
  h.processo_id,
  h.chave_evento,
  count(*) as repeticoes
from public.historico_suite_eventos h
group by h.processo_id, h.chave_evento
having count(*) > 1
order by count(*) desc
limit 50;
