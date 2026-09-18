# E4 — quadrante carga × tempo · revisão

Encerrada em 2026-09-16 com **4/4 `APROVADO`**, em três rodadas. A rodada 2 fechou
1 `APROVADO` / 3 `BLOQUEADO` com os três reincidentes, o que **escalou a etapa para o
usuário** pelo protocolo; ele autorizou a rodada 3 e decidiu a questão da régua.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 | Rodada 3 |
|---|---|---|---|
| `rev-correcao` | BLOQUEADO | BLOQUEADO | APROVADO |
| `rev-design` | BLOQUEADO | BLOQUEADO | APROVADO |
| `rev-produto` | BLOQUEADO | BLOQUEADO | APROVADO |
| `rev-aderencia` | APROVADO | APROVADO | — |

A rodada 2 foi revisada por revisores **frescos**: os da rodada 1 morreram com a sessão
anterior, que caiu logo depois de despachar o pedido de revisão. Eles leram a E4 inteira,
não só o delta — o que explica achados novos em vez da confirmação dos antigos.

## O que a etapa entrega hoje

Seção "Fiscais · carga × tempo" no painel do modo Replanilhamentos, **só no nível dos
distritos**: dispersão SVG (X = despachos no período, Y = média de dias no setor), com
ponto por fiscal a partir de 5 despachos com tempo medido, medianas tracejadas dos
plotados (a partir de 4 pontos), lista clicável de todos os plotados sincronizada com o
ponto (`st.rp.fiscal`), e rodapé com cobertura em volume e causas de exclusão.

## Achados da rodada 2

### Números (`rev-correcao`)

- **A frase de cobertura usa denominador próprio.** `despTot`/`filaTot` (`mapa-obras.js:2340`)
  somam sobre `lista`, que descarta processo sem matrícula (`:2310`) — mas o texto os
  apresenta como o total do recorte, ao lado de KPIs que contam tudo. Reproduzido em
  execução: "respondem por 24 dos 24 despachos" num recorte cuja manchete diz 26. A frase
  cuja única função é dizer quanto do recorte o gráfico cobre **afirma cobertura total onde
  ela não é total**. *(o `rev-produto` chegou ao mesmo defeito por outro caminho)*
- **As duas causas de exclusão são disjuntas, mas o texto encadeia como subconjunto:**
  "2 de 7 ficam de fora por despachar menos de 5 vezes. **2 deles** têm processos na fila…"
  — 3 + 2 não fecha com o "3 de 7" do cabeçalho. Mesmo defeito que a E3 corrigiu no
  "16 de 34 além da meta".
- **"sem fiscal identificado" é rótulo errado** (`:2436`): o fiscal tem nome, falta a
  matrícula. E a exclusão é por processo — um fiscal com parte dos processos sem matrícula
  entra no gráfico com despachos subcontados e média de amostra menor, sem aviso.
- Menores: "Os 1 do gráfico"; "0 das 0 posições da fila"; `total:a.total` (`:2319`) nunca lido.
- **Confirmado correto:** população do gráfico idêntica ao KPI "Fiscais com processo aqui";
  `pts + semDespacho + poucoTempo === nFiscais`; medianas sobre os plotados; nenhuma média
  sem amostra; eixos em zero; sem `NaN` nos degenerados.

### Produto (`rev-produto`)

- **Na régua "local da obra", o eixo X é uma fatia do trabalho da pessoa rotulada como o
  trabalho inteiro.** O guard `st.level>=2` (`:2427`) bane o nível de cidade porque lá o
  recorte é geográfico — mas no nível 1 com um distrito em foco e `regua==='obra'`,
  `procsDoDistrito` cai em `_procPorObra` e cada fiscal entra só com os despachos cujas
  obras estão naquele distrito. Nada na tela limita a leitura: eixo, `aria-label`, lista e
  rodapé dizem "despachos no período", absoluto. Numa tela que ordena gente nominalmente,
  é o achado que mais pesa. **É também o que depende de decisão do usuário.**
- **"carga" nomeia duas coisas no mesmo painel:** o X é vazão (despachos), mas o número que
  o painel chama de carga, acima, é a fila. O fiscal com fila grande e poucos despachos —
  o mais provavelmente sobrecarregado — plota no lado que o rótulo chama de menos carga.
- Denominadores do rodapé que não fecham com os KPIs *(mesmo achado do `rev-correcao`)*.
- **A frase que limita todas as conclusões fica abaixo de uma lista sem teto**, centenas de
  pixels abaixo do gráfico; a lista irmã (processos) corta em 15 e declara o total.

### Refino (`rev-design`) — medido em pixel, nos dois temas

- **Eixos e medianas abaixo do limiar de percepção:** `.qd-ax` a **1,29:1** (escuro) e
  **1,33:1** (claro); `.qd-med` a ~2:1. O gráfico não tem moldura: os números de escala
  ficam pendurados no vazio. `--card-border` é sempre borda *com fundo atrás* nas outras 28
  ocorrências do arquivo — aqui é a única coisa que define a forma. Falha nos **dois** temas,
  então não é a dívida do escuro v1 e não está coberta pela isenção até a E8.
- **A mediana é o número mais apagado do gráfico e o mais destacado da legenda** — os
  extremos de escala, que não informam nada, estão mais pesados que o valor que separa os
  quadrantes, e 9px abaixo a legenda imprime os mesmos dois números em `--text-bright`/700.
- **A seleção do ponto é mais fraca que o foco transitório e que a seleção da linha:**
  `.qd-pt.on` muda só opacidade e espessura (~16% de diâmetro externo), enquanto `.qdf.on`
  ganha fundo tingido e borda. Clicar na lista acende o ponto de leve — justamente o lado
  que o usuário precisa localizar no enxame. Com a valência de cor vetada, o canal livre é
  o raio, e ele não é usado.
- **Passa bem:** zero literal de cor no JS e no CSS da etapa (o portão duro desta etapa);
  `--ng` em vez da paleta `--map-*`, sem abrir segundo canal de cor de dado ao lado do mapa;
  âmbar uma única vez, com o sentido que já tem; teto de 420px confirmado a 375px de
  viewport; ritmo vertical da lista correto.

### Arquitetura (`rev-aderencia`) — `APROVADO`

Modo Obras intacto (`rpQuadranteHtml` só dentro de `renderPanelReplan`, atrás de
`modoReplan()`); zero cor fora de token; estado inteiro em `st.rp.fiscal`; `escHtml` cobrindo
inclusive atributos do SVG; `aggFiscais` **chama** `aggProc` em vez de reimplementá-la;
custo por `renderPanel` aceitável (a seção sai antes de agregar nos níveis 2 e 3, e o
redesenho vem de `mouseover`, não de `mousemove`). `MAPA-MODULOS.md` segue fiel.

Ressalvas dele para a fila: `role="img"` no `<svg>` torna a subárvore apresentacional, então
os `role="button"` dos círculos podem ser peso morto (o acesso equivalente existe na lista);
supressão assimétrica do rótulo de mediana (X testa topo e zero, Y só o topo);
`docs/painel-fiscais/` não é citado no `MAPA-MODULOS.md` — lacuna da E1.

## Verificação prática

Mesma bancada das etapas anteriores (servidor local com base simulada, navegador dirigido),
refeita nesta sessão sobre o código como está: entrada no modo, 32 pontos no período "Tudo",
seleção sincronizada entre ponto e linha nos dois sentidos, claro e escuro, sem erro de
console e sem requisição falhada. O `rev-design` deixou uma segunda bancada, que renderiza o
bloco sem depender do Supabase.

## Rodada 3 — o que mudou e o que ficou

Decisões do usuário em 2026-09-16: seguir para a rodada 3, e **a seção só existe na régua
"Equipe do fiscal"** (`if(!reguaEquipe()) return ''` — as duas exclusões, nível de cidade e
régua do local da obra, viraram o mesmo teste, pela mesma razão: comparar pessoa com pessoa
exige a carga inteira de cada uma, não uma fatia geográfica dela).

- **Denominadores viraram identidade de referência com os KPIs.** `rpQuadranteHtml(procs,a)`
  recebe o mesmo objeto `aggProc` que imprime as manchetes; `despTot`/`filaTot` deixaram de
  existir. Em 12 meses a frase passou a dizer que o gráfico cobre 30% dos despachos e 10% da
  fila — exatamente onde antes afirmava cobertura total.
- **A cobertura em volume subiu para logo abaixo do gráfico**, antes da lista; no rodapé ficou
  uma frase só de exclusão, que fecha com o cabeçalho (32 + 6 + 1 = 39).
- **"carga" saiu dos textos** (título, eixo e quadrante dizem "despachos"): carga, neste
  painel, é a fila — e o fiscal com fila grande e pouco despacho plota à esquerda.
- **Eixos e medianas passaram a existir:** 3,39:1 e 6,32:1 no claro, 3,12:1 e 6,93:1 no
  escuro, medidos contra o fundo pintado. O rótulo da mediana deixou de ser o texto mais
  apagado do gráfico (12,19:1 / 13,42:1).
- **Seleção do ponto pelo raio** (4,2 → 6,6: área 2,47×), o único canal livre com a valência
  de cor vetada; a lista ganhou rolagem própria a partir de 8 nomes, sem corte.
- Rótulo "sem fiscal identificado" → "sem matrícula de fiscal gravada" (a view faz
  `coalesce(full_name, fiscal, '(sem fiscal)')`: o processo chega mesmo com nome e sem
  matrícula); singular, fila zerada e fila = 1 tratados; `total:a.total` removido.
- Acabamento pedido nos vereditos de aprovação: `overscroll-behavior:contain` retirado da
  lista (prendia a roda do mouse por 328px logo acima do ranking, que é o controle de
  descida) e a deriva "carga × tempo" corrigida nos comentários do JS e do CSS.

### Dívida conhecida, levada adiante

- Fiscal com matrícula mas **sem lotação** não aparece em gráfico nenhum agora que a régua da
  obra não desenha a seção. Não some em silêncio — cai em "Fiscal sem lotação · fora da
  contagem pela equipe" na Conferência da carga —, mas é exclusão total onde antes era parcial.
- Recorte em que **todo** processo está sem matrícula passa o guard e imprime "0 de 0" com a
  mensagem de amostra insuficiente, quando o certo seria dizer que não há fiscal identificado.
  O rodapé explica logo abaixo. *(nuance de texto, não número errado)*
- `role="group"` no `<svg>` substituiu `role="img"` para que os pontos focáveis não fiquem numa
  subárvore apresentacional; a escolha definitiva de ARIA do gráfico fica para a E8.
- A `transition` de `.qd-pt` não anima o raio (atributo reescrito a cada render) — declaração
  morta, para a faxina da E8.
- `docs/painel-fiscais/` continua sem citação no `MAPA-MODULOS.md`; lacuna da E1.

**Portão 2 — a validação do usuário contra a base real — continua pendente para a E2, a E3 e
a E4.**
