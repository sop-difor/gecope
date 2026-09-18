# Tempo na Fiscalização pelo histórico do SUITE — revisão

Base de dados do painel (antes da troca na view do painel e no JS). Encerrada em 2026-09-16 com
**2/2 `APROVADO`** em duas rodadas.

| Revisor | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |
| `rev-seguranca` | BLOQUEADO | APROVADO |

Arquivos: `sql/create_vw_tempo_fiscal_processo.sql`, `conferencia-tempo-fiscal.sql`,
`diagnostico-passagens-fiscal-gecope.sql`.

## Rodada 1

- **correção (bloqueante):** o corte pela data de entrada ≤ aprovação somava passagem posterior à
  aprovação (processo aprovado volta à unidade para assinatura) sem aviso. → Corte passou a ser a
  entrada da última ida à GECOPE (10442) até o dia da aprovação.
- **segurança (bloqueante):** `set_config(..., false)` na conferência deixaria o e-mail do admin
  na conexão do editor. → `true`.
- Menores tratados: em tramitação o painel lê `dias_na_unidade_agora`; eventos sem `capacity`
  ignorados; retorno só conta com GECOPE no meio; arquivado no trâmite sem conferência;
  revoke de escrita e grant select na tabela de-para; diagnóstico dos processos do fiscal lotado
  na GECOPE (mapeado para a GEFOE).

## Rodada 2 — observações não bloqueantes

- Correção devolvida sem nova ida à GECOPE (DIFOR → fiscal → DIFOR → aprovação) fica fora do
  tempo. → Tratado: vai para `conferencia` ("voltou à unidade do fiscal entre a GECOPE e a
  aprovação").
- Processo reaprovado depois de diligência que mantém a `data_aprovacao_gecope` antiga corta no
  ciclo antigo — é cadastro, não view. **Avisar o usuário.**
- Diagnóstico agrupava por NUP e não ignorava `capacity` nulo. → Corrigido.
- Registrados, fora do escopo: `meu_papel()` com `limit 1` sem `order by`; confirmar se
  `atualizar_tempo_suite_processo(uuid)` (SECURITY DEFINER) é chamável por RPC.

## Conferência no banco (resultados 08 e 09, 2026-09-16)

- **08 — fiscal lotado na GECOPE:** os 5 processos correram na GEFOE (8267). Mapeamento confirmado
  (034103: 46,57 d; 159008: 102,16 + 43,03; 005021: 47,06 + 45,07; 101073: arquivado no trâmite;
  130009: em tramitação, na GEFOE há 43 d).
- **09 — 407 processos:** 303 despachados, 76 em tramitação, 28 arquivados no trâmite.
  - Caso de referência: 118,13 d, despacho 13/03/2026 (hoje o painel diz 30/03), 1 retorno.
  - Despachados sem conferência (273): 186 com tempo igual, 74 menor, 13 maior; média 45,8 → 42,2 d,
    mediana 25,0 → 22,1 d. Despacho novo sempre ≤ o de hoje (mediana −6 dias).
  - Conferência: 18 "não passou pela unidade do fiscal antes da GECOPE", 9 "sem ida à GECOPE até a
    data de aprovação" (datas de aprovação anteriores ao próprio processo — ex.: 22001.099992/2026-94
    aprovado em 05/08/2025), 4 "na fila mas fora da unidade", 2 "voltou entre GECOPE e aprovação",
    1 lotação sem unidade (GEROA).
  - Fila: 62 processos, 58 com dias na unidade; mediana da diferença para hoje = 0.
  - **Achado para decisão do usuário: 57 dos 273 despachados têm menos de 1 dia na unidade do
    fiscal** — quase todos NUP 43022 (aberto na própria SOP e enviado à GECOPE em minutos). ~40 já
    tinham tempo_suite < 1; ~15 tinham tempo grande só por passagens depois da aprovação.
  - Diagnósticos: `diagnostico-passagens-casos-conferencia.sql`, `diagnostico-reaprovacao.sql`.

## Rodadas 3 e 4 — aberto já pronto, lotações extras, lista de datas (2026-09-16)

Decisões do usuário: (1) despachado com menos de 1 dia na unidade = "aberto já pronto", conta
como despacho, tempo vazio; (2) há fiscais com mais de uma lotação no SUITE → tabela
`suite_unidades_fiscal`, somada à lotação; GECOPE nunca é unidade de fiscal; fiscal lotado na
GECOPE → GEFOE.

| Revisor | Rodada 3 | Rodada 4 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |
| `rev-seguranca` | APROVADO | — |

- Rodada 3 (bloqueante): despachado sem passagem na unidade ficava sem data de despacho e sumia
  dos períodos (18 no resultado 09). → `data_despacho = coalesce(última saída, ida à GECOPE)`.
  `aberto_ja_pronto` segue exigindo passagem (sem passagem pode ser lotação extra não
  cadastrada; tempo NULL + conferência) — aceito pelo revisor.
- Os 9 "sem ida à GECOPE até a data de aprovação" ficam sem data de despacho até a correção
  (`lista-datas-aprovacao-suspeitas.sql`).
- Pendente: retornos com lotação extra podem contar a primeira chegada a outra unidade do
  fiscal como retorno — rever quando as extras forem cadastradas.
- Segurança: `resultados_sql/` tem nomes de fiscais e está fora do `.gitignore` — decidir antes
  do commit.

## Lista de datas e unidades por fiscal (2026-09-16, pasta resultados_sql renumerada)

O usuário limpou `resultados_sql/` e recomeçou a numeração: `resultado 01` = lista de datas
suspeitas, `resultado 02` = unidades por fiscal (os CSV antigos citados acima não estão mais lá).

- **Datas:** depois das correções do usuário restam 19 — 1 motivo B (22001.101068/2025-02,
  nenhuma passagem pela GECOPE no SUITE) e 18 motivo D. Em vários D as idas à GECOPE depois da
  aprovação duram horas (fluxo pós-aprovação?); em outros, semanas (reanálise?). Pergunta ao
  usuário se o retorno ao distrito + GECOPE depois da aprovação é fluxo normal.
- **Unidades:** GEROA = 8254 (entrou no de-para). Candidatas a lotação extra, por volume:
  Antonio Rolim → DIAES 8245 (5 proc, 377 d; GEFOE 12 d), Silvio Gentil → DIAES (2 proc, 120 d;
  GEFOE 0), Vicente de Sousa → GEDOP-CRT 8264 (4 proc, 262 d; SOB 0), Fábio Bonfim → DIRED 8243
  (4 proc, 46 d). Casos de 1 processo (Messias/Leonardo → DIAES, Edilson/Leandro/Justiniano/Edgar
  → GEROA, Tathiane → IGT, Roberto Colares → SOB, Luciano → ITC, Roberto Xavier → ITC, Antônio
  Caio → DIRER) aguardam o usuário.

## Rodada 5 — DIFOR, retorno depois da aprovação, extras confirmadas (2026-09-16)

Decisões do usuário:
- **Motivo B → corte na DIFOR.** Sem ida à GECOPE até a aprovação, mas com passagem pela DIFOR
  (a GECOPE fica dentro dela): o corte é a entrada da última passagem pela DIFOR até o dia da
  aprovação. Coluna nova `corte_na_difor`. Caso: 22001.101068/2025-02.
- **Motivo D → fora de tudo.** Voltar ao fiscal e à GECOPE depois da aprovação é exceção, de
  mensuração difícil: não entra em tempo, retorno nem despacho (o corte já garantia). O motivo D
  saiu de `lista-datas-aprovacao-suspeitas.sql`.
- **Extras cadastradas:** Antonio Rolim e Silvio Gentil → DIAES (8245); Fábio Bonfim → DIRED
  (8243; o "GEFOE" da mensagem foi lido como GEROE, a lotação dele em app_users — ele não tem
  passagem na GEFOE). Vicente de Sousa: lotação corrigida em app_users para GEDOP-CRT, sem extra.
- **Casos de um processo:** `lista-lotacao-extra-um-processo.sql` traz os processos (trajeto,
  atribuições de fiscal, lotados na unidade) para decidir entre lotação extra, caso isolado ou
  troca de fiscal.

| Revisor | Rodada 5 |
|---|---|
| `rev-correcao` | APROVADO |

Observações aplicadas: B da lista e conferência da view avisam quando o corte caiu na DIFOR mas
houve GECOPE depois da data (DIFOR é rota comum; indica data errada); texto "não passou… (ou
DIFOR)"; lista nova exclui APROVADO sem data, como a view. Não aplicadas: motivo C não verifica a
distância da saída da DIFOR; `atribuicoes_fiscal` lê `processo_id` via jsonb — se vier vazia em
todas as linhas, o nome da coluna é outro.

## Rodada 6 — casos de um processo, troca de fiscal (2026-09-16)

Resultado 03 (`lista-lotacao-extra-um-processo.sql`) e decisões do usuário:
- **Setores do trâmite não são unidade do fiscal:** GEROA (orçamentos; ex. 43022.003611/2025-21
  foi à GEROA antes da aprovação) e DIRER. Nada cadastrado para Edilson, Leandro, Justiniano,
  Edgar e Antônio Caio.
- **GEDOP do distrito da obra não conta:** "o processo só chega ao fiscal quando passa por onde
  ele está lotado", mesmo tramitado por engano pelo distrito da obra (ex. 43022.012557/2025-12).
- **DIAES dos fiscais da GEDOP-LNO (Messias, Leonardo): não conta.**
- **Fábio Bonfim (GEROE): nenhuma lotação extra** — a DIRED da rodada 5 é apagada pelo script.
- **Troca de fiscal conta para o atual:** as unidades (lotação + extras) dos fiscais anteriores em
  `historico_atribuicao_fiscal` entram nas unidades do processo; tempo vai ao fiscal atual, sem
  recorte por data de atribuição. Casos: 43022.006416/2026-33 (SOB → ITC, 14/09) e
  22001.170420/2025-41 (IGT → TAA, 16/09). Coluna nova `fiscais_anteriores`; policy de select
  em `historico_atribuicao_fiscal` para admin/gerente.

| Revisor | Rodada 6 |
|---|---|
| `rev-correcao` | APROVADO |
| `rev-seguranca` | APROVADO |

Aplicado das observações: processo sem fiscal atual não herda unidades do histórico; conferência
"fiscal atual sem unidade no SUITE (conta só a unidade do fiscal anterior)"; script numa
transação (`begin`/`commit`); cabeçalho corrigido sobre reexecução (deletes e cargas refazem).
Não aplicado, registrado: anterior lotado em unidade de rota (GEFOE, DIFOR) ou atribuição errada
e logo corrigida somam tempo sem aviso (`fiscais_anteriores` serve de auditoria); estado de RLS e
grant de `historico_atribuicao_fiscal` não conferido — se a view der "permission denied", falta
`grant select` (não dar às cegas com RLS desligada). O caso 43022.006416/2026-33 vai aparecer com
~58 d "na unidade agora" para um fiscal que assumiu há dois dias — é a regra escolhida.

## Rodada 7 — troca de fiscal com recorte por data (2026-09-16)

O usuário revisou a regra da rodada 6: **as unidades dos fiscais anteriores contam, o tempo do
fiscal antigo fica com o fiscal antigo, e o novo fiscal começa um tempo novo.**

A view mudou de grão: **uma linha por processo × fiscal**. Trecho = período de cada atribuição
(`historico_atribuicao_fiscal`), da troca até a troca seguinte; o primeiro começa em -infinity
(início de backfill é sintético). Passagens são recortadas pelos trechos. Despacho vai para o
fiscal do trecho em que o processo saiu da unidade. Colunas novas: `fiscal_matricula`, `atual`,
`atribuicao_inicio/fim`, `despacho_do_fiscal`, `responde_pelo_processo` (linha que leva
conferência e aberto já pronto). Regra de contagem para o painel no cabeçalho da view: carga e
fila por `atual`; despacho por `despacho_do_fiscal`; processo e aviso por
`responde_pelo_processo`; tempo somando as linhas do fiscal.

Casos: 43022.006416/2026-33 — anterior (SOB) 31,3 + ~56 d, 1 retorno; atual (ITC) ~2 d desde
14/09, 0 retorno, na unidade há ~2 d. 22001.170420/2025-41 — despacho e 64,1 d com o anterior
(IGT); atual (TAA) sem tempo e sem despacho.

| Revisor | Rodada 7a | Rodada 7b |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |

- 7a (bloqueante): aviso de conferência e aberto já pronto na linha errada quando a troca é
  posterior ao despacho → `responde_pelo_processo`; despacho sumia se caísse em atribuição com
  fiscal nulo → vai para o fiscal atual. (A leitura do revisor sobre o caso 22001.170420 estava
  errada — o trajeto do resultado 03 para antes do corte —, mas a correção estrutural valeu.)
- Conferência: compara com `tempo_suite` a soma das linhas do processo.
- Pendente para a troca da view do painel: linha de fiscal anterior sem passagem sai com tempo
  nulo e sem motivo; o painel precisa seguir a regra de contagem. Como o tempo de quem NÃO
  despachou (ex.: fiscal anterior de processo em tramitação) aparece no painel é decisão a tomar.

## Conferência no banco — resultado 04 (2026-09-16)

- 411 linhas, 407 processos; exatamente 1 `atual` e 1 `responde_pelo_processo` por processo.
- 304 despachados (todos com data), 75 em tramitação, 28 arquivados no trâmite. 56 abertos já
  prontos. Tempo dos despachos com tempo: n=232, média 54,6 d, mediana 34,3 d. Despacho novo
  sempre ≤ o de hoje (mediana −5,5 dias). Fila: 59 de 75 na unidade do fiscal agora.
- 4 processos com troca, todos como esperado (43022.006416/2026-33: 87,1 d anterior + 2,3 d
  atual; 22001.170420/2025-41 e 22001.073676/2025-10: despacho com o anterior da IGT).
- Conferência (20): 14 "não passou pela unidade" (consequência das decisões: DIRED do fiscal da
  GEROE, DIAES dos fiscais LNO, GEDOP da obra); 2 sem matrícula de fiscal em `processos`
  (43022.011330/2025-41, 43022.008976/2025-41); 2 na fila fora da unidade (43022.002863/2026-13
  está na GEROA há 182 d); 1 voltou entre GECOPE e aprovação; 1 fiscal anterior lotado na GECOPE
  sem a extra GEFOE (43022.000041/2026-06) → insert da extra passou a incluir fiscais do
  histórico de atribuição.

## Troca da view do painel e do JS (2026-09-16)

Decisões do usuário: as 2 matrículas faltantes foram cadastradas; os 2 "na fila fora da unidade"
ainda estão tramitando. **Troca de fiscal no painel: conta só o tempo de quem despachou, desde que
assumiu, até o despacho. O tempo do fiscal anterior que não despachou não é contabilizado em lugar
nenhum** (nem na média dele, nem na do distrito, nem somado ao de quem despachou).

- `vw_painel_desempenho_fiscais` continua com uma linha por processo: LEFT JOIN com a linha
  `responde_pelo_processo` da view de tempo. Novas: `situacao`, `tempo_fiscal_dias` (só
  despachado), `aberto_ja_pronto`, `retornos_correcao`, `conferencia`, `dias_na_unidade`,
  `fiscal_atual_matricula`; fiscal_* passam a ser de quem responde. Saíram `tempo_suite_dias` e
  `dias_na_fila`. Script em transação, drop + create.
- `vw_tempo_fiscal_processo` virou `create or replace` (o painel depende dela).
- `conferencia-tempo-fiscal.sql` lê os valores antigos de `processos`.
- JS: tempo médio por `tempoFiscal`; arquivado no trâmite, aprovado sem data e processo sem
  cálculo ficam fora de fila, despacho e GECOPE (contados na conferência da carga, com despachado
  sem tempo e aberto já pronto); cartão mostra dias com o fiscal no SUITE.
- Teste headless com dados sintéticos: KPIs do nível 1 (12 meses, régua equipe) iguais a um
  oráculo calculado das linhas cruas; zero erros de console.

| Revisor | Rodada 8 |
|---|---|
| `rev-correcao` | APROVADO |

Observações aplicadas: aprovado sem data e processo sem linha na view de tempo contados na
conferência; rótulo do cartão sem dias lê `conferencia`; textos dos "i" citam DIFOR e data da ida
à GECOPE; cidade só com arquivados no trâmite fora do ranking. Não aplicadas, registradas:
43022.000041/2026-06 soma 21,2 d numa unidade de outro fiscal do processo (já em `conferencia`);
cabeçalho do painel ainda cita `processos.js` como consumidor (vale a partir da E7) e correlações
medidas com `tempo_suite`.
