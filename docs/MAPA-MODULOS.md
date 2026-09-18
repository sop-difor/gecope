# Mapa de módulos do GECOPE

Índice de roteamento para agentes de IA. Use este arquivo para localizar a área provável antes de abrir o código. Os resumos são intencionalmente curtos; confirme detalhes no arquivo indicado e nos módulos diretamente relacionados.

## Roteamento rápido

| Pedido | Comece por |
|---|---|
| Login, sessão, papel ou permissão | `core/auth.js` e `database.js` |
| Navegação, abas, tema ou carregamento da aplicação | `core/shell.js` e `index.html` |
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
| Mapa de obras e geografia | `gecope_mapa_obras.html` e `assets/js/mapa-obras.js` |
| Desempenho dos fiscais nos replanilhamentos | `assets/js/mapa-obras.js` (modo Replanilhamentos) e `sql/create_vw_painel_desempenho_fiscais.sql` |
| Cronograma de analistas, tarefas ou rotinas | `cronograma.html` |
| Perguntas em linguagem natural | `assistente.html` e `supabase/functions/gecope-assistant/` |
| Métricas, feedback ou falhas do assistente | `assistente-painel.html` e `supabase/functions/gecope-assistant-painel/` |

## Base transversal

| Área | Responsabilidade e dependências |
|---|---|
| `config.js` | Configuração pública do Supabase e do proxy; fonte das URLs/chaves usadas no front-end. |
| `database.js` | Inicializa `window.sbClient`, mantém sessão persistente com proteção por cookie e expõe o cliente Supabase. |
| `utils.js` | Formatação, datas, moeda, sanitização, máscaras, Storage e helpers usados pelos módulos e relatórios. |
| `core/auth.js` | Login, cadastro, logout, recuperação/sincronização de sessão, papéis e autorizações especiais. Depende de Supabase Auth e `app_users`. |
| `core/shell.js` | Shell da aplicação: navegação entre painéis, tema, carregamento inicial, home e coordenação de chamadas globais. Usa `window.allData`. |
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
- `gecope_mapa_obras.html`: tela independente de mapa; usa Leaflet, `assets/js/mapa-obras.js`, dados GeoJSON em `assets/geo/`, `config.js` e `database.js`.
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
| `supabase/functions/consulta-ceara-transparente/index.ts` | Integração separada com a consulta Ceará Transparente. |
| `supabase/functions/sincronizar-suite/index.ts` | Função de sincronização com a Suite; tratar como integração externa, não como módulo da UI. |

Documentação detalhada do assistente, escopo, segurança e avaliações: `docs/assistente/README.md`.

## Proxy e dados

- `server/whatsapp-proxy/`: serviço Node/Docker que recebe chamadas autenticadas do front-end e conversa com a API de WhatsApp; veja `DEPLOY.md` e `web/`/`worker/` antes de alterar deploy ou filas.
- `sql/`: migrações, políticas RLS, autorizações e reestruturações do banco. Mudanças de tabela ou permissão devem ser avaliadas junto do módulo que consulta os dados.
- `supabase/functions/`: Edge Functions do backend; mudanças de contrato devem ser conferidas no chamador HTML/JS e nas políticas do Supabase.
- `sql/_aplicados/sql/painel_desempenho_replanilhamentos.sql`: cria a view analitica `vw_painel_desempenho_replanilhamentos` e consultas para carteira, desempenho mensal, analistas e Fiscalizacao. Fonte de status: `processos` no GECOPE.
- `docs/painel-desempenho-replanilhamentos.md`: objetivo, regras de negocio, entregas e limites conhecidos desse painel.

## Ordem de carregamento da aplicação principal

`config.js` -> `database.js` -> `utils.js` -> `core/auth.js` -> `core/shell.js` -> `whatsapp.js` -> `relatorio.js` -> `shared/multiselect.js` -> módulos de negócio -> `shared/crud-genericos.js` e demais integrações conforme `index.html`.

Como regra prática: altere o módulo que decide o comportamento; altere `index.html` apenas para estrutura, markup, modais, navegação ou ordem de carregamento; altere `database.js`, `auth.js` ou `shell.js` somente para comportamento transversal.
