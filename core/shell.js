// core/shell.js — chrome/UI compartilhada: home, painéis (showPane), tema, bootstrap de carregamento inicial.
// Extraído de main.js (Fase 2 da reorganização modular).

// Bug conhecido do Bootstrap 5: Modal.hide() sempre remove a classe "modal-open"
// do <body> ao terminar de fechar, mesmo que OUTRO modal continue aberto por trás
// (ex.: fechar o modal do checklist, salvo automaticamente, com GERENCIAR PROCESSO
// ainda aberto). Sem "modal-open" no body, o empilhamento/scroll do modal que
// permanece aberto fica bagunçado, e o próximo modal aberto a partir dele (ex.: o
// Relatório de Análise Documental) não aparece corretamente. Aqui a gente restaura
// a classe se, ao um modal fechar, ainda sobrar algum outro .modal.show na tela.
document.addEventListener('hidden.bs.modal', function () {
    if (document.querySelector('.modal.show')) {
        document.body.classList.add('modal-open');
    }
});

// Pré-carrega a página de destino (HTML + assets) assim que o mouse passa por cima
// do botão de navegação, para a troca de aba parecer instantânea ao clicar.
function prefetchPagina(url) {
    if (document.querySelector(`link[rel="prefetch"][href="${url}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
}

function toggleLanding(show) {
    const landing = document.getElementById('landingOverlay');
    const appContent = document.getElementById('app-content');
    if (show) {
        if (landing) landing.style.display = 'flex';
        if (appContent) appContent.style.display = 'none';
        document.body.classList.add('login-active');
    } else {
        if (landing) landing.style.display = 'none';
        if (appContent) appContent.style.display = 'block';
        document.body.classList.remove('login-active');
    }
}

function hideAdminPendings() {
    const sec = document.getElementById('admin-pending-section');
    if (sec) sec.style.display = 'none';
    const closeBtn = document.getElementById('admin-pending-close-btn');
    if (closeBtn) {
        const icon = closeBtn.querySelector('i');
        if (icon) icon.className = 'bi bi-chevron-down';
    }
}

function renderLastUpdate() {
    const el = document.getElementById("lastUpdateInfo");
    if (el) {
        const now = new Date();
        const str = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
        el.textContent = `ltima atualização: ${str}`;
    }
}

function updateHome() {
    const elHome = document.getElementById('pane-home');
    if (!elHome) return;

    // 1. Update Welcome Message
    const userName = sessionStorage.getItem('sop_user_name') || 'Usuário';
    const elName = document.getElementById('home-user-name');
    if (elName) elName.textContent = userName;

    // 1b. Update Recent Activities Summary
    carregarAtividadesResumoHome();

    // 2. Update Date
    const elDate = document.getElementById('home-current-date');
    if (elDate) {
        const agora = new Date();
        const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
        const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        elDate.textContent = `${diasSemana[agora.getDay()]}, ${agora.getDate()} de ${meses[agora.getMonth()]} de ${agora.getFullYear()}`;
    }

    // 3. Update Statistics
    const rows = window.allData || [];

    // Em Andamento (não aprovado, não cancelado, etc)
    const emAndamento = rows.filter(d => {
        const s = (d.status || "").toUpperCase();
        return !s.includes("APROVADO") && !s.includes("EXCLUÍDO") && !s.includes("EXCLUIDO") && !s.includes("CANCELADO") && !s.includes("ARQUIVADO");
    }).length;
    const elAndamento = document.getElementById('stat-proc-andamento');
    if (elAndamento) elAndamento.textContent = emAndamento;

    // Processos Em Análise (Apenas 'Em Análise' ou 'Em Reanálise')
    const emAnalise = rows.filter(d => {
        const s = (d.status || "").toUpperCase();
        const isAnalise = s.includes("EM ANÁLISE") || s.includes("EM ANALISE");
        const isReanalise = s.includes("EM REANÁLISE") || s.includes("EM REANALISE");
        const isAguardando = s.includes("AGUARD");
        return (isAnalise || isReanalise) && !isAguardando;
    }).length;
    const elAnalise = document.getElementById('stat-proc-analise');
    if (elAnalise) elAnalise.textContent = emAnalise;

    // Aditivos Aprovados no Mês
    const agora = new Date();
    const mesCorrente = agora.getMonth();
    const anoCorrente = agora.getFullYear();
    const aprovadosMes = rows.filter(d => {
        const s = (d.status || "").toUpperCase();
        const dt = d.dataAprovacao;
        return s.includes("APROVADO") && dt instanceof Date && dt.getMonth() === mesCorrente && dt.getFullYear() === anoCorrente;
    }).length;
    const elAprovMes = document.getElementById('stat-proc-aprovados');
    if (elAprovMes) elAprovMes.textContent = aprovadosMes;
}

// Tema claro/escuro do conteúdo das abas (persistido em localStorage).
// O painel Início mantém sempre o visual escuro do hero; este alternador afeta
// o restante do sistema (tabelas, cards, formulários das demais abas).
function updateThemeToggleUI() {
    const isDark = document.body.classList.contains('theme-dark');
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (icon) icon.className = isDark ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    if (label) label.textContent = isDark ? 'Claro' : 'Escuro';
}

function toggleAppTheme() {
    const isDark = document.body.classList.toggle('theme-dark');
    try { localStorage.setItem('gecope_theme', isDark ? 'dark' : 'light'); } catch (e) { /* noop */ }
    updateThemeToggleUI();
    // Os gráficos Plotly do Financeiro fixam cor de fonte/grade no momento do
    // render (Plotly não lê variáveis CSS), então precisam ser redesenhados ao
    // trocar de tema, senão ficam com as cores do tema anterior até o próximo filtro.
    const paneFinanceiro = document.getElementById('pane-financeiro');
    if (paneFinanceiro && paneFinanceiro.classList.contains('active') && typeof window.updateFinanceiro === 'function') {
        window.updateFinanceiro();
    }
}

document.addEventListener('DOMContentLoaded', updateThemeToggleUI);

// No painel Início, a saudação ("Olá, Nome") aparece dentro do próprio hero de fotos,
// substituindo o título genérico do subheader (que é usado nas demais páginas).
function setHeroContext(paneId) {
    const subheader = document.getElementById('panel-subheader');
    const greeting = document.getElementById('hero-home-greeting');
    const hero = document.querySelector('.gecope-hero');
    const isHome = paneId === 'pane-home';
    if (subheader) subheader.style.display = isHome ? 'none' : 'flex';
    if (greeting) greeting.style.display = isHome ? 'block' : 'none';
    if (hero) hero.classList.toggle('has-photo', isHome);
}

function showPane(paneId) {
    const tabBtn = document.querySelector(`#dashboardTabs [data-bs-target="#${paneId}"]`);
    if (tabBtn) {
        // não tenta abrir abas que foram escondidas por permissões
        const container = tabBtn.closest('li');
        if (container && container.style.display === 'none') {
            console.warn(`Acesso negado ao painel ${paneId}`);
            return;
        }
        tabBtn.click();
        // Scroll suave para o topo para dar feedback visual de mudança de tela
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const backBtn = document.getElementById('nav-back-container');
    if (backBtn) {
        backBtn.style.display = (paneId === 'pane-home') ? 'none' : 'flex';
    }
    const processosBtn = document.getElementById('nav-processos-btn');
    if (processosBtn) {
        if (paneId === 'pane-curva-abc' && curvaAbcProcessoState.vindoDoModal) {
            // Curva ABC aberta a partir de GERENCIAR PROCESSO (Análise Técnica): em vez de
            // levar à lista geral de Processos, volta a reabrir o mesmo processo.
            processosBtn.style.display = '';
            processosBtn.classList.add('btn-back-minimal');
            processosBtn.classList.remove('btn-forward-minimal');
            processosBtn.innerHTML = '<span>Voltar</span><i class="bi bi-arrow-right ms-1"></i>';
            processosBtn.onclick = () => { if (typeof voltarCurvaAbcParaProcesso === 'function') voltarCurvaAbcParaProcesso(); };
        } else {
            processosBtn.style.display = (paneId === 'pane-curva-abc') ? '' : 'none';
            processosBtn.classList.add('btn-forward-minimal');
            processosBtn.innerHTML = '<span>Processos</span><i class="bi bi-arrow-right"></i>';
            processosBtn.onclick = () => showPane('pane-reuniao');
        }
        if (paneId !== 'pane-curva-abc') curvaAbcProcessoState.vindoDoModal = false;
    }

    setHeroContext(paneId);

    // Atualiza o título do subheader
    const titles = {
        'pane-home': 'Painel Gerencial — Aditivos de Obras',
        'pane-financeiro': 'Painel Financeiro',
        'pane-curva-abc': 'Curva ABC',
        'pane-reuniao': 'Processos',
        'pane-orcamentos': 'Orçamentos',
        'pane-composicoes': 'Composições',
        'pane-tabelas': 'Tabelas',
        'pane-admin': 'Administração',
        'pane-atividades': 'Atividades Recentes'
    };
    const titleEl = document.getElementById('main-subheader-title');
    if (titleEl && titles[paneId]) {
        titleEl.textContent = titles[paneId];
    }

    // Lógica específica de carregamento por painel
    // (orcamentos e composicoes têm cache: só carregam na primeira visita)
    if (paneId === 'pane-home') {
        if (typeof updateHome === 'function') updateHome();
    }
    if (paneId === 'pane-admin') {
        if (typeof loadAllUsers === 'function') loadAllUsers();
        // also ensure close button hidden if no pendings
        try { const cb = document.getElementById('admin-pending-close-btn'); if (cb) cb.style.display = 'none'; } catch (e) { }
    }
    if (paneId === 'pane-atividades') {
        if (typeof carregarAtividades === 'function') carregarAtividades();
    }
    if (paneId === 'pane-orcamentos') {
        if (typeof carregarOrcamentos === 'function' && !window._orcamentosCarregados) {
            window._orcamentosCarregados = true;
            carregarOrcamentos();
        }
    }
    if (paneId === 'pane-composicoes') {
        if (typeof carregarComposicoes === 'function' && !window._composicoesCarregadas) {
            window._composicoesCarregadas = true;
            carregarComposicoes();
        }
    }
    if (paneId === 'pane-reuniao') {
        // Reset filtros estáticos ao abrir a aba para evitar filtros residuais
        try {
            if (window.mt) {
                if (window.mt.meta) window.mt.meta.value = "";
                if (window.mt.prioritario) window.mt.prioritario.value = "";
                if (window.mt.search) window.mt.search.value = "";
            }
        } catch (e) { console.warn('Erro ao resetar filtros de reunião', e); }
        if (typeof updateReuniao === 'function') updateReuniao();
    }
    if (paneId === 'pane-financeiro') {
        if (typeof updateFinanceiro === 'function') updateFinanceiro();
    }

    // Redimensiona gráficos Plotly após animação da aba
    setTimeout(() => {
        const activePane = document.getElementById(paneId);
        if (activePane) {
            activePane.querySelectorAll('.chart-placeholder').forEach(c => {
                if (window.Plotly) Plotly.Plots.resize(c);
            });
        }
    }, 300);
}

function updateDashboard() {
    if (typeof updateHome === 'function') updateHome();
    if (typeof updateReuniao === 'function') updateReuniao();
    if (typeof updateFinanceiro === 'function') updateFinanceiro();
}

// --- 6. EVENT LISTENERS E MÁSCARAS ---
document.addEventListener('DOMContentLoaded', () => {
    const landing = document.getElementById('landingOverlay');

    // Carrega dados automaticamente
    carregarDadosSupabase();

    // Carrega lista de fiscais/usuários do Banco
    carregarListaFiscais();

    document.querySelectorAll('.mask-date').forEach(input => {
        input.addEventListener('input', function (e) {
            let v = e.target.value.replace(/\D/g, "");
            if (v.length > 8) v = v.substring(0, 8);
            if (v.length >= 5) { v = v.replace(/^(\d{2})(\d{2})(\d+)/, "$1/$2/$3"); }
            else if (v.length >= 3) { v = v.replace(/^(\d{2})(\d+)/, "$1/$2"); }
            e.target.value = v;
        });
    });

    // --- MÁSCARA DE MOEDA E CÁLCULO DE REPERCUSSÃO ---
    document.querySelectorAll('.mask-money').forEach(input => {
        input.addEventListener('input', e => {
            // 1. Aplicar Máscara
            let v = e.target.value.replace(/\D/g, '');
            if (v === "") {
                e.target.value = "";
            } else {
                v = (parseInt(v) / 100).toFixed(2).replace(".", ",").replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
                const lowId = e.target.id.toLowerCase();
                if (lowId.includes('supres') && v !== "0,00") { v = "-" + v; }
                e.target.value = v;
            }

            // 2. Disparar Cálculo de Repercussão
            calcularRepercussao();
        });
    });

    wireEvents();
    applyRBACToPainels();
    verificarAdminSalvo();
    // PERFORMANCE: marca a flag de cache antes do carregamento inicial — sem isso,
    // a primeira vez que o usuário abria a aba Orçamentos (showPane, linha ~3191)
    // disparava uma segunda consulta paginada completa a orcamentos_biblioteca,
    // idêntica a esta, porque a flag nunca tinha sido setada por este carregamento eager.
    window._orcamentosCarregados = true;
    carregarOrcamentos();
});

// --- FUNO PARA APLICAR RBAC NOS PAINIS ---
function applyRBACToPainels() {
    const role = getCurrentUserRole();

    if (role === 'fiscal') {
        // Ocultar filtro de Fiscal para Fiscal (Painel Financeiro)
        if (fin.fiscal && fin.fiscal.parentElement) {
            fin.fiscal.parentElement.parentElement.style.display = 'none';
        }

        // Desabilitar botão Limpar para Fiscal (Painel Financeiro)
        if (fin.clear) {
            fin.clear.disabled = true;
            fin.clear.title = 'Filtro automático por fiscal - não pode ser alterado';
        }

    }
}

function wireEvents() {
    fin.status.addEventListener("change", updateFinanceiro); fin.fiscal.addEventListener("change", updateFinanceiro);
    fin.contratada.addEventListener("change", updateFinanceiro); fin.contratante.addEventListener("change", updateFinanceiro); fin.ano.addEventListener("change", updateFinanceiro);
    fin.clear.addEventListener("click", (e) => { e.preventDefault(); clearFinanceiro(); });
    fin.diffMetric.addEventListener("change", updateFinanceiro);
    mt.meta.addEventListener("change", updateReuniao); mt.prioritario.addEventListener("change", updateReuniao); mt.fiscal.addEventListener("change", updateReuniao); mt.status.addEventListener("change", updateReuniao);
    // Debounce no search de reunião
    mt.search.addEventListener("input", debounce(updateReuniao, 300));

    document.getElementById("btn-reuniao-clear").addEventListener("click", (e) => {
        e.preventDefault();
        if (mt && mt.search) mt.search.value = "";
        [mt.meta, mt.prioritario, mt.fiscal, mt.status].forEach(el => {
            if (!el) return;
            if (el.multiple) {
                Array.from(el.options).forEach(o => { if (o.value) o.selected = true; });
                if (typeof renderMultiSelectUI === 'function') renderMultiSelectUI(el);
            } else {
                // Select simples: voltar para 'Todos' (valor vazio)
                el.value = "";
            }
        });
        currentSort = []; updateReuniao();
    });

    // Listeners de Orçamentos com Debounce
    const orcSearch = document.getElementById('orcamento-search');
    if (orcSearch) orcSearch.addEventListener('input', debounce(carregarOrcamentos, 400));

    // Listeners de Tabelas (BDI/Desconto/Busca) com Debounce
    document.getElementById('busca-bdi')?.addEventListener('input', debounce(recalcTabela, 300));
    document.getElementById('busca-desc')?.addEventListener('input', debounce(recalcTabela, 300));

    document.querySelectorAll('.nav-link').forEach(t => t.addEventListener('shown.bs.tab', (e) => { const p = document.querySelector(e.target.getAttribute('data-bs-target')); if (p) p.querySelectorAll('.chart-placeholder').forEach(c => Plotly.Plots.resize(c)); }));
}

// Silencia console.log/info em produção (extraído de main.js).
// Set `IS_PROD` to false during debugging to restore console output.
(function () {
    const IS_PROD = true;
    if (IS_PROD && typeof window.console === 'object') {
        console.log = function () { };
        console.info = function () { };
    }
})();
