# Revisores do painel de desempenho dos fiscais

Cada etapa concluída é submetida a revisores em paralelo, como subagentes
`general-purpose` frescos — sem o contexto de quem implementou, para que revisem o
resultado e não a intenção. Mesma convenção de nomes já usada no Assistente de Dados
(`docs/assistente/revisores.md`).

## Protocolo

- Veredito por revisor: `APROVADO` ou `BLOQUEADO`, com justificativa e, quando
  `BLOQUEADO`, o achado apontando arquivo e linha.
- **A etapa seguinte só começa com todos os vereditos `APROVADO`.**
- Dois `BLOQUEADO` do mesmo revisor na mesma etapa escalam para o usuário decidir,
  em vez de gerar uma terceira tentativa.
- Vereditos ficam em `docs/painel-fiscais/etapa-N-revisao.md`. O usuário recebe um
  resumo curto por etapa, não o relatório inteiro.

## Painel fixo (todas as etapas)

### `rev-correcao`
Os números estão certos? Confere agregações, denominadores, tratamento de nulo e
fronteiras de status contra os valores de referência medidos em 2026-09-15:
**405 processos válidos, 63–64 na fila, 330 despachados, 60 fiscais, 11 distritos.**
Vigia especificamente: processo sumindo em silêncio por join ou filtro; valor de obra
usado em agregado histórico (cobertura é só 51% lá); média exibida sem o tamanho da
amostra ao lado.

### `rev-design`
O resultado tem refino profissional? Julga densidade, hierarquia tipográfica, ritmo
vertical, peso de fonte, contraste e uso de cor com significado — não como decoração.
Sobre tema, até a E7 cobra apenas que **nada seja aprovado com cor fixada no JS ou no
CSS fora dos tokens** — é isso que torna o refino final barato. O veto sobre paridade
escuro/claro só vale a partir da **E8**, quando os dois temas são refinados juntos; até
lá o escuro carrega a dívida conhecida da v1 (negrito 700, halo triplo, verde neon) por
decisão do usuário, e isso não bloqueia etapa nenhuma.

### `rev-produto`
Isso responde à pergunta do gestor? Verifica se a tela permite comparar distritos e
fiscais de forma proporcional, se o caminho macro → detalhe funciona sem becos, e se
o que está na tela sustenta uma decisão. Vigia número apresentado sem denominador,
ranking sem contexto, e gráfico que exige explicação verbal para ser lido.

### `rev-aderencia`
Segue a arquitetura da casa? Confere convenções do repositório, o `MAPA-MODULOS.md`,
e que o modo Obras continua idêntico ao que era. Vigia performance nos caminhos quentes
(`obrasOf`, `passF`, `declutter` rodam dezenas de milhares de vezes por quadro de mapa),
cor fixada no JS em vez de token no CSS, e estado novo que escapa de `st`.

## Etapas

`E1` infraestrutura do modo · `E2` mapa e período · `E3` painel lateral e KPIs ·
`E4` quadrante carga × tempo · `E5` janelas de distrito e fiscal · `E6` filtros ·
`E7` fonte única com a tela de Processos · `E8` refino dos dois temas

## Revisor por convocação

### `rev-seguranca`
Convocado nas etapas que tocam acesso — a **E1** (porta de papel no front-end) e a **E7**
(mudança de audiência da tela de Processos). O painel ordena pessoas nominalmente e é
restrito a admin e gerente; a view já barra no banco, mas a interface não pode oferecer
o que o banco vai negar, nem vazar nome de fiscal por caminho lateral.
