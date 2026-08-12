require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;
// Se definida, exige o header x-api-key em /consulta (protege contra scraping por terceiros).
const API_KEY = process.env.CONSULTA_API_KEY || '';

const BASE = 'https://www.cearatransparente.ce.gov.br';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Sessão com o Chromium headless
//
// O Ceará Transparente fica atrás de um AWS WAF com desafio JS (Bot Control):
// requisições HTTP simples (fetch/requests) vindas de infra de nuvem tomam
// HTTP 202 + challenge.js, sem conteúdo algum. Um navegador real resolve esse
// desafio sozinho ao carregar a página e recebe um cookie de sessão válido.
// Por isso mantemos UM browser/contexto vivo (cookie "quente") e reaproveitamos
// esse contexto para requisições HTTP leves via context.request — só voltamos
// a abrir uma página de verdade quando o cookie expira/falha.
// ---------------------------------------------------------------------------
let browser = null;
let context = null;
let primingPromise = null;

async function primeWafCookie() {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/portal-da-transparencia/contratos/contratos?locale=pt-BR`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
  } finally {
    await page.close();
  }
}

async function ensureContext() {
  if (context) return context;
  if (!primingPromise) {
    primingPromise = (async () => {
      browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      // ignoreHTTPSErrors: o Chromium navegado (page.goto) confia na cadeia de certificados
      // local/corporativa, mas a API leve context.request tem verificação própria e rejeita
      // ("self-signed certificate in certificate chain"). O script Python original (validado
      // manualmente) já usava verify=False para este mesmo site, então seguimos o mesmo padrão.
      context = await browser.newContext({ userAgent: UA, locale: 'pt-BR', ignoreHTTPSErrors: true });
      await primeWafCookie();
    })();
  }
  await primingPromise;
  return context;
}

function pareceDesafioWaf(status, html) {
  return status === 202 || html.includes('awswaf.com') || html.includes('AwsWafIntegration');
}

// GET com o cookie de sessão do contexto; se cair no desafio do WAF (cookie
// expirado), reabre uma página real uma vez para renovar e tenta de novo.
async function getHtml(url, extraHeaders = {}) {
  await ensureContext();
  let resp = await context.request.get(url, { headers: extraHeaders });
  let html = await resp.text();

  if (pareceDesafioWaf(resp.status(), html)) {
    await primeWafCookie();
    resp = await context.request.get(url, { headers: extraHeaders });
    html = await resp.text();
  }

  return { status: resp.status(), html };
}

// --- parsing (mesmo formato validado em consulta_contratos/ceara_transparente.py) ---

// Entidades nomeadas ISO-8859-1 usadas pelo Licitaweb (app JSF/Seam antiga que
// serializa acentos como &ccedil;/&atilde;/etc. em vez de UTF-8 puro).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', auml: 'ä', Auml: 'Ä',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê', euml: 'ë', Euml: 'Ë',
  iacute: 'í', Iacute: 'Í', igrave: 'ì', Igrave: 'Ì', icirc: 'î', Icirc: 'Î', iuml: 'ï', Iuml: 'Ï',
  oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', ouml: 'ö', Ouml: 'Ö',
  uacute: 'ú', Uacute: 'Ú', ugrave: 'ù', Ugrave: 'Ù', ucirc: 'û', Ucirc: 'Û', uuml: 'ü', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ',
  ordm: 'º', ordf: 'ª', deg: '°', sect: '§', middot: '·',
  sup1: '¹', sup2: '²', sup3: '³',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (full, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : full;
    }
    return NAMED_ENTITIES[ent] ?? full;
  });
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extrairCampos(html) {
  const campos = {};
  const re =
    /<div class=["']content-with-label["']>\s*<p class=["']content-label["']>([\s\S]*?)<\/p>\s*<p class=["']content-value["']>([\s\S]*?)<\/p>\s*<\/div>/g;
  let m;
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
    campos[label] = valor || 'N/A';
  }
  return campos;
}

function extrairTabela(html, prefixo) {
  const tableRe = new RegExp(
    `<table[^>]*data-filename=["']${prefixo}-[^"']*["'][^>]*>([\\s\\S]*?)<\\/table>`,
    'i'
  );
  const tableMatch = tableRe.exec(html);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[1];

  const theadMatch = /<thead>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const cabecalhos = [];
  if (theadMatch) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let th;
    while ((th = thRe.exec(theadMatch[1])) !== null) cabecalhos.push(stripTags(th[1]));
  }

  const tbodyMatch = /<tbody>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  if (!tbodyMatch) return [];

  const linhas = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(tbodyMatch[1])) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const celulas = [];
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) celulas.push(td[1]);
    if (celulas.length === 0) continue;

    const registro = {};
    celulas.forEach((cel, i) => {
      const chave = cabecalhos[i] || `Coluna_${i}`;
      if (chave === 'Íntegra') {
        const linkMatch = /<a[^>]+href=["']([^"']+)["']/i.exec(cel);
        registro[chave] = linkMatch ? linkMatch[1] : 'N/A';
      } else {
        const texto = stripTags(cel);
        registro[chave] = texto || 'N/A';
      }
    });
    linhas.push(registro);
  }
  return linhas;
}

async function buscarContratoPorId(id) {
  const url = `${BASE}/portal-da-transparencia/contratos/contratos/${id}?locale=pt-BR`;
  const { status, html } = await getHtml(url);
  if (status !== 200) {
    return { ok: false, status: 'error', message: `Ceará Transparente respondeu HTTP ${status}` };
  }

  const campos = extrairCampos(html);
  const campo = (label) => campos[label] ?? 'N/A';

  let n_sacc = String(id);
  const tituloMatch = /<h2 class=["']card-title["']>([\s\S]*?)<\/h2>/i.exec(html);
  if (tituloMatch) {
    const saccMatch = /N[ºo]\s*SACC:\s*(\d+)/i.exec(stripTags(tituloMatch[1]));
    if (saccMatch) n_sacc = saccMatch[1];
  }

  const contrato = {
    Modulo: 'Contrato (Ceará Transparente)',
    ID_Interno: String(id),
    N_SACC: n_sacc,
    Num_Processo_SPU: campo('Nº do Processo - SPU'),
    Num_Contrato: campo('Número Contrato'),
    Situacao_Fisica: campo('Situação Física'),
    Razao_Social: campo('Contratado'),
    CNPJ_Contratado: campo('CPF/CNPJ'),
    Tipo_Objeto: campo('Tipo objeto'),
    Objeto: campo('Objeto'),
    Justificativa: campo('Justificativa'),
    Unidade_Contratante: campo('Unidade'),
    Contratante: campo('Contratante'),
    Responsavel_Contrato: campo('Responsável do Contrato'),
    Fiscal_Contrato: campo('Fiscal do Contrato'),
    Data_Publicacao_DOE: campo('Data publicação no DOE'),
    Data_Assinatura: campo('Data de assinatura'),
    Data_Termino_Original: campo('Data de término original'),
    Valor_Original: campo('Valor original'),
    Valor_Aditivo: campo('Valor aditivo'),
    Valor_Ajuste: campo('Valor ajuste'),
    Valor_Cancelamento_Restos_Pagar: campo('Valor cancelamento de restos a pagar'),
    Valor_Atualizado: campo('Valor atualizado'),
    Valor_Empenhado: campo('Valor empenhado'),
    Valor_Pago: campo('Valor pago'),
    Descricao_Edital: campo('Descrição edital'),
    Modalidade_Licitacao: campo('Modalidade de licitação'),
    Integra_Contrato: campo('Íntegra do contrato'),
    Ver_Edital: campo('Ver edital'),
    Aditivos: extrairTabela(html, 'aditivos'),
    Ajustes: extrairTabela(html, 'ajustes'),
    URL: url,
  };

  return { ok: true, contrato };
}

async function resolverIdPorSacc(sacc) {
  const listUrl = `${BASE}/portal-da-transparencia/contratos/contratos?locale=pt-BR&search_sacc=${encodeURIComponent(
    sacc
  )}`;
  const { status, html } = await getHtml(listUrl, {
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'text/javascript, application/javascript, application/ecmascript, */*; q=0.01',
  });
  if (status !== 200) {
    return { ok: false, status: 'error', message: `Busca no Ceará Transparente falhou (HTTP ${status})` };
  }

  const idsEncontrados = [];
  const linkRe = /\/portal-da-transparencia\/contratos\/contratos\/(\d+)\?locale=pt-BR/g;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    if (!idsEncontrados.includes(m[1])) idsEncontrados.push(m[1]);
  }

  if (idsEncontrados.length === 0) {
    return { ok: false, status: 'not_found', message: `Nenhum contrato encontrado para o SACC ${sacc}` };
  }
  if (idsEncontrados.length > 1) {
    return {
      ok: false,
      status: 'multiple',
      message: `Mais de um contrato encontrado para o SACC ${sacc}. Informe o ID diretamente.`,
      ids: idsEncontrados,
    };
  }
  return { ok: true, id: idsEncontrados[0] };
}

// --- Licitaweb (S2GPR/Sefaz-CE) — página do edital linkada em "Ver edital" ---
// Sistema JSF/Seam antigo, sem WAF; os campos ficam em blocos
// <div class="prop"><div class="name">Label</div><div class="value">Valor</div></div>
// e as tabelas (Dotação Orçamentária, Documentos) são <table id="...">.

function extrairPropsLicitaweb(html) {
  const campos = {};
  const re =
    /<div class="prop"[^>]*>\s*<div class="name[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="value[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = stripTags(m[1]).replace(/:\s*$/, '').trim();
    const valor = stripTags(m[2]).trim();
    if (label) campos[label] = valor || 'N/A';
  }
  return campos;
}

function extrairTabelaPorId(html, idSubstr) {
  const tableRe = new RegExp(`<table[^>]*id=["'][^"']*${idSubstr}[^"']*["'][^>]*>([\\s\\S]*?)<\\/table>`, 'i');
  const tableMatch = tableRe.exec(html);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[1];

  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const cabecalhos = [];
  if (theadMatch) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let th;
    while ((th = thRe.exec(theadMatch[1])) !== null) cabecalhos.push(stripTags(th[1]));
  }

  const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  if (!tbodyMatch) return [];

  const linhas = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(tbodyMatch[1])) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const celulas = [];
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) celulas.push(stripTags(td[1]));
    if (celulas.length === 0) continue;

    const registro = {};
    celulas.forEach((texto, i) => {
      const chave = cabecalhos[i] || `Coluna_${i}`;
      registro[chave] = texto || 'N/A';
    });
    linhas.push(registro);
  }
  return linhas;
}

async function buscarLicitaweb(url) {
  await ensureContext();
  const resp = await context.request.get(url);
  if (resp.status() !== 200) {
    return { ok: false, status: 'error', message: `Licitaweb respondeu HTTP ${resp.status()}` };
  }
  // A página declara ISO-8859-1; decodificar os bytes crus como latin1 preserva
  // eventuais acentos "soltos" (não vêm todos como entidade &xxx;).
  const buf = await resp.body();
  const html = buf.toString('latin1');

  const campos = extrairPropsLicitaweb(html);
  const dotacao = extrairTabelaPorId(html, 'tabelaClassificacaoOrcamentaria');
  const documentos = extrairTabelaPorId(html, 'arquivoProcessoTable').map((linha) => {
    // primeira coluna é só o checkbox de seleção (sem cabeçalho) — descarta
    const { Coluna_0, ...resto } = linha;
    return resto;
  });

  return {
    ok: true,
    edital: {
      Campos: campos,
      Dotacao_Orcamentaria: dotacao,
      Documentos: documentos,
      URL: url,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.status(200).send('ok'));

app.post('/consulta', async (req, res) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ ok: false, message: 'x-api-key inválida ou ausente' });
  }

  try {
    const sacc = req.body?.sacc ? String(req.body.sacc).trim() : '';
    const idDireto = req.body?.id ? String(req.body.id).trim() : '';
    if (!sacc && !idDireto) {
      return res.status(400).json({ ok: false, message: "Informe 'sacc' ou 'id'." });
    }

    let id = idDireto;
    if (!id) {
      const resolvido = await resolverIdPorSacc(sacc);
      if (!resolvido.ok) {
        return res.status(resolvido.status === 'error' ? 502 : 404).json(resolvido);
      }
      id = resolvido.id;
    }

    const resultado = await buscarContratoPorId(id);
    if (!resultado.ok) return res.status(502).json(resultado);
    return res.json(resultado);
  } catch (e) {
    console.error('consulta error', e);
    return res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

app.post('/edital', async (req, res) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ ok: false, message: 'x-api-key inválida ou ausente' });
  }

  try {
    const url = req.body?.url ? String(req.body.url).trim() : '';
    if (!url) {
      return res.status(400).json({ ok: false, message: "Informe 'url'." });
    }
    // só aceita o host do Licitaweb: o endpoint busca a URL recebida do cliente
    // no servidor, então precisa ficar restrito para não virar proxy aberto (SSRF).
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ ok: false, message: "'url' inválida." });
    }
    if (parsed.hostname !== 's2gpr.sefaz.ce.gov.br') {
      return res.status(400).json({ ok: false, message: "'url' deve ser do domínio s2gpr.sefaz.ce.gov.br." });
    }

    const resultado = await buscarLicitaweb(parsed.toString());
    if (!resultado.ok) return res.status(502).json(resultado);
    return res.json(resultado);
  } catch (e) {
    console.error('edital error', e);
    return res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`consulta-contratos-proxy listening on ${PORT}`);
});

async function shutdown() {
  try {
    if (browser) await browser.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
