// Edge Function to approve a user request in Supabase using service_role key
// Adapt for Supabase Functions, Vercel or Netlify as needed.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const authHeader = req.headers['authorization'] || ''
    const token = authHeader.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'Missing access token' })

    // Validate caller session via Supabase Auth endpoint
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!userResp.ok) return res.status(401).json({ error: 'Invalid session token' })
    const userJson = await userResp.json()
    const callerEmail = userJson?.email
    if (!callerEmail) return res.status(400).json({ error: 'No email in session' })

    // verify caller is admin in app_users
    const { data: callerRow, error: callerErr } = await sb.from('app_users').select('role').eq('email', callerEmail).maybeSingle()
    if (callerErr) return res.status(500).json({ error: callerErr.message })
    if (!callerRow || callerRow.role !== 'admin') return res.status(403).json({ error: 'Only admins can approve' })

    // perform creation
    const body = await req.json()
    const { notifId, role, matricula, nome } = body || {}
    const emailToCreate = matricula ? `${matricula}@gecope.app` : `${(nome||'user').replace(/\s+/g,'').toLowerCase()}@gecope.app`

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

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('approve-user error', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}
