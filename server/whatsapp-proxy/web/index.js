require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// Origem do front-end do GECOPE — sem isso, o navegador bloqueia a resposta do proxy por
// política de CORS antes mesmo do JS conseguir ler o resultado (aparece como "API Offline"
// na tela, mesmo com o proxy respondendo normalmente). Configurável via env var para não
// precisar reconstruir a imagem se o domínio do front-end mudar.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://sop-difor.github.io';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

function normalizeDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

// Gera as variantes plausíveis de um número BR: com/sem o "55" de país, e com/sem o "9"
// extra de celular (whatsapp.js tem uma heurística que remove esse "9" para DDDs 85/88 em
// certas instâncias — ver enviarMensagemIndividual). Usado só para COMPARAR contra números
// já cadastrados em app_users, nunca para decidir para onde enviar de fato.
function phoneVariants(raw) {
  let d = normalizeDigits(raw);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  const variants = new Set([d]);
  if (d.length === 11) variants.add(d.slice(0, 2) + d.slice(3));
  if (d.length === 10) variants.add(d.slice(0, 2) + '9' + d.slice(2));
  return variants;
}

// Confirma que `number` corresponde a um telefone já cadastrado em app_users antes de
// enfileirar qualquer envio — sem isso, qualquer conta autenticada (não só admin, já que
// processarNotificacao roda para ações comuns de negócio) poderia usar este endpoint como
// uma plataforma de disparo de texto livre para QUALQUER número, dentro ou fora da folha de
// funcionários, sob a identidade oficial do WhatsApp do SOP-CE.
async function isKnownRecipient(number) {
  const incoming = phoneVariants(number);
  const { data: users, error } = await sb
    .from('app_users')
    .select('telefone_whatsapp')
    .not('telefone_whatsapp', 'is', null);
  if (error) throw error;
  return (users || []).some(u => {
    for (const v of phoneVariants(u.telefone_whatsapp)) {
      if (incoming.has(v)) return true;
    }
    return false;
  });
}

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

// Marca um log como falha usando o cliente service role (ignora RLS) — desde que
// whatsapp_logs.UPDATE passou a ser admin-only, o cliente (front-end) não consegue mais
// gravar essa falha ele mesmo; é o proxy quem precisa fazer isso em toda rejeição que
// aconteça DEPOIS de o log já existir, senão o registro fica preso em 'processando' para
// sempre (a mesma classe de bug já limpa uma vez em auditoria — ver whatsapp_logs).
async function markLogFailed(logId, motivo) {
  if (!logId) return;
  try {
    await sb.from('whatsapp_logs').update({ status: 'falha', erro_detalhe: motivo }).eq('id', logId);
  } catch (e) {
    console.error('[markLogFailed] falha ao gravar status de erro:', e.message || e);
  }
}

// Qualquer usuário autenticado pode enfileirar um envio — processarNotificacao (front-end)
// roda para ações comuns de negócio (criar processo, mudar status, etc.), não só admin. Por
// isso este endpoint não é requireAdmin: em vez disso, isKnownRecipient() abaixo restringe
// o destino a números já cadastrados em app_users, para que uma conta comum comprometida não
// vire uma plataforma de disparo de texto livre a QUALQUER número.
app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
  const { number, text, log_id } = req.body || {};
  try {
    if (!number || !text) return res.status(400).json({ error: 'number_and_text_required' });

    if (!(await isKnownRecipient(number))) {
      await markLogFailed(log_id, 'Recusado: número não corresponde a nenhum destinatário cadastrado.');
      return res.status(403).json({ error: 'recipient_not_registered' });
    }

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
    await markLogFailed(log_id, `Erro ao enfileirar: ${err.message || String(err)}`);
    console.error('[send] erro:', err.message || err);
    return res.status(500).json({ error: 'enqueue_failed' });
  }
});

// Reenvio: o proxy busca telefone/mensagem do PRÓPRIO log em whatsapp_logs — nunca aceita
// telefone/texto arbitrário no body, para impedir que /resend seja usado como um envio
// livre disfarçado de reenvio.
app.post('/api/whatsapp/resend/:logId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { logId } = req.params;

    // Compare-and-swap: só transiciona falha -> processando se o log AINDA estiver em
    // 'falha' no momento exato deste UPDATE — usa o `status` da própria linha como o
    // "cadeado". Duplo clique no botão, ou duas abas/admins clicando quase ao mesmo tempo,
    // fazem duas requisições chegarem aqui: a primeira encontra 'falha' e o Postgres marca
    // a linha para ela; a segunda, na mesma fração de segundo, já não encontra mais uma
    // linha com status='falha' para casar (0 linhas afetadas) e recebe 409 sem enfileirar
    // nada — sem isso, ambas passavam e o destinatário recebia o reenvio em duplicidade.
    const { data: log, error: casError } = await sb
      .from('whatsapp_logs')
      .update({ status: 'processando', erro_detalhe: 'Reenviando...' })
      .eq('id', logId)
      .eq('status', 'falha')
      .select('id, destinatario, mensagem')
      .maybeSingle();

    if (casError) throw casError;
    if (!log) {
      // Ou o log não existe, ou (mais comum) já não estava mais em 'falha' — outro reenvio
      // já está em andamento ou já foi concluído. Diferencia as duas causas na resposta.
      const { data: existing } = await sb.from('whatsapp_logs').select('id, status').eq('id', logId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'log_not_found' });
      return res.status(409).json({ error: 'resend_already_in_progress', status: existing.status });
    }

    // Se o insert do job falhar agora, o log já ficou em 'processando' — devolve para
    // 'falha' explicitamente para não deixá-lo preso (mesma preocupação de
    // reclaimOrphanLogs, mas resolvida na hora em vez de esperar a varredura periódica).
    const { data: job, error: jobError } = await sb
      .from('whatsapp_jobs')
      .insert({ number: log.destinatario, text: log.mensagem, log_id: log.id, status: 'pending' })
      .select('id')
      .single();

    if (jobError) {
      await sb.from('whatsapp_logs')
        .update({ status: 'falha', erro_detalhe: `Erro ao enfileirar reenvio: ${jobError.message}` })
        .eq('id', logId);
      throw jobError;
    }

    return res.status(202).json({ job_id: job.id });
  } catch (err) {
    console.error('[resend] erro:', err.message || err);
    return res.status(500).json({ error: 'resend_failed' });
  }
});

// `degraded` reflete whatsapp_control.degraded_since, mantido pelo watchdog (serviço
// separado, ver watchdog/watchdog.js) — é o sinal que pega o caso deste incidente real: a
// Evolution API respondendo state:"open" enquanto o envio de fato falha com "Connection
// Closed", porque o watchdog cruza isso com falhas recentes em whatsapp_jobs, não só o
// estado em cache que este endpoint também consulta.
async function getDegradedFlag() {
  try {
    const { data } = await sb.from('whatsapp_control').select('degraded_since').eq('id', 1).maybeSingle();
    return !!data?.degraded_since;
  } catch (err) {
    console.error('[status] erro ao ler whatsapp_control:', err.message || err);
    return false;
  }
}

app.get('/api/whatsapp/status', requireAuth, async (req, res) => {
  const degraded = await getDegradedFlag();
  try {
    const result = await callEvolution(`/instance/connectionState/${EVO_INSTANCE}`);

    if (result.ok) {
      const state = result.data?.instance?.state || 'unknown';
      return res.json({ state, degraded });
    }

    if (result.status === 404) {
      // Instância ainda não existe — cria automaticamente, como o front-end fazia antes.
      const created = await createInstance();
      if (created.ok) return res.json({ state: 'creating', degraded });
      return res.status(502).json({ state: 'error', degraded });
    }

    return res.status(502).json({ state: 'error', degraded });
  } catch (err) {
    console.error('[status] erro:', err.message || err);
    return res.status(503).json({ state: 'offline', degraded });
  }
});

// Não reinicia nada diretamente — este container nunca tem acesso ao Docker por design
// (é o único ponto do stack exposto a requisições vindas da internet, via Caddy). Só grava
// o pedido; quem executa de fato é o whatsapp-watchdog (serviço isolado, sem porta nenhuma
// exposta, rodando com o socket do Docker) ao notar restart_requested_at mais recente que
// last_restarted_at no próximo ciclo de verificação (até WATCHDOG_POLL_MS de atraso).
app.post('/api/whatsapp/instance/restart-request', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await sb.from('whatsapp_control').update({
      restart_requested_at: new Date().toISOString(),
      restart_requested_by: req.user.email,
      updated_at: new Date().toISOString()
    }).eq('id', 1);
    if (error) throw error;
    return res.status(202).json({ requested: true });
  } catch (err) {
    console.error('[restart-request] erro:', err.message || err);
    return res.status(500).json({ requested: false });
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
