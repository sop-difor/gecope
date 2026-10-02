# Revisão do Mapa de Obras — 02/10/2026

Escopo desta revisão: `assets/js/mapa-obras.js` (obras, replanilhamentos, elétrica), `utils.js` (carregarBiblioteca) e `sql/create_vw_painel_desempenho_fiscais.sql`. **Atenção ao PR:** contra `main` a branch toca 21 arquivos (inclui `processos.js`, `index.html`, `core/auth.js`, `curva_abc.js`, `financeiro.js`, vindos de commits anteriores ainda não mergeados); quem aprovar deve olhar o diff inteiro, não só estes três.
Método: 6 revisores somente-leitura, um por faixa do arquivo, mais uma passada do `code-review` sobre o diff da branch anterior. Os achados foram conferidos no código antes de corrigir. Nenhum foi conferido contra o banco real.

Branch: `fix/mapa-obras-revisao-2026-10-02`.

## 1. Corrigido neste PR

### Carga de dados
| Problema | Correção |
|---|---|
| `loadData()` sem proteção de concorrência: duas cargas simultâneas zeravam e depois empilhavam as obras (duplicadas, KPIs inflados) | Sequência `_loadSeq`: só a última carga preenche `DB`; erro de carga superada é ignorado |
| `nObras` contava só as obras carregadas. Na carteira ativa, a obra ativa de um contrato com outras encerradas virava "obra única" e recebia a ficha e os aditivos do contrato inteiro | Nova consulta `fetchObrasPorContrato` (só carteira ativa) guarda o nº de obras do contrato na base inteira. Cache sobe para `v14` com o campo `nobras`. Se a consulta falhar, cai na contagem antiga |
| `fetchComTimeout` limpava o timer ao chegar os headers; corpo travado pendurava o painel | O timer só para depois de ler o corpo. O relógio começa quando a requisição entra em execução (fila de 6 simultâneas) |
| Paginação por offset podia duplicar ou perder linha se o SIGSOP gravasse no meio | Confere `linhas lidas = total`, refaz 1 vez; `loadData` deduplica por `id_obra` |
| `inListFilter` não codificava os valores (`&`, `#`, `+`, `%` num contrato quebravam a consulta) | Cada item é escapado (`\`, `"`) e passa por `encodeURIComponent` |
| `invalidateSessionCache` limpava só o escopo atual | Limpa `ativa` e `historico` (também no botão de atualizar, hoje morto) |
| `loadData()` inicial sem `.catch` | Mostra "Erro ao montar o painel" |
| `medObraStats` recalculado por obra a cada render/hover | Resultado guardado em `o.medStats` no `loadData` |
| `carregarBiblioteca('jspdf')` considerava pronto sem o autotable; sem timeout no `<script>` | `pronta()` exige o plugin; timeout de 30 s |

### Inconsistências de dados
| Problema | Correção |
|---|---|
| "Prazo acumulado" dos aditivos crescia do aditivo mais novo para o mais antigo | Acumula em ordem cronológica; prorrogação negativa mostra `−` |
| Prazo original vazio: bloco saía em 100% com o texto "dobraram o prazo" | "Prazo original não informado na base"; o painel de prazo aparece mesmo sem aditivos nem datas |
| Obra concluída aparecia "prazo vencido" e "paralisada" em vermelho | Alertas de prazo e paralisação só para obra não encerrada; cartão neutro quando encerrada |
| Medição acima de 100% ficava escondida (barra e saldo travados) | Novo ponto de atenção no Resumo |
| `#segMetric` não invalidava o cache de agregação | `invalidateAggCache()` na troca de métrica |
| `buildEletricaPane` usava data UTC (depois das 21h virava amanhã) | `hojeISOLocal()`; `sessionStorage` com try/catch |
| Filtro dos cards da Elétrica era invisível e "Limpar tudo" não o limpava | Chip `Elétrica: …` e limpeza em `clearAllFilters` |
| Após agendar, cancelar ou enviar relatório só o painel lateral atualizava | `render()` completo (mapa e lista) |
| Lista de fila da janela do fiscal e do distrito cortava em 15 sem priorizar atrasados | Ordena por `ordemMeta` e depois por dias |
| Título "Cidades (N)" contava cidades que a lista omitia | Usa `ents.length` |
| `meta_estourada` usava `current_date` (UTC) | `(now() at time zone 'America/Fortaleza')::date` — **ver pendência P0** |

### Lentidão e interação
- Hover de distrito refazia o painel inteiro em cada mouseover e mouseout: agora 1 render por quadro (`renderPanelHover`).
- Mouseout de distrito e de cidade apagava tooltip e estado do vizinho quando o mouseover do vizinho chegava antes: agora só limpa se a camada ainda é a vigente.
- `zoomend` + `moveend` rodavam `updateLabels` duas vezes por zoom: agora coalescem num `requestAnimationFrame`.
- `setLayer(groupLayer)` rodava depois de aplicar `pointer-events` e `sem-amostra`; o Leaflet recria o `<path>` ao readicionar, então o estado se perdia. Invertida a ordem.
- Atalhos Ctrl/Meta/Alt (Ctrl+R, Ctrl+F, Ctrl+C) eram engolidos com um dropdown aberto.
- Troca de tema reabria o modal da obra errada (outra janela no `#modal`) e apagava formulário aberto: `_lastModalObra` é zerado ao fechar e ao abrir outra janela, e o repaint pula se houver diálogo da Elétrica aberto.

### Verificação feita
Página servida localmente com REST simulado: carga sem erro de console; linha de obra duplicada deixou de duplicar a contagem; chip da Elétrica aparece e some com "Limpar tudo". O teste pegou um erro que eu mesmo introduzi (a fila de requisições era declarada depois do prefetch) e foi corrigido.
**Não testado:** com banco real, a janela da obra, as telas de Replanilhamentos, o fluxo de agendar/enviar relatório e a exportação de PDF.

## 2. Pendências

### P0 — antes de usar em produção
1. **Aplicar no banco** `sql/create_vw_painel_desempenho_fiscais.sql` (a view faz `drop`/`create` dentro de `begin/commit`). Até lá a meta atrasada continua em UTC.
2. Testar com dados reais: contrato multi-obra (a obra ativa não deve herdar a ficha do contrato), alternar carteira ativa e histórico (o botão não está na tela hoje), agendar e cancelar vistoria, janela do fiscal e do distrito.

### P1 — decisões de regra de negócio (precisam do usuário)
1. **Agendamento de vistoria elétrica** (revisor Elétrica, achados 1 a 3):
   - O relatório não encerra o agendamento; a UI só permite 1 agendamento por obra, e agendamento confirmado também bloqueia um novo. Resultado: linha fantasma "Agendada/Pendente" no Cronograma e checkbox ao lado do chip "Vistoriada".
   - Painel, roster e mapa ignoram o agendamento quando a obra já tem relatório; o Cronograma e a aba da obra o mostram. Os números divergem.
   - A aba da obra diz "Fora do radar da elétrica" e logo abaixo "Agendada para…" (chip só considera ativo e ≥75%).
   - Sugestão: ao inserir relatório, dar `update realizada_em` no agendamento ativo; permitir novo agendamento quando o atual foi realizado; uma regra única em `statusAgendamentoEletrica`/`categoriaEletricaObra`; índice único parcial `(id_obra) where excluido_em is null`.
2. **% medido** (`medObraStats`): o numerador é `Σ total` (líquido de glosa e retenções) e inclui medições abertas/em correção (ABE, ACR). Obra nunca chega a 100%, e isso afeta o limiar de 75% da Elétrica. Decidir: bruto ou líquido, e quais situações contam.
3. **Limite de acréscimo**: fixo em 25%; o art. 125 da Lei 14.133 permite 50% em reforma de edifício/equipamento. Escolher o limite pelo `descricao_tipo_contrato`. Com `valor_original` 0 a tela diz "margem 25%" em vez de "—".
4. **`statusBucket`**: status desconhecido ("Rescindida", "Cancelada", nulo) cai em "em execução" e entra em "a vistoriar" no histórico. Contradiz `ACTIVE_STATUSES`. Precisa da lista real de status do banco.
5. **`fetchFiscais`**: descarta integrantes da comissão com `atualizado_em` mais antigo que o mais recente da obra. Se só o suplente foi editado, o fiscal responsável muda. Confirmar que a comissão é sempre regravada por inteiro.
6. **Métrica Elétrica no mapa**: o mapa e o tooltip contam "obras com ≥75% medido"; o card "Obras" conta só execução/paralisada; o rótulo do distrito conta todas as filtradas. Unificar a fonte ou renomear.
7. **Escopo dos dados da Elétrica**: relatórios e agendamentos são buscados só das obras do escopo ativo. Roster e cards "vistoriadas" diferem do Cronograma, que lê tudo. Opção: buscar `vist`/`agend` sem filtro de ids, pois as tabelas são pequenas.

### P2 — Replanilhamentos
1. Três "médias do estado" com bases diferentes: `refGeral()` (inclui processos sem município), `refEstadoPeriodo()` e o traço do ranking. O rótulo "média dos distritos operacionais" mostra a média ponderada por despacho, não a dos 11 pontos.
2. Ctrl+clique em 2 distritos: o clique no fiscal do ranking (`.qdf`) abre a janela com a carga estadual, sem avisar.
3. "N de M" do ranking de fiscais conta quem só tem fila; o KPI "Fiscais" conta só quem despachou (mesma divergência da janela do distrito, que continua aberta).
4. Fiscal que despachou e saiu de `app_users` aparece como "(sem fiscal)", e duas pessoas viram duas linhas iguais. SQL: fallback `'Matrícula '||t_resp_matricula`; front: escolher o primeiro `fiscalNome` ≠ "(sem fiscal)".
5. Lista do nível 3 (cidade) mistura escopos: o título "Processos N" conta todos, os KPIs contam fila e despachos do período. Os grupos de processos continuam truncados em 15 sem "ver todos".
6. `loadProcessos` roda 1 vez por sessão de página. `meta_estourada` e `dias_na_unidade` ficam congelados; o corte do período usa a data do navegador, não a de Fortaleza.
7. Risco latente: `noPeriodo` local (janela do fiscal) não exclui `p.naFila`. Hoje não tem efeito, porque despachado e fila não se sobrepõem na view.

### P3 — falhas silenciosas e UX
1. Falha de tabela auxiliar (`tol()`) vira `{}` e depois "sem vistoria/sem medição"; o aviso fica só na barra de status, dentro do painel recolhido. Mostrar selo fora do painel e não exibir contagens quando faltar `vist`/`agend`. Vale para o roster (`garantirRosterEletrica`) e para a RLS de `medicoes`.
2. Código morto: botões `#btnScope`/`#btnRefresh` (não existem no HTML), `.badge`, `fichaProcCard`, `grupoProcs`, `barraAtraso`, `obraResumoCard`, `espera`, `todosLotados`, `.qdf-fina`, `.rbar.fina` e comentários que citam "Hoje", `AMOSTRA_SOLIDA` e "Carga no período". Sem os botões, o histórico completo é inalcançável e nada diz que os números são só da carteira ativa.
3. Hover refaz `body.innerHTML` e perde o `scrollTop` do painel. Falta preservar a rolagem.
4. `updateLabels` ainda chama `refreshMapCounts` a cada pan/zoom, embora os contadores só mudem em `render()`.
5. `zoomend` apaga o destaque de hover sem limpar `_hoverGroupLayer`.
6. Cronograma lê as duas tabelas inteiras a cada abertura, e o `catch(()=>[])` de um lote vira "Obra #id". Limitar por mês e avisar sobre lote parcial.
7. `UPDATE` de cancelar agendamento e do checkbox "realizada" não confere linhas afetadas (RLS bloqueia sem erro e a UI mostra sucesso). Usar `.select('id')`.
8. `wireEletricaPane` re-registra `dragover`/`drop` a cada render (vazamento pequeno). Enter no botão "baixar" abre a obra (`.eng-ver-row` sem filtro `ev.target===row`).
9. Datas de vistoria sem `max` (futuro vira "vistoriada") e sem `min` no agendamento. Numeração V1/V2 se renumera ao excluir. Upload no Drive sem rollback se o `INSERT` falhar.
10. `loadData` mostra "N contratos" para o que são obras. Buckets de prazo e a "data de hoje" da Elétrica ficam congelados com a aba aberta de um dia para o outro (recalcular no `visibilitychange`).
11. Busca livre não ignora acento (`passF` usa `toLowerCase`; os dropdowns usam `normSearch`). Pré-computar `o._busca`.
12. `supabase-js` fora do ar aparece como "Entre no GECOPE". Distinguir e oferecer "Tentar novamente".
13. `prefetchPagina` (botão Sair) só é definida depois do GeoJSON; o hover antes disso dá `ReferenceError`.
14. Tema: o script inline do HTML vai para escuro quando o `localStorage` falha, enquanto o JS segue o SO.
15. `fitCtrlHeight` sobrescreve o `max-height` do CSS no layout empilhado (≤860px).
16. `rsLineChart` escala o eixo Y até o maior ponto (15% medido parece quase concluído) e espaça o eixo X por índice.
17. Cache de `agend`/`vist` na virada do dia: `_obrasOfCache` e `_atencaoEletricaDirty` não invalidam à meia-noite.
18. `utils.js`: `xlsx` usa `cdn.sheetjs.com/xlsx-latest` sem versão fixa (outras libs estão pinadas). Fixar versão e, se possível, SRI.
19. Medições: `fetchMedicoes` desempata por `periodo` como texto (`MM/AAAA` ordena errado) e não deduplica `nr_medicao` reemitido. Depende de ver os dados.
20. Comentários desatualizados: `obraCountBySop` ("só sinal multiObra"), cabeçalho de `fetchMedicoes` ("total vem da ficha" × código soma `m.total`).

## 2b. Follow-up de 02/10 — resolvido depois da revisão
Corrigido no código (`node --check` ok; página servida localmente com sessão e REST simulados: carga, deduplicação, busca sem acento e status de falha parcial conferidos):
- **Achado do `code-review`:** `fetchObrasPorContrato` não passa mais por `tol()` (devolvia `{}`, truthy, e o fallback para a contagem local nunca rodava). Agora a falha vira `null` e marca `parcial`.
- **Fuso:** `hojeISOLocal()`, `corteDespacho()` e `prazoCalc()` usam a data de Fortaleza (antes, a do navegador). `fix_painel_responsavel_atual_suite.sql` também: `meta_estourada` e `dias_em_aberto` deixam de usar `current_date` (UTC).
- **P2.1** rótulos "média dos distritos operacionais" → "média do estado (por despacho)". **P2.2** janela do fiscal avisa quando mostra a carga do estado com distritos selecionados. **P2.3** cabeçalho do ranking diz "N de M com média". **P2.4** fiscal fora de `app_users` aparece como "Matrícula X" (SQL) e o front escolhe o primeiro nome válido da matrícula. **P2.5** listas cortadas em 15 ganham "Ver os outros N" (`<details>`); o título do nível 3 diz que lista todos os períodos. **P2.6** corte do período em Fortaleza; ao voltar à aba em outro dia, recarrega obras ou processos. **P2.7** `noPeriodo` exclui `naFila`.
- **P3.1** (parcial) o status nomeia as tabelas auxiliares que falharam. **P3.2** removidos `fichaProcCard`, `obraResumoCard`, `grupoProcs`, `barraAtraso`, `espera`, `todosLotados`, `.badge` e o CSS `.gproc`/`.sbar`/`.qdf-fina`/`.rbar.fina`. **P3.3** hover preserva a rolagem do painel. **P3.5** `zoomend` mantém o destaque do distrito sob o mouse. **P3.6** Cronograma avisa quando um lote de obras não carregou. **P3.7** cancelar agendamento, marcar "realizada" e excluir relatório conferem as linhas afetadas (`.select('id')`). **P3.8** `dragover`/`drop` idempotentes; Enter no botão "baixar" não abre a obra. **P3.9** data da vistoria não aceita futuro. **P3.10** "N obras" no status e recarga na virada do dia. **P3.11** busca livre sem acento (`o._busca`). **P3.12** falha do `supabase-js` não vira "Entre no GECOPE". **P3.13** `prefetchPagina` definida antes do GeoJSON. **P3.14** tema segue o SO quando o `localStorage` falha. **P3.15** `fitCtrlHeight` respeita o `#mapWrap`. **P3.16** eixo Y de 0 a 100%. **P3.17** virada do dia (ver P3.10). **P3.18** `xlsx` fixado em 0.20.3 (sem SRI). **P3.19** desempate de `periodo` por AAAAMM. **P3.20** comentários atualizados.

**Ainda aberto:** P0 inteiro (aplicar as duas SQL e testar com dados reais; `fix_painel_responsavel_atual_suite.sql` continua "aplicar por último"), todo o P1 (regra de negócio), P3.1 (selo visível fora do painel e ocultar contagens sem `vist`/`agend`), P3.2 (decidir se o alternador de carteira volta à tela; o código de `#btnScope`/`#btnRefresh` foi mantido), P3.4 (`refreshMapCounts` no pan/zoom: os rótulos novos dependem dele ao entrar na camada, não removi sem testar), P3.9 (`min` no agendamento, renumeração V1/V2, rollback do Drive), P3.16 (eixo X por índice), P3.19 (deduplicar `nr_medicao` reemitido; precisa ver os dados). Nada disso foi testado contra o banco real nem com os fluxos de agendar/enviar relatório/PDF.

## 3. O que falta para finalizar
1. **Banco (P0):** aplicar `sql/create_vw_painel_desempenho_fiscais.sql` (drop/create em `begin/commit`; também traz o fallback "Matrícula X" do fiscal) e, por último, `sql/fix_painel_responsavel_atual_suite.sql` (muda `responsavel_atual`, a carteira GECOPE vai cair; ler o cabeçalho antes).
2. **Teste com dados reais (P0):** contrato multi-obra (a obra ativa não herda a ficha do contrato); agendar, cancelar e marcar "realizada" (agora conferem linhas afetadas, então testar também com um usuário sem permissão); enviar e excluir relatório; janelas de distrito e fiscal com o novo "Ver os outros N"; exportação de PDF; virada do dia com a aba aberta.
3. **Decisões de negócio (P1):** começar pelo agendamento da Elétrica; depois % medido, limite de acréscimo (25% × 50%), status desconhecido em `statusBucket`, comissão em `fetchFiscais`, métrica da Elétrica e escopo dos dados da Elétrica.
4. **Pendências menores:** ver "Ainda aberto" na seção 2b (selo de falha parcial fora do painel, alternador de carteira, `min` no agendamento, eixo X, `nr_medicao` reemitido, `refreshMapCounts`).
5. **PR:** abrir pelo usuário (sem `gh`; push exige login sop-difor). Contra `main` são 21 arquivos, ver aviso no topo.
6. **Verificação local:** servir com `python -m http.server`, cookie `gecope_session_active=true` + sessão falsa em `localStorage` (`sb-<ref>-auth-token`), `page.route('**/rest/v1/**')` devolvendo linhas. Atenção: no patchright `page.evaluate` roda em mundo isolado; para ver `window.*` da página, injetar `addScriptTag` que grave o resultado no DOM.
