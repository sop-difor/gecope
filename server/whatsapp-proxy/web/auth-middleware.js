const { createClient } = require('@supabase/supabase-js');

// Middleware de autenticação/autorização para os endpoints /api/whatsapp/*.
// `sb` é o cliente service role já criado em web/index.js (reaproveitado aqui só para
// checar `role` em app_users) — nunca usamos a service role para validar o token em si,
// isso é feito com a anon key via `auth.getUser`, exatamente como o SDK do Supabase
// espera ser usado no lado servidor para validar um JWT de usuário.
function createAuthMiddleware({ supabaseUrl, supabaseAnonKey, sb }) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('createAuthMiddleware: supabaseUrl e supabaseAnonKey são obrigatórios');
  }

  const sbAuth = createClient(supabaseUrl, supabaseAnonKey);

  // Cache em memória (token -> usuário já validado), para não bater na rede do Supabase
  // Auth em TODA requisição ao proxy — cada chamada (inclusive o polling de status do
  // front-end) validava o token de novo, sempre. TTL = o menor entre "tempo até o JWT
  // expirar" e MAX_CACHE_MS — nunca guarda como válido um token que já expirou.
  // A leitura do `exp` é só decodificação (sem verificar assinatura): quem decide se o
  // token é de verdade válido continua sendo auth.getUser, chamado de novo sempre que o
  // cache não tem entrada válida — isto só evita repetir essa chamada para o MESMO token
  // dentro da mesma janela curta. Egress, 18/09/2026 — docs/auditoria-egress-2026-09.md,
  // item 1 do bloco "Serviços da VM".
  const MAX_CACHE_MS = 60000;
  const userCache = new Map(); // token -> { user, expiresAt }

  function decodeJwtExpMs(token) {
    try {
      const payload = token.split('.')[1];
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  function limparCacheExpirado() {
    const now = Date.now();
    for (const [key, entry] of userCache) {
      if (entry.expiresAt <= now) userCache.delete(key);
    }
  }

  // Ambos os middlewares são async e chamam serviços externos (Supabase Auth/DB) — sem
  // try/catch aqui, uma falha de rede/DNS vira unhandled promise rejection, e o Node
  // mata o processo inteiro por padrão (derrubando o proxy para todo mundo). O catch
  // sempre responde 401/403 (nunca vaza o erro real ao cliente) e loga o detalhe real.
  async function requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'missing_token' });

      const cached = userCache.get(token);
      if (cached && cached.expiresAt > Date.now()) {
        req.user = cached.user;
        return next();
      }

      const { data, error } = await sbAuth.auth.getUser(token);
      if (error || !data?.user?.email) {
        userCache.delete(token);
        return res.status(401).json({ error: 'invalid_token' });
      }

      req.user = data.user;
      const expMs = decodeJwtExpMs(token);
      const ttl = expMs ? Math.max(0, Math.min(MAX_CACHE_MS, expMs - Date.now())) : MAX_CACHE_MS;
      if (ttl > 0) userCache.set(token, { user: data.user, expiresAt: Date.now() + ttl });
      if (userCache.size > 500) limparCacheExpirado(); // limite frouxo, só pra não crescer sem fim
      next();
    } catch (err) {
      console.error('[requireAuth] erro inesperado:', err.message || err);
      return res.status(401).json({ error: 'auth_check_failed' });
    }
  }

  async function requireAdmin(req, res, next) {
    try {
      if (!req.user?.email) return res.status(401).json({ error: 'missing_token' });

      const { data, error } = await sb
        .from('app_users')
        .select('role')
        .eq('email', req.user.email)
        .maybeSingle();

      if (error || !data || data.role !== 'admin') {
        return res.status(403).json({ error: 'forbidden' });
      }
      next();
    } catch (err) {
      console.error('[requireAdmin] erro inesperado:', err.message || err);
      return res.status(403).json({ error: 'admin_check_failed' });
    }
  }

  return { requireAuth, requireAdmin };
}

module.exports = { createAuthMiddleware };
