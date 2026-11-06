// index.ts — Edge Function: login-matricula
//
// Login e recuperação de senha por MATRÍCULA sem expor o e-mail ao navegador.
// Revisão de segurança de 04/11/2026 (item 2): antes o front chamava, sem sessão, a RPC
// app_users_lookup_by_matricula, que devolvia nome + e-mail de qualquer matrícula —
// matrícula é sequencial, então dava para listar os usuários do sistema.
//
// Ações (POST JSON):
//   { acao: "login", matricula, senha }
//       -> { ok: true, email, access_token, refresh_token }  |  { ok: false, erro }
//       Tenta <matricula>@gecope.app e depois o e-mail real de app_users (mesma ordem do
//       front antigo). Matrícula inexistente e senha errada dão a MESMA mensagem.
//   { acao: "recuperar", matricula }
//       -> sempre { ok: true }  (não revela se a matrícula existe)
//       Se existir, registra o pedido em app_notifications com o nome real, para o admin.
//   { acao: "verificar_cadastro", matricula }
//       -> { ok: true, jaTemConta: boolean }
//       Chamada pela tela de cadastro ANTES do auth.signUp (06/11/2026, caso matrícula
//       70023512): quem já tem conta de login não deve criar outra com outro e-mail.
//       Só devolve o booleano (sem nome nem e-mail); a RPC matricula_tem_conta exige
//       perfil + login, de modo que fiscal pré-cadastrado sem login ainda pode se cadastrar.
//       Revela que a matrícula tem conta — o próprio cadastro já revelava (matrícula é
//       UNIQUE) — e tem limite de tentativas próprio.
//
// Limite próprio de tentativas (tabela login_matricula_tentativas, só service_role),
// porque todo login passa a sair deste servidor e o limite por IP do Auth não separa
// mais quem está tentando. Os limites estão em LIMITES.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY, todos injetados
// automaticamente pelo Supabase. Nada a configurar.
//
// Deploy: supabase functions deploy login-matricula
//   (verify_jwt pode ficar ligado: o front manda a chave anon como Bearer.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS_PERMITIDAS = [
  "https://sop-difor.github.io",
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

const LIMITES = {
  login: { porMatricula: 5, porIp: 30, janelaMin: 15 },
  recuperar: { porMatricula: 3, porIp: 10, janelaMin: 60 },
  cadastro: { porMatricula: 5, porIp: 20, janelaMin: 15 },
} as const;

type Acao = keyof typeof LIMITES;

const MSG_LOGIN_INVALIDO = "Matrícula ou senha inválidas.";
const MSG_MUITAS_TENTATIVAS = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
const MATRICULA_REGEX = /^[0-9A-Za-z.\-]{1,30}$/;

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

function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0] || req.headers.get("cf-connecting-ip") || "desconhecido").trim();
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function excedeuLimite(acao: Acao, matricula: string, ip: string): Promise<boolean> {
  const lim = LIMITES[acao];
  const desde = new Date(Date.now() - lim.janelaMin * 60_000).toISOString();
  // Para login conta só as falhas; para recuperar e cadastro, todos os pedidos.
  const base = () => {
    let q = admin.from("login_matricula_tentativas").select("id", { count: "exact", head: true })
      .eq("acao", acao).gte("criado_em", desde);
    if (acao === "login") q = q.eq("sucesso", false);
    return q;
  };
  const [porMat, porIp] = await Promise.all([
    base().eq("matricula", matricula),
    base().eq("ip", ip),
  ]);
  if (porMat.error || porIp.error) {
    // Falha ao consultar o limite: bloqueia em vez de liberar tentativa ilimitada.
    console.error("Erro consultando limite:", porMat.error ?? porIp.error);
    return true;
  }
  return (porMat.count ?? 0) >= lim.porMatricula || (porIp.count ?? 0) >= lim.porIp;
}

async function registrar(acao: Acao, matricula: string, ip: string, sucesso: boolean) {
  const { error } = await admin.from("login_matricula_tentativas").insert({ acao, matricula, ip, sucesso });
  if (error) console.error("Erro registrando tentativa:", error);
  // Limpeza oportunista: o que passou de 1 dia não serve a nenhum limite.
  admin.from("login_matricula_tentativas").delete()
    .lt("criado_em", new Date(Date.now() - 86_400_000).toISOString())
    .then(({ error: e }) => { if (e) console.error("Erro limpando tentativas:", e); });
}

async function buscarUsuario(matricula: string) {
  const { data, error } = await admin.from("app_users")
    .select("email, nome, sobrenome, full_name")
    .eq("matricula", matricula)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function acaoLogin(matricula: string, senha: string, ip: string, cors: Record<string, string>) {
  if (await excedeuLimite("login", matricula, ip)) {
    return json({ ok: false, erro: MSG_MUITAS_TENTATIVAS }, cors);
  }

  const usuario = await buscarUsuario(matricula);
  const candidatos = [`${matricula}@gecope.app`.toLowerCase()];
  const real = (usuario?.email || "").trim().toLowerCase();
  if (real && !candidatos.includes(real)) candidatos.push(real);

  // Client novo por chamada: a sessão nunca é compartilhada entre requisições.
  const auth = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth;

  let erroRepassavel: string | null = null;
  for (const email of candidatos) {
    const { data, error } = await auth.signInWithPassword({ email, password: senha });
    if (!error && data.session) {
      await registrar("login", matricula, ip, true);
      return json({
        ok: true,
        email,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }, cors);
    }
    // Só repassa o erro que já supõe senha certa (não ajuda a descobrir matrícula).
    if (error?.code === "email_not_confirmed") erroRepassavel = "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  }

  await registrar("login", matricula, ip, false);
  return json({ ok: false, erro: erroRepassavel ?? MSG_LOGIN_INVALIDO }, cors);
}

async function acaoRecuperar(matricula: string, ip: string, cors: Record<string, string>) {
  if (await excedeuLimite("recuperar", matricula, ip)) {
    return json({ ok: false, erro: MSG_MUITAS_TENTATIVAS }, cors);
  }
  await registrar("recuperar", matricula, ip, true);

  const usuario = await buscarUsuario(matricula);
  if (usuario) {
    const nomeCompleto = (usuario.full_name && !/^\d+$/.test(usuario.full_name)
      ? usuario.full_name
      : `${usuario.nome ?? ""} ${usuario.sobrenome ?? ""}`).trim().toUpperCase();
    const { error } = await admin.from("app_notifications").insert({
      type: "new_user_request",
      payload: JSON.stringify({ matricula, nome: `${nomeCompleto} - RECUPERAÇÃO DE SENHA` }),
      created_at: new Date().toISOString(),
      read: false,
    });
    if (error) console.error("Erro criando notificação de recuperação:", error);
  }
  // Mesma resposta com ou sem matrícula cadastrada.
  return json({ ok: true }, cors);
}

async function acaoVerificarCadastro(matricula: string, ip: string, cors: Record<string, string>) {
  if (await excedeuLimite("cadastro", matricula, ip)) {
    // limite: true diz ao front que deve parar (qualquer outro erro, ele segue o cadastro).
    return json({ ok: false, limite: true, erro: MSG_MUITAS_TENTATIVAS }, cors);
  }
  await registrar("cadastro", matricula, ip, true);
  const { data, error } = await admin.rpc("matricula_tem_conta", { p_matricula: matricula });
  if (error) throw error;
  return json({ ok: true, jaTemConta: data === true }, cors);
}

function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, cors, 405);

  let body: { acao?: string; matricula?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, erro: "Corpo da requisição inválido." }, cors, 400);
  }

  const matricula = String(body.matricula ?? "").trim();
  if (!MATRICULA_REGEX.test(matricula)) {
    return json({ ok: false, erro: body.acao === "login" ? MSG_LOGIN_INVALIDO : "Matrícula inválida." }, cors);
  }
  const ip = ipDe(req);

  try {
    if (body.acao === "login") {
      const senha = String(body.senha ?? "");
      if (!senha) return json({ ok: false, erro: MSG_LOGIN_INVALIDO }, cors);
      return await acaoLogin(matricula, senha, ip, cors);
    }
    if (body.acao === "recuperar") return await acaoRecuperar(matricula, ip, cors);
    if (body.acao === "verificar_cadastro") return await acaoVerificarCadastro(matricula, ip, cors);
    return json({ ok: false, erro: "Ação inválida." }, cors, 400);
  } catch (erro) {
    console.error("Erro em login-matricula:", erro);
    return json({ ok: false, erro: "Não foi possível entrar agora. Tente novamente em instantes." }, cors, 500);
  }
});
