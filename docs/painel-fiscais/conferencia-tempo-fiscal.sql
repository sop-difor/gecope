-- ============================================================================
-- CONFERÊNCIA (somente leitura) — tempo e despacho novos × os valores antigos (tempo_suite)
--
-- Rodar DEPOIS de sql/create_vw_tempo_fiscal_processo.sql. Uma linha por processo × fiscal
-- (processo com troca de fiscal aparece uma vez por fiscal; `atual` marca o de hoje), com os
-- valores antigos (processos.tempo_suite e a data de despacho que o painel usava até 2026-09-16) ao lado dos novos
-- (vw_tempo_fiscal_processo). Ordem: primeiro o que caiu em conferência, depois as maiores
-- diferenças de tempo.
--
-- A view só devolve linhas para admin/gerente (meu_papel(), lido do e-mail do JWT).
-- O SQL Editor não tem JWT, então a primeira instrução empresta o e-mail de um admin só
-- durante ESTA execução: `true` torna a configuração local à transação, que acaba com o
-- script. Com `false` ela ficaria na conexão e contaminaria o que rodar depois nela
-- (ex.: gatilhos que gravam o e-mail do autor). Não altera nada no banco.
--
-- Rode o arquivo inteiro (as duas instruções juntas) e exporte o resultado (CSV).
-- Rodar só o segundo select devolve zero linhas — é a porta de acesso funcionando. Depois da
-- troca do painel (2026-09-16), os valores antigos vêm de `processos`, não mais da view do painel.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  (select json_build_object('email', au.email)::text
     from public.app_users au
    where au.role = 'admin' and au.email is not null
    order by au.id limit 1),
  true
);

select
  t.situacao,
  t.conferencia,
  t.nup,
  p.status,
  coalesce(nullif(trim(ua.full_name), ''), p.fiscal)       as fiscal_atual_nome,
  t.fiscal_gerencia,
  t.unidades_fiscal,
  t.fiscal_matricula,
  t.atual,
  t.atribuicao_inicio,
  t.despacho_do_fiscal,
  t.responde_pelo_processo,
  p.data_aprovacao_gecope,
  t.entrada_gecope_aprovacao at time zone 'America/Fortaleza' as entrada_gecope_aprovacao,
  t.corte_na_difor,
  case when upper(trim(p.status)) in ('APROVADO', 'ARQUIVADO')
       then coalesce(p.data_aprovacao_gecope, p.ultima_atualizacao::date) end as despacho_antigo,
  t.data_despacho                                       as despacho_novo,
  p.tempo_suite                                         as tempo_antigo,
  t.tempo_fiscal_dias                                   as tempo_novo,
  t.aberto_ja_pronto,
  t.tempo_na_unidade_dias,
  -- tempo_suite é do processo inteiro: compara com a soma das linhas do processo
  round(sum(t.tempo_fiscal_dias) over (partition by t.processo_id) - p.tempo_suite, 2)
                                                        as diferenca_tempo_processo,
  t.passagens_unidade,
  t.retornos_correcao,
  floor(t.dias_na_unidade_agora)                        as dias_na_unidade_agora,
  t.na_unidade_agora
from public.vw_tempo_fiscal_processo t
join public.processos p on p.id = t.processo_id
left join lateral (
  select au.full_name from public.app_users au
   where au.matricula = p.fiscal_matricula order by au.id limit 1
) ua on true
order by (t.conferencia is null),
         (t.atribuicao_inicio is null and t.atual),
         t.conferencia,
         abs(coalesce(sum(t.tempo_fiscal_dias) over (partition by t.processo_id), 0)
             - coalesce(p.tempo_suite, 0)) desc,
         t.nup,
         t.atual;
