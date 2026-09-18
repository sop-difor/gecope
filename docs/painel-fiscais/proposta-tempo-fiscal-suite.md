# Tempo na Fiscalização e data de despacho a partir do histórico do SUITE — proposta

Status: **proposta, nada implementado** (2026-09-16). Decisões A e B tomadas (fim do doc). Falta localizar o cálculo atual de
`processos.tempo_suite` (`diagnostico-origem-tempo-suite.sql`) e montar o de-para das gerências.

## Regra de negócio (definida pelo usuário)

- O processo passa pela gerência do fiscal uma ou mais vezes: vai à GECOPE, e se houver
  inconsistência volta para correção.
- **Tempo na Fiscalização** = soma das permanências na gerência do fiscal **até a
  aprovação na GECOPE**.
- **Data de despacho** = a saída da **última passagem** pela gerência do fiscal antes da
  aprovação — é quando o processo saiu e não voltou mais.
- Só é despachado quem está com status APROVADO ou ARQUIVADO em `processos`.

## O caso de referência, lido no SUITE

`22001.146169/2025-02` · fiscal Kennedy Mayk Bezerra · SOP/DIFGR/GEDOP-LNO · aprovado na GECOPE
em 30/03/2026. Endpoint público `public-history` — o mesmo que o `sincronizar-suite` consulta.

| Evento no SUITE | Unidade (`capacity`) | Permanência |
|---|---|---|
| 14/10/2025 11:23 Encaminhado | 8258 GEDOP-LNO | 56,90 d |
| 10/12/2025 09:03 Atribuir responsável | 8258 GEDOP-LNO | 5 min |
| 10/12/2025 09:08 Alterou responsável | 8258 GEDOP-LNO | 43,31 d |
| 22/01/2026 16:41 → 23/02/2026 | 10442 GECOPE | (análise, devolve) |
| 23/02/2026 14:56 Processo Tramitado | 8258 GEDOP-LNO | 17,87 d |
| 13/03/2026 11:48 Atribuir responsável | 8258 GEDOP-LNO | 1 h 02 |
| 13/03/2026 12:51 Processo Tramitado | 10442 GECOPE | — |

Agrupando eventos seguidos na mesma unidade:

| Passagem | Entrada | Saída | Dias |
|---|---|---|---|
| 1 | 14/10/2025 11:23 | 22/01/2026 16:35 | 100,22 |
| 2 (retorno para correção) | 23/02/2026 14:56 | **13/03/2026 12:51** | 17,91 |
| | | **Total** | **118,13** |

Bate com o cálculo do usuário (118,13 dias) e fixa o despacho em **13/03/2026**.

### O que o formato do SUITE ensina

- Cada evento traz `date` (UTC), `status` ("Em análise no(a) SOP/DIFGR/GEDOP-LNO"),
  `permanency` (milissegundos até o próximo evento) e **`capacity`, o id numérico da
  unidade**: 8258 = GEDOP-LNO, 10442 = GECOPE, 8244 = DIFOR.
- **Eventos não são passagens.** "Atribuir responsável" e "Alterou responsável" acontecem
  dentro da unidade. Contar eventos daria 5 passagens; são 2 — e "quantas vezes voltou para
  correção" (1, aqui) é um indicador de retrabalho que só existe com esse agrupamento.
- O último evento de um processo parado tem `permanency` crescendo até agora: passagem
  aberta, sem saída.
- As datas estão em UTC. A data de despacho precisa ser tirada em `America/Fortaleza`, senão
  um despacho às 22h vira o dia seguinte.

## Problemas no desenho atual

1. **O histórico não é guardado.** O `sincronizar-suite` baixa o histórico de todo processo
   ativo a cada rodada, extrai sigla e data de chegada e descarta o resto. Qualquer métrica
   nova ou correção de regra exige baixar tudo de novo do SUITE.
2. **A data de despacho não é um fato do SUITE.** A view usa `data_aprovacao_gecope`
   (preenchida à mão) ou `ultima_atualizacao` (gravada em transição de status) — nenhuma das
   duas é a saída do processo da gerência.
3. **O cálculo de `tempo_suite` não está no repositório.** Não é versionado, revisável nem
   reproduzível — num painel que ordena pessoas nominalmente, é o número que mais precisa de
   auditoria.
4. **Unidade identificada por texto é frágil.** Siglas mudam em reestruturação (DIFGR,
   DIFOR…); `capacity` não.
5. **Sem corte na aprovação**, uma passagem posterior pela gerência (por outro motivo) entraria
   no tempo do fiscal.
6. `dias_na_fila` hoje é inferido de datas do formulário (`data_devolucao_correcoes`,
   `ultima_atualizacao`…). A entrada da passagem aberta no SUITE é o dado real.

Do próprio `sincronizar-suite`, de passagem: a carga de `processos` não filtra
`excluido_por is null`, e o `fetch` ao SUITE não tem timeout — uma resposta pendurada segura o
lote inteiro.

## Proposta

Princípio: **baixar do SUITE só o que mudou, guardar uma vez, calcular no banco uma vez por
mudança, e a view só ler colunas prontas.**

### 1. Guardar o histórico — `suite_eventos`

Uma linha por evento: `processo_id`, `ocorrido_em` (timestamptz), `unidade_id` (`capacity`),
`unidade_txt`, `evento` (`name`), `status_txt`. Chave única `(processo_id, ocorrido_em,
unidade_id)`, para o upsert ser idempotente.

Volume: ~56 eventos × ~405 processos ≈ **23 mil linhas, poucos MB**. Para o Postgres é nada, e
qualquer mudança de regra passa a ser recalculada **sem tocar no SUITE**.

### 2. Sincronizar só quando o histórico mudou

O `sincronizar-suite` já baixa o histórico — não há chamada nova ao SUITE. Acrescenta:

- uma assinatura por processo (`suite_hist_assinatura` = nº de eventos + data do último);
- se a assinatura não mudou, nada é gravado (o caso de quase toda rodada);
- se mudou, upsert dos eventos e uma chamada `rpc('recalcular_tempo_fiscal', {processo_id})`.

Arquivados continuam no ciclo diário que já existe; histórico parado, nenhum recálculo.

### 3. Calcular no banco — `recalcular_tempo_fiscal(processo_id)`

Função SQL versionada em `sql/`, na mesma convenção das demais:

1. Agrupa eventos seguidos da mesma `unidade_id` em passagens (entrada, saída).
2. Filtra as passagens na **unidade do fiscal** (ver decisão A).
3. Corta na aprovação: considera só passagens com entrada **antes** da aprovação na GECOPE.
4. Grava em `processos`:
   - `fiscal_tempo_dias` — soma das passagens (substitui `tempo_suite` no painel);
   - `fiscal_passagens` — quantas vezes o processo esteve com o fiscal (retornos = passagens − 1);
   - `fiscal_primeira_entrada`, `fiscal_ultima_saida` — a última saída é a **data de despacho**;
   - `fiscal_em_aberto` — está com o fiscal agora (passagem sem saída).

Um `select recalcular_tempo_fiscal(id) from processos` refaz a base inteira em segundos quando
a regra mudar.

### 4. Alimentar o painel

`vw_painel_desempenho_fiscais` passa a ler as colunas prontas — sem cálculo na consulta:

- `data_despacho` = `fiscal_ultima_saida` (dia em `America/Fortaleza`), só para APROVADO/ARQUIVADO;
- `tempo_suite_dias` = `fiscal_tempo_dias`;
- `dias_na_fila` = desde a entrada da passagem aberta.

E ganha dois indicadores que hoje não existem: **retornos para correção** por fiscal e distrito,
e, com o mesmo histórico, **tempo na GECOPE** (unidade 10442) — para separar o que é demora do
fiscal do que é demora da análise.

### 5. Carga inicial

Um backfill único dos ~405 processos, com a mesma concorrência baixa do job (6 por vez) para não
pesar no SUITE. A partir daí, só incremental.

### Mapa das unidades — `suite_unidades`

`unidade_id` (`capacity`) → sigla, distrito (gedop) e tipo (`FISCAL`, `GECOPE`, `DIFOR`…). É
ela que liga o fiscal (`app_users.gedop` = LIMOEIRO DO NORTE) à unidade 8258, em vez de
comparar texto.

## Decisões do usuário (2026-09-16)

- **A. Unidade do fiscal = gerência de LOTAÇÃO do fiscal**, não a da obra. Um fiscal da GEFOE
  que fiscaliza obra da GEDOP-ITC recebe os processos no SUITE pela GEFOE; olhar a gerência da
  obra deixaria essas passagens de fora. `suite_unidades` liga a lotação em `app_users` ao id
  da unidade no SUITE (`capacity`) — levantamento em `diagnostico-gerencias-fiscais.sql`.
- **B. Despachados sem data de aprovação na GECOPE serão corrigidos à mão** pelo usuário, um a
  um, antes da troca. Lista em `lista-despachados-sem-aprovacao.sql`. Não há regra de
  substituição: depois da correção, processo despachado sem aprovação é erro de cadastro, e o
  painel deve mostrá-lo como tal (Conferência da carga), não estimar uma data.
- **Excluídos (`excluido_por` preenchido) ficam fora de tudo**: histórico, recálculo, painel e
  também o `sincronizar-suite`, que hoje ainda os consulta no SUITE a cada rodada.

## Resultado dos diagnósticos (2026-09-16) — revisa a proposta

Arquivos em `resultados_sql/resultado 01..03.csv`.

### 01 · origem de `tempo_suite` — o histórico JÁ é guardado

A premissa "o histórico não é guardado" (problema 1) está **errada para o banco**, só vale para
o repositório. Existem, fora do repo:

- tabela `historico_suite_eventos`, e nenhum código do repo a grava — há outro alimentador
  (edge function publicada diferente da do repo, script externo ou job);
- tabela `historico_atribuicao_fiscal` (com `dias_suite`), gravada pelo trigger
  `trg_processos_historico_atribuicao_fiscal` quando muda `fiscal_matricula`;
- funções `calcular_tempo_suite_processo`, `atualizar_tempo_suite_processo` (conta a história
  por atribuição de fiscal: a mais antiga sem piso de data), `atualizar_tempos_suite`,
  `atualizar_tempos_suite_processos`, e o trigger `trg_atualizar_tempo_suite`;
- trigger `trg_processos_definir_sigla_suite` em `processos`.

Consequência: as seções 1 e 2 (tabela nova + sincronização) provavelmente viram "usar a tabela
que existe". Antes de desenhar, ler o código completo: `diagnostico-historico-suite-existente.sql`.
O `tempo_suite` atual é **por atribuição de fiscal**, não por unidade — confirmar se corta na
aprovação e se soma passagens de outras unidades.

### 02 · lotação dos fiscais — 18 gerências

11 GEDOPs/GEFOE cobrem a grande maioria (GEFOE 129 processos, CRT 49, SOB 43, IGT 36, ITC 25,
SQT 22, CRA 22, QXB 20, LNO 13, TAA 13, ARB 3). Casos que a regra "unidade = lotação" não resolve
sozinha — **decisão do usuário**:

- **SOP/GECOPE** (1 fiscal, 5 processos): a unidade do fiscal é a própria 10442, onde o processo
  é analisado — a soma misturaria fiscalização e análise.
- **SOP/DIFOR** (1 fiscal, 1 processo): 8244 é a diretoria, por onde o processo pode passar em
  trâmite de outros.
- **GERED (2 fiscais, 9 proc.), GEROE (1, 8), GELIC (1, 5), GEFRA (1, 3), GEROA (1, 1)**: fiscais
  lotados fora da DIFOR; `capacity` a descobrir e confirmar que o processo passa por essas
  unidades.

O `capacity` de cada unidade deve sair de `historico_suite_eventos` (se guardar o id), não de
leitura manual no SUITE.

### 03 · despachados sem aprovação — 28, todos ARQUIVADO

Nenhum APROVADO sem data. Achado: **3 foram arquivados ainda em análise** (status anterior
ANÁLISE FISCAL / AGUAR. ANÁLISE / EM ANÁLISE — `22001.124578/2026-21`, `43022.009353/2026-77`,
`43022.009381/2026-94`): não são despachos, não há data a corrigir. A regra "ARQUIVADO =
despachado" só vale se o status anterior ao arquivamento for aprovação; os outros 25 têm
`status_pre_arquivamento` nulo (arquivados antes de a coluna existir) e dependem da correção
manual.

### 04 · o que já existe, lido por inteiro

**`historico_suite_eventos`** — 24.644 eventos, alimentação iniciada por volta de 10/09/2026.
Colunas: `processo_id`, `nup`, `data_evento`, `ordem_evento` (0 = mais recente), `capacity` (id
da unidade), `unidade_sigla` (só o último trecho: "GECONT", "ASJUR"), `nome`, `status`,
`permanency`, `dados_brutos` (o JSON do SUITE), `chave_evento` (hash, único — upsert
idempotente). RLS: select só para admin. **Quem grava não está no repo**: a
`sincronizar-suite` do repositório é de 06/08/2026 e não escreve nessa tabela, logo a versão
publicada é outra. Publicar a do repo por cima **cortaria o histórico**.

**Cálculo atual** (`calcular_tempo_suite_periodo`): cada evento dura até o próximo evento (de
qualquer unidade); soma os eventos cuja `unidade_sigla` = último trecho de
`processos.sigla_suite`, recortados pela janela de atribuição do fiscal. Somar eventos
seguidos dá o mesmo que somar passagens — **a soma já segue a regra do usuário**, com a unidade
de lotação (o trigger `trg_definir_sigla_suite` preenche `sigla_suite`: Fortaleza pela
`app_users.gerencia`, interior por `distrito_operacional.suite` da GEDOP do fiscal).

`historico_atribuicao_fiscal` (409 linhas, backfill sintético em 11/09/2026 + trigger na troca
de fiscal) guarda `dias_suite` por fiscal; `processos.tempo_suite` = período aberto (fiscal
atual).

**O que falta ou está errado no cálculo atual:**

1. **Sem corte na aprovação** — passagem pela unidade depois da aprovação soma, e a última
   passagem aberta cresce até `now()`.
2. **Não grava a data de despacho** (última saída), nem nº de passagens / retornos.
3. **Fiscal lotado na GECOPE** soma o tempo de análise da própria GECOPE; **DIFOR** idem.
4. **Unidade por texto** (último trecho da sigla), embora a tabela tenha `capacity`.
5. **Duas implementações divergentes**: `calcular_tempo_suite_processo` (unidade pela
   `app_users.gerencia`, sem janela) é chamada por `atualizar_tempos_suite_processos` e como
   reserva quando não há atribuição aberta — sobrescreve `tempo_suite` com outra regra.
6. **Trigger por linha**: `trg_atualizar_tempo_suite` é `for each row` — gravar 56 eventos de um
   processo recalcula o processo 56 vezes (deveria ser `for each statement` ou chamado pelo job).
7. `sigla_suite` só é recalculada quando muda o fiscal ou o distrito — fiscal que muda de
   lotação deixa a sigla velha.
8. Nenhuma dessas funções, tabelas e triggers está versionada em `sql/`.

**Proposta revista:** sem tabela nova e sem mudar a sincronização. Uma função nova (versionada)
lê `historico_suite_eventos`, agrupa passagens por `capacity`, filtra a unidade do fiscal,
corta na aprovação e grava `fiscal_tempo_dias`, `fiscal_passagens`, `fiscal_ultima_saida`
(despacho) e `fiscal_em_aberto`; a view passa a ler essas colunas. Antes: conferir o caso de
referência com `diagnostico-passagens-caso-referencia.sql` e o de-para lotação × `capacity` com
`diagnostico-unidades-suite.sql`, e trazer o código publicado da `sincronizar-suite` para o
repo (`supabase functions download sincronizar-suite`).

## Valores zerados — decidido: conservar (usuário, 2026-09-16)

`resultado 05.csv`: 88 processos com os seis valores zerados — 28 despachados (27 deles ARQUIVADO sem
aprovação, os mesmos 28 de `resultado 03` menos o APROVADO 08012.654842/2026-04), 56 na fila e 4 na
GECOPE. O usuário: são processos em tramitação ou **arquivados no meio do trâmite** — conservar.

Consequência que fecha a decisão B: **ARQUIVADO sem data de aprovação não é despacho**, é arquivamento
no trâmite. Não há data a corrigir à mão.

## Regra para processos em tramitação (usuário, 2026-09-16)

Nem aprovado nem arquivado: conta só o tempo na unidade do fiscal — há quanto tempo está lá.
Despachado continua cortado na aprovação da GECOPE.

## Resultados 06 e 07

- **06 — caso de referência reproduzido no banco:** passagens 7 (100,22 d) e 10 (17,91 d) na 8258,
  soma 118,13, última saída 13/03/2026 12:51. A tabela existente basta.
- **`unidade_sigla` não serve de chave:** traz nome de evento em vez de sigla ("ARQUIVADO" na 3844,
  "APTO A PUBLICAR DOE" na 2802, "PROCESSO INICIADO" na 9517) e "ASJUR" aparece com 2802 e 8238.
  Chave = `capacity`.
- **Fiscal lotado na GECOPE** (22001.034103/2026-43): o `tempo_suite` atual (1,33) é o tempo de
  **análise** na GECOPE; a fiscalização correu na GEFOE (46,57 d).
- **DIFOR** (43022.009563/2026-65): o processo está de fato na DIFOR — a regra de lotação serve.
- **GERED** (22001.089693/2026-41): 111,11 d na 8253, bate com `tempo_suite`.
- **07 — de-para:** cada lotação casa com um único `capacity` (GEFOE 8267, LNO 8258, …); GEROA sem
  id (1 processo). **26 processos têm histórico sem nunca passar pela unidade do fiscal** — hoje saem
  com `tempo_suite` zero, apresentado como dado.

## Solução adotada (2026-09-16)

`sql/create_vw_tempo_fiscal_processo.sql`: tabela `suite_unidades_lotacao` (lotação → `capacity`,
GECOPE mapeada para GEFOE, a conferir), índice em `historico_suite_eventos (processo_id,
data_evento)`, leitura do histórico estendida a gerente e a view `vw_tempo_fiscal_processo`,
**calculada na leitura** (sem coluna gravada, sem trigger, sem mexer na sincronização) — uma linha
por processo com situação (`despachado`, `em_tramitacao`, `arquivado_no_tramite`,
`aprovado_sem_data`), passagens, retornos, tempo, data de despacho, dias na unidade agora e motivo de
conferência (nulo nunca vira zero). Conferência contra o painel atual:
`conferencia-tempo-fiscal.sql`. Depois de conferido: `vw_painel_desempenho_fiscais` e
`mapa-obras.js` passam a ler a view nova, e arquivado no trâmite deixa de aparecer como "na GECOPE".
`processos.tempo_suite` e suas funções ficam como estão até a E7.
