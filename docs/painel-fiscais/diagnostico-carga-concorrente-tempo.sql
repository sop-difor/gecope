-- ============================================================================
-- DIAGNÓSTICO (somente leitura) — carga concorrente do fiscal (processos, obras e valor
-- delas) no momento de CADA despacho × tempo_fiscal_dias daquele despacho
--
-- Pedido do usuário em 2026-09-22, depois de atualizar `contratos_edificacao` para incluir
-- obras com contrato ENCERRADO (antes só Em Execução/Aguardando OS/Paralisada — ver
-- cabeçalho de sql/create_vw_painel_desempenho_fiscais.sql). Duas perguntas:
--
--   1. A cobertura de `obra_valor` nos despachados melhorou? Medido em 2026-09-15: só 51%
--      (169 de 330) tinham valor, porque a obra do processo já tinha contrato encerrado e
--      saía do escopo de `contratos_edificacao`. Query 1 abaixo.
--
--   2. Existe correlação entre carga concorrente do fiscal (quantos processos e quantas
--      obras ele tinha na mão, e o valor delas) e o tempo que ELE levou naquele despacho
--      específico (`tempo_fiscal_dias`)? A correlação medida em 2026-09-15 (0,045/0,046,
--      nula) era entre o VALOR DA OBRA DO PRÓPRIO PROCESSO e o tempo — uma variável
--      diferente desta. Carga concorrente nunca foi medida. Query 2 abaixo.
--
-- MÉTODO (carga concorrente): para cada despacho do processo P pelo fiscal X, na data
-- data_despacho, conta quantos processos DO MESMO FISCAL já tinham entrado na unidade dele
-- (`primeira_entrada`, de vw_tempo_fiscal_processo) e ainda não tinham saído
-- (`data_despacho` nulo — ainda em tramitação — ou saiu depois desta data). Mesma ideia
-- para obras distintas (`codigo_obra`) e para a soma do valor delas (`obra_valor`,
-- deduplicado por obra, já que vários processos podem ser da mesma obra).
--
-- LIMITAÇÃO ASSUMIDA (documentar se o resultado virar decisão): só entra na "carga" de um
-- fiscal quem aparece como `responde_pelo_processo` PARA ELE (despachou, ou tem o processo
-- agora). Um processo que passou pela mão de um fiscal e foi REATRIBUÍDO antes de ele
-- despachar não fica na carga daquele fiscal (a view não expõe primeira_entrada/
-- data_despacho por fiscal ANTIGO de um processo trocado). Trocas de fiscal são raras (409
-- atribuições para ~405 processos em 2026-09-16), efeito esperado pequeno.
--
-- Exclui `aberto_ja_pronto` (tempo_fiscal_dias nulo por definição — replanilhamento
-- preparado fora do SUITE, não é carga real medida em dias) e despachos sem
-- `primeira_entrada` (mesmos casos que já caem em `conferencia` na view de tempo).
--
-- Só leitura, uma transação implícita de SELECT. Não altera nada.
--
-- ACESSO: a view só devolve linhas para admin/gerente (meu_papel(), lido do e-mail do
-- JWT — sql/rls_processos_composicoes_orcamentos.sql). O SQL Editor não tem JWT, então a
-- primeira instrução de cada bloco empresta SEU e-mail de admin/gerente só durante ESTA
-- execução: `true` torna a configuração local à transação, que acaba com o bloco — não
-- fica valendo para o resto da sessão (mesma técnica de
-- docs/painel-fiscais/conferencia-tempo-fiscal.sql). Troque 'SEU_EMAIL_AQUI', nos dois
-- blocos, pelo e-mail com que você loga no GECOPE como admin ou gerente.
--
-- Execute UM BLOCO DE CADA VEZ (a linha set_config + a consulta logo abaixo, selecionadas
-- juntas e rodadas de uma vez) — o SQL Editor só mostra o resultado da ÚLTIMA instrução
-- quando várias rodam juntas, e há duas consultas aqui. Rodar uma consulta sozinha, sem a
-- linha de set_config na mesma execução, devolve zero linhas — é a porta de acesso
-- funcionando. Devolva os dois resultados (são só linhas de estatística agregada, nenhum
-- dado de processo/fiscal individual sai do banco).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Query 1 — cobertura de obra_valor nos despachados, depois da atualização de ontem
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('email', 'SEU_EMAIL_AQUI')::text,
  true
);

select
  count(*) filter (where p.despachado)                                     as despachados,
  count(*) filter (where p.despachado and p.codigo_obra is not null)       as despachados_com_obra,
  count(*) filter (where p.despachado and p.obra_valor is not null)        as despachados_com_valor,
  round(100.0 * count(*) filter (where p.despachado and p.obra_valor is not null)
        / nullif(count(*) filter (where p.despachado), 0), 1)              as pct_cobertura_valor
from public.vw_painel_desempenho_fiscais p;

-- ---------------------------------------------------------------------------
-- Query 2 — carga concorrente × tempo_fiscal_dias: correlações e inclinações (Pearson)
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('email', 'SEU_EMAIL_AQUI')::text,
  true
);

with base as (
  select
    p.id,
    p.fiscal_matricula,
    p.data_despacho,
    t.primeira_entrada,
    p.tempo_fiscal_dias,
    p.codigo_obra,
    p.obra_valor
  from public.vw_painel_desempenho_fiscais p
  join public.vw_tempo_fiscal_processo t
    on t.processo_id = p.id
   and t.responde_pelo_processo
  where p.despachado
    and p.tempo_fiscal_dias is not null
    and t.primeira_entrada is not null
),
carga as (
  select
    b.*,
    -- processos concorrentes (inclui o próprio; some 1 se quiser só "os outros")
    (select count(*)
       from base b2
      where b2.fiscal_matricula = b.fiscal_matricula
        and b2.primeira_entrada <= b.data_despacho
        and (b2.data_despacho is null or b2.data_despacho >= b.data_despacho)
    )                                                                      as processos_concorrentes,
    (select count(distinct b2.codigo_obra)
       from base b2
      where b2.fiscal_matricula = b.fiscal_matricula
        and b2.codigo_obra is not null
        and b2.primeira_entrada <= b.data_despacho
        and (b2.data_despacho is null or b2.data_despacho >= b.data_despacho)
    )                                                                      as obras_concorrentes,
    (select coalesce(sum(x.valor), 0)
       from (
         select distinct on (b2.codigo_obra) b2.codigo_obra, b2.obra_valor as valor
           from base b2
          where b2.fiscal_matricula = b.fiscal_matricula
            and b2.codigo_obra is not null
            and b2.primeira_entrada <= b.data_despacho
            and (b2.data_despacho is null or b2.data_despacho >= b.data_despacho)
          order by b2.codigo_obra
       ) x
    )                                                                      as valor_obras_concorrentes
  from base b
)
select
  count(*)                                                                 as n_despachos,
  count(*) filter (where valor_obras_concorrentes > 0)                     as n_com_valor,
  round(avg(tempo_fiscal_dias)::numeric, 1)                                as tempo_medio_dias,
  round(avg(processos_concorrentes)::numeric, 1)                          as media_processos_concorrentes,
  round(avg(obras_concorrentes)::numeric, 1)                              as media_obras_concorrentes,
  round(corr(tempo_fiscal_dias, processos_concorrentes)::numeric, 3)       as corr_tempo_x_processos,
  round(corr(tempo_fiscal_dias, obras_concorrentes)::numeric, 3)           as corr_tempo_x_obras,
  round(corr(tempo_fiscal_dias, valor_obras_concorrentes)::numeric, 3)     as corr_tempo_x_valor,
  -- checagem de multicolinearidade: processos e obras concorrentes tendem a andar juntos?
  round(corr(processos_concorrentes, obras_concorrentes)::numeric, 3)      as corr_processos_x_obras,
  round(regr_slope(tempo_fiscal_dias, processos_concorrentes)::numeric, 3) as slope_processos,
  round(regr_slope(tempo_fiscal_dias, obras_concorrentes)::numeric, 3)     as slope_obras,
  round(regr_slope(tempo_fiscal_dias, valor_obras_concorrentes)::numeric, 8) as slope_valor
from carga;

-- ---------------------------------------------------------------------------
-- Query 3 — export anonimizado, 1 linha por despacho, para regressão múltipla (pedido do
-- usuário em 2026-09-22: corr()/regr_slope() do Postgres só fazem regressão de UMA
-- variável por vez — processos_concorrentes × valor_obras_concorrentes junto, controlando
-- um pelo outro, precisa dos dados linha a linha).
--
-- Mesmas subconsultas da Query 2 (a CTE `carga`), só que aqui devolve as LINHAS em vez de
-- agregar. NÃO tem obras_concorrentes: é idêntica a processos_concorrentes nestes dados
-- (corr=1,000 na Query 2 — nenhum fiscal teve 2 processos concorrentes da mesma obra), então
-- colocar as duas juntas na regressão faria a matriz singular (multicolinearidade perfeita)
-- sem acrescentar nada.
--
-- ANONIMIZADO DE PROPÓSITO: sem id de processo, sem matrícula/nome de fiscal, sem
-- codigo_obra — só os 3 números por despacho. Mesmo assim é dado em nível de LINHA, não
-- só estatística agregada como as Queries 1 e 2 — um degrau a mais de sensibilidade, ok
-- pra você como admin exportar, mas não é o tipo de coisa que eu pediria de qualquer
-- pessoa.
--
-- Exporte como CSV (botão "Export" do resultado, no SQL Editor) e me devolva o arquivo.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('email', 'SEU_EMAIL_AQUI')::text,
  true
);

with base as (
  select
    p.id,
    p.fiscal_matricula,
    p.data_despacho,
    t.primeira_entrada,
    p.tempo_fiscal_dias,
    p.codigo_obra,
    p.obra_valor
  from public.vw_painel_desempenho_fiscais p
  join public.vw_tempo_fiscal_processo t
    on t.processo_id = p.id
   and t.responde_pelo_processo
  where p.despachado
    and p.tempo_fiscal_dias is not null
    and t.primeira_entrada is not null
),
carga as (
  select
    b.data_despacho,
    b.tempo_fiscal_dias,
    (select count(*)
       from base b2
      where b2.fiscal_matricula = b.fiscal_matricula
        and b2.primeira_entrada <= b.data_despacho
        and (b2.data_despacho is null or b2.data_despacho >= b.data_despacho)
    )                                                                      as processos_concorrentes,
    (select coalesce(sum(x.valor), 0)
       from (
         select distinct on (b2.codigo_obra) b2.codigo_obra, b2.obra_valor as valor
           from base b2
          where b2.fiscal_matricula = b.fiscal_matricula
            and b2.codigo_obra is not null
            and b2.primeira_entrada <= b.data_despacho
            and (b2.data_despacho is null or b2.data_despacho >= b.data_despacho)
          order by b2.codigo_obra
       ) x
    )                                                                      as valor_obras_concorrentes
  from base b
)
select tempo_fiscal_dias, processos_concorrentes, valor_obras_concorrentes
from carga
order by data_despacho;
