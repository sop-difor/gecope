require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Substitua o seu if por este:
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE URL or SUPABASE KEY");
    process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
app.use(bodyParser.json());

app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/ready', async (req, res) => {
  try {
    // lightweight readiness: try a cheap read
    const { data, error } = await sb.from('whatsapp_jobs').select('id').limit(1);
    if (error) return res.status(503).json({ ok: false, error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(503).json({ ok: false, error: e.message });
  }
});

app.post('/enqueue', async (req, res) => {
  try {
    const { number, text, meta } = req.body || {};
    if (!number || !text) return res.status(400).json({ error: 'number and text required' });

    const payload = {
      number: String(number),
      text: String(text),
      meta: meta || null,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data, error } = await sb.from('whatsapp_jobs').insert(payload).select('id').single();
    if (error) throw error;

    return res.status(202).json({ job_id: data.id });
  } catch (err) {
    console.error('enqueue error', err.message || err);
    return res.status(500).json({ error: 'enqueue_failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`evo-proxy web listening on ${PORT}`);
});
