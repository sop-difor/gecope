// Limite de envios por usuário (janela deslizante de 1 min, em memória). Uma ação de negócio
// notifica poucos destinatários; o teto só existe para uma conta comprometida não encher a fila
// do número oficial. Reinicia com o processo, o que é aceitável para este fim.
function createRateLimiter({ limitPerMin, windowMs = 60000, now = () => Date.now() }) {
  const hits = new Map(); // chave -> timestamps (ms) dentro da janela

  return function isLimited(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter(ts => t - ts < windowMs);
    if (recent.length >= limitPerMin) {
      hits.set(key, recent);
      return true;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 500) {
      for (const [k, v] of hits) if (!v.some(ts => t - ts < windowMs)) hits.delete(k);
    }
    return false;
  };
}

module.exports = { createRateLimiter };
