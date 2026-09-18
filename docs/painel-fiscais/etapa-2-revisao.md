# E2 — mapa e período · revisão

Encerrada em 2026-09-15 com **4/4 `APROVADO`** em duas rodadas, sem escalada.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |
| `rev-design` | BLOQUEADO | APROVADO |
| `rev-produto` | APROVADO | — |
| `rev-aderencia` | APROVADO | APROVADO (só o delta das correções) |

## A decisão que a etapa implementa

A régua é **alternável** no nível dos distritos — "Equipe do fiscal" (padrão, `fiscal_gedop`) ou
"Local da obra" — e é sempre o local da obra do nível 2 (cidades) para baixo, porque cidade
não existe pela lotação do fiscal. Escolha do usuário em 2026-09-15, a partir do
`diagnostico-distrito-obra-x-fiscal.sql` executado na base real (resultado em
`resultados_sql/`): pela régua da obra, Sobral aparece 17 dias mais lento e Quixeramobim 16
dias mais lento do que suas equipes são, porque a equipe de Fortaleza despacha 97 processos
contra as 65 obras da RM Fortaleza — ela atende Aracoiaba, Itapipoca e Tauá.

## Achados e destino

**Rodada 1**
- `semValorFila` contava PROCESSOS ao lado de `obrasFila`, que conta OBRAS, na mesma frase →
  as duas passaram a contar obras, com um `Set` só; processo sem `codigo_obra` conta como
  uma obra. *(correção)*
- A lista de irmãos da trilha ("Outros distritos") ignorava a régua: mapa mostrava Crateús
  com 12 despachos e a lista, 10 → `procsDoDistrito()` passou a ler `st.rp.regua` direto (a
  régua vale para a entidade distrito em qualquer nível); `reguaEquipe()` ficou respondendo
  só pelo mapa. *(correção)*
- Mesma lista: única superfície com média sem o tamanho da amostra → `rpEntrada()` leva
  "40 desp." no subtítulo da linha, e o popover ganhou "métrica · período · régua"
  (`rpRecorteTxt()`, compartilhada com a legenda). *(correção)*
- No tema claro o cinza de amostra insuficiente tinha a luminância do piso da escala verde
  (contraste 1,03): "sem número comparável" e "menor valor do mapa" viravam a mesma mancha →
  contorno cinza **tracejado** como canal principal, por classe CSS (`path.sem-amostra`), não
  por `dashArray` de `setStyle`, que ficaria preso ao voltar para Obras. Medido depois:
  contraste 2,84 (escuro) e 3,20 (claro) do traço contra a divisa normal. *(design)*
- Menores aplicados: legenda em `z-index:601` (acima do painel de markers do Leaflet) com
  `.ctrl` em 610; hierarquia tipográfica da legenda desinvertida (título 11px, subtítulo
  10px); contador do rótulo fora da escala em `--nomatch-label` sem apagar o nome da área;
  "posição de hoje" sempre visível na linha da fila; nota dizendo que busca e filtros de
  obras ficam guardados. *(design, produto)*

**Refinamento próprio, na mesma rodada:** quando NENHUMA área tem amostra suficiente
(comum no nível das cidades), ninguém é tracejado — `_rpTemEscala`. Marcar todas como
exceção não distingue nada, e a legenda já troca a rampa pela frase.

## Verificação prática

Sem acesso ao banco de produção nesta sessão, a etapa foi dirigida num navegador sobre um
servidor local com ~350 processos simulados na mesma distribuição do diagnóstico: troca de
modo, as três métricas, os quatro períodos, as duas réguas, entrada em distrito, lista de
irmãos, troca de tema e volta para Obras. Sem erro de console, e os rótulos do modo Obras
voltam idênticos aos de antes da ida.

**Isto não substitui o Portão 2** — a validação visual do usuário, contra a base real,
continua pendente.

## Correção fora de escopo, incorporada

`main` usava `height:calc(100% - 59px)` com um cabeçalho de ~83px, e a linha implícita do
grid era inflada pelo painel lateral: o rodapé do mapa ficava fora da janela e cortava o
controle de zoom do Leaflet (e cortaria a legenda nova). Agora `body` é coluna flex e `main`
tem `flex:1;min-height:0;grid-template-rows:minmax(0,1fr)`.

## Dívida conhecida, levada adiante

- `#btnScope` ("Carteira ativa / Histórico completo") continua ativo no modo
  Replanilhamentos, onde zera a navegação (`goState()`) sem mudar número nenhum. Vem da E1.
- A rampa verde significa "mais é melhor" em Despachos e "mais é pior" em Tempo e Fila; sem
  codificação de valência. Para a E8.
- `showDataError` chama `setStatus`, que toca `let` declarados depois — no caminho de falha
  do GeoJSON isso lançaria `ReferenceError` por TDZ. Pré-existente (etapa A/E1), só mascara
  a mensagem de erro de rede.
- `color-mix()` é a primeira aparição da função no repositório (legenda).
- Numa área tracejada, o realce de hover muda só a espessura da borda, não a cor: a regra
  CSS do traço vence o atributo que o Leaflet escreve. Para a E8.

## Conferência dos períodos contra a base real (2026-09-16)

O usuário notou que o tempo médio quase não muda entre períodos. Consulta 2 de
`diagnostico-periodos.sql` (despachos por mês) respondeu: **está correto**.

- O primeiro despacho é de **2025-01**. "2 anos" é idêntico a "Hoje" até 2027-01, e "1 ano"
  cobre 242 dos 331 despachos (73%).
- A média mensal está estável em ~52–60 dias desde 2025-09. Tirar os meses antigos (média
  ~39 dias, 76 despachos) move o estado só de **49,2** (Hoje, igual ao print) para ~52 (1
  ano) e ~55 (6 meses).
- Datas: 94% vêm de `data_aprovacao_gecope`. Os 28 casos de `ultima_atualizacao` estão todos
  entre 2026-05 e 2026-09, espalhados, sem pico de gravação em lote.
- Leitura escondida pelas janelas acumuladas: o tempo médio **subiu** de ~30 dias (1º sem.
  2025) para ~60 (2026). Só uma série mensal mostraria isso.
