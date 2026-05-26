(function (window) {
    'use strict';

    // Administração: funções movidas de main.js
    const SENHA_MESTRA = "sop2026";
    const USERS = [ { username: 'admin', password: SENHA_MESTRA, isAdmin: true } ];

    function atualizarIconesCadeado(isLocked) {
        const icones = document.querySelectorAll('.btn-admin-login i');
        icones.forEach(icon => {
            if (isLocked) {
                icon.className = 'bi bi-lock-fill';
                icon.style.color = '#ccc';
            } else {
                icon.className = 'bi bi-unlock-fill';
                icon.style.color = 'var(--sop-green)';
            }
        });
    }

    function verificarAdminSalvo() {
        const isAdm = sessionStorage.getItem('is_admin_gecope');
        if (isAdm === 'true') {
            document.body.classList.add('is-admin');
            atualizarIconesCadeado(false);
        } else {
            document.body.classList.remove('is-admin');
            atualizarIconesCadeado(true);
        }
    }

    function alternarModoAdmin() {
        if (document.body.classList.contains('is-admin')) {
            if (confirm("Deseja sair do modo Administrador?")) {
                document.body.classList.remove('is-admin');
                sessionStorage.removeItem('is_admin_gecope');
                sessionStorage.setItem('sop_role', 'guest');
                if (typeof applyRoleToUI === 'function') applyRoleToUI('guest');
                atualizarIconesCadeado(true);
                alert("Modo de visualização ativado.");
                if (document.querySelector('.modal.show')) location.reload();
            }
            return;
        }
        const modalEl = document.getElementById('modalLogin');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        } else {
            const tentativa = prompt(" Digite a senha de administrador:");
            if (tentativa === SENHA_MESTRA) {
                document.body.classList.add('is-admin');
                sessionStorage.setItem('is_admin_gecope', 'true');
                atualizarIconesCadeado(false);
                alert(" Modo Administrador Ativado!");
            } else if (tentativa !== null) { alert(" Senha incorreta."); }
        }
    }

    function handleLoginSubmit(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value.trim();
        const pass = document.getElementById('login-password').value;
        const feedback = document.getElementById('login-feedback');
        feedback.style.display = 'none';
        const found = USERS.find(u => u.username === user && u.password === pass);
        if (found) {
            document.body.classList.add('is-admin');
            sessionStorage.setItem('is_admin_gecope', 'true');
            sessionStorage.setItem('sop_user', user);
            sessionStorage.setItem('sop_role', 'admin');
            if (typeof applyRoleToUI === 'function') applyRoleToUI('admin');
            atualizarIconesCadeado(false);
            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalLogin'));
            if (modal) modal.hide();
            alert(" Modo Administrador Ativado!");
        } else {
            feedback.style.display = 'block';
        }
    }

    // --- ADMIN DASHBOARD LOGIC ---
    async function loadAllUsers() {
        const tbodyActive = document.getElementById('admin-users-table-body');
        const tbodyPending = document.getElementById('admin-pending-table-body');
        const sectionPending = document.getElementById('admin-pending-section');
        const statTotal = document.getElementById('admin-stat-total');
        const statPending = document.getElementById('admin-stat-pending');
        const statAdmins = document.getElementById('admin-stat-admins');
        const statOthers = document.getElementById('admin-stat-others');
        const pendingTabBadge = document.getElementById('admin-pending-badge-tab');

        if (!tbodyActive || !tbodyPending) return;
        tbodyActive.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Carregando usuários...</td></tr>';

        try {
            const { data, error } = await sbClient.from('app_users').select('*').order('created_at', { ascending: false });
            if (error) throw error;

            const pendings = data.filter(u => u.role === 'pending').sort((a, b) => {
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });
            const actives = data.filter(u => u.role !== 'pending');

            // Also fetch new_user_request notifications to surface requests that did not create app_users
            let notifPendings = [];
            try {
                const { data: notes, error: notesErr } = await sbClient.from('app_notifications').select('id,type,payload,read,created_at').eq('type', 'new_user_request').order('created_at', { ascending: false }).limit(200);
                if (!notesErr && Array.isArray(notes)) {
                    for (const n of notes) {
                        let parsed = null;
                        try { parsed = JSON.parse(n.payload || '{}'); } catch (e) { parsed = null; }
                        const matricula = parsed?.matricula || null;
                        const nome = parsed?.nome || null;
                        const email = matricula ? `${matricula}@gecope.app` : null;

                        // Check if there is an app_user with this matricula/email
                        const found = data.find(u => (u.matricula && matricula && String(u.matricula) === String(matricula)) || (u.email && email && u.email.toLowerCase() === email.toLowerCase()));

                        // Only surface if no app_user exists OR existing user is not active (not approved)
                        if (!found || (found && found.role === 'pending')) {
                            notifPendings.push({
                                id: found?.id || null,
                                email: email || (found ? found.email : 'N/A'),
                                matricula: matricula,
                                nome: nome,
                                created_at: n.created_at,
                                notif_id: n.id,
                                notification_raw: n
                            });
                        }
                    }
                }
            } catch (e) { console.error('Erro ao buscar notificações de cadastro:', e); }

            const roleOrder = { 'admin': 1, 'fiscal': 2, 'gerente': 3, 'externo': 4 };
            actives.sort((a, b) => {
                const orderA = roleOrder[a.role] || 99;
                const orderB = roleOrder[b.role] || 99;
                if (orderA !== orderB) return orderA - orderB;
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });

            const totalPending = pendings.length + notifPendings.length;
            if (statTotal) statTotal.textContent = data.length;
            if (statPending) statPending.textContent = totalPending;
            if (statAdmins) statAdmins.textContent = data.filter(u => u.role === 'admin').length;
            if (statOthers) statOthers.textContent = data.filter(u => u.role !== 'admin' && u.role !== 'pending').length;
            if (pendingTabBadge) pendingTabBadge.textContent = totalPending;
            if (sectionPending) sectionPending.style.display = totalPending > 0 ? 'block' : 'none';

            tbodyPending.innerHTML = '';

            // Render pending users from app_users
            pendings.forEach(u => {
                const dataSolic = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : 'N/A';
                const nomeComp = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'N/A').toUpperCase();

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${nomeComp}</div>
                        <div class="small text-muted">${u.email}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border fw-normal">${u.matricula || '-'}</span></td>
                    <td><span class="text-muted small">${dataSolic}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm" style="width: 120px;" id="role-pending-${u.id}">
                                <option value="externo">EXTERNO</option>
                                <option value="fiscal">FISCAL</option>
                                <option value="gerente">GERENTE</option>
                                <option value="admin">ADMIN</option>
                            </select>
                            <button class="btn btn-sm btn-success" onclick="aprovarUsuario('${u.email}', document.getElementById('role-pending-${u.id}').value)">
                                <i class="bi bi-check-lg me-1"></i> Aprovar
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="excluirUsuario('${u.email}')" title="Recusar">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyPending.appendChild(tr);
            });

            // Render pending requests coming from notifications (not yet present in app_users)
            notifPendings.forEach((n, idx) => {
                const dataSolic = n.created_at ? new Date(n.created_at).toLocaleDateString('pt-BR') : 'N/A';
                const nomeComp = (n.nome || 'N/A').toUpperCase();
                const tr = document.createElement('tr');
                const selectId = `role-notif-${n.notif_id || idx}`;
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${nomeComp} <small class="text-muted">(notificação)</small></div>
                        <div class="small text-muted">${n.matricula ? (n.matricula + '@gecope.app') : 'sem matrícula'}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border fw-normal">${n.matricula || '-'}</span></td>
                    <td><span class="text-muted small">${dataSolic}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm" style="width: 120px;" id="${selectId}">
                                <option value="externo">EXTERNO</option>
                                <option value="fiscal">FISCAL</option>
                                <option value="gerente">GERENTE</option>
                                <option value="admin">ADMIN</option>
                            </select>
                            <button class="btn btn-sm btn-success" onclick="aprovarFromNotification('${n.notif_id}', document.getElementById('${selectId}').value, '${n.matricula}', '${(n.nome||'').replace(/'/g,'&#39;')}')">
                                <i class="bi bi-check-lg me-1"></i> Aprovar
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="recusarNotification('${n.notif_id}')" title="Recusar">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyPending.appendChild(tr);
            });

            tbodyActive.innerHTML = '';
            if (actives.length === 0) {
                tbodyActive.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Nenhum usuário ativo.</td></tr>';
            }

            actives.forEach(u => {
                const fullNome = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'Não informado').toUpperCase();
                let roleColor = 'bg-secondary';
                if (u.role === 'admin') roleColor = 'bg-danger';
                else if (u.role === 'gerente') roleColor = 'bg-primary';
                else if (u.role === 'fiscal') roleColor = 'bg-success';
                else if (u.role === 'externo') roleColor = 'bg-dark';

                const roles = ['admin', 'gerente', 'fiscal', 'externo'];
                const optionsHtml = roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('');

                let fiscalInfo = '';
                if (u.role === 'fiscal' && u.nome) {
                    const nomeCompleto = (u.nome + (u.sobrenome ? ' ' + u.sobrenome : '')).trim();
                    const encontradoNaLista = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                    if (encontradoNaLista) {
                        fiscalInfo = `<span class="badge bg-info text-dark ms-2" title="Fiscal encontrado na lista">${encontradoNaLista}</span>`;
                    } else {
                        fiscalInfo = `<span class="badge bg-warning text-dark ms-2" title="Não encontrado na lista">️</span>`;
                    }
                }

                const tr = document.createElement('tr');
                tr.setAttribute('data-search', `${fullNome.toLowerCase()} ${u.matricula} ${u.email.toLowerCase()}`);
                tr.innerHTML = `
                    <td class="ps-4"><div class="fw-bold text-dark">${fullNome}</div></td>
                    <td><div class="small text-muted">${u.email}</div></td>
                    <td><div class="small fw-bold text-secondary">${u.telefone_whatsapp || '-'}</div></td>
                    <td><span class="badge bg-light text-dark border fw-normal">${u.matricula || '-'}</span></td>
                    <td>
                        <span class="badge ${roleColor} rounded-pill px-3" style="font-size: 0.72rem; min-width: 80px;">${u.role.toUpperCase()}</span>
                        ${fiscalInfo}
                    </td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm border-0 bg-light" style="width:130px;" onchange="updateUserRole('${u.email}', this.value)">
                                ${optionsHtml}
                            </select>
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="excluirUsuario('${u.email}')" title="Excluir Usuário">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyActive.appendChild(tr);
            });

        } catch (e) {
            console.error('Erro ao listar usuários:', e);
            tbodyActive.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Erro ao carregar banco de usuários: ${e.message}</td></tr>`;
        }
    }

    async function loadFiscalDirectory() {
        const tbody = document.getElementById('fiscal-directory-table-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted small"><div class="spinner-border spinner-border-sm me-2"></div>Carregando fiscais...</td></tr>';
        try {
            const { data: users, error } = await sbClient.from('app_users').select('nome, sobrenome, full_name, telefone_whatsapp, email');
            if (error) throw error;
            const realFiscals = new Set();
            users.forEach(u => {
                if (!u.email.includes('@sop-ghost.internal')) {
                    const name = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || '').toUpperCase();
                    if (name) realFiscals.add(name);
                }
            });
            const directoryData = FISCAIS_LIST.filter(name => !realFiscals.has(name.toUpperCase())).map(name => {
                const ghost = users.find(u => {
                    const uName = (u.full_name || '').toUpperCase();
                    return u.email.includes('@sop-ghost.internal') && uName === name.toUpperCase();
                });
                return { name: name, phone: ghost ? (ghost.telefone_whatsapp || '') : '', isGhost: !!ghost };
            });

            tbody.innerHTML = '';
            if (directoryData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted small">Todos os fiscais da lista já possuem cadastro oficial.</td></tr>';
                return;
            }

            directoryData.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="ps-4 fw-bold text-dark">${item.name.toUpperCase()}</td>
                    <td>
                        <input type="text" class="form-control form-control-sm" style="max-width: 200px;" id="dir-phone-${item.name.replace(/\s+/g, '_')}" value="${item.phone}" placeholder="Ex: 85988887777">
                    </td>
                    <td class="text-end pe-4">
                        <button class="btn btn-sm btn-outline-success" onclick="saveFiscalContact('${item.name}', 'dir-phone-${item.name.replace(/\s+/g, '_')}')">
                            <i class="bi bi-save me-1"></i> Salvar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (e) {
            console.error('Erro ao carregar diretório:', e);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4 small">Erro: ' + e.message + '</td></tr>';
        }
    }

    async function saveFiscalContact(name, inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const phone = input.value.trim();
        const btn = event?.target?.closest('button');
        const originalHtml = btn ? btn.innerHTML : '';
        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
            await WhatsAppConfigManager.savePhoneForUser(name, 'ghost', phone);
            if (typeof showToast === 'function') showToast(`Contato de ${name} atualizado com sucesso!`);
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar contato.");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
        }
    }

    let _vincularContext = null;

    document.addEventListener('DOMContentLoaded', () => {
        const btnConfirmar = document.getElementById('btn-confirmar-vinculo');
        if (btnConfirmar) {
            btnConfirmar.addEventListener('click', async () => {
                if (!_vincularContext) return;
                const select = document.getElementById('vincular-fiscal-select');
                const novoNome = select.value;
                if (!novoNome) { alert("Por favor, selecione um nome da lista."); return; }
                try {
                    btnConfirmar.disabled = true; btnConfirmar.innerHTML = "Salvando...";
                    const partes = novoNome.split(' ');
                    const nome = partes[0];
                    const sobrenome = partes.slice(1).join(' ');
                    const { error } = await sbClient.from('app_users').update({ full_name: novoNome, nome: nome, sobrenome: sobrenome }).eq('email', _vincularContext.email);
                    if (error) throw error;
                    alert(` Usuário vinculado a "${novoNome}" com sucesso!`);
                    const modalEL = document.getElementById('modalVincularFiscal');
                    const modal = bootstrap.Modal.getInstance(modalEL);
                    modal.hide();
                    if (_vincularContext.action === 'aprovar') {
                        aprovarUsuario(_vincularContext.email, _vincularContext.role, true);
                    } else if (_vincularContext.action === 'update') {
                        updateUserRole(_vincularContext.email, _vincularContext.role, true);
                    }
                } catch (e) {
                    alert("Erro ao vincular: " + e.message);
                } finally {
                    btnConfirmar.disabled = false; btnConfirmar.innerHTML = "Confirmar Vínculo";
                }
            });
        }
    });

    function abrirModalVinculo(nomeAtual, email, role, action) {
        _vincularContext = { email, role, action };
        document.getElementById('vincular-usuario-nome').textContent = nomeAtual || email;
        const sel = document.getElementById('vincular-fiscal-select');
        sel.innerHTML = '<option value="">Selecione...</option>';
        FISCAIS_LIST.forEach(f => {
            const opt = document.createElement('option'); opt.value = f; opt.textContent = f; sel.appendChild(opt);
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalVincularFiscal')).show();
    }

    async function aprovarUsuario(email, role = 'externo', skipConfirm = false) {
        if (!skipConfirm && !confirm(`Confirmar aprovação de ${email} como ${role.toUpperCase()}?`)) return;
        try {
            if (role === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, role, 'aprovar'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: role }).eq('email', email);
            if (error) throw error;
            if (!skipConfirm) alert('Usuário aprovado com sucesso!');
            loadAllUsers(); if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao aprovar: ' + e.message); }
    }

    async function excluirUsuario(email) {
        if (!confirm(`Remover definitivamente o usuário ${email}?`)) return;
        try {
            const { error } = await sbClient.from('app_users').delete().eq('email', email);
            if (error) throw error; alert('Usuário removido.'); loadAllUsers(); if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao excluir: ' + e.message); }
    }

    async function aprovarFromNotification(notifId, role, matricula, nome) {
        if (!notifId) return alert('Notificação inválida.');
        if (!confirm(`Confirmar aprovação de ${matricula || nome} como ${role.toUpperCase()}?`)) return;
        try {
            // get current access token
            let token = null;
            try {
                const s = await sbClient.auth.getSession();
                token = s?.data?.session?.access_token || null;
            } catch (e) { token = null; }

            let success = false;
            let errorMsg = '';

            // 1. Tentativa principal: invocar a Edge Function do Supabase diretamente
            try {
                const { data: invokeData, error: invokeErr } = await sbClient.functions.invoke('approve-user', {
                    body: { notifId, role, matricula, nome }
                });

                if (!invokeErr) {
                    success = true;
                } else {
                    errorMsg = invokeErr.message || String(invokeErr);
                }
            } catch (invokeErr) {
                errorMsg = invokeErr.message || String(invokeErr);
            }

            // 2. Segunda tentativa: Chamada HTTP ao endpoint configurado (Netlify/Vercel)
            if (!success) {
                const endpoint = window.APPROVE_USER_ENDPOINT || '/.netlify/functions/approve-user';
                // Apenas tenta se não for a rota relativa padrão do Netlify (já que em páginas estáticas não funcionará)
                if (window.APPROVE_USER_ENDPOINT || !window.location.hostname.includes('github.io')) {
                    try {
                        const resp = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { Authorization: `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({ notifId, role, matricula, nome })
                        });

                        if (resp.ok) {
                            success = true;
                        } else {
                            const text = await resp.text();
                            let body = null;
                            try { body = JSON.parse(text); } catch (e) { body = text; }
                            errorMsg = body?.error || (typeof body === 'string' ? body : null) || `HTTP ${resp.status}`;
                        }
                    } catch (fetchErr) {
                        errorMsg = fetchErr.message || String(fetchErr);
                    }
                }
            }

            if (!success) {
                console.warn('[ADMIN] Falha ao chamar endpoint/função de aprovação. Tentando inserção direta via sbClient (pode falhar por políticas de RLS)...', errorMsg);
                
                // Inserção direta via frontend como fallback
                const emailToCreate = matricula ? `${matricula}@gecope.app` : `${(nome||'user').replace(/\s+/g,'').toLowerCase()}@gecope.app`;
                const payload = {
                    email: emailToCreate,
                    matricula: matricula || null,
                    nome: nome || null,
                    sobrenome: null,
                    role: role || 'externo',
                    created_at: new Date().toISOString()
                };

                // 1. Insere o usuário na tabela
                const { error: insertErr } = await sbClient.from('app_users').insert([payload]);
                if (insertErr) {
                    throw new Error(`Erro na inserção direta (RLS): ${insertErr.message}. Nota: A criação de usuários por terceiros é restrita pelas políticas de segurança do banco. Certifique-se de que a Edge Function "approve-user" está implantada no painel do Supabase. (Tentativa original falhou com: ${errorMsg})`);
                }

                // 2. Marca notificação de solicitação como lida
                if (notifId) {
                    const { error: notifErr } = await sbClient.from('app_notifications').update({ read: true }).eq('id', notifId);
                    if (notifErr) {
                        console.error('[ADMIN] Erro ao marcar notificação como lida:', notifErr);
                    }
                }
                success = true;
            }

            alert('Usuário criado e aprovado com sucesso.');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) {
            console.error('Erro ao aprovar via notificação:', e);
            alert('Erro ao aprovar: ' + (e.message || String(e)));
        }
    }

    async function recusarNotification(notifId) {
        if (!notifId) return;
        if (!confirm('Recusar esta solicitação?')) return;
        try {
            const { error } = await sbClient.from('app_notifications').update({ read: true }).eq('id', notifId);
            if (error) throw error;
            alert('Solicitação recusada.');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao recusar: ' + (e.message || String(e))); }
    }

    function filterAdminUsers() {
        const term = document.getElementById('admin-user-search').value.toLowerCase();
        const rows = document.querySelectorAll('#admin-users-table-body tr[data-search]');
        rows.forEach(row => { row.style.display = row.getAttribute('data-search').includes(term) ? '' : 'none'; });
    }

    async function updateUserRole(email, newRole, skipConfirm = false) {
        if (!skipConfirm && !confirm(`Alterar perfil de ${email} para ${newRole.toUpperCase()}?`)) { loadAllUsers(); return; }
        try {
            if (newRole === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, newRole, 'update'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: newRole }).eq('email', email);
            if (error) throw error; if (!skipConfirm) alert('Perfil atualizado!'); loadAllUsers();
        } catch (e) { alert('Erro ao atualizar cargo: ' + e.message); }
    }

    // Notifications polling (admin)
    let _notifIntervalId = null;
    function startNotificationsPoll() { if (_notifIntervalId) return; fetchNotifications(); _notifIntervalId = setInterval(fetchNotifications, 45000); }
    function stopNotificationsPoll() { if (_notifIntervalId) { clearInterval(_notifIntervalId); _notifIntervalId = null; } }

    async function fetchPendingCount() {
        try {
            const { data, error } = await sbClient.from('app_users').select('id').eq('role', 'pending');
            if (error) throw error; const count = Array.isArray(data) ? data.length : 0; const badgeEl = document.getElementById('pending-badge'); if (badgeEl) badgeEl.textContent = count > 0 ? String(count) : '';
        } catch (err) { console.error('Erro ao buscar pendentes', err); }
    }

    async function fetchNotifications() {
        try {
            const { data, error } = await sbClient.from('app_notifications').select('*').eq('read', false).order('created_at', { ascending: true });
            if (error) throw error;
            if (data && data.length) {
                data.forEach(async n => {
                    try { console.log('Nova Notificação:', n.type, n.payload); await sbClient.from('app_notifications').update({ read: true }).eq('id', n.id); } catch (e) { console.error(e); }
                });
            }
        } catch (err) { console.error('Erro ao buscar notificações', err); }
    }

    // Open pending section (used by clickable stat card)
    async function openAdminPendings() {
        try {
            if (typeof loadAllUsers === 'function') await loadAllUsers();
            const sec = document.getElementById('admin-pending-section');
            if (sec) {
                // ensure visible even when zero so admin can see message
                sec.style.display = 'block';
                try { const closeBtn = document.getElementById('admin-pending-close-btn'); if (closeBtn) { closeBtn.style.display = 'inline-block'; const icon = closeBtn.querySelector('i'); if (icon) icon.className = 'bi bi-chevron-up'; } } catch(e){}
                sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                alert('Seção de pendentes não encontrada.');
            }
        } catch (e) { console.error('Erro ao abrir pendentes:', e); alert('Erro ao abrir pendentes: ' + (e.message || e)); }
    }

    // Diagnostic helper: fetch raw user rows and notifications (shows modal with JSON)
    async function diagnosePendingFetch() {
        try {
            const outEl = document.getElementById('admin-diag-output');
            if (outEl) outEl.textContent = 'Executando diagnóstico...';

            const results = {};

            try {
                const { data, error } = await sbClient.from('app_users').select('id,email,role,matricula,created_at').order('created_at', { ascending: false }).limit(50);
                results.users = data || null;
                results.users_error = error ? (error.message || String(error)) : null;
            } catch (e) { results.users_error = String(e); }

            try {
                const { data: notes, error: noteErr } = await sbClient.from('app_notifications').select('id,type,payload,read,created_at').order('created_at', { ascending: false }).limit(50);
                results.notifications = notes || null;
                results.notifications_error = noteErr ? (noteErr.message || String(noteErr)) : null;
            } catch (e) { results.notifications_error = String(e); }

            // Add Supabase client / auth state info
            try {
                results.sbClient_exists = !!window.sbClient;
                if (window.sbClient && window.sbClient.auth) {
                    try {
                        const sessionResp = await window.sbClient.auth.getSession();
                        results.auth_session = sessionResp || null;
                    } catch (sErr) { results.auth_session_error = String(sErr); }

                    try {
                        const userResp = await window.sbClient.auth.getUser();
                        results.auth_user = userResp || null;
                    } catch (uErr) { results.auth_user_error = String(uErr); }
                }
            } catch (e) { results.sbclient_error = String(e); }

            // Add local sessionStorage hints
            try {
                results.sessionStorage = {
                    sop_user: sessionStorage.getItem('sop_user'),
                    sop_role: sessionStorage.getItem('sop_role'),
                    is_admin_gecope: sessionStorage.getItem('is_admin_gecope')
                };
            } catch (e) { results.sessionStorage_error = String(e); }

            if (outEl) outEl.textContent = JSON.stringify(results, null, 2);
            const modalEl = document.getElementById('modalAdminDiag');
            if (modalEl) {
                const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.show();
            } else {
                alert('Diagnóstico executado. Veja console para detalhes.');
            }
        } catch (err) {
            console.error('Erro no diagnóstico:', err);
            alert('Erro ao executar diagnóstico: ' + err.message);
        }
    }

    async function promoteAdmin99030487() {
        const targetEmail = '99030487@gecope.app';
        try {
            const { data, error } = await sbClient.from('app_users').select('role').eq('email', targetEmail).maybeSingle();
            if (data && data.role !== 'admin') {
                const { error: upErr } = await sbClient.from('app_users').update({ role: 'admin' }).eq('email', targetEmail);
                if (!upErr) {
                    const current = sessionStorage.getItem('sop_user');
                    if (current === targetEmail) { sessionStorage.setItem('sop_role', 'admin'); if (typeof applyRoleToUI === 'function') applyRoleToUI('admin'); alert('Sua conta foi promovida para Administrador com sucesso.'); }
                } else { console.error('[AUTO-ADMIN] Falha ao atualizar:', upErr); }
            }
        } catch (e) { console.error('[AUTO-ADMIN] Erro:', e); }
    }

    // Expose to window
    window.atualizarIconesCadeado = atualizarIconesCadeado;
    window.verificarAdminSalvo = verificarAdminSalvo;
    window.alternarModoAdmin = alternarModoAdmin;
    window.handleLoginSubmit = handleLoginSubmit;
    window.loadAllUsers = loadAllUsers;
    window.loadFiscalDirectory = loadFiscalDirectory;
    window.saveFiscalContact = saveFiscalContact;
    window.abrirModalVinculo = abrirModalVinculo;
    window.aprovarUsuario = aprovarUsuario;
    window.excluirUsuario = excluirUsuario;
    window.filterAdminUsers = filterAdminUsers;
    window.updateUserRole = updateUserRole;
    window.startNotificationsPoll = startNotificationsPoll;
    window.stopNotificationsPoll = stopNotificationsPoll;
    window.fetchPendingCount = fetchPendingCount;
    window.fetchNotifications = fetchNotifications;
    window.promoteAdmin99030487 = promoteAdmin99030487;
    window.aprovarFromNotification = aprovarFromNotification;
    window.recusarNotification = recusarNotification;
    window.diagnosePendingFetch = diagnosePendingFetch;
    window.diagnosePendingFetch = diagnosePendingFetch;
    window.openAdminPendings = openAdminPendings;

    // Init actions
    document.addEventListener('DOMContentLoaded', () => {
        // Wire formLogin submit if present (keeps old behavior)
        document.getElementById('formLogin')?.addEventListener('submit', handleLoginSubmit);
        setTimeout(promoteAdmin99030487, 500);
    });

})(window);
(function(window){
    'use strict';

    // Admin logic extracted from main.js
    const SENHA_MESTRA = "sop2026";
    const USERS = [ { username: 'admin', password: SENHA_MESTRA, isAdmin: true } ];

    function atualizarIconesCadeado(isLocked) {
        const icones = document.querySelectorAll('.btn-admin-login i');
        icones.forEach(icon => {
            if (isLocked) {
                icon.className = 'bi bi-lock-fill';
                icon.style.color = '#ccc';
            } else {
                icon.className = 'bi bi-unlock-fill';
                icon.style.color = 'var(--sop-green)';
            }
        });
    }

    function verificarAdminSalvo() {
        const isAdm = sessionStorage.getItem('is_admin_gecope');
        if (isAdm === 'true') {
            document.body.classList.add('is-admin');
            atualizarIconesCadeado(false);
        } else {
            document.body.classList.remove('is-admin');
            atualizarIconesCadeado(true);
        }
    }

    function alternarModoAdmin() {
        if (document.body.classList.contains('is-admin')) {
            if (confirm("Deseja sair do modo Administrador?")) {
                document.body.classList.remove('is-admin');
                sessionStorage.removeItem('is_admin_gecope');
                sessionStorage.setItem('sop_role', 'guest');
                if (typeof applyRoleToUI === 'function') applyRoleToUI('guest');
                atualizarIconesCadeado(true);
                alert("Modo de visualização ativado.");
                if (document.querySelector('.modal.show')) location.reload();
            }
            return;
        }
        const modalEl = document.getElementById('modalLogin');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        } else {
            const tentativa = prompt(" Digite a senha de administrador:");
            if (tentativa === SENHA_MESTRA) {
                document.body.classList.add('is-admin');
                sessionStorage.setItem('is_admin_gecope', 'true');
                atualizarIconesCadeado(false);
                alert(" Modo Administrador Ativado!");
            } else if (tentativa !== null) { alert(" Senha incorreta."); }
        }
    }

    function handleLoginSubmit(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value.trim();
        const pass = document.getElementById('login-password').value;
        const feedback = document.getElementById('login-feedback');
        feedback.style.display = 'none';
        const found = USERS.find(u => u.username === user && u.password === pass);
        if (found) {
            document.body.classList.add('is-admin');
            sessionStorage.setItem('is_admin_gecope', 'true');
            sessionStorage.setItem('sop_user', user);
            sessionStorage.setItem('sop_role', 'admin');
            if (typeof applyRoleToUI === 'function') applyRoleToUI('admin');
            atualizarIconesCadeado(false);
            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalLogin'));
            if (modal) modal.hide();
            alert(" Modo Administrador Ativado!");
        } else {
            feedback.style.display = 'block';
        }
    }

    // Expose simple admin actions
    async function loadAllUsers() {
        const tbodyActive = document.getElementById('admin-users-table-body');
        const tbodyPending = document.getElementById('admin-pending-table-body');
        const sectionPending = document.getElementById('admin-pending-section');

        const statTotal = document.getElementById('admin-stat-total');
        const statPending = document.getElementById('admin-stat-pending');
        const statAdmins = document.getElementById('admin-stat-admins');
        const statOthers = document.getElementById('admin-stat-others');
        const pendingTabBadge = document.getElementById('admin-pending-badge-tab');

        if (!tbodyActive || !tbodyPending) return;
        tbodyActive.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Carregando usuários...</td></tr>';

        try {
            const { data, error } = await sbClient.from('app_users').select('*').order('created_at', { ascending: false });
            if (error) throw error;

            const pendings = data.filter(u => u.role === 'pending').sort((a, b) => {
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });
            const actives = data.filter(u => u.role !== 'pending');

            const roleOrder = { 'admin': 1, 'fiscal': 2, 'gerente': 3, 'externo': 4 };
            actives.sort((a, b) => {
                const orderA = roleOrder[a.role] || 99;
                const orderB = roleOrder[b.role] || 99;
                if (orderA !== orderB) return orderA - orderB;
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });

            const totalPending = pendings.length + notifPendings.length;
            if (statTotal) statTotal.textContent = data.length;
            if (statPending) statPending.textContent = totalPending;
            if (statAdmins) statAdmins.textContent = data.filter(u => u.role === 'admin').length;
            if (statOthers) statOthers.textContent = data.filter(u => u.role !== 'admin' && u.role !== 'pending').length;
            if (pendingTabBadge) pendingTabBadge.textContent = totalPending;
            if (sectionPending) sectionPending.style.display = totalPending > 0 ? 'block' : 'none';

            tbodyPending.innerHTML = '';
            pendings.forEach(u => {
                const dataSolic = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : 'N/A';
                const nomeComp = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'N/A').toUpperCase();
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${nomeComp}</div>
                        <div class="small text-muted">${u.email}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border fw-normal">${u.matricula || '-'}</span></td>
                    <td><span class="text-muted small">${dataSolic}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm" style="width: 120px;" id="role-pending-${u.id}">
                                <option value="externo">EXTERNO</option>
                                <option value="fiscal">FISCAL</option>
                                <option value="gerente">GERENTE</option>
                                <option value="admin">ADMIN</option>
                            </select>
                            <button class="btn btn-sm btn-success" onclick="aprovarUsuario('${u.email}', document.getElementById('role-pending-${u.id}').value)">
                                <i class="bi bi-check-lg me-1"></i> Aprovar
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="excluirUsuario('${u.email}')" title="Recusar">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyPending.appendChild(tr);
            });

            tbodyActive.innerHTML = '';
            if (actives.length === 0) {
                tbodyActive.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Nenhum usuário ativo.</td></tr>';
            }

            actives.forEach(u => {
                const fullNome = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'Não informado').toUpperCase();
                let roleColor = 'bg-secondary';
                if (u.role === 'admin') roleColor = 'bg-danger';
                else if (u.role === 'gerente') roleColor = 'bg-primary';
                else if (u.role === 'fiscal') roleColor = 'bg-success';
                else if (u.role === 'externo') roleColor = 'bg-dark';

                const roles = ['admin', 'gerente', 'fiscal', 'externo'];
                const optionsHtml = roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('');

                let fiscalInfo = '';
                if (u.role === 'fiscal' && u.nome) {
                    const nomeCompleto = (u.nome + (u.sobrenome ? ' ' + u.sobrenome : '')).trim();
                    const encontradoNaLista = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                    if (encontradoNaLista) {
                        fiscalInfo = `<span class="badge bg-info text-dark ms-2" title="Fiscal encontrado na lista">${encontradoNaLista}</span>`;
                    } else {
                        fiscalInfo = `<span class="badge bg-warning text-dark ms-2" title="Não encontrado na lista">️</span>`;
                    }
                }

                const tr = document.createElement('tr');
                tr.setAttribute('data-search', `${fullNome.toLowerCase()} ${u.matricula} ${u.email.toLowerCase()}`);
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${fullNome}</div>
                    </td>
                    <td><div class="small text-muted">${u.email}</div></td>
                    <td><div class="small fw-bold text-secondary">${u.telefone_whatsapp || '-'}</div></td>
                    <td><span class="badge bg-light text-dark border fw-normal">${u.matricula || '-'}</span></td>
                    <td>
                        <span class="badge ${roleColor} rounded-pill px-3" style="font-size: 0.72rem; min-width: 80px;">${u.role.toUpperCase()}</span>
                        ${fiscalInfo}
                    </td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm border-0 bg-light" style="width:130px;" onchange="updateUserRole('${u.email}', this.value)">
                                ${optionsHtml}
                            </select>
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="excluirUsuario('${u.email}')" title="Excluir Usuário">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyActive.appendChild(tr);
            });

        } catch (e) {
            console.error('Erro ao listar usuários:', e);
            tbodyActive.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Erro ao carregar banco de usuários: ${e.message}</td></tr>`;
        }
    }

    async function loadFiscalDirectory() {
        const tbody = document.getElementById('fiscal-directory-table-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted small"><div class="spinner-border spinner-border-sm me-2"></div>Carregando fiscais...</td></tr>';
        try {
            const { data: users, error } = await sbClient.from('app_users').select('nome, sobrenome, full_name, telefone_whatsapp, email');
            if (error) throw error;
            const realFiscals = new Set();
            users.forEach(u => {
                if (!u.email.includes('@sop-ghost.internal')) {
                    const name = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || '').toUpperCase();
                    if (name) realFiscals.add(name);
                }
            });
            const directoryData = FISCAIS_LIST.filter(name => !realFiscals.has(name.toUpperCase())).map(name => {
                const ghost = users.find(u => {
                    const uName = (u.full_name || '').toUpperCase();
                    return u.email.includes('@sop-ghost.internal') && uName === name.toUpperCase();
                });
                return { name: name, phone: ghost ? (ghost.telefone_whatsapp || '') : '', isGhost: !!ghost };
            });

            tbody.innerHTML = '';
            if (directoryData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted small">Todos os fiscais da lista já possuem cadastro oficial.</td></tr>';
                return;
            }

            directoryData.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="ps-4 fw-bold text-dark">${item.name.toUpperCase()}</td>
                    <td>
                        <input type="text" class="form-control form-control-sm" style="max-width: 200px;" 
                            id="dir-phone-${item.name.replace(/\s+/g, '_')}" value="${item.phone}" placeholder="Ex: 85988887777">
                    </td>
                    <td class="text-end pe-4">
                        <button class="btn btn-sm btn-outline-success" onclick="saveFiscalContact('${item.name}', 'dir-phone-${item.name.replace(/\s+/g, '_')}')">
                            <i class="bi bi-save me-1"></i> Salvar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (e) {
            console.error('Erro ao carregar diretório:', e);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4 small">Erro: ' + e.message + '</td></tr>';
        }
    }

    async function saveFiscalContact(name, inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const phone = input.value.trim();
        const btn = event && event.target ? event.target.closest('button') : null;
        const originalHtml = btn ? btn.innerHTML : '';
        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
            await WhatsAppConfigManager.savePhoneForUser(name, 'ghost', phone);
            showToast(`Contato de ${name} atualizado com sucesso!`);
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar contato.");
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
        }
    }

    // Vinculo fiscal
    let _vincularContext = null;

    function abrirModalVinculo(nomeAtual, email, role, action) {
        _vincularContext = { email, role, action };
        document.getElementById('vincular-usuario-nome').textContent = nomeAtual || email;
        const sel = document.getElementById('vincular-fiscal-select');
        sel.innerHTML = '<option value="">Selecione...</option>';
        FISCAIS_LIST.forEach(f => {
            const opt = document.createElement('option'); opt.value = f; opt.textContent = f; sel.appendChild(opt);
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalVincularFiscal')).show();
    }

    async function aprovarUsuario(email, role = 'externo', skipConfirm = false) {
        if (!skipConfirm && !confirm(`Confirmar aprovação de ${email} como ${role.toUpperCase()}?`)) return;
        try {
            if (role === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, role, 'aprovar'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: role }).eq('email', email);
            if (error) throw error;
            if (!skipConfirm) alert('Usuário aprovado com sucesso!');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao aprovar: ' + e.message); }
    }

    async function excluirUsuario(email) {
        if (!confirm(`Remover definitivamente o usuário ${email}?`)) return;
        try {
            const { error } = await sbClient.from('app_users').delete().eq('email', email);
            if (error) throw error;
            alert('Usuário removido.');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao excluir: ' + e.message); }
    }

    function filterAdminUsers() {
        const term = document.getElementById('admin-user-search').value.toLowerCase();
        const rows = document.querySelectorAll('#admin-users-table-body tr[data-search]');
        rows.forEach(row => { row.style.display = row.getAttribute('data-search').includes(term) ? '' : 'none'; });
    }

    async function updateUserRole(email, newRole, skipConfirm = false) {
        if (!skipConfirm && !confirm(`Alterar perfil de ${email} para ${newRole.toUpperCase()}?`)) { if (typeof loadAllUsers === 'function') loadAllUsers(); return; }
        try {
            if (newRole === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, newRole, 'update'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: newRole }).eq('email', email);
            if (error) throw error;
            if (!skipConfirm) alert('Perfil atualizado!');
            if (typeof loadAllUsers === 'function') loadAllUsers();
        } catch (e) { alert('Erro ao atualizar cargo: ' + e.message); }
    }

    let _notifIntervalId = null;
    function startNotificationsPoll() {
        if (_notifIntervalId) return; fetchNotifications(); _notifIntervalId = setInterval(fetchNotifications, 45000);
    }
    function stopNotificationsPoll() { if (_notifIntervalId) { clearInterval(_notifIntervalId); _notifIntervalId = null; } }

    async function fetchPendingCount() {
        try {
            const { data, error } = await sbClient.from('app_users').select('id').eq('role', 'pending');
            if (error) throw error;
            const count = Array.isArray(data) ? data.length : 0;
            const badgeEl = document.getElementById('pending-badge');
            if (badgeEl) badgeEl.textContent = count > 0 ? String(count) : '';
        } catch (err) { console.error('Erro ao buscar pendentes', err); }
    }

    async function fetchNotifications() {
        try {
            const { data, error } = await sbClient.from('app_notifications').select('*').eq('read', false).order('created_at', { ascending: true });
            if (error) throw error;
            if (data && data.length) {
                for (const n of data) {
                    try {
                        console.log('Nova Notificação:', n.type, n.payload);
                        await sbClient.from('app_notifications').update({ read: true }).eq('id', n.id);
                    } catch (e) { console.error(e); }
                }
            }
        } catch (err) { console.error('Erro ao buscar notificações', err); }
    }

    async function promoteAdmin99030487() {
        const targetEmail = '99030487@gecope.app';
        try {
            const { data, error } = await sbClient.from('app_users').select('role').eq('email', targetEmail).maybeSingle();
            if (data && data.role !== 'admin') {
                console.log('[AUTO-ADMIN] Promovendo 99030487 para ADMIN...');
                const { error: upErr } = await sbClient.from('app_users').update({ role: 'admin' }).eq('email', targetEmail);
                if (!upErr) {
                    console.log('[AUTO-ADMIN] Sucesso!');
                    const current = sessionStorage.getItem('sop_user');
                    if (current === targetEmail) {
                        sessionStorage.setItem('sop_role', 'admin');
                        if (typeof applyRoleToUI === 'function') applyRoleToUI('admin');
                        alert('Sua conta foi promovida para Administrador com sucesso.');
                    }
                } else {
                    console.error('[AUTO-ADMIN] Falha ao atualizar:', upErr);
                }
            }
        } catch (e) { console.error('[AUTO-ADMIN] Erro:', e); }
    }

    // Wire DOM listeners related to admin that were in main.js
    document.getElementById('formLogin')?.addEventListener('submit', handleLoginSubmit);

    document.addEventListener('DOMContentLoaded', () => {
        const btnConfirmar = document.getElementById('btn-confirmar-vinculo');
        if (btnConfirmar) {
            btnConfirmar.addEventListener('click', async () => {
                if (!_vincularContext) return;
                const select = document.getElementById('vincular-fiscal-select');
                const novoNome = select.value;
                if (!novoNome) { alert("Por favor, selecione um nome da lista."); return; }
                try {
                    btnConfirmar.disabled = true; btnConfirmar.innerHTML = "Salvando...";
                    const partes = novoNome.split(' ');
                    const nome = partes[0];
                    const sobrenome = partes.slice(1).join(' ');
                    const { error } = await sbClient.from('app_users').update({ full_name: novoNome, nome: nome, sobrenome: sobrenome }).eq('email', _vincularContext.email);
                    if (error) throw error;
                    alert(` Usuário vinculado a "${novoNome}" com sucesso!`);
                    const modalEL = document.getElementById('modalVincularFiscal');
                    const modal = bootstrap.Modal.getInstance(modalEL);
                    modal.hide();
                    if (_vincularContext.action === 'aprovar') {
                        aprovarUsuario(_vincularContext.email, _vincularContext.role, true);
                    } else if (_vincularContext.action === 'update') {
                        updateUserRole(_vincularContext.email, _vincularContext.role, true);
                    }
                } catch (e) { alert("Erro ao vincular: " + e.message); }
                finally { btnConfirmar.disabled = false; btnConfirmar.innerHTML = "Confirmar Vínculo"; }
            });
        }

        setTimeout(promoteAdmin99030487, 500);
    });

    // Expose to window
    window.atualizarIconesCadeado = atualizarIconesCadeado;
    window.verificarAdminSalvo = verificarAdminSalvo;
    window.alternarModoAdmin = alternarModoAdmin;
    window.loadAllUsers = loadAllUsers;
    window.loadFiscalDirectory = loadFiscalDirectory;
    window.saveFiscalContact = saveFiscalContact;
    window.abrirModalVinculo = abrirModalVinculo;
    window.aprovarUsuario = aprovarUsuario;
    window.excluirUsuario = excluirUsuario;
    window.filterAdminUsers = filterAdminUsers;
    window.updateUserRole = updateUserRole;
    window.startNotificationsPoll = startNotificationsPoll;
    window.stopNotificationsPoll = stopNotificationsPoll;
    window.fetchPendingCount = fetchPendingCount;
    window.fetchNotifications = fetchNotifications;
    window.promoteAdmin99030487 = promoteAdmin99030487;

})(window);
