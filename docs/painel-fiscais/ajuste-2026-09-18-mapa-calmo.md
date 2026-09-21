# Ajuste pós-E8 (2026-09-18) — mapa calmo e tipografia mais leve

Gatilho (usuário, ao ver o painel em produção): o verde neon do escuro "fica muito pesado"; os
textos estão em negrito, "muito grosseiro"; foco em melhorar o design do mapa. Feito com a
skill `frontend-design`. Tudo escopado no modo Replanilhamentos (classe `modo-rp` na RAIZ e no
`body`): o modo Obras não muda (conferido em captura).

## Diagnóstico medido

198 dos 252 textos do painel estavam em `font-weight:700`. O mapa tinha rótulos em CAIXA ALTA
700 com espaçamento entre letras, divisas quase brancas e verde `#2FE6A0` (S≈79%) como acento.

## Plano de design (compacto)

- **Assunto/uso:** mapa executivo da SOP-CE projetado para a cúpula; a tarefa é ver onde a
  fiscalização demora e descer até o fiscal.
- **Cor (escuro do modo):** fundo petróleo `#071310`; celadon calmo `#66C2A0` (era neon);
  âmbar do tempo = a única cor forte da tela; divisas `#6E8C7E` (separam, não desenham).
  (Tentei também escurecer a base do Estado; o `rev-correcao` mostrou que a camada do Estado
  nunca é exibida, então o token foi retirado — o âmbar assenta sobre `--map-field`.)
- **Tipografia:** as duas famílias da casa, com escala de peso de 3 degraus — 500 nomes e texto
  corrido, 600 números/rótulos/destaques, 700 só onde já era título de marca. Nome de distrito no
  mapa em frase (não caixa alta), 500, sem espaçamento entre letras.
- **Um lugar de ousadia:** o âmbar como rampa do tempo (decisão da E8). O resto recua.
- **Revisão contra o padrão:** não caiu em creme/terracota, nem em preto + verde ácido; o
  "âmbar sobre petróleo" vem do sentido do dado (atenção = mais lento), não de estética.

## O que mudou

| # | Mudança |
|---|---|
| 1 | `:root.theme-dark.modo-rp` redefine `--ng*`, `--map-base`, `--map-group-border`, `--map-open-border`, `--choro-floor` (.10→.17), `--choro-span` (.62→.52) e `--warm-span` (.45→.40). |
| 2 | `sincronizaModoRp()` (JS, topo de `render()`): classes na raiz e no body; quando o modo vira, relê `TOKENS`, `BASE`, cor do Estado e o ponto de status. |
| 3 | Rótulos do mapa: frase, 500 (nome) / 600 (número, tabular). Legenda: título em frase, rampa de 8px. |
| 4 | Escala de peso do painel, controles e janelas (bloco "E9" no CSS). |
| 5 | Piso da coroplética do escuro no modo (fecha a pendência "Sobral 13 d lê como sem dado"). |

## Verificação

Capturas dos dois temas (visão geral, painel rolado, cidades, métrica Despachos, janelas de
distrito e fiscal, volta ao modo Obras) com o harness de Supabase falso.

## Vereditos

**3/3 APROVADO** (`rev-correcao`, `rev-aderencia`, `rev-design`), o último em 2 rodadas.

- `rev-design` R1 bloqueou: com o piso novo (.17) o topo da rampa do escuro cruzou 4,5:1 no rótulo
  (tempo 4,41; contagem 4,36; contador em `--ng-light` 3,06). Corrigido: `--warm-span` .38 e
  `--choro-span` .48 (topos .55 e .65 → 4,64 e 4,74:1), `--lbl-count` em `--text-brightest` em todo
  o modo, nome de cidade no escuro em `--text-brightest`.
- `rev-aderencia`: `.statleg.cards .sit-v` e o contador do rótulo no claro escapavam do 600
  (especificidade) — corrigidos. Classe `rp-warm` ficou sem uso e foi retirada.
- `--map-state-fill` retirado: a camada do Estado nunca é exibida (o âmbar assenta sobre
  `--map-field`); a justificativa "cáqui" do plano estava errada.
- Ficam de fora (antigos/fora do escopo): "sem dado" mais fraco no escuro no nível de cidades;
  escala linear com outlier (Fortaleza em Despachos); tooltip do "i" sem captura; controle
  segmentado em trilha (escuro) × botões soltos (claro).
- Pendente com o usuário: validar em produção logado (Portão 2 da E8 e deste ajuste).
