# E3 — painel lateral e KPIs · revisão

Encerrada em 2026-09-15 com **4/4 `APROVADO`**, sem escalada.

## Vereditos

| Revisor | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-correcao` | BLOQUEADO | APROVADO |
| `rev-design` | APROVADO | APROVADO (só o delta) |
| `rev-produto` | APROVADO | — |
| `rev-aderencia` | APROVADO | APROVADO (só o delta) |

## O que a etapa entrega

O painel do modo Replanilhamentos deixou de ser a lista provisória da E1:

- **Quatro KPIs** — fila da Fiscalização, tempo médio de resposta, despachados no período e
  valor das obras na fila —, cada um com uma terceira linha de contexto: a média nunca
  aparece sem o tamanho da amostra, nem a contagem sem a janela de tempo.
- **Bloco "Também neste recorte"** — na GECOPE, fiscais com processo aqui, despachados no
  histórico — em peso tipográfico menor, mais a nota metodológica da régua.
- **Ranking navegável** pela métrica ativa: os 11 distritos no nível de cima (na régua
  escolhida) ou as cidades do distrito aberto, ordenados pelo valor, com a amostra no
  subtítulo de cada linha e desempate por volume de processos e por nome.
- **Lista de processos** no nível da cidade, que era um beco: número, status, objeto,
  fiscal, dias na fila ou data de despacho, tempo no setor, e etiqueta âmbar quando o
  processo passou da meta. Limitada a 15, com a ordem e o total declarados.

## Achados e destino

**Rodada 1**
- KPI de valor exibia `R$ 0` quando a fila tinha obras mas nenhuma com valor conhecido —
  afirmava exposição zero onde o certo era "não sei" → guarda passou de `a.fila` para
  `a.obrasFila`, com um terceiro caso de texto. *(correção)*
- "16 de 34 além da meta" não nomeava o 34 (a fila com prazo definido), deixando os demais
  sem explicação ao lado da manchete → denominador nomeado. *(correção)*
- Cabeçalho do ranking trazia a métrica sem período nem régua, sendo a terceira superfície
  com os mesmos números → linha `.sec-sub` com `rpRecorteTxt()`, a mesma frase da legenda
  do mapa e do popover da trilha. *(correção)*
- Menores aplicados: `rpRanking()` passou a ler `_rpGrp`/`_rpMun` em vez de reagregar (não
  só mais barato no hover — torna impossível a lista divergir do mapa); `.kpis-rp`
  removida por ser declaração morta; `.proc-o` deixa de render uma linha só com travessão;
  a lista de processos declara a própria ordem. *(aderência, design, produto)*

## Dívida conhecida, levada adiante

- No período "Tudo", "Despachados" e "Despachados no histórico" exibem o mesmo número sob
  rótulos diferentes. Redundante, não ambíguo.
- Com seleção combinada (Ctrl+clique), o painel do modo novo não mostra os chips nomeando o
  que está selecionado nem o botão "Limpar seleção" que o modo Obras oferece. Vem da E1.
- No ranking, área sem média exibe "—" mas a barra ainda desenha o toco mínimo de 4%,
  herdado do modo Obras. Para a E8, junto com a valência da rampa.
- `-webkit-line-clamp` é a primeira aparição no repositório (cartão de processo); degrada
  para o objeto inteiro se não for reconhecido.
- `.sec-sub` (painel) e `.pop-sub` (popover da trilha) são duas classes quase idênticas para
  a mesma ideia; unificar esbarra no modelo de padding do popover. Para a faxina da E7/E8.
- `.kpis-rp` ficou sem regra própria depois da remoção da declaração morta; mantida como
  gancho semântico para a E8.

## Verificação prática

Mesma bancada da E2 (servidor local com base simulada, navegador dirigido): entrada no
modo, os três níveis, descida pelo ranking, troca de métrica no nível da cidade e volta
pela trilha. Sem erro de console. **Portão 2 — a validação do usuário contra a base real —
continua pendente para a E2 e para a E3.**

## Portão 2 — ajustes pedidos pelo usuário (2026-09-16)

Na primeira leitura do painel, o usuário redesenhou os KPIs e a seção de contexto. Não
passaram pelos revisores; verificados na bancada simulada, contas conferidas contra a base
bruta do servidor de teste.

- **Cards:** `Processos · Tempo médio · Despachos · Fiscais` (o card Valor saiu). A explicação
  foi para um botão "i" com janelinha (hover e foco); o cartão mostra só número e, quando é
  dado, uma linha curta.
- **Período:** rótulo `Período`; `Tudo` virou `Hoje`, primeiro botão. Em `Hoje`, Processos =
  com o fiscal agora (com atrasados · no prazo · sem prazo) e Fiscais = responsáveis por eles;
  Despachos e Tempo médio = histórico inteiro. Nas janelas, Processos = com o fiscal hoje +
  despachados no período — **leitura escolhida por mim**: perguntado entre essa e "chegaram
  no período", o usuário não escolheu. Trocar é mexer só em `aggProc`.
- **Atrasado** substitui "além da meta" (card e tag da lista de processos). Sem data de
  compromisso não é "no prazo": fica como "sem prazo".
- Métrica `Fila` do mapa virou `Processos`, com o mesmo número do card.
- **Também neste recorte:** só `Processos na GECOPE`, com uma linha por status (os cinco
  pedidos sempre; EM REANÁLISE, CONTRATANTE ou outro só quando existe). Saíram "Fiscais com
  processo aqui" (pessoas, não processos — confundia com a fila) e "Despachados no
  histórico" (é o card Despachos em `Hoje`).
- O quadrante de fiscais não coincide mais com o card Fiscais em `Hoje` (ele segue comparando
  o histórico); comentário de `aggFiscais` atualizado.
