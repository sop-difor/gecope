# Auditoria de egress do Supabase — 18/09/2026

Conferência independente do relatório anterior de egress. Método: inventário de **todas** as chamadas ao Supabase em quatro frentes (boot/processos, módulos de negócio, páginas avulsas + edge functions, serviços da VM), com gatilho e frequência de cada uma, e verificação manual dos achados de maior peso.

**Limite desta auditoria:** o peso de cada item vem de frequência × largura da consulta, lidas no código. O tamanho real das tabelas e as contagens de chamadas saem de `sql/diagnostico_egress.sql` (somente leitura). A ordem abaixo pode mudar depois dessa medição, principalmente entre os itens 3, 4 e 5.

---

## 1. Conferência do relatório anterior

| Item do relatório | Veredito |
|---|---|
| whatsapp.js baixa 10.000 logs | **Confirmado, e pior.** O mapa `ultimoAlertaPorChave` é montado e **nunca lido** (a deduplicação usa a flag `avisoAtrasoEnviado`). A correção é apagar o bloco, não criar view com DISTINCT ON. |
| Carga inicial roda 2× | **Confirmado, com outra causa.** O JWT fica 30 dias em `localStorage` ([database.js:14](../database.js#L14)), mas o papel fica em `sessionStorage`. Em aba nova, o boot já está autenticado e baixa tudo; depois o usuário "loga" de novo e baixa tudo outra vez. |
| Dois ouvintes na busca de orçamentos | **Confirmado.** O relatório não percebeu que a tabela também é baixada no boot de **todo** usuário. |
| Worker a cada 2 s, 24/7 | **Já corrigido no código** (backoff de 2 a 20 s, 17/09). Só vale se a VM tiver sido reconstruída. |
| `?t=` em composicoes.js:1586/2001 | Defeito real, mas nas linhas **1605 e 2020**. Só dispara por clique, então o peso é baixo. |
| `sql/diagnostico_egress.sql` "deixado pronto" | **Não existia.** Foi escrito agora. |
| Site servido de bucket? | **Não:** GitHub Pages (`sop-difor.github.io`). A Evolution API usa Postgres próprio na VM, sem tráfego ao Supabase. |

**O que o relatório anterior não viu:** orçamentos e composições baixados no boot (itens 3 e 4 abaixo), a recarga completa após cada gravação (5), o Financeiro baixando de novo linhas de `processos` (6), os dois pollings de admin no navegador (7) e o cache de 5 min do mapa (9).

---

## 2. Achados, por peso estimado

### Alto

**1. Consulta morta de 10.000 `whatsapp_logs`**
- Onde: [whatsapp.js:58-80](../whatsapp.js#L58-L80).
- Quando: roda para admin em todo boot, login e gravação de processo (via `populateAllTabFilters`, [processos.js:3382](../modules/processos/processos.js#L3382)).
- Correção: apagar as linhas 58-80. Risco: nenhum, o resultado não é usado.

**2. Carga dupla por sessão**
- Onde: boot em [shell.js:272](../core/shell.js#L272) e login em [auth.js:214](../core/auth.js#L214).
- O que dobra: `processos` inteiro (`select('*')`, inclusive linhas EXCLUÍDO descartadas no cliente), `vw_processos_financeiro`, `alerta_retorno_comentarios`, contratos/comissão e, para admin, os 10k logs.
- Duplicado junto: `carregarListaFiscais` (`app_users` inteira) em [shell.js:275](../core/shell.js#L275) e em [auth.js:709](../core/auth.js#L709).
- Correção: no boot, só carregar se `sessionStorage.sop_role` estiver preenchido; remover uma das chamadas de fiscais.

**3. Orçamentos: boot de todos + busca por tecla**
- Tabela inteira com `select('*')` (inclui jsonb `historico_versoes` e `comentarios_revisao`), paginada. É baixada:
  - no boot de todo usuário ([shell.js:313-314](../core/shell.js#L313)), mesmo quem nunca abre a aba;
  - **duas vezes** a cada pausa de digitação ([shell.js:363](../core/shell.js#L363) + [orcamentos.js:435](../modules/orcamentos/orcamentos.js#L435)), embora o filtro seja aplicado no cliente ([orcamentos.js:227-232](../modules/orcamentos/orcamentos.js#L227)).
- Correção:
  - carregar só ao abrir a aba (o caminho lazy já existe em [shell.js:223](../core/shell.js#L223));
  - um único ouvinte, que filtra os dados já em memória;
  - colunas explícitas no lugar de `*`.

**4. Composições: boot de todos, duas vezes, + busca por tecla**
- `composicoes_biblioteca` não-SOP com `select('*')` (inclui o jsonb `itens`, usado só em `Array.isArray`). É baixada:
  - no `DOMContentLoaded` ([composicoes.js:652](../modules/composicoes/composicoes.js#L652));
  - **de novo** na primeira abertura da aba, porque o boot não marca `_composicoesCarregadas` ([shell.js:229](../core/shell.js#L229));
  - de novo a cada tecla, com filtro no cliente ([composicoes.js:470](../modules/composicoes/composicoes.js#L470)).
- Correção:
  - remover a carga do boot;
  - na busca, refazer só a consulta SOP (que já filtra no servidor);
  - colunas explícitas.

**5. Toda gravação de processo recarrega tudo**
- Criar ([processos.js:1505](../modules/processos/processos.js#L1505)), excluir ([:1823](../modules/processos/processos.js#L1823)) e editar ([:2087](../modules/processos/processos.js#L2087)) chamam `carregarDadosSupabase()` inteiro: 6 a 8 consultas, 3 delas de tabela inteira.
- Correção: `update/insert(...).select(colunas).single()` e trocar só a linha em `window.allData`. As edições de meta e de prioritário já fazem isso corretamente.

### Médio

**6. Financeiro baixa de novo linhas de `processos`**
- [financeiro.js:451](../modules/financeiro/financeiro.js#L451): `vw_processos_financeiro` é `p.*` de processos APROVADO/ARQUIVADO, linhas que acabaram de chegar na mesma função. Roda para todos os papéis, embora a aba seja só de admin.
- Correção: derivar de `window.allData` no cliente, com a mesma fórmula da view.

**7. Dois pollings por aba de admin, inclusive com a aba em segundo plano**
- [admin.js:657](../modules/administracao/admin.js#L657), a cada 45 s:
  - faz `select('*')` de todas as `app_notifications` não lidas;
  - as `new_user_request` nunca são marcadas como lidas, então o lote só cresce;
  - o resultado é descartado.
- [whatsapp.js:1139](../whatsapp.js#L1139), a cada 60 s: `/status` no proxy, que chama `auth.getUser` e lê `whatsapp_control` no Supabase. São cerca de 1.440 chamadas por dia por aba aberta.
- Correção:
  - notificações: `update({read:true}).eq('read',false).neq('type','new_user_request')`, sem baixar nada;
  - os dois: pular quando `document.hidden` e subir o intervalo para 5 min.

**8. `alerta_retorno_comentarios` inteiro a cada carga**
- [processos.js:148](../modules/processos/processos.js#L148): `select('*')` com `in(todos os ids)`, mas só o último comentário de processos APROVADO é usado.
- Correção: filtrar os ids APROVADO e usar 4 colunas.

**9. Mapa de obras: cache de 5 min por aba**
- [mapa-obras.js:466](../assets/js/mapa-obras.js#L466): toda abertura depois de 5 min, ou em aba nova, baixa de novo 5 tabelas. As bases mudam no máximo uma vez por dia.
- Correção: cache em `localStorage` revalidado por uma consulta barata a `max(atualizado_em)`.
- Relacionado: `comissao_fiscalizacao` traz todos os snapshots e o cliente descarta os antigos ([:346](../assets/js/mapa-obras.js#L346)).

### Baixo (agrupar numa passada de limpeza)

- `processos` com `select('*')`: listar as ~38 colunas de `mapProcessoRow` e filtrar EXCLUÍDO no servidor.
- Feed de Atividades de 7 dias sem limite ([atividades.js:43](../modules/atividades/atividades.js#L43)).
- Resumo da Home chamado cerca de 6× por login ([processos.js:1247](../modules/processos/processos.js#L1247) duplica o `updateDashboard`).
- Curva ABC: `insert(itens).select()` com retorno descartado ([curva_abc.js:842](../modules/curva-abc/curva_abc.js#L842)); resumo recarregado a cada clique de status ([:903](../modules/curva-abc/curva_abc.js#L903)).
- `?t=` em [composicoes.js:1605](../modules/composicoes/composicoes.js#L1605) e [:2020](../modules/composicoes/composicoes.js#L2020); upload sem `cacheControl` em [:278](../modules/composicoes/composicoes.js#L278).
- `app_users` com `select('*')` na aba Admin ([admin.js:79](../modules/administracao/admin.js#L79)); contagem de pendentes baixando linhas em vez de usar `count`/`head` ([:662](../modules/administracao/admin.js#L662)).
- Cronograma: `processos` inteiro e `cronograma_tarefas` com todo o histórico a cada carga ([cronograma.html:2030](../cronograma.html#L2030), [:3653](../cronograma.html#L3653)).

### Serviços da VM (exigem rebuild do container)

- **Confirmar na VM que o backoff de 17/09 está rodando.** Sem ele, são cerca de 88 mil requisições por dia; com ele, cerca de 10 mil.
- `reclaimStaleJobs` roda em toda volta do loop para um limiar de 5 min ([worker.js:278](../server/whatsapp-proxy/worker/worker.js#L278)). Pode ir para o portão de 60 s.
- Em erro, o backoff volta a 2 s ([worker.js:297](../server/whatsapp-proxy/worker/worker.js#L297)): numa pane do Supabase, o worker volta a martelar.
- `claimJob` traz a linha inteira duas vezes; o watchdog faz 2 consultas a cada 30 s com `select('*')`.
- `auth.getUser` de rede em toda requisição ao proxy, sem cache ([auth-middleware.js:24](../server/whatsapp-proxy/web/auth-middleware.js#L24)).
- `/ready` é público e consulta o banco sem nenhum uso ([web/index.js:110](../server/whatsapp-proxy/web/index.js#L110)).

---

## 3. Fora do tema, mas encontrado

- **Segurança:** a edge function `consulta-ceara-transparente` está com `--no-verify-jwt` e CORS `*`, e **não tem chamador no repositório**. Qualquer pessoa pode usá-la como proxy. Se não está em uso, desativar.
- **Deploy divergente:** segundo [docs/painel-fiscais/proposta-tempo-fiscal-suite.md](painel-fiscais/proposta-tempo-fiscal-suite.md), a `sincronizar-suite` publicada difere do código do repositório (o do repositório é de 06/08).
- **Integridade:** o cronograma apaga e reinsere todas as tabelas a cada edição ([cronograma.html:2008](../cronograma.html#L2008)). Com dois usuários editando ao mesmo tempo, há risco de perda de dados.
- **Bug funcional:** [orcamentos.js:656](../modules/orcamentos/orcamentos.js#L656) lê a coluna `descricao`, que parece não existir em orçamentos, então o log de atividade sai "N/A".
- **Código morto:** `StatusSync.verificarEAtualizarStatus` ([processos.js:40](../modules/processos/processos.js#L40)).

---

## 4. Medição real (18/09/2026)

Rodei `sql/diagnostico_egress.sql` no banco. Janela de estatísticas: **230 dias** (desde 31/01/2026) para `pg_stat_statements` (chamadas por consulta); **~285 dias** (desde 08/12/2025) para `pg_stat_user_tables` (varreduras). Os números abaixo são médias diárias sobre essa janela toda, não a taxa de hoje.

### Confirma o diagnóstico

- **`app_notifications` a cada 45s (item 7 da seção 2):** medido em **1.529 chamadas/dia** (1.454 autenticado + 75 anon), sempre `select('*')` da tabela inteira de não lidas. Bate com o polling de admin.js.
- **Composições no boot (item 4):** medido em **130 chamadas/dia** de `select('*')` ordenado, tempo médio 54-90 ms. Confirma a carga dupla.
- **Orçamentos (item 3):** medido em **24 chamadas/dia** de `select('*')` da tabela inteira — bem menor do que o esperado por tecla, ou seja, o uso real de busca é baixo hoje. O defeito arquitetural continua (tabela inteira por tecla, filtro no cliente), só o impacto atual é menor do que parecia.
- **Watchdog (proxy):** medido em 322 chamadas/dia em média sobre 230 dias, mas o watchdog só existe desde o incidente de 21/08/2026 (histórico do projeto). Rodando full-time desde então (~28 dias) a 2.880/dia, a média cai para ~322/dia sobre a janela toda — os dois números batem. Ou seja, quando está ativo, o watchdog roda no ritmo esperado (2 consultas a cada 30s).

### Não dá para confirmar com este corte

**O worker já está com backoff, ou não?** A consulta principal do worker (`claimJob`, `select('*')` de `whatsapp_jobs` pendente) mede **4.957 chamadas/dia**, e a de `reclaimStaleJobs`, **4.711/dia** — muito perto do cenário "com backoff" (≈4.320-4.711/dia) e longe do cenário "sem backoff" (≈43.200/dia). Isso é uma média de 230 dias, mas o comentário no código data o backoff de 17/09 (ontem). As duas explicações possíveis:
1. o worker não rodou boa parte desses 230 dias (é plausível — o watchdog só existe desde agosto, então o stack talvez seja mais novo do que a janela de estatísticas);
2. algum comportamento de baixo tráfego já existia antes do backoff formal de 17/09.
Não dá para decidir entre as duas só com a média. **Ação:** resetar `pg_stat_statements` agora (`SELECT pg_stat_statements_reset();`, ou aguardar 24-48h) e rodar o bloco [1] de novo — aí a taxa vai refletir só o comportamento atual, depois do rebuild.

### Dois achados novos, fora do que qualquer relatório havia visto

**A. Um processo externo grava nas tabelas de preço usando a chave pública (anon), não a de serviço.**
`sinapi_itens` e `seinfra_itens` são views de fachada (a reestruturação de 01/09/2026 do banco). Conferi no código: **nem `modules/tabelas/tabelas.js` nem `modules/composicoes/composicoes.js` fazem `.update()`/`.insert()` nelas** — o front-end só lê. Mesmo assim, o banco registrou UPDATE nessas views executado com o papel **`anon`**: ~115 chamadas/dia (20.508 + 6.079 no total). O `sql/reestruturacao_tabelas/*/carga_*_manual.sql` roda pelo SQL Editor do Supabase (papel `postgres`, não apareceria como `anon`), então essas gravações vêm de outro lugar — provavelmente o "programa de carga" mensal citado como pendência no histórico do projeto (o que teria que ser ajustado por causa do CSV sem `id`), rodando com a chave anônima do `config.js` em vez de uma chave de serviço.
- **Risco:** a chave anon é pública (está no `config.js` do repositório). Se o grant de UPDATE nessas views/tabelas por trás não estiver restrito por RLS a um papel autenticado, qualquer pessoa com essa chave pode alterar preços de referência SINAPI/SEINFRA.
- **O que verificar antes de qualquer correção:** rodar como admin
  ```sql
  select grantee, table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('seinfra_composicao','sinapi_composicao','orse_composicao',
                       'seinfra_itens','sinapi_itens','orse_itens')
    and grantee in ('anon','authenticated');
  ```
  Se `anon` tiver `UPDATE`, é uma exposição real, não só um desperdício de egress — merece tratamento com prioridade sobre o resto desta auditoria.

**B. `app_users` (91 linhas) foi varrida ~5,27 milhões de vezes em 285 dias (~18.500 vezes/dia).**
Não é egress (é leitura interna do banco), mas é um sintoma. A política `processos_rw_authenticated` ([sql/rls_processos_composicoes_orcamentos.sql](../sql/rls_processos_composicoes_orcamentos.sql)) consulta `app_users` diretamente (`SELECT au.role FROM app_users au WHERE au.email = ...`) em vez de usar o padrão `(select minha_matricula())` que as outras políticas já usam para deixar o Postgres calcular uma vez por consulta em vez de uma vez por linha. Como essa política é `ALL` (vale para SELECT/INSERT/UPDATE/DELETE) e se soma via OR à política de leitura normal, ela provavelmente roda em toda consulta a `processos`. Fica fora do escopo de egress (é tráfego interno, não sai para o cliente), mas é candidato a uma revisão de performance separada.

## 5. Plano de implementação

| Onda | Conteúdo | Onde | Risco |
|---|---|---|---|
| **1** | Itens 1, 2, 3, 4, 7, `?t=`, `insert().select()` da Curva ABC | só front-end, sem SQL | baixo: remoções e guardas |
| **2** | Itens 5, 6, 8, 9 e a limpeza de colunas | front-end | médio: muda o fluxo de estado após gravação, pede teste de tela |
| **3** | Ajustes da VM | worker, watchdog, proxy + rebuild | baixo, mas precisa de deploy |
| **4** | Views/índices eventuais e desativar `consulta-ceara-transparente` | SQL aplicado à mão / painel | — |

A Onda 1 sozinha elimina tudo o que é baixado sem ninguém ler: a consulta morta, a carga dupla, as bibliotecas no boot e a busca que baixa a tabela a cada tecla.
