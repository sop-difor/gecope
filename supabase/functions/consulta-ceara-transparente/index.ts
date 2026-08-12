// supabase/functions/consulta-ceara-transparente/index.ts
//
// Consulta pública ao Ceará Transparente (portal-da-transparencia). A página de detalhe
// do contrato é renderizada 100% no servidor (Rails) — não há necessidade de navegador
// headless. Todo campo segue o padrão fixo:
//   <div class="content-with-label"><p class="content-label">Label</p><p class="content-value">Valor</p></div>
// e os Aditivos/Ajustes ficam em <table data-filename="aditivos-...">/"ajustes-...">.
// Porte fiel de consulta_contratos/ceara_transparente.py (validado manualmente contra o
// contrato SACC 1164451 / id 412852 antes deste porte).
//
// Entrada (POST JSON): { sacc?: string|number, id?: string|number }
//   - id: id interno do Ceará Transparente (o número na URL /contratos/contratos/{id})
//   - sacc: nº SACC do contrato (ex.: o campo "SAC" já existente em contratos_edificacao).
//     Quando só o SACC é informado, a função primeiro resolve o id via busca no portal
//     (filtro search_sacc da listagem pública) e depois consulta o detalhe.
//
// Deploy:  supabase functions deploy consulta-ceara-transparente --no-verify-jwt
// (função apenas repassa dados públicos do portal; não toca no banco, não precisa de secrets)

const BASE = "https://www.cearatransparente.ce.gov.br";
const HEADERS_HTML = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// --- helpers de parsing (regex, sem dependência de DOM parser) ---

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extrairCampos(html: string): Record<string, string> {
  const campos: Record<string, string> = {};
  const re =
    /<div class=["']content-with-label["']>\s*<p class=["']content-label["']>([\s\S]*?)<\/p>\s*<p class=["']content-value["']>([\s\S]*?)<\/p>\s*<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = stripTags(m[1]);
    const rawValor = m[2];
    let valor = stripTags(rawValor);
    // campos como "Íntegra do contrato" só têm um ícone dentro do <a>, sem texto;
    // nesse caso o valor útil é o href do link, não o texto (que fica vazio).
    if (!valor) {
      const linkMatch = /<a[^>]+href=["']([^"']+)["']/i.exec(rawValor);
      if (linkMatch) valor = linkMatch[1];
    }
    campos[label] = valor || "N/A";
  }
  return campos;
}

function extrairTabela(html: string, prefixo: string): Record<string, string>[] {
  const tableRe = new RegExp(
    `<table[^>]*data-filename=["']${prefixo}-[^"']*["'][^>]*>([\\s\\S]*?)<\\/table>`,
    "i"
  );
  const tableMatch = tableRe.exec(html);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[1];

  const theadMatch = /<thead>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const cabecalhos: string[] = [];
  if (theadMatch) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let th: RegExpExecArray | null;
    while ((th = thRe.exec(theadMatch[1])) !== null) cabecalhos.push(stripTags(th[1]));
  }

  const tbodyMatch = /<tbody>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  if (!tbodyMatch) return [];

  const linhas: Record<string, string>[] = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tbodyMatch[1])) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const celulas: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1])) !== null) celulas.push(td[1]);
    if (celulas.length === 0) continue;

    const registro: Record<string, string> = {};
    celulas.forEach((cel, i) => {
      const chave = cabecalhos[i] || `Coluna_${i}`;
      if (chave === "Íntegra") {
        const linkMatch = /<a[^>]+href=["']([^"']+)["']/i.exec(cel);
        registro[chave] = linkMatch ? linkMatch[1] : "N/A";
      } else {
        const texto = stripTags(cel);
        registro[chave] = texto || "N/A";
      }
    });
    linhas.push(registro);
  }
  return linhas;
}

async function buscarContratoPorId(id: string, debug = false) {
  const url = `${BASE}/portal-da-transparencia/contratos/contratos/${id}?locale=pt-BR`;
  const resp = await fetch(url, { headers: HEADERS_HTML });
  if (!resp.ok) {
    return { ok: false, status: "error", message: `Ceará Transparente respondeu HTTP ${resp.status}` };
  }
  const html = await resp.text();
  if (debug) {
    return {
      ok: true,
      debug: {
        status: resp.status,
        redirected: resp.redirected,
        finalUrl: resp.url,
        headers: Object.fromEntries(resp.headers.entries()),
        len: html.length,
        sample: html.slice(0, 1500),
      },
    };
  }
  const campos = extrairCampos(html);
  const campo = (label: string) => campos[label] ?? "N/A";

  let n_sacc = String(id);
  const tituloMatch = /<h2 class=["']card-title["']>([\s\S]*?)<\/h2>/i.exec(html);
  if (tituloMatch) {
    const saccMatch = /N[ºo]\s*SACC:\s*(\d+)/i.exec(stripTags(tituloMatch[1]));
    if (saccMatch) n_sacc = saccMatch[1];
  }

  const contrato = {
    Modulo: "Contrato (Ceará Transparente)",
    ID_Interno: String(id),
    N_SACC: n_sacc,
    Num_Processo_SPU: campo("Nº do Processo - SPU"),
    Num_Contrato: campo("Número Contrato"),
    Situacao_Fisica: campo("Situação Física"),
    Razao_Social: campo("Contratado"),
    CNPJ_Contratado: campo("CPF/CNPJ"),
    Tipo_Objeto: campo("Tipo objeto"),
    Objeto: campo("Objeto"),
    Justificativa: campo("Justificativa"),
    Unidade_Contratante: campo("Unidade"),
    Contratante: campo("Contratante"),
    Responsavel_Contrato: campo("Responsável do Contrato"),
    Fiscal_Contrato: campo("Fiscal do Contrato"),
    Data_Publicacao_DOE: campo("Data publicação no DOE"),
    Data_Assinatura: campo("Data de assinatura"),
    Data_Termino_Original: campo("Data de término original"),
    Valor_Original: campo("Valor original"),
    Valor_Aditivo: campo("Valor aditivo"),
    Valor_Ajuste: campo("Valor ajuste"),
    Valor_Cancelamento_Restos_Pagar: campo("Valor cancelamento de restos a pagar"),
    Valor_Atualizado: campo("Valor atualizado"),
    Valor_Empenhado: campo("Valor empenhado"),
    Valor_Pago: campo("Valor pago"),
    Descricao_Edital: campo("Descrição edital"),
    Modalidade_Licitacao: campo("Modalidade de licitação"),
    Integra_Contrato: campo("Íntegra do contrato"),
    Ver_Edital: campo("Ver edital"),
    Aditivos: extrairTabela(html, "aditivos"),
    Ajustes: extrairTabela(html, "ajustes"),
    URL: url,
  };

  return { ok: true, contrato };
}

async function resolverIdPorSacc(sacc: string) {
  const listUrl = `${BASE}/portal-da-transparencia/contratos/contratos?locale=pt-BR&search_sacc=${encodeURIComponent(sacc)}`;
  const resp = await fetch(listUrl, {
    headers: {
      ...HEADERS_HTML,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/javascript, application/javascript, application/ecmascript, */*; q=0.01",
    },
  });
  if (!resp.ok) {
    return { ok: false, status: "error", message: `Busca no Ceará Transparente falhou (HTTP ${resp.status})` };
  }
  const html = await resp.text();

  const idsEncontrados: string[] = [];
  const linkRe = /\/portal-da-transparencia\/contratos\/contratos\/(\d+)\?locale=pt-BR/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    if (!idsEncontrados.includes(m[1])) idsEncontrados.push(m[1]);
  }

  if (idsEncontrados.length === 0) {
    return { ok: false, status: "not_found", message: `Nenhum contrato encontrado para o SACC ${sacc}` };
  }
  if (idsEncontrados.length > 1) {
    return {
      ok: false,
      status: "multiple",
      message: `Mais de um contrato encontrado para o SACC ${sacc}. Informe o ID diretamente.`,
      ids: idsEncontrados,
    };
  }
  return { ok: true, id: idsEncontrados[0] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sacc = body?.sacc ? String(body.sacc).trim() : "";
    const idDireto = body?.id ? String(body.id).trim() : "";

    if (!sacc && !idDireto) {
      return jsonResponse({ ok: false, message: "Informe 'sacc' ou 'id'." }, 400);
    }

    let id = idDireto;
    if (!id) {
      const resolvido = await resolverIdPorSacc(sacc);
      if (!resolvido.ok) return jsonResponse(resolvido, resolvido.status === "error" ? 502 : 404);
      id = resolvido.id!;
    }

    const resultado = await buscarContratoPorId(id, !!body?.debug);
    if (!resultado.ok) return jsonResponse(resultado, 502);
    return jsonResponse(resultado);
  } catch (e) {
    return jsonResponse({ ok: false, message: String(e?.message || e) }, 500);
  }
});
