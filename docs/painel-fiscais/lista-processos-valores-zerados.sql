-- ============================================================================
-- LISTA (somente leitura) — processos com acréscimo, supressão e repercussão zerados
--
-- Pedido do usuário (2026-09-16): processos em que os SEIS valores estão zerados — acréscimo,
-- supressão e repercussão, tanto da Fiscalização (acresc_fiscal, supress_fiscal,
-- reperc_fiscal) quanto da GECOPE (acresc_gecope, supress_gecope, reperc_gecope) — devem sair
-- do painel. Nulo conta como zerado. Processos já excluídos (excluido_por preenchido) ficam
-- de fora, como em todo o painel.
--
-- ATENÇÃO ao ler: processo que ainda está na fila da Fiscalização costuma ter os valores
-- zerados só porque o fiscal não preencheu ainda. A coluna "situacao_painel" separa esse
-- caso do processo já despachado (APROVADO/ARQUIVADO), em que zerado é dado definitivo.
--
-- Uma consulta só. Não altera nada. Exporte o resultado (CSV).
-- ============================================================================
select
  case
    when upper(trim(coalesce(pr.status, ''))) in ('APROVADO', 'ARQUIVADO')
      then '1 despachado'
    when upper(trim(coalesce(pr.status, ''))) in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL')
      then '2 na fila do fiscal'
    else '3 outros status'
  end                                                 as situacao_painel,
  pr.processo                                         as nup,
  pr.status,
  pr.status_pre_arquivamento                          as status_antes_de_arquivar,
  coalesce(nullif(trim(u.full_name), ''), nullif(trim(pr.fiscal), ''), '(sem fiscal)') as fiscal,
  u.gerencia                                          as gerencia_fiscal,
  pr.analista,
  pr.codigo_obra,
  pr.data_recebimento,
  pr.data_aprovacao_gecope,
  pr.ultima_atualizacao,
  pr.atualizado_por,
  pr.tempo_suite                                      as tempo_suite_dias
from public.processos pr
left join lateral (
  select au.full_name, au.gerencia
  from public.app_users au
  where au.matricula = pr.fiscal_matricula
  order by au.id limit 1
) u on true
where pr.excluido_por is null
  and coalesce(pr.acresc_fiscal, 0)  = 0
  and coalesce(pr.supress_fiscal, 0) = 0
  and coalesce(pr.reperc_fiscal, 0)  = 0
  and coalesce(pr.acresc_gecope, 0)  = 0
  and coalesce(pr.supress_gecope, 0) = 0
  and coalesce(pr.reperc_gecope, 0)  = 0
order by situacao_painel, pr.status, pr.ultima_atualizacao desc nulls last, pr.processo;
