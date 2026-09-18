-- ============================================================================
-- vw_painel_desempenho_fiscais — fonte única do painel de desempenho dos fiscais
--
-- Grão: UMA LINHA POR PROCESSO de replanilhamento válido. A agregação por
-- distrito e por fiscal é feita por quem consome (o painel do mapa e a quebra
-- por distrito de modules/processos/processos.js), a partir desta mesma base —
-- o objetivo é que as duas telas nunca mostrem números diferentes.
--
-- Por que uma view nova e não uma das existentes:
--   vw_painel_desempenho_replanilhamentos  — não conhece tempo_suite nem gedop
--   vw_assistente_processo_completo        — grão certo, mas desenhada para o
--                                            Q&A do assistente, sem lotação
--
-- Regras de negócio consolidadas aqui (medidas em 2026-09-15, 405 processos):
--
--   FILA DA FISCALIZAÇÃO = status 'ANÁLISE FISCAL' + 'DEVOLVIDO P/ REANÁLISE
--   FISCAL'. Mesma definição do card "Processos Fiscalização" em
--   processos.js:2858. Atenção: "REANÁLISE FISCAL" é rótulo de tela
--   (utils.js:233 formatStatusDisplay) — no banco o valor é o longo.
--   As contagens citadas neste cabeçalho são de 2026-09-15 e servem para detectar
--   regressão grosseira, não como verdade: a base é viva e mudou durante a própria
--   sessão em que foi medida (um processo saiu de ANÁLISE FISCAL para AGUAR.
--   ANÁLISE entre duas consultas, levando a fila de 64 para 63).
--
--   DESPACHO, TEMPO E FISCAL vêm de vw_tempo_fiscal_processo (histórico do SUITE; regras
--   no cabeçalho dela). Desde 2026-09-16 esta view não usa mais processos.tempo_suite nem
--   a coalescência data_aprovacao_gecope/ultima_atualizacao.
--
--   DESPACHADO = situacao 'despachado': APROVADO ou ARQUIVADO COM data de aprovação
--   (resultado 04, 2026-09-16: 304). ARQUIVADO sem data foi arquivado no meio do
--   trâmite: não é despacho, não está com o fiscal nem na GECOPE (situacao
--   'arquivado_no_tramite', 28) e fica fora das métricas.
--
--   DATA DE DESPACHO = saída da última passagem pela unidade do fiscal antes da ida à
--   GECOPE que resultou na aprovação. NULL no despachado sem ida à GECOPE nem à DIFOR
--   até a data de aprovação (motivo em `conferencia`).
--
--   TEMPO (tempo_fiscal_dias) = dias na unidade do fiscal até esse corte, só no
--   despachado. NULL não é zero: aberto já pronto (aberto_ja_pronto, menos de 1 dia) ou
--   motivo em `conferencia`.
--
--   UMA LINHA POR PROCESSO: a linha da view de tempo com responde_pelo_processo — a do
--   fiscal que despachou, se despachado com corte; senão a do fiscal atual.
--   TROCA DE FISCAL (usuário, 2026-09-16): conta só o tempo de quem despachou, desde que
--   assumiu o processo até o despacho. O tempo do fiscal anterior que não despachou não
--   é contabilizado em lugar nenhum — nem na média dele, nem na do distrito, nem somado
--   ao de quem despachou. Por isso as colunas fiscal_* são desse fiscal, e não
--   necessariamente o de processos.fiscal_matricula (guardado em fiscal_atual_matricula).
--
--   DIAS NA UNIDADE (dias_na_unidade) = processo na fila: dias inteiros desde a última
--   entrada na unidade do fiscal no SUITE. NULL quando o status diz fila, mas o SUITE
--   mostra o processo em outra unidade (ainda tramitando até o fiscal).
--
--   FISCAL = quem responde pelo processo (acima), qualquer que seja o papel atual
--   em app_users. Três dessas pessoas hoje são admin (1)
--   ou gerente (2) — analisaram processos antes de mudar de papel e continuam
--   contando. Por isso o join com app_users NÃO filtra por role.
--   Consequência assumida: os 18 fiscais cadastrados que nunca analisaram
--   processo ficam fora do denominador de carga. Isso é intencional (o painel
--   avalia quem analisa), mas significa que ele NÃO responde "preciso de mais
--   gente aqui?" — para essa pergunta o denominador certo seria a lotação.
--
--   DISTRITO DO FISCAL = app_users.gedop. Casa 1:1 com os 11 distritos de
--   assets/geo/ce-referencia.json após normalizar acento e caixa; única
--   exceção 'FORTALEZA' ↔ 'RM Fortaleza' (tratada no front-end).
--
--   VALOR DA OBRA é critério de RISCO, não de esforço. Medido: a correlação
--   entre valor da obra e tempo_suite é 0,045 (n=239) e entre |reperc_fiscal| e
--   tempo_suite é 0,046 (n=405) — nulas. Não use valor para ponderar carga nem
--   tempo; ele existe aqui para dimensionar exposição financeira.
--
-- Exclusão: `excluido_por is null`, mesma convenção das views vw_gecope_revisao_*
-- (data_exclusao isolada não basta — há legado com essa data preenchida).
--
-- ACESSO: restrito a admin e gerente, via public.meu_papel() no WHERE. O painel
-- ordena pessoas nominalmente, e a RLS de `processos` sozinha deixaria um fiscal
-- ver a própria linha (processos_select). Quem não for admin/gerente recebe zero
-- linhas. security_invoker = true mantém a RLS das tabelas-fonte valendo por
-- cima disso — a checagem aqui restringe, nunca amplia. É fail-closed: quem não
-- tem linha em app_users recebe NULL de meu_papel(), e NULL in (...) é NULL, que
-- o WHERE trata como falso. vw_tempo_fiscal_processo tem a mesma porta.
--
-- Usamos meu_papel() CRU de propósito, e não o helper pode_ver_todos_processos()
-- (sql/autorizacoes_especiais.sql), que também aceita 'externo' e o bypass de
-- autorização especial. Aqui é mais restritivo que a convenção da casa porque o
-- painel é nominal. Não "uniformize" isto depois sem decidir de novo.
--
-- LIMITE DESTE GATE: ele é uma porta de produto, não uma fronteira de sigilo. Um
-- papel 'externo' já consegue hoje ler `processos` (pode_ver_todos_processos o
-- inclui) e `app_users` (SELECT liberado a qualquer autenticado) e montar o mesmo
-- ranking por fora desta view. Se o sigilo do ranking importar de fato, o item a
-- resolver é aquele par de policies, não esta cláusula.
--
-- Os dois LEFT JOIN LATERAL ... LIMIT 1 garantem o grão de uma linha por
-- processo mesmo que matricula ou codigo_obra tenham duplicata nas tabelas de
-- origem. Sem eles, uma duplicata multiplicaria o processo e inflaria toda
-- contagem do painel em silêncio. A view de tempo entra por LEFT JOIN filtrada em
-- responde_pelo_processo, que tem exatamente uma linha por processo (conferido no
-- resultado 04): se um dia faltar a linha, o processo continua aparecendo, sem tempo e
-- sem despacho, em vez de sumir.
--
-- Execute no SQL Editor do Supabase DEPOIS de sql/create_vw_tempo_fiscal_processo.sql.
-- É seguro executar novamente. drop + create numa transação: as colunas mudaram em
-- 2026-09-16, e create or replace não remove nem renomeia coluna.
-- ============================================================================

begin;

drop view if exists public.vw_painel_desempenho_fiscais;

create view public.vw_painel_desempenho_fiscais
with (security_invoker = true)
as
with base as (
  select
    p.*,
    upper(trim(coalesce(p.status, ''))) as status_norm
  from public.processos p
  where p.excluido_por is null
    and public.meu_papel() in ('admin', 'gerente')
), tf as (
  -- A linha que responde pelo processo (ver cabeçalho). CTE e não lateral: a view de tempo
  -- lê o histórico inteiro com funções de janela, e um lateral a reexecutaria por processo.
  select *
  from public.vw_tempo_fiscal_processo
  where responde_pelo_processo
), resp as (
  select
    b.*,
    t.situacao                                                 as t_situacao,
    t.data_despacho                                            as t_data_despacho,
    t.tempo_fiscal_dias                                        as t_tempo_fiscal_dias,
    t.aberto_ja_pronto                                         as t_aberto_ja_pronto,
    t.retornos_correcao                                        as t_retornos_correcao,
    t.dias_na_unidade_agora                                    as t_dias_na_unidade_agora,
    t.conferencia                                              as t_conferencia,
    -- sem linha na view de tempo (não deveria acontecer), fica o fiscal de hoje
    case when t.processo_id is not null then t.fiscal_matricula
         else b.fiscal_matricula end                           as t_resp_matricula
  from base b
  left join tf t on t.processo_id = b.id
)
select
  b.id,
  b.processo,
  b.status,
  case
    when b.status_norm = 'DEVOLVIDO P/ REANÁLISE FISCAL' then 'REANÁLISE FISCAL'
    else b.status
  end                                                        as status_exibicao,
  b.tipo,
  b.descricao,
  b.prioritario,

  -- classificação do processo
  b.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL')  as na_fila,
  b.t_situacao                                               as situacao,
  coalesce(b.t_situacao = 'despachado', false)               as despachado,
  b.t_data_despacho                                          as data_despacho,
  case when b.t_situacao = 'despachado' then b.t_tempo_fiscal_dias end as tempo_fiscal_dias,
  coalesce(b.t_aberto_ja_pronto, false)                      as aberto_ja_pronto,
  b.t_retornos_correcao                                      as retornos_correcao,
  b.t_conferencia                                            as conferencia,
  case
    when b.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL')
      then floor(b.t_dias_na_unidade_agora)::int
  end                                                        as dias_na_unidade,
  b.data_compromisso_fiscal,
  case
    when b.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL')
      and b.data_compromisso_fiscal is not null
      then current_date > b.data_compromisso_fiscal
  end                                                        as meta_estourada,

  -- fiscal que responde pelo processo (sem filtro de role — ver cabeçalho)
  b.t_resp_matricula                                           as fiscal_matricula,
  -- processos.fiscal (texto) é o nome do fiscal de HOJE: só serve de reserva quando é ele
  -- quem responde. Com troca, o nome de um ao lado dos números do outro seria o pior erro.
  coalesce(nullif(trim(u.full_name), ''),
           case when b.t_resp_matricula is not distinct from b.fiscal_matricula
                then nullif(trim(b.fiscal), '') end,
           '(sem fiscal)')                                   as fiscal_nome,
  u.gedop                                                    as fiscal_gedop,
  u.gerencia                                                 as fiscal_gerencia,
  u.role                                                     as fiscal_role,
  (u.matricula is not null)                                  as fiscal_cadastrado,
  b.fiscal_matricula                                         as fiscal_atual_matricula,

  -- obra vinculada (403 de 405 processos têm codigo_obra)
  b.codigo_obra,
  ce.nr_contrato_sop,
  ce.descricao_obra                                          as obra_descricao,
  coalesce(ce.municipio, b.municipio)                        as obra_municipio,
  coalesce(ce.distrito_operacional, b.distrito_operacional)  as obra_distrito_operacional,
  ce.status_obra                                             as obra_status,
  coalesce(
    nullif(ce.valor_atual, 0),
    nullif(ce.valor_original, 0),
    nullif(ce.valor_atual_contrato, 0)
  )                                                          as obra_valor,

  -- partes
  b.contratante,
  b.contratada,
  b.analista,

  -- datas do ciclo
  b.data_abertura,
  b.data_recebimento,
  b.data_aprovacao_gecope,
  b.data_devolucao_correcoes,
  b.ultima_atualizacao,

  -- impacto financeiro da revisão
  b.acresc_fiscal,
  b.supress_fiscal,
  b.reperc_fiscal,
  b.acresc_gecope,
  b.supress_gecope,
  b.reperc_gecope,

  -- rastreio no SUITE
  b.suite,
  b.sigla_suite,
  b.suite_data_chegada

from resp b
-- order by explícito: `limit 1` sem ordem é não determinístico, e numa matrícula
-- duplicada isso atribuiria o nome e o gedop de uma pessoa aos números de outra —
-- num painel que ordena gente nominalmente, o pior erro possível.
left join lateral (
  select au.matricula, au.full_name, au.gedop, au.gerencia, au.role
  from public.app_users au
  where au.matricula = b.t_resp_matricula
  order by au.id
  limit 1
) u on true
left join lateral (
  select c.nr_contrato_sop, c.descricao_obra, c.municipio, c.distrito_operacional,
         c.status_obra, c.valor_atual, c.valor_original, c.valor_atual_contrato
  from public.contratos_edificacao c
  where c.codigo_obra = b.codigo_obra
  order by c.id_obra
  limit 1
) ce on true;

comment on view public.vw_painel_desempenho_fiscais is
  'Uma linha por processo de replanilhamento válido, com o fiscal que responde por ele (quem despachou, ou o atual), obra vinculada e despacho e tempo na Fiscalização lidos de vw_tempo_fiscal_processo. Fonte única do painel de desempenho dos fiscais. Restrita a admin e gerente.';

grant select on public.vw_painel_desempenho_fiscais to authenticated;

commit;
