# ORSE — carga mensal

Formato do CSV e regras gerais: ver `../COMO_CARREGAR.md`.

O sistema lê a **view** `orse_itens`, montada sobre o modelo enxuto
(`orse_item`, `orse_item_presenca`, `orse_descricao`, `orse_preco`).
`orse_itens` **não é mais tabela** — não dá para `INSERT`/`DELETE` nela.

> O antigo `motor_orse.py` (na pasta `COMPOSIÇÕES/ORSE`) gravava direto em
> `public.orse_itens` e ficou **obsoleto**. Use os scripts desta pasta.

## O que entra em cada mês

Dois arquivos do ORSE, **serviços e insumos**:

| Arquivo | `identificacao` |
|---|---|
| `ORSE_Custo_ref_SERVIÇOS_<MÊS>_<ANO>.xls` | `C` |
| `ORSE_Custo_ref_INSUMOS_<MÊS>_<ANO>.xls` | `I` |

Baixe os dois de <https://orse.cehop.se.gov.br> (Relatórios → Custos de
Referência). O ORSE não tem "abre" analítico — a receita fica no link externo,
então **não há coluna `composicao`**. `tipo_encargo` é sempre `onerada`.

## 1. Gerar o CSV

Dependência (uma vez): `python -m pip install xlrd openpyxl`.

**Um mês:**

```
python gerar_stg_orse.py --pasta "CAMINHO/DA/PASTA/DO/MÊS"
# ou explícito:
python gerar_stg_orse.py --mes 2026-06 \
  --servicos "CAMINHO/ORSE_Custo_ref_SERVIÇOS_JUNHO_2026.xls" \
  --insumos  "CAMINHO/ORSE_Custo_ref_INSUMOS_JUNHO_2026.xls"
```

Saída: **`stg_orse_AAAA-MM.csv`** (serviços + insumos juntos, 7 colunas, no
formato de `stg_orse`). Confira o resumo (linhas C / I, sem preço).

**Vários meses de uma vez** (varre uma pasta raiz recursivamente):

```
python gerar_todos_orse.py --raiz "C:/.../COMPOSIÇÕES/ORSE" --saida _csv
```

**Mês que só está no banco (planilha perdida):** recorta do backup CSV
pré‑reestruturação —

```
python stg_do_backup.py "C:/.../backup/orse_itens_2026-09-01.csv" 2025-12 --saida _csv
```

## 2. Subir o CSV e carregar

Crie um **`db-url.local`** nesta pasta (ou na de cima) com a string de conexão
do banco — Supabase → Project Settings → Database → Connection string
(modo *Session*, porta 5432), com a senha no lugar de `[YOUR-PASSWORD]`. Então:

```
node subir_stg_orse.mjs "_csv/stg_orse_2026-06.csv"
```

Faz tudo: `TRUNCATE stg_orse` → `COPY` do CSV → `SELECT rt_aplicar_orse('2026-06-01')`
(a data sai do nome do arquivo). `--so-carregar` para antes do `rt_aplicar_orse`.
Dependências (`pg`) já estão em `../node_modules`.

**Alternativa pela tela do Supabase:** `carga_orse_manual.sql`.

## 3. Conferir

```sql
SELECT count(*) FROM orse_itens WHERE referencia = '2026-06-01';
SELECT referencia_label FROM referencia_carregada WHERE fonte='ORSE' ORDER BY referencia_ord;
```

Ou no módulo **Tabelas** do sistema (escolher a versão, buscar, ver um insumo).

## Regras e travas

- **Ordem cronológica** — carregue do mês mais antigo para o mais novo. Mês
  anterior a um já carregado → erro `carga fora de ordem`.
- **Sem repetir** — a mesma referência duas vezes → erro.
- Erro no meio → nada é gravado (transação volta atrás).

## Recarga do zero

Ver **`RECARGA.md`** (procedimento completo, com a lista de meses/arquivos).

## Arquivos desta pasta

| Arquivo | O quê |
|---|---|
| `gerar_stg_orse.py` | Extrator: planilhas `.xls` de um mês → `stg_orse_AAAA-MM.csv` |
| `gerar_todos_orse.py` | Roda o extrator em lote sobre uma pasta raiz |
| `stg_do_backup.py` | Recorta um mês do backup CSV pré‑reestruturação |
| `subir_stg_orse.mjs` | Sobe **um** CSV (`COPY`) e roda `rt_aplicar_orse` — precisa de `db-url.local` |
| `recarregar_orse.mjs` | Recarga do zero: zera o ORSE e carrega todos os `_csv/*.csv` em ordem (`--confirmar`) |
| `carga_orse_manual.sql` | Comandos SQL para carga manual pela tela do Supabase |
| `RECARGA.md` | Procedimento de recarga do ORSE do zero |
| `db-url.local` | (você cria) string de conexão — **não versionado** |
| `_csv/stg_orse_*.csv` | (gerado) — **não versionado** |
