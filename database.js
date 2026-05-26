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
            setTimeout(() => { if (window.showToast) window.showToast("Motor SOP v2 Ativo", "info"); }, 1500);
        }
    }

    // Helper simples para invocar funções do Supabase Edge
    async function invokeFunction(name, opts) {
        if (!sbClient || !sbClient.functions) throw new Error('Supabase client não inicializado');
        return sbClient.functions.invoke(name, opts);
    }

    // Expor API mínima
    window.initSupabaseClient = initSupabaseClient;
    window.invokeFunction = invokeFunction;
    window.sbClient = sbClient; // garante que está exposto

    // Auto-init quando o script for carregado (se supabase já estiver disponível)
    try { initSupabaseClient(); } catch (e) { /* noop */ }
    window.addEventListener && window.addEventListener('load', initSupabaseClient);

})(window);
