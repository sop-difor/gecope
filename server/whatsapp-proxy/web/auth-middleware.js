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

  // Ambos os middlewares são async e chamam serviços externos (Supabase Auth/DB) — sem
  // try/catch aqui, uma falha de rede/DNS vira unhandled promise rejection, e o Node
  // mata o processo inteiro por padrão (derrubando o proxy para todo mundo). O catch
  // sempre responde 401/403 (nunca vaza o erro real ao cliente) e loga o detalhe real.
  async function requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'missing_token' });

      const { data, error } = await sbAuth.auth.getUser(token);
      if (error || !data?.user?.email) {
        return res.status(401).json({ error: 'invalid_token' });
      }

      req.user = data.user;
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
