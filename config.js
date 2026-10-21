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
// Satélite do mapa de obras (Esri World Imagery). A licença do Esri exige conta: crie uma chave gratuita no ArcGIS Location
// Platform (developers.arcgis.com > Dashboard > API keys, permissão "Location services > Basemaps > Static basemap tiles")
// e RESTRINJA a chave ao domínio do GECOPE nos referrers dela; assim ela pode ficar neste arquivo público. Vazia = sem satélite.
// Chave criada em 21/10/2026 no portal sopdifor (ArcGIS Location Platform), aplicativo público, privilégios só de mapa base,
// referrer https://sop-difor.github.io. VENCE EM 20/10/2027: gerar uma nova no item "GECOPE mapa de obras (satélite)" e colar aqui.
window.ESRI_API_KEY = 'AAPTaVRLS9uVnDg5pIrwccr_cpw..Tuwu5My9h_Qg8hAQtnKigCM0WIl304MgP8iECGhoGWDa1t1rSrMrY4oTbB6mE1Ar-VtuJ3OYx4JSifSUuzVlcuqylllZMbOyNWgtW0eT0KHz55jy85OkO4BnBmzpynx5BXogH5fogPw69uqk2NjTJarzCiJIs8NSRJj7HYyngmSSIsuHeZgoqhmvKO4PRFVGOuKsb5m6PF3OCYgFU2zUkQYMh7GMI3JtLZVrhh9YzdoQizLyNH7-7ZI.AT1_m4nd146g';
