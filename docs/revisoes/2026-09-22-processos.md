# Revisão do módulo Processos — 22/09/2026

**Motivo:** processos aparecendo com status `AGUAR. ANÁLISE` enquanto o SUITE mostra o
processo na GEFOE. A divergência levantou a suspeita de que o módulo Processos precisava de
uma varredura completa, não de um conserto pontual.

**Ramo:** `revisao/processos-2026-09-22`

---

## 1. O que foi revisado

**Dentro do alcance:**

- `modules/processos/processos.js` (3.606 linhas antes da revisão)
- O markup e os modais de Processos em `index.html`
- As políticas de acesso (RLS) da tabela `processos`
- As fronteiras de integração: o que `contratos.js`, `financeiro.js`, `curva_abc_processo.js`,
  `relatorio.js`, `core/shell.js`, `cronograma.html` e `assets/js/mapa-obras.js` consomem do
  contrato de dados de Processos
- O job `sincronizar-suite`, por ser quem grava o status automaticamente

**Regra de alcance acordada:** editar arquivos de outros módulos **apenas** quando o erro
nasceu no contrato de dados de Processos. Todo o resto vira achado registrado, não correção.
Um único caso se enquadrou (`shared/multiselect.js`, seção 3.6).

**Fora do alcance por decisão** — ver seção 4.

---

## 2. O que foi encontrado

### 2.1 A divergência AGUAR. ANÁLISE × GEFOE: uma regra que não existe

O job `sincronizar-suite` tem cinco regras de transição de status. Uma delas **entra** em
`AGUAR. ANÁLISE`:

```
status = 'ANÁLISE FISCAL'  E  sem analista designado  E  SUITE = 'GECOPE'  ->  'AGUAR. ANÁLISE'
```

**Nenhuma regra sai dela.** O job atualiza `processos.suite` a cada rodada, sem condição
nenhuma — então quando o processo tramita para a GEFOE, a coluna passa a mostrar `GEFOE`
corretamente. Mas o status continua `AGUAR. ANÁLISE` para sempre, porque não existe regra que
case com `(AGUAR. ANÁLISE, suite ≠ GECOPE)`.

Isso não é atraso de sincronização: **é um estado estável e errado**. Rodar o job de novo não
corrige.

Três fatores agravam:

1. **A edição manual grava o status e nunca grava a localização.** O objeto de atualização em
   `executarAcaoDetalhes` tem mais de 20 campos e nenhum deles é `suite`. Trocar o status pela
   tela cria a divergência na hora.
2. **O detector de divergência é unidirecional.** O selo "Tramitado" só acusa o caso inverso
   (status diz fiscalização, SUITE diz GECOPE). O caso desta revisão não acende luz nenhuma.
3. **O painel de desempenho deduz a localização só do texto do status**, sem consultar
   `processos.suite` — por isso afirmava GECOPE enquanto o processo estava na GEFOE.

**Confirmação contra o código real:** a versão da `sincronizar-suite` que estava no
repositório era de 06/08/2026 e divergia da publicada. A versão real foi baixada em 22/09/2026
e conferida: **as cinco regras são idênticas**. O diagnóstico vale para o que roda em
produção, não para uma cópia velha.

### 2.2 Um fiscal pode não enxergar processos que são dele

A matrícula do fiscal era comparada de **três jeitos diferentes** no sistema:

| Onde | Como comparava |
|---|---|
| Política `processos_select` (banco) | texto puro, sem normalizar |
| Filtro do navegador | `.trim().toUpperCase()` |
| `normalizarMatriculaFiscal` (o helper canônico) | descarta `.` `-` `/` e espaços |

Se o processo foi gravado com `700.248-10` e o cadastro do fiscal tem `70024810`, **o banco
não entrega a linha**. O processo some da tela do próprio fiscal, sem erro e sem aviso.

A auditoria inicial atribuiu o sumiço ao filtro do navegador. Está incompleto: a causa
primeira é a RLS. Consertar só o navegador não resolveria nada, porque a linha nunca chega até
ele.

Além disso, o casamento por nome do navegador era frouxo nos dois sentidos: um fiscal chamado
"ANA SOUSA LIMA" enxergava tudo que era de "ANA SOUSA".

### 2.3 O botão EXCLUIR aparecia para quem não podia excluir

`executarAcaoDetalhes('delete')` não checava papel nenhum. A única barreira era a classe CSS
`.admin-only` no botão — e `abrirDetalhes()` **reabilitava o botão para todo mundo** que
conseguisse abrir o modal, desfazendo a intenção do HTML. Quem não tinha permissão chegava ao
botão, clicava e levava um erro do banco na cara.

Pior: a regra da tela (só administrador) e a do banco (administrador **e** gerente, porque a
exclusão é um `UPDATE` de status) discordavam entre si.

### 2.4 A falha de escrita indevida já estava fechada

Havia dúvida se o script `fix_processos_rw_authenticated_leftover.sql` (achado de 18/09) tinha
sido aplicado. Foi rodado de novo em 22/09: o bloco de verificação voltou vazio, ou seja, a
política indevida já não existia. Restam exatamente as quatro políticas esperadas. O script foi
movido para `sql/_aplicados/`.

### 2.5 Erros que travavam o salvamento

- **Três chamadas a `.toISOString()` sobre valor nulo.** `isoParaDate` e `calcularDataMeta`
  devolvem `null` quando a data não é reconhecida, e o resultado era usado direto. Bastava uma
  data inválida no registro para o salvamento estourar no meio, com o botão já em
  "SALVANDO..." e nenhuma mensagem ao usuário.
- **`el.focus()` executado justamente no ramo em que o elemento não existe** — trocava um aviso
  legível ("o campo X é obrigatório") por um erro de script.
- **Quatro `await` sem proteção** (exclusão, atualização, comentário de alerta, detalhamento por
  fiscal): falha de rede deixava botão preso em "SALVANDO..." ou modal parado em "Carregando…",
  para sempre.

### 2.6 Reentrância corrompendo o render

`atualizarBadgeAbaAprovados` podia chamar `updateReuniao()` — que remonta a tabela inteira — no
meio de um render em andamento. Quando isso acontecia, o laço externo continuava escrevendo a
coluna SUITE e os ícones de alerta em `<tr>` que já tinham sido descartados do DOM.

### 2.7 Peso e velocidade

- **`select('*')` sem paginação.** O PostgREST corta a resposta no `max-rows` do servidor
  (tipicamente 1.000 linhas) **sem erro nenhum**. O aplicativo simplesmente pararia de enxergar
  os processos mais antigos, em silêncio, quando a tabela passasse desse tamanho.
- **Varredura O(n²) de alertas.** A rotina de alerta era chamada uma vez por linha, e cada
  chamada varria `window.allData` inteiro — mais duas varreduras dentro dela. Cerca de 3n²
  varreduras por render.
- **`calcularDiasNoStatus` calculada por linha e descartada.** A célula de destino está vazia no
  HTML. Cada chamada normalizava acentos e alocava três objetos `Date`, tudo jogado fora.
- **`calcularDataMeta` calculada duas vezes por processo.** O código calculava para decidir se
  precisava recalcular, e recalculava com código idêntico copiado. Essa função percorre dias
  úteis consultando tabela de feriados.
- **Uma ida à rede por abertura do modal de meta**, só para descobrir um identificador que já
  estava carregado em memória (e era buscado localmente duas linhas abaixo).
- **`atualizarLinhaProcessoLocal` transformava erro de renderização em recarga total da tabela**
  — exatamente o consumo de dados que essa função existe para evitar.
- **Lista de fiscais montada e ordenada a cada render**, para ser descartada na maioria das vezes.

### 2.8 Falhas de gravação passando por sucesso

`Promise.all` sobre operações do supabase-js, que **resolvem com `{ error }` em vez de
rejeitar**. Uma recusa de permissão por linha era invisível: o código registrava "metas
automáticas salvas" e gravava o histórico como se tivesse funcionado. O comentário no próprio
código dizia estar se protegendo exatamente disso.

### 2.9 Injeção de conteúdo (XSS)

`processos.status` é texto livre no banco — sem lista de valores, sem restrição. Ele entrava
cru em `innerHTML` em seis pontos, num arquivo onde todo o resto usava `escapeHTML`: cabeçalho
de grupo, selo de status, título do modal de meta, duas mensagens de erro (que podem ecoar o
que o usuário digitou) e o rótulo das opções em `shared/multiselect.js`.

### 2.10 Chave de busca no DOM escapada indevidamente

As linhas da tabela são identificadas por `data-numero`. O navegador guarda o atributo já
**decodificado**, mas dois pontos do código re-escapavam o valor antes de procurar — então
qualquer NUP com `& < > " '` fazia a busca devolver nada, em silêncio. Um terceiro ponto fazia
certo, o que mostra que a divergência era acidental.

Relacionado: `escapeHTML` aplicado **antes** de remover os não-dígitos do NUP corrompia o link
do SUITE (o `'` virava `&#39;`, e o `39` sobrevivia à limpeza, entrando no meio do número).

### 2.11 Código morto e duplicado

- **`window.StatusSync` — 88 linhas.** Cópia cliente das mesmas cinco regras de transição de
  status do job, sem nenhum chamador em todo o repositório desde que o polling saiu do
  navegador. Regra de negócio duplicada só pode divergir com o tempo.
- **`debounce` e `parseMoneyInput`** duplicados de `utils.js`. Como `processos.js` é o último
  script carregado, **as cópias daqui venciam globalmente** — `core/shell.js`,
  `composicoes.js` e `orcamentos.js` usavam a versão do módulo Processos sem saber.
- **`mesclarDuplicatasPorAcento` e `colapsarVariantesFiscais`** — zero chamadores.
- **`statusFilterPriority`** — repasse puro para `statusPriority`, com um comentário que
  descrevia um comportamento que deixou de existir.
- **Nove `console.log` de depuração**, incluindo cinco que disparavam a cada chamada de uma
  função usada dentro de laços em `admin.js`.

### 2.12 A regra de cor do status implementada duas vezes

`classeBadgeStatus()` existe explicitamente para ser a fonte única (o comentário dela diz
isso), mas o laço de montagem da tabela tinha uma **cópia byte-a-byte** da mesma cascata — com
um detalhe divergente: o valor padrão era `"text-bg-light"` numa e `""` na outra.

### 2.13 Alarme falso da auditoria

A auditoria automática suspeitou que a expressão de remoção de acentos em
`normalizarNomeFiscal` estivesse corrompida pela má codificação do arquivo. **Foi testada e
funciona corretamente** (`ÁGABE` → `AGABE`). Registrado aqui para ninguém "consertar" o que não
está quebrado.

---

## 3. O que foi corrigido

Tudo em um commit no ramo `revisao/processos-2026-09-22`.

### 3.1 Vínculo do fiscal (achado 2.2)

**No navegador:** a matrícula normalizada virou a única chave de decisão; o casamento por nome
no sentido reverso saiu. E o mais importante: quando o vínculo é reconhecido por um caminho que
não a matrícula, **o processo aparece com um aviso visível** (⚠ ao lado do nome do fiscal,
explicando o que aconteceu) em vez de sumir calado. Sumir sem avisar era o pior dos dois mundos.

**No banco:** entregue como `sql/fix_vinculo_fiscal_matricula.sql`, para aplicação manual. Cria
`public.normalizar_matricula()` e acrescenta um segundo ramo à política `processos_select`. A
comparação crua continua sendo o primeiro ramo, para não perder o índice.

### 3.2 Permissão de exclusão (achado 2.3)

Criada `podeExcluirProcesso()` em `core/auth.js`, junto das outras permissões do módulo,
espelhando a regra do banco: **administrador e gerente**. `executarAcaoDetalhes` passou a
checá-la, `abrirDetalhes` parou de reabilitar o botão para todos, e a classe `.admin-only` saiu
do HTML (era mais restritiva que o banco e estava sendo desfeita pelo JS de qualquer forma).

Decisão de 22/09/2026: gerente pode excluir.

### 3.3 Erros que travavam o salvamento (achados 2.5 e 2.6)

Conversões de data verificadas antes do uso; `el.focus()` protegido; os quatro `await` ganharam
`try/catch` que devolve o botão ao estado normal e mostra a mensagem. A reentrância foi
resolvida com uma marca de "render em andamento": o pedido de remontagem que chega no meio de um
render é adiado para o tique seguinte.

### 3.4 Peso e velocidade (achado 2.7)

Paginação explícita em blocos na carga principal — a truncagem silenciosa do PostgREST era o
achado mais perigoso desta seção, porque não dá sintoma. A varredura de alertas caiu de ~3n²
para uma passada, com índice por processo em vez de busca linear. `calcularDataMeta` deixou de
ser calculada duas vezes. Uma ida à rede a menos por abertura do modal de meta. A lista de
fiscais deixou de ser montada a cada render. O `try` de `atualizarLinhaProcessoLocal` foi
estreitado para cobrir só a busca, não a renderização.

### 3.5 Falhas de gravação (achado 2.8)

Cada gravação passou a ser verificada individualmente. As falhas são contadas e relatadas, e o
histórico só registra o que de fato foi gravado.

### 3.6 Injeção de conteúdo (achado 2.9)

Os seis pontos passaram a escapar o conteúdo. Cinco em `processos.js`; o sexto em
`shared/multiselect.js` — corrigido ali por ser o único caso que se enquadrou na regra de
alcance (o dado que entra no rótulo vem de `processos.status`).

### 3.7 Chave de busca no DOM (achado 2.10)

O `querySelector` passou a usar `CSS.escape` (que é o correto, e fecha também a possibilidade de
injeção no seletor); a busca no índice passou a usar o valor cru. A ordem do link do SUITE foi
invertida: tira os não-dígitos primeiro.

### 3.8 Código morto e duplicação (achados 2.11 e 2.12)

Tudo removido, cada remoção com um comentário no lugar explicando o que saiu, por quê, e onde
encontrar o comportamento se ele voltar a ser necessário. A cascata duplicada de cor do status
foi substituída por uma chamada a `classeBadgeStatus()`, com o valor padrão explícito.

### 3.9 Organização do repositório

- A versão **real** da `sincronizar-suite`, baixada do servidor, substituiu a cópia
  desatualizada de 06/08/2026 — que já havia induzido a erro pelo menos duas análises
  anteriores. Ganhou um cabeçalho explicando a procedência e registrando o limite da seção 2.1.
- A `backfill-historico-suite` foi arquivada em `supabase/functions/backfill-historico-suite/`
  **antes** de ser removida do servidor, com um cabeçalho explicando por que saiu.
- `fix_processos_rw_authenticated_leftover.sql` foi movido para `sql/_aplicados/`.

---

## 4. O que ficou de fora, e por quê

Tudo nesta seção é **decisão consciente**, tomada em 22/09/2026, não esquecimento.

### 4.1 A regra de status que falta — a divergência AGUAR. ANÁLISE × GEFOE

**Decisão: não mexer.** Nem a regra nova no job, nem o alerta visual na tela.

Consequência, dita com todas as letras: **os processos vão continuar aparecendo em
`AGUAR. ANÁLISE` estando na GEFOE**, e novos casos vão continuar surgindo. O que mudou foi
apenas que o painel de desempenho parou de repetir a informação errada (seção 4.2).

Para retomar, o necessário está pronto: o diagnóstico na seção 2.1, e a versão real do job
guardada no repositório com o limite documentado no cabeçalho. A regra que falta teria a forma
`(AGUAR. ANÁLISE ou AGUAR. REANÁLISE) e suite ≠ GECOPE -> volta para o status de tramitação`.

### 4.2 Os dados já divergentes

**Decisão: não mexer.** Nenhum script de correção em massa, nenhuma alteração de status
histórico.

O script `sql/fix_painel_responsavel_atual_suite.sql` **lista** os processos divergentes (bloco
[4]) sem alterar nenhum. É leitura, não correção.

### 4.3 A acentuação corrompida do arquivo

**Decisão: deixar para uma correção separada.** O arquivo tem acentuação corrompida em
comentários e identificadores (`FUNÇÃO` → `FUNO`, `REUNIÃO` → `REUNIO`), incluindo um nome de
campo de formulário, `"DATA DEVOLUO CORREES"`, que está corrompido dos dois lados
(`processos.js` e `index.html`) e por isso funciona.

Motivo: um passe de codificação no meio de uma caça a erros polui o histórico a ponto de
impedir a revisão — não se distingue mais o conserto de verdade do acerto de acento. Deve ser
feito sozinho, em commit próprio, e aí é revisável.

### 4.4 A revisão completa das travas de permissão da tela

**Decisão: corrigir apenas o botão EXCLUIR.**

As travas de permissão do navegador são cosméticas: quem decide de verdade é a RLS, e ela está
correta. Revisar as oito travas do módulo seria organização, não segurança, e não deveria
competir com os erros de dado. Detalhado na seção 5.2.

### 4.5 A divisão do arquivo em partes menores

**Decisão: manter a estrutura.** O arquivo tem 3.665 linhas e se beneficiaria de ser dividido,
mas o projeto não tem testes automáticos que avisem se algo quebrar. Fazer a divisão junto com a
caça a erros é trocar um problema conhecido por três desconhecidos.

---

## 5. O que ainda falta

### 5.1 Aplicar os scripts SQL

Em ordem, com validação entre um e outro:

| Ordem | Script | O que faz | Quando |
|---|---|---|---|
| 1 | `sql/verificar_backfill_historico_suite.sql` | Prova que a `sincronizar-suite` cobre o backfill. Somente leitura. | Antes de remover a função do servidor |
| 2 | `sql/fix_vinculo_fiscal_matricula.sql` | Bloco [1] diagnostica; [2] e [3] corrigem a RLS | Depois de ver o resultado do [1] |
| 3 | `sql/fix_painel_responsavel_atual_suite.sql` | Faz o painel consultar a unidade do SUITE | Por último, depois de validar o resto |

### 5.2 Gerente pode excluir mas não pode editar

Efeito colateral da decisão 3.2, que merece uma decisão própria. Hoje o gerente abre o modal com
**todos os campos desabilitados** e o botão SALVAR escondido (ambos restritos a administrador no
navegador), mas agora enxerga e usa o botão EXCLUIR. O banco, por sua vez, autoriza o gerente a
fazer as duas coisas.

Ou seja: a restrição de edição no navegador é mais rígida que a do banco. Não foi alterada porque
a pergunta feita foi só sobre exclusão. **Decisão pendente:** gerente deve poder editar processos?

### 5.3 O filtro de EXCLUÍDO continua no navegador

A carga principal baixa também os processos excluídos, para descartá-los no navegador. Filtrar no
servidor economizaria transferência de dados, mas `not.in.(EXCLUÍDO,EXCLUIDO)` **também
descartaria as linhas com status nulo** — em SQL, `NOT (NULL IN (...))` não é verdadeiro —, o que
esconderia processos sem status preenchido.

Para resolver com segurança é preciso primeiro responder: **existem processos com `status` nulo no
banco?** Se não existirem, o filtro no servidor é seguro e imediato.

### 5.4 Três critérios diferentes de "excluído" convivendo

O navegador filtra por `status = 'EXCLUÍDO'`; as views SQL filtram por `excluido_por is null`; e
há dados legados com `data_exclusao` preenchida sem os outros dois. O job `sincronizar-suite` não
filtra nenhum dos três — consulta o SUITE também para processos excluídos, gastando chamadas de
rede à toa.

Achado já registrado antes desta revisão, em `docs/painel-fiscais/proposta-tempo-fiscal-suite.md`.
Continua valendo.

### 5.5 `processos.status` não tem lista de valores

Texto livre no banco: sem enum, sem restrição, sem validação. Consequências encontradas:

- O filtro de status da tela é montado a partir dos dados, então qualquer valor sujo que entre no
  banco vira opção de filtro automaticamente, sem alerta.
- O prompt do Assistente de Dados (`supabase/functions/gecope-assistant/schema_prompt.ts`) lista
  os status possíveis e **desconhece quatro que existem de verdade**: `AGUAR. ANÁLISE`,
  `AGUAR. REANÁLISE`, `DILIGÊNCIA` e `EM REANÁLISE`. Quem perguntar ao assistente "quantos
  processos estão aguardando análise?" recebe resposta calculada sobre um universo incompleto. O
  mesmo erro está em `docs/assistente/schema_dicionario.md`.
- As validações de status (recebimento obrigatório para `AGUAR. ANÁLISE`, entre outras) existem
  **só no navegador**, sem espelho no banco — e o job grava direto, ignorando todas elas.

### 5.6 Achados nos módulos vizinhos, registrados e não corrigidos

Fora do alcance pela regra combinada. Nenhum foi tocado.

- **`core/shell.js`:** o cartão da tela inicial exclui processos "aguardando" testando
  `s.includes("AGUARD")` — mas os valores reais são `AGUAR. ANÁLISE` e `AGUAR. REANÁLISE`, com
  ponto depois de `AGUAR`. A guarda é código morto. Hoje não causa erro visível, mas se alguém
  padronizar os status para "AGUARDANDO ANÁLISE" o comportamento muda em silêncio. O mesmo arquivo
  testa `CANCELADO`, status que não existe em lugar nenhum.
- **`cronograma.html`:** `AGUAR. REANÁLISE` vira tarefa na fila do cronograma, mas
  `AGUAR. ANÁLISE` é invisível para ele. Assimetria não documentada — o cabeçalho do próprio
  arquivo só menciona `DILIGÊNCIA` e `AGUAR. REANÁLISE`.
- **`assets/js/mapa-obras.js`:** a lista fixa de status "na GECOPE" não inclui `EM REANÁLISE`, que
  por isso cai no balde de "extras".
- **`modules/financeiro/financeiro.js`:** compara status por igualdade exata (`=== 'APROVADO'`),
  enquanto Processos compara por conteúdo (`includes`). O status legado `SEDUC` e qualquer variante
  de `APROVADO` somem do painel financeiro sem aviso.
- **`sql/assistente/f4_views.sql`:** define "em tramitação" sem `upper`/`trim`, ao contrário das
  outras views — quebra com variação de maiúsculas ou espaço sobrando.
- **`modules/processos/processos.js`:** `limparArquivosComentariosResolvidos` está definida aqui,
  mas seus únicos chamadores são `composicoes.js` e `orcamentos.js`. Pertence a `shared/`. Não foi
  movida para não mexer em dois módulos fora do alcance.

### 5.7 Remover a `backfill-historico-suite` do servidor

O código já está arquivado no repositório. Falta rodar o script de verificação (5.1, item 1) e,
com o resultado limpo, apagar a função no Supabase.

---

## 6. Como validar

Na tela, com a aplicação rodando:

1. **A lista de processos carrega inteira.** Confira o total na aba Ativos contra o que você
   esperava. Se a tabela tiver mais de 1.000 processos, esta é a validação mais importante da
   revisão — é o achado que não dava sintoma.
2. **Abrir um processo, alterar um campo e salvar.** O botão deve voltar de "SALVANDO..." ao
   normal e a mensagem de sucesso aparecer.
3. **Desligar a rede e tentar salvar.** O botão deve voltar ao normal com mensagem de erro — não
   ficar travado. (Era o comportamento anterior.)
4. **Entrar como gerente.** O botão EXCLUIR PROCESSO deve aparecer e funcionar.
5. **Entrar com um papel sem permissão de exclusão.** O botão não deve aparecer.
6. **Entrar como fiscal.** Conferir se a lista traz os processos esperados. Se algum aparecer com
   um triângulo laranja ⚠ ao lado do nome do fiscal, passe o mouse: a mensagem explica que o
   vínculo foi reconhecido pelo nome, não pela matrícula — é exatamente o caso que o script
   `fix_vinculo_fiscal_matricula.sql` resolve.
7. **Trocar o status de um processo pelo seletor.** A cor do selo deve continuar correta para
   todos os status (a regra de cor era duplicada e foi unificada).
8. **Abrir o modal de meta** de alguns processos, conferir que o histórico aparece.
9. **Clicar no indicador de Processos** para abrir o detalhamento por distrito/fiscal — deve
   carregar ou dar mensagem de erro, nunca ficar parado em "Carregando…".
10. **Aba Aprovados:** conferir que o contador de alerta de pré-diligência continua correto e que
    o filtro por alerta liga e desliga sem a tabela piscar ou embaralhar linhas.

Com o console do navegador aberto (F12), a tela deve ficar **limpa** durante o uso normal — os
`console.log` de depuração foram removidos. Mensagens que aparecerem agora são sinal real.
