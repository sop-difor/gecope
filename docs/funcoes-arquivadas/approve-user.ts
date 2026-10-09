// docs/funcoes-arquivadas/approve-user.ts
//
// ARQUIVO MORTO — guardado só como registro. Copiado do painel do Supabase em 09/10/2026
// (versão publicada, 28 deploys, última atualização ~4 meses antes), na revisão técnica
// de 08-09/10/2026 (item #20 de docs/code-review/REVIEW.md).
// Fica FORA de supabase/functions/ de propósito: um `supabase functions deploy` geral não
// pode republicá-la por acidente.
//
// O QUE FAZIA: um admin chamava com { notifId, role, matricula, nome } e ela inseria a
// pessoa em `app_users` (com a chave de serviço) e marcava a notificação como lida.
//
// REVISÃO (09/10/2026):
// - Autenticação correta: valida o token (`getUser`) e exige role = 'admin' em `app_users`.
//   Nenhuma falha de segurança grave encontrada.
// - POR QUE SAIR: (1) fabrica o e-mail `matricula@gecope.app` quando não recebe um e-mail
//   real — é o defeito que gerou contas com e-mail trocado (sql/_aplicados/
//   fix_app_users_email_mismatch.sql); (2) o site não a chama mais: modules/administracao/
//   admin.js aprova direto no banco, com e-mail real e protegido por RLS (já registrado na
//   rodada de 14/08/2026 em docs/_concluido/AUDITORIA_INDEX.md, seção 17); (3) roda com a
//   chave de serviço sem nenhuma utilidade em uso.
// - Fragilidades menores: `role` do corpo não é validado; erro de banco volta cru na resposta.
//
// SE PRECISAR DE NOVO: não republique como está. Use a aprovação direta do admin.js ou
// reescreva usando o e-mail real do cadastro e validando `role` contra a lista de papéis.

import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // CORS Headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
    const token = authHeader.split(' ')[1]
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing access token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const PROJECT_URL = Deno.env.get('SUPABASE_URL') || ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const sb = createClient(PROJECT_URL, SERVICE_ROLE_KEY)

    // Validate caller session using the official Supabase SDK getUser
    const { data: { user }, error: userErr } = await sb.auth.getUser(token)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: userErr?.message || 'Invalid session token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const callerEmail = user.email
    if (!callerEmail) {
      return new Response(JSON.stringify({ error: 'No email in session' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // verify caller is admin in app_users
    const { data: callerRow, error: callerErr } = await sb.from('app_users').select('role').eq('email', callerEmail).maybeSingle()
    if (callerErr) {
      return new Response(JSON.stringify({ error: callerErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (!callerRow || callerRow.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can approve' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const { notifId, role, matricula, nome } = body || {}
    const emailToCreate = matricula ? `${matricula}@gecope.app` : `${(nome || 'user').replace(/\s+/g, '').toLowerCase()}@gecope.app`

    const payload = {
      email: emailToCreate,
      matricula: matricula || null,
      nome: nome || null,
      sobrenome: null,
      role: role || 'externo',
      created_at: new Date().toISOString()
    }

    const { error: insertErr } = await sb.from('app_users').insert([payload])
    if (insertErr) throw insertErr

    if (notifId) {
      await sb.from('app_notifications').update({ read: true }).eq('id', notifId)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('approve-user error', err)
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
