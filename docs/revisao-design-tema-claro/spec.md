# Revisão de design do tema claro — Diagnóstico e Spec

Status: **spec aguardando aprovação** (06/10/2026). Nenhum código foi alterado.
Origem: sessão de grilling com o usuário em 06/10/2026 (Q1–Q19, todas respondidas). Esta spec é a rubrica contra a qual os 4 revisores (Objetivo/Spec · Regressão · Design/UX · Performance) julgam cada bloco.

## 1. Objetivo

Deixar o tema claro **consistente entre os módulos, com hierarquia visual clara e legível em projeção**, sem trocar a identidade do sistema. Nível de ambição: **consolidar** (tokens únicos, um verde, cor com significado, hierarquia) — não redesenhar.

## 2. Decisões fechadas

| # | Decisão |
|---|---|
| Dor | (b) módulos inconsistentes, (c) falta de hierarquia, (f) uso em projeção em reunião |
| Escopo | Todas as telas; há usuários nos dois temas |
| Layout | **Muda nos dois temas** (regra AT-3 da Etapa A: "os dois temas iguais, só as cores mudam"). A **paleta** do escuro não muda |
| Marca | Sem imposição externa. Montserrat é preferência do usuário e fica. **Uma só família**: a Space Grotesk (só no Mapa, em números) sai |
| Margem lateral | 24px até 1200px de largura, 32px acima; largura máxima 2000px centralizada (era 1600px; em 1920px sobravam 160px de cada lado e a tela parecia vazia — ajustado em 07/10/2026 após feedback do usuário) |
| Cabeçalho de página | Sem título repetido (a barra superior já mostra o módulo). Uma linha: descrição à esquerda, ações à direita. O Início mantém o hero |
| Barra superior | Mantida, mais baixa, no verde da marca (não quase preto) |
| Caixa alta | Só siglas e selos curtos de status. Rótulos de filtro, títulos de cartão e cabeçalhos de tabela em sentença. Descrições vindas do banco não são alteradas, só alinhadas à esquerda (sem justificar) |
| Cor | Neutro por padrão; cor só quando significa algo (status, alerta, valor positivo/negativo). Saem as barras laterais coloridas dos KPIs e as 7 cores de ícone do Início |
| Legibilidade | Texto ≥ 12px (exceto selos de 1–3 caracteres) e contraste ≥ 4,5:1 (WCAG AA) |
| Botões | Um primário verde cheio por tela; secundários com contorno; "Limpar" discreto (texto/contorno cinza); sem azul Bootstrap; vermelho só para ação destrutiva. Em Composições o primário é "Nova composição analítica" |
| Mapa (Distritos) | A cor varia com a quantidade de obras, com a mesma rampa verde da métrica de valor |
| Tokens | Arquivo único `shared/tokens.css`, carregado por todas as páginas (inclusive as embutidas). Nomes antigos viram apelidos e saem no fim |
| Entrega | Blocos B0–B5, cada um revisado pelos 4 revisores; avança só com os 4 = APROVADO |
| Verificação | Contas de teste, somente leitura; capturas antes/depois nos dois temas anexadas à revisão do bloco. Senha informada a cada sessão, nunca gravada no repositório |

## 3. Diagnóstico (evidência de 06/10/2026, tema claro, perfil admin)

Capturas não são versionadas (contêm nomes e dados reais). Todas as medidas abaixo foram feitas na aplicação rodando.

**Estrutura**
- Três sistemas de tema independentes: `style.css` (`body.theme-dark`, 184 regras), `assets/css/mapa-obras.css` (`:root:not(.theme-dark)`, ~50 tokens), `cronograma.html` (106 regras). O `assistente.html` não usa `theme-dark`.
- 380 cores hex fixas contra 243 usos de `var(--)` em `style.css`; 293 `!important`.
- Dois verdes de ação (`#008F3D` no app, `#0C8A5C` no Mapa) e dois fundos de página (`#eef3ef`, `#F4F6F5`).

**Contraste (falha no critério AA aprovado)**
- `#008F3D` sobre branco 4,20:1 e sobre o fundo da página 3,74:1; `#0C8A5C` 4,37:1 e 3,89:1. Ambos reprovam como fundo de botão com texto branco e como texto.
- Cinza `#64748b` (subtítulos) sobre `#eef3ef`: 4,24:1.
- Azul Bootstrap `#0D6EFD` com texto branco: 4,50:1 (no limite).
- Referência de verde que passa: `#007233` (6,08:1 com branco; 5,41:1 sobre o fundo da página).

**Inconsistências entre módulos**
- Margem lateral: 24px (Processos, Financeiro, Curva ABC) × 48px (Orçamentos, Composições, Tabelas, Administração).
- Título de página: cada módulo repete o nome da barra superior de um jeito (negrito à esquerda, ícone+título, caixa alta pequena, verde grande centralizado e colado na barra em Tabelas, ausente em Curva ABC).
- Botões: verde institucional convive com azul Bootstrap em caixa alta; "Limpar" ora pílula, ora retângulo, e **verde cheio**, competindo com a ação principal.
- Rótulos de filtro: verdes em Tabelas, cinza-escuros nos demais.
- Janela "Gerenciar Processo": cabeçalho cinza-quase-preto (não o verde da barra) e título em caixa alta; botão primário azul Bootstrap em caixa alta; campos sem moldura (parecem texto); selos "Fiscalização" azul × "GECOPE" verde; fundo escurecido atrás da janela muito tênue.

**Cor sem significado**
- Barras laterais verde/azul/laranja/roxo nos KPIs de Processos, Orçamentos, Administração e Atividades. "Aprovados" é azul num módulo e verde noutro.
- Início com 7 cores de ícone. Topo dos cartões do Financeiro com tons diferentes entre as seções.

**Legibilidade**
- Processos, coluna Descrição: texto justificado em coluna estreita (buracos entre palavras); a tabela excede em ~12px a margem dos cartões acima.
- Mapa: ~70 declarações de fonte entre 8,5px e 11px; nomes de distrito finos e cinza-esverdeados sobre verde pálido; em Distritos os 11 distritos têm a mesma cor (103 obras = 11 obras).
- Quase todo rótulo em caixa alta com espaçamento largo.
- Tabelas e Curva ABC deixam mais da metade da tela vazia até a primeira ação.

**Levantado no B0 (06/10/2026)**
- **Assistente de Dados e seu painel** têm paleta e tipografia próprias: fonte **Inter** (não Montserrat), acento **índigo `#4F46E5`**, cinzas quentes (`#262624`, `#6B6B68`, `#9C9C98`), raios de 9/14/22px. Nada vem da marca. Entram no B5 e contrariam a decisão de uma só família tipográfica enquanto não migrarem.
- **Ficha Obra (Mapa)** é a janela mais bem resolvida: texto em sentença, cartões com título e ícone, fundo escurecido e desfocado, rótulos pequenos acima dos valores. **Serve de modelo** para as demais janelas (B5). Pontos a melhorar: rótulos de ~11px, e o ponto vermelho ao lado de "Em Execução" numa obra paralisada mistura o significado do vermelho (paralisação) com o do rótulo.
- **Mapa dentro de um distrito** já varia a cor dos municípios com a quantidade de obras (Juazeiro do Norte, 12, é o mais escuro). A decisão Q9 vale, portanto, para a **visão geral dos distritos**, onde todos têm a mesma cor. Nomes dos municípios em caixa alta fina e contagens de ~9px.
- Janela "Gerenciar Processo": o fundo atrás dela é pouco escurecido; na Ficha Obra é bem escurecido.
- A tela **Atividades** tem dados vivos (cartões e prazos mudam entre duas capturas idênticas, até ~3.300 px): comparação por pixel não vale para ela; use comparação de valores resolvidos ou capture com a mesma massa de dados.

**Ainda não avaliado:** modais de Orçamentos, Composições e Curva ABC, tabelas cheias de Tabelas, relatórios impressos.

## 4. Blocos de entrega

Cada bloco declara o que **não** muda. O escuro só muda onde o layout é compartilhado (decisão Q10).

### B0 — Tokens (sem mudança visual) — **EXECUTADO em 06/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Criado `shared/tokens.css` (26 variáveis `--gc-*`, valores idênticos aos atuais) e carregado em `index.html`, `cronograma.html`, `assistente.html`, `assistente-painel.html`, `gecope_mapa_obras.html`, `privacidade-eletrica.html`, sempre antes do CSS da página.
- No `style.css` o bloco `:root` das cores, raios e sombras virou apelidos (`--sop-green: var(--gc-verde-app)` etc.). O Mapa, o Cronograma e o Assistente ainda têm valores próprios (migram no B1/B4/B5); `--gc-verde-mapa` e `--gc-pagina-claro-mapa` existem como destino e ainda não têm consumidor.
- **Verificação feita:** (1) o valor resolvido de todas as variáveis (127 no `index`, 71 no Cronograma, 15 no Assistente, 16 no painel do Assistente, 6 na Privacidade, 104 no Mapa) é idêntico antes e depois; as únicas diferenças são as 26 variáveis `--gc-*` novas. (2) Capturas de 11 telas × 2 temas com o usuário de teste: idênticas pixel a pixel, exceto Atividades e Assistente, que variam entre duas capturas do **mesmo** código (dados vivos e animação da saudação).
- Revisores: o B0 não muda nada visível e foi provado por valor resolvido; não disparei os 4 revisores. Se quiser o ritual completo, é só pedir.
- **Decidir o verde único**: proposta partir de `#007233` (já existe como `--sop-green-dark`, passa AA). Mostrar prévia ao usuário antes de aplicar no B1; esta é a única mudança de cor que o usuário ainda precisa ver.
- Levantar as telas "não avaliadas" da seção 3 e acrescentá-las a este documento.
- **Aceite:** capturas antes/depois dos dois temas idênticas (diferença de pixel zero) em Início, Processos, Financeiro, Mapa, Atividades e Assistente; nenhuma página com erro novo no console.

### B1 — Cor semântica e botões — **EXECUTADO em 06/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Remover barras laterais coloridas dos KPIs e reduzir as cores de ícone do Início; aplicar o verde único e cinzas com AA; regra de botões da seção 2.
- **Feito (só no tema claro, por decisão Q2; bloco "B1" no fim do `style.css`):** verde único `#007233` (`--gc-acao` em `shared/tokens.css`) aplicado a `--sop-green`; botões `btn-success`/`btn-primary` em verde cheio (o azul Bootstrap deixa de ser primário); `btn-outline-primary/success` em contorno verde; `btn-secondary` neutro com contorno; chips de ícone (Início, KPIs, seções do Admin) em fundo verde suave com ícone verde; barras laterais coloridas dos KPIs removidas (nos dois temas, no escuro eram quase invisíveis). Cinzas de texto com AA (`--text-muted`, `--sop-gray-mid` → slate-600; azul de link `#006F9A`; `--cv-muted` da Curva ABC).
- **Feito nos dois temas:** "Limpar" (`.btn-grid-clear` e `.btn-limpar`) passou a botão neutro com contorno, sem paleta própria. Botões PDF de Processos e Composições deixaram de ser vermelhos (exportar não é ação destrutiva); em Composições o primário é "Nova composição analítica" e "Upload" virou contorno.
- **Medido:** varredura automática de contraste do texto (limite 4,5:1; 3:1 para texto grande) nas abas ativas, antes → depois: Processos 10 → 0, Financeiro 10 → 0, Curva ABC 2 → 0, Orçamentos 1 → 0, Composições 1 → 0, Tabelas 1 → 0, Administração 1 → 0. No escuro, as capturas diferem do B0 só nos botões "Limpar" e num recuo de ~4px onde havia a barra lateral escura.
- **Exceções deliberadas (cor com significado):** barras de topo dos cartões do Financeiro (acréscimo/supressão/repercussão), barras e chips de status dos KPIs de Atividades (em execução, fila, devolvida, paralisada, concluída), vermelho em "Excluir", ícone do WhatsApp (cor da marca), barra verde do cartão de filtros (marca de agrupamento).
- **Fora do B1 (anotado para os próximos blocos):** verde do Mapa (`--ng #0C8A5C`, B4); a paleta própria da Curva ABC (`--cv-green #22a155`, `--cv-blue`, `--cv-amber`, definida em `<style>` no `index.html`, B5); cores fixas `#198754`/`#0d6efd` em componentes antigos do `style.css` e em HTML gerado por JS (badges, janelas); no escuro o azul dos botões e os ícones coloridos permanecem (paleta do escuro não muda — se quiser a mesma regra lá, é uma extensão pequena); a varredura de contraste só cobriu as abas ativas, não as janelas, o Mapa nem Atividades. Os 4 revisores ainda não rodaram neste bloco.
- **Aceite:** nenhum texto abaixo de 4,5:1 nos módulos cobertos; nenhum azul Bootstrap restante em botões; "Limpar" nunca verde cheio; cor presente só onde significa algo (lista de exceções documentada na revisão).

### B2 — Tipografia — **EXECUTADO em 06/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Sentença nos rótulos e cabeçalhos de tabela (exceto siglas/selos); descrição alinhada à esquerda; piso de 12px; escala tipográfica documentada (corpo, rótulo, título de seção, número de destaque).
- **Feito (nos dois temas):** escala em `shared/tokens.css` (`--gc-fs-piso/rotulo/corpo/secao/destaque`); 15 regras de rótulo/cabeçalho do `style.css` deixaram de usar caixa alta e espaçamento largo e passaram a 13px (`--gc-fs-rotulo`); as 34 classes `text-uppercase` de rótulos e títulos no `index.html` saíram; textos digitados em caixa alta (títulos e rótulos de janelas, botões "Salvar alterações", "Excluir processo", "Upload de composição", "Nova composição analítica", cabeçalhos de Tabelas e da Curva ABC) e em Title Case ("Panorama geral", "Módulos do sistema", rótulos de KPI) viraram sentença, inclusive os textos que o JS escreve de volta nos botões ("Salvando...", "Salvar"). Todas as declarações de fonte < 12px do `style.css`, do `index.html` e dos módulos de UI subiram para 12px; o `.badge` do Bootstrap ganhou piso de 12px; o gráfico do Financeiro (Plotly) subiu de 11 para 12. Os `td` com `text-align: justify` (descrição em Processos, Tabelas, Composições) passaram a alinhar à esquerda.
- **Medido (aba ativa, tema claro; antes → depois):** textos < 12px: Início 2 → 0, Processos 5 → 0, Financeiro 9 → 0, Curva ABC 2 → 0, Composições 1 → 0, Tabelas 1 → 0, Administração 1 → 0; justificados em Processos 1 → 0; caixa alta por CSS fora de selos: 0. Contraste do B1 mantido (0 falhas). Janela "Gerenciar Processo": 0 textos < 12px, 0 em caixa alta fora dos selos "Fiscalização" e "GECOPE".
- **Ficou em caixa alta por decisão (siglas e selos de status):** selos "Mais usado", "Processo" do feed, "Tramitado", grupo "EM ANÁLISE", "Fiscalização"/"GECOPE" da janela, siglas SEINFRA/SINAPI/ORSE, opções de status (o valor é usado na lógica), cabeçalho institucional (SOP-CE, Superintendência...) e o papel do usuário. Descrições vindas do banco (obra, contratada, fiscal, categorias) não foram alteradas; `text-uppercase` em descrições de insumos de Tabelas foi mantido.
- **Fora do B2 (blocos próprios):** Mapa de Obras (fontes de 8,5–11px, B4), Atividades/Cronograma e Assistente de Dados (CSS próprio, Inter, B5), HTML de relatórios e `relatorio.js` (formato impresso: 14 declarações < 12px mantidas de propósito), `.cv-coment-editor` (texto justificado de relatório formal) e as janelas que não abri (Orçamentos, Composições, Curva ABC, Admin). A varredura só cobre abas ativas e a janela de processo. Os 4 revisores ainda não rodaram neste bloco.
- **Aceite:** varredura automática sem `font-size` < 12px fora dos selos de 1–3 caracteres; nenhum `text-align: justify` em coluna de tabela.

### B3 — Layout de página — **EXECUTADO em 07/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Margem 24/32 px com largura máxima de 2000px; cabeçalho de página padrão; barra superior mais baixa em verde da marca; cabeçalho e fundo das janelas alinhados à barra; tabela de Processos dentro da margem.
- **Feito:** margem lateral única (24px até 1199px, 32px a partir de 1200px) e largura máxima de 2000px em `main.page-wrapper`; o `.page-wrapper` aninhado das abas deixou de somar outros 24px (era 48px em Orçamentos, Composições, Tabelas e Administração). Cabeçalho de página padrão `.gc-page-head` (descrição à esquerda, ações à direita; sem o título repetido) em Processos, Financeiro, Orçamentos, Composições, Tabelas e Administração; a Curva ABC não tinha título e ficou como está. Barra superior dos módulos: 54 → 48px e, no tema claro, verde da marca `#007233` (o escuro mantém a paleta); textos da barra com mais opacidade para manter o contraste. O conteúdo do cabeçalho (logo, barra, saudação do Início) segue a mesma margem e largura máxima da página. Janelas: cabeçalhos `bg-dark/primary/secondary/success` passam ao verde da barra no tema claro (perigo e aviso permanecem), fundo escurecido de 50% para 60% com leve desfoque. Processos até 1400px: recuo interno das células e largura mínima dos selos reduzidos, porque a tabela de 10 colunas passava 120px da margem em 1280px.
- **Medido (tema claro, usuário de teste):** 7 módulos × 3 larguras (1280, 1440, 1920) = 21 medidas, **0 com rolagem horizontal**; primeiro bloco de cada módulo começa em 32px (1280/1440) e 192px (1920, dentro dos 2000px centralizados). Antes do ajuste, Processos em 1280px rolava 89px. Cabeçalho da janela "Gerenciar processo" resolvido para `rgb(0,114,51)`. Contratos e Atividades (embutidos) mantêm o espaçamento próprio de 16px. Script: `verificacao/layout.mjs`.
- **Limite conhecido:** em 1280px a tabela de Processos cabe com folga de 2px (1214 de 1216); um nome de contratada com palavra muito longa pode voltar a gerar rolagem.
- Os 4 revisores ainda não rodaram neste bloco.
- **Aceite:** mesma margem lateral em todos os módulos; nenhum título repetido; sem rolagem horizontal nova em 1280, 1440 e 1920 px; modos compacto/embutido preservados.

### B4 — Mapa de Obras — **EXECUTADO em 07/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Cor dos distritos proporcional à quantidade; nomes e números com peso/contraste legíveis; piso de 12px nas fontes; remover a Space Grotesk (números em Montserrat, com `tabular-nums` se a versão carregada suportar — verificar antes).
- **Feito:** (1) visão geral dos distritos: `render()` passou a calcular o valor de cada distrito sempre (antes só com filtro ativo) e `groupStyle()` escala a opacidade do verde por ele, com a mesma fórmula do nível dos municípios (`choroFloor + choroSpan·t`); o `.5` fixo só vale antes do 1º render. (2) Todas as 140 declarações de `font-size` < 12px do `mapa-obras.css` e a 1 do JS foram para 12px; rótulos de distrito/município e suas contagens usam `max(12px, …)` sobre a escala do zoom (`lblFS`: município 12 + 3t). (3) Nome de distrito de 400 para 600. (4) Space Grotesk saiu (CSS, JS e a fonte do Google no HTML): números em Montserrat. (5) Verde do Mapa no claro: `--ng #0C8A5C` → `#007233` (`--ng-light/mid` `#005A29`, `--ng-deep` `#004A22`), o mesmo `--gc-acao` do app.
- **Medido:** nenhum texto < 12px no Mapa (varredura `verificacao/mapa.mjs`, claro e escuro); só Montserrat nos elementos com texto; em Distritos a RM Fortaleza (103) fica visivelmente mais escura que Quixeramobim (11), nos dois temas; capturas do mapa, de um distrito com o painel aberto e da Ficha Obra sem sobreposição nem quebra visível.
- **Mantido de propósito:** as cores de preenchimento do mapa (`--map-base`, `--map-open-fill` etc.) são verdes de visualização, não o verde de ação; títulos do painel lateral do Mapa ("PAINEL", "OBRAS") ainda em caixa alta com espaçamento; nomes de município vêm do banco em caixa alta. Os 4 revisores ainda não rodaram neste bloco.
- **Aceite:** em Distritos, 103 e 11 obras são distinguíveis a olho em projeção; modo apresentação, métricas Valor/Replanilhamentos/Elétrica e `postMessage` de tema embutido continuam funcionando; leitura de `TOKENS` no JS sem regressão ao trocar de tema.

### B5 — Embutidos e janelas — **EXECUTADO em 07/10/2026, branch `feat/design-tema-claro-b0`, não commitado**
- Cronograma (Atividades), Assistente de Dados, janelas do Mapa e modais dos módulos seguem os tokens e as regras acima.
- **Feito:** (1) Atividades (`cronograma.html`): 43 declarações de fonte < 12px subiram para 12px (as bolinhas de ícone de 8px ficaram), rótulos e cabeçalhos em sentença (caixa alta e espaçamento saíram; ficaram só `.cal-dow` e `.cal-evento-badge`, siglas/selos), rótulos de KPI e opções de status digitados em caixa alta viraram sentença. (2) Assistente de Dados e seu painel: Inter → Montserrat, e no tema claro cinzas quentes → escala slate, índigo `#4F46E5` → verde único, botão de enviar no verde (a paleta do escuro não mudou, só a família tipográfica). (3) Curva ABC: `--cv-green`, `--cv-green-hi`, `--cv-green-soft` e `--cv-cA` apontam para o verde único no claro (bloco B5 do `style.css`); os botões das janelas SweetAlert da Curva ABC (`cvVerdeAcao`) também. O azul e o cinza das classes B e C ficam (codificação de dado). (4) Janelas: campos "bg-light border-0" e todos os campos de Gerenciar processo ganharam moldura (a regra "campo plano" de `#formDetalhes` foi trocada, foco com anel verde); títulos de seção e rótulos digitados em caixa alta nas janelas de Novo processo, Orçamentos, Composições e Revisões viraram sentença, e "ENSINO MDIO" (acento perdido antes desta revisão) voltou a "MÉDIO".
- **Medido:** Atividades sem texto < 12px nem caixa alta por CSS (antes 5 grupos de textos pequenos e 6 rótulos em caixa alta); varredura de contraste das 7 abas principais com 0 falhas depois de todos os blocos; varredura de tipografia sem texto < 12px em nenhuma aba. Janelas "Gerenciar processo", "Novo processo", "Cadastrar orçamento" e "Cadastrar composição" conferidas em captura (cabeçalho verde, campos com moldura, primário verde). Scripts: `verificacao/embutidos.mjs`, `layout.mjs`.
- **Ficou de fora:** modais que dependem de dados reais para abrir (Revisões, Checklist de aditivo, Alerta de retorno, Editar usuário) foram só tocados pelas regras globais (cabeçalho verde, moldura) e pela troca de texto, sem captura; a seta "Selecionar Status" ainda em azul nas janelas de cadastro; o escuro do Assistente mantém índigo e cinzas quentes (decisão Q2/Q10). Os 4 revisores ainda não rodaram em nenhum bloco.
- **Aceite:** sem cor, margem ou botão fora do padrão; janelas com campo editável visível (moldura) e primário verde.

## 5. Fora de escopo
- Trocar a identidade visual, a paleta do escuro ou a tipografia da marca.
- Lógica de negócio, dados, SQL, Edge Functions.
- Relatórios impressos e exportações (PDF/Excel), salvo se o B0 mostrar dependência dos tokens.

## 6. Riscos
- **Regressão no escuro:** o layout compartilhado muda; os revisores tratam mudança de layout no escuro como aprovada, e mudança de paleta como bloqueio.
- **Cores lidas por JS:** `TOKENS` do Mapa e os gráficos Plotly fixam cor no render; qualquer renomeação de token exige redesenhar ao trocar de tema.
- **Embutidos:** iframes têm CSS próprio; o `shared/tokens.css` precisa ser carregado por eles, ou a regra do verde único não vale lá.
- **`!important`:** 293 ocorrências em `style.css` podem anular tokens; tratar caso a caso no B1.
- **Verde mais escuro:** o `#007233` é visivelmente mais fechado que o atual; por isso a prévia obrigatória antes do B1.

## 7. Pendências para aprovação
1. Aprovar esta spec.
2. Ver a prévia do verde único (B0) e do cabeçalho mais baixo (B3) antes da aplicação.
