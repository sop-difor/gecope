# E8 — refino dos dois temas (painel de desempenho dos fiscais)

Data: 2026-09-18. Estado: **working tree, não commitado** (E5+E6+E7+E8).

## Como foi verificado

Pela primeira vez o painel foi visto renderizado, nos dois temas, sem depender de login em
produção: harness em Playwright que serve `gecope/` em `localhost:8765`, injeta uma sessão
Supabase falsa (admin) e intercepta `**/*supabase.co/**` devolvendo dados sintéticos
(405 processos, 60 fiscais, 260 obras; **os números são inventados — só a forma importa**).
Cenas capturadas por tema: painel geral, ranking, cidade de um distrito, métrica Despachos,
janela de distrito, janela de fiscal aninhada, tooltip de KPI e volta ao modo Obras.
O harness fica no scratchpad da sessão, não no repositório.

## Decisão do usuário (2026-09-18)

Valência de cor: a métrica **Tempo médio** passa a usar rampa **âmbar**; Despachos e
Processos (contagens, sem juízo) continuam verdes. Motivo: verde lê como "bom" e, no tempo,
mais escuro/cheio é mais LENTO. Antes, as barras de distrito eram verdes e as de fiscal
laranja — dois códigos para a mesma métrica.

## O que mudou

| # | Mudança | Onde |
|---|---|---|
| 1 | Token `--map-warm` (alias de `--amber`, acompanha o tema). `TOKENS.mapWarm` lido pelo JS. | CSS `:root`, JS `readTokens` |
| 2 | Mapa: `rpPreenche` pinta em `mapWarm` quando `rpTempo()`; legenda ganha `.rp-leg-bar.warm`. | JS, CSS |
| 3 | Barras e valor do ranking de distritos/cidades em âmbar no tempo (`.rrow.warm .vv`, `.rbar.amber`), em `rankRows` e `rpRankRowsHtml`. Modo Obras intacto. | JS, CSS |
| 4 | Cartões de fiscal da janela de distrito: barra âmbar quando acima da média da equipe (mesma regra do ranking de fiscais do painel) + legenda na `sec-sub`. Antes: todas verdes. | JS `equipeCardsHtml` |
| 5 | Rótulos do mapa: contador com token `--lbl-count` (claro deixa de ter hex `#123024`/`#1C2B23` fixado; usa `--text-bright`). Em tempo, contador em `--text-brightest` (verde sobre âmbar brigava). | CSS |
| 6 | Escuro, só Replanilhamentos: rótulos de distrito sem o glow verde (halo triplo) — `body.modo-rp`. Obras não muda. | CSS |
| 7 | `render()` marca `body.modo-rp` (a classe `rp-warm` foi retirada no ajuste pós-E8: sem uso). | JS |
| 8 | `#btnScope` (Carteira ativa/Histórico) escondido no modo Replanilhamentos — nenhuma superfície do modo lê o conjunto de obras. | CSS |
| 9 | Dívida: `.sec-sub` / `.crumb-pop .pop-sub` deixaram de duplicar as 3 propriedades comuns. | CSS |
| 10 | Dívida: classe morta `kpis-rp` removida. | JS |

## Dívidas da lista que estavam obsoletas (não mexidas)

- `transition` morta em `.qd-pt` e ARIA do SVG do quadrante: o quadrante foi substituído
  pelo ranking em barras em 17/09; não há `.qd-pt` no CSS nem SVG de quadrante no JS.
- Ordem de `let` em `showDataError`: já corrigida (comentário do `rev-correcao` no código;
  a função lê o botão por `getElementById` na hora).

## Conhecido e deixado

- Dark: o piso da coroplética (`--choro-floor:.10`) faz áreas de valor baixo ficarem quase
  no tom do fundo quando há um outlier (Fortaleza em Despachos). Piso é global (lido de
  `:root`), então mexer nele altera o modo Obras. Fora do escopo do E8.
- (Revisto na rodada 2) Herói das janelas: a moldura agora segue o delta (âmbar = acima da
  referência); amostra fina é moldura tracejada neutra.

## Vereditos

**4/4 APROVADO em até 2 rodadas** (2026-09-18).

| Revisor | R1 | R2 |
|---|---|---|
| `rev-correcao` | APROVADO | — |
| `rev-aderencia` | APROVADO (4 obs.) | — |
| `rev-design` | BLOQUEADO (3) | APROVADO |
| `rev-produto` | BLOQUEADO (2) | APROVADO |

### Achados corrigidos na rodada 2

- **Âmbar invertia a valência em 3 lugares** (`rev-produto`, `rev-design`): ponto "você está
  aqui" era âmbar sempre (agora só se acima da referência: `.ed-dot.on.acima`); moldura do
  herói era verde mesmo para o distrito 1º mais lento (agora `.dsh-hero-acima`); amostra fina
  usava âmbar (agora marca neutra: moldura tracejada + texto `--text-dim`).
- **Três réguas para "acima da média"** (`rev-produto`): cartões de fiscal da janela de
  distrito comparavam com a média da equipe; agora com a do estado, como herói e ranking.
- **Contraste no escuro** (`rev-design`): topo da rampa âmbar dava 3,07:1 no rótulo; novo
  token `--warm-span` (escuro .45 → 4,64:1; claro .52 → 6,21:1). `--choro-span` do Obras intacto.
- **Peso do rótulo** escuro 700 × claro 500: escuro do modo passa a 600.
- Legenda do ranking de fiscais: "âmbar = acima do traço". `.sem-amostra` preservado.
  Comentários de CSS/JS ressincronizados.

### Observações aceitas / levadas ao usuário

- Claro do modo Obras: rótulos do mapa mudaram 4–10 unidades RGB ao trocar hex por token.
- **Decisão pendente (D1):** verde neon `--ng` (#2FE6A0) no escuro, nas janelas do modo; token global.
- Ranking de distritos/cidades é âmbar de gradação (decisão do usuário); sugestão futura de
  legenda "mais escuro = mais lento".
- Gráfico "Cada despacho" da janela do fiscal fica verde (neutro); rever só se confundir.
- "BASE ATUALIZADA EM —" no modo Replanilhamentos (pré-existente, sem data de carga dos processos).
- "SEM DADO" com contraste 3,58:1 (escuro) / 2,95:1 (claro): pré-existente, etapa própria.
- Piso da coroplética no escuro (global).
- **Portão 2 da E8 (validação logado em produção): pendente com o usuário.**
