// --- 1. CONFIGURAÇÕES E CONEXAO
window.SUPABASE_URL = 'https://qexdnxqmiaarzwwwrcor.supabase.co';
window.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFleGRueHFtaWFhcnp3d3dyY29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NDYyNDUsImV4cCI6MjA4NTQyMjI0NX0.RJnLpsXMMzzhcq_YKHI7wObBqubKgdltauvBvGpz4dc';

// --- 2. CONFIGURAÇÕES EVOLUTION API (WhatsApp Local)
// Disparo de WhatsApp está PAUSADO (sem acesso ao Railway que hospedava a instância —
// em reavaliação). A chave anterior foi removida do front-end por decisão do usuário
// (2026-08-14): não deve haver credenciais expostas no cliente, ativas ou não. As
// chamadas em whatsapp.js já falham de forma controlada (ver fetchComTimeout) quando
// EVO_API_KEY/EVO_API_URL estão vazios, em vez de disparar com uma chave em branco.
window.EVO_API_URL = '';
window.EVO_API_KEY = '';
window.EVO_INSTANCE = 'SOP';
