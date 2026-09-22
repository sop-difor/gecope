# Revisões de código

Histórico das revisões sistemáticas do código do GECOPE. Uma revisão é uma varredura
deliberada de um módulo ou área — não um conserto pontual, que vive no histórico do git.

**Comece por aqui** quando quiser saber o que já foi revisado, o que foi decidido e o que
ficou pendente.

## Índice

| Data | Área revisada | Situação | Arquivo |
|---|---|---|---|
| 22/09/2026 | Módulo Processos (`modules/processos/processos.js` + fronteiras) | Concluída, com pendências registradas | [2026-09-22-processos.md](2026-09-22-processos.md) |
| 22/09/2026 | Vereditos dos revisores sobre a revisão acima | Três rodadas, fechada em 4/4 APROVADO; uma decisão pendente (seção 5.8 do registro) | [2026-09-22-processos-vereditos.md](2026-09-22-processos-vereditos.md) |

## Como registrar uma revisão nova

Crie um arquivo `AAAA-MM-DD-assunto.md` nesta pasta e acrescente uma linha ao índice acima.
Todo arquivo de revisão usa as mesmas seis seções, sempre na mesma ordem:

1. **O que foi revisado** — o alcance combinado, e o que ficou explicitamente fora dele.
2. **O que foi encontrado** — todos os achados, inclusive os que não foram corrigidos.
3. **O que foi corrigido** — com o porquê de cada correção.
4. **O que ficou de fora, e por quê** — as decisões tomadas, com quem decidiu e quando.
5. **O que ainda falta** — pendências, e o que precisa acontecer para destravar cada uma.
6. **Como validar** — o que conferir na tela para saber se a revisão funcionou.

A seção 4 é a que mais importa no longo prazo. Sem ela, um achado deixado de lado por
decisão consciente vira, meses depois, uma falha que "ninguém viu".
