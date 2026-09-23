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

Pior: a regra da tela (só administrador) e a do banco discordavam entre si. A do banco autoriza
administrador **e gerente**, porque a exclusão é um `UPDATE` de status — ver a seção 3.9 para a
regra exata e a 5.8 para o enredo da autorização especial `processos_gravar`, que faz parte dela
no papel, deixou de fazer no banco em 18/09 e voltou a fazer em 22/09.

### 2.4 A falha de escrita indevida já estava fechada

Havia dúvida se o script `fix_processos_rw_authenticated_leftover.sql` (achado de 18/09) tinha
sido aplicado. Foi rodado de novo em 22/09: o bloco de verificação voltou vazio, ou seja, a
política indevida já não existia. Restam exatamente as quatro políticas esperadas. O script foi
movido para `sql/_aplicados/`.

**O que só se viu depois:** esse mesmo script tem um segundo bloco, de desempenho, que recria
`processos_insert` e `processos_update` — e a definição que ele recriou é anterior à Fase 5, sem o
ramo da autorização especial `processos_gravar`. A política indevida saiu, e uma autorização
legítima saiu junto, sem ninguém notar. Ver 5.8.

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
espelhando a regra do banco. `executarAcaoDetalhes` passou a checá-la, `abrirDetalhes` parou de
reabilitar o botão para todos, e a classe `.admin-only` saiu do HTML (era mais restritiva que o
banco e estava sendo desfeita pelo JS de qualquer forma).

Decisão de 22/09/2026: gerente pode excluir.

**A regra final é a da seção 3.9**, não a desta seção. O caminho até ela passou por dois arquivos
de migração errados — `sql/rls_processos_composicoes_orcamentos.sql`, já substituído, e depois
`sql/autorizacoes_especiais.sql`, que o banco deixou de refletir em 18/09/2026 e voltou a
refletir em 22/09. A regra final inclui também a autorização especial `processos_gravar` — ver
3.9 e 5.8.

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

### 3.9 Gerente passa a editar processos (decisão de 22/09/2026)

A tela foi alinhada ao banco: `podeEditarProcesso()` e `podeExcluirProcesso()` em `core/auth.js`
passaram a ler de `podeGravarProcessos()`, que espelha a política `processos_update` do banco —
**admin, gerente, ou quem recebeu a autorização especial `processos_gravar`** (esta última
dependeu de restaurar a política; ver 5.8). `abrirDetalhes` libera os campos e exibe o botão SALVAR por essa regra, a classe `.admin-only`
saiu do botão no HTML, e `executarAcaoDetalhes('update')` ganhou a mesma guarda que o ramo
`delete` já tinha, para que quem não pode editar receba um aviso legível em vez de um erro do
banco.

A regra existia em quatro cópias literais espalhadas (duas em `core/auth.js`, uma inline no laço
de render de `processos.js`, e a que estava sendo criada) — agora todas leem da mesma fonte. Foi a
divergência entre elas que produziu os achados dos revisores.

O banco já contava com isso: o comentário do trigger `processos_restringir_prioridade_meta` fala
em não "quebrar o Salvar do Gerente". Nenhuma alteração de banco foi necessária.

**Atenção à fonte certa — e nenhum arquivo do `sql/` é essa fonte.** Esta seção foi escrita três
vezes, e as duas primeiras erraram por confiar no arquivo de migração em vez do banco:

1. citou `sql/rls_processos_composicoes_orcamentos.sql`, que já havia sido substituído;
2. citou `sql/autorizacoes_especiais.sql` (Fase 5) e concluiu que a autorização especial
   `processos_gravar` também grava — o que era verdade até 18/09/2026 e deixou de ser naquele dia,
   quando o script de egress `sql/_aplicados/fix_processos_rw_authenticated_leftover.sql` recriou
   `processos_insert` e `processos_update` a partir da definição anterior à Fase 5, apagando o ramo
   da autorização de carona com a remoção de uma política órfã.

A regra que `pg_policies` respondeu em 22/09 foi `(select public.meu_papel()) in
('admin','gerente')` — e a decisão foi restaurar a da Fase 5 por cima dela. O enredo inteiro, e o
que falta aplicar, estão na seção 5.8. Ver também
[2026-09-22-processos-vereditos.md](2026-09-22-processos-vereditos.md).

**Duas exceções continuam só-administrador**, porque é o trigger quem as impõe — a tela apenas
espelha, para não oferecer um campo cuja gravação o banco vai recusar:

- **Prioridade**: o trigger recusa qualquer mudança em `prioritario` vinda de não-admin. Já era
  respeitado (`canMarkProcessAsPriority`, e a estrela da tabela não é campo do formulário).
- **Meta Fiscal** (`det_data_compromisso`): o trigger recusa quando `data_compromisso_fiscal` é a
  **única** coluna alterada. O campo passou a ser travado (`readOnly`) para quem não é
  admin — sem isso, o gerente que mexesse só nesse campo levaria o erro do banco ao salvar.
  Quando a meta muda como efeito colateral de uma troca de status, o trigger deixa passar, e o
  salvamento do gerente funciona normalmente. O campo é `readOnly`, **nunca** `disabled`: campo
  desabilitado não entra no `FormData`, e o payload é montado a partir dele — a primeira versão
  usava `disabled` e apagava a meta a cada salvamento de gerente. A coluna também só entra no
  payload quando o usuário é admin. Ver o registro dos revisores.

**Não alterado, e vale como observação:** o botão NOVO PROCESSO (`modalCadastro`) continua
`.admin-only`, embora a política `processos_insert` também autorize gerente. A pergunta feita foi
sobre edição, não sobre cadastro.

### 3.10 Organização do repositório

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
| 1 | ~~`sql/verificar_backfill_historico_suite.sql`~~ | **Rodado em 22/09/2026, limpo** — ver 5.7 | ✔ feito |
| 2 | ~~`sql/fix_vinculo_fiscal_matricula.sql`~~ | **Pré-voo rodado em 22/09/2026; [2] e [3] NÃO aplicados** — ver abaixo | ✔ decidido |
| 3 | `sql/fix_painel_responsavel_atual_suite.sql` | Faz o painel consultar a unidade do SUITE | Pendente |
| 4 | `sql/restaurar_pode_gravar_processos.sql` | Devolve à política `processos_update` o ramo da autorização especial (ver 5.8) | Pendente — **antes de publicar a branch**, porque o lado do navegador já está commitado |

**O script 2 se autodesqualificou, e isso é um bom resultado.** Os blocos `[0]`, `[1]` e `[1b]`
são o pré-voo e não alteram nada. O `[1]` voltou **vazio**: não existe hoje um único processo
invisível para o fiscal dele por diferença de formato de matrícula — o defeito que o script
tolera não está acontecendo neste banco. O `[1b]` também voltou vazio (nenhuma colisão de
matrícula normalizada entre pessoas), o que tornaria a aplicação segura, mas segura e
**necessária** são coisas diferentes.

Decisão: **não aplicar**. Alargar a política de SELECT e criar um índice para tolerar uma
divergência inexistente tem custo e tem risco futuro — o `[1b]` é uma foto, não uma garantia:
uma matrícula cadastrada amanhã que colapse na chave de outra pessoa faria o ramo normalizado
entregar processos de um fiscal a outro, coisa que a comparação crua impede hoje. Se o sintoma
aparecer (fiscal reclamando de processo que não vê), o `[1]` é o diagnóstico para rodar de novo,
e a cura durável é a da seção 4.2 — normalizar na gravação —, não alargar a leitura.

O `[0]` confirmou, de quebra, o achado da seção 5.8 por um terceiro caminho: `processos_update`
é `meu_papel() in ('admin','gerente')`, sem `pode_gravar_processos()`.

O script ganhou um bloco `[1c]`, também só de leitura, para o caso que o `[1]` não enxerga:
processo cuja matrícula não bate com **cadastro nenhum**. Ele some da tela do fiscal pelo mesmo
motivo, e normalizar a comparação não resolveria — a correção seria no dado. Vale rodar junto do
`[1]` sempre que a pergunta "o fiscal está vendo tudo que é dele?" voltar. Ver
[2026-09-22-processos-vereditos.md](2026-09-22-processos-vereditos.md).

### 5.2 Gerente pode excluir mas não pode editar — RESOLVIDO em 22/09/2026

Era efeito colateral da decisão 3.2: o gerente passou a enxergar e usar o botão EXCLUIR, mas
continuava abrindo o modal com **todos os campos desabilitados** e o botão SALVAR escondido — a
tela mais rígida que o banco, que sempre autorizou o gerente a fazer as duas coisas.

**Decisão do usuário: sim, o gerente pode editar.** Ver seção 3.9.

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

### 5.7 Remover a `backfill-historico-suite` do servidor — LIBERADO em 22/09/2026

O script de verificação foi rodado e voltou **limpo nos quatro blocos**:

| Bloco | Resultado | Leitura |
|---|---|---|
| [1] panorama | 419 processos, 419 sincronizados, 419 com histórico, 0 nunca sincronizados | cobertura total |
| [2] **veredito** | **0 linhas** | nenhum processo sincronizado está sem histórico — não existe caso que só o backfill resolveria |
| [3] controle | 0 | coerente com o [1] |
| [4] sanidade | 0 linhas | nenhum evento duplicado: as duas funções compartilhavam mesmo a `chave_evento` |

**Falta apenas apagar a função no Supabase.** O código está arquivado em
`supabase/functions/backfill-historico-suite/`, com o cabeçalho explicando por que saiu — a
remoção no servidor não perde nada.

### 5.8 A autorização `processos_gravar` ficou inerte — RESOLVIDO em 22/09/2026

Achado tardio desta revisão, encontrado ao conferir em `pg_policies` qual política estava de fato
valendo (o hábito que a seção 3.9 passou a recomendar, depois de errar duas vezes por confiar no
arquivo de migração).

**Entre 18/09/2026 e a aplicação do script de restauração, quem recebe a caixa "Processos:
gravar/editar/excluir (igual Gerente)" em Administração não grava nada.** O script de egress
`sql/_aplicados/fix_processos_rw_authenticated_leftover.sql` removeu uma política órfã e, no bloco
secundário de desempenho, recriou `processos_insert` e `processos_update` a partir da definição
**anterior** à Fase 5 — o ramo `tenho_autorizacao('processos_gravar')` foi apagado junto, em
silêncio. `processos_select` escapou porque aquele script não o tocou, e por isso a autorização
irmã `processos_ver_todos` continua funcionando normalmente.

**Quem isso afetou: ninguém.** A consulta a `autorizacoes_especiais` mostrou uma única
autorização `processos_gravar` ativa, concedida em 08/09/2026 — e o papel de quem a tem é
**admin**, que já grava pelo papel. Ninguém perdeu acesso em 18/09 e ninguém ganha acesso com a
restauração. (Vale um comentário à parte: conceder a um admin uma autorização que ele já tem pelo
papel sugere que a tela de Administração não deixa isso claro na hora de conceder.)

**Decisão do usuário, 22/09/2026: restaurar a intenção da Fase 5.** O que se conserta não é o
acesso de alguém hoje, é a promessa da caixa para a próxima vez que ela for usada — uma caixa que
não faz nada é uma armadilha esperando o dia em que alguém contar com ela.

A alternativa, descartada, era remover a caixa de `index.html` e deixar o banco como estava:
coerente também, e mais simples, mas perde a granularidade de autorizar alguém a editar processos
sem promovê-lo a gerente.

**Como fica, e é um par que anda junto:**

| Lado | Estado |
|---|---|
| Banco | `sql/restaurar_pode_gravar_processos.sql` — **aplicação manual pendente** |
| Navegador | `podeGravarProcessos()` volta a somar `\|\| temAutorizacao('processos_gravar')` — **já commitado** |

**A ordem importa:** o lado do navegador está no código e o do banco não. Enquanto o script não
for aplicado, a tela fica mais permissiva que o banco — quem tiver a autorização veria SALVAR e
levaria erro ao clicar. Como a branch ainda não foi para produção, isso não afeta ninguém; mas
**o script precisa ser aplicado antes da publicação**.

`canSeeProcessActions()` passou a delegar para `podeGravarProcessos()`: as duas regras
coincidiram de novo, e manter a expressão repetida era recriar o problema das quatro cópias que
originou esta revisão. O comentário na função registra em que caso elas voltariam a se separar.

**A verificar antes da publicação:** a política de UPDATE não distingue linhas — ela responde
"pode gravar" ou "não pode", e o recorte "só os processos dele" vem da política de SELECT. Na
tela isso basta. Numa chamada direta à API, a leitura da linha na cláusula `WHERE` também passa
pela política de SELECT, o que deve manter o recorte; vale confirmar empiricamente com um usuário
de teste antes de conceder a autorização a alguém que não seja admin.

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
4. **Entrar como gerente.** O botão EXCLUIR PROCESSO deve aparecer e funcionar. Os campos do
   modal devem estar **editáveis** e o botão SALVAR ALTERAÇÕES visível — com duas exceções, as
   duas cinzas de propósito: "Meta Fiscal" (só-administrador, imposto pelo banco) e o bloco
   "Código da Obra / Distrito Operacional / Município", que é o vínculo com o contrato do SIGSOP
   e só se altera pelo botão Vincular, restrito a administrador. Salvar uma troca de status que
   recalcula a meta automaticamente deve funcionar normalmente.
5. **Entrar com um fiscal ou externo SEM a autorização `processos_gravar`.** O que se observa não
   é o botão EXCLUIR ausente dentro do modal: é que **a linha não traz o botão de detalhes (o
   olho)** — não existe caminho até o modal. Quem abre o modal é quem tem papel de admin/gerente
   ou a autorização especial; gravar é mais estreito que isso (ver 5.8).
6. **Entrar como fiscal.** Conferir se a lista traz os processos esperados. Se algum aparecer com
   um triângulo laranja ⚠ ao lado do nome do fiscal, passe o mouse: a mensagem explica que o
   vínculo foi reconhecido pelo nome, não pela matrícula. Pelo pré-voo de 22/09 (seção 5.1) isso
   não deveria acontecer por divergência de formato — se acontecer, rode os blocos `[1]` e `[1c]`
   de `fix_vinculo_fiscal_matricula.sql` para ver qual dos dois casos é.
7. **Trocar o status de um processo pelo seletor.** A cor do selo deve continuar correta para
   todos os status (a regra de cor era duplicada e foi unificada).
8. **Abrir o modal de meta** de alguns processos, conferir que o histórico aparece.
9. **Clicar no indicador de Processos** para abrir o detalhamento por distrito/fiscal — deve
   carregar ou dar mensagem de erro, nunca ficar parado em "Carregando…".
10. **Aba Aprovados:** conferir que o contador de alerta de pré-diligência continua correto e que
    o filtro por alerta liga e desliga sem a tabela piscar ou embaralhar linhas.

11. **Como gerente, alterar só a descrição de um processo que tem meta e salvar.** A Meta Fiscal
    precisa continuar lá. (Era o defeito mais grave achado pelos revisores: o campo desabilitado
    saía do formulário e a meta ia a NULL a cada salvamento.)
12. **Abrir qualquer processo.** O link do SUITE deve cair na página certa, e o selo SUITE da
    linha deve sair de "Consultando" — eram dois sumiços silenciosos, corrigidos em 3.7.
13. **Salvar uma alteração e conferir que a tabela não recarrega inteira** (a linha atualiza, a
    tabela não pisca).
14. **A autorização especial, e este passo só vale DEPOIS de aplicar
    `sql/restaurar_pode_gravar_processos.sql`** (ver 5.8 — sem o script, a tela oferece SALVAR e
    o banco recusa). Em Administração, conceder a um fiscal a caixa "Processos:
    gravar/editar/excluir (igual Gerente)". Entrar com ele: as linhas dele passam a trazer o
    botão de detalhes, com campos editáveis, SALVAR e EXCLUIR; "Meta Fiscal" e o bloco da obra
    continuam cinzas; a lista continua restrita aos processos dele (a menos que ele também tenha
    `processos_ver_todos`). **Salvar precisa de fato gravar** — é o que confirma que os dois
    lados, banco e tela, estão no mesmo ponto. Use um usuário de teste que não seja admin, senão
    o teste não prova nada: admin grava pelo papel.

Com o console do navegador aberto (F12), a tela deve ficar **limpa** durante o uso normal — os
`console.log` de depuração foram removidos. Mensagens que aparecerem agora são sinal real.
