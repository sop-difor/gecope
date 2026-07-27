# AUDITORIA_INDEX.md — Auditoria de `index.html` (GECOPE)

## PROGRESSO
- [x] Passo 0.1 — Mapeamento de arquivos referenciados pelo `index.html`
- [x] Passo 0.2 — Árvore de dependências
- [x] Passo 0.3 — Verificação de outros pontos de entrada (`cronograma.html`)
- [x] Bloco 1 — Segurança: segredos/credenciais expostos (varredura completa em `config.js`, `admin.js`, `whatsapp.js` e histórico git)
- [x] Bloco 2 — Segurança: XSS (innerHTML), eval/Function, target=_blank, sessão/permissão (amostragem em `main.js`, `admin.js`, `index.html`)
- [x] Bloco 3/4/5 (parcial) — Bugs, código morto e desempenho: varredura por amostragem/grep (IDs duplicados, console.log, lazy-loading, promises sem catch)
- [x] Bloco profundo — `admin.js` + `whatsapp.js` + `relatorio.js` + `dashboard.js` (revisão linha a linha completa via agente dedicado)
- [x] Bloco profundo — `curva_abc.js`, `curva_abc_processo.js`, `utils.js`, `database.js`, `app.js` (revisão linha a linha completa via agente dedicado)
- [x] Bloco profundo — `main.js` (8.349 linhas, revisão linha a linha completa via agente dedicado)
- [x] Bloco profundo — scripts inline de `index.html`, validação de formulários, CSS órfão em `style.css`
- [x] **Segunda rodada de correções (2026-07-26)** — XSS em `relatorio.js`/`whatsapp.js`/`admin.js` (injeção via onclick), rich-text XSS em `curva_abc.js`/`curva_abc_processo.js` (DOMPurify), código morto duplicado em `main.js`/`dashboard.js`, corrupção de acentuação em rótulos de PDF, `console.log` de sessão, performance (querySelector em loop, thead). Ver seção 7.
- [ ] Bloco 6 — Compatibilidade cross-browser/mobile — requer teste manual em navegador (não é possível auditar apenas por leitura de código)
- [ ] Consolidação final e plano de correção → em andamento, ver seção 7

**Próximo passo:** validar manualmente no navegador (login, cadastro, comentários com formatação rica, geração de PDF/relatórios, painel Admin) antes de commitar. O Bloco 6 (compatibilidade) permanece pendente de teste manual. O backdoor `promoteAdmin99030487` foi mantido por decisão explícita do usuário (2026-07-26).

**Duas rodadas de correções já aplicadas** (branch `revisao/index-html`, ainda não commitadas) — ver seções 4 e 7 para o detalhamento completo.

---

## 1. ÁRVORE DE DEPENDÊNCIAS DO index.html

```
index.html
├── CSS externo (CDN)
│   ├── Google Fonts (Montserrat) — fonts.googleapis.com
│   ├── bootstrap@5.3.3/dist/css/bootstrap.min.css — cdn.jsdelivr.net
│   └── bootstrap-icons@1.11.3 — cdn.jsdelivr.net
├── CSS local
│   └── style.css (3.949 linhas) — link rel="stylesheet" (linha 19)
├── Imagem preload
│   └── fachada.jpg (rel="preload")
├── Imagens inline
│   └── brasao.png (logo, landing page)
├── JS externo (CDN) — carregados no <head>
│   ├── @supabase/supabase-js@2                          (SEM defer — bloqueante)
│   ├── plotly-2.35.2.min.js                              (defer)
│   ├── jspdf 2.5.1                                        (defer)
│   ├── jspdf-autotable 3.5.31                             (defer)
│   ├── html2pdf.js 0.10.1                                 (defer)
│   ├── docx@7.1.0                                         (defer)
│   ├── pdf-lib@1.17.1                                     (defer)
│   ├── xlsx (SheetJS) latest                              (defer)
│   ├── exceljs@4.4.0                                      (defer)
│   └── sweetalert2@11                                     (defer)
├── JS externo (CDN) — no fim do <body>, linha 3886
│   └── bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js   (SEM defer/async)
└── JS local — no fim do <body>, linhas 4392-4406, NESTA ORDEM:
    ├── config.js              (10 linhas — credenciais/URLs globais)
    ├── whatsapp.js             (992 linhas)
    ├── relatorio.js            (913 linhas)
    ├── utils.js                (209 linhas)
    ├── database.js             (57 linhas)
    ├── dashboard.js            (690 linhas)
    ├── admin.js                (755 linhas)
    ├── curva_abc.js            (1.211 linhas)
    ├── curva_abc_processo.js   (231 linhas)
    ├── app.js                  (121 linhas)
    └── main.js                 (8.349 linhas) ← maior arquivo, carregado por último
```

**Observação estrutural:** os `<script>` locais (linhas 4392-4406) estão aninhados dentro de
vários `<div>` no fim do `<body>`, com indentação profunda incomum — indício de que foram
inseridos ali via edição rápida, não no local "canônico" de fechamento do body. Não é um bug
funcional (scripts fora de tags de bloco ainda são movidos pelo parser HTML para o body), mas é
um sinal de organização a observar. **Requer confirmação** antes de qualquer reorganização.

Nenhum dos scripts locais usa `defer`/`async` — todos bloqueiam o parsing até serem baixados e
executados, na ordem listada acima (que também define suas dependências implícitas entre si,
já que não são módulos ES — todos populam o escopo global `window`).

## 2. OUTROS PONTOS DE ENTRADA QUE COMPARTILHAM ARQUIVOS

| Arquivo | Compartilha com index.html | Risco de efeito colateral |
|---|---|---|
| `cronograma.html` | `style.css`, `config.js`, `database.js`, `bootstrap` CDN, Google Fonts | **Alto** — qualquer alteração em `style.css`, `config.js` ou `database.js` afeta as duas páginas. `cronograma.html` faz `window.location.href` de/para `index.html` (navegação cruzada, inclusive com querystring `?pane=pane-reuniao`). |
| `layout/GECOPE - LAYOUT.html` | Nenhum (arquivo standalone, mockup visual, 10MB, sem `<script src>` para os JS do sistema) | Nenhum — fora do escopo, não referencia os arquivos elegíveis |
| `Novas opções de layout GECOPE/Processo - Novas Opções.dc.html` | Nenhum (mockup estático) | Nenhum — fora do escopo |

**Conclusão do Passo 0:** os únicos arquivos "elegíveis" para alteração (usados efetivamente por
`index.html`) são `style.css`, `config.js`, `whatsapp.js`, `relatorio.js`, `utils.js`,
`database.js`, `dashboard.js`, `admin.js`, `curva_abc.js`, `curva_abc_processo.js`, `app.js` e
`main.js`. Destes, **`style.css`, `config.js` e `database.js` também são usados por
`cronograma.html`** — qualquer correção nesses três arquivos deve ser testada nas duas páginas.

---

## 3. ACHADOS

### BLOCO 1 — Segredos e credenciais expostas

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| **Crítico** | `config.js` | 7 | `window.EVO_API_KEY = 'sopgecope2026'` — chave da Evolution API (WhatsApp) hardcoded e enviada ao navegador de **qualquer** visitante, mesmo antes do login (script carrega no fim do body, mas antes de qualquer gate de autenticação real). Confirmado em 5 commits do histórico git, nunca rotacionada. | Qualquer pessoa com o DevTools aberto lê `window.EVO_API_KEY` e pode enviar mensagens/ler conversas via API do WhatsApp da instituição diretamente (`whatsapp.js:481,759,785,904,937,970` fazem `fetch` direto para `EVO_API_URL` com essa chave). O projeto já tem um proxy dedicado para isso (`evo-proxy/`, com variáveis de ambiente server-side) que **não está sendo usado** pelo front-end. |
| **Crítico** | `admin.js` | 5-6, 50-56, 66-75 | `SENHA_MESTRA = "sop2026"` hardcoded em texto plano no JS público. Pior: o "modo Administrador" é controlado só por `sessionStorage.setItem('is_admin_gecope','true')` — qualquer usuário pode digitar isso no console do navegador **sem saber a senha** e o front-end passa a se comportar como admin (`document.body.classList.add('is-admin')`). | Bypass total de autenticação client-side. Se qualquer ação restrita (aprovar usuário, editar processo, excluir dados) depender só dessa flag/classe e não de checagem server-side (RLS do Supabase), é uma falha crítica de autorização. **Requer confirmação**: preciso verificar as policies RLS do Supabase para saber se o backend também valida, ou se o cliente é a única barreira. |
| **Médio** | `config.js` | 2-3 | `SUPABASE_URL`/`SUPABASE_KEY` (anon key) expostos no front-end. Isso é o padrão esperado do Supabase (a anon key é pública por design), **mas só é seguro se houver Row Level Security (RLS) habilitado e restritivo em todas as tabelas.** | Sem RLS adequado, a anon key sozinha permite leitura/escrita irrestrita no banco. **Requer confirmação**: preciso checar as policies no painel Supabase (fora do escopo de arquivos do repo). |
| Baixo | `admin.js` | 693 | `is_admin_gecope: sessionStorage.getItem('is_admin_gecope')` é enviado/lido de sessionStorage e usado como se fosse dado confiável em outro ponto do fluxo. | Reforça o padrão acima — decisões de permissão remontadas a partir de estado 100% client-side. |

### BLOCO 2 — XSS, eval, links externos, sessão

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| **Alto** | `main.js` | 5390, 5831 | `sel.innerHTML = `<option value="${currentUserName}"...` — `currentUserName` vem de `sessionStorage.getItem('sop_user_name')` (linha 5389/5980), que por sua vez é populado a partir do nome digitado no cadastro ("Primeiro acesso", overlay de login em `index.html`). Se o campo de nome não for sanitizado/validado no cadastro, um usuário pode registrar um nome como `<img src=x onerror=...>` e obter XSS armazenado quando esse nome for renderizado via `innerHTML` em qualquer tela. | XSS armazenado potencial. **Requer confirmação**: localizar a rotina de cadastro de usuário e verificar se há sanitização/validação de caracteres no campo nome antes de gravar no Supabase. |
| Médio | 186 ocorrências de `.innerHTML =` em `main.js` (114), `admin.js` (14), `whatsapp.js` (13), `curva_abc.js` (18), `relatorio.js` (9), `dashboard.js` (10), `curva_abc_processo.js` (6), `app.js` (2) | várias | Uso extensivo de `innerHTML` para renderizar conteúdo, incluindo mensagens de erro que ecoam `err.message`/`error.message` diretamente (ex.: `main.js:1551,1837,1847,5054,6020,6187,7133,7675`). Na maioria dos casos são strings fixas ou mensagens de erro do próprio sistema (baixo risco), mas o padrão geral deveria usar `textContent` sempre que o valor não é HTML controlado. | Risco baixo-médio disperso; o item de maior risco real é o `currentUserName` acima. Cada ocorrência precisa ser avaliada individualmente antes de trocar por `textContent` (posso quebrar formatação HTML intencional). |
| Baixo | `index.html` | 685-687, 689-691, 3086-3090 | 3 links `target="_blank"` sem `rel="noopener noreferrer"` (para o painel da Evolution API e para sindusconce.com.br). | Tabnabbing — a aba aberta tem acesso a `window.opener`. Correção simples e seguríssima (adicionar atributo `rel`), baixo risco de quebrar algo. |
| — | — | — | `eval()`, `new Function()` e `setTimeout`/`setInterval` com string **não foram encontrados** em nenhum arquivo JS do projeto. | Ponto positivo — sem essa classe de vulnerabilidade. |
| — | — | — | Nenhum ID duplicado encontrado em `index.html` via varredura de todos os atributos `id="..."`. | Ponto positivo. |

### BLOCO 3/4/5 — Bugs, código morto e desempenho (achados iniciais por amostragem)

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| Médio | `index.html` | 22 | `<script src=".../@supabase/supabase-js@2">` no `<head>` **sem** `defer`, enquanto todas as outras 9 libs do `<head>` usam `defer`. É o único script bloqueante do carregamento inicial da página. | Atraso perceptível no First Paint/overlay de login, especialmente em conexões lentas. Precisa confirmar se algum código depende de `supabase` estar pronto sincronamente antes do `DOMContentLoaded` (senão dá para adicionar `defer`). |
| Médio | `index.html` | 3885-3886 | `bootstrap.bundle.min.js` carregado sem `defer`/`async` no fim do body, antes dos 11 scripts locais — os scripts locais (`admin.js`, `main.js` etc.) usam `bootstrap.Modal` então dependem dessa ordem síncrona. Não é bug, mas trava o parsing nesse ponto. | Baixo impacto (já está no fim do body), mas é outra oportunidade de otimização condicionada a teste. |
| Estrutural | `index.html` | 4392-4406 | Os 11 `<script src>` locais estão aninhados dentro de vários `<div>`, com indentação muito profunda — sinal de inserção "no meio do meio" do HTML em vez de antes do `</body>`. Funciona porque o parser HTML realoca `<script>` para fora de elementos inline automaticamement em alguns casos, mas é frágil e difícil de manter. | **Requer confirmação** antes de mover — risco de efeito colateral em ordem de carregamento se algo depender da posição atual. |
| Baixo | `index.html` | global | Apenas 1 `<img>` na página inteira e nenhum `loading="lazy"`. | Impacto real baixo (poucas imagens no HTML — a maioria do visual vem de CSS/background), mas fácil de aplicar no único caso encontrado. |
| A confirmar | vários | — | 9 listeners de `DOMContentLoaded` espalhados entre `admin.js` (2), `main.js` (6), `whatsapp.js` (1). Pode ser intencional (um por módulo), mas precisa checar se não há inicialização duplicada de UI/listeners quando múltiplos handlers tocam o mesmo elemento. | Pendente de revisão linha a linha — não avaliado em profundidade nesta sessão. |
| Pendente | `main.js`, `curva_abc.js`, `dashboard.js`, `relatorio.js` | — | Ainda não foram revisados linha a linha para: funções/variáveis não usadas, blocos comentados obsoletos, `console.log` remanescente (existem ocorrências mas não classifiquei quais são debug esquecido vs. logging intencional), CSS órfão em `style.css` (3.949 linhas), debounce/throttle em buscas e inputs. | Fica para a próxima sessão/bloco, listado em PROGRESSO acima. |

### BLOCO PROFUNDO — admin.js, whatsapp.js, relatorio.js, dashboard.js (revisão linha a linha)

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| **Crítico** | `admin.js:711-723,752` **e duplicado em** `main.js:4738-4768` | — | Função `promoteAdmin99030487()` promove automaticamente a admin o usuário com e-mail hardcoded `99030487@gecope.app`, disparada via `setTimeout(promoteAdmin99030487, 500)` dentro de `DOMContentLoaded` — **roda sozinha em toda carga de página**, sem senha nem confirmação, fazendo `UPDATE` direto na tabela `app_users` do Supabase. Está **duplicada palavra-por-palavra em `admin.js` e `main.js`**, então dispara duas vezes por carregamento. | Backdoor de escalação de privilégio embutido no código público: qualquer pessoa que descubra/registre essa matrícula (`99030487`) vira admin automaticamente. A proteção real depende 100% de RLS no Supabase (não auditado). **Este é o achado mais grave da auditoria até agora — mais grave que a senha mestra hardcoded, porque não exige nem digitar senha nenhuma.** |
| **Alto** | `admin.js:166-224,253-277` | — | `tr.innerHTML` monta linhas da tabela de usuários interpolando `u.email`, `u.matricula`, `nomeComp`, `u.telefone_whatsapp` sem escaping, inclusive **dentro de atributos** `onclick="aprovarUsuario('${u.email}', ...)"` (linha 182) e `excluirUsuario('${u.email}')` (linhas 185, 270). Esses valores vêm do autocadastro (controlável por qualquer usuário). | E-mail/nome com aspas simples quebra o atributo `onclick` e injeta JS arbitrário — executado no navegador do **administrador** ao abrir a lista de usuários pendentes. XSS armazenado com escalonamento de privilégio via painel admin. |
| **Alto** | `relatorio.js:213-316` (uso em 63,112,124,181,189,237) | — | `container.innerHTML` interpola `descricao`, `item.descricao`, `item.origem`, `f.nome` (fornecedor) e `r.descInsumo` — dados de composições gravadas por qualquer usuário autenticado — sem `escapeHTML`. | XSS armazenado disparado sempre que alguém abre/imprime o relatório dessa composição, atingindo qualquer usuário incluindo admins. |
| **Alto** | `whatsapp.js:206-208` | — | `data-name="${u.name}" data-email="${u.email}"` sem escaping, mesmo campo do autocadastro. | Mesmo vetor de XSS, na tela de disparo manual de WhatsApp. |
| **Alto** | `dashboard.js:1-261` vs `262-690` | — | Duas IIFEs completas definindo as **mesmas funções** (`getSelectedValues`, `renderMultiSelectUI`, `fillSelect`, `populateFinanceiroFilters`, etc.) em `window.*`; a segunda sobrescreve a primeira. **As linhas 1-261 (~38% do arquivo) são código morto** que ainda executa `getElementById` e monta objetos à toa em toda carga de página. | Risco de manutenção (alguém edita a cópia morta achando que corrigiu o bug) + peso desnecessário. |
| Médio | `admin.js:371-376` | — | No `catch` de `salvarEdicaoUsuario`, um `querySelector` é refeito sem checar null antes de `.innerHTML =`; se falhar, gera exceção **dentro do próprio catch**. | Falha não tratada em cascata. |
| Médio | `relatorio.js:21-25` | — | `window.open('', '_blank')` sem checar se o retorno é `null` (bloqueio de pop-up do navegador); função sem try/catch. | Impressão de relatório quebra silenciosamente quando o navegador bloqueia pop-up, sem feedback ao usuário. |
| Médio | `dashboard.js:495-514,642-660` | — | `renderKPIsFinanceiro` faz 9 `getElementById` sem null-check (diferente de `renderContadorFinanceiro`, que checa), dentro de `updateFinanceiro()` sem try/catch. | Se um único id de KPI mudar/faltar no HTML, todo o `updateFinanceiro()` para no meio, sem log de erro. |
| Médio | `whatsapp.js:1-23` | — | `notificarAtualizacaoTabelas` lê 3 elementos do DOM sem checar null, função `async` sem try/catch. | Promise rejeitada sem handler (falha silenciosa). |
| Médio | `admin.js:711-723` vs `main.js:4738-4768` | — | (mesmo achado do backdoor acima, listado aqui pela ótica de duplicação) — mesma query/gravação Supabase disparada 2x por carga de página. | Efeito colateral duplicado, além do risco de segurança já descrito. |
| Baixo | `admin.js:744-745` | — | `window.diagnosePendingFetch = diagnosePendingFetch;` atribuído duas vezes seguidas. | Código morto/resíduo de edição. |
| Baixo | `admin.js:281` | — | Mensagem de erro usa `colspan="5"` mas a tabela tem 7 colunas. | Desalinhamento visual da mensagem de erro. |
| Baixo | `whatsapp.js:440,522-530` | — | `lastNotificationCache` (Map de deduplicação) nunca é limpo/podado. | Vazamento de memória lento durante a sessão. |
| Baixo | `whatsapp.js` (fetches ~479,757,783,903,933,968) | — | Chamadas à Evolution API sem timeout/`AbortController`. | Spinner/texto "Consultando..." pode ficar pendurado indefinidamente se a API travar. |
| Baixo | `whatsapp.js` (arquivo inteiro) | — | Não encapsulado em IIFE (diferente de `admin.js`/`dashboard.js`); funções e variáveis no escopo global. | Risco de colisão de nomes com outros scripts. |
| Baixo | `dashboard.js:340-346` | — | Filtro de busca do multiselect roda sem debounce a cada tecla. | Escala mal se as listas crescerem (impacto baixo hoje). |
| Baixo | `relatorio.js:46-317` vs `319-531` | — | Lógica de agrupamento/BDI/desconto/preço final reimplementada de forma independente na renderização HTML e na exportação DOCX. | Risco de divergência futura entre o que a tela mostra e o que sai no DOCX quando uma regra de negócio mudar. |

**Resumo do bloco:** o achado mais grave desta rodada é o **backdoor de auto-promoção a admin** (`promoteAdmin99030487`), que roda sozinho a cada carregamento de página e está duplicado em dois arquivos. Em seguida, os quatro arquivos compartilham um padrão recorrente de `innerHTML` sem sanitização para dados de autocadastro/composições — só `dashboard.js` usa `escapeHTML` de forma consistente, e mesmo assim tem ~38% de código morto por duplicação de IIFE.

### BLOCO PROFUNDO — curva_abc.js, curva_abc_processo.js, utils.js, database.js, app.js (revisão linha a linha)

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| **Alto** | `curva_abc.js:1019,544` e `curva_abc_processo.js:159` | — | Campo `comentario` (rich-text de um editor `contentEditable`) é injetado via `innerHTML`/`document.write` **sem sanitização**, diferente de `conta`/`desc`/`descricao` que sempre passam por `esc()`. Em `curva_abc_processo.js:159` é ainda pior: abre em `window.open('_blank')` + `document.write` — janela de mesma origem, com acesso a `window.opener`, `localStorage` e sessão. | XSS armazenado: qualquer HTML na coluna `comentario` de `curva_abc_itens` executa com privilégios totais para quem visualizar o item ou relatório. |
| Alto | `database.js:31-55` | — | `initSupabaseClient()` não dá nenhum feedback ao usuário se falhar (CDN bloqueado, ad-blocker etc.) — `sbClient` fica `null` para sempre, sem erro visível. | Toda chamada a `sbClient.from(...)` em `curva_abc.js`, `curva_abc_processo.js` e `main.js` lança `TypeError` silencioso; usuário só vê a tela travada sem explicação. |
| Médio | `database.js:55` | — | `window.addEventListener('load', initSupabaseClient)` chama a função sem try/catch (diferente da chamada síncrona da linha 54, que tem). | Exceção não tratada se `createClient()` falhar durante o evento `load`. |
| Médio | `curva_abc_processo.js:82` | — | `onclick="excluirVersaoCurvaAbc(' + v.id + ', ' + numero + ')"` insere `numero` (string zero-padded, ex. `"01"`) sem aspas no atributo — vira literal `01` (sintaxe octal legada no JS inline). Funciona hoje, mas frágil. | Quebraria com `SyntaxError` em modo estrito; deveria ir entre aspas como string. |
| Médio | `utils.js:182,184` | — | `quantile()` e `topN()` nunca são chamados em nenhum outro arquivo (confirmado por grep). `dashboard.js` tem cópia própria idêntica de `quantile` (linha 241). | Código morto duplicado — a versão de `utils.js` nunca é usada. |
| Baixo | `database.js:5-21` vs `main.js:462-478` | — | `cookieGuardStorage` (lógica de sessão via cookie) duplicado quase identicamente em `main.js`, que nunca chama `createClient` nem usa essa constante. | Código morto em `main.js`; risco de a cópia órfã ficar desatualizada se a lógica for corrigida só em `database.js`. |
| Baixo | `database.js:43-46` | — | `invokeFunction`, exposto em `window.invokeFunction`, sem nenhuma chamada em todo o repositório. | Código morto. |
| Baixo | `app.js:39-40` | — | `document.getElementById('btn-buscar-incc')` e `.innerHTML` usados sem checagem de null, **fora** do bloco try/catch (que só começa na linha 44). | `TypeError` não tratado se o botão não existir no DOM. |
| Baixo | `app.js:12-13` | — | Mesmo padrão: `getElementById('mercado-data-ini'/'mercado-data-fin').value` sem checagem de null. | Mesmo risco acima. |
| Baixo | `curva_abc.js:51` | — | `function erro(msg)` — a própria função central de exibição de erros do módulo — não checa se `#cv-err` existe. | Se o elemento faltar, mascara a mensagem de erro original atrás de outro `TypeError`. |
| Baixo | `curva_abc.js:926-965` (amostra) | — | Vários `$(id)`/`getElementById` sem checagem de null antes de `addEventListener` (a maioria tem `if (elemento)`, mas nem todos). | Alteração futura de um `id` no HTML pode interromper a IIFE inteira sem log claro. |
| Baixo | `curva_abc.js:955-960` | — | `#cv-qtdCustom` tem dois listeners (`change` e `input`) chamando `calcular()` — redundante. | Pode recalcular a curva duas vezes para a mesma interação. |
| Baixo | `app.js:100` | — | `console.log('[INCC] Valores normalizados e atribuídos:', ...)`. | Log de debug esquecido em produção. |
| Baixo | `curva_abc.js:134-143` | — | Loop aninhado O(colunas×linhas) em `processarAoa` para detectar colunas numéricas, a cada upload de planilha, sem cache. | Pode ficar perceptível em planilhas muito grandes (não crítico, roda 1x por upload). |
| Baixo | `app.js` (arquivo inteiro) | — | Todas as linhas com ~76 espaços de indentação — claramente extraído de um `<script>` inline e nunca reformatado. | Prejudica leitura/diffs/manutenção, sem impacto funcional. |
| — | `app.js:55-56` | — | Reutiliza a `SUPABASE_KEY` (anon key pública, já reportada) num `fetch` manual para Edge Function — mesmo padrão do resto do sistema, não é exposição nova. | Informativo, sem ação nova necessária. |
| — | — | — | Nenhum segredo novo hardcoded encontrado nestes 5 arquivos. Nenhuma duplicação de `<script src>`. | Ponto positivo. |

**Resumo do bloco:** os 5 arquivos são bem comentados e funcionalmente coerentes, mas o módulo Curva ABC é frágil a mudanças de HTML por falta de null-checks sistemáticos — inclusive na própria função `erro()`. O achado mais sério é o **XSS armazenado via campo `comentario`**, que quebra a política de escape usada no resto do código (`esc()`). `database.js` funciona no caminho feliz mas não sinaliza falha de inicialização do Supabase, o que pode gerar falhas silenciosas difíceis de diagnosticar em produção.

### BLOCO PROFUNDO — main.js (revisão linha a linha completa, 8.349 linhas)

| Sev. | Linha | Problema | Impacto |
|---|---|---|---|
| **Crítico** | 5397-5402, 5839-5844 | `chatContainer.innerHTML = comentarios.map(c => ...${c.autor}...${c.mensagem}...)` sem `escapeHTML()` nos modais "Adicionar Comentário" (orçamentos e composições). | XSS armazenado: qualquer usuário autenticado (inclusive papel `fiscal`) grava `<img src=x onerror=...>` no campo mensagem/autor e o payload executa no navegador de **qualquer usuário, inclusive admin**, que abrir o comentário — podendo ler `sessionStorage` (usado como mecanismo de auth) e agir como esse usuário. |
| **Crítico** | 5170-5220 (orçamentos), 6107-6123 (composições) | Os mesmos campos `c.autor`/`c.mensagem`/`c.resp_admin` são renderizados sem escape **na listagem em acordeão**, não só no modal — o payload dispara para qualquer usuário que apenas **abra a aba** Orçamentos/Composições, sem precisar clicar em nada. | Superfície de ataque bem maior que um XSS de modal isolado — dispara passivamente. |
| Alto | 5238, 5242-5243, 6142-6147 | `obra.nome_obra`, `obra.descricao`, `obra.subcategoria` (texto livre do formulário de cadastro, digitável por qualquer usuário) inseridos via `innerHTML` sem escape na listagem. | Mesmo vetor de XSS armazenado, ativado só por criar um item com nome malicioso. |
| Alto | 420-435 vs 5634-5636 | `abrirModalAtender` declarada duas vezes; por *hoisting* a segunda (delega para `abrirModalDecisao`) vence — a primeira é código morto inalcançável. | Manutenção futura na versão de cima não terá efeito nenhum, sem aviso do runtime. |
| Alto | 437-451 vs 5642-5644 | Mesmo problema para `abrirModalRecusar`. | Idem acima. |
| Alto | 5619-5621 vs 5915-5923 | `deletarComposicao` duplicada — a versão "boa" (reusa `deletarRegistroGenerico`, padroniza cursor/callback) nunca roda; quem executa é a versão solta com `confirm()` próprio. | Risco concreto de alguém corrigir um bug na função errada. |
| Médio | 3350-3391 | `.then()` sem `.catch()` em `getMetaDate` (update de `processos`). | Falha de rede não tratada: meta não é salva, histórico não é gravado, usuário acredita que salvou. |
| Médio | 2510-2513 | Mesmo padrão em `abrirModalChecklistAditivo`. | Modal "trava" sem mensagem de erro. |
| Médio | 6592-6730 (`executarBuscaItemComposicao`) | Função `async` sem `try/catch` (diferente da irmã `executarBuscaTabela`, linha 7073, que é protegida). | Falha de rede deixa spinner "Buscando..." preso indefinidamente, sem erro. |
| Médio | 7340-7341, 7500-7501, 7614, 7626, 7669, 8027, 8042, 8072 | Corrupção de acentuação em rótulos exibidos na tela **e em PDFs oficiais gerados pelo sistema** (jsPDF): "CDIGO", "VERSO", "SUPERINTENDNCIA DE OBRAS PBLICAS", "PREO TOTAL", "SERVIO". | Documentos oficiais impressos/baixados por fiscais e enviados a terceiros saem com erros de grafia visíveis. |
| Baixo | 290-295 vs 3098-3109 | Comentário do código diz que a aba Composições tem cache ("só carrega na primeira visita"), mas o listener `shown.bs.tab` não checa a flag `_composicoesCarregadas` — recarrega do banco toda vez que a aba é reaberta. | Comportamento diverge do que o próprio código documenta; consultas redundantes ao Supabase. |
| Baixo | 1715-1717, 5019, 5976, 6594, 7077 (padrão repetido) | `document.getElementById(id).value` encadeado sem checar null. | Funciona hoje (HTML estático), mas qualquer renomeação de `id` quebra com `TypeError` não tratado. |
| Baixo | 4724-4737 | 4 cabeçalhos de comentário empilhados sem código entre eles (funções removidas, comentários esquecidos); um tem `/* ----` aninhado indevidamente. | Código morto / resíduo de edição, confunde leitura. |
| Baixo | 5646-5652 | Mesmo bloco de comentário `/* LÓGICA DAS NOVAS ABAS... */` duplicado, um logo após o outro. | Resíduo de merge/reescrita. |
| Baixo | 4962-4964 | 3 cabeçalhos sucessivos para a mesma função ("CORRIGIDO VFINAL", "VERSÃO FINAL CORRIGIDA", "COM ORDENAÇÃO NUMÉRICA CORRIGIDA"). | Evidência de múltiplas reescritas sem limpar comentários antigos. |
| Baixo | 409-415 + ~30 ocorrências | `console.log`/`console.info` viram no-op quando `IS_PROD=true`, mas dezenas de `console.log('[DEBUG]...')` continuam no código, incluindo **dump de dados de sessão do usuário logado** (`sop_user`, `sop_role`) nas linhas 3145-3146 e no fluxo de login (4348-4399). | Inofensivo hoje (`IS_PROD=true` desativa), mas risco real se `IS_PROD` for revertido para depuração em produção sem revisar esses logs antes — vazaria dados de sessão no console. |
| Médio (perf) | 789, 851, 4046 | `document.querySelector('tr[data-numero="..."]')` (seletor de atributo, sem índice) executado **1x por processo dentro de `.map(async...)`**, em `atualizarTabelaSuite` (a cada refresh) e `varrerRiscoDiligenciaSegundoPlano` (a cada 5 min, para todos os processos "APROVADO"). | Varredura O(linhas×nós) repetida constantemente; poderia ser um `Map` montado 1x via `querySelectorAll`+`data-numero`. |
| Baixo (perf) | 3836 | `window.abrirModalMeta` (função `async`) é recriada a cada chamada de `updateReuniao()`, inclusive a cada tecla na busca (apesar do debounce de 300ms). | Churn de função desnecessário, sem motivo funcional. |
| Baixo (perf) | 3673-3680 | `<thead>` da tabela de processos reconstruído via `innerHTML` do zero em toda execução de `updateReuniao()`, mesmo quando só filtro/ordenação de linhas mudou. | Trabalho de DOM desnecessário repetido. |
| — | — | Funções como `fillSelect`, `updateFinanceiro`, `renderizarRelatorioSOP_HTML`, `verificarAdminSalvo` são usadas em `main.js` mas definidas em `dashboard.js`/`admin.js`/`relatorio.js` (carregados antes). Confirmado: **não é código órfão**, é acoplamento implícito via `window` global — frágil à ordem de carregamento dos `<script>`, mas funcional hoje. | Não alterar a ordem dos scripts em `index.html:4392-4406` sem revalidar todas essas dependências implícitas. |
| — | — | Nota positiva: debounce bem aplicado na maior parte das buscas (`mt.search`:4212, `orcamento-search`:5269, `comp-search`:6197, `busca-bdi`/`busca-desc`:4235-4236); listas grandes usam concatenação em string + 1 atribuição a `innerHTML`, não `+=` em loop. | Padrão correto, não requer correção. |

**Resumo do bloco:** `main.js` mostra sinais claros de várias rodadas de "correção rápida" sem limpeza — comentários de seção duplicados/órfãos, 3 funções redeclaradas onde a versão "boa" nunca executa por causa de hoisting, e corrupção de acentuação que vazou até para PDFs oficiais. Tratamento de erro é inconsistente: a maioria das funções assíncronas tem try/catch, mas fluxos críticos de escrita (meta, checklist, busca de item de composição) falham silenciosamente. **O risco mais sério é de segurança**: comentários de usuário e campos de texto livre são injetados via `innerHTML` sem sanitização em pelo menos 6 pontos das abas Orçamentos/Composições, visíveis a qualquer usuário que apenas abra a lista — combinado com a sessão fraca via `sessionStorage` já reportada, forma uma cadeia de XSS armazenado com potencial de comprometer sessões de administrador.

### BLOCO PROFUNDO — Scripts inline de `index.html` (revisão linha a linha completa)

**Achado prévio confirmado:** `index.html` tem apenas **2 blocos `<script>` inline** (sem `src=`) em toda a sua extensão — linhas **143-170** e **172-185**. Todos os demais 24 `<script>` do arquivo (linhas 22-32, 3885-3886, 4392-4406) são `<script src="...">`, sem código solto. Isso é bem menos do que o volume que se poderia esperar de um HTML de 4410 linhas, e finaliza a apuração pendente sobre "lógica de negócio solta no HTML" — praticamente não existe.

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| Médio | `index.html:148-157` vs `main.js:24-36` | — | A IIFE de "anti-flash de login" (`sessionStorage.getItem('sop_role')` → esconde `#landingOverlay`, remove `login-active`) duplica manualmente o branch `show=false` da função `toggleLanding()` de `main.js`. São duas implementações independentes da mesma regra — se `toggleLanding()` for corrigida/alterada (ex.: mudar o nome da role "guest", adicionar um terceiro estado), o trecho inline em `index.html` não é atualizado junto, pois nada os mantém sincronizados. | Risco de divergência silenciosa: um ajuste de regra de sessão feito só em `main.js` não se reflete no comportamento "antes do main.js carregar", podendo reintroduzir o próprio flash de login que o código foi escrito para evitar. |
| Baixo (informativo) | `index.html:151` | — | Condição `if (role && role !== 'guest')`. Em todo o restante do sistema (`main.js`), `sessionStorage.setItem('sop_role', ...)` só grava os valores reais de perfil (`admin`, `gerente`, `fiscal`, `externo`, `pending` — linha 4371, valor vindo de `profile.data.role`). A string literal `'guest'` **nunca é gravada** no `sessionStorage`; ela só aparece como fallback de leitura (`... || 'guest'`) em dezenas de outros pontos. Ou seja, essa checagem defensiva é, na prática, sempre `true` quando `role` existe — o `!== 'guest'` não filtra nada hoje. | Nenhum impacto funcional atual (código morto lógico, não código morto de execução). Vale só como nota para quem for mexer nessa condição futuramente, achando que ela cobre um caso real. |
| — (ponto positivo) | `index.html:143-185` (os 2 blocos) | — | Nenhum `innerHTML`/`document.write` com dado externo; ambos usam apenas `style.display`, `classList` e `src` de imagem. Ambos rodam dentro de IIFE (sem vazar variável/função global, logo sem colisão possível com `main.js`/`admin.js`/etc.). O bloco de sessão tem `try/catch` (silencioso, mas presente); o bloco de fade da imagem trata `onload` **e** `onerror` do `Image()`, então nunca fica "pendurado" sem callback. | Nenhuma correção necessária — os dois blocos são exemplos legítimos de "flash-of-unstyled-content prevention" que precisam mesmo rodar inline e de forma síncrona (antes do parser chegar em Bootstrap/Supabase/`main.js`, carregados ~4200 linhas depois). Movê-los para um `.js` externo com `defer` reintroduziria o flash que eles existem para evitar — **não recomendo mexer nisso**. |

**Resumo do bloco:** `index.html` não tem lógica de negócio relevante solta em `<script>` inline — os únicos dois blocos existentes são micro-scripts de UX (anti-flash de tema e de login) corretamente justificados por comentário e corretamente isolados em IIFE, sem `innerHTML`/`document.write` e com tratamento de erro adequado ao que fazem. O único ponto real de atenção é a **duplicação de regra** entre a IIFE de `index.html:148-157` e `toggleLanding()` em `main.js`, que é um risco de manutenção (drift), não uma vulnerabilidade. Não há colisão de nomes com `main.js`/`admin.js`/etc., nem código comentado/morto dentro dos blocos.

### BLOCO PROFUNDO — Validação de formulários em `index.html`

`index.html` tem **23 `<form>`**. Confirmação central: **o atributo `pattern=` não é usado nenhuma vez em todo o arquivo** (0 ocorrências) — a única validação client-side existente é `required`, `type="email"` (só em 2 campos: `reg-email` e `edit-user-email`), `type="tel"` (sem validação real de formato) e `maxlength` (só em 3 campos, nenhum deles em nome/matrícula). **Não existe `minlength=` em nenhum lugar** (nem no campo de senha de cadastro).

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| **Alto (confirmação do achado pendente)** | `index.html:104-110` (`reg-nome`, `reg-sobrenome`, `reg-matricula`) + `main.js:4249-4324` (`signUpRequest`) | — | **Confirmado, não refutado**: a rotina de "Primeiro acesso" não faz **nenhuma** sanitização de caracteres. `reg-nome`/`reg-sobrenome`/`reg-matricula` só passam por `.trim()` (`main.js:272-275`) antes de `sbClient.auth.signUp()` e `INSERT`/`UPDATE` em `app_users` (linhas 4282-4310). Não há regex, não há `maxlength` no HTML para esses 3 campos, e nenhuma função tipo `escapeHTML`/`sanitize` é chamada no caminho. O valor vira `sop_user_name` (linha 4384) e alimenta diretamente os pontos de XSS armazenado já catalogados em `main.js:5390/5831`. | Fecha o "requer confirmação" da seção 5 do relatório: a cadeia completa é **cadastro sem sanitização → `sessionStorage.sop_user_name` → `innerHTML` sem escape** em pelo menos 4 telas (Orçamentos, Composições — já reportadas — mais as duas novas abaixo). |
| **Alto (novo)** | `main.js:1316-1332` (`carregarAtividades`, alvo `#full-activities-list`) e `main.js:1365-1387` (`carregarAtividadesResumoHome`, alvo `#home-activities-list`, painel "Atividades Realizadas" da Home) | — | Instância **nova**, não coberta no bloco profundo de `main.js`: `at.usuario` e `at.descricao` (gravados por `registrarAtividade()`, linha 1252-1271, com `usuario: sessionStorage.getItem('sop_user_name')`) são interpolados via `innerHTML` **sem nenhum escape**, tanto na aba "Últimas Atividades" quanto no card de atividades recentes da Home — a mesma raiz do achado acima (nome não sanitizado no cadastro), mas em uma superfície de tela diferente das já reportadas. | XSS armazenado disparado só de abrir a Home ou a aba Atividades — não exige abrir nenhum modal/registro específico, então tem alcance ainda maior que os pontos já catalogados. |
| **Alto (novo, classe diferente: injeção de filtro, não XSS)** | `main.js:1303` e `main.js:1354` | — | `query.or(\`tipo.neq.PROCESSO,fiscal.eq.${userName}\`)`, onde `userName = sessionStorage.getItem('sop_user_name')` — o mesmo campo "nome" sem sanitização do cadastro é interpolado **sem escape** dentro da sintaxe de filtro do PostgREST (`.or()` usa vírgula como separador de condições e parênteses para agrupar). Um nome de cadastro contendo vírgula/parêntese pode alterar a lógica do filtro. Essa `.or()` é exatamente o mecanismo que restringe usuários com perfil `fiscal` a só verem atividades das próprias obras. | Um usuário `fiscal` (perfil não-admin) pode conseguir, só escolhendo um nome malicioso no cadastro, neutralizar a cláusula de restrição e enxergar atividades de outros fiscais/processos que não deveriam ser visíveis a ele — potencial **bypass do controle de acesso por perfil** implementado no cliente (client-side só, sem confirmação de RLS equivalente no servidor). Diferente das 3 chamadas semelhantes em `main.js:6613,6655,7117` (que interpolam `termo` de busca digitado na hora, sem ligação com controle de acesso — impacto bem menor). |
| Médio | `main.js:5409-5415` (`enviarComentarioOrcamento`) e `main.js:5852` região equivalente (`enviarComentarioComposicao`) | — | A única validação antes de gravar o comentário no Supabase é `if (!autor || !msg) { alert(...); return; }` — checagem de "não vazio", zero checagem de conteúdo. `autor` vem do `<select id="coment-fiscal">`, que é populado (linha 5387, já reportada) incluindo uma `<option>` com `currentUserName` cru. O textarea `MENSAGEM` (`index.html:2291-2293`, `4097-4099`) só tem `required` no HTML, sem `pattern`/`maxlength`/checagem de tags. | Reforça e localiza com precisão o achado já registrado de XSS via comentário: a única barreira entre o textarea livre e o `innerHTML` do histórico de comentários é "campo não pode estar vazio". |
| Baixo (positivo, contraste) | `index.html:116-117` (`reg-telefone`) + `main.js:278` | — | Diferente de nome/matrícula, o campo telefone **é** sanitizado: `telefone = elTel.value.replace(/\D/g, '')` remove tudo que não é dígito antes de gravar. `maxlength="15"` no HTML reforça o limite de tamanho. | Ponto positivo isolado — mostra que o padrão de sanitizar existe no código-base, só não foi aplicado aos campos de texto livre (nome/sobrenome/matrícula/mensagem). |
| Baixo (positivo, contraste) | `index.html:3673-3872` (`formCadastro`, Novo Processo) + `main.js:1714-1783` (`enviarParaPlanilha`) | — | Este é o único formulário do arquivo com validação robusta e redundante: `form.checkValidity()` + `reportValidity()`, depois uma segunda checagem manual de 8 campos obrigatórios, **regex rígida** `^\d{5}\.\d{6}\/\d{4}-\d{2}$` para o número do processo, checagem de duplicidade local (`window.allData`) e checagem de duplicidade no servidor antes de salvar. | Nenhuma ação necessária — é o exemplo a ser seguido nos demais formulários (comentários, cadastro de usuário) que hoje só têm `required`. |
| Baixo | `index.html:113` (`reg-senha`) | — | Sem `minlength=` no HTML e sem checagem de força de senha em `main.js` antes de `sbClient.auth.signUp()` — a única validação de senha é a que o Supabase Auth aplicar no servidor (padrão mínimo de 6 caracteres, não confirmável por leitura de arquivo). | Senhas fracas (`123456`) passam sem aviso ao usuário na hora do cadastro; não é possível avaliar a política real sem acesso ao painel Supabase (mesma ressalva já feita para RLS). |
| Baixo | `index.html:111`, `257` (`reg-email`, `edit-user-email`) | — | `type="email"` é a única validação de formato de e-mail em todo o sistema, e só nesses 2 campos — não há revalidação em JS (`main.js` só faz `.trim().toLowerCase()`, linha 4254/4330, sem checagem de formato). A validação HTML5 de e-mail é client-side e pode ser removida/burlada via DevTools sem que nenhuma camada JS pegue o erro antes do `INSERT`. | Baixo risco isolado (o Supabase Auth também valida formato de e-mail no `signUp`), mas reforça o padrão geral: quase toda validação do sistema é só "existe no HTML", sem espelho em JS nem confirmação server-side visível pelo repositório. |

**Resumo do bloco:** a rotina de cadastro ("Primeiro acesso") **não sanitiza nome, sobrenome nem matrícula** — confirma, com localização exata (`main.js:4249-4324`, campos `index.html:104-110`), o achado que estava pendente de confirmação na seção "REQUER CONFIRMAÇÃO" do relatório. Além de confirmar a cadeia de XSS já suspeitada, a investigação encontrou **duas superfícies novas** do mesmo problema: o painel de Atividades (Home e aba dedicada, `main.js:1316-1387`) renderiza o mesmo nome não sanitizado via `innerHTML`; e, mais grave por ser uma classe diferente de falha, **o mesmo campo "nome" é interpolado sem escape dentro de uma cláusula `.or()` do PostgREST** que implementa a restrição de visibilidade por perfil `fiscal` (`main.js:1303,1354`) — um vetor de bypass de controle de acesso, não apenas de XSS. Em contraste, telefone (regex de dígitos) e o cadastro de Processo (`formCadastro`) mostram que o time sabe validar bem quando quer — só não aplicou o mesmo cuidado aos campos de nome/comentário.

### BLOCO PROFUNDO — CSS órfão em `style.css`

Metodologia: extraídos **338 seletores de classe** e **101 candidatos a seletor de id** de `style.css` (os candidatos a id incluíam muitos falsos-positivos — cores hex como `#CED4DA` capturadas pela regex; filtrados para os **15 ids reais** usados como seletor CSS). Cada seletor de classe restante foi conferido por busca de substring no conteúdo concatenado de `index.html` + `cronograma.html` + todos os 11 `.js` do diretório raiz (cobrindo `class="..."`, `classList.*`, `getElementById`, `querySelector*`, e concatenação de template string).

**IDs:** todos os 15 ids reais definidos em `style.css` (`app-content`, `btn-send-direct-msg`, `cv-coment-fontsize`, `direct-msg-recipients`, `direct-msg-text`, `meetingFiscalSelect`, `meetingMetaSelect`, `meetingPrioritarioSelect`, `meetingSearch`, `meetingStatusSelect`, `modal-report-body`, `modalCvRelatorioComentarios`, `modalDetalheComposicao`, `pane-home`) estão em uso — **nenhum id órfão encontrado**.

**Classes:** 39 candidatas ficaram com zero ocorrência fora de `style.css`. Agrupadas por família/causa provável:

| Sev. | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| Baixo | `style.css:3018,3026,3037,3045,3049,3162` (`.history-container`, `.history-item`, `.history-header`, `.history-msg`, `.history-link`, `.history-card-msg`) | — | Família completa de classes de um card de "histórico" antigo, sem nenhuma referência. O HTML/JS atual usa uma **outra** família com nomes parecidos mas diferentes: `.history-card-item`, `.history-card-header`, `.history-card-body`, `.history-collapse-box`, `.btn-history-anexo` (`main.js:5197-5225`, também definidas em `style.css:3125-3239`) — confirma que é uma renomeação de UI cujo CSS antigo não foi removido, e não uma classe gerada dinamicamente. | Peso morto no CSS (~6 regras completas); risco de alguém editar a versão errada achando que está ajustando o card de histórico real. |
| Baixo | `style.css:185,195,204,1580,221` (`.admin-stat-icon-wrapper`, `.admin-stat-label`, `.admin-stat-value`, `.admin-section-title`, `.admin-accordion-header`) | — | Resquício de uma versão anterior do painel de Administração. O HTML atual usa `.proc-kpi-card/.proc-kpi-icon/.proc-kpi-label/.proc-kpi-value` (`index.html:511-541`) para os cartões-indicador e `.admin-section-header` (não `.admin-accordion-header`) para os cabeçalhos de seção (`index.html:580,646`). | Mesma classe de risco acima — CSS de uma versão anterior do painel Admin nunca removido. |
| Baixo | `style.css:3110` (`body:not(.is-admin) .admin-tab`) | — | Regra referencia uma classe `.admin-tab` que não existe em nenhum elemento do HTML. O mecanismo real de ocultar abas restritas a admin usa o atributo `data-roles="admin"` nos `<li>` de `#dashboardTabs` (`index.html:364-367`), filtrado via JS — e, além disso, `#dashboardTabs` já está permanentemente oculto com a classe `d-none` (comentário na linha 348: "NAVEGAÇÃO REMOVIDA — Substituída por Tiles"). Regra duplamente morta. | Nenhum impacto visual (a regra nunca encontra alvo), mas confunde quem for ler o CSS achando que existe um controle de visibilidade por classe que na verdade não é usado. |
| Baixo | `style.css:269,274,279,284,289` (`.icon-bg-blue/green/orange/red/slate`) | — | Outra família de cores de ícone sem uso — o HTML aplica cor via classes mais curtas `bg-green`/`bg-blue`/`bg-orange`/`bg-slate`/`bg-purple`/`bg-teal` diretamente (ex.: `index.html:390,400,409,446,459,466`). | CSS morto por rename; sem risco funcional. |
| Baixo | `style.css:238,244,250,256,262` (`.header-soft-blue/dark/green/orange/red`) | — | Variante alternativa de skin para cabeçalho de modal, nunca aplicada — os cabeçalhos de modal usam classes Bootstrap diretas (`bg-primary text-white`, `bg-dark text-white`, `bg-success text-white`, `bg-danger text-white`, `bg-warning-subtle`, conforme visto em praticamente todos os modais de `index.html`). | CSS morto, provável protótipo de skin que não foi adotado. |
| Baixo | `style.css:317,329,335,973,982,1005,1014,1024` (`.search-container-wrapper`, `.search-icon-wrapper`, `.search-input-clean`, `.search-input-hero`, `.search-pill-group`, `.search-pill-group-hero`) | — | Outra família de busca sem uso — os campos de busca reais usam `.proc-search-wrap`/`.proc-search-icon` (ex.: `index.html:599,604,1867,1871,1962`). | CSS morto por rename; ~6 regras (algumas com `:focus-within` e overrides `body.theme-dark`) nunca aplicadas. |
| Baixo | `style.css:1647` (`.btn-novo-orcamento`), `1619` (`.config-card-footer`), `179` (`.h-150`), `131` (`.icon-chat`), `680` (`.bg-indigo`) | — | Classes isoladas sem uso: botão "Novo Orçamento" usa classes Bootstrap genéricas no HTML atual, não essa classe dedicada; `.icon-chat` é órfã mesmo estando ao lado de `.icon-cloud`/`.icon-trash` (essas duas, em uso); `.bg-indigo` seria uma variante de cor de tile de módulo (`home-action-icon.bg-indigo`) não usada em nenhum dos tiles atuais (que usam green/blue/slate/purple/teal/orange). | Peso morto pontual, sem risco funcional. |
| Baixo (informativo) | `style.css:3639-3712` (`body.theme-dark .dropdown-item`, `.btn-outline-dark`, `.btn-white`) | — | Diferente dos demais: `dropdown-item`, `btn-outline-dark` e `btn-white` são classes **do próprio Bootstrap**, mas nenhum elemento do HTML atual usa essas 3 classes (nenhum dropdown Bootstrap nem botão com essas variantes existe hoje em `index.html`/`cronograma.html`). O override de tema escuro para elas é, portanto, código morto **hoje** — mas diferente das demais famílias acima, não é exatamente "renomeação": é preparação para um componente Bootstrap que não chegou a ser usado. | Nenhum impacto atual; só vale a pena remover se confirmado que não há plano de usar dropdown/esses botões futuramente. |
| Baixo | `style.css:60` (`.badge-status-revisao`), `2335` (`.badge-status-light-green`) | — | O gerador de classes de badge de status (`getGpStatusClass()`, `main.js:2209-2224`, e sua cópia em `main.js:3760-3772`) produz apenas as 10 classes listadas em `GP_STATUS_BADGE_CLASSES` (linha 2209-2211) — `badge-status-revisao` e `badge-status-light-green` não fazem parte desse conjunto e não são geradas em nenhum outro ponto do código. | CSS morto — variantes de badge que talvez tenham existido para um status já removido/renomeado. |
| — (não é órfão — falso positivo, atenção) | `style.css:3276-3287` (`.swal2-html-container`, `.swal2-html-container table/th`) | — | Não conta como órfão: `swal2-html-container` é uma classe **gerada dinamicamente pela própria biblioteca SweetAlert2** dentro do DOM que ela injeta em tempo de execução (`Swal.fire({html: ...})`), nunca aparecendo como string literal em `index.html`/`.js` — exatamente o caso de "classe gerada externamente" mencionado como cuidado a tomar. Está corretamente em uso sempre que um `Swal.fire` com HTML/tabela é exibido. | Nenhuma ação — mantido fora da lista de achados por ser confirmadamente em uso. |

**Resumo do bloco:** `style.css` tem **39 classes órfãs confirmadas** (de 338 analisadas, ~11,5%) e **zero ids órfãos**. O padrão dominante não é "CSS nunca usado", mas **resíduo de pelo menos 3 redesigns sucessivos** que renomearam classes sem remover a versão anterior: histórico de comentários (`history-*` → `history-card-*`), indicadores do painel Admin (`admin-stat-*` → `proc-kpi-*`), e campo de busca (`search-*` → `proc-search-*`) — em cada um desses três casos, a classe antiga e a nova coexistem em `style.css`, mas só a nova está em uso real. Um caso (`swal2-html-container`) foi investigado e descartado por ser gerado dinamicamente por biblioteca externa, não por template JS interno — nenhuma classe da própria aplicação (construída via template string em `main.js`/`admin.js`/etc.) escapou da varredura por esse motivo.

### BLOCO 6 — Compatibilidade

Não auditável apenas por leitura de código — depende de teste manual em Chrome, Edge, Firefox e viewport mobile. Ver checklist de testes ao final.

---

## 4. PLANO DE CORREÇÃO

**Status: itens 3, 4, 5, 8 e 9 aplicados nesta rodada (aprovação do usuário em 2026-07-26). Itens 1 e 2 seguem fora de escopo. Itens 6 e 7 foram avaliados e propositalmente NÃO aplicados — ver justificativa em cada um.**

1. **[Crítico, fora de escopo] Chave da Evolution API exposta** (`config.js:7`, uso em `whatsapp.js`) — a correção real (rotear todas as chamadas pelo `evo-proxy/` já existente, removendo `EVO_API_KEY` do front-end) **está fora do escopo desta revisão** (é mudança de arquitetura/backend). Não aplicado.
2. **[Crítico, fora de escopo] Bypass de admin via sessionStorage** (`admin.js`) — a correção definitiva exige validação server-side (RLS/Supabase policies), fora do escopo de arquivos elegíveis. Não aplicado.
3. **[Aplicado ✅] XSS armazenado via nome de usuário** — duas camadas aplicadas: (a) `signUpRequest()` em `main.js` agora sanitiza nome/sobrenome (allowlist de letras/espaço/hífen/apóstrofo) e matrícula (alfanumérico), rejeitando o cadastro se o resultado ficar vazio; (b) todos os pontos de exibição de nome/comentário/descrição identificados (`main.js`: modal e listagem em acordeão de comentários de Orçamentos e Composições, painel de Atividades da Home e aba dedicada, `nome_obra`/`descricao`/`subcategoria`/`autorV1`) agora passam por `escapeHTML()` antes do `innerHTML`. Links de anexo (`c.arquivo`) gerados nesses mesmos pontos também ganharam `rel="noopener noreferrer"`. `index.html`: `maxlength` adicionado em `reg-nome`/`reg-sobrenome` (60) e `reg-matricula` (20).
4. **[Aplicado ✅] Bypass de controle de acesso via `.or()` do PostgREST** (`main.js`, funções `carregarAtividades`/`carregarAtividadesResumoHome`) — o nome do usuário agora tem vírgula e parênteses removidos (`safeUserName`) antes de entrar na cláusula `.or()`, eliminando a possibilidade de forjar uma condição extra no filtro por perfil `fiscal`. Aplicado independente de RLS, por decisão do usuário.
5. **[Aplicado ✅] `rel="noopener noreferrer"`** adicionado nos 3 links `target="_blank"` de `index.html` (painel Evolution API ×2, sindusconce).
6. **[Avaliado e NÃO aplicado] `loading="lazy"` na única `<img>`** — a imagem (`brasao.png`, `index.html:47`) é o logo da tela de login/landing, visível imediatamente no primeiro carregamento para qualquer visitante não autenticado (above-the-fold). Aplicar `loading="lazy"` a uma imagem visível de início é contraindicado (atrasaria o próprio carregamento que o usuário vê primeiro) e é sinalizado como anti-padrão por ferramentas como Lighthouse. Mantido sem o atributo.
7. **[Avaliado e NÃO aplicado] `defer` no script do Supabase** (`index.html:22`) — confirmado que **não é seguro**: os 11 `<script src>` locais no fim do `<body>` (`config.js` … `main.js`, linhas 4392-4406) não têm `defer`/`async`, logo executam de forma síncrona assim que o parser HTML os alcança — **antes** de qualquer script com `defer` do `<head>` rodar (scripts deferidos só executam depois que o parsing do documento termina). `database.js` chama `sbClient = supabase.createClient(...)` nesse trecho síncrono, dependendo de `window.supabase` já existir. Adicionar `defer` ao CDN do Supabase adiaria sua execução para depois de `database.js`, quebrando `initSupabaseClient()` (ficaria `sbClient = null` permanentemente). Mantido sem `defer`.
8. **[Aplicado ✅] Remoção de CSS órfão em `style.css`** — as 39 classes/seletores confirmados sem nenhuma referência foram removidos: família `history-*` antiga (6 seletores), `admin-stat-*`/`admin-accordion-header`/`admin-section-title` (9), `body:not(.is-admin) .admin-tab` (1), `icon-bg-*` (5), `header-soft-*` (5), família `search-*`/`search-*-hero` (8, incluindo overrides de tema escuro), `btn-novo-orcamento`, `config-card-footer`, `.h-150`, `.icon-chat`, `.bg-indigo` (isolados, 5), `badge-status-revisao`, `badge-status-light-green` (2), `dropdown-item`/`btn-outline-dark`/`btn-white` (3, removidos das regras de tema escuro, preservando `.btn-light`/`.btn-outline-secondary` que continuam em uso). Balanceamento de chaves `{}` do arquivo verificado após a remoção (542/542).
9. **[Aplicado ✅] Padronizar validação de formulários** — coberto pelo item 3 (sanitização de entrada + `maxlength`).

**Validação técnica realizada:** `node --check main.js` sem erros de sintaxe; `style.css` com chaves balanceadas; `index.html` servido localmente (HTTP 200). **Não foi possível validar visualmente no navegador** (login real, geração de PDF/Excel, layout) nesta sessão — recomenda-se rodar o checklist da seção 6 antes de mergear.

## 5. REQUER CONFIRMAÇÃO (atualizado após o bloco de scripts inline/formulários/CSS)

- Policies de Row Level Security no painel do Supabase — preciso saber se existem e são restritivas, para dimensionar corretamente a severidade real do bypass de admin, da exposição da anon key **e agora também do bypass via `.or()` (item 4 do plano)**.
- ~~Rotina de cadastro de usuário ("Primeiro acesso") — se já existe alguma sanitização de nome~~ → **Confirmado nesta rodada: não existe nenhuma sanitização.** Ver item 3 do plano de correção para as opções de correção propostas.
- Reorganização dos 11 `<script src>` locais (`index.html:4392-4406`) para o fim do `<body>` de forma mais limpa — não vou mexer sem sua aprovação, já que hoje "funciona".
- Se a chave da Evolution API e o bypass de admin devem ser tratados nesta revisão (mesmo estando a correção completa fora do escopo estrito de `index.html`) ou registrados apenas como achados para outro time/tarefa.
- Todas as 186 ocorrências de `innerHTML` — vou precisar revisar uma a uma antes de trocar qualquer uma por `textContent`, para não quebrar formatação HTML intencional (badges, ícones, links dentro de mensagens etc.).
- Remoção das 39 classes CSS órfãs listadas no bloco de CSS órfão — qual escopo aprovar: remover todas, só as "isoladas" de baixo risco, ou nenhuma nesta rodada.

## 6. CHECKLIST DE TESTES MANUAIS PÓS-ALTERAÇÃO

- [ ] Login (usuário comum e admin) em `index.html` e em `cronograma.html`
- [ ] Cadastro de novo usuário ("Primeiro acesso") e aprovação por admin
- [ ] Navegação `index.html` ↔ `cronograma.html` (incluindo querystring `?pane=pane-reuniao`)
- [ ] Envio de mensagem WhatsApp (se a correção da chave for aplicada)
- [ ] Geração de relatórios PDF/Excel/Word (jsPDF, html2pdf, xlsx, exceljs, docx, pdf-lib)
- [ ] Gráficos Plotly (curva ABC, dashboard)
- [ ] Abertura dos links corrigidos com `target="_blank"` (painel Evolution API, sindusconce) em nova aba
- [ ] Responsividade em viewport mobile (landing/login overlay, tabelas, modais)
- [ ] Chrome, Edge e Firefox — visual idêntico ao estado atual
- [ ] Console do navegador sem novos erros/warnings após cada alteração
- [ ] Regressão geral do fluxo principal (login → painel → abrir processo → editar → salvar)
- [ ] Comentário com formatação rica (negrito/itálico/tamanho) no item da Curva ABC — salvar, reabrir, gerar relatório de comentários (confirma que o DOMPurify não descartou a formatação)
- [ ] Painel Admin: aprovar/recusar usuário pendente, aprovar a partir de notificação, editar e excluir usuário ativo (confirma que os `data-*` no lugar de `onclick` com string continuam funcionando)
- [ ] Disparo manual de WhatsApp (seleção de destinatário no `<select>`) e verificação de status da instância (timeout de 15s não deve interromper operações normais)
- [ ] Aba Orçamentos/Composições: comentários (modal e listagem em acordeão), histórico e anexos
- [ ] Aba Reunião/Processos: busca, ordenação por coluna (seta no cabeçalho), abrir modal de Meta e histórico de metas

## 7. SEGUNDA RODADA DE CORREÇÕES (2026-07-26) — aplicada após aprovação explícita

Escopo aprovado pelo usuário: "Prossiga" para atacar os achados restantes da auditoria (além dos já aplicados na seção 4), com duas exceções decididas explicitamente:
- **Backdoor `promoteAdmin99030487`** (`admin.js`/`main.js`) — **mantido intencionalmente**, por ser o mecanismo de auto-promoção do próprio usuário administrador (confirmado via `raw_line.txt`, que referencia `C:\Users\99030487\...`). Não foi alterado.
- **Comentário rich-text da Curva ABC** — em vez de `escapeHTML()` (que quebraria a formatação), foi adicionado **DOMPurify** (CDN, `index.html`) com uma allowlist de tags de formatação (`b/i/u/font/span/div/p/br/ul/ol/li`, atributo `style`), via novo helper `sanitizeRichHTML()` em `utils.js`.

### Segurança (XSS / injeção)

| Arquivo | O que foi corrigido |
|---|---|
| `relatorio.js` | `escapeHTML()` em `descricao`, `item.origem`, `item.descricao`, `f.nome` (fornecedor) e `r.descInsumo`/`r.codInsumo` no relatório de composição (HTML impresso). |
| `whatsapp.js` | `escapeHTML()` em `data-name`, `data-email`, valor e texto da `<option>` de destinatário (disparo manual). |
| `admin.js` | Reescritos os 3 blocos de renderização da tabela de usuários (pendentes, notificações, ativos): todo texto exibido passa por `escapeHTML()`, e os `onclick="fn('${valor}')"` com strings interpoladas (vulneráveis a quebra de contexto JS via aspas) foram trocados por atributos `data-*` lidos via `this.dataset.*` — elimina a injeção de JS arbitrário no navegador do admin, não apenas o XSS de exibição. |
| `curva_abc.js` / `curva_abc_processo.js` | Campo `comentario` (rich-text) agora passa por `sanitizeRichHTML()` (DOMPurify) tanto ao salvar (`cvSalvarComentarioItem`) quanto ao exibir (editor e os 2 relatórios de comentários), mantendo negrito/itálico/tamanho/alinhamento. |
| `curva_abc_processo.js` | Corrigido bug de sintaxe: `numero` (string tipo `"01"`) interpolado sem aspas dentro de um `onclick` — virava um literal numérico inválido; agora vai entre aspas. |
| `main.js` | Filtro `.or()` do PostgREST (`carregarAtividades`/`carregarAtividadesResumoHome`) agora remove vírgula/parênteses do nome do usuário antes de interpolar — fecha o bypass de controle de acesso por perfil `fiscal` reportado na seção 4 (mesma raiz, chamadas adicionais confirmadas nesta rodada). |

### Código morto / duplicado

| Arquivo | O que foi corrigido |
|---|---|
| `main.js` | Removidas as declarações **mortas** de `abrirModalAtender`/`abrirModalRecusar` (a primeira versão, nunca executada por causa de hoisting) e da versão solta de `deletarComposicao` (mantida a versão que reusa `deletarRegistroGenerico`, padronizando cursor de carregamento). Removido bloco de comentário de seção duplicado. |
| `dashboard.js` | Removida a **IIFE inteira duplicada** (linhas 1–261 do arquivo original, ~38%) — todas as funções que definia (`getSelectedValues`, `fillSelect`, `populateFinanceiroFilters` etc.) já eram redefinidas pela segunda IIFE, que é a única que executava de fato. Também removidas, da IIFE sobrevivente, as funções `groupCount`/`groupAvg`/`topN`/`quantile`/`renderHBar` — confirmado por grep em todo o repositório que nunca são chamadas (resíduo de uma versão anterior do dashboard). Arquivo caiu de 690 para ~410 linhas. |
| `utils.js` | Removidas `quantile`/`topN` (idêntico caso de código morto nunca chamado). |
| `database.js` | Removido `invokeFunction` (exposto em `window`, sem nenhuma chamada no repositório). |

### Robustez

| Arquivo | O que foi corrigido |
|---|---|
| `database.js` | `initSupabaseClient()` agora tem `try/catch` também na chamada via `window.addEventListener('load', ...)` (antes só a chamada síncrona tinha). Adicionado um aviso (`alert` + `console.error`) se, 4s após o `load`, o cliente Supabase ainda não tiver sido criado — cobre o caso de CDN bloqueado (ad-blocker/rede), que antes travava a tela sem nenhuma explicação. |
| `whatsapp.js` | Novo helper `fetchComTimeout()` (15s, via `AbortController`) usado nas 6 chamadas `fetch` à Evolution API — antes uma API travada deixava o spinner "Consultando..." pendurado indefinidamente. `lastNotificationCache` (Map de deduplicação) agora poda entradas expiradas a cada novo registro, em vez de crescer sem limite durante a sessão. |

### Qualidade de dados / desempenho

| Arquivo | O que foi corrigido |
|---|---|
| `main.js` | Corrigida a corrupção de acentuação em rótulos exibidos na tela e em PDFs oficiais: "CÓDIGO", "VERSÃO", "SUPERINTENDÊNCIA DE OBRAS PÚBLICAS", "PREÇO TOTAL DA COMPOSIÇÃO" (nos 2 relatórios HTML e no PDF via jsPDF). **Não alterado**: as strings usadas como chave de classificação/ordenação (`'SERVIO'`, `'MAO DE OBRA'` em `ordemGrupos`/`grupoDisplay`, compartilhadas entre `main.js` e `relatorio.js`) — corrigir a acentuação aí exigiria sincronizar 3 pontos diferentes (e `relatorio.js` já usa uma grafia *ainda mais* truncada, `"MO DE OBRA"`, que hoje nem bate com `main.js`) e mudaria o comportamento de ordenação das seções do relatório; fica como achado separado, não corrigido nesta rodada. |
| `main.js` | Removidos os `console.log('[DEBUG]...')` que imprimiam `sessionStorage` (usuário, role, e-mail, nome) no console — no `DOMContentLoaded` principal e no fluxo de `signInWithEmail`/IIFE de sessão. (Já eram no-op em produção via `IS_PROD=true`, linha ~410 — esta é uma camada extra de proteção caso `IS_PROD` seja revertido para depuração sem revisar os logs antes.) |
| `main.js` | `atualizarTabelaSuite` e `varrerRiscoDiligenciaSegundoPlano` faziam um `document.querySelector('tr[data-numero=...]')` por processo, dentro de um `.map(async...)` — O(processos × linhas da tabela), repetido a cada refresh e a cada 5 min para todos os "APROVADO". Agora constroem um `Map` numero→`<tr>` com uma única varredura do DOM antes do loop. |
| `main.js` | `updateReuniao()` só reescreve o `<thead>` da tabela quando o HTML do cabeçalho muda de fato (ex.: seta de ordenação) — antes reconstruía via `innerHTML` em toda chamada (filtro, busca, refresh), mesmo sem nenhuma mudança real. |
| `main.js` | **Não alterado** (avaliado e descartado por baixo risco/benefício): `window.abrirModalMeta` continua sendo redefinida a cada chamada de `updateReuniao()` — é uma função grande (~200 linhas) aninhada dentro dela; extrair com segurança exigiria confirmar que nenhuma referência interna depende de variáveis locais de `updateReuniao()`, e o custo real de recriar uma closure em JS é desprezível (V8 não aloca de forma cara). Risco de extração > benefício de performance nesse caso. |

### Validação técnica desta rodada

`node --check` sem erros em todos os 10 arquivos `.js` alterados (`main.js`, `admin.js`, `relatorio.js`, `whatsapp.js`, `curva_abc.js`, `curva_abc_processo.js`, `utils.js`, `database.js`, `dashboard.js`, `app.js`); `style.css` com chaves balanceadas; varredura por caracteres Unicode suspeitos (combinação/acentuação corrompida) em todos os arquivos tocados — nenhuma introduzida por esta rodada. **Segue sem teste em navegador real** (ver checklist da seção 6, itens novos ao final).

## 8. TERCEIRA RODADA — Desempenho da coluna Suíte (2026-07-27)

Origem: usuário relatou lentidão ao "processar" na aba Reunião/Processos após rodar os primeiros testes manuais do roteiro da seção 6. Diagnóstico apontou para a integração com a Edge Function `consultar-suite` (coluna "Suíte", badge "Consultando..."), não para o filtro/renderização da tabela em si.

**Causa raiz:** `atualizarTabelaSuite()` (`main.js`) e `varrerRiscoDiligenciaSegundoPlano()` (`main.js`, varredura de 5 em 5 min para alertar pré-diligência) escalonavam cada consulta não cacheada com um atraso de `índice × 150ms` antes de disparar o `fetch`. Com N processos não cacheados na tela, o último só começava a consultar depois de `N × 150ms` — dezenas de segundos com muitos processos — e o cache (`window.suiteCache`) só existia em memória, sendo descartado a cada F5, então o atraso se repetia em todo recarregamento de página dentro da janela de 5 min de frescor.

**Corrigido (aprovado pelo usuário, opção "as duas"):**
- Novo helper `executarComPool(items, limite, tarefa)` (`main.js`, antes de `varrerRiscoDiligenciaSegundoPlano`) — worker pool com no máximo 6 chamadas simultâneas à `consultar-suite`, substituindo o escalonamento sequencial nas duas funções. Tempo total deixa de crescer linearmente com o número de processos.
- `window.suiteCache` agora é hidratado de `sessionStorage` (`sop_suite_cache`) na primeira carga do script e persistido (`persistSuiteCache()`) depois de cada rodada de consultas — sobrevive a F5 dentro da mesma aba/sessão, evitando reconsultar tudo do zero a cada recarregamento. A checagem de frescor de 5 min nos pontos de uso não mudou.

**Validação técnica:** `node --check main.js` sem erros. **Ainda não testado no navegador** — validar no roteiro de teste (ver Artifact "Roteiro de Teste — GECOPE"): abrir a aba Reunião/Processos com muitos processos visíveis, cronometrar o tempo até todos os badges da coluna Suíte saírem de "Consultando..."; dar F5 dentro de 5 min e confirmar que a segunda carga é sensivelmente mais rápida (usa o cache de sessionStorage); confirmar que os alertas de pré-diligência (aba Aprovados) continuam aparecendo corretamente.
