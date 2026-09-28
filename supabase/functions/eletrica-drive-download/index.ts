// index.ts — Edge Function: eletrica-drive-download
//
// Baixar relatório de vistoria elétrica pelo próprio GECOPE. Os arquivos ficam num
// Drive privado da conta Gmail dedicada do setor (ver eletrica-drive-token), então o
// link direto do Drive dá 403 para quem não é dono/compartilhado. Esta function faz
// a ponte: confere quem é o usuário GECOPE, confirma que ele enxerga o relatório
// (mesma RLS de eletrica_vistorias) e devolve o arquivo lido do Drive com o refresh
// token da conta dedicada — que nunca sai do servidor.
//
// Recebe { id_relatorio } (id da linha em eletrica_vistorias, NÃO o drive_file_id: o
// id do Drive vem do banco, então ninguém baixa um arquivo arbitrário da conta).
//
// Autorização: o SELECT em eletrica_vistorias roda com o client autenticado COMO o
// usuário chamador; se a RLS (contratos_edificacao_pode_ler) não deixar ler, a linha
// não volta e a resposta é 404. Não precisa de SUPABASE_SERVICE_ROLE_KEY.
//
// O corpo do Drive é repassado em streaming (limite de 20MB por relatório na
// origem), sem carregar o arquivo inteiro em memória.
//
// Deploy (mesmos secrets de eletrica-drive-token, nada novo a configurar):
//   supabase functions deploy eletrica-drive-download

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://sop-difor.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // sem isso o navegador esconde o nome do arquivo do fetch() do front
  "Access-Control-Expose-Headers": "Content-Disposition",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Content-Disposition com nome UTF-8 (RFC 5987) + fallback ASCII para clientes antigos.
function contentDisposition(nome: string) {
  const ascii = nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

// Access token do Google guardado no escopo do módulo: instâncias "quentes" da function
// reaproveitam o token (~1h de vida) em vez de trocar o refresh token a cada clique —
// era uma ida e volta inteira ao Google só pra baixar um arquivo. Margem de 60s.
let tokenCache: { valor: string; expiraEm: number } | null = null;

async function obterAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now() + 60_000) return tokenCache.valor;
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
  tokenCache = { valor: json.access_token, expiraEm: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, erro: "Método não permitido." }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ ok: false, erro: "Entre no GECOPE para baixar relatórios." }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  let body: { id_relatorio?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, erro: "Corpo da requisição inválido." }, 400);
  }
  const idRelatorio = Number(body.id_relatorio);
  if (!Number.isInteger(idRelatorio) || idRelatorio <= 0) {
    return jsonResponse({ ok: false, erro: "id_relatorio inválido." }, 400);
  }

  // Valida a sessão e busca o relatório ao mesmo tempo (eram 2 idas e voltas em série).
  // Sessão inválida => a consulta com RLS também não devolve nada, e o 401 tem prioridade.
  const [{ data: { user }, error: erroAuth }, { data: rel, error: erroRel }] = await Promise.all([
    supabase.auth.getUser(token),
    supabase
      .from("eletrica_vistorias")
      .select("drive_file_id, arquivo_nome_original, arquivo_mime")
      .eq("id", idRelatorio)
      .is("excluido_em", null)
      .maybeSingle(),
  ]);
  if (erroAuth || !user) {
    return jsonResponse({ ok: false, erro: "Sua sessão do GECOPE expirou. Entre novamente." }, 401);
  }
  if (erroRel) {
    console.error("Erro consultando eletrica_vistorias:", erroRel);
    return jsonResponse({ ok: false, erro: "Não consegui localizar o relatório agora. Tente novamente." }, 500);
  }
  if (!rel?.drive_file_id) {
    return jsonResponse({ ok: false, erro: "Relatório não encontrado." }, 404);
  }

  let accessToken: string;
  try {
    accessToken = await obterAccessToken();
  } catch (erro) {
    console.error("Erro renovando token do Google:", erro);
    return jsonResponse(
      { ok: false, erro: "Não consegui conectar ao Google Drive agora. Tente novamente em instantes." },
      502
    );
  }

  const driveResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rel.drive_file_id)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!driveResp.ok || !driveResp.body) {
    console.error("Drive recusou o download:", driveResp.status, await driveResp.text().catch(() => ""));
    const msg = driveResp.status === 404
      ? "O arquivo não existe mais no Drive."
      : "Não consegui baixar o arquivo do Drive agora. Tente novamente.";
    return jsonResponse({ ok: false, erro: msg }, driveResp.status === 404 ? 404 : 502);
  }

  const nome = rel.arquivo_nome_original || "relatorio";
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": rel.arquivo_mime || driveResp.headers.get("Content-Type") || "application/octet-stream",
    "Content-Disposition": contentDisposition(nome),
  };
  const tamanho = driveResp.headers.get("Content-Length");
  if (tamanho) headers["Content-Length"] = tamanho;
  return new Response(driveResp.body, { status: 200, headers });
});
