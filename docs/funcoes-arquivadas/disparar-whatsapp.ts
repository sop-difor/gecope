// docs/funcoes-arquivadas/disparar-whatsapp.ts
//
// ARQUIVO MORTO — guardado só como registro. Copiado do painel do Supabase em 09/10/2026
// (versão publicada, 30 deploys, última atualização ~6 meses antes), na revisão técnica
// de 08-09/10/2026 (item #20 de docs/code-review/REVIEW.md).
// Fica FORA de supabase/functions/ de propósito: um `supabase functions deploy` geral não
// pode republicá-la por acidente.
//
// O QUE FAZIA: recebia { messageText, phoneNumbers[] } e mandava a mensagem para cada número
// direto na Evolution API, com a chave global da Evolution (secret EVOLUTION_API_KEY).
//
// REVISÃO (09/10/2026) — ACHADO GRAVE:
// - NENHUMA autenticação nem autorização no código. A única barreira possível é o
//   "Verify JWT" do Supabase, e a chave anon (pública, está em config.js) é um JWT válido:
//   qualquer pessoa que abra o site consegue chamar esta função e disparar mensagem
//   arbitrária, para números arbitrários, a partir do número oficial da SOP (risco de
//   golpe/phishing em nome do órgão e de banimento do número).
// - Sem limite de destinatários, sem limite de frequência, sem registro em whatsapp_logs.
// - Contorna tudo o que o proxy (server/whatsapp-proxy) faz: papel válido, limite de
//   30 envios/min, whitelist de destinatário, fila e tratamento de erro ambíguo.
// - Nada no site chama esta função (conferido por busca no repositório em 09/10/2026).
// - Fragilidades menores: prefixa "55" em qualquer número; CORS "*"; devolve a resposta
//   crua da Evolution ao chamador.
//
// SE PRECISAR DE NOVO: não republique. O caminho oficial é o proxy (whatsapp-proxy-web /
// fila whatsapp_jobs + worker).

// Siga as boas práticas do Deno Deploy (CORS e Headers)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
serve(async (req) => {
  // Resposta padrão ao Pre-flight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const body = await req.json()
    const { messageText, phoneNumbers } = body
    if (!messageText || !phoneNumbers || !Array.isArray(phoneNumbers)) {
      throw new Error("Parâmetros inválidos. É necessário enviar 'messageText' (string) e 'phoneNumbers' (array).")
    }
    // Variáveis de Ambiente da sua Evolution API
    // Cadastre no Supabase as chaves: EVOLUTION_URL, EVOLUTION_INSTANCE, e EVOLUTION_API_KEY
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL") || "";       // Ex: https://sua-api.com
    const evolutionInstance = Deno.env.get("EVOLUTION_INSTANCE") || "";    // Ex: GECOPE_ZAP
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY") || "";       // Chave global de autenticação
    if (!evolutionApiUrl || !evolutionApiKey) {
        throw new Error("Credenciais da Evolution API não estão configuradas no servidor.");
    }
    const apiUrl = `${evolutionApiUrl}/message/sendText/${evolutionInstance}`;
    // Array para segurar o status de todos os envios
    const results = [];
    // Disparando as mensagens para o WhatsApp um a um em formato promise
    for (const ddiAndPhone of phoneNumbers) {
      // Limpa para garantir ter somente número com DDI (Ex: 5585999999999)
      const cleanPhone = `55${ddiAndPhone.replace(/\D/g, '')}`;

      const payload = {
        number: cleanPhone,
        text: messageText,
        delay: 1500 // Adiciona delay simbólico pra simular envio humano
      };
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": evolutionApiKey
          },
          body: JSON.stringify(payload)
        });
        const data = await response.json();

        results.push({
          target: cleanPhone,
          success: response.ok,
          response: data
        });
      } catch (err) {
        results.push({
          target: cleanPhone,
          success: false,
          error: String(err)
        });
      }
    }
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
    })
  }
})
