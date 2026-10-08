// index.ts — Edge Function: gecope-assistant-painel
// F7: leitura agregada de consultas_ia_log para a página assistente-painel.html.
// Função separada da gecope-assistant (que pergunta+grava): esta só lê, nunca
// escreve, e existe puramente para dar números/observabilidade ao uso do
// assistente e uma lista do que falhou ou levou 👎 (a matéria-prima da rotina
// "falha → intenção ou caso de eval", ver docs/assistente/rotina-revisao-falhas.md).
//
// Acesso: exige a mesma sessão real do GECOPE que a gecope-assistant (JWT via
// auth.getUser) e a mesma autorização (admin ou "assistente_dados"). Até 08/10/2026 não
// havia checagem de papel (decisão de 05/09/2026); foi fechada na revisão técnica porque o
// cadastro é aberto e qualquer conta nova passava na checagem de sessão.
//
// consultas_ia_log só tem policy de escrita/leitura para service_role (F1) —
// por isso o painel não lê a tabela direto do navegador: passa por aqui,
// que usa a mesma SUPABASE_SERVICE_ROLE_KEY da gecope-assistant.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://sop-difor.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Teto de linhas trazidas para agregar em JS — um piloto de ~10-20 pessoas
// não chega perto disso tão cedo; se um dia chegar, isso vira uma consulta
// agregada no banco em vez de trazer tudo.
const LIMITE_LINHAS_AGREGACAO = 5000;
const LIMITE_LISTA_PROBLEMAS = 50;

type LinhaLog = {
  id: number;
  usuario: string | null;
  pergunta: string;
  sql_gerado: string | null;
  origem: string | null;
  sucesso: boolean | null;
  erro: string | null;
  veredito: string | null;
  created_at: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ---- Autenticação: mesma exigência da gecope-assistant (F1) ----
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(
      JSON.stringify({ erro: "Entre no GECOPE para ver o painel." }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser(token);
  if (erroAuth || !user) {
    return new Response(
      JSON.stringify({ erro: "Sua sessão do GECOPE expirou. Entre novamente." }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ---- Autorização: mesma regra da gecope-assistant (admin, ou autorização especial
  // "assistente_dados"). Revisão 08/10/2026: antes bastava estar logado, e o cadastro é aberto
  // (qualquer conta nova entra como 'pending'), então o painel — com todas as perguntas, o SQL
  // gerado e os erros de todos os usuários, lidos com service role — ficava a um cadastro de
  // distância de qualquer pessoa. Este client ignora RLS, então esta é a única trava. ----
  const { data: perfilAcesso } = await supabase
    .from("app_users")
    .select("role")
    .eq("email", user.email ?? "")
    .maybeSingle();
  let autorizado = (perfilAcesso?.role ?? "").toLowerCase() === "admin";
  if (!autorizado) {
    const { data: autorizacao } = await supabase
      .from("autorizacoes_especiais")
      .select("id")
      .eq("permissao", "assistente_dados")
      .ilike("usuario_email", user.email ?? "")
      .is("revogado_em", null)
      .maybeSingle();
    autorizado = !!autorizacao;
  }
  if (!autorizado) {
    return new Response(
      JSON.stringify({ erro: "O painel do Assistente de Dados está disponível apenas para administradores." }),
      { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const { data, error } = await supabase
      .from("consultas_ia_log")
      .select("id, usuario, pergunta, sql_gerado, origem, sucesso, erro, veredito, created_at")
      .order("created_at", { ascending: false })
      .limit(LIMITE_LINHAS_AGREGACAO);

    if (error) throw error;

    const linhas = (data ?? []) as LinhaLog[];

    const porOrigem: Record<string, number> = {};
    let sucessos = 0;
    let falhas = 0;
    let positivos = 0;
    let negativos = 0;

    for (const l of linhas) {
      const origem = l.origem ?? "desconhecida";
      porOrigem[origem] = (porOrigem[origem] ?? 0) + 1;
      if (l.sucesso === true) sucessos++;
      if (l.sucesso === false) falhas++;
      if (l.veredito === "positivo") positivos++;
      if (l.veredito === "negativo") negativos++;
    }

    const problemas = linhas
      .filter((l) => l.sucesso === false || l.veredito === "negativo")
      .slice(0, LIMITE_LISTA_PROBLEMAS)
      .map((l) => ({
        id: l.id,
        pergunta: l.pergunta,
        // F7 (achado do rev-produto): a rotina de revisão
        // (rotina-revisao-falhas.md) pede pra olhar o SQL gerado antes de
        // decidir — sem isso no painel, quem revisa tinha que cruzar por
        // fora (SQL Editor) usando id/data. Truncado: é só um indício
        // rápido, não uma ferramenta de depuração completa.
        sqlGerado: l.sql_gerado ? l.sql_gerado.slice(0, 300) : null,
        origem: l.origem,
        erro: l.erro,
        veredito: l.veredito,
        criadoEm: l.created_at,
      }));

    return new Response(
      JSON.stringify({
        total: linhas.length,
        totalTruncado: linhas.length === LIMITE_LINHAS_AGREGACAO,
        porOrigem,
        sucessos,
        falhas,
        positivos,
        negativos,
        problemas,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (erro) {
    console.error("Erro no gecope-assistant-painel:", erro);
    return new Response(
      JSON.stringify({ erro: "Não consegui carregar os números agora. Tente novamente em instantes." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
