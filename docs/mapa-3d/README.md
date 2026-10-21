# Mapa de ruas em MapLibre (3D, satélite, busca)

Decidido em grilling de 21/10/2026 e implementado na branch `feat/mapa-3d-maplibre` (E1–E4). O mapa de contornos
(Estado > Região > Município) continua em Leaflet; só o modo "Ruas e rotas" dos níveis distrito e município é desenhado
pelo MapLibre GL.

## Onde está

| Parte | Arquivo |
|---|---|
| Módulo do mapa (carga sob demanda, controles, pinos, 3D, busca) | `assets/js/mapa-ruas-gl.js` (`window.MapaRuasGL`) |
| Integração (quando usar o GL, dados dos pinos, busca de obras) | `assets/js/mapa-obras.js`, bloco "mapa de ruas em MapLibre" (`GLST`, `glIniciar`, `glSync`, `glModeloPino`, `glBuscaObras`, `syncRuas`) |
| Estilo | `assets/css/mapa-obras.css`, classes `.gc-gl*` |
| Chave do satélite | `config.js`, `window.ESRI_API_KEY` |

## Comportamento

- **Abre plano e em "Mapa".** O botão **3D** (só no modo Mapa) inclina ~60°, liga o relevo (AWS Terrain Tiles, exagero
  1,5×, sombreamento leve sob a água) e libera girar/inclinar. Os prédios vêm do OpenStreetMap (camada `building-3d` do
  estilo, zoom 14+): no interior do Ceará há pouco cadastro. O 3D nunca fica lembrado.
- **Satélite** (Esri World Imagery) é uma alternativa ao Mapa, sem 3D (a imagem sobre o relevo SRTM ondula nas cidades).
  A escolha Mapa/Satélite fica em `localStorage` `gecope_mapa_base`.
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
| Relevo | AWS Terrain Tiles (Terrarium) | não |
| Busca de endereço | Nominatim (OpenStreetMap) | não |
| Satélite | Esri World Imagery via `ibasemaps-api.arcgis.com` | **sim** (gratuita) |

## Pendência: chave do satélite

A licença do item World Imagery é o *Esri Master License Agreement*: não há permissão clara para usar os tiles em app
próprio sem conta, e o endereço antigo sem chave (`server.arcgisonline.com`) deixou de ser usado. **Sem chave, o botão
Satélite não aparece** (nada é pedido ao Esri). Para ligar:

1. Criar conta gratuita em developers.arcgis.com (ArcGIS Location Platform; o plano gratuito inclui 2 milhões de tiles
   de mapa base por mês, conferir em location.arcgis.com/pricing).
2. Dashboard > API keys > criar chave com a permissão "Location services > Basemaps > Static basemap tiles".
3. **Restringir a chave por referrer** ao domínio do GECOPE (e `http://localhost` para testes). Assim ela pode ficar
   no `config.js`, que é público.
4. Colar a chave em `window.ESRI_API_KEY` no `config.js`.

Se os tiles do satélite falharem (chave inválida, serviço fora), o mapa volta sozinho para "Mapa", desativa o botão
Satélite na sessão e avisa. Observação de 21/10/2026: o serviço respondeu com imagens mesmo com um token falso, ou
seja, ele não conferia o token naquele dia; isso não substitui a licença.

## Testar logado

O mapa é um iframe do `index.html` (card Contratos). `mapa-obras.js` é uma IIFE: nada fica em `window`, então os testes
automatizados expõem internos por `page.route` e leem o resultado por um `<script>` inline (o `evaluate` normal roda em
mundo isolado). Usar o usuário de teste por variável de ambiente, nunca em arquivo do repositório.
