// Modo "embutido": páginas que o index.html mostra dentro de um iframe como módulo
// (Contratos, Atividades, Assistente). O iframe usa ?embed=1; nesse modo a página
// esconde o próprio cabeçalho/voltar/tema (CSS .embutido em cada página), porque o
// index.html já fornece título, "Painel Principal" e alternador de tema.
//
// Expõe window.GECOPE_EMBUTIDO e repassa a troca de tema do index como o evento
// 'gecope-tema' ({ detail: { dark } }) — cada página aplica do seu jeito.
(function () {
    var embutido = false;
    try { embutido = window.parent !== window && /[?&]embed=1\b/.test(location.search); } catch (e) { /* noop */ }
    window.GECOPE_EMBUTIDO = embutido;
    if (!embutido) return;

    document.documentElement.classList.add('embutido');

    window.addEventListener('message', function (e) {
        if (e.origin !== location.origin || e.source !== window.parent) return;
        var d = e.data;
        if (!d || d.tipo !== 'gecope-tema' || typeof d.dark !== 'boolean') return;
        window.dispatchEvent(new CustomEvent('gecope-tema', { detail: { dark: d.dark } }));
    });

    // Troca de módulo pelo index (ex.: botão "Processos" do cronograma).
    window.gecopeAbrirPane = function (paneId) {
        try { window.parent.showPane(paneId); } catch (e) { /* noop */ }
    };
})();
