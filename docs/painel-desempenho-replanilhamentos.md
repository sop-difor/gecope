# Painel de desempenho de replanilhamentos

## Objetivo

Reconstruir o SQL do painel de desempenho de replanilhamentos e estabelecer uma fonte analitica unica, reutilizavel e aderente ao GECOPE.

O painel deve permitir acompanhar a carteira atual, o fluxo mensal, a producao por analista, a fila da Fiscalizacao e os processos que pedem atencao.

## Fonte de verdade e escopo

- A fonte de dados e `public.processos`.
- O status considerado e sempre o status registrado no GECOPE.
- Informacoes do Suite podem servir como contexto de consulta, mas nao sobrescrevem status, metas ou indicadores do GECOPE.
- Registros com `excluido_por` preenchido ficam fora da analise, conforme a convencao das views de revisao existentes.

## Entrega implementada

O arquivo `sql/_aplicados/sql/painel_desempenho_replanilhamentos.sql` passou a criar ou atualizar a view `public.vw_painel_desempenho_replanilhamentos`.

A view preserva uma linha por processo valido e disponibiliza, entre outros, os campos derivados abaixo:

- `situacao`, `em_tramitacao` e `encerrado`;
- `data_entrada`, `mes_entrada` e `mes_conclusao`;
- `data_inicio_status` e `dias_em_aberto`;
- `dias_ate_conclusao`;
- `meta_estourada`;
- `impacto_revisao` e `percentual_impacto_revisao`;
- `responsavel_atual`.

A view usa `security_invoker = true` e recebe `grant select` para a role `authenticated`.

## Regras de negocio consolidadas

### Status e responsabilidade

- `APROVADO` e `ARQUIVADO` sao processos encerrados.
- Os demais processos validos estao em tramitacao.
- `FISCALIZACAO` e atribuido somente aos status que contenham `ANALISE FISCAL`, cobrindo tambem reanalise fiscal e a forma `DEVOLVIDO P/ REANALISE FISCAL`.
- Os outros processos em tramitacao sao de responsabilidade da `GECOPE`.

### Tempo no status

- Para devolucao ou reanalise, a base preferencial e `data_devolucao_correcoes`.
- Nos demais casos, a base preferencial e `ultima_atualizacao`.
- Quando uma dessas datas nao existe, o painel usa `data_entrada` como fallback.

`dias_em_aberto` mede a idade do status atual; ele nao mede necessariamente o tempo total desde a entrada do processo.

### Meta fiscal

`data_compromisso_fiscal` representa uma meta da Fiscalizacao. Por isso, `meta_estourada` so e sinalizada enquanto o processo esta classificado como `FISCALIZACAO`.

Para as conclusoes mensais, o indicador correspondente e `conclusoes_apos_meta_fiscal`, calculado quando a aprovacao GECOPE ocorreu depois dessa meta.

## Consultas entregues

O script inclui seis saidas para consumo no SQL Editor ou em uma camada de visualizacao:

1. Resumo atual para cartoes: volume valido, tramitacao, carteira GECOPE, fila da Fiscalizacao, atrasos da Fiscalizacao, encerrados e idades medias.
2. Serie mensal: recebimentos, conclusoes, tempo medio, mediana, conclusoes apos meta fiscal e impacto financeiro.
3. Composicao da carteira: processos, prioridades, metas estouradas e idade media por status e responsavel atual.
4. Recorte por analista GECOPE: carteira atual, encerramentos, idade media, tempo medio de conclusao e impacto acumulado. Codigos historicos de analista sao apresentados como nomes.
5. Recorte por fiscal: quantidade na Fiscalizacao, atrasos, idade media e prioridades.
6. Lista de conferencia: processos em tramitacao com status, responsavel atual, datas, prazo, idade e prioridade.

## Validacoes realizadas

- O arquivo inicialmente vazio foi preenchido com SQL idempotente.
- O retorno de `percentile_cont` foi convertido para `numeric` antes de `round`, corrigindo a incompatibilidade de tipo do PostgreSQL.
- A ordem das colunas da view foi preservada ao adicionar campos novos, evitando erro de renomeacao durante `create or replace view`.
- Os resultados executados no SQL Editor foram conferidos para processos em Analise Fiscal, Reanalise Fiscal, Aguardando Reanalise, Em Analise, Diligencia e Aguardando Aprovacao.
- Foi conferido que o processo `22001.154316/2025-18` permanece classificado pelo status do GECOPE, independentemente da situacao exibida no Suite.

## Ponto de atencao

`ultima_atualizacao` e a melhor referencia atualmente disponivel para a entrada no status em muitos registros. Se o campo for atualizado por alteracoes que nao representam transicao de status, a idade exibida pode refletir essa atualizacao. Um historico formal de transicoes de status permitiria medir o tempo por etapa com precisao total.
