# Revisão técnica — GECOPE

Data: 08/10/2026 · Branch: `main` (limpa, a81b5e7) · **Etapa 1 — diagnóstico. Nenhum código foi alterado.**

## 1. Mapa do projeto

- **Stack:** front-end estático em JS puro (sem build, sem `package.json` na raiz) publicado no GitHub Pages (`sop-difor.github.io`); Supabase (Postgres + RLS + Auth + Edge Functions em Deno); proxy de WhatsApp em Node/Docker numa VM Oracle (Express + worker + watchdog + Evolution API + Caddy).
- **Entradas:** `index.html` (shell + módulos de `modules/*`, `core/auth.js`, `core/shell.js`), `gecope_mapa_obras.html` + `assets/js/mapa-obras.js` (6,8 mil linhas), `cronograma.html` (JS inline), `assistente.html`, `assistente-painel.html`.
- **Backend:** `supabase/functions/`: `gecope-assistant` (LLM gera SQL, roda via RPC `executar_consulta_ia` com service role), `gecope-assistant-painel`, `eletrica-drive-token/-download`, `sincronizar-suite` e `backfill-historico-suite` (pg_cron, segredo `x-sync-secret`), `consulta-ceara-transparente`. Proxy WhatsApp: `server/whatsapp-proxy/`.
- **Autenticação:** Supabase Auth com **autocadastro aberto** (e-mails fabricados `matricula@gecope.app`, ou seja, sem confirmação de e-mail). Quem se cadastra recebe JWT válido com `role='pending'` em `app_users`. Todo o RLS depende do papel (`meu_papel()`, `tem_papel_valido()`).
- **Consequência que atravessa vários achados:** "usuário autenticado" não é "usuário aprovado". Qualquer pessoa da internet consegue um JWT em segundos.

## 2. O que foi verificado e está bem

- Sem segredos no repositório. A chave em `config.js` é a `anon` (pública por desenho). `.env`, chaves e tokens estão no `.gitignore`.
- `gecope-assistant`: autenticação, autorização (admin ou `assistente_dados`), limite por hora, SQL validado em duas camadas (JS e Postgres), função com `EXECUTE` só para `service_role`, role somente leitura. Sem achados.
- `eletrica-drive-token/-download`: usam client com o JWT do usuário (RLS), papel conferido, id do arquivo vem do banco, CORS restrito. Sem achados.
- Proxy WhatsApp: validação de token, `requireAdmin` nas rotas sensíveis, destino restrito a telefones cadastrados, reenvio com compare-and-swap, Evolution sem porta pública. O worker é cuidadoso quanto a duplicidade.
- `admin.js`, `contratos.js`, `orcamentos.js`, `processos.js` escapam o texto de usuário (`escapeHTML`). As views usam `security_invoker`. Processos pagina a leitura além de 1000 linhas.

## 3. Limites desta revisão (o que NÃO foi validado)

- **Banco de produção não foi consultado** (sem acesso nesta sessão). O estado do RLS vem de `resultado.csv` e `resultados/*.csv` (dumps de 18–22/09) e dos scripts SQL do repositório. Os itens marcados "verificar no banco" dependem de conferir `pg_policies` hoje.
- Não há lint, type-check, build nem testes de front-end no projeto. Existe só `deno task test` (guards do assistente), que **não foi executado**.
- Lido de forma direcionada: Edge Functions, proxy, RLS, `core/auth.js`, trechos de `processos.js`, `admin.js`, `atividades.js`, `cronograma.html`, `curva_abc*.js`, CDNs. **Não lido:** `motor_intencoes.ts`, `relatorio.js`, `tabelas.js`, `composicoes.js`, `financeiro.js`, a maior parte de `mapa-obras.js` (já revisado em 02/10, ver `docs/revisoes/`).

## 4. Problemas encontrados (15)

| # | Problema | Criticidade | Arquivo:função | Causa | Correção proposta | Risco | Esforço |
|---|---|---|---|---|---|---|---|
| 1 | **Cronograma apaga as 3 tabelas inteiras e reinsere a cada gravação.** Dois usuários com a página aberta: quem salva por último apaga o trabalho do outro. Se um `insert` falha (rede, RLS, aba fechada entre o delete e o insert), os dados somem de vez: os erros só vão para o `console.error`, e os `delete` nem têm o erro lido. Agrava: o carregamento (`select('*')` sem `.range`) devolve no máximo 1000 linhas, então, passando disso, a gravação seguinte apaga o excedente. | **Crítico** | `cronograma.html:_persistirNoSupabase` (l. 2021), `carregarDadosSupabase` (l. 2041) | Estratégia "sincronização completa" escolhida por simplicidade; estado em memória tratado como fonte da verdade. | Gravar por registro: `upsert` só do que mudou e `delete` só dos ids removidos localmente (diff contra o último snapshot carregado); conferir `error` de cada chamada e avisar o usuário; paginar a leitura. | Médio: toca todos os pontos que chamam `salvarDados()`; testar com duas abas. | M |
| 2 | **Painel do assistente aberto a qualquer conta logada**, inclusive autocadastro `pending`. Devolve perguntas de todos os usuários, trecho do SQL gerado e mensagens de erro, lidos com service role. CORS `*`. | **Alto** | `supabase/functions/gecope-assistant-painel/index.ts` (l. 61–67) | Só checa `auth.getUser`; o comentário registra a decisão de 05/09 de não checar papel, tomada antes de o autocadastro ser considerado. | Reaproveitar a checagem da `gecope-assistant` (admin ou autorização `assistente_dados`). CORS para `https://sop-difor.github.io`. **Precisa da sua aprovação, pois contraria a decisão registrada.** | Baixo | P |
| 3 | **Qualquer conta autocadastrada pode enviar WhatsApp em texto livre**, pelo número oficial, a qualquer funcionário cadastrado. `/api/whatsapp/send` usa só `requireAuth` e a policy `whatsapp_logs_insert_authenticated` só exige `status='processando'`. `isKnownRecipient` limita o destino, mas não quem envia nem o conteúdo. Serve para phishing interno. Também não há limite de taxa. | **Alto** | `server/whatsapp-proxy/web/index.js:/api/whatsapp/send`, `auth-middleware.js:requireAuth` | Autenticação ≠ autorização (ver §1). | Novo middleware `requireRoleValido` (consulta `app_users.role in admin/gerente/fiscal/externo`, no mesmo cache de 60 s do token) em `/send` e `/status`; `express-rate-limit` ou contador simples por usuário; policy de `whatsapp_logs` exigindo `tem_papel_valido()`. | Baixo | P |
| 4 | **XSS armazenado alcançável por conta autocadastrada.** A policy `app_atividades_all_authenticated` (ALL, `true`) permite a qualquer autenticado inserir/alterar/apagar o feed de atividades, e `atividades.js` injeta `at.tipo` **sem escapar** no `innerHTML`. O script roda no navegador do admin e dá acesso ao token de sessão. Sem script de correção no repositório. | **Alto** (verificar no banco) | `modules/atividades/atividades.js:90` (`${at.tipo}`); policy em `resultados/…(7).csv` | Policy de "scaffolding" mantida; campo `tipo` tratado como confiável. | (a) `escapeHTML(at.tipo)` no front. (b) SQL: dropar a policy `ALL`; `insert` com `tem_papel_valido()` e `usuario` = e-mail do JWT; `update`/`delete` só admin. | Baixo (testar o registro de atividades de cada papel) | P |
| 5 | **Salvar processo sobrescreve com dado velho o que o cron do SUITE atualizou.** O formulário envia `status`, fiscal, valores etc. completos, lidos quando o modal abriu. Se o `sincronizar-suite` mudou o status nesse intervalo, o "Salvar" desfaz a mudança sem aviso. | **Médio** | `modules/processos/processos.js:executarAcaoDetalhes` (l. 2178–2286) | Update com todas as colunas do formulário, sem comparar com o original nem com o estado atual. | Enviar só os campos que o usuário alterou (diff contra `registroOriginal`); no caso do `status`, só se mudou no formulário. | Médio: a automação de metas depende de `statusMudou`; manter. | M |
| 6 | **`consulta-ceara-transparente` é pública e sem validação.** Publicada com `--no-verify-jwt`, CORS `*`, `id` interpolado no caminho (`../` redireciona dentro do mesmo host), flag `debug` devolve cabeçalhos e HTML. Nenhum arquivo do repositório a chama. É um proxy aberto, que consome cota e pode ser usado para bloquear o IP da função no portal. | **Médio** | `supabase/functions/consulta-ceara-transparente/index.ts` (l. 245–263) | Função pensada como utilitário, sem exigir sessão. | Se não é usada: remover. Se é: exigir JWT, validar `id` com `/^\d+$/` e `sacc` com `/^\d{1,12}$/`, remover `debug`. | Baixo | P |
| 7 | **Scripts de CDN sem SRI e sem CSP; alguns sem versão fixa** (`supabase-js@2` em cronograma e assistente, `sweetalert2@11`). O token de sessão fica em `localStorage`; um pacote comprometido leria a sessão de todos. | **Médio** | `index.html:26-31`, `cronograma.html:17,25`, `assistente.html:11,16`, `gecope_mapa_obras.html:233,237` | Dependências carregadas direto da CDN. | Fixar versões exatas, adicionar `integrity` + `crossorigin="anonymous"`; considerar CSP via `<meta>`. Alinhar a versão do supabase-js (2.117.2) em todas as páginas. | Baixo | P |
| 8 | **Curva ABC lê itens sem paginar.** Acima de 1000 itens, a curva, os comentários e a contagem de inconsistências saem truncados em silêncio (PostgREST). | **Médio** (depende do tamanho real das curvas; não validado) | `modules/curva-abc/curva_abc.js:619`, `curva_abc_processo.js:57,151` | `select` sem `.range`; o padrão correto já existe em `processos.js` (l. 64–90). | Extrair a leitura paginada para helper compartilhado e usar nas três consultas; checar `count` esperado. | Baixo | P |
| 9 | **`rls_app_users.sql` está desatualizado e é "seguro reaplicar".** Define `SELECT using (true)` para todos, inclusive `anon`, expondo telefone, papel e matrícula de todos os usuários. O `auth.js` indica que em produção a tabela deixou de ser pública e passou a usar `app_users_lookup_by_matricula`, cujo SQL **não está no repositório**. Reaplicar o arquivo (ou recriar o banco) reabre o vazamento. Políticas de Storage também não estão versionadas. | **Médio** (verificar no banco) | `sql/_aplicados/rls_app_users.sql`; `core/auth.js:744,806` | Estado real do banco divergiu do versionado. | Exportar do banco a policy atual de `app_users`, a função `app_users_lookup_by_matricula` e as policies de `storage.objects`; versionar e corrigir o cabeçalho do arquivo antigo. | Baixo | P |
| 10 | **Buckets `orcamentos` e `composicoes_biblioteca` são públicos** (`getPublicUrl`, cache de 1 ano) e as tabelas têm leitura `anon` (documentada como intencional). Caminho do arquivo é previsível (`CATEGORIA/SUBCATEGORIA/OBRA/V1_NOME`). Se houver planilha interna, ela é acessível sem login. | **Baixo/Médio** (decisão de negócio, não validado) | `orcamentos.js:60-82`, `composicoes.js:73-79` | Biblioteca pensada como compartilhada. | Confirmar com o setor se o conteúdo pode ser público; se não, bucket privado + `createSignedUrl`. | Médio (links já gravados no banco) | M |
| 11 | **Worker pode duplicar mensagem.** Em timeout de 15 s da Evolution (que talvez tenha enviado), o laço repete até 3 vezes. | **Baixo** | `server/whatsapp-proxy/worker/worker.js:processJob` (l. 260–273) | Retentativa também em erro ambíguo. | Retentar só em erro de conexão recusada/5xx explícito; timeout vira falha com revisão manual (já existe o fluxo). | Baixo | P |
| 12 | **Imagens e dependências sem fixação:** `evoapicloud/evolution-api:latest`; `Dockerfile` usa `npm ci … \|\| npm i`, que ignora o lockfile se o `ci` falhar; funções importam `esm.sh/@supabase/supabase-js@2` e `std@0.168.0`. | **Baixo** | `server/whatsapp-proxy/docker-compose.yml`, `Dockerfile`, `sincronizar-suite/index.ts:25-26` | Conveniência. | Fixar tag/digest da imagem; remover o fallback `npm i`; fixar versões. | Médio (atualizar a imagem pode exigir re-parear o QR) | P |
| 13 | **Comparação do `x-sync-secret` não é em tempo constante.** | **Baixo** | `sincronizar-suite/index.ts:357-362`, `backfill-historico-suite/index.ts:340-352` | `!==` direto. | Comparação com `crypto.subtle.timingSafeEqual` ou equivalente. | Baixo | P |
| 14 | **Insert anônimo em `app_notifications`** (`new_user_request`), sem limite. Enche a caixa de aprovações do admin. E `config_whatsapp` é legível por qualquer autenticado. | **Baixo** | policies em `resultado.csv` | Necessário para o autocadastro funcionar. | Mover a notificação para o servidor (trigger no insert em `app_users`) e fechar o insert anônimo; `config_whatsapp` só para papel válido. | Médio (mexe no fluxo de cadastro) | M |
| 15 | **Dumps de produção versionados** (`resultado.csv`, `resultados/*.csv`: policies, estatísticas, nomes de arquivos). Se o repositório for público, mapeiam as brechas conhecidas. | **Baixo** | `resultado.csv`, `resultados/` | Resultados de diagnóstico commitados. | Mover para fora do repositório ou resumir em `docs/`; adicionar ao `.gitignore`. | Baixo | P |

## 5. Ordem sugerida de correção

1. **Lote A (segurança, pequeno):** #3, #4, #2 (se aprovado), #6.
2. **Lote B (integridade):** #1, depois #5 e #8.
3. **Lote C (endurecimento):** #7, #9, #11, #12, #13.
4. **Decisão de vocês:** #10, #14, #15.

Os itens #3 (parte SQL), #4 (parte SQL) e #9 exigem rodar SQL no banco. Eu escrevo o script, e a aplicação continua com você.

## 6. Histórico de correções

### Lote A — segurança (#2, #3, #4, #6) · branch `fix/revisao-lote-a`

| # | O que mudou | Status |
|---|---|---|
| 2 | `gecope-assistant-painel` exige admin ou autorização `assistente_dados` (403 com mensagem que o painel já exibe); CORS restrito a `https://sop-difor.github.io`. | Corrigido no código — **precisa de `supabase functions deploy gecope-assistant-painel`** |
| 3 | Proxy: novo `requirePapelValido` (admin/gerente/fiscal/externo/eletrica, cache de 60 s, falha fechada) em `/send` e `/status`; limite de 30 envios/min por usuário (`rate-limit.js`, depois da checagem de destinatário). SQL `sql/fix_whatsapp_logs_insert_papel_valido.sql` restringe o INSERT de `whatsapp_logs`. | Corrigido — SQL aplicado e `whatsapp-proxy-web` reconstruído na VM (08/10/2026, healthy) |
| 4 | `atividades.js`: `escapeHTML` em `at.tipo` e no rótulo do badge (o rótulo padrão devolvia o `tipo` cru). SQL `sql/fix_app_atividades_rls.sql` troca a policy `ALL` por SELECT/INSERT com `tem_papel_valido()`. | Front corrigido — **precisa rodar o SQL** (conferir o `select` de `pg_policies` do passo [1] antes) |
| 6 | `consulta-ceara-transparente` **removida do código** (decisão do usuário em 08/10/2026: não é usada). Substitui a correção planejada (JWT, validação de `id`/`sacc`, sem `debug`). Referências em `docs/MAPA-MODULOS.md` e comentário do `eletrica-drive-token` limpos; documentos históricos (`auditoria-egress-2026-09.md`, `AUDITORIA_INDEX.md`) mantidos como registro. | Removida do repositório — **ainda precisa ser apagada no Supabase**: `supabase functions delete consulta-ceara-transparente` (ou painel > Edge Functions). Enquanto estiver publicada, continua pública. |

**Testes rodados:** `npm test` em `server/whatsapp-proxy` (node --test): 13 de 13 passam, cobrindo papel pending/ausente/válido (inclusive `eletrica`), falha ao consultar o banco, cache, escape de curingas e limitador. `node --check` em `index.js`, `auth-middleware.js` e `atividades.js`: ok. Escape do payload `<img onerror>` conferido com a `escapeHTML` real do `utils.js`.

**Não validado:** as Edge Functions em TypeScript (sem `deno` neste ambiente: nem tipos nem execução); as duas policies SQL (não executadas, sem acesso ao banco); o fluxo real de envio de WhatsApp e do painel no navegador.

**Revisor (1 rodada):** achou que o papel `eletrica` ficava de fora do proxy (quebraria notificações e status para engenheiros elétricos) — corrigido e coberto por teste. Também ajustados: o limite agora só conta destinatários válidos e um comentário desatualizado em `eletrica-drive-token`. Sem pendências abertas do revisor.

**Efeito esperado após o deploy:** contas `pending` passam a receber 403 no painel do assistente, no `/send` e `/status` do proxy, e deixam de ler/gravar `app_atividades` e inserir `whatsapp_logs`. 

### Lote B — integridade de dados (#1, #5, #8) · branch `fix/revisao-lote-b`

| # | O que mudou | Status |
|---|---|---|
| 1 | **Cronograma não apaga mais as tabelas.** Nova `shared/cronograma-persist.js`: leitura paginada (contagem exata, resiste a `max-rows` menor que a página) que guarda um retrato id→linha; gravação só das diferenças (`upsert` em lotes de 500) e `delete` só dos ids que esta sessão removeu, pais antes dos filhos. Falha de rede/RLS/FK não perde nada: aparece um banner vermelho fixo, o retrato só avança no que o banco confirmou e a próxima gravação reenvia. Linha com FK violada (analista removido por outra pessoa) é isolada, não prende o banner e gera aviso próprio. Tarefas sincronizadas de Processos passam a ter id `sync-<NUP>` para duas sessões não duplicarem. | Corrigido no código (front, vai com o merge) |
| 5 | `executarAcaoDetalhes` só envia `status` se a pessoa o alterou em relação ao exibido; antes, editar outro campo devolvia o processo ao status velho se o `sincronizar-suite` o tivesse mudado com a tela aberta. | Corrigido no código |
| 8 | `lerTodasAsLinhas()` em `utils.js` (paginação com contagem exata) usada nas 3 leituras de `curva_abc_itens` (carregar versão, contagem de inconsistências, comentários do relatório). | Corrigido no código |

**Testes rodados:** `node --test shared/cronograma-persist.test.js` (13/13: leitura >1000 e com `max-rows` baixo, nada escrito sem mudança, só diferenças, linha de outra pessoa sobrevive, falha de gravação/exclusão sem perda e com reenvio, ordem pai/filho, FK, erro isolado por linha); `node --test utils.test.js` (5/5); `npm test` do proxy (13/13). Sintaxe: `node --check` em `utils.js`, `curva_abc*.js`, `processos.js`; os dois blocos de script inline do `cronograma.html` compilam.

**Não validado:** nada foi executado no navegador nem contra o banco real (cronograma com duas abas, Curva ABC com >1000 itens, salvar processo com o cron mexendo no status). O #5 não tem teste automatizado (função grande, presa ao DOM).

**Revisor (1 rodada):** sem achados Críticos/Altos. Médio tratado: uma linha impossível de gravar (FK) mantinha o banner de erro para sempre → corrigido, com testes. Registrado, não corrigido:
- **Ordem dos analistas pode mudar uma vez** (Médio, visual): o código antigo regravava todos num só insert, então todos têm o mesmo `created_at`; agora o desempate é por `id` (aleatório). Os 6 analistas semeados juntos podem aparecer em outra ordem; depois fica estável. Se importar, definir `created_at` crescente por SQL na ordem desejada.
- **Última escrita vence por linha** (Baixo): se duas pessoas editam a MESMA tarefa, a última a salvar vence naquela linha; e uma sessão desatualizada pode recriar uma linha que outra apagou. É inerente ao desenho e muito menor que o apagar-tudo anterior. Controle de versão por linha seria a evolução, não feita.
- **Sincronização simultânea** (Baixo): duas sessões criando a mesma `sync-<NUP>` ao mesmo tempo — a segunda sobrescreve a primeira com conteúdo equivalente.

### Lote C — endurecimento (#7, #9, #11, #12, #13) · branch `fix/revisao-lote-c` (empilhada sobre o Lote B)

| # | O que mudou | Status |
|---|---|---|
| 7 | SRI (`integrity` sha384 + `crossorigin`) em 17 tags de CDN de `index.html`, `cronograma.html`, `assistente.html`, `assistente-painel.html` e `gecope_mapa_obras.html` (supabase-js, plotly, sweetalert2, dompurify, chart.js, leaflet js/css, bootstrap js/css, bootstrap-icons). Versões fixadas: `supabase-js@2` → `2.117.2` (a que `index.html` e o mapa já usavam), `sweetalert2@11` → `11.26.25` (arquivo byte a byte igual ao que a página carregava). Todos os hosts devolvem CORS `*`. | Corrigido (front, vai com o merge) |
| 9 | Aviso "NÃO REAPLIQUE" no topo de `sql/_aplicados/rls_app_users.sql`; novo `sql/diagnostico_exportar_rls_atual.sql` (somente leitura) para trazer ao repositório as policies atuais de `app_users`, a função `app_users_lookup_by_matricula`, buckets/policies de Storage, policies com condição `true` e funções SECURITY DEFINER abertas ao `anon`. | **Parcial**: falta rodar o script no banco e versionar o resultado |
| 11 | Worker: erro ambíguo (timeout de resposta, conexão cortada depois do envio) não é mais repetido; o job vira `failed` com instrução de conferir se a mensagem chegou, e o botão "Reenviar" do admin segue disponível. `worker/envio-erros.js` + testes. | Corrigido — worker reconstruído na VM em 09/10/2026 (log "Worker iniciado e aguardando jobs...", sem erro) |
| 12 | `Dockerfile`: `npm ci --omit=dev` sem o fallback `npm i` (lockfile conferido em dia com `npm ci --dry-run`). `docker-compose.yml`: imagem da Evolution fixada em `2.3.7@sha256:96662553…` (versão e digest lidos na própria VM em 08/10/2026, ou seja, a imagem que já rodava). | Corrigido no repositório — **a VM só adota ao editar o compose dela** (não recria o container se não for pedido) |
| 13 | `sincronizar-suite` e `backfill-historico-suite`: `x-sync-secret` comparado em tempo constante (`segredoConfere`, SHA-256 + XOR). Sem segredo configurado continua negando. | Corrigido — `sincronizar-suite` publicada em 08/10/2026 (cron conferido em 09/10: segue rodando). `backfill-historico-suite` NÃO deve ficar publicada (função arquivada em 22/09; publicada por engano e removida em 09/10) |

**Testes rodados:** `npm test` do proxy (18/18: inclui 5 novos do classificador de erros); `node --test` do cronograma e do helper (18/18). `node --check` em `worker.js`. Em navegador headless, as 5 páginas carregam com todas as bibliotecas definidas (`supabase.createClient`, `Swal`, `DOMPurify`, `Plotly`, `bootstrap`, `Chart`, `L`) e sem erro de integridade no console; um hash propositalmente errado é bloqueado (SRI efetivamente em vigor). O revisor recalculou os 9 hashes de forma independente: todos batem.

**Não validado:** as duas Edge Functions em TypeScript (sem `deno`; a lógica de `segredoConfere` foi conferida em Node com os mesmos casos); o rebuild real dos containers; o script de diagnóstico no banco (sintaxe revisada, não executado).

**Revisor (1 rodada):** sem regressões. Apontou o `bootstrap.bundle` sem SRI, **corrigido** (hash idêntico ao publicado pelo Bootstrap). Registrado sem tratar:
- **Ainda sem SRI** (Baixo): carregamento dinâmico de jspdf, autotable, docx e exceljs em `utils.js` (`carregarBiblioteca`), e o HTML gerado por `relatorio.js` (bootstrap, bootstrap-icons e `cdn.tailwindcss.com`, este último sem versão fixa por natureza). Exigem fixar versões e calcular hashes um a um.
- **Imports Deno** `esm.sh/@supabase/supabase-js@2` e `std@0.168.0` em `sincronizar-suite`/`backfill`: não fixados, porque sem `deno` não dá para testar a troca nem sei a versão publicada.
- **Worker mais conservador** (Baixo): um `ETIMEDOUT` que ocorreu antes do envio agora também vai para revisão manual em vez de tentar 3 vezes.

## 7. Achados novos do diagnóstico de RLS (08/10/2026, depois da Etapa 1)

Vieram da saída de `sql/diagnostico_exportar_rls_atual.sql` rodado em produção (a saída fica só na máquina local, pasta ignorada pelo Git).

| # | Problema | Criticidade | Onde | Correção |
|---|---|---|---|---|
| 16 | **Storage aberto a qualquer conta logada:** as policies "Public Upload …" dos buckets `orcamentos` e `composicoes_biblioteca` permitem enviar, sobrescrever e **apagar** arquivos a qualquer autenticado (inclusive autocadastro `pending`), pois só checam o nome do bucket. | **Alto** | `storage.objects` | Lote D, bloco 1 |
| 17 | **Todos os usuários legíveis por qualquer conta logada:** a policy "Usuários autenticados podem ver perfis" (`SELECT … true`) em `app_users` expõe nome, e-mail, matrícula, **telefone** e papel de toda a equipe a quem se cadastrar. | **Alto** | `public.app_users` | Lote D, bloco 2 (preserva a busca de "fantasma" do cadastro; o telefone dos fantasmas continua visível a contas novas) |
| 18 | **Funções SECURITY DEFINER executáveis por `anon`:** `atualizar_tempos_suite`, `atualizar_tempo_suite_processo`, `atualizar_tempos_suite_processos`, `calcular_tempo_suite_*` podem ser chamadas por quem tem a chave pública (que está em `config.js`): recálculo pesado sob demanda. | Médio | `public` | Lote D, bloco 3 |
| 19 | `historico_metas` aceita INSERT de qualquer autenticado; `historico_metas`, `historico_atribuicao_fiscal` e `config_whatsapp` são legíveis por qualquer autenticado. | Baixo/Médio | `public` | Lote D, bloco 4 |
| 20 | **Edge Functions em produção que não existem no repositório e não foram revisadas:** `approve-user`, `disparar-whatsapp`, `get-economic-indices`, `sync-institutional-emails`. **Revisadas em 09/10/2026: `approve-user` (Baixo) e `disparar-whatsapp` (CRÍTICO, ver seção 8); as outras duas seguem sem revisão.** | Crítico (`disparar-whatsapp`) | Supabase > Edge Functions | Ver seção 8 |

Também confirmados no mesmo diagnóstico, sem ação nova: os buckets `orcamentos`, `composicoes_biblioteca` e `sop_inicial` são públicos para leitura (decisão #10); a função de login `app_users_lookup_by_matricula` existe e devolve só `nome, sobrenome, email` de uma matrícula (por desenho, mas permite descobrir o e-mail de quem tem uma matrícula conhecida).

### Lote D — APLICADO em 08/10/2026 (#16 a #19) · branch `fix/revisao-lote-d` (sobre o Lote C)

`sql/fix_lote_d_acesso_contas_pending.sql`: 4 blocos independentes, cada um com conferência prévia, teste sugerido e reversão. Nada é apagado; só trocam regras de acesso.

**Testado:** o arquivo foi executado inteiro contra um Postgres real (pglite, em WASM) com um esquema simulado das tabelas/policies afetadas e os papéis `anon`, `authenticated` e `service_role`: 17 verificações, todas passaram. Reproduz o problema antes (conta `pending` apaga arquivo e lê todos os usuários) e confirma depois que `pending` não envia, não apaga, não lê usuários alheios, não insere em `historico_metas`; que fiscal e admin seguem operando; que a leitura pública dos arquivos continua; que o login com matrícula e a busca do "fantasma" no cadastro continuam funcionando; e que `anon` perde o acesso às funções mas `authenticated` e `service_role` mantêm.

**Aplicação em produção (08/10/2026):** os 4 blocos rodaram com "Success". Testes no sistema real: bloco 1 (storage) e bloco 4 (meta de processo, Painel de Fiscais, histórico/WhatsApp) OK; bloco 2: testes 1–3 OK; bloco 3: conferido (`anon` sem execute). **Ficou sem teste** o cadastro com matrícula de fantasma do bloco 2 (não há fantasmas hoje); refazer se aparecer um.

**Não validado (antes de aplicar):** é um modelo do banco, não o banco real (as policies reais de `app_users` além da de leitura ampla não foram vistas; o bloco 2 manda conferir antes). Falta o teste no sistema de verdade, descrito no fim de cada bloco, em especial **um cadastro de teste com matrícula de fantasma** (bloco 2).

### Ocorrência de deploy (08/10/2026, ~17h)

Ao publicar a correção do painel, o código de `gecope-assistant-painel` foi colado na função `gecope-assistant`. Comprovado de fora: ambas respondem no formato do painel (`{"erro":…}`) e a `gecope-assistant` passou a devolver o CORS do painel. Efeito: o Assistente de Dados ficou sem funcionar. **Resolvido na mesma noite:** cada código foi republicado na função certa (CORS conferido: assistant=`*`, painel=`https://sop-difor.github.io`) e o Assistente respondeu normalmente em 09/10.

## 8. Revisão das Edge Functions fora do repositório (09/10/2026)

Código copiado do painel do Supabase pela pessoa responsável. Cópias arquivadas em `docs/funcoes-arquivadas/` (fora de `supabase/functions/` de propósito, para um deploy geral não as republicar).

| Função | Veredito | Motivo | Ação |
|---|---|---|---|
| `disparar-whatsapp` | **CRÍTICO** | Nenhuma checagem de quem chama. O "Verify JWT" do Supabase aceita a chave anon, que é pública (`config.js`): qualquer visitante do site pode disparar mensagem arbitrária, a números arbitrários, a partir do WhatsApp oficial da SOP (phishing em nome do órgão, risco de banimento). Sem limite de destinatários/frequência; contorna o proxy (papel válido, 30/min, fila). Nada no site a chama. | **APAGADA em 09/10/2026** (confirmado na lista de funções). Antes de apagar: nada no site a chama (o envio vai pelo proxy, `whatsapp.js`), nenhum gatilho/função/cron do banco a menciona (consulta em `pg_proc`, `pg_trigger` e `cron.job` voltou vazia) e a aba Invocations estava vazia. Os segredos `EVOLUTION_*` não existem mais em Secrets. A chave da Evolution não é devolvida pelo código; não precisa ser trocada por causa dela. |
| `approve-user` | Baixo (sem falha grave) | Autenticação correta (token + role `admin` em `app_users`). Mas fabrica e-mail `matricula@gecope.app` (origem das contas com e-mail trocado, ver `sql/_aplicados/fix_app_users_email_mismatch.sql`), não é chamada pelo site (aprovação é direta no `admin.js`, desde 14/08/2026) e roda com a chave de serviço sem uso. Sem chamadas registradas. | **APAGADA em 09/10/2026** (confirmado na lista de funções; sem chamadas registradas). |
| `get-economic-indices` | Não revisada | — | Colar o código e revisar. |
| `sync-institutional-emails` | Não revisada | — | Colar o código e revisar. |

**Estado em 09/10/2026:** `backfill-historico-suite` (arquivo morto, publicada por engano no Lote C), `disparar-whatsapp` e `approve-user` foram removidas do Supabase; restam 7 funções (`eletrica-drive-download`, `eletrica-drive-token`, `gecope-assistant`, `gecope-assistant-painel`, `get-economic-indices`, `sincronizar-suite`, `sync-institutional-emails`). Lição: antes de publicar função, cruzar com `docs/MAPA-MODULOS.md`.

## 9. Fechamento

- **Feito e verificado:** Lotes A–D no código (PRs #52–#55) e em produção (SQL, Edge Functions, VM: `whatsapp-proxy-web` e `whatsapp-proxy-worker` reconstruídos; a Evolution foi recriada junto, agora em 2.3.7 fixada, e a sessão WhatsApp reconectou sozinha).
- **Pendente:** (1) revisar `get-economic-indices` e `sync-institutional-emails` e, junto, decidir os segredos `GECOPE_SYNC_KEY` e `GECOPE-SUITE-2026`, que nenhuma função versionada usa (só `SYNC_SECRET` é usado, pela `sincronizar-suite`; o segundo tem nome com cara de valor, não de nome — conferir antes de apagar); (3) teste do cadastro com matrícula de fantasma (bloco 2 do Lote D) quando houver um; (4) #9 só parcial: o diagnóstico de RLS não é versionado por conter inventário de segurança; (5) SRI ainda ausente nas bibliotecas carregadas dinamicamente (`utils.js`, `relatorio.js`) e imports Deno não fixados (itens Baixos da seção 6); (6) o plano FREE do Supabase está sem período de tolerância (aviso no painel): conferir o uso da cota (`docs/auditoria-egress-2026-09.md`); (7) revogar tokens do Supabase que não sejam mais necessários.
