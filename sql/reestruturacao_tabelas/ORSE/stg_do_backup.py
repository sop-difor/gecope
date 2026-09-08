#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stg_do_backup.py
================
Recorta um mes do backup CSV pre-reestruturacao (`orse_itens_AAAA-MM-DD.csv`,
com colunas id/.../created_at) para o formato da area de recebimento `stg_orse`.

Serve para os meses que ja estao no banco mas cujas planilhas .xls nao estao mais
no computador (ex. 2025-01 servicos, 2025-12). Assim a recarga limpa consegue
reproduzi-los sem baixar de novo do ORSE.

Uso:
    python stg_do_backup.py "C:/.../backup/orse_itens_2026-09-01.csv" 2025-12 --saida _csv
    python stg_do_backup.py "<backup.csv>" 2025-01 --saida _csv

Gera `stg_orse_AAAA-MM.csv` (7 colunas, tipo_encargo normalizado para 'onerada',
codigo de insumo sem '.0').
"""

import argparse
import csv
import os
import re
import sys

COLUNAS = ["identificacao", "codigo", "descricao", "unidade",
           "preco_unitario", "tipo_encargo", "referencia"]


def norm_codigo(s):
    s = str(s).strip()
    return s.split(".")[0] if re.fullmatch(r"\d+\.0+", s) else s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("backup_csv")
    ap.add_argument("mes", help="AAAA-MM")
    ap.add_argument("--saida", default="_csv")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.mes):
        sys.exit("mes deve ser AAAA-MM")
    if not os.path.isfile(args.backup_csv):
        sys.exit(f"nao achei {args.backup_csv}")

    os.makedirs(args.saida, exist_ok=True)
    destino = os.path.join(args.saida, f"stg_orse_{args.mes}.csv")
    n, cont = 0, {"C": 0, "I": 0}
    with open(args.backup_csv, encoding="utf-8", newline="") as fin, \
         open(destino, "w", encoding="utf-8", newline="") as fout:
        r = csv.DictReader(fin)
        w = csv.writer(fout)
        w.writerow(COLUNAS)
        for row in r:
            if not str(row.get("referencia", "")).startswith(args.mes):
                continue
            ident = str(row["identificacao"]).strip().upper()
            enc = str(row.get("tipo_encargo", "")).strip().lower()
            enc = "desonerada" if enc.startswith("desoner") else "onerada"
            w.writerow([
                ident,
                norm_codigo(row["codigo"]),
                row["descricao"],
                row.get("unidade", "") or "",
                row.get("preco_unitario", "") or "",
                enc,
                f"{args.mes}-01",
            ])
            n += 1
            cont[ident] = cont.get(ident, 0) + 1

    if n == 0:
        os.remove(destino)
        sys.exit(f"nenhuma linha de {args.mes} no backup.")
    print(f"OK -> {destino}   {n} linhas  (C={cont.get('C',0)}  I={cont.get('I',0)})")


if __name__ == "__main__":
    main()
