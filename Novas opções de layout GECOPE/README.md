# Handoff: Painel de Processos (GECOPE) — Novo Layout

## Overview
Redesign do painel "Processos" do GECOPE (gestão de aditivos de contratos de obras públicas). Mantém 100% das funcionalidades existentes (abas por página, filtros, exportação Excel/PDF, ações por linha, prioridade) com um layout visual novo: KPIs com maior destaque, filtros em barra única alinhada, e uma tabela mais legível com mais colunas de contexto (Suíte, Analista, Abertura, Contratada, Descrição).

**A opção final aprovada é a `2a`**, localizada na seção `id="t2"` do arquivo `Processo - Novas Opções.dc.html` (a primeira seção do arquivo). As demais opções (`1a`–`1d`, seção `id="t1"`) foram explorações preliminares descartadas pelo usuário — **ignore-as** ao implementar; estão no arquivo apenas como histórico da exploração.

## About the Design Files
Os arquivos deste pacote são **referências de design construídas em HTML** (protótipos interativos que rodam num runtime de componentes proprietário do Claude/Anthropic) — não é código de produção para copiar diretamente. A tarefa é **recriar o layout `2a` no ambiente real do GECOPE** (o codebase em `sop-difor/gecope` no GitHub — HTML/CSS/JS vanilla com Bootstrap Icons, sem framework de componentes), reaproveitando os padrões, classes CSS e tokens já existentes no projeto (`style.css`, `main.js`), e usando fonte Montserrat (já carregada no projeto real).

## Fidelity
**Alta fidelidade (hifi)**: cores exatas, tipografia, espaçamento e tamanhos estão definidos abaixo e devem ser seguidos pixel a pixel sempre que possível dentro das convenções do CSS do projeto real.

## Screen: Painel de Processos (opção 2a)

### Purpose
Tela principal onde analistas/fiscais/gerentes acompanham a tramitação de processos de aditivos: filtram, buscam, exportam e abrem/editam processos individuais.

### Layout geral
- Container branco (`#fff`), `border-radius: 24px`, largura total do painel de conteúdo (sem largura fixa — o valor de 1820px no protótipo é só o canvas de apresentação).
- Padding interno: `28px 32px 32px`.
- Estrutura vertical, de cima para baixo:
  1. Cabeçalho (título + botão "Novo Processo")
  2. Grade de 4 KPIs
  3. Abas segmentadas (pill) por página: Em Tramitação / Aprovados / Arquivados
  4. Painel "Filtros de Pesquisa"
  5. Tabela de processos
  6. Rodapé (contagem + dica)

### 1. Cabeçalho
- Título: "Painel de Processos" — `font-weight:700`, `font-size:1.45rem` (~23px), cor `var(--text-heading)`.
- Subtítulo: "Gerencie a pauta, visualize prazos e edite informações." — `font-size:0.98rem` (~15.7px), cor `var(--text-muted)`.
- Botão primário "Novo Processo" à direita, variante `success` (verde sólido `--sop-green`), altura 40px, ícone `bi-plus-lg`.
- `justify-content: space-between`, `align-items: flex-start`.

### 2. Cards de KPI (4, em grid `repeat(4, 1fr)`, `gap: 12px`)
Cada card:
- Fundo branco, `border-radius:16px`, `box-shadow: var(--shadow-card-subtle)`, borda `1px solid var(--sop-slate-100)`.
- **Borda esquerda de destaque**: `border-left: 4px solid {accent}` — esta é a ênfase sutil pedida pelo usuário (ao invés de fundo colorido, que foi tentado e revertido).
- Padding `18px 20px`, `display:flex; align-items:center; gap:16px`.
- Ícone: chip quadrado arredondado 48×48px, `border-radius:14px`, fundo sólido na cor de destaque (`{accent}`), sombra `0 4px 10px -2px {accent}`, ícone branco (Bootstrap Icons) `font-size:1.2rem`.
- Texto (coluna): label em uppercase `font-size:0.78rem`, `font-weight:700`, `letter-spacing:0.06em`, cor `var(--text-muted)`; valor grande `font-size:2.1rem`, `font-weight:800`, cor `var(--text-heading)`; subtexto `font-size:0.78rem`, cor `var(--text-muted)`.
- Hover: `box-shadow: var(--shadow-md)`, `transform: translateY(-3px)`, transição `var(--transition-fast)`.

Os 4 KPIs e suas cores de destaque:
| Label | Cor accent | Ícone |
|---|---|---|
| Processos | `var(--sop-green)` (#008F3D) | `bi-pin-angle-fill` |
| Aguardando Análise | `var(--sop-orange)` | `bi-hourglass-split` |
| Análise Fiscal | `var(--sop-green)` | `bi-check2-circle` |
| Reanálise Fiscal | `#6f42c1` (roxo, cor extra não presente no design system original — usada só para diferenciar esta métrica) | `bi-calendar-event` |

Cada card mostra: valor = contagem de processos filtrados na tela cujo status corresponde (ou total, para "Processos"); subtítulo indica o critério, ex. "Status = ANÁLISE FISCAL".

### 3. Abas por página (pill segmentado)
- Container: `display:inline-flex`, fundo `var(--sop-slate-100)`, `border-radius:999px`, padding `5px`, `gap:4px`.
- Cada aba: `padding:9px 20px`, `border-radius:999px`, `font-weight:600`, `font-size:0.95rem`.
  - Ativa: fundo `#fff`, cor `var(--sop-green)`, `box-shadow: var(--shadow-sm)`.
  - Inativa: fundo transparente, cor `var(--sop-slate-500)`.
- 3 abas: "Em Tramitação" (default), "Aprovados", "Arquivados". Cada aba filtra as linhas da tabela pelo campo de agrupamento de página do processo.

### 4. Painel "Filtros de Pesquisa"
- Usa o componente `Panel` (variant="filters", accent="green") do design system — cartão com borda esquerda verde e título.
- **Sombra reforçada** (pedido explícito do usuário): `box-shadow: 0 16px 32px -10px rgba(0,0,0,0.22)` (mais forte que o padrão do design system), `border-radius: var(--radius-lg)`.
- Conteúdo interno: uma única linha flexível (`display:flex; gap:16px; align-items:flex-end; width:100%`) com 6 grupos, todos alinhados pela base:
  1. Select "Metas" — `flex: 1.3`
  2. Select "Prioritário" — `flex: 1.3`
  3. Select "Fiscal" — `flex: 1.3`
  4. Select "Status" — `flex: 1.3`
  5. Input "Buscar" (placeholder: "Processo, descrição, analista, fiscal, status...") — `flex: 3.2` (a maior caixa da barra, mas não exagerada — foi ajustada para baixo depois de feedback de "muito grande")
  6. Botões, sem `flex-grow` (`flex: 0 0 auto`), lado a lado com `gap:6px`, nesta ordem: **Limpar** (verde, `variant="success"`) → **Excel** (outline, ícone `bi-file-earmark-excel`) → **PDF** (borda/cor customizada usando o token `--filetype-pdf-fg`, ícone `bi-file-earmark-pdf`).
     - **Importante**: o usuário pediu explicitamente que Limpar/Excel/PDF fiquem colados um ao outro (gap pequeno) e o mais próximo possível do campo Buscar, com o espaço economizado redistribuído entre as 5 caixas anteriores.
- Cada select/input tem label acima: uppercase, `font-size:0.8rem`, `font-weight:700`, cor `var(--text-muted)`, `margin-bottom:5px`.
- Altura de todos os controles (selects, input, botões) alinhada em **38px** — os botões usam `box-sizing:border-box; height:38px !important` via classe utilitária para bater exatamente com a altura dos inputs/selects.

### 5. Tabela de processos
- Container: fundo branco, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-card-subtle)`, borda `1px solid var(--sop-slate-100)`, `overflow:hidden`, `margin-top:18px`.
- `font-size` base da tabela: `1.02rem` (~16.3px) — aumentado deliberadamente a pedido do usuário para melhor legibilidade (fonte Montserrat em todo o painel).
- Cabeçalho (`<thead>`): fundo `var(--sop-slate-50)`, células `padding:13px 14px`, `font-size:0.82rem`, uppercase, `letter-spacing:0.05em`, `font-weight:700`, cor `var(--sop-slate-600)`.
- **Zebra striping**: linhas pares (`nth-child(even)`) recebem fundo `var(--sop-slate-50)` — um zebrado bem sutil mas perceptível, usando o cinza-claro já do design system (evitar tons verdes/tint customizados — foi tentado e revertido a pedido do usuário).
- Hover de linha: fundo `var(--sop-slate-100)` (um passo mais escuro que o zebra, para continuar perceptível sobre ambas as cores de fundo).
- Borda inferior de cada linha: `1px solid var(--sop-slate-100)`.

**Colunas (da esquerda para a direita) — atenção ao alinhamento, que foi ajustado várias vezes por feedback direto do usuário**:

| # | Coluna | Alinhamento | Conteúdo |
|---|---|---|---|
| 1 | AÇÕES | esquerda | Ícones `bi-eye-fill` (Detalhes, azul `--sop-blue`) e `bi-box-arrow-up-right` (Abrir no SUITE, verde `--sop-green`), `cursor:pointer` |
| 2 | PRIOR. | **centro** (cabeçalho e célula) | Ícone estrela: `bi-star-fill` cor `--sop-orange` se prioritário, `bi-star` cor `--sop-slate-200` se não |
| 3 | PROCESSO | esquerda | Número do processo em negrito (`font-weight:700`) + linha abaixo com ícone `bi-person-fill` e nome do fiscal (`font-size:0.88rem`, cor muted) |
| 4 | META | **centro** (cabeçalho e célula, `vertical-align:top`) | Badge de meta (tamanho aumentado — ver "Badges" abaixo) + subtexto centralizado abaixo (ex. data ou "Definir"), `font-size:0.88rem` |
| 5 | STATUS | esquerda (`vertical-align:top`) | Badge de status (mesmo tamanho aumentado) |
| 6 | SUÍTE | **centro** (cabeçalho e célula) | Nome do sistema (ex. "GECOPE") em negrito `font-size:1rem` + dias abaixo `font-size:0.86rem`, ambos centralizados |
| 7 | ANALISTA | **centro** (cabeçalho e célula) | Avatar circular 34×34px, fundo `var(--icon-bg-slate)`, cor `var(--icon-fg-slate)`, iniciais do analista, `font-size:0.92rem`, `font-weight:700`, centralizado com `margin:0 auto` |
| 8 | ABERTURA | **centro** (cabeçalho e célula) | Data de abertura em negrito `font-size:1rem` + dias em aberto abaixo `font-size:0.86rem`, `white-space:nowrap` |
| 9 | CONTRATADA | esquerda | Nome da empresa contratada, `max-width:200px`, `line-height:1.45`, **mesmo `font-size:0.96rem` da coluna Descrição** (ajuste explícito para igualar as duas colunas) |
| 10 | DESCRIÇÃO | esquerda | Texto livre da descrição do aditivo, `max-width:280px`, cor `var(--text-muted)`, `font-size:0.96rem`, `line-height:1.45` |

Colunas com indicador de ordenação (ícone `bi-arrow-down-up`, `font-size:0.6rem`, `opacity:0.6`) no cabeçalho: PRIOR., PROCESSO, META, SUÍTE (não tem, ver tabela — na verdade só Prior/Processo/Meta/Abertura têm o ícone; conferir código-fonte se precisar da lista exata), ABERTURA.

**Badges (Meta e Status)**: usam o componente `Badge` do design system, mas com tamanho de texto aumentado sobre o padrão via override: `font-size:0.76rem` (ajustado várias vezes por feedback — começou maior, foi reduzido duas vezes até chegar neste valor), `padding:4px 12px`. Tons usados: `warning-solid`, `danger-solid`, `brand`, `neutral`, `info`, `info-solid`, `attention`, `danger` — mapeados por status (ver tabela de status abaixo).

### 6. Rodapé da tabela
- `display:flex; justify-content:space-between; align-items:center; margin-top:14px`.
- Esquerda: pílula branca com borda `var(--sop-slate-200)` mostrando "Exibindo N processos".
- Direita: texto itálico muted "Utilize os filtros acima para refinar a busca."

## Interactions & Behavior
- **Abas de página** (Em Tramitação / Aprovados / Arquivados): clique troca a aba ativa e filtra as linhas da tabela pelo grupo de página do processo (`pageGroup`). Não há reload — filtragem client-side sobre o array de processos já carregado.
- **Filtros de Pesquisa** (Metas, Prioritário, Fiscal, Status, Buscar): no protótipo são apenas visuais (não filtram de fato) — a implementação real deve ligá-los à lógica de filtro já existente no `main.js` do GECOPE (mesmo comportamento da tela atual, só o layout muda).
- **Botões Limpar/Excel/PDF**: mesmas ações já existentes na tela atual (limpar filtros, exportar Excel, exportar PDF) — sem mudança de comportamento, só de posição/estilo.
- **Ícones de ação por linha** (Detalhes, Abrir no SUITE): mesmas ações da tela atual.
- **Hover em linha da tabela**: fundo muda para `var(--sop-slate-100)`.
- **Hover em card de KPI**: eleva (`translateY(-3px)`) e intensifica sombra — consistente com o padrão geral de hover "elevate + intensify" do design system.
- Nenhuma animação de entrada; transições usam `var(--transition-fast)` do design system (0.2–0.3s ease).

## State Management
- Estado necessário (client-side): aba de página ativa (`tramitacao` | `aprovados` | `arquivados`); valores dos filtros (meta, prioridade, fiscal, status, busca textual); lista de processos carregada (fonte real de dados a definir pelo backend/API do GECOPE — no protótipo é um array estático de exemplo).
- Ao trocar de aba ou filtro, apenas a lista renderizada na tabela muda; os KPIs no protótipo recalculam sobre o dataset completo (não filtrado pela aba) — confirmar com o time se os KPIs devem refletir o filtro ativo ou sempre o total geral antes de implementar.

## Design Tokens
Usar exclusivamente os tokens já definidos no design system GECOPE (`tokens/colors.css`, `typography.css`, `spacing.css`) — não inventar novos valores. Principais usados nesta tela:
- Cores: `--sop-green` (#008F3D), `--sop-orange`, `--sop-blue`, `--sop-slate-50/100/200/500/600`, `--text-heading`, `--text-muted`, `--icon-bg-slate`, `--icon-fg-slate`, `--filetype-pdf-fg`.
- Cor extra não coberta pelo design system original: `#6f42c1` (roxo, usado só no KPI "Reanálise Fiscal" para diferenciação visual) — considerar formalizar como token se for mantido.
- Sombras: `--shadow-sm`, `--shadow-md`, `--shadow-card-subtle`, mais uma sombra customizada mais forte só no painel de filtros (`0 16px 32px -10px rgba(0,0,0,0.22)`).
- Border-radius: `var(--radius-lg)`, `var(--radius-sm)`, e valores diretos `16px`/`24px` para os cards maiores (dentro da faixa 12–24px já usada no design system).
- Tipografia: família única Montserrat (`var(--font-sans)`) para **todo** o texto da tela, incluindo dados de tabela (pedido explícito do usuário) — tamanhos entre `0.76rem` (badges/legendas) e `2.1rem` (valor de KPI).
- Transições: `var(--transition-fast)`.

## Assets
- Ícones: Bootstrap Icons 1.11.3 (`bi-plus-lg`, `bi-pin-angle-fill`, `bi-hourglass-split`, `bi-check2-circle`, `bi-calendar-event`, `bi-eye-fill`, `bi-box-arrow-up-right`, `bi-star-fill`/`bi-star`, `bi-person-fill`, `bi-arrow-down-up`, `bi-file-earmark-excel`, `bi-file-earmark-pdf`) — já usados no GECOPE real, nenhum ícone novo.
- Nenhuma imagem/foto usada nesta tela.

## Files
- `Processo - Novas Opções.dc.html` — arquivo de referência completo. **Implementar apenas a seção `id="t2"` (opção `2a`)**; a seção `id="t1"` (opções `1a`–`1d`) é histórico de exploração descartado, incluído só para contexto caso ajude a entender o processo de decisão.
