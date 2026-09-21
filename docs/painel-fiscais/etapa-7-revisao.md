# E7 — fonte única com a tela de Processos · revisão

Encerrada em 2026-09-18 com **4/4 `APROVADO`**, em até duas rodadas. `rev-seguranca`,
convocado especificamente para esta etapa (mudança de audiência de tela existente),
aprovou já na rodada 1.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |
| `rev-produto` | BLOQUEADO | APROVADO |
| `rev-aderencia` | BLOQUEADO | APROVADO |
| `rev-seguranca` | APROVADO | — |

## Origem e escopo

Decisão da E1 (2026-09-15): a quebra por Distrito Operacional/fiscal da tela de
Processos (`modules/processos/processos.js`, `abrirBreakdownFiscal`, acionada pelos 4
cards de KPI de `index.html`) passa a ler de `vw_painel_desempenho_fiscais` — a mesma
fonte do painel do mapa — em vez dos campos brutos `processos.distrito_operacional`/
`processos.fiscal`. Antes de implementar, uma ambiguidade real foi levada ao usuário:
substituir a fonte inteira (perdendo a busca/aba/meta/prioritário que a tela já filtra)
ou só corrigir o VALOR de distrito/fiscal por processo, mantendo o CONJUNTO já filtrado.
O usuário escolheu a segunda opção — é o que a etapa entrega.

## O que a etapa entrega

`abrirBreakdownFiscal` ficou assíncrona: mantém `window.currentVisibleRows` (já filtrado
pela tela) como base, e busca na view, por `id`, o distrito da obra (`obra_distrito_operacional`,
com fallback para `contratos_edificacao`) e o fiscal que responde pelo processo
(`fiscal_nome`, considera troca de fiscal). Acesso: a view é restrita a admin/gerente
(RLS fail-closed); o clique nos 4 cards some para os papéis `fiscal` e `externo`
(`.fiscal-no-breakdown`, tratado em `core/auth.js`) — o NÚMERO do card continua visível
pra todo mundo, só a quebra nominal por trás do clique é que é restrita. Rede de
segurança: se outro papel sem acesso ainda chegar lá, a consulta some avisando
"Você não tem acesso", nunca mostra dado errado.

## Achados e destino

### Rodada 1
- **`rev-aderencia` (BLOQUEADO)** — race condition: a função ficou assíncrona sem
  guarda de staleness; um clique rápido em dois cards diferentes podia deixar o modal
  com o título de um e o conteúdo de outro (resposta mais lenta sobrescrevendo a mais
  recente). *(correção: id de requisição, `_breakdownReqId`, checado depois de cada
  `await`)*
- **`rev-produto` (BLOQUEADO)** — o modal (fonte nova, "quem despachou") e a tabela
  principal da mesma aba (fonte antiga, fiscal atual) podiam mostrar pessoas diferentes
  pro mesmo processo, sem nenhuma explicação — lido como bug por quem tem acesso.
  *(correção: nota fixa no modal explicando a divergência)*
- **`rev-correcao` (BLOQUEADO)**, dois achados ligados à mesma causa (a tela filtra
  exclusão por texto de status; a view filtra por `excluido_por` — colunas diferentes,
  podem discordar num legado raro):
  - processo sem linha correspondente na view mantinha o valor ANTIGO em silêncio,
    misturado com valores novos na mesma lista. *(correção: bucket "não confirmado")*
  - recorte inteiro cair nesse legado gerava falso "sem acesso" pra quem tem acesso
    pleno. *(correção: sonda sem filtro de id, decide entre os dois casos)*
- **`rev-seguranca` (APROVADO)** — confirmou defesa em profundidade real (UX +
  RLS/`security_invoker`), que a E7 não amplia o vazamento pré-existente da tabela
  principal (mais amplo que a própria view, e fora de escopo desta porta), e que erro
  de rede nunca é confundido com "sem acesso". Sugeriu, não-bloqueante, estender a
  restrição de clique ao papel `externo` — aplicado de imediato.

### Rodada 2
- **`rev-aderencia` (APROVADO)** — confirmou que todo ponto de retomada pós-`await`
  tem a guarda, inclusive a sonda nova; `titleEl` não precisava de guarda (escrito
  antes de qualquer `await`).
- **`rev-produto` (APROVADO)** — confirmou que a nota nomeia causa e efeito da
  divergência, bem posicionada; os rótulos "não confirmado" comunicam "não sabemos"
  sem soar como erro; o "Carregando…" cobre o caminho longo (consulta + sonda).
- **`rev-correcao` (APROVADO)** — confirmou os dois cenários resolvidos e que o bucket
  "não confirmado" não colide com os sentinelas de vazio já existentes. Observação
  não-bloqueante: erro de rede na própria sonda caía na mensagem de "sem acesso" —
  corrigido de imediato (mensagem de erro genérica, distinta).

## Verificação prática

Só revisão de código. Portão 2 desta etapa continua pendente.

## Estado

Working tree, não commitado (E5 + E6 + E7 juntas).
