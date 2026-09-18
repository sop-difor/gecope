# Plano de correção — egress do Supabase (18/09/2026)

Baseado em [docs/auditoria-egress-2026-09.md](auditoria-egress-2026-09.md). Cada etapa é pequena o bastante para revisar e testar isoladamente antes de seguir para a próxima. SQL nunca é aplicado por mim — cada etapa que mexe no banco entrega um script pronto para você rodar.

## Passo 0 — Base para revisar com segurança

**Esta pasta não é um repositório git.** Sem isso, não dá para gerar diff de verdade nem reverter uma etapa com um comando. Proposta: `git init` + primeiro commit do estado atual, só localmente (sem remoto, sem push a lugar nenhum). Isso não muda nenhum arquivo de comportamento — só passa a rastrear o que muda. Cada etapa abaixo vira um commit, revisável e reversível.

Se preferir não usar git, sigo com cópias `.bak` dos arquivos antes de cada etapa — funciona, mas revisar fica mais manual e reverter é por minha conta, não por comando.

## Passo 0.5 — Verificação de segurança (rodar antes de priorizar o resto)

Achado da medição real: gravações em `sinapi_itens`/`seinfra_itens` feitas com o papel `anon`, e o front-end não escreve nelas. Antes de decidir a ordem das etapas seguintes, rode isto no SQL Editor (só leitura):

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('seinfra_composicao','sinapi_composicao','orse_composicao',
                     'seinfra_itens','sinapi_itens','orse_itens')
  and grantee in ('anon','authenticated');
```

- **Se `anon` tiver `UPDATE`/`INSERT`:** isso passa à frente de tudo — vira um Passo 1 de segurança (revogar o grant e corrigir a credencial do programa de carga), antes mesmo da Onda 1 de egress.
- **Se não tiver:** as gravações que apareceram como `anon` foram bloqueadas pela RLS (sem efeito) e o item fica como baixa prioridade — só vale localizar e corrigir a credencial do script de carga por organização.

Me diga o resultado antes de eu seguir para o Passo 1.

---

## Passo 1 — Onda 1 (front-end, sem SQL, risco baixo)

| # | Mudança | Arquivo | Risco |
|---|---|---|---|
| 1.1 | Apagar a consulta morta de 10k `whatsapp_logs` | [whatsapp.js:58-80](../whatsapp.js#L58-L80) | nenhum — resultado não usado |
| 1.2 | Boot só carrega `processos` se já houver papel em `sessionStorage`; remover a chamada duplicada de `carregarListaFiscais` | [shell.js:272](../core/shell.js#L272), [:275](../core/shell.js#L275), [auth.js:709](../core/auth.js#L709) | baixo |
| 1.3 | Orçamentos: um só ouvinte de busca, filtrando dados em cache; tirar a carga eager do boot | [shell.js:313](../core/shell.js#L313), [:363](../core/shell.js#L363), [orcamentos.js:435](../modules/orcamentos/orcamentos.js#L435) | baixo-médio — muda o momento em que a lista aparece |
| 1.4 | Composições: remover a carga duplicada do boot; busca não-SOP filtra em cache | [composicoes.js:652](../modules/composicoes/composicoes.js#L652), [:470](../modules/composicoes/composicoes.js#L470) | baixo-médio |
| 1.5 | Notificações de admin: marcar como lida sem baixar as linhas; pausar com `document.hidden`; subir o intervalo | [admin.js:657-673](../modules/administracao/admin.js#L657) | baixo |
| 1.6 | Badge de status do WhatsApp: pausar com `document.hidden`; subir para 3-5 min | [whatsapp.js:1139](../whatsapp.js#L1139) | baixo |
| 1.7 | Remover `?t=` do cache-busting | [composicoes.js:1605](../modules/composicoes/composicoes.js#L1605), [:2020](../modules/composicoes/composicoes.js#L2020) | baixo |
| 1.8 | Tirar `.select()` do insert de itens (retorno não usado) | [curva_abc.js:842](../modules/curva-abc/curva_abc.js#L842) | nenhum |

**Revisão desta etapa** (antes de você testar na tela):
1. `/code-review` (nível médio) no diff da etapa — correção e simplificação.
2. Um revisor à parte, focado só em checar que cada mudança resolve exatamente o item diagnosticado no relatório de auditoria, sem efeito colateral em outra função que dependa do mesmo código (ex.: algo que espera `window._composicoesCarregadas` já estar true, ou que dependia do refetch para atualizar a tela).
3. Um terceiro revisor adversarial, tentando achar um caminho em que a tela fique com dado desatualizado por causa da mudança (cache sem invalidação, aba que nunca dispara o primeiro carregamento).

Só depois dessas três passadas eu te aviso para testar manualmente.

---

## Passo 2 — Onda 2 (front-end, risco médio)

| # | Mudança | Arquivo |
|---|---|---|
| 2.1 | Criar/editar/excluir processo: usar `.select(colunas).single()` no `update`/`insert` e corrigir só a linha em `window.allData`, em vez de recarregar tudo | [processos.js:1505](../modules/processos/processos.js#L1505), [:1823](../modules/processos/processos.js#L1823), [:2087](../modules/processos/processos.js#L2087) |
| 2.2 | Financeiro: derivar de `window.allData` (mesmo filtro e fórmula da view) em vez de consultar `vw_processos_financeiro` | [financeiro.js:451](../modules/financeiro/financeiro.js#L451) |
| 2.3 | `alerta_retorno_comentarios`: filtrar por status APROVADO e colunas explícitas | [processos.js:148](../modules/processos/processos.js#L148) |
| 2.4 | Mapa de obras: cache além dos 5 min, revalidado por uma sonda barata (`max(atualizado_em)`) | [mapa-obras.js:466](../assets/js/mapa-obras.js#L466) |

Risco maior porque 2.1 muda o caminho principal de gravação de processos (metas, fiscais, prioridade) — é onde mais lógica de negócio mora no sistema.

**Revisão desta etapa:**
1. `/code-review` nível alto (não médio) — o item 2.1 mexe no fluxo mais sensível do sistema.
2. Revisor dedicado a comparar, item por item, se o estado local após o patch fica idêntico ao que uma recarga completa produziria (mesmos campos recalculados, mesmos filtros reaplicados, `populateAllTabFilters`/`updateDashboard` chamados do jeito certo).
3. Revisor de regras de negócio: releitura de `processos.js` em volta de cada ponto alterado, para garantir que nenhuma regra (meta automática, fiscal, status) dependia de um dado que só vinha pela recarga completa.

Esta etapa pede teste manual mais cuidadoso antes de ir para a próxima: criar, editar e excluir um processo de teste, e abrir a aba Financeiro depois.

---

## Passo 3 — Serviços da VM (worker/watchdog/proxy)

| # | Mudança | Arquivo |
|---|---|---|
| 3.0 | Confirmar (ou fazer) o rebuild do worker com o backoff de 17/09 | `docker compose up -d --build whatsapp-proxy-worker` |
| 3.1 | `reclaimStaleJobs` para dentro do portão de 60s do orphan sweep | [worker.js:278](../server/whatsapp-proxy/worker/worker.js#L278) |
| 3.2 | Erro no loop não deve resetar o backoff para o mínimo | [worker.js:297](../server/whatsapp-proxy/worker/worker.js#L297) |
| 3.3 | Watchdog: colunas explícitas em vez de `*`; pular a checagem de falhas quando o estado já não é "open" | [watchdog.js:95](../server/whatsapp-proxy/watchdog/watchdog.js#L95) |
| 3.4 | `claimJob`: colunas explícitas nos dois passos (hoje traz a linha inteira duas vezes) | [worker.js:145-160](../server/whatsapp-proxy/worker/worker.js#L145) |
| 3.5 | Cache de `auth.getUser` no proxy (TTL curto) | [auth-middleware.js:24](../server/whatsapp-proxy/web/auth-middleware.js#L24) |
| 3.6 | Cache de `isKnownRecipient` (TTL curto) | [web/index.js:68](../server/whatsapp-proxy/web/index.js#L68) |
| 3.7 | Remover ou cachear a rota pública `/ready` | [web/index.js:110](../server/whatsapp-proxy/web/index.js#L110) |

Maior risco operacional do plano: é o pipeline de notificação do WhatsApp, que já teve um incidente em 21/08. Cada item testado isolado, com o watchdog observado por alguns minutos após o deploy antes de seguir para o próximo.

**Revisão desta etapa:**
1. `/code-review` nível alto.
2. Revisor focado especificamente em concorrência/atomicidade: `claimJob` e `reclaimStaleJobs` existem para evitar que dois workers peguem o mesmo job ou percam um job travado — qualquer mudança de coluna ou de gatilho precisa preservar essa garantia, não só economizar bytes.
3. Revisor operacional: relê `server/whatsapp-proxy/DEPLOY.md` e confirma que o plano de deploy/rollback de cada mudança está coberto.

---

## Passo 4 — SQL aplicado à mão

Entrego os scripts prontos; você aplica no SQL Editor.

| # | Mudança | Condição |
|---|---|---|
| 4.1 | Revogar `UPDATE`/`INSERT` de `anon` nas tabelas de preço e corrigir a credencial do programa de carga | só se o Passo 0.5 confirmar o grant |
| 4.2 | Reescrever `processos_rw_authenticated` no padrão `(select fn())` já usado nas outras políticas, para o Postgres calcular uma vez por consulta em vez de uma vez por linha | sempre, prioridade baixa (não é egress, é custo de processamento) |
| 4.3 | View `DISTINCT ON` para `comissao_fiscalizacao` (só o snapshot vigente) e índice em `whatsapp_logs.status`, se a medição de acompanhamento (Passo 5) ainda apontar peso nisso | condicional |

**Revisão:** como não aplico SQL, a revisão aqui é uma segunda leitura do script por um revisor à parte, focada em: o script é reversível (tem o `DROP POLICY`/`GRANT` inverso documentado), não afeta linhas fora do escopo descrito, e bate exatamente com o que o Passo 0.5 mediu — antes de eu te entregar o script como pronto para rodar.

---

## Passo 5 — Medir de novo

Depois dos Passos 1-4: resetar `pg_stat_statements` (`select pg_stat_statements_reset();`) e, 24-48h depois, rodar de novo os blocos [1] e [3] de `sql/diagnostico_egress.sql`. Compara com os números do Passo 0 desta rodada para confirmar que cada etapa realmente reduziu o volume esperado, e reordena o que sobrar se a realidade não bater com a estimativa.

---

## Resumo da ordem

```
Passo 0   → git init (ou combinamos outra rede de segurança)
Passo 0.5 → você roda a consulta de grants e me passa o resultado
Passo 1   → eu edito, 3 revisores avaliam, você testa
Passo 2   → eu edito, 3 revisores avaliam, você testa com mais cuidado
Passo 3   → eu edito + você faz o deploy na VM, 3 revisores avaliam, observamos o watchdog
Passo 4   → eu entrego os scripts, um revisor confere, você aplica
Passo 5   → medimos de novo e fechamos ou reabrimos itens
```
