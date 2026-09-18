-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — gerência de lotação dos fiscais × unidade no SUITE
--
-- Decisão do usuário (2026-09-16): o tempo na Fiscalização conta as passagens pela
-- GERÊNCIA DE LOTAÇÃO do fiscal, não pela gerência da obra. Um fiscal da GEFOE que
-- fiscaliza obra da GEDOP-ITC recebe os processos no SUITE pela GEFOE.
--
-- No SUITE cada unidade tem um id numérico (`capacity`) e uma sigla em texto
-- ("SOP/DIFGR/GEDOP-LNO"). Esta consulta mostra como a lotação está gravada em app_users
-- e traz um NUP de exemplo por gerência — com ele se lê o histórico no SUITE e se descobre
-- o id da unidade, para montar a tabela de-para sem comparar texto.
--
-- Só fiscais com processo não excluído. Uma consulta só. Não altera nada.
-- ============================================================================
select
  coalesce(nullif(trim(u.gerencia), ''), '(vazio)')  as gerencia,
  coalesce(nullif(trim(u.gedop), ''), '(vazio)')     as gedop,
  count(distinct pr.fiscal_matricula)                as fiscais,
  count(*)                                           as processos,
  string_agg(distinct coalesce(nullif(trim(u.full_name), ''), pr.fiscal_matricula), '; ') as nomes,
  min(pr.processo)                                   as nup_exemplo,
  max(pr.processo)                                   as nup_exemplo_2
from public.processos pr
left join lateral (
  select au.full_name, au.gerencia, au.gedop
  from public.app_users au
  where au.matricula = pr.fiscal_matricula
  order by au.id limit 1
) u on true
where pr.excluido_por is null
group by 1, 2
order by processos desc;
