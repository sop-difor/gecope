# Revisão de design do tema claro — Andamento e retomada

Última atualização: 07/10/2026. A spec (decisões, diagnóstico, critérios de aceite) está em [spec.md](spec.md); este arquivo registra **onde paramos** e **como continuar**.

## Estado em uma linha

Grilling concluído (Q1–Q19) e spec aprovada. **B0 a B5 executados e verificados (todos os blocos de código).** Falta só rodar os 4 revisores, se o usuário quiser, e decidir commit/PR. Nada foi commitado nem enviado: tudo está na branch `feat/design-tema-claro-b0`, só na cópia de trabalho. Os 4 revisores ainda não rodaram em nenhum bloco.

## O que foi feito

| Bloco | Resultado | Como foi provado |
|---|---|---|
| **B0** Tokens | `shared/tokens.css` (26 variáveis `--gc-*`, depois ampliado) carregado em 6 páginas; `style.css` aponta seus nomes antigos para ele. Sem mudança visual | Valor resolvido de todas as variáveis idêntico antes/depois (127 no `index`, 71 no Cronograma, 104 no Mapa…); capturas de 11 telas × 2 temas idênticas, exceto Atividades e Assistente (variam sozinhas) |
| **B1** Cor e botões | Verde único `#007233` (só no claro); primário verde, secundário em contorno, "Limpar" neutro nos dois temas, PDF deixou de ser vermelho; chips de ícone neutros; barras laterais dos KPIs removidas; cinzas com AA | Varredura de contraste nas abas ativas: Processos 10→0, Financeiro 10→0, Curva ABC 2→0, demais 1→0 |
| **B2** Tipografia | Rótulos e cabeçalhos em sentença; textos digitados em caixa alta e Title Case convertidos; piso de 12px; escala `--gc-fs-*`; sem `justify` em tabela | Varredura: texto < 12px em todas as abas 0; janela "Gerenciar Processo" sem texto pequeno nem caixa alta fora dos selos |
| **B3** Layout de página | Margem 24/32px com largura máx. 2000px; cabeçalho de página padrão sem título repetido; barra superior 48px em verde `#007233` (claro); janelas com cabeçalho verde e fundo mais firme; Processos sem rolagem horizontal em 1280px | 21 medidas (7 módulos × 1280/1440/1920): 0 com rolagem horizontal; capturas antes/depois dos dois temas; `verificacao/layout.mjs` |
| **B4** Mapa de Obras | Cor dos distritos proporcional à métrica; piso de 12px; Space Grotesk fora; verde do Mapa = `#007233` | `verificacao/mapa.mjs`: 0 textos < 12px, só Montserrat, 103 × 11 obras distinguíveis nos dois temas |
| **B5** Embutidos e janelas | Atividades com piso de 12px e sentença; Assistente em Montserrat e verde único (claro); Curva ABC no verde único; janelas com campo editável emoldurado e textos em sentença | `verificacao/embutidos.mjs` (0 texto < 12px), contraste das 7 abas 0 falhas, capturas das janelas |

Arquivos alterados: `style.css`, `index.html`, `shared/tokens.css` (novo), 5 páginas HTML (só a linha que carrega o `tokens.css`), `modules/{administracao,composicoes,contratos,curva-abc,financeiro,orcamentos,processos,tabelas}/*.js`, `whatsapp.js`, `docs/MAPA-MODULOS.md` (entrada do `tokens.css`).

## Extra: nova página Início (07/10/2026, pedido do usuário)

Faixa de fotos de 420px para ~195px (altura do conteúdo, carrossel mantido por trás); sem os títulos "Panorama geral" e "Módulos do sistema"; Processos (verde cheio no claro) e Atividades em duas colunas; os oito demais módulos numa grade de 4 colunas, na ordem Administração, Curva ABC, Composições, Financeiro / Orçamentos, Contratos, Tabelas, Assistente de Dados, cada um com uma descrição curta; selos sem caixa alta. Só CSS no fim do `style.css` (bloco "INÍCIO") e o HTML do `#pane-home`. Verificado em 1920, 1280 e 420px, claro e escuro, sem rolagem horizontal. **Cabeçalho do Início (decidido em grilling, 07/10/2026):** fotos e faixa do portal removidas; barra verde de 64px (`--gc-acao` no claro) com o brasão, a assinatura "SOP-CE | Superintendência de Obras Públicas" em branco e transparente (`assets/sop-branco.png`, derivada de `assets/sop.png`) + "GECOPE" + "Gestão de aditivos de obras" à esquerda e tema/tela cheia/usuário à direita; faixa de onda amarela/verde do portal da SOP abaixo da barra (só Início, só tema claro); saudação movida do hero para o topo do `#pane-home`, como título da página. A barra dos módulos não mudou (decisão Q10). O escuro só ganhou a estrutura nova (sem fotos), com a paleta de antes. `assets/hero-*.jpg` não são mais usados pelo `index.html` (o `cronograma.html` ainda os referencia, escondidos no modo embutido).

**Cartões da Início (decidido em grilling, 07/10/2026):** a faixa dos três indicadores saiu; os números ("75 em andamento", "4 em análise", "1 aprovado no mês") moram no cartão Processos e são atalhos (`abrirProcessosDaInicio`, `core/shell.js`: abre a aba Em tramitação, a mesma já recortada em Em análise/Em reanálise, ou a aba Aprovados, que não filtra por mês). Atividades só explica o que é, sem número. Selos "Mais usado" removidos. Detalhe de marca: barra amarela do portal sob o nome do módulo, que alonga no hover; cor cheia só em Processos. Módulos bloqueados mostram o motivo no lugar da descrição (`motivoModuloBloqueado`, `core/auth.js`): "Liberado pelo administrador" (módulo com `data-autorizacao`: Financeiro e Assistente), "Só para administradores" ou "Indisponível para o seu perfil". Painel "Atividades realizadas" com o mesmo raio e "Ver tudo" em verde.

**Cabeçalho único e aba Processos (decidido em grilling, 07/10/2026):** a barra é a mesma em todas as telas (brasão, assinatura da SOP, "GECOPE · Gerência de Controle e Análise de Aditivos", tema, tela cheia, usuário); a onda só na Início e, nos módulos, só o filete verde. Nos módulos, uma trilha abaixo da barra (`.gc-trilha`, em `index.html` no começo do `<main>`): botão único "← Painel principal", nome do módulo e, no Contratos, "Base atualizada em ...". Saíram da barra o botão de voltar, o título central e a data da base; `has-photo` deixou de ser alternado em `setHeroContext`. Processos: abas com sublinhado verde e contagem (`contarAbasProcessos`); os quatro cartões viraram uma faixa de atalhos de situação (Todos / Com o fiscal / Em análise fiscal / Em reanálise fiscal, `filtrarProcessosPorStatus`), cujos números contam sem o filtro de status; "Por fiscal" (só admin e gerente) abre a distribuição do recorte ativo; barra de filtros numa linha (busca, status, fiscal, "Mais filtros" com Metas e Prioritário, "Exportar" com Excel e PDF) fixa ao rolar em telas >900px, e chips dos filtros ativos com "Limpar filtros" (`atualizarEstadoFiltrosProcessos`, `removerFiltroProcessos`). O cabeçalho da tabela desce a altura da barra (`--proc-toolbar-h`). O que não mudou: a tabela e a janela "Gerenciar processo".

## O que falta

1. **Decidir sobre commit/PR.** Sugestão: commitar B0+B1+B2 (ou um commit por bloco) antes de seguir, para não depender da cópia de trabalho.
2. ~~B3 — Layout de página~~ (feito em 07/10/2026; ver spec).
3. ~~B4 — Mapa de Obras~~ (feito em 07/10/2026; ver spec).
4. ~~B5 — Embutidos e janelas~~ (feito em 07/10/2026; ver spec).
5. **Rodar os 4 revisores** (Objetivo/Spec · Regressão · Design/UX · Performance) nos blocos já feitos, se o usuário quiser o ritual completo.

## Pendências e decisões em aberto

- **Escuro:** por decisão (Q2/Q10) a paleta do escuro não muda; por isso lá permanecem os botões azuis e os ícones coloridos. Se quiser a mesma regra de cor no escuro, é extensão pequena do B1.
- **Cores fixas restantes:** `#198754`/`#0d6efd` em componentes antigos do `style.css` e em HTML gerado por JS (badges, janelas).
- **Varredura de contraste** só cobriu abas ativas e a janela de processo, não o Mapa nem Atividades.
- **Caixa alta mantida de propósito:** selos de status, siglas, opções de status (valor usado na lógica), cabeçalho institucional, descrições do banco, `text-uppercase` em descrições de insumos de Tabelas.
- **`relatorio.js`:** 14 declarações < 12px mantidas (formato impresso).

## Como retomar e verificar

1. `git switch feat/design-tema-claro-b0` e conferir `git status`.
2. Servir localmente: `python -m http.server 8765` na raiz do repositório.
3. Os scripts de [verificacao/](verificacao/) usam a skill `browser-automation` e **leem usuário e senha de variáveis de ambiente — nenhuma credencial está gravada**. A conta de teste (`usuario.teste@sop.ce.gov.br`) foi liberada para leitura; peça a senha ao usuário a cada sessão.
   ```
   export GC_USER='…' GC_PASS='…' GC_OUT=<pasta>
   node ~/.claude/skills/browser-automation/browser.mjs http://localhost:8765/index.html --script docs/revisao-design-tema-claro/verificacao/capture.mjs
   ```
   - `capture.mjs`: captura Início e 10 módulos nos dois temas. `diff.py <pastaA> <pastaB>` compara pixel a pixel.
   - `contrast.mjs`: contraste do texto (4,5:1; 3:1 em texto grande) nas abas ativas, tema claro.
   - `type.mjs`: texto < 12px, caixa alta, texto digitado em caps e justificado, por aba.
   - `modal2.mjs`: mesma medição na janela "Gerenciar Processo".
   - `vars.mjs`: valor resolvido das variáveis CSS de uma página (para provar que uma refatoração não muda nada; rodar com e sem a alteração e comparar).
4. Login do app: campos `#landing-matricula` e `#landing-password` (os `#login-*` são de outro formulário oculto). Para voltar ao Início use `.btn-back-minimal, .cb-back`.

## Armadilhas já encontradas

- **Fim de linha:** `index.html` é CRLF no repositório e o resto é LF, com `core.autocrlf=true`. Editar com Python em modo binário detectando o fim de linha; nunca `sed -i` no `index.html` (um `sed` inflou o diff de 7 para 9.815 linhas). Conferir `git diff --stat` após cada edição.
- **`git stash push -- <arquivo novo>`** falha em silêncio; stash só de arquivos rastreados e confirmar que a mudança sumiu.
- **Comparar por pixel não serve** para Atividades (dados vivos) nem para a saudação do Assistente (animação); use valor resolvido de variáveis.
- **`page.evaluate` roda em mundo JS isolado**: não enxerga as funções do app; clicar na UI funciona.
- **Erros de CORS do WhatsApp no console** aparecem só em `localhost`; não são do código.
