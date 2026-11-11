-- Consulta (somente leitura) — 11/11/2026
-- Lista os processos em AGUAR. APROVAÇÃO e o que falta para cumprirem os requisitos de
-- aprovação da tela Gerenciar processo (executarAcaoDetalhes em modules/processos/processos.js).
-- Serve para achar os que a sincronizar-suite pode promover a APROVADO sem eles terem
-- passado pelas regras. Primeira execução (11/11/2026): nenhum processo em AGUAR. APROVAÇÃO.
with alvo as (
  select p.id, p.processo, p.analista, p.data_aprovacao_gecope,
         p.acresc_gecope, p.supress_gecope, p.data_devolucao_correcoes, p.apensado_a, p.suite
  from processos p
  where p.status = 'AGUAR. APROVAÇÃO'
),
chk as (
  select processo_id::text as pid, max(created_at) as ultimo
  from checklist_documentacao_aditivo group by processo_id
),
cv as (
  select distinct on (processo_id) processo_id::text as pid, id as versao_id, versao
  from curva_abc_versoes order by processo_id, versao desc
),
pend as (
  select versao_id,
         count(*) filter (where classe = 'A' and status_analise = 'pendente') as pend_a,
         count(*) filter (where classe = 'A') as total_a
  from curva_abc_itens group by versao_id
)
select a.processo, a.suite, (a.apensado_a is not null) as apenso,
  (a.data_aprovacao_gecope is null)                          as falta_data,
  (coalesce(trim(a.analista), '') = '')                      as falta_analista,
  (a.acresc_gecope is null or a.supress_gecope is null)      as falta_valores,
  (c.ultimo is null or (a.data_devolucao_correcoes is not null
     and a.data_devolucao_correcoes::date > c.ultimo::date)) as falta_checklist,
  (cv.versao_id is null)                                     as falta_curva,
  coalesce(pd.pend_a, 0)  as pendentes_a,
  coalesce(pd.total_a, 0) as total_a
from alvo a
left join chk  c  on c.pid = a.id::text
left join cv      on cv.pid = a.id::text
left join pend pd on pd.versao_id = cv.versao_id
order by a.processo;
