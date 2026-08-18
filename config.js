// --- 1. CONFIGURAÇÕES E CONEXAO
window.SUPABASE_URL = 'https://qexdnxqmiaarzwwwrcor.supabase.co';
window.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFleGRueHFtaWFhcnp3d3dyY29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NDYyNDUsImV4cCI6MjA4NTQyMjI0NX0.RJnLpsXMMzzhcq_YKHI7wObBqubKgdltauvBvGpz4dc';

// --- 2. WHATSAPP (via proxy próprio, não mais a Evolution API direto)
// A partir da reativação de 2026-08, o front-end nunca mais fala diretamente com a
// Evolution API nem guarda a chave dela — só o backend server/whatsapp-proxy tem essa
// credencial. O cliente só precisa saber a URL pública do proxy; a autenticação é feita
// enviando o próprio JWT de sessão do usuário (ver fetchComTimeout em whatsapp.js).
// Preencher com a URL do domínio configurado no deploy (ver server/whatsapp-proxy/DEPLOY.md).
// Deixar em branco mantém o disparo pausado, com erro amigável (ver fetchComTimeout).
window.WHATSAPP_PROXY_URL = 'https://137-131-228-120.sslip.io';
