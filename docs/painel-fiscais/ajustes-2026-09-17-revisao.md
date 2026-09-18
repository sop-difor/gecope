# Ajustes de 2026-09-17 ao painel (Portão 2 de E2–E4) — revisão

Não é uma etapa nova: são 5 ajustes que o usuário pediu por cima do que já tinha Portão 1
aprovado em E2/E3/E4 (cabeçalho, subtítulo, textos do "i", seção GECOPE × Fiscalização com
donut, e troca do quadrante despachos × tempo por um ranking em barra). Revisados pelos 4
revisores fixos (`docs/painel-fiscais/revisores.md`), em paralelo, cada um sem contexto da
implementação.

| Revisor | Veredito |
|---|---|
| `rev-correcao` | BLOQUEADO → corrigido |
| `rev-design` | BLOQUEADO → corrigido |
| `rev-produto` | APROVADO |
| `rev-aderencia` | APROVADO |

## Achados bloqueantes, corrigidos

- **`rev-correcao`** — o subtítulo do escopo (`renderPanelReplan`, `scope.innerHTML`)
  continuava com o prefixo fixo `"Replanilhamentos — "` na frente do texto novo do item
  1.2. O pedido do usuário era o texto ficar só `"Ceará . Todos os Distritos
  Operacionais"` — "Replanilhamentos" já aparece sozinho no cabeçalho (item 1.1), e repetir
  a palavra ali era a mesma poluição que as outras 4 correções da rodada estavam tirando.
  Corrigido: `scope.innerHTML` não concatena mais o prefixo.
- **`rev-design`** — o anel (donut) de Atrasado/No prazo/Sem prazo, dentro do card
  Fiscalização da nova seção GECOPE × Fiscalização, não cabia ao lado da legenda na coluna
  real do painel (~169px de conteúdo — o aside fica fixo em 440px totais sempre que a
  viewport tem ≥860px, e o `@media (max-width:420px)` adicionado reage à largura da
  VIEWPORT, não à da coluna, então nunca disparava nesse cenário). Corrigido: o donut
  agora empilha sempre (anel em cima, legenda embaixo, incondicional — não depende mais do
  media query), e o tamanho caiu de 118 para 84px. Aplicado também o ajuste não-bloqueante
  sugerido pelo mesmo revisor: `margin-bottom` entre as linhas do ranking de fiscais
  (`.qdf`), que estavam coladas sem a respiração que o resto do painel usa.

## Confirmado correto (rev-correcao, verificado linha a linha contra as views SQL)

`filaPorStatus` fecha com `a.fila`; `naFila`/`despachado`/`foraDoCiclo` são mutuamente
exclusivos por construção (`situacao` na view só tem um "else"); `baseGxF = naGecope+fila`
é a base certa para os percentuais de GECOPE × Fiscalização; o donut soma exatamente
`a.fila` (`metaEst + noPrazo + semPrazo`, algebricamente); o ranking de fiscais não deixou
resíduo do quadrante antigo (`mediana`/`escalaTopo`/`rpQuadrante`/`quadSvg`/`quadLista`/
`quadAtencao` — zero ocorrências); `tempoMedio` nunca é negativo (garantido pela view); o
subtexto removido do card PROCESSOS (procSub fora de "Hoje") não perdeu dado — o mesmo
número (`a.fila`) reaparece, mais visível, no total "Fiscalização" da nova seção.

## Observações não-bloqueantes registradas (não corrigidas nesta rodada)

- `fmtPct1` usa 1 casa decimal; o exemplo do usuário ("17,80%") tinha 2 — provavelmente só
  ilustrativo.
- O donut tem 3 fatias (Atrasado/No prazo/Sem prazo), não 2 como o pedido literal — decisão
  de dado deliberada (não colapsar "sem data de compromisso" dentro de "no prazo").
- Título da seção usa "—"/"×"/title case; o usuário escreveu "GECOPE X FISCALIZAÇÃO" em
  caixa alta — escolha tipográfica, não corrigida sem o usuário confirmar se importa.
- `rev-produto`: o donut não tem legenda textual explícita dizendo que é só sobre os 60 da
  Fiscalização (fica implícito pelo aninhamento visual) — sugestão de caption de uma linha,
  não aplicada.
- `rev-produto`: o ranking em barra perde a comparação visual simultânea tempo×volume que o
  quadrante dava de relance (despachos/fila continuam na tela, mas não plotados) — perda
  assumida conscientemente pelo pedido do usuário de simplificar.
- Gap pré-existente (não desta rodada): `situacao='arquivado_no_tramite'` entra em
  `a.total` mas não tem linha própria em "Conferência da carga".

## Estado

Working tree (não commitado). Falta a validação visual do usuário (Portão 2) — nenhum
destes 4 revisores viu a tela renderizada de verdade, só o código.
