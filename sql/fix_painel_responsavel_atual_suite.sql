-- ============================================================================
-- fix_painel_responsavel_atual_suite.sql — revisão do módulo Processos, 22/09/2026.
--
-- APLIQUE ESTE POR ÚLTIMO, depois de validar o resto da revisão na tela.
--
-- PROBLEMA: a view `vw_painel_desempenho_replanilhamentos` decide onde o processo está
-- lendo APENAS o texto do status, sem olhar `processos.suite` (a sigla da unidade em que
-- o processo realmente está, mantida pelo job sincronizar-suite):
--
--     case
--       when status_normalizado like '%AN%LISE FISCAL%' then 'FISCALIZACAO'
--       when status_normalizado in ('APROVADO', 'ARQUIVADO') then 'ENCERRADO'
--       else 'GECOPE'                                  -- <= todo o resto vira GECOPE
--     end as responsavel_atual
--
-- Um processo em AGUAR. ANÁLISE cai no `else` e é contado como carteira da GECOPE, mesmo
-- quando o SUITE mostra que ele está na GEFOE. O painel afirma uma coisa que o próprio
-- banco sabe ser falsa, na coluna ao lado.
--
-- MUDANÇA DE COMPORTAMENTO — LEIA ANTES DE APLICAR:
-- `responsavel_atual` passa a ter um QUARTO valor, 'OUTRA UNIDADE', para o processo que
-- não está encerrado, não está na fila da fiscalização, e que o SUITE mostra fora da
-- GECOPE. Na prática, alguns processos que hoje aparecem em "carteira GECOPE" vão migrar
-- para esse novo grupo — o número da carteira GECOPE vai CAIR, e essa queda é a correção,
-- não uma perda de dados.
--
-- A decisão de negócio embutida aqui é: "processo que saiu fisicamente da GECOPE não conta
-- como carteira da GECOPE". Se a sua regra for a oposta (a GECOPE continua responsável
-- mesmo com o processo tramitando noutro setor), troque 'OUTRA UNIDADE' por 'GECOPE' na
-- linha marcada com >>> AQUI <<< — o resto do script continua valendo, porque as colunas
-- novas `unidade_suite` e `divergencia_status_suite` seguem expondo a divergência.
--
-- O QUE ESTE SCRIPT NÃO FAZ: não altera nenhum processo, não corrige nenhum status. A
-- divergência de status em si (AGUAR. ANÁLISE que nunca sai desse status ao deixar a
-- GECOPE) ficou de fora da revisão por decisão — ver "O que ficou de fora" em
-- docs/revisoes/2026-09-22-processos.md. Este script só faz o painel parar de repetir a
-- informação errada.
--
-- Seguro executar novamente.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] ANTES DE APLICAR — SOMENTE LEITURA. Quantos processos vão mudar de grupo?
--
--     Rode isto primeiro: mostra exatamente quais processos hoje contam como
--     carteira GECOPE mas estão, segundo o SUITE, em outra unidade.
-- ----------------------------------------------------------------------------
select
  upper(trim(coalesce(p.suite, '')))  as unidade_no_suite,
  count(*)                            as processos,
  min(p.suite_data_chegada)           as chegada_mais_antiga,
  max(p.suite_data_chegada)           as chegada_mais_recente
from public.processos p
where p.excluido_por is null
  and upper(trim(coalesce(p.status, ''))) not in ('APROVADO', 'ARQUIVADO')
  and upper(trim(coalesce(p.status, ''))) not like 'EXCLU%'
  and upper(trim(coalesce(p.status, ''))) not like '%AN%LISE FISCAL%'
  and coalesce(nullif(upper(trim(coalesce(p.suite, ''))), ''), 'N/D') not in ('GECOPE', 'GECOP', 'N/D')
group by 1
order by processos desc;


-- ----------------------------------------------------------------------------
-- [2] A VIEW CORRIGIDA.
--
--     Igual à versão em sql/_aplicados/sql/painel_desempenho_replanilhamentos.sql,
--     com três diferenças, todas marcadas com "-- REVISÃO 22/09/2026":
--       a) `base` passa a trazer `suite` e `suite_data_chegada`;
--       b) `responsavel_atual` consulta a unidade do SUITE;
--       c) duas colunas novas: `unidade_suite` e `divergencia_status_suite`.
-- ----------------------------------------------------------------------------
create or replace view public.vw_painel_desempenho_replanilhamentos
with (security_invoker = true)
as
with base as (
  select
    p.id,
    p.processo,
    p.status,
    upper(trim(coalesce(p.status, ''))) as status_normalizado,
    coalesce(nullif(trim(p.analista), ''), 'Nao atribuido') as analista,
    p.fiscal,
    p.contratante,
    p.contratada,
    p.distrito_operacional,
    p.municipio,
    p.prioritario,
    p.data_abertura,
    p.data_recebimento,
    p.data_compromisso_fiscal,
    p.data_devolucao_correcoes,
    p.data_aprovacao_gecope,
    p.created_at,
    p.ultima_atualizacao,
    p.reperc_fiscal,
    p.reperc_gecope,
    -- REVISÃO 22/09/2026 (a): a unidade real, que a versão anterior ignorava.
    -- 'N/D' é o que o job grava quando o SUITE não devolve unidade; vazio é processo
    -- que o job ainda não visitou. Os dois viram NULL aqui: "não sei onde está".
    nullif(nullif(upper(trim(coalesce(p.suite, ''))), ''), 'N/D') as unidade_suite,
    p.suite_data_chegada,
    coalesce(p.data_recebimento, p.data_abertura, p.created_at::date) as data_entrada
  from public.processos p
  where p.excluido_por is null
), classificacao as (
  select
    b.*,
    case
      when b.status_normalizado = 'ARQUIVADO' then 'Arquivado'
      when b.status_normalizado = 'APROVADO' then 'Aprovado'
      when b.status_normalizado = '' then 'Sem status'
      else 'Em tramitacao'
    end as situacao,
    b.status_normalizado not in ('APROVADO', 'ARQUIVADO') and b.status_normalizado not like 'EXCLU%' as em_tramitacao,
    case
      when b.status_normalizado like '%DEVOLVIDO%' or b.status_normalizado like '%REAN%' then
        coalesce(b.data_devolucao_correcoes, b.ultima_atualizacao::date, b.data_entrada)
      else coalesce(b.ultima_atualizacao::date, b.data_entrada)
    end as data_inicio_status,
    b.status_normalizado in ('APROVADO', 'ARQUIVADO') as encerrado,

    -- REVISÃO 22/09/2026 (b): antes, TODO status que não fosse fiscal nem encerrado caía
    -- no `else 'GECOPE'`, sem nunca consultar onde o processo estava.
    case
      when b.status_normalizado like '%AN%LISE FISCAL%'            then 'FISCALIZACAO'
      when b.status_normalizado in ('APROVADO', 'ARQUIVADO')       then 'ENCERRADO'
      -- Sem informação do SUITE, mantém o comportamento antigo: assume GECOPE.
      when b.unidade_suite is null                                 then 'GECOPE'
      when b.unidade_suite in ('GECOPE', 'GECOP')                  then 'GECOPE'
      -- 'ARQUIVADO' aqui é a sigla que o SUITE devolve, não o status do GECOPE.
      when b.unidade_suite = 'ARQUIVADO'                           then 'ENCERRADO'
      else 'OUTRA UNIDADE'   -- >>> AQUI <<< troque por 'GECOPE' se a regra for a oposta
    end as responsavel_atual,

    -- REVISÃO 22/09/2026 (c): sinaliza o processo cujo status diz uma coisa e o SUITE,
    -- outra. É o caso AGUAR. ANÁLISE × GEFOE que motivou esta revisão. Serve para medir
    -- o tamanho do problema sem precisar mexer em nenhum dado.
    (
      b.status_normalizado not in ('APROVADO', 'ARQUIVADO')
      and b.status_normalizado not like 'EXCLU%'
      and b.status_normalizado not like '%AN%LISE FISCAL%'
      and b.unidade_suite is not null
      and b.unidade_suite not in ('GECOPE', 'GECOP', 'ARQUIVADO')
    ) as divergencia_status_suite
  from base b
)
select
  c.id,
  c.processo,
  c.status,
  c.status_normalizado,
  c.analista,
  c.fiscal,
  c.contratante,
  c.contratada,
  c.distrito_operacional,
  c.municipio,
  c.prioritario,
  c.data_abertura,
  c.data_recebimento,
  c.data_compromisso_fiscal,
  c.data_devolucao_correcoes,
  c.data_aprovacao_gecope,
  c.created_at,
  c.ultima_atualizacao,
  c.reperc_fiscal,
  c.reperc_gecope,
  c.data_entrada,
  c.situacao,
  c.em_tramitacao,
  c.encerrado,
  c.unidade_suite,                 -- REVISÃO 22/09/2026
  c.suite_data_chegada,            -- REVISÃO 22/09/2026
  c.divergencia_status_suite,      -- REVISÃO 22/09/2026
  date_trunc('month', c.data_entrada)::date as mes_entrada,
  date_trunc('month',
    case when c.encerrado then coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) end
  )::date as mes_conclusao,
  case
    when c.em_tramitacao and c.data_inicio_status is not null
      then greatest(current_date - c.data_inicio_status, 0)
  end as dias_em_aberto,
  case
    when c.encerrado and c.data_entrada is not null
      and coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) is not null
      then greatest(coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) - c.data_entrada, 0)
  end as dias_ate_conclusao,
  case
    when c.responsavel_atual <> 'FISCALIZACAO' or c.data_compromisso_fiscal is null then null
    when c.em_tramitacao then current_date > c.data_compromisso_fiscal
    when c.data_aprovacao_gecope is not null
      then c.data_aprovacao_gecope > c.data_compromisso_fiscal
  end as meta_estourada,
  coalesce(c.reperc_fiscal, 0) - coalesce(c.reperc_gecope, 0) as impacto_revisao,
  case
    when nullif(abs(c.reperc_fiscal), 0) is not null
      then (coalesce(c.reperc_fiscal, 0) - coalesce(c.reperc_gecope, 0))
           / abs(c.reperc_fiscal)
  end as percentual_impacto_revisao,
  c.data_inicio_status,
  c.responsavel_atual
from classificacao c;

comment on view public.vw_painel_desempenho_replanilhamentos is
  'Base analitica, uma linha por processo de replanilhamento valido, para o painel de desempenho. '
  'Desde 22/09/2026, responsavel_atual consulta a unidade do SUITE (coluna processos.suite) e nao '
  'apenas o texto do status; ganhou o valor OUTRA UNIDADE. Ver sql/fix_painel_responsavel_atual_suite.sql.';

grant select on public.vw_painel_desempenho_replanilhamentos to authenticated;


-- ----------------------------------------------------------------------------
-- [3] CONFIRME DEPOIS — o antes e depois, lado a lado.
--
--     `carteira_gecope` deve ter diminuído, e a diferença deve aparecer em
--     `em_outra_unidade`. Se `divergentes` vier zero, não havia divergência
--     nenhuma e nada mudou — o que também é uma resposta útil.
-- ----------------------------------------------------------------------------
select
  count(*) filter (where em_tramitacao)                                      as em_tramitacao,
  count(*) filter (where em_tramitacao and responsavel_atual = 'GECOPE')     as carteira_gecope,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO') as em_fiscalizacao,
  count(*) filter (where em_tramitacao and responsavel_atual = 'OUTRA UNIDADE') as em_outra_unidade,
  count(*) filter (where divergencia_status_suite)                           as divergentes
from public.vw_painel_desempenho_replanilhamentos;


-- ----------------------------------------------------------------------------
-- [4] A LISTA DA DIVERGÊNCIA — quais processos, e há quanto tempo.
--     É o retrato do problema que motivou a revisão.
-- ----------------------------------------------------------------------------
select
  processo          as nup,
  status,
  unidade_suite     as onde_esta_no_suite,
  suite_data_chegada,
  analista,
  fiscal
from public.vw_painel_desempenho_replanilhamentos
where divergencia_status_suite
order by suite_data_chegada nulls last, processo;
