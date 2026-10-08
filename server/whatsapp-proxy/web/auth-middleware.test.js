// Testes de requirePapelValido e do limitador de envios (revisão técnica 08/10/2026, #3).
// Rodar: cd server/whatsapp-proxy && npm test   (node --test, sem dependências extras;
// o cliente Supabase é substituído por um stub, então não precisa de node_modules nem de rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Stub de '@supabase/supabase-js' antes de carregar o middleware.
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: () => ({ auth: {} }) };
  return originalLoad.call(this, request, ...rest);
};
const { createAuthMiddleware } = require('./auth-middleware');
const { createRateLimiter } = require('./rate-limit');
Module._load = originalLoad;

// sb falso: devolve a linha de app_users configurada e conta as consultas.
function fakeSb(row, { error = null } = {}) {
  const calls = { n: 0, ilike: null };
  const chain = {
    select: () => chain,
    ilike: (col, val) => { calls.ilike = [col, val]; return chain; },
    limit: () => chain,
    maybeSingle: async () => { calls.n += 1; return { data: row, error }; },
  };
  return { sb: { from: () => chain }, calls };
}

function run(mw, user) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, passed: false }); return this; },
    };
    mw({ user }, res, () => resolve({ status: 200, passed: true }));
  });
}

function build(sb) {
  return createAuthMiddleware({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', sb }).requirePapelValido;
}

test('conta pending é recusada com 403', async () => {
  const { sb } = fakeSb({ role: 'pending' });
  const r = await run(build(sb), { email: 'novo@exemplo.com' });
  assert.equal(r.status, 403);
  assert.equal(r.passed, false);
});

test('e-mail sem linha em app_users é recusado', async () => {
  const { sb } = fakeSb(null);
  const r = await run(build(sb), { email: 'fantasma@exemplo.com' });
  assert.equal(r.status, 403);
});

for (const role of ['admin', 'gerente', 'fiscal', 'externo', 'eletrica', 'Fiscal']) {
  test(`papel ${role} passa`, async () => {
    const { sb } = fakeSb({ role });
    const r = await run(build(sb), { email: `${role}@exemplo.com` });
    assert.equal(r.passed, true);
  });
}

test('falha ao consultar app_users nega (fail closed)', async () => {
  const { sb } = fakeSb(null, { error: new Error('rede') });
  const r = await run(build(sb), { email: 'a@b.com' });
  assert.equal(r.status, 403);
});

test('sem e-mail no token devolve 401', async () => {
  const { sb } = fakeSb({ role: 'admin' });
  const r = await run(build(sb), undefined);
  assert.equal(r.status, 401);
});

test('papel fica em cache: segunda chamada não consulta o banco', async () => {
  const { sb, calls } = fakeSb({ role: 'fiscal' });
  const mw = build(sb);
  await run(mw, { email: 'cache@exemplo.com' });
  await run(mw, { email: 'CACHE@exemplo.com' });
  assert.equal(calls.n, 1);
});

test('curingas do ilike no e-mail são escapados', async () => {
  const { sb, calls } = fakeSb({ role: 'fiscal' });
  await run(build(sb), { email: 'a_b%c@exemplo.com' });
  assert.equal(calls.ilike[1], 'a\\_b\\%c@exemplo.com');
});

test('limitador barra o envio acima do teto e libera após a janela', () => {
  let agora = 1000;
  const limitado = createRateLimiter({ limitPerMin: 3, now: () => agora });
  assert.equal(limitado('u'), false);
  assert.equal(limitado('u'), false);
  assert.equal(limitado('u'), false);
  assert.equal(limitado('u'), true);
  assert.equal(limitado('outro'), false); // contagem é por usuário
  agora += 60001;
  assert.equal(limitado('u'), false);
});
