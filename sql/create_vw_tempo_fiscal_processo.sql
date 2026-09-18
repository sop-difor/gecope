-- ============================================================================
-- vw_tempo_fiscal_processo — tempo na Fiscalização e data de despacho, lidos do
-- histórico do SUITE (historico_suite_eventos)
--
-- Grão: UMA LINHA POR PROCESSO × FISCAL, para processos não excluídos. Processo sem troca de
-- fiscal tem uma linha só (atual = true); com troca, uma linha por fiscal que o teve. Todo
-- processo tem exatamente uma linha com atual = true (fiscal nulo inclusive) e exatamente
-- uma com responde_pelo_processo = true — a do fiscal que despachou, se despachado com corte;
-- senão a do atual. Conferência e aberto já pronto ficam nessa linha. Para o painel: carga e
-- fila por `atual`; despacho por `despacho_do_fiscal`; contagem de processo (e de aviso) por
-- `responde_pelo_processo`; tempo por fiscal somando as linhas dele. Consumida por
-- vw_painel_desempenho_fiscais, que lê só a linha de responde_pelo_processo: o painel conta
-- apenas o tempo de quem despachou (usuário, 2026-09-16); o tempo de fiscal anterior que
-- não despachou fica nesta view, para auditoria, e não entra em métrica nenhuma.
--
-- REGRA DE NEGÓCIO (usuário, 2026-09-16)
--
--   PASSAGEM = eventos seguidos do SUITE na mesma unidade (`capacity`). "Atribuir
--   responsável" e "Alterou responsável" acontecem dentro da unidade e não abrem passagem
--   nova. A passagem dura da entrada até o primeiro evento em outra unidade; a última
--   passagem do processo, sem evento seguinte, está EM ABERTO. Evento sem `capacity` é
--   ignorado — contado como unidade própria, partiria uma passagem em duas e inventaria
--   um retorno.
--
--   UNIDADES DO FISCAL = a gerência de LOTAÇÃO (app_users.gerencia), traduzida para o id do
--   SUITE por suite_unidades_lotacao, MAIS as lotações extras do fiscal no SUITE, cadastradas
--   por matrícula em suite_unidades_fiscal — há fiscais com mais de uma lotação no SUITE
--   (usuário, 2026-09-16; ex.: 22001.000499/2026-25, fiscal da GEDOP-LNO, correu na GEFOE e
--   na DIAES). A GECOPE (10442) nunca é unidade de fiscal: somaria o tempo de análise.
--   NÃO são unidades do fiscal (usuário, 2026-09-16): a GEDOP do distrito da obra — o
--   processo só chega ao fiscal quando passa por onde ele está lotado, mesmo que tramite
--   por engano pelo distrito da obra (ex.: 43022.012557/2025-12, fiscal da GERED, 39 d na
--   GEDOP-ITC) —; e setores do trâmite como GEROA (orçamentos), DIRER e DIAES, salvo para
--   quem tem a unidade como lotação ou lotação extra cadastrada.
--   TROCA DE FISCAL (usuário, 2026-09-16): as unidades dos fiscais ANTERIORES do processo
--   (historico_atribuicao_fiscal: lotação + lotações extras de cada um) também são unidades
--   do processo. O tempo do fiscal antigo fica com o fiscal antigo; o novo começa um tempo
--   novo. TRECHO = período de uma atribuição, da sua data de início até o início da seguinte;
--   o primeiro trecho começa em -infinity (o início das atribuições de backfill, antes de
--   2026-09-10, é sintético), o último termina em +infinity. Cada passagem é recortada pelos
--   trechos e cada pedaço vai para o fiscal do trecho. Ex.: 43022.006416/2026-33 — GEDOP-SOB
--   31,3 d + ~56 d (a passagem de 58,1 d até a troca) com o fiscal anterior, 1 retorno; o
--   novo fiscal (GEDOP-ITC) conta ~2 d a partir de 14/09, 0 retorno. Retornos contam dentro
--   do trecho de cada um.
--   DESPACHO vai para o fiscal do trecho em que o processo saiu da unidade (a data de
--   despacho, ou o corte quando não houve passagem). Se esse instante cair num trecho de
--   atribuição sem fiscal, vai para o fiscal atual — despacho não some. Ex.:
--   22001.170420/2025-41, GEDOP-IGT 64,1 d a partir de 29/12/2025, aprovado 12/03/2026 e
--   reatribuído (TAA) em 16/09/2026 — despacho e 64 d ficam com o fiscal anterior (IGT).
--   HISTÓRICO INCOERENTE: se a última atribuição não é do fiscal atual (ou não há histórico),
--   não há como recortar — o processo vira um trecho só, do fiscal atual, e a linha dele
--   leva o aviso em `conferencia` (quando não houver outro motivo antes).
--   Sempre id, não texto: unidade_sigla
--   vem do texto do status e às vezes traz o nome do evento ("ARQUIVADO", "APTO A
--   PUBLICAR DOE", "PROCESSO INICIADO") em vez da sigla, e a mesma sigla ("ASJUR") existe
--   com ids diferentes (2802, 8238). Medido em resultados_sql/resultado 06.csv.
--
--   Situação do processo:
--     despachado           APROVADO ou ARQUIVADO COM data_aprovacao_gecope.
--                          CORTE = entrada da última passagem na GECOPE (10442) que
--                          começou até o fim do dia da aprovação — é a ida que resultou
--                          na aprovação. Contam as passagens na unidade do fiscal que
--                          entraram ANTES do corte; como as passagens são sequenciais,
--                          todas já saíram até ele. Data de despacho = saída da última
--                          dessas passagens.
--                          Por que não cortar pela data de aprovação direto: o processo
--                          aprovado volta às unidades para assinatura e trâmite (DIFOR,
--                          GEFOE, GEDOP), às vezes no mesmo dia, e essa passagem entraria
--                          no tempo do fiscal sem aviso.
--                          SEM IDA À GECOPE ATÉ A APROVAÇÃO, MAS COM PASSAGEM PELA DIFOR
--                          (usuário, 2026-09-16): a GECOPE fica dentro da DIFOR, então o
--                          corte cai na entrada da última passagem pela DIFOR (8244) até o
--                          fim do dia da aprovação; corte_na_difor = true. Caso conferido:
--                          22001.101068/2025-02, nenhuma passagem pela GECOPE no SUITE.
--                          RETORNO DEPOIS DA APROVAÇÃO (usuário, 2026-09-16): aprovado na
--                          GECOPE, o processo em regra não volta; quando volta ao fiscal e à
--                          GECOPE é exceção, de mensuração difícil, e fica fora de todo
--                          cálculo — nem tempo, nem retorno, nem data de despacho. O corte
--                          acima já garante isso.
--                          ABERTO JÁ PRONTO (usuário, 2026-09-16): menos de 1 dia somado na
--                          unidade do fiscal — o replanilhamento foi preparado fora do SUITE e
--                          o processo aberto só para despachar (57 de 273 despachados, quase
--                          todos NUP 43022). Continua contando como despacho, com data; o
--                          tempo fica NULL e aberto_ja_pronto = true, para não puxar a média.
--                          tempo_na_unidade_dias guarda o valor medido, para auditoria.
--     em_tramitacao        nem aprovado nem arquivado. O que vale para o painel é
--                          dias_na_unidade_agora: há quanto tempo está na unidade do
--                          fiscal desde a última entrada, só se estiver lá agora.
--                          tempo_fiscal_dias soma todas as passagens até agora
--                          (informativo: inclui idas anteriores à GECOPE).
--     arquivado_no_tramite ARQUIVADO SEM data de aprovação: arquivado no meio do trâmite
--                          (os 28 de resultado 03 têm os seis valores de acréscimo,
--                          supressão e repercussão zerados). Não é despacho e não tem
--                          tempo, por definição — não é anomalia, não vai à conferência.
--                          Conservado: só não entra nas métricas de tempo e despacho.
--     aprovado_sem_data    APROVADO sem data_aprovacao_gecope: erro de cadastro (zero em
--                          2026-09-16). Sem tempo; aparece em `conferencia`.
--
--   RETORNO PARA CORREÇÃO = voltar a uma unidade do fiscal DEPOIS de passar pela GECOPE. Ida
--   e volta de rota (GEDOP → GEFOE → GEDOP, sem GECOPE no meio) não é retorno. Com lotação
--   extra, a primeira chegada a outra unidade do fiscal depois da GECOPE também conta como
--   retorno (o processo voltou ao fiscal) — rever se as lotações extras cadastradas mostrarem
--   que isso infla o indicador.
--
--   Casos conferidos no banco (resultado 06.csv):
--     22001.146169/2025-02 (GEDOP-LNO, 8258), aprovado 30/03/2026 — corte 13/03/2026 12:51;
--       passagens 100,22 + 17,91 = 118,13 dias; despacho 13/03/2026; 1 retorno.
--     22001.034103/2026-43 (lotado na GECOPE; lotação extra GEFOE, 8267), aprovado
--       30/03/2026 — corte 30/03/2026 01:03; 46,57 dias; despacho 30/03/2026. Os 5 processos
--       desse fiscal correram na GEFOE (resultado 08.csv).
--
-- NULO NÃO É ZERO. Em despachado e em tramitação, tempo NULL vem sempre com o motivo em
-- `conferencia` ou com aberto_ja_pronto = true. Zero dias só aparece se a passagem durou de
-- fato zero dias.
--
-- DIFERENÇAS PARA processos.tempo_suite (que continua existindo e alimentando a tela de
-- Processos; unificar é a E7):
--   · corta na ida à GECOPE que resultou na aprovação — tempo_suite soma passagens
--     posteriores e deixa a última passagem aberta crescendo até hoje;
--   · compara `capacity`, não o texto da sigla;
--   · lotação do fiscal lida de app_users na hora, não de processos.sigla_suite (que só
--     é recalculada quando muda o fiscal ou o distrito);
--   · recorta por historico_atribuicao_fiscal só na data das TROCAS (ver TROCA DE FISCAL);
--     o início da primeira atribuição é ignorado, porque antes do gatilho é sintético
--     (backfill de 2026-09-11). Trocas são raras (409 atribuições para ~405 processos).
--
-- Calculada na leitura, sem coluna gravada: ~25 mil eventos é pouco para o Postgres, e
-- assim o número nunca fica velho quando alguém corrige data de aprovação, status ou
-- lotação à mão.
--
-- ACESSO: mesma porta de vw_painel_desempenho_fiscais — security_invoker e meu_papel()
-- em ('admin', 'gerente'). historico_suite_eventos só era legível por admin; a policy
-- abaixo estende a leitura a gerente, senão o painel do gerente sairia sem tempo nenhum.
-- Idem historico_atribuicao_fiscal (admin e gerente), senão a troca de fiscal sumiria em
-- silêncio para quem não lê a tabela.
--
-- Execute no SQL Editor do Supabase, o arquivo inteiro: roda numa transação só (begin/commit),
-- então um erro no meio não deixa metade aplicada. Pode executar de novo, com um cuidado: as
-- cargas usam `on conflict do nothing` (não sobrescrevem valor corrigido à mão), mas
-- RECRIAM linha que alguém tenha apagado à mão, e os `delete` (lotação GECOPE, DIRED do
-- fiscal da GEROE) apagam de novo. Correção à mão nessas tabelas: registre aqui também.
-- ============================================================================

begin;

-- 1. De-para lotação → unidade no SUITE ----------------------------------------------

create table if not exists public.suite_unidades_lotacao (
  unidade      text primary key,        -- último trecho da lotação, em maiúsculas: 'GEDOP-LNO'
  capacity     numeric not null,        -- id da unidade no SUITE (historico_suite_eventos.capacity)
  observacao   text,
  atualizado_em timestamptz not null default now()
);

comment on table public.suite_unidades_lotacao is
  'Lotação do fiscal (último trecho de app_users.gerencia) → id da unidade no SUITE. Base da unidade do fiscal em vw_tempo_fiscal_processo.';

alter table public.suite_unidades_lotacao enable row level security;

-- Leitura só para quem usa o painel; escrita só pelo SQL Editor. O revoke não depende de a
-- RLS continuar ligada, e o grant explícito não depende dos privilégios padrão do Supabase.
revoke insert, update, delete, truncate on public.suite_unidades_lotacao from anon, authenticated;
grant select on public.suite_unidades_lotacao to authenticated;

drop policy if exists suite_unidades_lotacao_select on public.suite_unidades_lotacao;
-- (select ...) em vez de meu_papel() cru: sem o wrapper o Postgres reavalia a função
-- (subquery em app_users) por linha/loop em vez de cachear como InitPlan — medido
-- 2026-09-17, a causa real de ~5s na troca pro modo Replanilhamentos (recomendação oficial
-- de performance de RLS do Supabase; mesma autorização, plano de execução mais barato).
create policy suite_unidades_lotacao_select on public.suite_unidades_lotacao
  for select to authenticated
  using ((select public.meu_papel()) in ('admin', 'gerente'));

-- Ids medidos em resultados_sql/resultado 07.csv (2026-09-16): cada lotação casou com um
-- único id.
insert into public.suite_unidades_lotacao (unidade, capacity, observacao) values
  ('GEDOP-ARB', 8256, null),
  ('GEDOP-CRA', 8262, null),
  ('GEDOP-CRT', 8264, null),
  ('GEDOP-IGT', 8263, null),
  ('GEDOP-ITC', 8257, null),
  ('GEDOP-LNO', 8258, null),
  ('GEDOP-QXB', 8260, null),
  ('GEDOP-SOB', 8261, null),
  ('GEDOP-SQT', 8259, null),
  ('GEDOP-TAA', 8265, null),
  ('GEFOE',     8267, null),
  ('GEFRA',     8266, null),
  ('GELIC',    10445, null),
  ('GERED',     8253, null),
  ('GEROE',     8272, null),
  ('GEROA',     8254, 'Id levantado em 2026-09-16 (diagnostico-unidades-por-fiscal.sql): processos de 5 fiscais passam pela 8254 com sigla GEROA.'),
  ('DIFOR',     8244, 'Diretoria: processos de outras equipes também passam por ela. Único fiscal lotado aqui tem 1 processo, que de fato fica na DIFOR (resultado 06).')
on conflict (unidade) do nothing;

-- A versão anterior deste script mapeava a lotação GECOPE para a GEFOE. Isso agora é lotação
-- extra por fiscal (abaixo): a lotação GECOPE não tem unidade de fiscal.
delete from public.suite_unidades_lotacao where unidade = 'GECOPE';

-- 1b. Lotações extras de cada fiscal no SUITE -----------------------------------------

create table if not exists public.suite_unidades_fiscal (
  fiscal_matricula text    not null,  -- app_users.matricula = processos.fiscal_matricula
  capacity         numeric not null,  -- id da unidade no SUITE
  observacao       text,
  atualizado_em    timestamptz not null default now(),
  primary key (fiscal_matricula, capacity),
  check (capacity <> 10442)           -- a GECOPE nunca é unidade de fiscal
);

comment on table public.suite_unidades_fiscal is
  'Lotações do fiscal no SUITE além da gerência de app_users. Somadas à lotação em vw_tempo_fiscal_processo.';

alter table public.suite_unidades_fiscal enable row level security;
revoke insert, update, delete, truncate on public.suite_unidades_fiscal from anon, authenticated;
grant select on public.suite_unidades_fiscal to authenticated;

drop policy if exists suite_unidades_fiscal_select on public.suite_unidades_fiscal;
-- (select ...): ver comentário em suite_unidades_lotacao_select acima.
create policy suite_unidades_fiscal_select on public.suite_unidades_fiscal
  for select to authenticated
  using ((select public.meu_papel()) in ('admin', 'gerente'));

-- Fiscal lotado na GECOPE: os 5 processos correram na GEFOE (resultado 08.csv). Demais
-- lotações extras: levantar com docs/painel-fiscais/diagnostico-unidades-por-fiscal.sql e
-- cadastrar aqui depois de confirmadas.
insert into public.suite_unidades_fiscal (fiscal_matricula, capacity, observacao)
select distinct au.matricula, 8267,
       'Lotado na GECOPE; processos fiscalizados na GEFOE (resultado 08.csv, 2026-09-16).'
from public.app_users au
where upper(trim(regexp_replace(au.gerencia, '^.*/', ''))) = 'GECOPE'
  -- fiscal atual OU anterior (troca de fiscal): quem perdeu o processo continua precisando
  -- da unidade para o tempo do seu trecho (resultado 04: 43022.000041/2026-06)
  and (au.matricula in (select fiscal_matricula from public.processos where excluido_por is null)
    or au.matricula in (select fiscal_matricula from public.historico_atribuicao_fiscal))
on conflict (fiscal_matricula, capacity) do nothing;

-- Lotações extras confirmadas pelo usuário em 2026-09-16 (diagnostico-unidades-por-fiscal.sql,
-- resultado 02). Não entraram: a lotação GEDOP-SOB → GEDOP-CRT, corrigida em app_users; os
-- casos de um processo só (resultado 03: GEROA e DIRER são trâmite, GEDOP da obra não conta,
-- DIAES dos fiscais da GEDOP-LNO não conta, troca de fiscal tratada na view).
insert into public.suite_unidades_fiscal (fiscal_matricula, capacity, observacao)
values
  ('70024012', 8245, 'Lotado na GEFOE e na DIAES (usuário, 2026-09-16): 5 processos, 377 d na DIAES.'),
  ('70013819', 8245, 'Lotado na GEFOE e na DIAES (usuário, 2026-09-16): 2 processos, 120 d na DIAES.')
on conflict (fiscal_matricula, capacity) do nothing;

-- DIRED do fiscal da GEROE: cadastrada numa versão anterior deste script, desfeita pelo usuário
-- em 2026-09-16 e recadastrada por ele em 2026-09-17 (ver bloco abaixo), depois de ver DIRED
-- aparecer com dias reais em processos de Fábio Bonfim sinalizados como "não passou pela unidade".

-- Lotações extras confirmadas pelo usuário em 2026-09-17, ao investigar os processos com
-- conferência "não passou pela unidade do fiscal antes da GECOPE (ou DIFOR)":
--   · Luciano Denizardy (lotação GERED): nos 2 processos da lista, toda a análise correu na
--     GEFOE (93,9 + 63,9 + 1,0 d num; 6,4 + 0,9 d no outro) — nunca na GERED.
--   · Fábio Bonfim (lotação GEROE): usuário confirmou GEFOE, GERED e DIRED como extras dele.
insert into public.suite_unidades_fiscal (fiscal_matricula, capacity, observacao)
values
  ('70018519', 8267, 'Lotado na GERED; análise real corre na GEFOE (usuário, 2026-09-17): ~166 d em 2 processos, zero na GERED.'),
  ('70025116', 8267, 'Lotado na GEROE; extra GEFOE confirmada pelo usuário em 2026-09-17.'),
  ('70025116', 8253, 'Lotado na GEROE; extra GERED confirmada pelo usuário em 2026-09-17.'),
  ('70025116', 8243, 'Lotado na GEROE; extra DIRED confirmada pelo usuário em 2026-09-17 (revoga a exclusão de 2026-09-16).')
on conflict (fiscal_matricula, capacity) do nothing;

-- 2. Leitura do histórico ------------------------------------------------------------

-- A FK processo_id não tem índice; toda leitura aqui é por processo e em ordem de data.
create index if not exists historico_suite_eventos_processo_data_idx
  on public.historico_suite_eventos (processo_id, data_evento);

drop policy if exists historico_suite_eventos_select_gerente on public.historico_suite_eventos;
-- (select ...): ver comentário em suite_unidades_lotacao_select, mais acima no arquivo —
-- historico_suite_eventos é a tabela de 27 mil linhas, a mais afetada pelo anti-padrão.
create policy historico_suite_eventos_select_gerente on public.historico_suite_eventos
  for select to authenticated
  using ((select public.meu_papel()) = 'gerente');

-- Troca de fiscal: a view lê os fiscais anteriores. Policy permissiva, somada às existentes.
drop policy if exists historico_atribuicao_fiscal_select_painel on public.historico_atribuicao_fiscal;
-- (select ...): ver comentário em suite_unidades_lotacao_select, mais acima no arquivo.
create policy historico_atribuicao_fiscal_select_painel on public.historico_atribuicao_fiscal
  for select to authenticated
  using ((select public.meu_papel()) in ('admin', 'gerente'));

-- 3. A view --------------------------------------------------------------------------

-- create or replace: vw_painel_desempenho_fiscais depende desta view (2026-09-16), e um
-- drop falharia. Serve enquanto as colunas só forem ACRESCENTADAS no fim. Para remover,
-- renomear ou reordenar coluna: drop view vw_painel_desempenho_fiscais, drop view desta,
-- rodar este script e em seguida sql/create_vw_painel_desempenho_fiscais.sql.
create or replace view public.vw_tempo_fiscal_processo
with (security_invoker = true)
as
with proc as (
  select
    p.id                                                        as processo_id,
    p.processo                                                  as nup,
    upper(trim(coalesce(p.status, '')))                         as status_norm,
    p.data_aprovacao_gecope,
    p.fiscal_matricula
  from public.processos p
  where p.excluido_por is null
    and public.meu_papel() in ('admin', 'gerente')
), classificado as (
  select
    pr.*,
    case
      when pr.status_norm in ('APROVADO', 'ARQUIVADO')
       and pr.data_aprovacao_gecope is not null         then 'despachado'
      when pr.status_norm = 'APROVADO'                  then 'aprovado_sem_data'
      when pr.status_norm = 'ARQUIVADO'                 then 'arquivado_no_tramite'
      else                                                   'em_tramitacao'
    end                                                         as situacao
  from proc pr
), lotacao_fiscal as (
  -- Lotação de cada matrícula; order by au.id: matrícula duplicada em app_users não pode
  -- trocar a lotação.
  select distinct on (au.matricula) au.matricula, au.gerencia, m.capacity
  from public.app_users au
  left join public.suite_unidades_lotacao m
    on m.unidade = upper(trim(regexp_replace(au.gerencia, '^.*/', '')))
  where au.matricula is not null
  order by au.matricula, au.id
), atrib as (
  -- Atribuições do histórico em ordem; ultimo_fiscal = fiscal da atribuição mais recente.
  select
    af.processo_id,
    af.fiscal_matricula,
    af.inicio_atribuicao,
    row_number() over w                                         as n,
    lead(af.inicio_atribuicao) over w                           as proximo_inicio,
    last_value(af.fiscal_matricula) over (w rows between unbounded preceding
                                            and unbounded following) as ultimo_fiscal
  from public.historico_atribuicao_fiscal af
  where af.inicio_atribuicao is not null
    and af.processo_id in (select processo_id from proc)
  window w as (partition by af.processo_id order by af.inicio_atribuicao, af.id)
), trechos as (
  -- Histórico coerente (termina no fiscal atual, não nulo): um trecho por atribuição.
  select
    a.processo_id,
    a.fiscal_matricula,
    case when a.n = 1 then '-infinity'::timestamptz else a.inicio_atribuicao end as inicio,
    coalesce(a.proximo_inicio, 'infinity'::timestamptz)                         as fim
  from atrib a
  join classificado c on c.processo_id = a.processo_id
  where c.fiscal_matricula is not null
    and a.ultimo_fiscal = c.fiscal_matricula
  union all
  -- Sem histórico, ou histórico que não termina no fiscal atual: um trecho só.
  select c.processo_id, c.fiscal_matricula, '-infinity'::timestamptz, 'infinity'::timestamptz
  from classificado c
  where not exists (select 1 from atrib a
                     where a.processo_id = c.processo_id
                       and c.fiscal_matricula is not null
                       and a.ultimo_fiscal = c.fiscal_matricula)
), linhas as (
  -- Grão da view. Trecho de atribuição sem fiscal (nula no meio do histórico) não vira
  -- linha: o tempo dele não é de ninguém.
  select
    t.processo_id,
    t.fiscal_matricula,
    t.fiscal_matricula is not distinct from c.fiscal_matricula  as atual,
    min(t.inicio)                                               as inicio,
    max(t.fim)                                                  as fim
  from trechos t
  join classificado c on c.processo_id = t.processo_id
  where t.fiscal_matricula is not null
     or c.fiscal_matricula is null
  group by t.processo_id, t.fiscal_matricula, c.fiscal_matricula
), fiscais_do_processo as (
  -- Fiscal atual + todos os do histórico. Processo sem fiscal atual não herda unidades do
  -- histórico: fica sem unidade e cai na conferência, em vez de somar tempo para ninguém.
  select c.processo_id, c.fiscal_matricula
  from classificado c
  where c.fiscal_matricula is not null
  union
  select c.processo_id, af.fiscal_matricula
  from classificado c
  join public.historico_atribuicao_fiscal af
    on af.processo_id = c.processo_id
   and af.fiscal_matricula is not null
  where c.fiscal_matricula is not null
), unidades as (
  -- Lotação + lotações extras de todos os fiscais do processo; a GECOPE nunca entra.
  select distinct f.processo_id, x.capacity
  from fiscais_do_processo f
  left join lotacao_fiscal lf on lf.matricula = f.fiscal_matricula
  cross join lateral (
    select lf.capacity where lf.capacity is not null
    union
    select e.capacity from public.suite_unidades_fiscal e
    where e.fiscal_matricula = f.fiscal_matricula
  ) x
  where x.capacity <> 10442
), ev as (
  -- Mesma ordem das funções atuais de tempo_suite: ordem_evento é 0 no evento MAIS
  -- recente, então desempata em ordem decrescente.
  select
    h.processo_id,
    h.capacity,
    h.data_evento,
    lag(h.capacity)     over w                                  as capacity_anterior,
    lead(h.data_evento) over w                                  as proxima_data,
    row_number()        over w                                  as seq
  from public.historico_suite_eventos h
  where h.data_evento is not null
    and h.capacity is not null
    and h.processo_id in (select processo_id from proc)
  window w as (partition by h.processo_id order by h.data_evento, h.ordem_evento desc, h.id)
), marcado as (
  select
    ev.*,
    sum(case when capacity_anterior is distinct from capacity then 1 else 0 end)
      over (partition by processo_id order by seq)              as passagem
  from ev
), passagens0 as (
  select
    processo_id,
    passagem,
    min(capacity)                                               as capacity,
    min(data_evento)                                            as entrada,
    case when bool_or(proxima_data is null) then null
         else max(proxima_data) end                             as saida
  from marcado
  group by processo_id, passagem
), passagens as (
  -- idas_gecope = quantas passagens pela GECOPE (10442) já tinham começado até esta.
  -- Duas passagens na unidade do fiscal com valores diferentes têm GECOPE entre elas.
  select
    p0.*,
    count(*) filter (where p0.capacity = 10442)
      over (partition by p0.processo_id order by p0.passagem)   as idas_gecope
  from passagens0 p0
), corte as (
  -- GECOPE primeiro; a DIFOR só entra quando não houve ida à GECOPE até a aprovação. Para o
  -- fiscal lotado na própria DIFOR, esse corte deixa de fora a passagem que o define (sem
  -- tempo, conferência "não passou…") — nenhum caso assim em 2026-09-16.
  select
    c.processo_id,
    coalesce(max(pa.entrada) filter (where pa.capacity = 10442),
             max(pa.entrada) filter (where pa.capacity = 8244))  as corte,
    bool_and(pa.capacity <> 10442)                                as corte_na_difor
  from classificado c
  join passagens pa
    on pa.processo_id = c.processo_id
   and pa.capacity in (10442, 8244)
  where c.situacao = 'despachado'
    and pa.entrada < ((c.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza')
  group by c.processo_id
), na_unidade as (
  select
    c.processo_id,
    pa.passagem,
    pa.entrada,
    pa.saida,
    pa.idas_gecope,
    case c.situacao
      when 'despachado'    then k.corte is not null and pa.entrada < k.corte
      when 'em_tramitacao' then true
      else false
    end                                                         as conta,
    -- Passou pela unidade do fiscal DEPOIS da ida à GECOPE e até o dia da aprovação:
    -- correção devolvida sem voltar à GECOPE (ex.: DIFOR → fiscal → DIFOR). Fica fora do
    -- tempo — errar para menos é o custo assumido do corte —, mas vai para `conferencia`.
    (c.situacao = 'despachado'
      and k.corte is not null
      and pa.entrada >= k.corte
      and pa.entrada < ((c.data_aprovacao_gecope + 1)::timestamp at time zone 'America/Fortaleza'))
                                                                as entre_gecope_e_aprovacao
  from classificado c
  join passagens pa
    on pa.processo_id = c.processo_id
  join unidades un
    on un.processo_id = c.processo_id
   and un.capacity = pa.capacity
  left join corte k on k.processo_id = c.processo_id
), agregado as (
  -- Processo inteiro, sem recorte por fiscal: base do despacho, do aberto já pronto e da
  -- conferência.
  select
    processo_id,
    count(*)                                   filter (where conta)                     as passagens,
    max(saida)                                 filter (where conta)                     as ultima_saida,
    sum(extract(epoch from (coalesce(saida, now()) - entrada)))
                                               filter (where conta)                     as segundos,
    max(entrada)                               filter (where conta and saida is null)   as aberta_desde,
    bool_or(entre_gecope_e_aprovacao)                                                   as entre_gecope_e_aprovacao
  from na_unidade
  group by processo_id
), pedacos as (
  -- Cada passagem contada, recortada pelo trecho de cada fiscal. Passagem de duração zero
  -- fica no trecho em que entrou (senão sumiria da contagem de passagens).
  select
    t.processo_id,
    t.fiscal_matricula,
    t.fim,
    nu.passagem,
    nu.idas_gecope,
    nu.saida,
    greatest(nu.entrada, t.inicio)                              as ini,
    least(coalesce(nu.saida, now()), t.fim)                     as ate
  from trechos t
  join na_unidade nu
    on nu.processo_id = t.processo_id
   and nu.conta
  where greatest(nu.entrada, t.inicio) < least(coalesce(nu.saida, now()), t.fim)
     or (nu.entrada = coalesce(nu.saida, now()) and nu.entrada >= t.inicio and nu.entrada < t.fim)
), agregado_fiscal as (
  select
    processo_id,
    fiscal_matricula,
    count(distinct passagem)                                    as passagens,
    count(distinct idas_gecope)                                 as blocos,
    min(ini)                                                    as primeira_entrada,
    sum(extract(epoch from (ate - ini)))                        as segundos,
    -- passagem ainda aberta, no trecho que não terminou: é a fila de quem tem o processo agora
    max(ini) filter (where saida is null and fim = 'infinity'::timestamptz) as aberta_desde
  from pedacos
  group by processo_id, fiscal_matricula
), despacho as (
  select
    c.processo_id,
    k.corte,
    k.corte_na_difor,
    coalesce(a.ultima_saida, k.corte)                           as momento
  from classificado c
  join corte k on k.processo_id = c.processo_id
  left join agregado a on a.processo_id = c.processo_id
  where c.situacao = 'despachado'
), despacho_fiscal as (
  -- Fiscal do trecho em que o processo saiu da unidade. Trecho sem fiscal (atribuição nula no
  -- meio de um histórico que termina no atual, não nulo) não tem linha: vai para o atual.
  select distinct t.processo_id, coalesce(t.fiscal_matricula, c.fiscal_matricula) as fiscal_matricula
  from despacho d
  join classificado c on c.processo_id = d.processo_id
  join trechos t
    on t.processo_id = d.processo_id
   and d.momento >= t.inicio
   and d.momento <  t.fim
), com_historico as (
  select distinct processo_id from ev
), unidades_lista as (
  select processo_id, array_agg(capacity order by capacity) as unidades_fiscal
  from unidades
  group by processo_id
)
select
  c.processo_id,
  c.nup,
  c.situacao,
  l.fiscal_matricula,
  l.atual,
  lf.gerencia                                                   as fiscal_gerencia,
  case when l.inicio > '-infinity'::timestamptz then l.inicio end as atribuicao_inicio,
  case when l.fim    <  'infinity'::timestamptz then l.fim    end as atribuicao_fim,
  ul.unidades_fiscal,
  coalesce(af.passagens, 0)                                     as passagens_unidade,
  greatest(coalesce(af.blocos, 0) - 1, 0)                       as retornos_correcao,
  af.primeira_entrada,
  d.corte                                                       as entrada_gecope_aprovacao,
  coalesce(d.corte_na_difor, false)                             as corte_na_difor,
  (df.processo_id is not null)                                  as despacho_do_fiscal,
  o.responde_pelo_processo,
  -- Despachado sem passagem na unidade (conferência "não passou…") continua sendo despacho:
  -- a data cai na ida à GECOPE (ou à DIFOR, com corte_na_difor). Sem isso ele sumiria de
  -- todo recorte por período do painel. Só na linha do fiscal que despachou.
  case when df.processo_id is not null
       then (d.momento at time zone 'America/Fortaleza')::date
  end                                                           as data_despacho,
  -- Aberto já pronto: o PROCESSO somou menos de 1 dia na unidade (ver cabeçalho) — medido no
  -- processo inteiro, não no trecho, para uma troca não rotular como pronto quem só pegou o
  -- fim. Exige passagem: sem nenhuma, pode ser lotação extra não cadastrada. Marcado na linha
  -- que responde pelo processo e nas que têm passagem (explica o tempo nulo delas); conte
  -- processos prontos por responde_pelo_processo.
  coalesce(c.situacao = 'despachado' and a.passagens > 0 and a.segundos < 86400
           and (o.responde_pelo_processo or af.passagens > 0), false)
                                                                as aberto_ja_pronto,
  case when c.situacao in ('despachado', 'em_tramitacao') and af.passagens > 0
       then round((af.segundos / 86400.0)::numeric, 4)
  end                                                           as tempo_na_unidade_dias,
  case when (c.situacao = 'em_tramitacao' and af.passagens > 0)
         or (c.situacao = 'despachado' and af.passagens > 0 and a.segundos >= 86400)
       then round((af.segundos / 86400.0)::numeric, 4)
  end                                                           as tempo_fiscal_dias,
  case when c.situacao = 'em_tramitacao' and l.atual and af.aberta_desde is not null
       then round((extract(epoch from (now() - af.aberta_desde)) / 86400.0)::numeric, 4)
  end                                                           as dias_na_unidade_agora,
  coalesce(c.situacao = 'em_tramitacao' and l.atual and af.aberta_desde is not null, false)
                                                                as na_unidade_agora,
  -- Conferência é do processo: só na linha que responde por ele, para não contar o mesmo
  -- aviso duas vezes nem pendurá-lo em quem não despachou.
  case
    when not o.responde_pelo_processo
      then null
    when c.situacao = 'arquivado_no_tramite'
      then null
    when ul.processo_id is null
      then 'fiscal sem unidade no SUITE (lotação sem id, sem lotação extra, sem fiscal anterior com unidade)'
    -- Só as unidades do fiscal anterior contam: passagens na unidade do atual, se houver,
    -- ficam fora do tempo sem que nada mais avise.
    when lf.capacity is null
     and not exists (select 1 from public.suite_unidades_fiscal e
                      where e.fiscal_matricula = l.fiscal_matricula)
      then 'fiscal sem unidade no SUITE (conta só a unidade de outro fiscal do processo)'
    when h.processo_id is null
      then 'sem histórico do SUITE'
    when c.situacao = 'aprovado_sem_data'
      then 'APROVADO sem data de aprovação'
    when c.situacao = 'despachado' and d.corte is null
      then 'sem ida à GECOPE nem à DIFOR até a data de aprovação'
    -- Corte na DIFOR, mas a GECOPE veio depois da data gravada: a DIFOR é rota comum, e o
    -- mais provável é data de aprovação digitada errada, não o caso sem GECOPE.
    when c.situacao = 'despachado' and d.corte_na_difor
     and exists (select 1 from passagens g
                  where g.processo_id = c.processo_id
                    and g.capacity = 10442
                    and g.entrada >= ((c.data_aprovacao_gecope + 1)::timestamp
                                        at time zone 'America/Fortaleza'))
      then 'corte na DIFOR, mas foi à GECOPE depois da data de aprovação (data errada?)'
    when c.situacao = 'despachado' and coalesce(a.passagens, 0) = 0
      then 'não passou pela unidade do fiscal antes da GECOPE (ou DIFOR)'
    when c.situacao = 'despachado' and a.entre_gecope_e_aprovacao
      then 'voltou à unidade do fiscal entre a GECOPE (ou DIFOR) e a aprovação (fora do tempo)'
    when c.situacao = 'em_tramitacao'
     and c.status_norm in ('ANÁLISE FISCAL', 'DEVOLVIDO P/ REANÁLISE FISCAL')
     and a.aberta_desde is null
      then 'na fila do fiscal, mas fora da unidade no SUITE'
    when c.situacao = 'em_tramitacao' and coalesce(a.passagens, 0) = 0
      then 'ainda não passou pela unidade do fiscal'
    when exists (select 1 from atrib x where x.processo_id = c.processo_id)
     and not exists (select 1 from atrib x
                      where x.processo_id = c.processo_id
                        and x.ultimo_fiscal = c.fiscal_matricula)
      then 'histórico de atribuição não termina no fiscal atual (tempo todo para o atual)'
  end                                                           as conferencia
from linhas l
join classificado c         on c.processo_id = l.processo_id
left join lotacao_fiscal lf on lf.matricula = l.fiscal_matricula
left join agregado a        on a.processo_id = l.processo_id
left join agregado_fiscal af
       on af.processo_id = l.processo_id
      and af.fiscal_matricula is not distinct from l.fiscal_matricula
left join despacho d        on d.processo_id = l.processo_id
left join despacho_fiscal df
       on df.processo_id = l.processo_id
      and df.fiscal_matricula is not distinct from l.fiscal_matricula
left join com_historico h   on h.processo_id = l.processo_id
left join unidades_lista ul on ul.processo_id = l.processo_id
cross join lateral (
  select case when d.processo_id is not null then df.processo_id is not null
              else l.atual end                                  as responde_pelo_processo
) o;

comment on view public.vw_tempo_fiscal_processo is
  'Uma linha por processo não excluído × fiscal que o teve (atual = true para o fiscal de hoje): passagens pelas unidades dos fiscais do processo no SUITE (lotação + lotações extras), recortadas pelas datas de troca de fiscal; tempo na Fiscalização (corte na ida à GECOPE que resultou na aprovação, ou na DIFOR quando não houve GECOPE; retorno depois da aprovação fora; aberto já pronto sem tempo); data de despacho só na linha do fiscal que despachou; retornos. Restrita a admin e gerente.';

grant select on public.vw_tempo_fiscal_processo to authenticated;

commit;
