#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gerar_todos_orse.py
===================
Roda o extrator (gerar_stg_orse.py) em lote: varre uma ou mais pastas raiz atras
de planilhas do ORSE (.xls/.xlsx), agrupa por mes (AAAA-MM) e gera **um CSV por
mes** (`stg_orse_AAAA-MM.csv`) juntando SERVICOS (C) + INSUMOS (I).

- O mes de cada arquivo sai do proprio nome (ex. "..._ABRIL_2026.xls" ou
  "..._2026_04.xls"); nome sem mes reconhecivel e ignorado com aviso.
- Varias `--raiz`: a PRIMEIRA que tiver o arquivo de um (mes, tipo) vence.
  (util quando servicos estao numa pasta e insumos noutra.)
- `--backup <csv>`: para (mes, tipo) que nenhuma planilha cobriu, tenta o backup
  CSV pre-reestruturacao (colunas id/.../created_at).

Uso:
    python gerar_todos_orse.py --raiz . \
        --raiz "C:/.../COMPOSICOES/ORSE" \
        --backup "C:/.../backup/orse_itens_2026-09-01.csv" \
        --saida _csv

Depois: para cada CSV, na ORDEM cronologica,
    node subir_stg_orse.mjs "_csv/stg_orse_2025-01.csv"
"""

import argparse
import csv
import os
import re
import sys

from gerar_stg_orse import (COLUNAS, extrair, parse_referencia, tipo_por_nome)


def varrer(raizes):
    """{ (ref, ident): caminho }  -- a 1a raiz que tiver o par vence."""
    achado = {}
    for raiz in raizes:
        for dirpath, _dirs, files in os.walk(raiz):
            for nome in sorted(files):
                if nome.startswith("~$"):
                    continue
                if os.path.splitext(nome)[1].lower() not in (".xls", ".xlsx", ".xlsm"):
                    continue
                ref = parse_referencia(nome)
                ident = tipo_por_nome(nome)
                if ref is None or ident is None:
                    print(f"  ignorado (mes/tipo nao reconhecido): {nome}")
                    continue
                achado.setdefault((ref, ident), os.path.join(dirpath, nome))
    return achado


def do_backup(backup_csv, mes_iso, ident):
    """linhas (dicts no formato de extrair()) de um mes+ident do backup CSV."""
    out = []
    with open(backup_csv, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if not str(row.get("referencia", "")).startswith(mes_iso):
                continue
            if str(row["identificacao"]).strip().upper() != ident:
                continue
            cod = str(row["codigo"]).strip()
            if re.fullmatch(r"\d+\.0+", cod):
                cod = cod.split(".")[0]
            pr = row.get("preco_unitario", "")
            out.append({
                "identificacao": ident,
                "codigo": cod,
                "descricao": row["descricao"],
                "unidade": (row.get("unidade") or None),
                "preco_unitario": (None if pr in ("", None) else float(pr)),
                "tipo_encargo": "onerada",
                "referencia": None,  # so o nome do arquivo importa; ref vira do mes
            })
    return out


def main():
    p = argparse.ArgumentParser(description="Gera um stg_orse_AAAA-MM.csv por mes a partir de pastas raiz.")
    p.add_argument("--raiz", action="append", required=True, help="Pasta raiz (recursivo). Pode repetir.")
    p.add_argument("--backup", help="Backup CSV pre-reestruturacao (fallback p/ mes/tipo sem planilha)")
    p.add_argument("--saida", default="_csv", help="Pasta de saida dos CSV")
    args = p.parse_args()

    achado = varrer(args.raiz)
    if not achado:
        sys.exit("Nenhuma planilha do ORSE reconhecida.")

    meses = sorted({ref for (ref, _i) in achado})
    os.makedirs(args.saida, exist_ok=True)
    print(f"\n{len(meses)} mes(es):")
    for ref in meses:
        mes_iso = ref.isoformat()[:7]
        linhas, cont, origem = [], {}, {}
        for ident in ("C", "I"):
            if (ref, ident) in achado:
                caminho = achado[(ref, ident)]
                regs, _rel = extrair(caminho, ident, ref)
                origem[ident] = os.path.basename(caminho)
            elif args.backup:
                regs = do_backup(args.backup, mes_iso, ident)
                origem[ident] = "backup" if regs else None
            else:
                regs = []
                origem[ident] = None
            for r in regs:
                r["referencia"] = ref
            cont[ident] = len(regs)
            linhas += regs

        vistos, saida = set(), []
        for r in linhas:
            k = (r["identificacao"], r["codigo"])
            if k in vistos:
                continue
            vistos.add(k)
            saida.append(r)

        destino = os.path.join(args.saida, f"stg_orse_{mes_iso}.csv")
        with open(destino, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(COLUNAS)
            for r in saida:
                w.writerow([
                    r["identificacao"], r["codigo"], r["descricao"],
                    "" if r["unidade"] is None else r["unidade"],
                    "" if r["preco_unitario"] is None else f'{r["preco_unitario"]:.2f}',
                    r["tipo_encargo"], r["referencia"].isoformat(),
                ])
        flag = "" if cont.get("I", 0) else "   <-- SEM INSUMOS"
        print(f"  {mes_iso}  C={cont.get('C',0):>6} ({origem.get('C') or '-'})"
              f"  I={cont.get('I',0):>6} ({origem.get('I') or '-'})"
              f"  total={len(saida):>6}{flag}")

    print(f"\nCSVs em: {os.path.abspath(args.saida)}")
    print("Carregue na ordem cronologica:  node subir_stg_orse.mjs \"_csv/stg_orse_AAAA-MM.csv\"")


if __name__ == "__main__":
    main()
