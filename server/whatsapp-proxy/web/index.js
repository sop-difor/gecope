require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { createAuthMiddleware } = require('./auth-middleware');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EVO_API_URL = process.env.EVO_API_URL;
const EVO_API_KEY = process.env.EVO_API_KEY;
const EVO_INSTANCE = process.env.EVO_INSTANCE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('ERRO CRÍTICO: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY faltando.');
  process.exit(1);
}
if (!EVO_API_URL || !EVO_API_KEY || !EVO_INSTANCE) {
  console.error('ERRO CRÍTICO: EVO_API_URL, EVO_API_KEY ou EVO_INSTANCE faltando.');
  process.exit(1);
}

// Cliente service role: ignora RLS por design, é quem grava em whatsapp_jobs/whatsapp_logs
// em nome do backend. Nunca deve ser usado para validar quem é o usuário que chamou.
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { requireAuth, requireAdmin } = createAuthMiddleware({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  sb
});

const app = express();
app.use(express.json());

// Chama a Evolution API internamente. Nunca repassa `EVO_API_KEY` nem o corpo bruto de
// erro da Evolution API para o cliente — quem chama esta função decide o que expor.
async function callEvolution(path, options = {}) {
  const res = await fetch(`${EVO_API_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), apikey: EVO_API_KEY },
    timeout: 15000
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// Compartilhado entre /status (auto-create no 404) e /instance (criação manual admin) —
// evita manter dois payloads de criação de instância divergindo com o tempo.
function createInstance() {
  return callEvolution('/instance/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceName: EVO_INSTANCE,
      token: EVO_API_KEY,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true
    })
  });
}

app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/ready', async (req, res) => {
  try {
    const { error } = await sb.from('whatsapp_jobs').select('id').limit(1);
    if (error) return res.status(503).json({ ok: false, error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(503).json({ ok: false, error: e.message });
  }
});

// Qualquer usuário autenticado pode enfileirar um envio — processarNotificacao (front-end)
// roda para ações comuns de negócio (criar processo, mudar status, etc.), não só admin.
app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
  try {
    const { number, text, log_id } = req.body || {};
    if (!number || !text) return res.status(400).json({ error: 'number_and_text_required' });

    // Se vier log_id, confirma que aponta para um log real e ainda em 'processando' —
    // evita que o worker sobrescreva o status de um log arbitrário/já finalizado por um
    // log_id incorreto (a inserção pela FK já barraria um id inexistente, mas isso
    // detecta o caso de um id existente porém errado, com uma mensagem clara em vez de
    // um erro de constraint genérico).
    if (log_id) {
      const { data: logRow, error: logError } = await sb
        .from('whatsapp_logs')
        .select('id')
        .eq('id', log_id)
        .eq('status', 'processando')
        .maybeSingle();
      if (logError) throw logError;
      if (!logRow) return res.status(400).json({ error: 'invalid_log_id' });
    }

    const { data, error } = await sb
      .from('whatsapp_jobs')
      .insert({ number: String(number), text: String(text), log_id: log_id || null, status: 'pending' })
      .select('id')
      .single();

    if (error) throw error;
    return res.status(202).json({ job_id: data.id });
  } catch (err) {
    console.error('[send] erro:', err.message || err);
    return res.status(500).json({ error: 'enqueue_failed' });
  }
});

// Reenvio: o proxy busca telefone/mensagem do PRÓPRIO log em whatsapp_logs — nunca aceita
// telefone/texto arbitrário no body, para impedir que /resend seja usado como um envio
// livre disfarçado de reenvio.
app.post('/api/whatsapp/resend/:logId', requireAuth, async (req, res) => {
  try {
    const { logId } = req.params;

    const { data: log, error: logError } = await sb
      .from('whatsapp_logs')
      .select('id, destinatario, mensagem')
      .eq('id', logId)
      .maybeSingle();

    if (logError) throw logError;
    if (!log) return res.status(404).json({ error: 'log_not_found' });

    // Ordem importa: insere o job PRIMEIRO. Se isso falhar, o log simplesmente continua
    // com o status que já tinha (estado consistente). Se atualizássemos o log para
    // 'processando' antes e o insert do job falhasse depois, o log ficaria preso em
    // 'processando' para sempre — nada mais existiria para finalizá-lo.
    const { data: job, error: jobError } = await sb
      .from('whatsapp_jobs')
      .insert({ number: log.destinatario, text: log.mensagem, log_id: log.id, status: 'pending' })
      .select('id')
      .single();

    if (jobError) throw jobError;

    await sb.from('whatsapp_logs')
      .update({ status: 'processando', erro_detalhe: 'Reenviando...' })
      .eq('id', logId);

    return res.status(202).json({ job_id: job.id });
  } catch (err) {
    console.error('[resend] erro:', err.message || err);
    return res.status(500).json({ error: 'resend_failed' });
  }
});

app.get('/api/whatsapp/status', requireAuth, async (req, res) => {
  try {
    const result = await callEvolution(`/instance/connectionState/${EVO_INSTANCE}`);

    if (result.ok) {
      const state = result.data?.instance?.state || 'unknown';
      return res.json({ state });
    }

    if (result.status === 404) {
      // Instância ainda não existe — cria automaticamente, como o front-end fazia antes.
      const created = await createInstance();
      if (created.ok) return res.json({ state: 'creating' });
      return res.status(502).json({ state: 'error' });
    }

    return res.status(502).json({ state: 'error' });
  } catch (err) {
    console.error('[status] erro:', err.message || err);
    return res.status(503).json({ state: 'offline' });
  }
});

app.post('/api/whatsapp/instance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await createInstance();
    if (result.ok) return res.json({ created: true });
    return res.status(409).json({ created: false, reason: 'evolution_rejected' });
  } catch (err) {
    console.error('[instance] erro:', err.message || err);
    return res.status(502).json({ created: false, reason: 'evolution_unreachable' });
  }
});

// Devolve o QR code de pareamento para ser exibido dentro do próprio painel do GECOPE —
// a Evolution API não tem porta pública, então este é o único jeito de escanear o QR
// (tanto no pareamento inicial quanto em qualquer reconexão futura) sem acesso à VM.
// NOTA: o nome exato dos campos da resposta pode variar por versão da Evolution API —
// tentamos os nomes documentados mais comuns (base64/qrcode/code) defensivamente.
app.get('/api/whatsapp/instance/qrcode', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await callEvolution(`/instance/connect/${EVO_INSTANCE}`);
    if (!result.ok) return res.status(502).json({ error: 'qrcode_unavailable' });

    const qrcode = result.data?.base64 || result.data?.qrcode || result.data?.code || null;
    if (!qrcode) return res.status(502).json({ error: 'qrcode_unavailable' });

    return res.json({ qrcode });
  } catch (err) {
    console.error('[qrcode] erro:', err.message || err);
    return res.status(502).json({ error: 'qrcode_unavailable' });
  }
});

// Error handler final — captura, entre outras coisas, JSON malformado no body (erro do
// express.json() que acontece antes de qualquer rota) e qualquer exceção não tratada nas
// rotas acima. Sem isso, o handler padrão do Express inclui stack trace na resposta
// quando NODE_ENV não é 'production', vazando detalhes internos do servidor ao cliente.
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message || err);
  res.status(400).json({ error: 'bad_request' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`whatsapp-proxy web listening on ${PORT}`);
});
