# Mapa de módulos do GECOPE

Índice de roteamento para agentes de IA. Use este arquivo para localizar a área provável antes de abrir o código. Os resumos são intencionalmente curtos; confirme detalhes no arquivo indicado e nos módulos diretamente relacionados.

## Roteamento rápido

| Pedido | Comece por |
|---|---|
| Login, sessão, papel ou permissão | `core/auth.js` e `database.js` |
| Navegação, abas, tema, tela cheia ou carregamento da aplicação | `core/shell.js` e `index.html` |
| Processos, metas, fiscais ou acompanhamento | `modules/processos/processos.js` |
| Contratos, aditivos ou checklist documental | `modules/contratos/contratos.js` |
| Curva ABC geral, importação ou classificação | `modules/curva-abc/curva_abc.js` |
| Curva ABC dentro de um processo | `modules/curva-abc/curva_abc_processo.js` |
| Financeiro, indicadores, gráficos ou filtros | `modules/financeiro/financeiro.js` |
| Orçamentos, versões, arquivos ou revisão | `modules/orcamentos/orcamentos.js` |
| Composições, cálculo de preço ou relatório analítico | `modules/composicoes/composicoes.js` |
| Índices econômicos para preço retroativo | `modules/composicoes/app.js` |
| SINAPI, SEINFRA, ORSE ou BDI | `modules/tabelas/tabelas.js` |
| Usuários, aprovação ou autorizações | `modules/administracao/admin.js` |
| Histórico/feed de atividades | `modules/atividades/atividades.js` |
| Seleções múltiplas em filtros | `shared/multiselect.js` |
| Aprovar/recusar comentário ou excluir arquivo | `shared/crud-genericos.js` |
| Relatórios e exportação | `relatorio.js` e o módulo que monta os dados |
| Notificações ou envio de WhatsApp | `whatsapp.js` e `server/whatsapp-proxy/` |
| Mapa de obras e geografia (card "Contratos" do Início) | `gecope_mapa_obras.html` e `assets/js/mapa-obras.js`. Abre como módulo do `index.html` (`#pane-contratos`, ver "Módulos embutidos" abaixo); a página continua abrindo sozinha também. No modo embutido `.embutido header.top` esconde o cabeçalho do mapa (a data "Base atualizada em" é copiada para a faixa de título do index por `observarBaseContratos`, `core/shell.js`) e o tema chega por `postMessage`. Na visão de Distritos, `groupStyle()` pinta a opacidade do verde pelo valor da métrica de cada distrito (`_groupValByGid`, calculado em `render()` sempre, não só com filtro). Fontes ≥ 12px e só Montserrat (revisão de design, B4). |
| Janela da obra ("Ficha Obra", 2 abas: Ficha Obra e Elétrica; abre ao clicar numa obra) | `assets/js/mapa-obras.js` (`openModal`, `buildFichaPane`, `fichaObrasNav`, `obrasDoContrato`) e `assets/css/mapa-obras.css` (`.fc-*`). Cada parte é um cartão com faixa de título e ícone (`fcSec`, `FC_ICO`; `.fc-sec`/`.fc-h`/`.fc-body` no CSS); Dados da obra, Prazos e Valores são um cartão só de três colunas (`.fc-tri` > `.fc-col`). Segue a ordem e as posições do modelo `ficha_obra.pdf` do SIGSOP; não exibe o que a base não tem (Dt Propos./Orçam., Fonte de Rec., Valor PI, STP, Ajuste, Histórico, reajuste Preço×Medição). Aditivos de valor/prazo (`buildAdValorPane`/`buildAdPrazoPane`) são detalhe recolhível dos blocos Valores/Prazos. Em contrato com mais de uma obra, chips (ou menu, acima de 5) trocam de obra entre as carregadas na carteira atual. A aba Elétrica é `buildEletricaPane`, inalterada. |
| Desempenho dos fiscais nos replanilhamentos | `assets/js/mapa-obras.js` (modo Replanilhamentos) e `sql/create_vw_painel_desempenho_fiscais.sql`. Desde a E7, a quebra por distrito/fiscal de `modules/processos/processos.js` (`abrirBreakdownFiscal`) também lê distrito/fiscal dessa mesma view (fonte única) — restrita a admin/gerente; some do clique pro papel fiscal (`.fiscal-no-breakdown`, `core/auth.js`). Decisões e revisões em `docs/painel-fiscais/`. No painel lateral do modo Replanilhamentos a lista de fiscais é `fiscaisRankingBlockHtml`/`fiscaisRankingLista` (`.fq-*` no CSS): pirulitos com linha única de média, compacta (5 mais lentos + 3 mais rápidos, `st.rp.fiscaisAberto` expande) e que ignora a busca de fiscal para destacá-lo (`passFRp(p,true)`); a lista de Distritos/Cidades saiu do painel — o distrito se abre pelo clique no mapa. |
| Download de relatório de vistoria elétrica (botões de baixar no modal do engenheiro, cronograma e aba Elétrica) | `assets/js/mapa-obras.js` (`baixarRelatorioEletrica`, `wireBaixarRelatorio`) chama a Edge Function `supabase/functions/eletrica-drive-download`, que confere a RLS de `eletrica_vistorias` e devolve o arquivo do Drive privado. Não usar link direto do Drive (403). |
| NUP do processo SUITE em cada relatório de vistoria elétrica (obrigatório desde 29/09/2026, botão "Abrir no SUITE") | `assets/js/mapa-obras.js` (`mascaraNup`, `NUP_REGEX`, `botaoAbrirSuite`, campo `#eleNup` em `buildEletricaPane`) grava em `eletrica_vistorias.nup_processo` (`sql/add_nup_eletrica_vistorias.sql`, coluna nullable — obrigatoriedade é só de formulário, relatórios antigos não têm NUP). Mesmo padrão de máscara/link do NUP de Processos (`modules/processos/processos.js:3417`). Qualquer engenheiro (papel `eletrica`/`admin`) pode inserir relatório em obra de outro distrito operacional — cooperação entre distritos, sem trava de RLS por distrito; cada relatório conta só para quem o enviou (`responsavel_nome`, ver `computarRosterEletrica`). |
| Cronograma de visitas dos engenheiros eletricistas (botão "Cronograma" da métrica Elétrica) | `assets/js/mapa-obras.js` (`abreCronogramaEletrica`, bloco "Cronograma de visitas") e `assets/css/mapa-obras.css` (`.crono-*`). Lê `eletrica_vistorias` e `eletrica_vistorias_agendadas` inteiras a cada abertura; decisões no comentário do bloco. |
| Status de uma vistoria agendada da Elétrica (Agendada/Pendente/Realizada/Vistoriada — cards do painel, Cronograma, janela do engenheiro e aba Elétrica da obra) | Fonte única: `statusAgendamentoEletrica()` em `assets/js/mapa-obras.js`, perto de `categoriaEletricaObra` — compara `data_planejada` com `hojeISOLocal()` e olha `eletrica_vistorias_agendadas.realizada_em` (`sql/add_realizada_eletrica_vistorias_agendadas.sql`, coluna nullable preenchida quando o engenheiro confirma a realização na aba Elétrica, `buildEletricaPane`/`wireEletricaPane`, checkbox só visível depois que a data planejada passa). "Vistoriada"/"Realizada" são a MESMA categoria de status (confirmada, com ou sem relatório) — cards/funil/contadores somam as duas juntas; só o rótulo de cada linha individual (Cronograma, `linhasPorObra`) diferencia pela presença de relatório (`it.r`). |
| Cronograma de analistas, tarefas ou rotinas (card "Atividades") | `cronograma.html` (módulo embutido `#pane-cronograma`) |
| Perguntas em linguagem natural (card "Assistente de Dados") | `assistente.html` (módulo embutido `#pane-assistente`) e `supabase/functions/gecope-assistant/` |
| Métricas, feedback ou falhas do assistente | `assistente-painel.html` e `supabase/functions/gecope-assistant-painel/` |

## Base transversal

| Área | Responsabilidade e dependências |
|---|---|
| `config.js` | Configuração pública do Supabase e do proxy; fonte das URLs/chaves usadas no front-end. |
| `database.js` | Inicializa `window.sbClient`, mantém sessão persistente com proteção por cookie e expõe o cliente Supabase. |
| `utils.js` | Formatação, datas, moeda, sanitização, máscaras, Storage e helpers usados pelos módulos e relatórios. |
| `core/auth.js` | Login, cadastro, logout, recuperação/sincronização de sessão, papéis e autorizações especiais. Depende de Supabase Auth e `app_users`. |
| `core/shell.js` | Shell da aplicação: navegação entre painéis, tema, carregamento inicial, home e coordenação de chamadas globais. Usa `window.allData`. Cabeçalho compacto (~54px) em todos os módulos menos o Início: `showPane` liga `body.modo-compacto` (+ `modo-contratos` com a data da base, + `modo-embutido` nos iframes); a barra é o `.sop-header` com os `.cb-*` (HTML em `index.html`, CSS em `style.css`). |
| Módulos embutidos | Contratos (mapa), Atividades (cronograma) e Assistente de Dados abrem **dentro do `index.html`**, cada um num iframe `?embed=1` em `#pane-contratos`/`#pane-cronograma`/`#pane-assistente` (config em `MODULOS_EMBUTIDOS`, `core/shell.js`; src carregado na 1ª abertura). `shared/embed.js` marca a página como `.embutido` (cada página esconde o próprio cabeçalho/voltar/tema por CSS) e repassa o tema do index (`postMessage` → evento `gecope-tema`). Para embutir um módulo novo: pane + iframe no `index.html`, entrada em `MODULOS_EMBUTIDOS`, `<li>` em `#dashboardTabs`, e carregar `shared/embed.js` na página. `assistente-painel.html` e `privacidade-eletrica.html` seguem páginas independentes. |
| `shared/tokens.css` | Fonte única dos valores de design (cores de marca, escala de cinzas, raios, sombras), prefixo `--gc-*`. Carregado antes do CSS próprio em todas as páginas HTML; `style.css` aponta seus nomes antigos (`--sop-*`, `--radius-*`, `--shadow-*`) para cá. Mapa (`--ng`), Assistente (`--accent`, escala slate) e Curva ABC (`--cv-green`) apontam para o verde único no tema claro; o escuro de cada um mantém a própria paleta. Revisão de design em `docs/revisao-design-tema-claro/spec.md`. |
| Cabeçalho do sistema (barra e trilha) | `index.html` (`.gecope-hero` > `header.sop-header`; `nav.gc-trilha` no começo do `<main>`), `style.css` (blocos "CABEÇALHO ÚNICO", "INÍCIO") e `core/shell.js` (`showPane` escreve o nome do módulo em `#cb-titulo`; `observarBaseContratos` escreve a data em `#cb-base`). A barra é a mesma em todas as telas; a trilha (botão único de voltar, nome do módulo, data da base do Contratos) só aparece fora do Início (`body.modo-compacto`). |
| Aba Processos: abas, faixa de números e filtros | `index.html` (`#pane-reuniao`), `modules/processos/processos.js` (`updateReuniao`, `contarAbasProcessos`, `filtrarProcessosPorStatus`, `atualizarEstadoFiltrosProcessos`, `removerFiltroProcessos`) e `style.css` (bloco "PROCESSOS — abas, faixa de números e barra de filtros"). Os ids dos filtros (`meetingSearch`, `meetingStatusSelect`, `meetingFiscalSelect`, `meetingMetaSelect`, `meetingPrioritarioSelect`, `btn-reuniao-clear`) são usados por `core/shell.js` e `processos.js`; não renomear. |
| `shared/fullscreen.js` | Botão de tela cheia e retomada da tela cheia ao navegar entre páginas (guarda a intenção em `sessionStorage`; carregado em todas as páginas HTML). |
| `shared/multiselect.js` | Componente reutilizável de seleção múltipla, principalmente nos filtros de Processos e Financeiro. |
| `shared/crud-genericos.js` | Operações comuns de decisão sobre comentários e exclusão de registros/arquivos; usado por Orçamentos e Composições. |
| `relatorio.js` | Helpers para cabeçalhos, identificação, impressão e exportação de relatórios formais. |
| `whatsapp.js` | Notificações de atraso e comunicação com o proxy autenticado; registra logs e consulta configurações de disparo. |

## Módulos de negócio

| Módulo | Resumo curto |
|---|---|
| `modules/processos/processos.js` | Núcleo do acompanhamento de processos: consulta, filtros, edição, status, metas, fiscais e modais de análise. Alimenta `window.allData` e integra Contratos, Curva ABC, Atividades e WhatsApp. |
| `modules/contratos/contratos.js` | Checklist documental de aditivos, versionamento e relatório de análise documental. Opera sobre dados vinculados ao processo e usa RBAC, `utils.js` e modais do fluxo de Processos. |
| `modules/curva-abc/curva_abc.js` | Biblioteca de análise ABC: upload/importação de planilhas, versões, classificação de itens, comentários e relatórios. Usa SheetJS, Storage `orcamentos` e tabelas `curva_abc_*`. |
| `modules/curva-abc/curva_abc_processo.js` | Integra a Curva ABC ao processo: resumo, histórico de versões, exclusão e abertura de relatórios a partir de Gerenciar Processo. |
| `modules/financeiro/financeiro.js` | Painel financeiro com filtros, KPIs, gráficos Plotly e drill-down, comparando dados de Fiscalização e GECOPE. Usa dados mapeados de processos e `shared/multiselect.js`. |
| `modules/orcamentos/orcamentos.js` | Biblioteca de orçamentos com upload, Storage, versionamento, comentários, decisões de revisão, atividades e notificações. |
| `modules/composicoes/composicoes.js` | Biblioteca analítica de composições: cadastro, versões, referências, cálculos, comentários e relatórios. Usa CRUD genérico, Storage e WhatsApp. |
| `modules/composicoes/app.js` | Integra a Edge Function `get-economic-indices` para consultar índices econômicos e atualizar cálculos de preço retroativo. |
| `modules/tabelas/tabelas.js` | Consulta e detalhamento de referências SINAPI, SEINFRA e ORSE, com filtros, BDI/desconto e links/relatórios de referência. |
| `modules/administracao/admin.js` | Administração de usuários: aprovação, papéis, autorizações especiais, notificações e cadastro de fiscais. |
| `modules/atividades/atividades.js` | Registro e listagem do feed de atividades e resumo exibido na home; é chamado por vários módulos. |

## Entradas independentes

- `index.html`: aplicação principal. Contém a estrutura dos painéis e modais e carrega `config.js`, `database.js`, `utils.js`, `core/*`, `shared/*`, `relatorio.js`, `whatsapp.js` e os módulos de negócio.
- `cronograma.html`: tela independente de cronograma; usa `config.js`, `database.js` e lógica inline para analistas, tarefas e rotinas.
- `gecope_mapa_obras.html`: tela independente de mapa; usa Leaflet, `assets/js/mapa-obras.js`, dados GeoJSON em `assets/geo/`, `config.js` e `database.js`. Na métrica Elétrica ainda tem o painel de engenheiros e o modal de cronograma de visitas (mês a mês, só leitura; agendar/cancelar/anexar relatório continuam na aba Elétrica da obra).
- `assistente.html`: interface do Assistente de Dados; usa a sessão do GECOPE e chama a Edge Function do assistente.
- `assistente-painel.html`: painel de uso e feedback do assistente; chama a Edge Function de métricas.

## Assistente de Dados (backend)

| Caminho | Papel |
|---|---|
| `supabase/functions/gecope-assistant/index.ts` | Orquestra autenticação, motor determinístico, caminho LLM, execução segura, resposta e log. |
| `supabase/functions/gecope-assistant/motor_intencoes.ts` | Regras e SQL parametrizado para perguntas conhecidas; caminho preferencial e testável. |
| `supabase/functions/gecope-assistant/llm.ts` | Chamada ao provedor LLM e fallback de modelos. |
| `supabase/functions/gecope-assistant/guards.ts` | Valida e saneia SQL gerado antes da execução. `guards_test.ts` cobre esse contrato. |
| `supabase/functions/gecope-assistant/schema_prompt.ts` | Dicionário condensado de schema e prompt das views permitidas. |
| `supabase/functions/gecope-assistant/eval_run.ts` | Runner do harness de avaliação; casos em `docs/assistente/eval/casos.jsonl`. |
| `supabase/functions/gecope-assistant-painel/index.ts` | Agrega consultas, erros e feedback para o painel administrativo do assistente. |
| `supabase/functions/sincronizar-suite/index.ts` | Função de sincronização com a Suite; tratar como integração externa, não como módulo da UI. **Leia a entrada completa em "Proxy e dados"** antes de editar — há um aviso de procedência do arquivo. |

Documentação detalhada do assistente, escopo, segurança e avaliações: `docs/assistente/README.md`.

## Proxy e dados

- `server/whatsapp-proxy/`: serviço Node/Docker que recebe chamadas autenticadas do front-end e conversa com a API de WhatsApp; o worker de fila fica pausado aos sábados e domingos no fuso `America/Fortaleza` (mensagens pendentes retomam na segunda-feira); o watchdog nesses dias suspende a checagem de saúde e o restart automático, mas continua atendendo o pedido manual de "Reiniciar Conexão" (lê só `whatsapp_control`, a cada 60s). Veja `DEPLOY.md` e `web/`/`worker/` antes de alterar deploy ou filas.
- `sql/`: migrações, políticas RLS, autorizações e reestruturações do banco. Mudanças de tabela ou permissão devem ser avaliadas junto do módulo que consulta os dados. **Nenhum arquivo daqui é a regra viva:** ele registra o que foi pedido ao banco em alguma data, e um script posterior pode ter recriado a mesma política com outra definição — foi o que aconteceu com `processos_update` em 18/09/2026 (ver a seção 5.8 de `docs/revisoes/2026-09-22-processos.md`). Antes de afirmar no código ou em documento qual é a política de uma tabela, leia `pg_policies`.
- `supabase/functions/`: Edge Functions do backend; mudanças de contrato devem ser conferidas no chamador HTML/JS e nas políticas do Supabase.
- `sql/_aplicados/sql/painel_desempenho_replanilhamentos.sql`: cria a view analitica `vw_painel_desempenho_replanilhamentos` e consultas para carteira, desempenho mensal, analistas e Fiscalizacao. Fonte de status: `processos` no GECOPE. **Atencao:** `sql/fix_painel_responsavel_atual_suite.sql` (revisao de 22/09/2026, aplicacao manual pendente) redefine essa view — `responsavel_atual` passa a consultar `processos.suite` e ganha o valor `OUTRA UNIDADE`, e entram tres colunas novas. Depois de aplicado, a definicao vigente e a do arquivo de fix, nao a deste.
- `docs/painel-desempenho-replanilhamentos.md`: objetivo, regras de negocio, entregas e limites conhecidos desse painel.
- `supabase/functions/sincronizar-suite/index.ts`: job que consulta o SUITE, grava `processos.suite`/`suite_data_chegada`/`status` e o histórico em `historico_suite_eventos`. **É a única automação de status do sistema** — o navegador só lê. Desde 22/09/2026 o arquivo do repositório é a versão real publicada; antes disso divergia dela. Baixe a publicada (`supabase functions download sincronizar-suite`) antes de editar.
- `supabase/functions/backfill-historico-suite/`: **função morta**, arquivada em 22/09/2026 antes da remoção do servidor. A `sincronizar-suite` faz o mesmo para todos os processos. Não republique sem ler o cabeçalho do arquivo.

## Revisões de código

- `docs/revisoes/`: histórico das revisões sistemáticas por módulo — o que foi visto, corrigido, deixado de fora por decisão e o que ficou pendente. Comece pelo `README.md` da pasta. Antes de revisar um módulo, confira se ele já tem uma revisão registrada ali: as pendências e as decisões conscientes estão documentadas, e retomá-las é mais barato que redescobri-las.

## Ordem de carregamento da aplicação principal

`config.js` -> `database.js` -> `utils.js` -> `core/auth.js` -> `core/shell.js` -> `whatsapp.js` -> `relatorio.js` -> `shared/multiselect.js` -> módulos de negócio -> `shared/crud-genericos.js` e demais integrações conforme `index.html`.

Como regra prática: altere o módulo que decide o comportamento; altere `index.html` apenas para estrutura, markup, modais, navegação ou ordem de carregamento; altere `database.js`, `auth.js` ou `shell.js` somente para comportamento transversal.
