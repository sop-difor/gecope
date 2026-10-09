# Localização das obras (mapa de ruas)

Entregue em 09/10/2026. O botão **Ruas e rotas** do módulo Contratos põe o mapa de ruas do OpenStreetMap por
baixo do mapa, nos três níveis (estado, distrito e município). Cada obra pode ter um ponto (latitude/longitude):
com um município aberto ele aparece como pino, e o ponto é cadastrado no cartão **Localização da obra** da Ficha.

## Mapa de ruas e rotas

- Estado e distrito: os contornos ficam com preenchimento leve (proporcional ao número de obras) e os rótulos
  com as contagens continuam. Município: só o contorno e os pinos.
- Peso (medido em 09/10/2026): Ceará inteiro ≈ 40 blocos ≈ 235 KB; um zoom acima ≈ 840 KB. Nada é pedido
  antes de ligar o botão; o navegador guarda os blocos em cache.
- O mapa mostra rodovias e ruas, mas **não calcula trajeto**. O botão **Rota**, ao lado das abas Ficha Obra e
  Elétrica (só para obra com ponto válido), abre o Google Maps com o destino, a partir de onde a pessoa estiver.
- Em Replanilhamentos o botão some (o modo não tem obras no mapa).

## Onde está o dado

- Tabela `public.obra_localizacao` (1 linha por `id_obra`) — `sql/create_obra_localizacao.sql`.
  `contratos_edificacao` é espelho do SIGSOP e não tem coordenada; por isso a tabela é própria.
- Leitura e gravação: admin, gerente, fiscal, externo e eletrica (os mesmos de `contratos_edificacao_pode_ler()`).
  Remover: só admin e gerente. Cada gravação carimba `atualizado_em`/`atualizado_por`. Não há histórico:
  o ponto anterior é sobrescrito.
- Carga inicial da planilha `obras_georeferencia.ods`: `sql/import_obra_localizacao_inicial.sql`
  (`on conflict do nothing`: não sobrescreve ponto já cadastrado no mapa).

## Ordem de aplicação (manual, no SQL Editor do Supabase)

1. `sql/create_obra_localizacao.sql`
2. `sql/import_obra_localizacao_inicial.sql`

Sem o passo 1 o mapa continua funcionando; só não há pontos e o painel avisa que as localizações não carregaram.

## Como o ponto é informado (cartão da Ficha)

Três jeitos, à escolha: **marcar no mapa** (clique ou arrastar o marcador), **digitar coordenadas**
(`-3.7319, -38.5267` ou graus/minutos/segundos) e **usar minha posição** (GPS do aparelho; exige HTTPS e a
permissão `geolocation` do iframe em `index.html`). Em contrato com várias obras no mesmo município, uma
caixa permite usar o mesmo ponto nas obras irmãs que ainda não têm localização.

## Regras de validade (front e carga inicial usam a mesma)

Um ponto só vai para o mapa se for número válido, estiver na caixa do Ceará (a tabela também tem `CHECK`)
e cair dentro do município cadastrado da obra, com tolerância de 2 km na divisa. O que não confere **não é
plotado** e aparece no painel como "coordenada não confere", para ser corrigido.

## Resultado da planilha (427 obras)

- 252 sem coordenada · 13 com coordenada mas sem a obra em `contratos_edificacao` (ignoradas pela junção)
- 155 importadas · 7 rejeitadas pelas regras acima:

| codigo_obra | município cadastrado | motivo |
|---|---|---|
| 06652025SEDUC01 | MARCO | fora do município (a 177.1 km do limite) |
| 06162025SEDUC01 | SÃO GONÇALO DO AMARANTE | fora do município (a 42.2 km do limite) |
| 06762023SOP01 | CAMPOS SALES | fora do Ceará (7311141, 462016029) |
| 03012026SPS01 | UMIRIM | fora do município (a 85.7 km do limite) |
| 092024SEMACE01 | CRATO | fora do município (a 371.4 km do limite) |
| 06222025SEDUC01 | EUSÉBIO | fora do município (a 9.7 km do limite) |
| 06292025SEDUC01 | BATURITÉ | fora do município (a 18.0 km do limite) |

Duas dessas (`03012026SPS01` em Umirim e `092024SEMACE01` em Crato) trazem o mesmo ponto
(-3.8073, -38.5082), que é de Fortaleza: parece valor padrão copiado. A de Campos Sales tem números que
parecem coordenadas UTM, não graus. Uma coordenada veio em graus/minutos/segundos e foi convertida
(`05092023SEDUC01`). As rejeitadas podem ser cadastradas pelo próprio mapa depois de conferidas.

## Pendências e riscos conhecidos

- O mapa de ruas usa os tiles públicos do OpenStreetMap (gratuito, uso leve, atribuição visível). Se o uso
  crescer, trocar `OSM_URL` em `assets/js/mapa-obras.js` por um provedor com chave.
- Sem cluster de marcadores: o maior município tem 662 obras no histórico completo e o Leaflet comporta.
  Reavaliar só se houver lentidão medida.
- Edição por qualquer papel é decisão do usuário (09/10/2026). Se aparecer ponto errado recorrente, a
  alternativa é restringir a escrita a admin/gerente na policy `obra_localizacao_update`.
