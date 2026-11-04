// index.ts — Edge Function: admin-redefinir-senha
//
// Botão "Redefinir senha" dos pedidos de recuperação no painel de Administração
// (modules/administracao/admin.js). Antes não havia como redefinir senha dentro do GECOPE:
// o admin precisava ir ao painel do Supabase.
//
// Recebe { matricula, notif_id? } com o JWT do admin em Authorization.
//   1. Confere no servidor que quem chamou é admin (app_users.role = 'admin').
//   2. Acha a conta da matrícula (e-mail em app_users -> usuário em auth.users).
//   3. Gera uma senha provisória aleatória, grava na conta e marca
//      user_metadata.trocar_senha = true: no próximo login o front obriga a criar uma
//      senha nova (verificarTrocaSenhaObrigatoria em core/auth.js).
//   4. Marca o pedido (app_notifications) como resolvido.
// Devolve { ok, senha, nome, telefone } — a senha só existe nesta resposta: não é gravada
// em tabela nem em log.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (automáticos).
// Deploy: supabase functions deploy admin-redefinir-senha

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS_PERMITIDAS = [
  "https://sop-difor.github.io",
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

function corsHeaders(req: Request): Record<string, string> {
  const origem = req.headers.get("Origin") ?? "";
  const ok = ORIGENS_PERMITIDAS.some((o) => (typeof o === "string" ? o === origem : o.test(origem)));
  return {
    "Access-Control-Allow-Origin": ok ? origem : ORIGENS_PERMITIDAS[0] as string,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Sem caracteres que se confundem ao ditar ou ler (0/O, 1/l/I).
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITOS = "23456789";

function gerarSenhaProvisoria(): string {
  const alfabeto = LETRAS + DIGITOS;
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]);
  // Garante ao menos uma letra e um dígito.
  chars[3] = DIGITOS[bytes[3] % DIGITOS.length];
  chars[7] = LETRAS[bytes[7] % LETRAS.length];
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function acharContaAuth(email: string) {
  const alvo = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => (u.email || "").toLowerCase() === alvo);
    if (achado) return achado;
    if (data.users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, cors, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, erro: "Entre no GECOPE para continuar." }, cors, 401);

  let body: { matricula?: string; notif_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, erro: "Corpo da requisição inválido." }, cors, 400);
  }
  const matricula = String(body.matricula ?? "").trim();
  if (!/^[0-9A-Za-z.\-]{1,30}$/.test(matricula)) {
    return json({ ok: false, erro: "Matrícula inválida." }, cors, 400);
  }

  try {
    // 1. Quem chamou é admin?
    const { data: { user: chamador }, error: erroAuth } =
      await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.getUser(token);
    if (erroAuth || !chamador?.email) {
      return json({ ok: false, erro: "Sua sessão expirou. Entre novamente." }, cors, 401);
    }
    // ilike para ignorar maiúsculas (como as funções de papel do banco), com _ % \ escapados
    // para a comparação ser exata.
    const emailExato = chamador.email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: perfilChamador } = await admin.from("app_users")
      .select("role").ilike("email", emailExato).maybeSingle();
    if (perfilChamador?.role !== "admin") {
      return json({ ok: false, erro: "Só administradores podem redefinir senhas." }, cors, 403);
    }

    // 2. Conta da matrícula
    const { data: alvo, error: erroAlvo } = await admin.from("app_users")
      .select("email, nome, sobrenome, full_name, telefone_whatsapp")
      .eq("matricula", matricula).maybeSingle();
    if (erroAlvo) throw erroAlvo;
    if (!alvo?.email) return json({ ok: false, erro: "Nenhum usuário com essa matrícula." }, cors, 404);

    const conta = await acharContaAuth(alvo.email);
    if (!conta) {
      return json({ ok: false, erro: "Essa matrícula não tem conta de acesso (login) criada." }, cors, 404);
    }

    // 3. Senha provisória + troca obrigatória no próximo login
    const senha = gerarSenhaProvisoria();
    const { error: erroUpd } = await admin.auth.admin.updateUserById(conta.id, {
      password: senha,
      user_metadata: { ...(conta.user_metadata ?? {}), trocar_senha: true },
    });
    if (erroUpd) throw erroUpd;

    // 4. Pedido resolvido
    if (body.notif_id) {
      const { error: erroNotif } = await admin.from("app_notifications")
        .update({ read: true }).eq("id", body.notif_id).eq("type", "new_user_request");
      if (erroNotif) console.error("Erro marcando pedido como resolvido:", erroNotif);
    }

    // Auditoria nos logs da função (sem a senha).
    console.log(`Senha redefinida: matricula=${matricula} por=${chamador.email}`);

    const nome = (alvo.full_name && !/^\d+$/.test(alvo.full_name)
      ? alvo.full_name
      : `${alvo.nome ?? ""} ${alvo.sobrenome ?? ""}`).trim().toUpperCase();
    return json({ ok: true, senha, nome, telefone: alvo.telefone_whatsapp || null }, cors);
  } catch (erro) {
    console.error("Erro em admin-redefinir-senha:", erro);
    return json({ ok: false, erro: "Não foi possível redefinir a senha agora. Tente novamente." }, cors, 500);
  }
});
