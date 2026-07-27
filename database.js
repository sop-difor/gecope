(function (window) {
    'use strict';

    // Storage guard: mantém sessão ativa apenas enquanto existir o cookie de sessão
    const cookieGuardStorage = {
        getItem: (key) => {
            const sessionActive = document.cookie.split(';').some((item) => item.trim().startsWith('gecope_session_active='));
            if (!sessionActive) {
                localStorage.removeItem(key);
                return null;
            }
            return localStorage.getItem(key);
        },
        setItem: (key, value) => {
            document.cookie = "gecope_session_active=true; path=/; SameSite=Lax";
            localStorage.setItem(key, value);
        },
        removeItem: (key) => {
            localStorage.removeItem(key);
        }
    };

    // Expor storage guard globalmente para compatibilidade
    window.cookieGuardStorage = cookieGuardStorage;

    // Variável global do cliente Supabase (declarada com var para anexar a window automaticamente)
    var sbClient = window.sbClient || null;
    window.sbClient = sbClient;

    // Inicializa o cliente Supabase de forma defensiva
    function initSupabaseClient() {
        if (!sbClient && window.supabase && typeof window.supabase.createClient === 'function') {
            sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
                auth: { storage: cookieGuardStorage, autoRefreshToken: true, persistSession: true }
            });
            // Sincroniza também com window
            window.sbClient = sbClient;
            console.log("[Supabase] Conectado.");
        }
    }

    // Expor API mínima
    window.initSupabaseClient = initSupabaseClient;
    window.sbClient = sbClient; // garante que está exposto

    // Auto-init quando o script for carregado (se supabase já estiver disponível)
    try { initSupabaseClient(); } catch (e) { console.error('[Supabase] Falha ao inicializar:', e); }
    window.addEventListener('load', () => {
        try { initSupabaseClient(); } catch (e) { console.error('[Supabase] Falha ao inicializar (load):', e); }
        // Se, mesmo depois do carregamento completo da página, o cliente continuar nulo,
        // o CDN do Supabase provavelmente foi bloqueado (ad-blocker, proxy, rede) — sem
        // este aviso, toda chamada a sbClient.from(...) falha silenciosamente com um
        // TypeError, e a tela simplesmente fica travada sem explicação ao usuário.
        setTimeout(() => {
            if (!window.sbClient) {
                console.error('[Supabase] Cliente não inicializado após o carregamento da página.');
                alert('Não foi possível conectar ao banco de dados. Verifique sua conexão com a internet ou desative bloqueadores de anúncio/script para este site, e recarregue a página.');
            }
        }, 4000);
    });

})(window);
