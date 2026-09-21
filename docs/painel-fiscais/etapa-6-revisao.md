# E6 — filtros do modo Replanilhamentos · revisão

Encerrada em 2026-09-18 com **4/4 `APROVADO`**, em até três rodadas por revisor.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 | Rodada 3 |
|---|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO | — |
| `rev-design` | APROVADO | BLOQUEADO | APROVADO |
| `rev-produto` | BLOQUEADO | APROVADO | — |
| `rev-aderencia` | BLOQUEADO | APROVADO | — |

## Origem da etapa

Escopo definido pelo usuário em 2026-09-18, por não haver decisão prévia de grill:
busca por fiscal (nome/matrícula), filtro por Situação, filtro por Prazo, reaproveitando
a infra de multi-seleção que o modo Obras já usa (`FILTER_DEFS`/msel/chips).

## O que a etapa entrega

Dois filtros multi-seleção (Situação: Na fila / Na GECOPE / Despachado / Fora do ciclo —
Prazo: Atrasado / No prazo / Sem prazo) e busca por fiscal, no painel de controles do modo
Replanilhamentos. Estado próprio (`st.rp.filtro`), nunca `st.f` (que é de Obras e continua
guardado intacto na troca de modo). Filtragem centralizada em `filtraRp()`, chamada em todo
ponto de leitura de processo do modo (`procsDoDistrito`, `procsDeMuns`, as duas leituras de
`DB.municipios[id].processos` no nível de cidade) — mapa, ranking e KPIs nunca discordam
entre si. As janelas de detalhe da E5 (`abreModalDistrito`/`abreModalFiscal`) ficam de
propósito fora do filtro, mesmo princípio já usado pra régua/seleção/hover nelas.

## Achados e destino

### Rodada 1
- **`rev-correcao` e `rev-aderencia` (BLOQUEADO, mesmo achado)** — a categoria "Situação"
  fundia "na GECOPE" (`aggProc`'s `naGecope`, base do card GECOPE×Fiscalização) e "fora do
  ciclo" (`p.foraDoCiclo`, fora de todas as métricas) sob um único rótulo "Fora do ciclo".
  Marcar esse filtro devolvia processos que o resto do painel classifica como coisas
  opostas. *(correção: 4ª categoria "Na GECOPE", `get` passou a usar `p.foraDoCiclo`
  diretamente em vez de reinventar a partição por exclusão)*
- **`rev-produto` (BLOQUEADO)**, três achados:
  - Nenhuma superfície do painel avisava que os números eram um subconjunto filtrado.
    *(correção: sufixo "N de M processos com o filtro" na linha de escopo, via
    `resultsSuffixRp`/`procsDoRecorteRaw`)*
  - Mensagem de "vazio" não distinguia recorte genuinamente vazio de filtro sem resultado.
    *(correção: duas variantes de texto, condicionadas a `hasFiltroRp()`)*
  - As janelas de detalhe da E5 ignoram o filtro sem avisar na tela — lido como
    inconsistência de dados, não como escolha deliberada. *(correção: aviso
    `avisoFiltroRpHtml()`, reaproveitando a classe `.adv-scope-note` já existente, no
    topo do corpo das duas janelas)*
- **`rev-design` (APROVADO)** — sem achados na rodada 1: mecânica visual idêntica à de
  Obras, sem cor fora de token, decisão de não replicar o botão morto do rodapé (`#clearF`
  de Obras já vem `display:none` — a E6 só não repetiu esse botão redundante).

### Rodada 2
- **`rev-correcao` (APROVADO)** — confirmou a nova partição de 4 categorias batendo
  exatamente com `foraDoCiclo`/`aggProc`; apontou só um comentário desatualizado (dizia
  "3 opções cada"), corrigido de imediato, não-bloqueante.
- **`rev-produto` (APROVADO)** — confirmou os três achados resolvidos, sem beco novo.
- **`rev-aderencia` (APROVADO)** — confirmou a partição, e validou a arquitetura das
  funções novas (duplicação `*Raw` justificada e anotada, nenhum estado fora de `st`,
  escape correto de texto livre do usuário, reuso de `.adv-scope-note` sem CSS nova).
- **`rev-design` (BLOQUEADO)** — `.adv-scope-note` (o aviso novo) somava `margin-bottom:12px`
  próprio ao `gap:16px` do flex pai `.mbody.dsh`, dobrando o espaço antes do "hero" das
  janelas de detalhe (28px em vez de 16px). *(correção: `.modal .mbody.dsh
  .adv-scope-note{margin-bottom:0}`, mesmo padrão já usado para `.adp-wrap`)*

### Rodada 3
- **`rev-design` (APROVADO)** — confirmou o fix aditivo, sem efeito colateral no outro
  uso do componente (`.adp-wrap`, modal de obra).

## Verificação prática

Só revisão de código, como nas etapas anteriores. **Portão 2 desta etapa continua
pendente** — some ao Portão 2 já fechado para E2-E5 em `portao-2-fechamento.md`.

## Estado

Working tree, não commitado.
