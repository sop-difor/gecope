// modules/atividades/atividades.js — módulo Atividades: registro e listagem do feed de atividades
// (chamado por outros módulos para registrar eventos, e usado pela aba/resumo de Atividades).
// Extraído de main.js (Fase 3 da reorganização modular).

/* --------------------------------------------------------------
   LGICA DE LTIMAS ATIVIDADES (REGISTRO E LISTAGEM)
-------------------------------------------------------------- */

async function registrarAtividade(tipo, descricao, contexto = '', obra = '', fiscal = '') {
    try {
        const userName = sessionStorage.getItem('sop_user_name') || 'Sistema';
        const userRole = sessionStorage.getItem('sop_role') || 'guest';

        const payload = {
            usuario: userName,
            perfil: userRole,
            descricao,
            tipo,
            contexto,
            obra,
            fiscal: fiscal // Usado para filtrar para Fiscais
        };

        await sbClient.from('app_atividades').insert([payload]);
    } catch (err) {
        console.error("Erro ao registrar atividade:", err);
    }
}

async function carregarAtividades() {
    const listEl = document.getElementById('full-activities-list');
    const countEl = document.getElementById('count-atividades-24h');
    if (!listEl) return;

    const userRole = sessionStorage.getItem('sop_role') || 'guest';
    const userName = sessionStorage.getItem('sop_user_name') || '';

    // Filtro de 24h
    const periodo = new Date();
    periodo.setDate(periodo.getDate() - 7);

    try {
        let query = sbClient.from('app_atividades')
            .select('*')
            .gte('created_at', periodo.toISOString())
            .order('created_at', { ascending: false });

        // Se for fiscal, filtra apenas suas obras/processos
        if (userRole.toLowerCase() === 'fiscal' && userName) {
            // No caso de processos, filtramos pelo campo fiscal
            // No caso de outros (composição, orçamento), eles veem tudo? 
            // O usuário disse: "Na aba Processo... para os usuários fiscais essas informações só devem aparecer das suas respectivas obras, já os administradores e gerentes podem ver de todos os processos;"
            // "Na aba Orçamentos... as movimentações aparecem para todos."
            // "Na aba Composições... as movimentações aparecem para todos."
            // "Na aba Tabelas... as movimentações aparecem para todos."

            // Então o filtro é apenas para tipo PROCESSO.
            // Mas na query do Supabase é difícil fazer OR (tipo != PROCESSO OR fiscal == userName).
            // Vamos filtrar no JS para simplificar ou usar .or()
            // userName vai interpolado na sintaxe de filtro do PostgREST (vírgula separa condições,
            // parênteses agrupam) — removemos esses caracteres para que um nome de cadastro não
            // consiga forjar uma condição extra e ver atividades de outros fiscais/processos.
            const safeUserName = String(userName).replace(/[,()]/g, '');
            query = query.or(`tipo.neq.PROCESSO,fiscal.eq.${safeUserName}`);
        }

        const { data, error } = await query;
        if (error) throw error;

        countEl.textContent = `${data.length} registros`;

        if (data.length === 0) {
            listEl.innerHTML = '<div class="text-center py-5 text-muted">Nenhuma atividade registrada nos últimos 7 dias.</div>';
            return;
        }

        listEl.innerHTML = data.map(at => {
            const icon = getAtividadeIcon(at.tipo);
            const dataHora = new Date(at.created_at).toLocaleString('pt-BR');
            return `
                                <div class="list-group-item p-3 border-0 border-bottom">
                                    <div class="d-flex align-items-center gap-3">
                                        <div class="home-action-icon" style="width: 40px; height: 40px; min-width: 40px; background: #f8f9fa;">
                                            <i class="bi ${icon}"></i>
                                        </div>
                                        <div>
                                            <div class="small text-muted mb-1">${dataHora}  ${at.tipo}</div>
                                            <div class="fw-semibold" style="font-size: 0.95rem;">${escapeHTML(at.usuario)} ${escapeHTML(at.descricao)}</div>
                        </div>
                    </div>
                </div>
                            `;
        }).join('');

    } catch (err) {
        console.error("Erro ao carregar atividades:", err);
        listEl.innerHTML = '<div class="alert alert-danger m-3">Erro ao carregar atividades.</div>';
    }
}

async function carregarAtividadesResumoHome() {
    const listEl = document.getElementById('home-activities-list');
    if (!listEl) return;

    const userRole = sessionStorage.getItem('sop_role') || 'guest';
    const userName = sessionStorage.getItem('sop_user_name') || '';

    try {
        let query = sbClient.from('app_atividades')
            .select('*')
            .limit(4)
            .order('created_at', { ascending: false });

        if (userRole.toLowerCase() === 'fiscal' && userName) {
            const safeUserName = String(userName).replace(/[,()]/g, '');
            query = query.or(`tipo.neq.PROCESSO,fiscal.eq.${safeUserName}`);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data.length === 0) {
            listEl.innerHTML = '<div class="text-center py-3 w-100 text-muted">Sem atividades recentes.</div>';
            return;
        }

        listEl.innerHTML = data.map(at => {
            const dt = new Date(at.created_at);
            const hora = dt.getHours().toString().padStart(2, '0') + ':' + dt.getMinutes().toString().padStart(2, '0');
            const timeLabel = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
            const iconClass = getAtividadeIcon(at.tipo);
            const badgeClass = getAtividadeBadgeClass(at.tipo);
            const badgeLabel = getAtividadeLabel(at.tipo);

            return `
                                <div class="activity-item">
                                    <div class="activity-icon-box">
                                        <i class="bi ${iconClass} fs-5"></i>
                                    </div>
                                    <div class="activity-content">
                                        <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
                                            <span class="activity-time mb-0">${timeLabel}</span>
                                            <span class="activity-badge ${badgeClass}">${badgeLabel}</span>
                                        </div>
                                        <div class="activity-desc"><strong>${escapeHTML(at.usuario)}</strong> ${escapeHTML(at.descricao)}</div>
                                    </div>
                                </div>
                            `;
        }).join('');

    } catch (err) {
        console.error("Erro no resumo de atividades:", err);
        listEl.innerHTML = '<div class="text-muted small">Erro ao carregar resumo.</div>';
    }
}

function getAtividadeIcon(tipo) {
    switch (tipo) {
        case 'PROCESSO': return 'bi-file-earmark-text text-primary';
        case 'ORCAMENTO': return 'bi-folder-check text-success';
        case 'COMPOSICAO': return 'bi-journal-text text-warning';
        case 'TABELA': return 'bi-search text-info';
        default: return 'bi-clock-history';
    }
}

function getAtividadeLabel(tipo) {
    switch (tipo) {
        case 'PROCESSO': return 'Processo';
        case 'ORCAMENTO': return 'Orçamento';
        case 'COMPOSICAO': return 'Composição';
        case 'TABELA': return 'Tabela';
        default: return tipo || 'Outro';
    }
}

function getAtividadeBadgeClass(tipo) {
    switch (tipo) {
        case 'PROCESSO': return 'badge-processo';
        case 'ORCAMENTO': return 'badge-orcamento';
        case 'COMPOSICAO': return 'badge-composicao';
        case 'TABELA': return 'badge-tabela';
        default: return 'badge-outro';
    }
}
