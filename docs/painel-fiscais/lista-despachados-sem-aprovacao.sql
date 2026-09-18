-- ============================================================================
-- LISTA (somente leitura) — despachados sem data de aprovação na GECOPE
--
-- Decisão do usuário (2026-09-16): esses processos serão corrigidos à mão, um a um, antes
-- de a data de despacho passar a vir do histórico do SUITE. Processos excluídos
-- (excluido_por preenchido) ficam de fora, como em todo o painel.
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV) se for trabalhar a lista.
-- ============================================================================
select
  pr.processo                                         as nup,
  pr.status,
  pr.status_pre_arquivamento                          as status_antes_de_arquivar,
  coalesce(nullif(trim(u.full_name), ''), nullif(trim(pr.fiscal), ''), '(sem fiscal)') as fiscal,
  u.gerencia                                          as gerencia_fiscal,
  pr.analista,
  pr.suite                                            as sigla_atual_suite,
  pr.suite_data_chegada,
  pr.atualizado_por,
  pr.ultima_atualizacao,
  pr.data_recebimento,
  pr.tempo_suite                                      as tempo_suite_dias
from public.processos pr
left join lateral (
  select au.full_name, au.gerencia
  from public.app_users au
  where au.matricula = pr.fiscal_matricula
  order by au.id limit 1
) u on true
where pr.excluido_por is null
  and upper(trim(coalesce(pr.status, ''))) in ('APROVADO', 'ARQUIVADO')
  and pr.data_aprovacao_gecope is null
order by pr.ultima_atualizacao desc nulls last, pr.processo;
