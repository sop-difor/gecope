# Mapa de ruas em MapLibre (satélite, busca)

Decidido em grilling de 21/10/2026 e implementado na branch `feat/mapa-3d-maplibre` (E1–E4). O mapa de contornos
(Estado > Região > Município) continua em Leaflet; só o modo "Ruas e rotas" dos níveis distrito e município é desenhado
pelo MapLibre GL.

## Onde está

| Parte | Arquivo |
|---|---|
| Módulo do mapa (carga sob demanda, controles, pinos, busca) | `assets/js/mapa-ruas-gl.js` (`window.MapaRuasGL`) |
| Integração (quando usar o GL, dados dos pinos, busca de obras) | `assets/js/mapa-obras.js`, bloco "mapa de ruas em MapLibre" (`GLST`, `glIniciar`, `glSync`, `glModeloPino`, `glBuscaObras`, `syncRuas`) |
| Estilo | `assets/css/mapa-obras.css`, classes `.gc-gl*` |
| Chave do satélite | `config.js`, `window.ESRI_API_KEY` |

## Comportamento

- **Só Mapa e Satélite, sempre plano.** A visão 3D (inclinação, relevo AWS Terrain Tiles, prédios extrudados) foi
  **removida em 27/10/2026**: deixava o carregamento do mapa pesado. Rotação e inclinação ficam travadas (mouse, toque e
  teclado) e não há bússola. O estilo Liberty traz os prédios como `fill-extrusion` (`building-3d`); ao carregar, o módulo
  troca essa camada por um polígono plano (`predios-planos`, mesma fonte, filtro e cor, zoom 14+).
- **Satélite** (Esri World Imagery) é uma alternativa ao Mapa. A escolha Mapa/Satélite fica em `localStorage`
  `gecope_mapa_base`.
- **Carregamento do satélite** (ajustes de 27/10/2026): (1) o desenho do mapa só é apagado depois que a imagem chegou
  (`idle`), então a tela nunca fica em branco esperando a rede; (2) ponteiro, foco ou toque no botão Satélite ligam a
  camada com opacidade 0 e já baixam os tiles (`preaquece`; desliga em 6 s sem clique); (3) `preconnect` ao Esri na
  criação quando o satélite é a base lembrada e no primeiro `preaquece`; (4) fonte com `maxzoom` 18: o Esri só tem imagem
  até o zoom 17 em boa parte do Ceará (18 em várias cidades, como Fortaleza, Juazeiro, Crato e Iguatu; 404 em Sobral,
  Quixadá, Itapipoca, Camocim), e com tiles de 256 px o mapa pede um nível acima do zoom da tela, então o teto 19 só
  gerava 404. Onde falta o nível, o MapLibre amplia o de baixo (imagem mais mole, nunca vazia); o 404 ainda aparece no
  console ao aproximar nessas cidades.
- **Busca**: digitar lista o município (se o nome casar) e as obras que passam pelos filtros (contrato, código, município, objeto); obras sem ponto no
  mapa vão por último e abrem só o município. O endereço só vai ao Nominatim (restrito ao Ceará pela caixa do estado e pelo filtro `BR-CE` do resultado, no máximo 1 consulta
  por segundo, sem autocomplete) pelo Enter sem obra correspondente ou pela última linha da lista.
- **Como chegar**: link do Google Maps (mesmo destino do botão "Rota" da Ficha) no tooltip do pino único e no popup de
  obras no mesmo ponto. No celular, sem hover, o caminho é o botão "Rota" da Ficha.
- **Minha posição**: botão de geolocalização (o iframe do módulo já libera `geolocation`).
- **Queda automática para o Leaflet**: sem WebGL2, script do MapLibre que não chega, estilo que não carrega, tiles do
  mapa que não chegam (6 erros sem nenhum tile) ou contexto WebGL perdido por mais de 4 s: o mapa de hoje assume, sem erro. No nível Estado o Leaflet sempre desenha.
- **Mapa claro nos dois temas.** O mapa de ruas antigo escurecia os tiles por filtro no tema escuro; o novo não.
  Só controles e popups seguem o tema (decisão confirmada em 21/10/2026).

## Provedores (todos gratuitos)

| Uso | Provedor | Chave |
|---|---|---|
| Mapa vetorial | OpenFreeMap (estilo Liberty) | não |
| Busca de endereço | Nominatim (OpenStreetMap) | não |
| Satélite | Esri World Imagery via `ibasemaps-api.arcgis.com` | **sim** (gratuita) |

## Chave do satélite (Esri)

A licença do item World Imagery é o *Esri Master License Agreement*: não há permissão clara para usar os tiles em app
próprio sem conta, e o endereço antigo sem chave (`server.arcgisonline.com`) deixou de ser usado. Por isso o satélite usa
uma chave gratuita do ArcGIS Location Platform, em `window.ESRI_API_KEY` no `config.js`. **Sem chave o botão Satélite
não aparece** (nada é pedido ao Esri).

- **Criada em 21/10/2026 e VENCE EM 20/10/2027.** Depois disso o satélite para (o mapa volta sozinho ao modo Mapa e
  avisa) até a chave ser trocada.
- Onde: conta do ArcGIS Location Platform, portal `sopdifor` (sopdifor.maps.arcgis.com), item de credencial "GECOPE mapa
  de obras (satélite)": aplicativo público, privilégios só **Serviço de estilos de mapa base** e **Mosaicos de mapa base
  estáticos**, referrer `https://sop-difor.github.io`.
- **Como renovar:** abrir o item > gerar uma chave nova (a chave só aparece uma vez) > colar em `config.js`. Mudar o
  referrer também exige gerar chave nova.
- **Sem cartão e sem "Pagamento por uso"**: o plano é o gratuito (2 milhões de tiles por mês, conferir em
  location.arcgis.com/pricing). Se passar do limite, o serviço só para até o próximo ciclo e o mapa volta ao modo Mapa.
  Não cadastrar cartão nem ligar o pagamento por uso.
- **Observação de 21/10/2026:** o endereço de tiles (`ibasemaps-api.arcgis.com`) exige que o parâmetro `token` exista,
  mas não validava o valor nem o referrer (um token falso e um domínio errado também recebiam imagem). A restrição por
  domínio está configurada, mas não dá para comprovar de fora; a chave serve para colocar o uso na licença da conta, não
  como barreira. Conferir na aba **Uso** do painel (location.arcgis.com) se os tiles aparecem contados.

## Testar logado

O mapa é um iframe do `index.html` (card Contratos). `mapa-obras.js` é uma IIFE: nada fica em `window`, então os testes
automatizados expõem internos por `page.route` e leem o resultado por um `<script>` inline (o `evaluate` normal roda em
mundo isolado). Usar o usuário de teste por variável de ambiente, nunca em arquivo do repositório.
