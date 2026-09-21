# E5 — janelas de detalhe de distrito e de fiscal · revisão

Encerrada em 2026-09-18 com **4/4 `APROVADO`**, em três rodadas. A rodada 2 escalou pelo
protocolo — `rev-produto` bloqueou duas vezes seguidas pelo mesmo motivo —, e o usuário
autorizou a rodada 3.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 | Rodada 3 |
|---|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO | — |
| `rev-design` | APROVADO | — | — |
| `rev-produto` | BLOQUEADO | BLOQUEADO | APROVADO |
| `rev-aderencia` | BLOQUEADO | APROVADO | — |

## Origem da etapa

O código das duas janelas já existia no working tree (commit `ac4ccf0`, "Sincroniza
arquivos... 14-18/09") mas nunca tinha passado pelo protocolo de revisão. O gatilho para
submetê-lo foi um bug relatado pelo usuário: dentro da janela de distrito, clicar num
cartão de fiscal abria o painel daquela pessoa "por cima", mas fechar (✕) pulava direto
pro mapa — a janela de distrito de origem não tinha como ser recuperada.

## O que a etapa entrega

Duas janelas modais de leitura, reaproveitando o modal genérico `#modalBg`/`#modal` que a
ficha de obra já usa: a janela de um **distrito** (equipe do GEDOP) e a janela de um
**fiscal** individual. Entrada pelo ranking lateral do painel (distrito ou fiscal direto)
ou, dentro da janela de distrito, por um cartão de fiscal (`.fcard`).

A correção do bug relatado ficou como parte do escopo: a janela do fiscal troca o "✕" por
"← Voltar" quando é aberta por cima de uma janela de distrito — **nunca os dois botões
juntos** — e "Voltar" reabre a janela de distrito de origem em vez de fechar tudo.

## Achados e destino

### Rodada 1
- **`rev-produto` (BLOQUEADO)** — o botão "← Voltar" resolvia o clique no próprio botão,
  mas Esc e clicar fora do modal continuavam chamando `closeModal()` incondicionalmente,
  reabrindo exatamente o mesmo beco por dois dos três gestos de saída.
- **`rev-correcao` (BLOQUEADO)**, dois achados:
  - `coorteFiscais()` comparava o fiscal contra `aggFiscais(PROCESSOS)` — a base bruta
    nacional, sem excluir fiscais sem lotação válida nos 11 distritos (`semGedop`/
    `gedopSemDistrito`) — quando o próprio comentário da função prometia nunca discordar
    do ranking lateral. *(correção)*
  - Em `abreModalDistrito`, o ladrilho "Obras atendidas" contava a carga inteira da
    equipe, sem filtrar pelo período ativo — ao contrário dos três ladrilhos vizinhos e do
    ladrilho gêmeo da janela do fiscal. *(correção)*
- **`rev-aderencia` (BLOQUEADO)** — a matrícula do fiscal (`ref.fiscalMat`) saía sem
  `escHtml` num ponto, quebrando a convenção que as outras três aparições do mesmo dado já
  seguiam. *(correção)*
- **`rev-design` (APROVADO)** — sem achados: cor sempre de token, ritmo vertical e
  contraste corretos, listas longas com rolagem/corte tratados.

### Rodada 2
- **`rev-produto` (BLOQUEADO de novo)** — a correção da rodada 1 tratou só o clique fora
  do modal; o listener global de Esc continuava chamando `closeModal()` direto, sem passar
  pelo "Voltar". *(correção)*
- **`rev-correcao` (APROVADO)** — confirmou as duas correções por leitura de código: a
  nova `coorteFiscais()` usa textualmente a mesma expressão que popula o ranking lateral
  em régua de equipe (exclusão de fantasmas incluída), e o cálculo de obras do distrito
  ficou byte-a-byte igual ao padrão já usado em `fichaFiscal`.
- **`rev-aderencia` (APROVADO)** — confirmou o `escHtml` no ponto exato, e que a nova
  `coorteFiscais()` reusa `aggFiscais`/`groupsList`/`procsEquipeDistrito` (mesmo padrão de
  `coorteDistritos()`/`refEstadoPeriodo()`) em vez de reimplementar agregação.

### Rodada 3 (autorizada pelo usuário após a segunda escalada)
- **`rev-produto` (APROVADO)** — Esc agora passa por `fecharOuVoltar()`, igual ao clique
  fora. Confirmou também a guarda adicionada nessa mesma correção contra um efeito
  colateral que ela própria poderia ter introduzido: como `closeModal()` só esconde o
  modal (não limpa o `innerHTML`), um Esc apertado depois de o modal já estar fechado
  poderia clicar no "← Voltar" fantasma que sobra escondido no DOM e reabrir a janela por
  conta própria. A guarda (`if(!modalBg.classList.contains('show')) return;`, primeira
  linha de `fecharOuVoltar`) impede isso. Traçou os 6 cenários pedidos, todos corretos.

## Verificação prática

Só revisão de código, como nas rodadas anteriores — sem bancada com dados reais nem
produção. **Portão 2 continua pendente para E2, E3, E4, os ajustes de 17/09 e agora
também para a E5.**

## Dívida conhecida, levada adiante

- `rev-produto` (rodada 3) notou que, pela UI atual, talvez não exista nenhum caminho que
  dispare `closeModal()` enquanto a janela do fiscal-com-Voltar é o conteúdo ativo sem
  passar primeiro por `v.click()` — ou seja, a guarda contra reabertura fantasma pode ser
  hoje inalcançável na prática. Mantida como resguardo correto para qualquer caminho de
  fechamento futuro que não passe por um re-render explícito.
- `docs/painel-fiscais/` continua sem citação em `docs/MAPA-MODULOS.md` — lacuna aberta
  desde a E1, confirmada ainda aberta nesta etapa (achado não-bloqueante do `rev-aderencia`
  na rodada 1).
