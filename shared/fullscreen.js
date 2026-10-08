// Tela cheia compartilhada por todas as páginas do GECOPE.
//
// A Fullscreen API é descartada pelo navegador a cada navegação de página
// (index -> Contratos/mapa, Atividades, Assistente...). Por isso guardamos a
// intenção do usuário em sessionStorage e, na página seguinte, voltamos para a
// tela cheia no primeiro clique/tecla — o navegador só permite entrar em tela
// cheia dentro de um gesto do usuário, então não dá para fazer isso sozinho.

(function () {
    // Dentro de um iframe (Contratos embutido) quem manda é a página principal.
    if (window.self !== window.top) return;

    var CHAVE = 'gecope_fullscreen';
    var navegando = false;

    function ativa() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function guardar(valor) {
        try {
            if (valor) sessionStorage.setItem(CHAVE, '1');
            else sessionStorage.removeItem(CHAVE);
        } catch (e) { /* noop */ }
    }

    function desejada() {
        try { return sessionStorage.getItem(CHAVE) === '1'; } catch (e) { return false; }
    }

    function entrar() {
        var root = document.documentElement;
        var req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!req) return Promise.reject(new Error('sem suporte'));
        return Promise.resolve(req.call(root));
    }

    function sair() {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) return Promise.resolve(ex.call(document));
        return Promise.resolve();
    }

    function atualizarBotao() {
        var fs = ativa();
        var icon = document.getElementById('fullscreen-toggle-icon');
        var label = document.getElementById('fullscreen-toggle-label');
        if (icon) icon.className = fs ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen';
        if (label) label.textContent = fs ? 'Restaurar' : 'Tela cheia';
    }

    // Botão ao lado do alternador de tema (index.html e cronograma.html).
    window.toggleFullscreen = function () {
        var p = ativa() ? sair() : entrar();
        p.catch(function () { /* sem suporte ou bloqueado: botão fica sem efeito */ });
    };
    window.updateFullscreenToggleUI = atualizarBotao;

    // Quando a página está sendo descarregada o navegador também sai da tela
    // cheia e dispara fullscreenchange; isso não é o usuário saindo de propósito.
    window.addEventListener('beforeunload', function () { navegando = true; });
    window.addEventListener('pagehide', function () { navegando = true; });

    function aoMudar() {
        atualizarBotao();
        if (navegando) return;
        guardar(ativa()); // Esc/F11/botão: a intenção acompanha o estado real
    }
    document.addEventListener('fullscreenchange', aoMudar);
    document.addEventListener('webkitfullscreenchange', aoMudar);

    // --- Retomada na página seguinte -------------------------------------
    var aviso = null;

    function removerAviso() {
        if (aviso && aviso.parentNode) aviso.parentNode.removeChild(aviso);
        aviso = null;
    }

    function pararDeEsperar() {
        ['pointerdown', 'pointerup', 'keydown'].forEach(function (ev) {
            document.removeEventListener(ev, aoGesto, true);
        });
        removerAviso();
    }

    function aoGesto(e) {
        if (e.type === 'keydown' && e.key === 'Escape') return;
        if (ativa()) { pararDeEsperar(); return; }
        entrar().then(pararDeEsperar, function () { /* tenta no próximo gesto */ });
    }

    function mostrarAviso() {
        if (!document.body) return;
        aviso = document.createElement('div');
        aviso.textContent = 'Clique em qualquer lugar para voltar à tela cheia';
        aviso.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
            'z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;font:600 13px system-ui,sans-serif;' +
            'padding:9px 16px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;';
        document.body.appendChild(aviso);
    }

    function iniciar() {
        atualizarBotao();
        if (!desejada() || ativa()) return;
        ['pointerdown', 'pointerup', 'keydown'].forEach(function (ev) {
            document.addEventListener(ev, aoGesto, true);
        });
        mostrarAviso();
    }

    // Voltar pelo histórico pode restaurar a página do cache (bfcache) sem recarregar.
    window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        navegando = false;
        iniciar();
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
