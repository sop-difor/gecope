// index.ts — Edge Function: eletrica-drive-token
//
// Fase 1 da aba "Elétrica" (gecope_mapa_obras.html). NÃO recebe nem repassa o
// arquivo do relatório: Edge Functions do Supabase têm um limite de tamanho
// de request não documentado oficialmente (evidência de ~10MB), perto demais
// da média esperada de 5-10MB dos relatórios PDF/DOCX da equipe elétrica —
// arriscado demais para servir de proxy de upload.
//
// Em vez disso, esta function só:
//   1. autentica o usuário real da sessão GECOPE e confere que o papel dele é
//      'eletrica' ou 'admin';
//   2. troca o refresh token OAuth da conta Google dedicada por um access
//      token de curta duração (~1h);
//   3. localiza (ou cria) a pasta da obra dentro da pasta raiz do Drive.
//
// O navegador faz o upload do arquivo DIRETO para a API do Google Drive com
// esse access token (fluxo em gecope/assets/js/mapa-obras.js,
// buildEletricaPane) e, depois do upload confirmar, grava a linha de
// metadados em eletrica_vistorias direto pelo client normal do Supabase — a
// RLS de eletrica_vistorias (sql/create_eletrica_vistorias.sql) já garante
// que só eletrica/admin conseguem inserir, então não precisamos fazer esse
// insert por aqui. O refresh token do Google NUNCA chega ao navegador — só um
// access_token de vida curta.
//
// Autorização: consulta o papel do usuário via RPC meu_papel() (SECURITY
// DEFINER) usando um client autenticado COMO o próprio usuário chamador (anon
// key + Authorization repassado) — por isso esta function não precisa de
// SUPABASE_SERVICE_ROLE_KEY.
//
// Pré-requisito de deploy: rodar sql/create_eletrica_vistorias.sql ANTES de
// usar esta function em produção — é ele que amplia
// contratos_edificacao_pode_ler() para incluir 'eletrica'. Sem isso, a
// consulta a contratos_edificacao abaixo devolve 0 linhas para qualquer
// usuário eletrica (RLS bloqueando), e a function responde "Obra não
// encontrada" mesmo para obras que existem de verdade.
//
// Deploy:
//   supabase functions deploy eletrica-drive-token
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... GOOGLE_DRIVE_ROOT_FOLDER_ID=...
// (SUPABASE_URL e SUPABASE_ANON_KEY já vêm injetados pela plataforma.)
//
// Como obter GOOGLE_REFRESH_TOKEN (feito manualmente, uma única vez, fora
// deste código): criar projeto no Google Cloud com a conta Gmail dedicada do
// setor, ativar a API do Drive, criar credenciais OAuth 2.0 (tipo "Desktop
// app" é o mais simples para um consentimento manual único), rodar o fluxo
// de autorização offline (access_type=offline, prompt=consent) uma vez para
// obter o refresh_token inicial. IMPORTANTE: peça o escopo
// `https://www.googleapis.com/auth/drive.file` (nunca o escopo `drive`
// completo) — o access_token devolvido por esta function vai para o
// navegador, e drive.file limita o alcance dele a arquivos criados por este
// próprio app (ainda assim cobre as pastas de todas as obras, já que todas
// são criadas por este client — aceitável para uma equipe pequena e de
// confiança, mas nunca use o escopo `drive` completo, que daria acesso ao
// Drive inteiro da conta).

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // restrinja ao domínio do GECOPE em produção
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS_ACEITOS = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024; // 20MB — folga sobre a média de 5-10MB

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, erro: "Método não permitido." }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ ok: false, erro: "Entre no GECOPE para enviar relatórios." }, 401);
  }

  // Client autenticado COMO o usuário chamador — não service role. A partir
  // daqui, toda consulta passa pela RLS normal desse usuário.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: erroAuth } = await supabase.auth.getUser(token);
  if (erroAuth || !user) {
    return jsonResponse({ ok: false, erro: "Sua sessão do GECOPE expirou. Entre novamente." }, 401);
  }

  const { data: papel, error: erroPapel } = await supabase.rpc("meu_papel");
  if (erroPapel) {
    console.error("Erro consultando meu_papel():", erroPapel);
    return jsonResponse({ ok: false, erro: "Não consegui verificar seu perfil agora. Tente novamente." }, 500);
  }
  if (!papel || !["eletrica", "admin"].includes(papel)) {
    return jsonResponse({ ok: false, erro: "Seu perfil não tem permissão para enviar relatórios elétricos." }, 403);
  }

  let body: { id_obra?: number; arquivo_mime?: string; arquivo_tamanho_bytes?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, erro: "Corpo da requisição inválido." }, 400);
  }

  const idObra = Number(body.id_obra);
  if (!Number.isInteger(idObra) || idObra <= 0) {
    return jsonResponse({ ok: false, erro: "id_obra inválido." }, 400);
  }
  if (!body.arquivo_mime || !TIPOS_ACEITOS.has(body.arquivo_mime)) {
    return jsonResponse({ ok: false, erro: "Envie um arquivo PDF, DOC ou DOCX." }, 400);
  }
  const tamanho = body.arquivo_tamanho_bytes ?? 0;
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > TAMANHO_MAXIMO_BYTES) {
    return jsonResponse({ ok: false, erro: "Arquivo inválido ou maior que o limite de 20MB." }, 400);
  }

  // Confirma que a obra existe (a RLS de contratos_edificacao já garante que
  // só quem pode ler o módulo — incluindo eletrica — chega até aqui).
  const { data: obra, error: erroObra } = await supabase
    .from("contratos_edificacao")
    .select("id_obra, codigo_obra, municipio")
    .eq("id_obra", idObra)
    .maybeSingle();
  if (erroObra) {
    console.error("Erro consultando contratos_edificacao:", erroObra);
    return jsonResponse({ ok: false, erro: "Não consegui confirmar a obra agora. Tente novamente." }, 500);
  }
  if (!obra) {
    return jsonResponse({ ok: false, erro: "Obra não encontrada." }, 404);
  }

  // ---- Troca do refresh token por um access token de curta duração ----
  let accessToken: string;
  let expiresIn: number;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) throw new Error(`Google OAuth respondeu ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    accessToken = json.access_token;
    expiresIn = json.expires_in;
  } catch (erro) {
    console.error("Erro renovando token do Google:", erro);
    return jsonResponse(
      { ok: false, erro: "Não consegui conectar ao Google Drive agora. Tente novamente em instantes." },
      502
    );
  }

  // ---- Localiza ou cria a pasta da obra no Drive (busca por appProperties,
  //      não por nome, para evitar colisão/duplicidade) ----
  const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID")!;
  let folderId: string;
  try {
    const query =
      `appProperties has { key='id_obra' and value='${idObra}' } and ` +
      `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const buscaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!buscaResp.ok) throw new Error(`Busca de pasta falhou: ${buscaResp.status}: ${await buscaResp.text()}`);
    const buscaJson = await buscaResp.json();

    if (buscaJson.files?.length) {
      folderId = buscaJson.files[0].id;
    } else {
      const nomePasta = [obra.codigo_obra || `obra-${idObra}`, obra.municipio].filter(Boolean).join(" - ");
      const criaResp = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nomePasta,
          mimeType: "application/vnd.google-apps.folder",
          parents: [rootFolderId],
          appProperties: { id_obra: String(idObra) },
        }),
      });
      if (!criaResp.ok) throw new Error(`Criação de pasta falhou: ${criaResp.status}: ${await criaResp.text()}`);
      folderId = (await criaResp.json()).id;
    }
  } catch (erro) {
    console.error("Erro localizando/criando pasta no Drive:", erro);
    return jsonResponse({ ok: false, erro: "Não consegui preparar a pasta da obra no Drive agora." }, 502);
  }

  return jsonResponse({ ok: true, accessToken, expiresIn, folderId });
});
