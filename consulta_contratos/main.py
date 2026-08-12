import json
import pandas as pd
from licitaweb import extrair_licitaweb
from ceara_transparente import extrair_ceara_transparente

if __name__ == "__main__":
    todos_os_dados = []

    print("⏳ 1/2 Extraindo Licitação do Licitaweb...")
    dados_licitaweb = extrair_licitaweb("2021/06225")
    todos_os_dados.extend(dados_licitaweb)

    print("⏳ 2/2 Extraindo Contrato do Ceará Transparente...")
    dados_ceara = extrair_ceara_transparente("412852")
    todos_os_dados.extend(dados_ceara)

    print("\n================ DADOS ESTRUTURADOS CONSOLIDADOS ================")
    print(json.dumps(todos_os_dados, indent=4, ensure_ascii=False))

    if todos_os_dados:
        df = pd.DataFrame(todos_os_dados)
        df.to_excel("relatorio_contratos_licitacoes.xlsx", index=False)
        print("\n🎉 Planilha 'relatorio_contratos_licitacoes.xlsx' gerada com sucesso!")