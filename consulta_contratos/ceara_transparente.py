import requests
from bs4 import BeautifulSoup
import urllib3
import json
import re

# Desativa avisos de SSL não verificado
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}


def extrair_ceara_transparente(id_contrato):
    """
    Consulta a página pública do Ceará Transparente (renderizada no servidor, sem
    necessidade de navegador/JS) e extrai os dados do contrato + tabelas de
    Aditivos e Ajustes através da estrutura HTML fixa do portal:
    <div class="content-with-label"><p class="content-label">...</p><p class="content-value">...</p></div>
    """
    url = f"https://www.cearatransparente.ce.gov.br/portal-da-transparencia/contratos/contratos/{id_contrato}?locale=pt-BR"

    try:
        resp = requests.get(url, headers=HEADERS, verify=False, timeout=20)
        if resp.status_code != 200:
            print(f"❌ Erro ao consultar o Ceará Transparente. Status: {resp.status_code}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")

        # --- Campos "label: valor" ---
        campos = {}
        for bloco in soup.select("div.content-with-label"):
            label_tag = bloco.select_one(".content-label")
            value_tag = bloco.select_one(".content-value")
            if not label_tag or not value_tag:
                continue
            label = label_tag.get_text(strip=True)
            valor = value_tag.get_text(separator=" ", strip=True)
            if not valor:
                # campos como "Íntegra do contrato" só têm um ícone dentro do <a>,
                # sem texto; nesse caso o valor útil é o href do link.
                link_tag = value_tag.select_one("a[href]")
                if link_tag:
                    valor = link_tag["href"]
            campos[label] = valor if valor else "N/A"

        def campo(label, default="N/A"):
            return campos.get(label, default)

        # Nº SACC vem no título do card, não em content-label/content-value
        n_sacc = str(id_contrato)
        titulo = soup.select_one(".card-title")
        if titulo:
            match_sacc = re.search(r"N[ºo]\s*SACC:\s*(\d+)", titulo.get_text(strip=True), re.IGNORECASE)
            if match_sacc:
                n_sacc = match_sacc.group(1)

        # --- Tabelas (Aditivos e Ajustes) ---
        def extrair_tabela(data_filename_prefixo):
            tabela = soup.find("table", attrs={"data-filename": re.compile(f"^{data_filename_prefixo}-")})
            if not tabela:
                return []

            cabecalhos = [th.get_text(strip=True) for th in tabela.select("thead th")]
            linhas_extraidas = []
            for tr in tabela.select("tbody tr"):
                celulas = tr.find_all("td")
                if not celulas:
                    continue
                registro = {}
                for i, td in enumerate(celulas):
                    chave = cabecalhos[i] if i < len(cabecalhos) else f"Coluna_{i}"
                    if chave == "Íntegra":
                        link = td.find("a")
                        registro[chave] = link["href"] if link and link.has_attr("href") else "N/A"
                    else:
                        texto = td.get_text(separator=" ", strip=True)
                        registro[chave] = texto if texto else "N/A"
                linhas_extraidas.append(registro)
            return linhas_extraidas

        aditivos_lista = extrair_tabela("aditivos")
        ajustes_lista = extrair_tabela("ajustes")

        contrato_estruturado = {
            "Modulo": "Contrato (Ceará Transparente)",
            "ID_Interno": str(id_contrato),
            "N_SACC": n_sacc,
            "Num_Processo_SPU": campo("Nº do Processo - SPU"),
            "Num_Contrato": campo("Número Contrato"),
            "Situacao_Fisica": campo("Situação Física"),
            "Razao_Social": campo("Contratado"),
            "CNPJ_Contratado": campo("CPF/CNPJ"),
            "Tipo_Objeto": campo("Tipo objeto"),
            "Objeto": campo("Objeto"),
            "Justificativa": campo("Justificativa"),
            "Unidade_Contratante": campo("Unidade"),
            "Contratante": campo("Contratante"),
            "Responsavel_Contrato": campo("Responsável do Contrato"),
            "Fiscal_Contrato": campo("Fiscal do Contrato"),
            "Data_Publicacao_DOE": campo("Data publicação no DOE"),
            "Data_Assinatura": campo("Data de assinatura"),
            "Data_Termino_Original": campo("Data de término original"),
            "Valor_Original": campo("Valor original"),
            "Valor_Aditivo": campo("Valor aditivo"),
            "Valor_Ajuste": campo("Valor ajuste"),
            "Valor_Cancelamento_Restos_Pagar": campo("Valor cancelamento de restos a pagar"),
            "Valor_Atualizado": campo("Valor atualizado"),
            "Valor_Empenhado": campo("Valor empenhado"),
            "Valor_Pago": campo("Valor pago"),
            "Descricao_Edital": campo("Descrição edital"),
            "Modalidade_Licitacao": campo("Modalidade de licitação"),
            "Integra_Contrato": campo("Íntegra do contrato"),
            "Ver_Edital": campo("Ver edital"),
            "Aditivos": aditivos_lista,
            "Ajustes": ajustes_lista,
            "URL": url,
        }

        return [contrato_estruturado]

    except Exception as e:
        print(f"❌ Erro de conexão/parsing no Ceará Transparente: {e}")
        return []


if __name__ == "__main__":
    print("⏳ Consultando o Ceará Transparente (HTML server-side, sem navegador)...")
    dados = extrair_ceara_transparente("412852")
    print("\n================ RESULTADO ESTRUTURADO ================")
    print(json.dumps(dados, indent=4, ensure_ascii=False))
