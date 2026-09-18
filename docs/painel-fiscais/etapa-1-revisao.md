# E1 — infraestrutura do modo · revisão

Encerrada em 2026-09-15 por **decisão do usuário** ("seguir para a E2"), depois que
`rev-correcao` bloqueou duas vezes com achados novos e corretos a cada rodada. Não houve
terceira rodada; os achados da segunda foram corrigidos sem reconfirmação do revisor.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | BLOQUEADO → escalado |
| `rev-design` | BLOQUEADO | BLOQUEADO (chegou após a decisão) |
| `rev-produto` | BLOQUEADO | APROVADO |
| `rev-aderencia` | BLOQUEADO | BLOQUEADO (chegou após a decisão) |
| `rev-seguranca` | BLOQUEADO | APROVADO |

## Achados e destino

**Rodada 1**
- `data_despacho` caía em `arquivado_check_em`, que é heartbeat do `sincronizar-suite` →
  voltou a `coalesce(data_aprovacao_gecope, ultima_atualizacao::date)`. *(correção)*
- Rótulo do recorte ignorava `st.sel` e `st.hoverGroup` → `escopoReplanTxt()` espelha
  `scopeIds()`. *(correção)*
- `dias_na_fila` usava data de devolução fora de status de devolução → condicionado. *(correção)*
- `hidden` não escondia o `.seg` (display de autor vence o UA) → `.seg[hidden]{display:none}`
  genérica. *(design, aderência, segurança)*
- Classes `.sit-*` só existiam sob `#statLeg` → promovidas a `.statleg.cards`. *(design)*
- Falha no conjunto secundário acionava o overlay de tela cheia e falsificava o status de
  Obras → aviso contido `#modoAviso` + `reverterParaObras()`. *(produto, aderência)*
- Papel indeterminado escondia o seletor em silêncio → revela com sessão válida; o
  banco continua sendo o portão. *(produto)*

**Rodada 2**
- `meta_estourada` NULL colapsado em `false` → tri-estado preservado. *(correção)*
- Denominador da divergência por subtração dupla → `comAmbos` contado no laço. *(correção)*
- Valor na fila somado por processo → deduplicado por `codigo_obra`. *(correção)*
- `greatest(NULL,0)` = 0 no SQL → tratado. *(correção, ressalva)*
- Consulta de papel com e-mail sensível à caixa, `meu_papel()` não → `ilike`. *(segurança)*
- Especificidade: `:root:not(.theme-dark) .statleg` passou a vencer `.statleg.cards`
  (gap 9→10px em "Situação das obras", tema claro) → `:not(.cards)`. Medido de volta em 9px.
  *(aderência, design)*
- `_statusObras` congelado na entrada do modo → capturado em todo `setStatus` sem `replan`;
  `loadData()` devolve a linha de status ao modo em foco. *(aderência)*
- Conteúdo do modo começava a 1.346px do topo, sob KPIs de Obras → `aside.modo-replan`
  esconde os blocos estáticos; `setKPIs()` só roda em Obras. *(design)*
- Cartão de métrica sem hierarquia (12/12/12) → modificador `.metricas`
  (10,5px caixa-alta / 17px / 11px). *(design)*
- Menores aplicados: `render()` em `reverterParaObras()`; recuo do aviso amarrado a
  `.seg + .modo-aviso`.

## Dívida conhecida, levada adiante

- Falha de `loadData()` **dentro** do modo Replanilhamentos (troca de escopo) ainda cai no
  overlay de tela cheia. Aí a base de obras falhou de fato; `rev-aderencia` não tratou
  como bloqueador isolado.
- Sombras de `.statleg.cards .sit` no tema claro usam `rgba(20,40,33,…)` literal — para a E8.
- ~~A versão corrigida de `sql/create_vw_painel_desempenho_fiscais.sql` precisa ser
  reaplicada no banco pelo usuário.~~ Reaplicada pelo usuário em 2026-09-15.
