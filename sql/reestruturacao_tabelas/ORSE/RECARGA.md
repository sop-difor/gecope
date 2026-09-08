# ORSE — recarga do zero (em ordem, com insumos em todo mês)

Motivo: o ORSE foi migrado do legado em 2026-09-01 e nunca mais recebeu carga.
Estado em 2026-09-08:

- 16 referências: **2025-01 … 2025-12, 2026-01, 2026-02, 2026-03, 2026-05**.
- **Falta 2026-04** (lacuna no meio — como 2026-05 já está carregado,
  `rt_aplicar_orse('2026-04-01')` daria *carga fora de ordem*).
- **Faltam 2026-06, 2026-07, 2026-08** (cauda).
- **Insumos só existem em 2025-01 e 2025-12.** Nos outros 14 meses o módulo
  Tabelas mostra zero insumos; 9.243 dos 9.541 insumos do catálogo têm buraco
  de presença.

A recarga do zero resolve os três de uma vez.

## 1. Fontes por mês

| Mês | Origem do CSV | Situação |
|---|---|---|
| 2025-01 | `stg_do_backup.py` (backup CSV) | pronto — serviços não estão em `.xls` no PC |
| 2025-02 … 2025-11 | `gerar_stg_orse.py` (`.xls` serviços+insumos) | pronto |
| 2025-12 | `stg_do_backup.py` (backup CSV) | pronto — `.xls` não estão no PC |
| 2026-01 … 2026-05 | `gerar_stg_orse.py` (`.xls` serviços+insumos) | pronto (inclui 2026-04) |
| 2026-06 / 07 / 08 | `gerar_stg_orse.py` | **baixar do ORSE** (serviços + insumos) |
| 2026-09 | idem | conferir se já foi publicado |

Backup CSV: `C:\Users\99030487\Desktop\backup\orse_itens_2026-09-01.csv`.

### Gerar os CSVs que já dá

```
cd sql/reestruturacao_tabelas/ORSE
python gerar_todos_orse.py --raiz "C:/Users/99030487/Desktop/COMPOSIÇÕES/ORSE" --saida _csv
python stg_do_backup.py "C:/Users/99030487/Desktop/backup/orse_itens_2026-09-01.csv" 2025-01 --saida _csv
python stg_do_backup.py "C:/Users/99030487/Desktop/backup/orse_itens_2026-09-01.csv" 2025-12 --saida _csv
```

Fica um `_csv/stg_orse_AAAA-MM.csv` por mês (2025-01 … 2026-05).

### Baixar o que falta

No site do ORSE, baixar para uma pasta por mês:
`ORSE_Custo_ref_SERVIÇOS_JUNHO_2026.xls` e `ORSE_Custo_ref_INSUMOS_JUNHO_2026.xls`
(idem julho, agosto e — se houver — setembro). Depois:

```
python gerar_stg_orse.py --pasta "CAMINHO/DA/PASTA/2026-06"   # e 07, 08, 09
```

## 2. Recarregar

Pré-requisitos: `_csv/` com **todos** os meses em sequência (sem furo), e
`db-url.local` nesta pasta (string de conexão *Session*, porta 5432).

> Destrutivo. A view `orse_itens` fica vazia durante a recarga (~1–2 min).
> Fazer fora do horário de uso.

**Um comando** (zera + carrega todos os `_csv/stg_orse_*.csv` na ordem):

```
node recarregar_orse.mjs --confirmar
```

- sem `--confirmar` → só lista o que faria.
- `--de 2026-05` → retoma a partir daquele mês, **sem** zerar (para consertar
  uma carga interrompida).
- `--so-verificar` → mostra o estado atual e sai.

Equivale, manualmente, a rodar no SQL Editor:

```sql
TRUNCATE orse_preco, orse_descricao, orse_item_presenca, orse_item;
DELETE FROM referencia_carregada WHERE fonte='ORSE';
TRUNCATE stg_orse;
```

e depois `node subir_stg_orse.mjs "_csv/stg_orse_AAAA-MM.csv"` para cada mês, em ordem.

## 3. Conferir

```sql
SELECT referencia_label FROM referencia_carregada WHERE fonte='ORSE' ORDER BY referencia_ord;

SELECT referencia,
       count(*) FILTER (WHERE identificacao='C') servicos,
       count(*) FILTER (WHERE identificacao='I') insumos,
       count(*) FILTER (WHERE preco_unitario IS NULL) preco_nulo,
       count(*) total
FROM orse_itens GROUP BY referencia ORDER BY referencia;

-- nenhum código com buraco de presença deve sobrar por falta de insumo:
SELECT count(*) FROM (
  SELECT p.codigo FROM orse_item_presenca p GROUP BY p.codigo HAVING count(*) > 1
) t;
```

Esperado: serviços ~9,7k→9,9k e **insumos ~9,3k→9,5k em todos os meses**;
`preco_nulo` 1–2 por mês (herdado do legado); poucos códigos com presença
fragmentada (itens realmente descontinuados).

Depois: `get_advisors` (security) sem aviso novo; conferir `pg_database_size`.
Testar no módulo Tabelas: buscar um insumo em 2025-06 (antes não aparecia).
