# Vereditos dos revisores — revisão do módulo Processos (22/09/2026)

Companheiro de [2026-09-22-processos.md](2026-09-22-processos.md). Aquele documento registra a
revisão; este registra o que os revisores acharam **dela**.

Quatro revisores `general-purpose` frescos, em paralelo, sem o contexto de quem implementou —
mesma convenção de `docs/painel-fiscais/revisores.md`. Escopo: os dois commits da revisão mais a
mudança "gerente pode editar", decidida pelo usuário em 22/09/2026 e implementada antes da
revisão para entrar na mesma varredura.

## Rodada 1 — `BLOQUEADO` por todos os quatro

| Revisor | Veredito | Achados que bloquearam |
|---|---|---|
| `rev-seguranca` | BLOQUEADO | Meta apagada pelo gerente · autorização especial · script da view não roda · script de RLS sem transação · colisão de matrícula não diagnosticada |
| `rev-correcao` | BLOQUEADO | Meta apagada pelo gerente · aviso ⚠ nunca renderizado · paginação sem desempate |
| `rev-produto` | BLOQUEADO | Aviso ⚠ nunca renderizado · meta apagada pelo gerente · autorização especial |
| `rev-aderencia` | BLOQUEADO | Script da view não roda · autorização especial |

Três dos quatro chegaram, independentemente, aos dois mesmos erros graves — os dois introduzidos
pela mudança "gerente pode editar", não pela revisão original.

## O que foi corrigido na rodada 1

### 1. O gerente apagava a Meta Fiscal a cada salvamento (3 revisores)

O gate novo fazia `elMetaFiscal.disabled = true` para não-admin. **Campo `disabled` não entra no
`FormData`**, e o payload é montado com `new FormData(form)` — então
`formData.get("DATA COMPROMISSO FISCAL")` devolvia `null` e todo salvamento de gerente gravava
`data_compromisso_fiscal = NULL`. Dois caminhos, ambos novos:

- Gerente altera qualquer campo sem trocar o status → a meta some, sem erro e sem aviso. O
  trigger não barra, porque outras colunas também mudaram.
- Gerente salva sem alterar nada → a meta vira a única coluna alterada → o trigger recusa e
  acusa o gerente de alterar manualmente um campo que ele não pode nem tocar. Exatamente o erro
  de banco na cara do usuário que o gate existia para evitar.

**Correção em duas camadas, deliberadamente:** o campo virou `readOnly` (continua no `FormData`,
preserva o valor, e o `title` volta a funcionar — navegador não dispara evento de mouse em campo
desabilitado), **e** a coluna só entra no payload quando `canMarkDateAsMeta()`. A segunda camada
é o que protege se o campo virar `<select>` um dia.

**Efeito colateral do próprio conserto, encontrado e fechado na mesma rodada:** com a coluna fora
do payload, a comparação `updates.data_compromisso_fiscal || null` lia `undefined` como "meta
zerada" e registraria em `historico_metas` uma mudança que não aconteceu no banco. O fallback
passou a ser a data original, não `null`.

### 2. O aviso ⚠ do vínculo do fiscal nunca aparecia (2 revisores)

`avisoVinculoHTML` era montado e **nunca interpolado** no `<tr>` — ocupava exatamente o lugar de
`labelDias`, que também era morta. A correção 3.1 da revisão não existia na prática e o passo 6
da validação era impossível de executar. Corrigido com a interpolação na célula do fiscal.

### 3. Paginação podia duplicar ou perder linha (1 revisor)

`.order('created_at')` não tem desempate, e cada bloco é uma consulta nova. Em Postgres `now()` é
por transação, então carga em lote grava dezenas de linhas no mesmo instante; se um grupo empatado
cruzar a fronteira do bloco, a mesma linha pode vir duas vezes enquanto outra não vem nenhuma.
Silenciosamente — a mesma classe de falha que a paginação veio matar. Corrigido com `.order('id')`
como segundo critério.

Junto: o passo do laço passou a ser `bloco.length` em vez de `TAMANHO_BLOCO`. Se o `max-rows` do
servidor for menor que 1.000, o primeiro bloco volta curto e o laço antigo pararia ali,
ressuscitando a truncagem.

### 4. Scripts SQL — os dois que você aplica à mão (2 revisores)

- **`fix_painel_responsavel_atual_suite.sql` não executava.** As três colunas novas estavam no
  meio da lista do `create or replace view`; o PostgreSQL só aceita coluna acrescentada no fim, e
  o comando falha com `cannot change name of view column "mes_entrada" to "unidade_suite"`,
  abortando o script inteiro. Movidas para o fim e conferidas contra a view vigente: as 33
  colunas anteriores batem em nome e ordem.
- **`fix_vinculo_fiscal_matricula.sql` sem transação.** Entre o `DROP POLICY` e o `CREATE POLICY`
  existia um instante com RLS ligado e nenhuma política de SELECT — nesse intervalo `processos`
  devolve zero linhas para todo mundo, admin inclusive; e um erro no `CREATE` deixaria a tabela
  invisível para a aplicação inteira. Blocos [2] e [3] agora são uma transação.
- **Faltava o pré-voo de colisão.** O script alarga a política de SELECT, o que é seguro só
  enquanto a normalização for injetiva entre pessoas: `70024-810` e `700248-10` colapsam na mesma
  chave, e aí um fiscal passaria a enxergar processos de outro. Bloco `[1b]` novo, que deve voltar
  **vazio** — se vier linha, os blocos [2] e [3] não devem ser aplicados.
- **Faltava o "confirme antes".** Bloco `[0]` novo lê `pg_policies` com `qual`, no padrão de
  `fix_rls_cache_funcoes_auxiliares.sql`: sem ele, um ajuste feito direto no banco depois de
  22/09 seria sobrescrito em silêncio. O `[4]` também passou a trazer `qual`/`with_check` — sem a
  condição à vista só dá para conferir que a política existe, não que está certa.

### 5. Achados menores fechados na mesma leva

- Sétimo ponto de XSS (`innerHTML` com `e.message` cru), irmão de um que já havia sido corrigido
  na mesma função.
- `window.allData.unshift(fresh)` mutava o vetor sem trocar a referência, enquanto o índice
  invalida por identidade — o processo recém-criado ficava fora do índice até a próxima carga
  completa. Função `invalidarIndiceAllData()` explícita.
- Dois blocos `else` vazios, sobra da remoção dos `console.log`.

### 6. A autorização especial `processos_gravar` (decisão do usuário, 22/09/2026)

> **Esta seção descreve o que foi feito na rodada 1, e a premissa dela caiu depois.** A conferência
> em `pg_policies` — prometida no fim desta seção — mostrou que a política viva **não** tem o ramo
> da autorização especial. O desfecho está em "Depois da rodada 3", no fim deste documento. O texto
> abaixo fica como está porque é o registro do que os revisores acharam e do que foi corrigido na
> hora.

**Decisão: alinhar a tela ao banco.** As permissões passaram a ler de uma fonte única,
`podeGravarProcessos()` em `core/auth.js`, que espelha a função `public.pode_gravar_processos()`
do banco: admin, gerente, **ou** quem recebeu a autorização especial. `podeEditarProcesso()`,
`podeExcluirProcesso()` e `canSeeProcessActions()` agora leem de lá, e a quarta cópia literal da
mesma regra — inline no laço de render de `processos.js` — foi substituída pela chamada à fonte
única (e içada para fora do laço: `temAutorizacao()` faz um `JSON.parse` por chamada, e ali dentro
era um por processo).

Era a divergência entre essas cópias que produziu os achados desta revisão. O detalhe abaixo fica
registrado porque é a raiz de todos eles:

**A política `processos_update` viva é a de `sql/autorizacoes_especiais.sql`** (Fase 5), que usa
`pode_gravar_processos()` = admin, gerente **ou** `tenho_autorizacao('processos_gravar')` — e não
a de `sql/rls_processos_composicoes_orcamentos.sql`, que foi substituída por ela e ainda assim era
citada como "a política do banco" nos comentários do código e no registro da revisão. Antes desta
correção, quem recebia a autorização em Administração (caixa rotulada "igual Gerente") abria o
modal e encontrava tudo cinza, sem SALVAR e sem EXCLUIR: a tela mais rígida que o banco — o mesmo
defeito que a mudança do gerente veio corrigir, reintroduzido para outro papel.

**A conferir em produção:** o bloco `[0]` do script de vínculo, ao ser rodado, mostra qual das
duas políticas está de fato aplicada hoje. Se por algum motivo a de `autorizacoes_especiais.sql`
não estiver valendo no banco, esta correção da tela passa a ser mais permissiva que a RLS — não
é falha de segurança (o banco continua sendo quem decide, e recusaria a gravação), mas volta a
existir o problema de oferecer um botão que o banco nega. Vale conferir junto com os outros
blocos.

## Rodada 2 — dois APROVADO, dois BLOQUEADO

| Revisor | Veredito | Achados |
|---|---|---|
| `rev-seguranca` | **APROVADO** | Os 5 bloqueios dele fechados; 5 ressalvas registradas abaixo |
| `rev-correcao` | **APROVADO** | Os 3 bloqueios dele fechados; validou os 7 cenários da meta caso a caso contra o trigger |
| `rev-produto` | BLOQUEADO | Bloco da obra aberto para gerente · passos 5 e 12 da validação inexecutáveis · documentos com a regra velha |
| `rev-aderencia` | BLOQUEADO | Comentários e documentos com a regra velha · duas observações da rodada 1 sumidas do radar |

### O bloqueio de código da rodada 2

**O bloco "Código da Obra / Distrito Operacional / Município" ficou editável para o gerente.** O
gate novo liberou *todos* os `input` de `#formDetalhes`, e três deles são o vínculo com o contrato
do SIGSOP — ao lado de um botão "Vincular" que continua só-admin e de um texto fixo dizendo
"Restrito a administradores". A tela se contradizia num palmo de espaço, e o pior não era a
contradição: o gerente **gravava**. Digitado à mão, o código pula `buscarObraDetalhes()`, que é
quem confere o código contra a base de contratos e preenche distrito/município a partir do SIGSOP
— dá para desfazer ou falsificar o vínculo processo↔obra em silêncio, com mensagem de sucesso na
tela, e é esse vínculo que alimenta o painel de desempenho e o mapa de obras.

Corrigido restaurando a trava nos três campos (estado anterior, não política nova). A decisão do
usuário foi "gerente pode editar processos", não "gerente pode refazer à mão o vínculo com o
contrato". Aqui `disabled` é seguro, ao contrário da Meta Fiscal: estes três são lidos por
`getElementById().value` no payload, e `.value` continua legível em campo desabilitado — quem sai
do `FormData` é só quem é lido por ele. Foi exatamente essa diferença que causou o bug da meta.

### Demais correções da rodada 2

- **Comentários e documentos com a regra velha** (dois revisores, em quatro pontos de código e
  cinco de documento): diziam "admin e gerente" onde o código já lia `pode_gravar_processos()`. É
  a mesma classe de divergência que originou toda esta revisão, migrada do código para o texto ao
  lado dele. Corrigidos, inclusive a seção 3.2 do registro principal, que remete à 3.9.
- **Teto de segurança na paginação** (dois revisores): o laço só saía com bloco vazio; se o
  `Range` deixasse de ser honrado em algum ponto do caminho, toda volta devolveria o mesmo
  conjunto e a aba travaria acumulando memória. Limite de 200 blocos com erro legível.
- **`calcularDataMeta` rodando à toa**: era executada antes do teste `jaTemMeta`, para todo
  processo em ANÁLISE FISCAL que já tinha meta — e essa função percorre dias úteis consultando a
  tabela de feriados. O descarte passou para antes do cálculo.
- **Comentário descrevendo um `else` que não existe** no gate da meta. As atribuições são
  incondicionais de propósito (é o que reverte o estado se o papel mudar na sessão); o comentário
  dizia o contrário.
- **Passos 5, 12 e 13 da validação** reescritos, e **passo 14 novo** para a autorização especial —
  o comportamento novo desta rodada não tinha nenhum passo de conferência.
- **`docs/MAPA-MODULOS.md`**: a entrada duplicada de `sincronizar-suite` agora remete à completa, e
  a da view avisa que `fix_painel_responsavel_atual_suite.sql` a redefine — era a mesma armadilha
  da `sincronizar-suite` que esta revisão acabou de fechar, prestes a se repetir.

### Ressalvas do `rev-seguranca` — uma condiciona a aplicação do SQL

**Ao ler o resultado do bloco `[1]`, leia com esta lente:** o `[1b]` procura colisão de matrícula
apenas **entre pessoas cadastradas em `app_users`**. A política alargada compara com
`processos.fiscal_matricula` — então uma linha legada cuja matrícula normalize na chave de um
fiscal, sem pertencer a nenhum usuário cadastrado, passaria batido. Mitigador forte: hoje
`fiscal_matricula` é sempre gravada a partir do dropdown de fiscais, ou seja, vem do próprio
cadastro. O que denuncia o caso é o próprio `[1]`: **nome do fiscal no processo discordando do
e-mail do fiscal casado**. Se aparecer isso, não aplique [2]/[3] antes de conversarmos.

As demais, registradas e não corrigidas:

- A paginação faz sempre uma requisição a mais por carga (antes parava no bloco curto; agora só no
  vazio). Resposta vazia, irrelevante em bytes — mas vale registrar dado o projeto de egress.
- Paginação por *offset* com escrita concorrente: o desempate por `id` estabiliza cada consulta,
  mas um processo cadastrado por outro usuário no meio da carga empurra tudo um degrau e pode
  duplicar uma linha na fronteira do bloco. Só afeta base com mais de 1.000 linhas. A cura
  definitiva é paginação por chave (`.lt('created_at', ...)`) em vez de `.range()`.
- `sop_autorizacoes` é lido do `sessionStorage` e nunca revalidado depois do login: revogar
  `processos_gravar` não tira os botões da sessão já aberta. O banco recusa a gravação, então não
  é falha de segurança — é o problema de "oferecer o que o banco nega", em escala menor.
- `create index` não-concorrente dentro da transação segura `ACCESS EXCLUSIVE` em `processos` até
  o `COMMIT`. Instantâneo no tamanho atual, e `CONCURRENTLY` não cabe em transação — a escolha
  está certa, só é bom saber.
- Aresta estreita: se `dataDevolucaoCorrecoes` em memória divergir do banco, um gerente que altere
  só a data de devolução pode produzir um UPDATE em que só a meta muda, e o trigger recusa. Erro
  legível, não perda de dado.
- `vinculoFiscalAviso` só é limpo dentro do ramo do papel `fiscal`: quem deixar de ser fiscal na
  mesma sessão continua vendo os ⚠ já marcados até a próxima carga completa.

## Rodada 3 — APROVADO pelos dois

O protocolo de `docs/painel-fiscais/revisores.md` diz que dois `BLOQUEADO` do mesmo revisor na
mesma etapa escalam para o usuário em vez de gerar uma terceira tentativa. `rev-produto` e
`rev-aderencia` bloquearam duas vezes cada, então a decisão foi ao usuário em 22/09/2026:
**rodada 3 só com esses dois, escopo estreito — verificar se os achados deles foram fechados, sem
reabrir o que já passou.**

Ambos deram **APROVADO**. Com `rev-seguranca` e `rev-correcao` já aprovados na rodada 2, fecha
4/4.

Duas verificações independentes que vale registrar, porque confirmam as afirmações mais delicadas
das correções:

- Os três campos do bloco da obra **não têm atributo `name`** no HTML, logo nunca passaram pelo
  `FormData` de forma alguma — travá-los com `disabled` não reintroduz o bug da Meta Fiscal (que
  tem `name="DATA COMPROMISSO FISCAL"`). Os dois revisores conferiram isso separadamente.
- O único `onclick="abrirDetalhes(...)"` do repositório é o botão do olho, então a redação nova do
  passo 5 ("não existe caminho até o modal") se sustenta.

Ajuste final: o comentário do aviso ⚠ dizia "nunca para admin/gerente", o que é verdade mas
omitia que um fiscal **com** a autorização especial continua no ramo restrito e pode vê-lo.
Reescrito.

## Observações registradas e não corrigidas

- `onclick="fn('${escapeHTML(...)}')"` escapa para o contexto errado: dentro de atributo HTML o
  parser decodifica `&#39;` de volta para `'` antes de o JS ser avaliado. Pré-existente, exige
  poder gravar `processos.processo` (escalada lateral, não anônima). O padrão correto — `data-*`
  + listener delegado — já é usado em `.proc-star-prioritario`.
- O casamento por nome continua frouxo no sentido curto→longo ("ANA SOUSA" casa com processos de
  "ANA SOUSA LIMA"). A RLS limita o alcance aos processos sem matrícula, que já são visíveis a
  todos os fiscais por decisão anterior.
- As falhas de gravação de meta são contadas e vão para o console, não para a tela. A seção 3.5 da
  revisão diz "relatadas" sem dizer a quem.
- As mensagens de erro de salvar/excluir despejam o texto técnico do Supabase (`Failed to fetch`).
  A mecânica está certa — nada fica travado —, o texto é que não é para leigo.
- `docs/painel-fiscais/proposta-tempo-fiscal-suite.md` ainda afirma que a `sincronizar-suite` do
  repositório é a de 06/08/2026, o que virou a próxima armadilha do mesmo tipo que esta revisão
  fechou.

## Depois da rodada 3 — a conferência em `pg_policies` derrubou a premissa da seção 6

A seção 6 terminava com um "a conferir em produção": rodar o bloco `[0]` do script de vínculo e ver
qual das duas políticas `processos_update` estava de fato aplicada. A conferência foi feita, e a
resposta não era nenhuma das duas hipóteses em jogo.

**A política viva é `(select public.meu_papel()) in ('admin','gerente')`** — sem
`pode_gravar_processos()`, portanto sem a autorização especial. A origem está em
`sql/_aplicados/fix_processos_rw_authenticated_leftover.sql`, aplicado em **18/09/2026** durante a
correção de egress: ele removeu a política órfã `processos_rw_authenticated` e, num bloco
secundário de desempenho, recriou `processos_insert` e `processos_update` a partir da definição
anterior à Fase 5. O ramo `tenho_autorizacao('processos_gravar')` foi apagado de carona, quatro
dias antes desta revisão começar. `processos_select` escapou porque aquele script não o tocou — é
por isso que `processos_ver_todos` continua funcionando e `processos_gravar` não.

**Decisão do usuário, no mesmo dia: restaurar a intenção da Fase 5.** Antes de decidir, a pergunta
que importava foi para o banco — quem tem essa autorização hoje? Uma pessoa só, com papel **admin**,
que já grava pelo papel. Ninguém tinha perdido acesso em 18/09 e ninguém ganha com a restauração; o
que se conserta é a promessa da caixa para a próxima vez que ela for usada. A alternativa —
remover a caixa — era igualmente coerente e mais simples, e foi descartada por perder a
granularidade de autorizar sem promover.

Consequências no código, todas aplicadas:

- `podeGravarProcessos()` volta a somar `|| temAutorizacao('processos_gravar')`, e o banco recebe
  o par disso em `sql/restaurar_pode_gravar_processos.sql` — **aplicação manual pendente, e ela
  precisa acontecer antes de a branch ir para produção**, senão a tela fica mais permissiva que o
  banco.
- `canSeeProcessActions()` passou a **delegar** para ela. As duas regras coincidiram de novo, e
  manter a expressão repetida seria recriar o problema das quatro cópias que originou esta revisão.
  O comentário da função registra em que caso elas voltariam a se separar.
- Comentários e documentos foram acertados duas vezes em 22/09 — primeiro para a regra estreita,
  depois para a restaurada. Estão em `core/auth.js`, `modules/processos/processos.js`, `index.html`
  e no registro da revisão.

Ficou registrado à parte, como observação de produto: conceder a um **admin** uma autorização que
ele já tem pelo papel sugere que a tela de Administração não deixa isso claro na hora de conceder.

**O que isso ensina, e é o motivo de estar registrado aqui e não só no código:** três textos
diferentes desta revisão afirmaram a regra do banco citando um arquivo do `sql/`, e os três
erraram. Arquivo de migração é o que foi **pedido** ao banco em alguma data; a resposta de hoje só
`pg_policies` dá. Os revisores, que trabalham lendo o repositório, não tinham como pegar isto — foi
a conferência em produção que pegou. Daí o bloco `[0]` obrigatório nos scripts novos.

Nenhum dos quatro vereditos muda: os achados que eles levantaram continuam fechados, e este é um
fato do banco que nenhum deles tinha como alcançar.

### A ressalva do `rev-seguranca` que condicionava o SQL — resolvida

Aquela ressalva pedia para ler o `[1]` com uma lente específica (nome do fiscal no processo
discordando do e-mail do fiscal casado, sinal de linha legada que o `[1b]` não pegaria). **O `[1]`
voltou vazio**, então não há o que ler com lente nenhuma: nenhum processo casa por matrícula
normalizada sem casar também pela crua. O `[1b]` também voltou vazio.

Com isso os blocos [2] e [3] deixaram de ser necessários e **não foram aplicados** — o pré-voo
desqualificou o próprio script, que era exatamente a função dele. O raciocínio completo está na
seção 5.1 do registro. O revisor estava certo em condicionar; a condição simplesmente não se
materializou.
