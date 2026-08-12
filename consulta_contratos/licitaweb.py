import requests
from bs4 import BeautifulSoup
import urllib3
import json
import re

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def extrair_licitaweb(nu_publicacao):
    """Extrai os dados de licitação do portal Licitaweb da Sefaz/CE."""
    url = f"https://s2gpr.sefaz.ce.gov.br/licita-web/paginas/licita/Publicacao.seam?nuPublicacao={nu_publicacao}"
    
    try:
        resp = requests.get(url, headers=headers, verify=False)
        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, 'html.parser')
        texto = soup.get_text(separator=" ", strip=True)

        def extrair_campo(pattern, texto_busca, default="N/A"):
            match = re.search(pattern, texto_busca, re.IGNORECASE | re.DOTALL)
            if match:
                res = match.group(1).strip()
                return re.sub(r'\s+', ' ', res)
            return default

        orgao = extrair_campo(r"Órgão/Entidade Contratante:\s*(.*?)\s*Gestor Contratante:", texto)
        gestor = extrair_campo(r"Gestor Contratante:\s*(.*?)\s*Nº da Publicação:", texto)
        processo = extrair_campo(r"Nº Processo:\s*(.*?)\s*Nº do Edital:", texto)
        edital = extrair_campo(r"Nº do Edital:\s*(\d+)", texto)
        if edital == "N/A":
            edital = extrair_campo(r"Nº do Edital:\s*(.*?)\s*Tipo de Julgamento:", texto)
            
        objeto = extrair_campo(r"Objeto da Contratação\s*(.*?)\s*Outras disposições", texto)

        tot_estimado = extrair_campo(r"Informações de Resultados\s*([\d\.,]+)", texto)
        tot_contratado = extrair_campo(r"Total Contratado:\s*([\d\.,]+)", texto)
        if tot_estimado == "N/A" and tot_contratado != "N/A":
            tot_estimado = tot_contratado

        bloco_itens = extrair_campo(r"Itens\s*(.*?)(?=Certidão de Publicação|Retornar para Pesquisa|$)", texto)
        match_fornecedor = re.search(r"Vencedor:\s*([\d\.\/-]+)\s*\|\s*([^1-9]+?)(?=\d+,00|\d{1,3}(?:\.\d{3})*,\d{2}|$)", bloco_itens)
        cnpj = match_fornecedor.group(1).strip() if match_fornecedor else "N/A"
        razao_social = match_fornecedor.group(2).strip() if match_fornecedor else "N/A"

        return [{
            "Modulo": "Licitação (Licitaweb)",
            "Identificador": nu_publicacao,
            "Orgao": orgao,
            "Gestor": gestor,
            "Num_Processo": processo,
            "Num_Edital": edital,
            "Objeto": objeto,
            "CNPJ_Contratado": cnpj,
            "Razao_Social": razao_social,
            "Valor_Estimado": tot_estimado,
            "Valor_Contratado": tot_contratado,
            "Status": "Declarado Vencedor",
            "URL": url
        }]

    except Exception as e:
        print(f"Erro ao processar Licitaweb: {e}")
        return []

if __name__ == "__main__":
    # Teste isolado do Licitaweb
    dados = extrair_licitaweb("2021/06225")
    print(json.dumps(dados, indent=4, ensure_ascii=False))