                                                                        // Todas as chamadas de WhatsApp passam por aqui — vão para o proxy próprio
                                                                        // (server/whatsapp-proxy), nunca mais direto para a Evolution API. Sem
                                                                        // timeout, uma API travada deixava o spinner/texto "Consultando..."
                                                                        // pendurado indefinidamente. Também injeta automaticamente o JWT da sessão
                                                                        // atual como Bearer token — é assim que o proxy sabe quem está chamando,
                                                                        // sem nenhuma credencial de WhatsApp precisar existir no cliente.
                                                                        async function fetchComTimeout(url, options = {}, timeoutMs = 15000) {
                                                                            if (!window.WHATSAPP_PROXY_URL) {
                                                                                throw new Error('Disparo de WhatsApp está pausado no momento (proxy não configurado). Contate o administrador para mais informações.');
                                                                            }
                                                                            const { data: sessionData } = await sbClient.auth.getSession();
                                                                            const token = sessionData?.session?.access_token;
                                                                            if (!token) {
                                                                                throw new Error('Sessão expirada. Faça login novamente para enviar mensagens.');
                                                                            }
                                                                            const controller = new AbortController();
                                                                            const timer = setTimeout(() => controller.abort(), timeoutMs);
                                                                            try {
                                                                                return await fetch(url, {
                                                                                    ...options,
                                                                                    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
                                                                                    signal: controller.signal
                                                                                });
                                                                            } finally {
                                                                                clearTimeout(timer);
                                                                            }
                                                                        }

                                                                        // Contatos fantasma (sop-ghost.internal) guardam o nome original no próprio
                                                                        // e-mail interno (contato_fulano_de_tal@..., criado em savePhoneForUser) —
                                                                        // serve de fallback para quando full_name está vazio no banco (caso real de
                                                                        // todos os contatos fantasma hoje, ver processarNotificacao e prepareDirectMsg).
                                                                        function nomeDeContatoFantasma(email) {
                                                                            return (email || '')
                                                                                .replace(/@sop-ghost\.internal$/i, '')
                                                                                .replace(/^contato_/i, '')
                                                                                .replace(/_/g, ' ')
                                                                                .trim();
                                                                        }

                                                                        async function verificarNotificacoesAtraso() {
                                                                            try {
                                                                                // JITTER ANTI-CORRIDA: Espera otimizada para evitar corrida simultânea
                                                                                await new Promise(r => setTimeout(r, Math.random() * 2000)); // Reduced from 8000ms

                                                                                // Segurança: Verifica se a notificação de atraso está ativa no banco ANTES de qualquer processamento
                                                                                const { data: config, error: configError } = await sbClient
                                                                                    .from('config_whatsapp')
                                                                                    .select('is_ativo')
                                                                                    .eq('evento_gatilho', 'novas_metas_processo')
                                                                                    .single();

                                                                                if (configError || !config || !config.is_ativo) {
                                                                                    console.log("[WhatsApp] Notificações de Meta/Atraso estão desativadas globalmente.");
                                                                                    return;
                                                                                }

                                                                                // Busca os últimos disparos de metas no banco para verificar qual foi o último aviso por processo/fiscal
                                                                                const { data: logs, error: logsError } = await sbClient
                                                                                    .from('whatsapp_logs')
                                                                                    .select('mensagem, destinatario_nome, created_at')
                                                                                    .eq('evento', 'novas_metas_processo')
                                                                                    .order('created_at', { ascending: false })
                                                                                    .limit(10000);

                                                                                const ultimoAlertaPorChave = new Map();
                                                                                const cleanStr = str => (str || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();

                                                                                if (!logsError && logs) {
                                                                                    logs.forEach(log => {
                                                                                        const nupLog = (log.mensagem ? log.mensagem.match(/NUP:\* ([\d\/\-]+)/)?.[1] : null);
                                                                                        const objetoLog = (log.mensagem ? log.mensagem.match(/OBJETO:\* ([^\n]+)/)?.[1] : null);
                                                                                        if (!nupLog) return;
                                                                                        // Chave composta: NUP + FISCAL + OBJETO (limpos)
                                                                                        const chave = `${cleanStr(nupLog)}|${cleanStr(log.destinatario_nome)}|${cleanStr(objetoLog)}`;
                                                                                        if (!ultimoAlertaPorChave.has(chave)) {
                                                                                            ultimoAlertaPorChave.set(chave, new Date(log.created_at).getTime());
                                                                                        }
                                                                                    });
                                                                                }

                                                                                // Filtra processos "Atrasados" que possuem fiscal e ainda NO tiveram aviso enviado (Flag de Banco)
                                                                                const atrasados = (window.allData || []).filter(d => {
                                                                                    const st = (d.status || '').toUpperCase();
                                                                                    if (['CONCLUÍDO', 'EXCLUÍDO', 'APROVADO'].includes(st)) return false;

                                                                                    const mSt = getMetaSt(d);
                                                                                    const foiEnviado = d.avisoAtrasoEnviado === true;

                                                                                    // REGRA: Somente se estiver Atrasado e a flag for estritamente false
                                                                                    return mSt === 'Atrasado' && !foiEnviado;
                                                                                });

                                                                                if (atrasados.length === 0) return;

                                                                                console.log(`[WhatsApp] Detectados ${atrasados.length} processos atrasados para notificação única.`);

                                                                                for (const d of atrasados) {
                                                                                    // 1. Tenta marcar no Banco de Dados PRIMEIRO (Lock lógico)
                                                                                    // Isso evita que múltiplos usuários disparando ao mesmo tempo gerem duplicatas
                                                                                    const { data: updatedData, error: updateError } = await sbClient
                                                                                        .from('processos')
                                                                                        .update({ aviso_atraso_enviado: true })
                                                                                        .eq('id', d.id)
                                                                                        .eq('aviso_atraso_enviado', false) // Garantia extra de atomicidade
                                                                                        .select();

                                                                                    // 2. SOMENTE SE o update funcionou e afetou uma linha, fazemos o disparo
                                                                                    if (!updateError && updatedData && updatedData.length > 0) {
                                                                                        console.log(`[WhatsApp] Flag atualizada para o processo ${d.processo}. Disparando aviso...`);

                                                                                        await processarNotificacao('novas_metas_processo', {
                                                                                            NOME_FISCAL: d.fiscal || 'Fiscal',
                                                                                            NUP_PROCESSO: d.processo,
                                                                                            NOME_OBRA: d.descricao || d.processo
                                                                                        });

                                                                                        // Atualiza localmente para não tentar disparar de novo nesta mesma sessão de carga
                                                                                        d.avisoAtrasoEnviado = true;
                                                                                    } else {
                                                                                        console.log(`[WhatsApp] Ignorando processo ${d.processo}: aviso já enviado ou falha no update.`);
                                                                                    }

                                                                                    // Espera otimizada entre disparos
                                                                                    await new Promise(r => setTimeout(r, 500)); // Reduced from 2000ms
                                                                                }
                                                                            } catch (err) {
                                                                                console.error("[WhatsApp] Erro ao verificar atrasos:", err);
                                                                            }
                                                                        }

                                                                        // ============================================
                                                                        // MOTOR DE NOTIFICAÇÕES WHATSAPP (REFATORADO)
                                                                        // ============================================
                                                                        const WhatsAppConfigManager = {
                                                                            async loadAll() {
                                                                                try {
                                                                                    const { data: configs, error } = await sbClient.from('config_whatsapp').select('*');
                                                                                    if (error) throw error;
                                                                                    if (!configs) return;

                                                                                    configs.forEach(conf => {
                                                                                        const form = document.querySelector(`form[data-gatilho="${conf.evento_gatilho}"]`);
                                                                                        if (form) {
                                                                                            if (form.querySelector('.config-ativo')) form.querySelector('.config-ativo').checked = conf.is_ativo;
                                                                                            if (form.querySelector('.config-texto')) form.querySelector('.config-texto').value = conf.texto_mensagem;

                                                                                            const dests = conf.destinatarios || [];
                                                                                            if (form.querySelector('.config-dest-geral')) form.querySelector('.config-dest-geral').checked = dests.includes('geral');
                                                                                            if (form.querySelector('.config-dest-indiv')) form.querySelector('.config-dest-indiv').checked = dests.includes('individual');
                                                                                        }
                                                                                    });
                                                                                    console.log("[WhatsApp] Configurações carregadas com sucesso.");
                                                                                } catch (err) { console.error("[WhatsApp] Erro ao carregar:", err); }
                                                                            },

                                                                            async save(eventoGatilho, formElement) {
                                                                                if (!formElement) return;
                                                                                const btn = formElement.querySelector('button');
                                                                                const textoOriginal = btn.innerHTML;

                                                                                try {
                                                                                    btn.disabled = true;
                                                                                    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

                                                                                    const isAtivo = formElement.querySelector('.config-ativo').checked;
                                                                                    const textoNode = formElement.querySelector('.config-texto');
                                                                                    const textoMensagem = textoNode ? textoNode.value : '';

                                                                                    // Detecta placeholder com sintaxe errada (ex.: [NOME_FISCAL] em vez de
                                                                                    // {{NOME_FISCAL}}) ANTES de salvar — sem isso o admin só descobre o erro
                                                                                    // quando um usuário real recebe o texto cru do placeholder no WhatsApp
                                                                                    // (foi exatamente o que aconteceu com novo_processo/mudanca_status_processo/
                                                                                    // analista_designado antes desta checagem existir).
                                                                                    const placeholdersColchete = textoMensagem.match(/\[[A-Z_]{3,}\]/g);
                                                                                    if (placeholdersColchete && placeholdersColchete.length > 0) {
                                                                                        const confirmar = confirm(
                                                                                            `Atenção: o texto usa colchetes (${placeholdersColchete.join(', ')}) em vez de chaves duplas.\n\n` +
                                                                                            `O formato correto é {{CAMPO}} — ex.: {{NOME_FISCAL}}.\n\n` +
                                                                                            `Se salvar assim, esse trecho pode ser enviado literalmente ao usuário, sem o dado real.\n\n` +
                                                                                            `Salvar mesmo assim?`
                                                                                        );
                                                                                        if (!confirmar) { btn.disabled = false; btn.innerHTML = textoOriginal; return; }
                                                                                    }

                                                                                    let destinatarios = [];

                                                                                    if (formElement.querySelector('.config-dest-geral')?.checked) destinatarios.push('geral');
                                                                                    if (formElement.querySelector('.config-dest-indiv')?.checked) destinatarios.push('individual');

                                                                                    const { error } = await sbClient.from('config_whatsapp').upsert({
                                                                                        evento_gatilho: eventoGatilho,
                                                                                        is_ativo: isAtivo,
                                                                                        texto_mensagem: textoMensagem,
                                                                                        destinatarios: destinatarios
                                                                                    }, { onConflict: 'evento_gatilho' });

                                                                                    if (error) throw error;
                                                                                    showToast("Configuração salva com sucesso!");
                                                                                } catch (err) {
                                                                                    console.error("Erro ao salvar WS:", err);
                                                                                    alert("Erro ao salvar a configuração.");
                                                                                } finally {
                                                                                    btn.disabled = false;
                                                                                    btn.innerHTML = textoOriginal;
                                                                                }
                                                                            },

                                                                            async prepareDirectMsg() {
                                                                                const select = document.getElementById('direct-msg-recipients');
                                                                                if (!select) return;

                                                                                try {
                                                                                    // 1. Busca usuários registrados
                                                                                    const { data: users } = await sbClient.from('app_users').select('nome, sobrenome, full_name, role, telefone_whatsapp, email');

                                                                                    // 2. Deduplica usuários pelo nome, preferindo os "reais" (que não são ghost)
                                                                                    const uniqueUsersMap = new Map();
                                                                                    if (users) {
                                                                                        users.forEach(u => {
                                                                                            const isGhost = u.email && u.email.includes('@sop-ghost.internal');
                                                                                            // BUG CORRIGIDO (2026-08-21): contatos fantasma com full_name vazio no
                                                                                            // banco (todos, hoje) caíam aqui com name="" e eram descartados por este
                                                                                            // `if (!name) return` — sumiam da lista de destinatários do disparo
                                                                                            // manual sem nenhum aviso. Usa o nome recuperado do e-mail interno como
                                                                                            // último recurso antes de desistir.
                                                                                            const name = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || (isGhost ? nomeDeContatoFantasma(u.email) : '')).toUpperCase();
                                                                                            if (!name) return;

                                                                                            if (!uniqueUsersMap.has(name) || (uniqueUsersMap.get(name).isGhost && !isGhost)) {
                                                                                                uniqueUsersMap.set(name, { ...u, name, isGhost });
                                                                                            }
                                                                                        });
                                                                                    }

                                                                                    const filteredUsers = Array.from(uniqueUsersMap.values());

                                                                                    // 3. Monta lista de opções
                                                                                    let html = '<option value="">Selecione...</option>';

                                                                                    // Adiciona Ativos e Cadastrados
                                                                                    filteredUsers.sort((a, b) => a.name.localeCompare(b.name)).forEach(u => {
                                                                                        const hasPhone = !!u.telefone_whatsapp && u.telefone_whatsapp !== '-';
                                                                                        html += `<option value="${escapeHTML(u.telefone_whatsapp || 'missing_' + u.name)}" data-name="${escapeHTML(u.name)}" data-email="${escapeHTML(u.email)}" ${!hasPhone ? 'style="color: #dc3545;"' : ''}>
                                ${escapeHTML(u.name)} (${u.role.toUpperCase()}) ${u.isGhost ? '[CONTATO SALVO]' : ''} ${!hasPhone ? ' [SEM WHATSAPP]' : ''}
                            </option>`;
                                                                                    });

                                                                                    select.innerHTML = html;

                                                                                    // Re-renderiza o componente UI para o select
                                                                                    if (typeof renderMultiSelectUI === 'function') {
                                                                                        renderMultiSelectUI(select);
                                                                                    }
                                                                                } catch (err) { console.error("Erro ao preparar disparo:", err); }
                                                                            },

                                                                            async sendDirectMsg() {
                                                                                const select = document.getElementById('direct-msg-recipients');
                                                                                const textNode = document.getElementById('direct-msg-text');
                                                                                const btn = document.getElementById('btn-send-direct-msg');

                                                                                const selectedOptions = Array.from(select.options).filter(o => o.selected && o.value);
                                                                                const originalMsgText = textNode.value.trim();

                                                                                if (selectedOptions.length === 0) { alert("Selecione pelo menos um destinatário."); return; }
                                                                                if (!originalMsgText) { alert("Digite uma mensagem para enviar."); return; }

                                                                                // --- IMPLEMENTAO DO RODAP AUTOMÁTICO ---
                                                                                const userName = sessionStorage.getItem('sop_user_name') || 'Usuário SOP';
                                                                                const now = new Date().toLocaleTimeString('pt-BR');
                                                                                const msgWithFooter = `${originalMsgText}\n\n_Notificação GECOPE | Resp: ${userName} | Hora: ${now}_`;


                                                                                btn.disabled = true;
                                                                                const originalContent = btn.innerHTML;
                                                                                btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

                                                                                let successCount = 0;
                                                                                let failCount = 0;

                                                                                for (const opt of selectedOptions) {
                                                                                    let phone = opt.value;
                                                                                    const name = opt.getAttribute('data-name');
                                                                                    const email = opt.getAttribute('data-email');

                                                                                    // Se não tem telefone, pergunta agora
                                                                                    if (phone.startsWith('missing_') || !phone || phone === '-') {
                                                                                        const { value: newPhone } = await Swal.fire({
                                                                                            title: `Telefone Faltando`,
                                                                                            text: `O fiscal ${name} não possui WhatsApp cadastrado. Informe o número para este disparo (ou cancele para pular):`,
                                                                                            input: 'text',
                                                                                            inputPlaceholder: 'Ex: 85988887777',
                                                                                            showCancelButton: true,
                                                                                            confirmButtonText: 'Usar este número',
                                                                                            cancelButtonText: 'Pular este fiscal'
                                                                                        });

                                                                                        if (newPhone) {
                                                                                            phone = newPhone;
                                                                                            // Salva no banco para não pedir de novo
                                                                                            await this.savePhoneForUser(name, email, newPhone);
                                                                                        } else {
                                                                                            failCount++;
                                                                                            continue;
                                                                                        }
                                                                                    }

                                                                                    try {
                                                                                        const ok = await enviarMensagemIndividual(phone, msgWithFooter, name);
                                                                                        if (ok) successCount++; else failCount++;
                                                                                        // Delay otimizado para evitar bloqueio
                                                                                        await new Promise(r => setTimeout(r, 400)); // Reduced from 1200ms
                                                                                    } catch (e) { failCount++; }
                                                                                }

                                                                                Swal.fire('Broadcast Enfileirado', `${successCount} mensagens enfileiradas para envio — acompanhe o resultado no painel de logs.${failCount > 0 ? ` ${failCount} falhas ao enfileirar ou pulados.` : ''}`, 'success');

                                                                                btn.disabled = false;
                                                                                btn.innerHTML = originalContent;
                                                                                textNode.value = '';
                                                                                this.prepareDirectMsg(); // Atualiza a lista caso telefones tenham sido salvos
                                                                            },

                                                                            async savePhoneForUser(name, email, phone) {
                                                                                try {
                                                                                    const cleanPhone = phone.replace(/\D/g, '');
                                                                                    if (email && email !== 'ghost') {
                                                                                        // Atualiza usuário existente
                                                                                        await sbClient.from('app_users').update({ telefone_whatsapp: cleanPhone }).eq('email', email);
                                                                                    } else {
                                                                                        // Cria um "contato fantasma" para futuras comunicações.
                                                                                        // BUG CORRIGIDO (2026-08-21): só se mandava `full_name` aqui, mas
                                                                                        // app_users tem um trigger (trg_force_uppercase_names) que SOBRESCREVE
                                                                                        // full_name em todo INSERT/UPDATE com upper(nome + ' ' + sobrenome) — como
                                                                                        // nome/sobrenome nunca eram enviados, todo contato fantasma nascia com
                                                                                        // full_name vazio, sempre, silenciosamente. Isso quebrava o casamento por
                                                                                        // nome em processarNotificacao (whatsapp.js) — foi assim que uma
                                                                                        // notificação do fiscal FRANCISCO GOIANA saiu no WhatsApp de outro contato
                                                                                        // fantasma qualquer. Agora nome/sobrenome vão junto, o trigger calcula
                                                                                        // full_name certo, e o contato passa a ser encontrado de verdade.
                                                                                        const partesNome = name.trim().split(/\s+/);
                                                                                        const dummyEmail = `contato_${name.toLowerCase().replace(/\s+/g, '_')}@sop-ghost.internal`;
                                                                                        await sbClient.from('app_users').upsert({
                                                                                            email: dummyEmail,
                                                                                            nome: partesNome[0],
                                                                                            sobrenome: partesNome.slice(1).join(' ') || null,
                                                                                            full_name: name,
                                                                                            telefone_whatsapp: cleanPhone,
                                                                                            role: 'fiscal',
                                                                                            created_at: new Date().toISOString()
                                                                                        }, { onConflict: 'email' });
                                                                                    }
                                                                                } catch (e) { console.error("Erro ao salvar telefone:", e); }
                                                                            }
                                                                        };

                                                                        // ============================================
                                                                        // MOTOR DE REDACAO DINAMICA (PADRAO CARD GECOPE)
                                                                        // ============================================
                                                                        // Cada evento usa um emoji próprio no título, sem repetir os emojis já usados
                                                                        // no corpo da mensagem (📑🏗️📍📊🎯🚨👤📁📝📈🔖🗓️) — ver gerarMensagemAmigavel abaixo.
                                                                        const NOTIFICATION_MAP = {
                                                                            'novo_processo': { titulo: '🆕 *Novo Processo*', sub: '🗂️ Cadastro Inicial' },
                                                                            'mudanca_status_processo': { titulo: '🔄 *Mudança de Status*', sub: '📌 Reanálise Solicitada' },
                                                                            'novas_metas_processo': { titulo: '⏰ *Alerta de Atraso*', sub: '⌛ Prazo Excedido' },
                                                                            'atualizacao_composicao': { titulo: '🧩 *Nova Composição*', sub: '📚 Cadastro de Referência' },
                                                                            'atualizacao_orcamento': { titulo: '💰 *Atualização de Orçamento*', sub: '✏️ Revisão de Dados' },
                                                                            'novo_comentario_orcamento': { titulo: '💬 *Novo Comentário*', sub: '🔍 Revisão Técnica' },
                                                                            'novo_comentario_composicao': { titulo: '🗨️ *Novo Comentário*', sub: '🔍 Revisão de Composição' },
                                                                            'atualizacao_tabelas': { titulo: '📘 *Atualização de Tabelas*', sub: '📗 Tabelas de Referência' },
                                                                            'analista_designado': { titulo: '🧮 *Analista Designado*', sub: '📋 Replanilhamento' }
                                                                        };

                                                                        window.testarPreviaMensagem = function (eventoGatilho) {
                                                                            const dadosFalsos = {
                                                                                NOME_FISCAL: 'João Fiscal',
                                                                                NUP_PROCESSO: '12345.6789/2026-00',
                                                                                NOME_OBRA: 'Construção da Escola Nova',
                                                                                NOVO_STATUS: 'Em Análise',
                                                                                ANALISTA: 'Walace',
                                                                                REF_ORCAMENTO: 'ORC-2026/001',
                                                                                NOME_USUARIO: 'Nildeno',
                                                                                AUTOR: 'Nildeno',
                                                                                CODIGO_COMPOSICAO: 'COMP-001',
                                                                                DESCRICAO: 'Composição de Referência',
                                                                                TABELA_NOME: 'SEINFRA 28',
                                                                                VERSAO: '028',
                                                                                MES_REFERENCIA: 'Jan/2026'
                                                                            };

                                                                            // Reflete o texto que está no campo AGORA (mesmo que ainda não salvo) — mais
                                                                            // útil para o admin conferir o que está prestes a salvar, mesmo padrão de
                                                                            // seletor usado em WhatsAppConfigManager.loadAll.
                                                                            const form = document.querySelector(`form[data-gatilho="${eventoGatilho}"]`);
                                                                            const textoCustomizado = form?.querySelector('.config-texto')?.value || null;

                                                                            const msg = gerarMensagemAmigavel(eventoGatilho, dadosFalsos, textoCustomizado);

                                                                            Swal.fire({
                                                                                title: 'Pré-visualização (Redação Dinâmica)',
                                                                                html: `<pre style="text-align: left; background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; white-space: pre-wrap; font-size: 14px; border: 1px solid #dee2e6;">${msg}</pre>`,
                                                                                icon: 'info',
                                                                                confirmButtonText: 'Fechar Prévia'
                                                                            });
                                                                        };

                                                                        function gerarMensagemAmigavel(evento, dados, textoCustomizado = null) {
                                                                            const conf = NOTIFICATION_MAP[evento] || { titulo: " Notificação", sub: " Processamento" };

                                                                            // MOTOR DE SPINNING: Variantes para evitar bloqueio por spam
                                                                            const saudarPadrao = ["Olá", "Oi", "Como vai?", "Tudo bem?"];
                                                                            const saudarAlerta = ["Atenção", "Notificação importante", "Alerta do sistema", "Aviso urgente"];

                                                                            const conectorNovo = [
                                                                                "Há um novo processo aguardando análise:",
                                                                                "Um novo processo foi registrado e aguarda sua atenção:",
                                                                                "Foi cadastrado um novo processo na plataforma para você:"
                                                                            ];
                                                                            const conectorMuda = [
                                                                                "Informamos que houve uma movimentação no processo abaixo:",
                                                                                "O seguinte processo teve uma atualização de status relevante:",
                                                                                "Houve uma mudança de status no processo que segue abaixo:"
                                                                            ];
                                                                            const conectorDesigna = [
                                                                                "Você foi designado como analista para o seguinte processo:",
                                                                                "Informamos que você é o analista responsável pelo processo abaixo:",
                                                                                "Há um novo processo sob sua responsabilidade técnica no GECOPE:"
                                                                            ];
                                                                            const conectorAtraso = [
                                                                                "Notificação de Meta: O processo encontra-se em atraso:",
                                                                                "Atenção: O prazo estabelecido para este processo foi excedido:",
                                                                                "Alerta: A meta de análise expirou sem conclusão no sistema:"
                                                                            ];

                                                                            const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

                                                                            const nomeDestino = dados.ANALISTA || dados.NOME_FISCAL || dados.NOME_USUARIO || dados.FISCAL || 'Colega';
                                                                            const agora = new Date().toLocaleTimeString('pt-BR');

                                                                            let saudacao = "";
                                                                            let conector = "";
                                                                            let footer = "";

                                                                            // Construção por tipo de evento
                                                                            if (evento === 'novo_processo') {
                                                                                saudacao = `*${rand(saudarAlerta)}*, *${nomeDestino}*.`;
                                                                                conector = rand(conectorNovo);
                                                                                footer = `_Enviado via GECOPE às ${agora}_`;
                                                                            } else if (evento === 'mudanca_status_processo') {
                                                                                saudacao = `*${rand(saudarPadrao)}*, *${nomeDestino}*.`;
                                                                                conector = rand(conectorMuda);
                                                                                footer = `_Sistema GECOPE | ${agora}_`;
                                                                            } else if (evento === 'novas_metas_processo') {
                                                                                saudacao = `*Atenção*, *${nomeDestino}*.`;
                                                                                conector = rand(conectorAtraso);
                                                                                footer = `_Alerta automático GECOPE | ${agora}_`;
                                                                            } else if (evento === 'analista_designado') {
                                                                                saudacao = `*Olá*, *${nomeDestino}*.`;
                                                                                conector = rand(conectorDesigna);
                                                                                footer = `_GECOPE | Movimentação em ${agora}_`;
                                                                            } else {
                                                                                saudacao = `*${rand(saudarPadrao)}*, *${nomeDestino}*.`;
                                                                                conector = "Temos uma nova atualização no sistema:";
                                                                                footer = `_GECOPE | ${agora}_`;
                                                                            }

                                                                            // Eventos de "processo" (NUP + Aditivo de Serviços) são um domínio diferente
                                                                            // de eventos de orçamento/composição — antes o corpo padrão era o mesmo para
                                                                            // todos, então um comentário de orçamento chegava dizendo "📍 Aditivo de
                                                                            // Serviços" e "NUP: Não informado", que não faz sentido nesse contexto.
                                                                            const eventosDeProcesso = ['novo_processo', 'mudanca_status_processo', 'novas_metas_processo', 'analista_designado'];
                                                                            const ehEventoDeProcesso = eventosDeProcesso.includes(evento);

                                                                            const objetoTexto = dados.NOME_OBRA || dados.DESCRICAO || 'Obra não informada';
                                                                            const nup = dados.NUP_PROCESSO || 'Não informado';

                                                                            let corpo;
                                                                            if (textoCustomizado && textoCustomizado.trim()) {
                                                                                // Texto configurado pelo admin (config_whatsapp.texto_mensagem) substitui o
                                                                                // corpo fixo do template deste evento. Placeholders {{CAMPO}} são resolvidos
                                                                                // contra os mesmos nomes de campo usados em dadosDinamicos (ex.: NUP_PROCESSO,
                                                                                // NOME_OBRA). Saudação/conector/footer continuam variando normalmente por cima
                                                                                // (motor anti-spam preservado mesmo com corpo customizado).
                                                                                // Aceita também [CAMPO] como alias de {{CAMPO}} — erro humano comum ao digitar
                                                                                // o template (aconteceu de verdade em 3 eventos) que antes saía cru pro
                                                                                // usuário final sem nenhum aviso.
                                                                                corpo = textoCustomizado.replace(/\{\{(\w+)\}\}|\[([A-Z_]{3,})\]/g, (match, campoChave, campoColchete) => {
                                                                                    const campo = campoChave || campoColchete;
                                                                                    if (dados[campo] === undefined || dados[campo] === null) {
                                                                                        console.warn(`[WhatsApp] Placeholder "${campo}" não encontrado nos dados do evento "${evento}" — enviado sem substituição.`);
                                                                                        return match;
                                                                                    }
                                                                                    return dados[campo];
                                                                                });
                                                                            } else if (ehEventoDeProcesso) {
                                                                                let linhas = [
                                                                                    ` 📑*OBJETO:* ${objetoTexto}`,
                                                                                    ` 🏗️ Aditivo de Serviços`,
                                                                                    ` 📍*NUP:* ${nup}`
                                                                                ];

                                                                                // Adiciona campos específicos
                                                                                if (evento === 'novo_processo') {
                                                                                    linhas.push(` 📊*Status:* Análise Fiscal`);
                                                                                    if (dados.DATA_META) {
                                                                                        linhas.push(` 🎯*Meta:* ${dados.DATA_META}`);
                                                                                    }
                                                                                } else if (evento === 'mudanca_status_processo') {
                                                                                    const stExibicao = (dados.NOVO_STATUS || "Análise Fiscal");
                                                                                    linhas.push(` 📊*Novo Status:* ${stExibicao}`);
                                                                                    if (dados.DATA_META) {
                                                                                        linhas.push(` 🎯*Meta:* ${dados.DATA_META}`);
                                                                                    }
                                                                                } else if (evento === 'novas_metas_processo') {
                                                                                    linhas.push(` 🚨*Prazo Final:* Excedido!!!`);
                                                                                } else if (evento === 'analista_designado') {
                                                                                    linhas.push(` 📊*Status:* Em Análise`);
                                                                                }

                                                                                const avisoSuite = evento === 'novas_metas_processo' ? "\n\n*OBSERVAÇÃO:* Caso você já tenha despachado o processo no sistema *SUITE*, por favor desconsidere este aviso." : "";
                                                                                corpo = linhas.join('\n') + avisoSuite;
                                                                            } else {
                                                                                // Eventos de orçamento/composição: corpo montado só com os campos que o
                                                                                // chamador realmente enviou, sem herdar o vocabulário de "processo".
                                                                                let linhas = [];

                                                                                // AUTOR/NOME_USUARIO e REF_ORCAMENTO/CODIGO_COMPOSICAO são aliases do mesmo
                                                                                // conceito em chamadores diferentes — nunca vêm os dois juntos num disparo
                                                                                // real, mas a prévia de teste popula ambos ao mesmo tempo para cobrir todos
                                                                                // os eventos com um único conjunto de dados falsos.
                                                                                const autor = dados.AUTOR || dados.NOME_USUARIO;
                                                                                const referencia = dados.REF_ORCAMENTO || dados.CODIGO_COMPOSICAO;

                                                                                if (autor) linhas.push(` 👤*Autor:* ${autor}`);
                                                                                if (referencia) linhas.push(` 📁*Referência:* ${referencia}`);
                                                                                if (dados.DESCRICAO) linhas.push(` 📝*Descrição:* ${dados.DESCRICAO}`);
                                                                                if (dados.TABELA_NOME) linhas.push(` 📈*Tabela:* ${dados.TABELA_NOME}`);
                                                                                if (dados.VERSAO) linhas.push(` 🔖*Versão:* ${dados.VERSAO}`);
                                                                                if (dados.MES_REFERENCIA) linhas.push(` 🗓️*Mês de referência:* ${dados.MES_REFERENCIA}`);

                                                                                if (linhas.length === 0) linhas.push(` 📝 Sem detalhes adicionais informados.`);

                                                                                corpo = linhas.join('\n');
                                                                            }

                                                                            return `*${conf.titulo.trim()}*\n\n${saudacao}\n${conector}\n\n${corpo}\n\n${footer}`;
                                                                        }

                                                                        // Cache para evitar disparos duplicados (debounce)
                                                                        const lastNotificationCache = new Map();

                                                                        // Enfileira um envio via proxy (server/whatsapp-proxy) — não fala mais direto com a
                                                                        // Evolution API. O envio real e a finalização do status ('sucesso'/'falha') do log
                                                                        // acontecem depois, no worker do proxy (via service role), não aqui — por isso
                                                                        // o retorno desta função significa "aceito na fila", não "entregue".
                                                                        // `logRow` é declarado FORA do try (não dentro dele) de propósito: código antigo o
                                                                        // declarava com `let` dentro do try, invisível no catch irmão (escopo de bloco do
                                                                        // JS) — isso lançava um ReferenceError sempre que o disparo falhava, silenciosamente
                                                                        // interrompendo o loop de broadcast de processarNotificacao no primeiro destinatário.
                                                                        async function enviarMensagemIndividual(telefone, texto, nomeDestinatario = "Destinatário", eventoGatilho = "disparo_manual", dadosExtras = {}) {
                                                                            let logRow = null;
                                                                            try {
                                                                                let cleanPhone = telefone.replace(/\D/g, '');
                                                                                if (cleanPhone.length === 10 || cleanPhone.length === 11) cleanPhone = '55' + cleanPhone;

                                                                                // Normalização para DDDs do Ceará (85/88) que costumam dar erro com o 9 extra em certas instâncias
                                                                                if (cleanPhone.length === 13 && (cleanPhone.startsWith('55889') || cleanPhone.startsWith('55859'))) {
                                                                                    cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
                                                                                }

                                                                                // Validação de segurança
                                                                                if (!cleanPhone || cleanPhone.length < 10) {
                                                                                    console.error("[WhatsApp] Telefone inválido:", cleanPhone);
                                                                                    return false;
                                                                                }

                                                                                // Cria log inicial
                                                                                try {
                                                                                    const { data, error: insertError } = await sbClient.from('whatsapp_logs').insert({
                                                                                        evento: eventoGatilho,
                                                                                        destinatario: cleanPhone,
                                                                                        destinatario_nome: nomeDestinatario,
                                                                                        mensagem: texto,
                                                                                        status: 'processando',
                                                                                        erro_detalhe: 'Enfileirando disparo...',
                                                                                        // nup e objeto removidos por não existirem na tabela
                                                                                    }).select('id').single();

                                                                                    if (insertError) {
                                                                                        console.warn("[WhatsApp] Aviso ao criar log:", insertError.message);
                                                                                    }
                                                                                    logRow = data;
                                                                                } catch (e) {
                                                                                    console.warn("[WhatsApp] Erro não-crítico ao registrar log inicial:", e);
                                                                                }

                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/send`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json' },
                                                                                    body: JSON.stringify({
                                                                                        number: cleanPhone,
                                                                                        text: texto,
                                                                                        log_id: logRow?.id || null
                                                                                    })
                                                                                });

                                                                                if (!response.ok && logRow) {
                                                                                    // Não foi aceito na fila (ex.: recipient_not_registered, proxy fora do ar,
                                                                                    // sessão inválida). O PRÓPRIO SERVIDOR (server/whatsapp-proxy/web/index.js,
                                                                                    // markLogFailed) já marca este log como 'falha' nesses casos, usando a
                                                                                    // service role — o cliente não tenta mais gravar isso direto no banco porque
                                                                                    // whatsapp_logs.UPDATE é admin-only agora (RLS); uma tentativa daqui só
                                                                                    // falharia silenciosamente sem nenhum ganho.
                                                                                    console.warn(`[WhatsApp] Envio recusado pelo proxy (HTTP ${response.status}) para log ${logRow.id} — servidor deve ter marcado como falha.`);
                                                                                }

                                                                                return response.ok;
                                                                            } catch (err) {
                                                                                // Erro de rede/timeout ANTES de qualquer resposta do proxy: neste caso o
                                                                                // servidor nem chegou a ver a requisição, então não há como ele marcar a
                                                                                // falha por nós. O log fica em 'processando' até a varredura periódica do
                                                                                // worker (ver reclaimOrphanLogs em worker.js) encerrá-lo como falha.
                                                                                console.error("[WhatsApp] Erro no disparo (log ficará para a varredura do worker):", err);
                                                                                return false;
                                                                            }
                                                                        }

                                                                        async function processarNotificacao(eventoGatilho, dadosDinamicos) {
                                                                            try {
                                                                                // Previne disparos duplicados em um curto intervalo (ex: duplo clique ou loop)
                                                                                const identificador = dadosDinamicos.NUP_PROCESSO || dadosDinamicos.ID || dadosDinamicos.CODIGO_COMPOSICAO || JSON.stringify(dadosDinamicos);
                                                                                const cacheKey = `${eventoGatilho}_${identificador}`;
                                                                                const agoraMs = Date.now();

                                                                                if (lastNotificationCache.has(cacheKey) && (agoraMs - lastNotificationCache.get(cacheKey) < 8000)) {
                                                                                    console.warn(`[WhatsApp] Bloqueio de duplicidade: O evento "${eventoGatilho}" para "${identificador}" já foi processado recentemente.`);
                                                                                    return;
                                                                                }
                                                                                // Poda entradas expiradas a cada novo registro — sem isso o Map crescia
                                                                                // sem limite ao longo da sessão (nunca era limpo).
                                                                                for (const [k, t] of lastNotificationCache) {
                                                                                    if (agoraMs - t >= 8000) lastNotificationCache.delete(k);
                                                                                }
                                                                                lastNotificationCache.set(cacheKey, agoraMs);

                                                                                console.log(`[WhatsApp] Iniciando verificação para: ${eventoGatilho}`);
                                                                                const { data: config, error: configError } = await sbClient
                                                                                    .from('config_whatsapp')
                                                                                    .select('*')
                                                                                    .eq('evento_gatilho', eventoGatilho)
                                                                                    .single();

                                                                                if (configError || !config || !config.is_ativo) return;

                                                                                // GERA MENSAGEM PELO MOTOR DINMICO (IA)
                                                                                // A mensagem agora é gerada dentro do loop de envio para permitir variações por destinatário


                                                                                let telefonesAlvo = [];

                                                                                // Disparo Geral (Para todos os Fiscais Ativos com Telefone)
                                                                                if (config.destinatarios.includes('geral')) {
                                                                                    const { data: usuarios } = await sbClient
                                                                                        .from('app_users')
                                                                                        .select('telefone_whatsapp')
                                                                                        .not('telefone_whatsapp', 'is', null);

                                                                                    if (usuarios) {
                                                                                        telefonesAlvo.push(...usuarios.map(u => u.telefone_whatsapp));
                                                                                    }
                                                                                }

                                                                                // Disparo Individual (Fiscal Responsável ou Definido nos Dados)
                                                                                if (config.destinatarios.includes('individual')) {
                                                                                    if (dadosDinamicos.MATRICULA_FISCAL) {
                                                                                        // Tenta resgatar pelo BD caso passe a matrícula do fiscal alvo
                                                                                        const { data: user } = await sbClient
                                                                                            .from('app_users')
                                                                                            .select('telefone_whatsapp')
                                                                                            .eq('matricula', dadosDinamicos.MATRICULA_FISCAL)
                                                                                            .single();

                                                                                        if (user && user.telefone_whatsapp) {
                                                                                            telefonesAlvo.push(user.telefone_whatsapp);
                                                                                        }
                                                                                    }

                                                                                    // Fallback: Tenta resgatar pelo Nome caso não tenha matrícula ou não tenha encontrado
                                                                                    let nomeBusca = dadosDinamicos.ANALISTA || dadosDinamicos.NOME_FISCAL || dadosDinamicos.FISCAL || dadosDinamicos.NOME_USUARIO || dadosDinamicos.AUTOR;

                                                                                    // Se não encontrou por nome explicito, mas tem uma "matrícula" que não é número, assume que é o nome
                                                                                    if (!nomeBusca && dadosDinamicos.MATRICULA_FISCAL && isNaN(dadosDinamicos.MATRICULA_FISCAL)) {
                                                                                        nomeBusca = dadosDinamicos.MATRICULA_FISCAL;
                                                                                    }

                                                                                    if (telefonesAlvo.length === 0 && nomeBusca) {
                                                                                        const { data: users } = await sbClient
                                                                                            .from('app_users')
                                                                                            .select('nome, sobrenome, full_name, telefone_whatsapp, email')
                                                                                            .not('telefone_whatsapp', 'is', null);

                                                                                        if (users && users.length > 0) {
                                                                                            const search = nomeBusca.toUpperCase().trim();

                                                                                            // Prioriza usuários reais sobre ghost users
                                                                                            const realUsers = users.filter(u => !u.email.includes('@sop-ghost.internal'));
                                                                                            const ghostUsers = users.filter(u => u.email.includes('@sop-ghost.internal'));

                                                                                            // BUG CORRIGIDO (2026-08-21): quando dbName vem vazio (full_name em branco,
                                                                                            // caso real de todos os contatos fantasma hoje), `search.includes('')` é
                                                                                            // SEMPRE verdadeiro em JS — o find() abaixo não comparava nome nenhum,
                                                                                            // devolvia o primeiro contato da lista pra QUALQUER busca. Foi assim que uma
                                                                                            // notificação do FRANCISCO GOIANA saiu no WhatsApp do LUCIANO DENIZARDY (os
                                                                                            // dois só existem como contato fantasma, ambos com full_name vazio). A trava
                                                                                            // abaixo bloqueia esse falso-positivo; nomeDeContatoFantasma (definida mais
                                                                                            // acima no arquivo) tenta recuperar o nome de verdade a partir do e-mail
                                                                                            // interno, então o match volta a funcionar mesmo sem rodar um reparo de dados.
                                                                                            let found = realUsers.find(u => {
                                                                                                const dbName = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || '').toUpperCase();
                                                                                                if (!dbName) return false;
                                                                                                return dbName === search || dbName.includes(search) || search.includes(dbName);
                                                                                            });

                                                                                            if (!found) {
                                                                                                found = ghostUsers.find(u => {
                                                                                                    const dbName = (u.full_name || nomeDeContatoFantasma(u.email) || '').toUpperCase();
                                                                                                    if (!dbName) return false;
                                                                                                    return dbName === search || dbName.includes(search) || search.includes(dbName);
                                                                                                });
                                                                                            }

                                                                                            if (found && found.telefone_whatsapp) {
                                                                                                telefonesAlvo.push(found.telefone_whatsapp);
                                                                                            }
                                                                                        }
                                                                                    }

                                                                                    if (telefonesAlvo.length === 0 && dadosDinamicos.TELEFONE_ALVO) {
                                                                                        telefonesAlvo.push(dadosDinamicos.TELEFONE_ALVO);
                                                                                    }
                                                                                }

                                                                                if (telefonesAlvo.length > 0) {
                                                                                    console.log(`[WhatsApp] Analisando ${telefonesAlvo.length} possíveis destinatários.`);

                                                                                    // Mapear para objetos {nome, fone} com DEDUPLICAO RIGOROSA
                                                                                    let alvosCompletos = [];
                                                                                    const fonesProcessados = new Set();

                                                                                    // Busca o nome do Fiscal se for disparo individual
                                                                                    let nomeDestinatarioPadrao = "Fiscal / Responsável";
                                                                                    if (dadosDinamicos.ANALISTA || dadosDinamicos.NOME_FISCAL || dadosDinamicos.FISCAL) {
                                                                                        nomeDestinatarioPadrao = dadosDinamicos.ANALISTA || dadosDinamicos.NOME_FISCAL || dadosDinamicos.FISCAL;
                                                                                    }

                                                                                    telefonesAlvo.forEach(t => {
                                                                                        let clean = typeof t === 'string' ? t.replace(/\D/g, '') : '';
                                                                                        if (clean.length === 10 || clean.length === 11) clean = '55' + clean;

                                                                                        // Só adiciona se o telefone for válido e ainda não estiver na lista deste disparo
                                                                                        if (clean.length >= 12 && !fonesProcessados.has(clean)) {
                                                                                            fonesProcessados.add(clean);
                                                                                            alvosCompletos.push({
                                                                                                nome: nomeDestinatarioPadrao,
                                                                                                fone: clean
                                                                                            });
                                                                                        }
                                                                                    });

                                                                                    // Função auxiliar para pausa
                                                                                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

                                                                                    // Loop de envio sequencial com delay anti-bloqueio
                                                                                    for (let i = 0; i < alvosCompletos.length; i++) {
                                                                                        const alvo = alvosCompletos[i];
                                                                                        const mensagemUnica = gerarMensagemAmigavel(eventoGatilho, dadosDinamicos, config.texto_mensagem);

                                                                                        console.log(`[WhatsApp] Disparando para: ${alvo.nome} (${alvo.fone})`);

                                                                                        // Delay inicial e entre envios
                                                                                        await sleep(Math.floor(Math.random() * 3000) + 2000);
                                                                                        if (i > 0) await sleep(Math.floor(Math.random() * 4000) + 3000);

                                                                                        // Usa a função centralizada para disparar e logar
                                                                                        await enviarMensagemIndividual(alvo.fone, mensagemUnica, alvo.nome, eventoGatilho, {
                                                                                            NUP_PROCESSO: dadosDinamicos.NUP_PROCESSO || null,
                                                                                            OBJETO: dadosDinamicos.NOME_OBRA || dadosDinamicos.DESCRICAO || dadosDinamicos.REF_ORCAMENTO || dadosDinamicos.TABELA_NOME || null
                                                                                        });
                                                                                    }
                                                                                }
                                                                            } catch (err) {
                                                                                console.error(`[WhatsApp] Erro geral:`, err);
                                                                            }
                                                                        }

                                                                        async function carregarLogsWhatsApp() {
                                                                            const tbody = document.getElementById('ws-logs-table-body');
                                                                            if (!tbody) return;

                                                                            try {
                                                                                const { data, error } = await sbClient
                                                                                    .from('whatsapp_logs')
                                                                                    .select('*')
                                                                                    .eq('status', 'falha')
                                                                                    .order('created_at', { ascending: false })
                                                                                    .limit(50);

                                                                                if (error) throw error;

                                                                                if (!data || data.length === 0) {
                                                                                    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted"><i class="bi bi-check-circle me-2"></i>Nenhuma falha de envio registrada no momento.</td></tr>';
                                                                                    return;
                                                                                }

                                                                                tbody.innerHTML = data.map(log => {
                                                                                    const statusColor = log.status === 'sucesso' ? 'bg-success' : 'bg-danger';
                                                                                    const erroFormatado = formatarErroWhatsApp(log.erro_detalhe);

                                                                                    const nupExibicao = (log.mensagem ? log.mensagem.match(/NUP:\* ([\d\/\-]+)/)?.[1] : '-');
                                                                                    const objetoExibicao = (log.mensagem ? log.mensagem.match(/OBJETO:\* ([^\n]+)/)?.[1] : '-');

                                                                                    return `
                        <tr>
                            <td class="small text-muted">${new Date(log.created_at).toLocaleString('pt-BR')}</td>
                            <td class="small text-muted">${escapeHTML(log.evento)}</td>
                            <td class="small text-muted text-truncate" style="max-width: 120px;">${escapeHTML(log.destinatario_nome) || '-'}</td>
                            <td class="small text-muted">${escapeHTML(log.destinatario)}</td>
                            <td class="small text-muted">${escapeHTML(nupExibicao)}</td>
                            <td class="small text-muted text-truncate" style="max-width: 150px;" title="${escapeHTML(objetoExibicao)}">${escapeHTML(objetoExibicao)}</td>
                            <td>
                                <span class="badge ${statusColor}" style="font-size:0.65rem">
                                    ${escapeHTML(log.status.toUpperCase())}
                                </span>
                            </td>
                            <td class="text-center">
                                <div class="d-flex gap-1 justify-content-center">
                                    <button class="btn btn-xs btn-outline-danger p-0 px-1" title="Ver Detalhes do Erro"
                                        onclick="verDetalheErroWhatsApp('${log.id}')">
                                        <i class="bi bi-search"></i>
                                    </button>
                                    <button class="btn btn-xs btn-primary p-0 px-1" title="Tentar Reenviar Agora"
                                        onclick="reenviarMensagemWhatsApp('${log.id}')">
                                        <i class="bi bi-arrow-repeat"></i>
                                    </button>
                                    <button class="btn btn-xs btn-outline-secondary p-0 px-1" title="Excluir Log"
                                        onclick="excluirLogWhatsApp('${log.id}')">
                                        <i class="bi bi-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
                                                                                }).join('');
                                                                            } catch (err) {
                                                                                console.error("Erro ao carregar logs:", err);
                                                                                tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-3">Erro ao carregar logs.</td></tr>';
                                                                            }
                                                                        }

                                                                        // Busca o log pelo id e monta o Swal.fire em JS (sem passar pelo atributo
                                                                        // onclick="..." como antes) — o HTML antigo interpolava erro/destinatário
                                                                        // direto dentro de um onclick com aspas duplas: qualquer aspa dupla nesses
                                                                        // campos (ex.: eco de texto de erro da Evolution API) quebrava o atributo
                                                                        // e injetava HTML/JS arbitrário na tela de logs do WhatsApp (visível a admins).
                                                                        async function verDetalheErroWhatsApp(logId) {
                                                                            try {
                                                                                const { data: log, error } = await sbClient.from('whatsapp_logs').select('*').eq('id', logId).single();
                                                                                if (error || !log) throw new Error("Log não encontrado.");
                                                                                const erroFormatado = formatarErroWhatsApp(log.erro_detalhe);
                                                                                Swal.fire({
                                                                                    title: 'Dificuldade no Envio',
                                                                                    html: `<div class='text-start small'><b>O que ocorreu?</b><br><span class='text-danger'>${escapeHTML(erroFormatado)}</span><br><br><b>Destinatário:</b> ${escapeHTML(log.destinatario_nome || 'Não identificado')}<br><b>Telefone:</b> ${escapeHTML(log.destinatario)}<hr><i class='text-muted'>Erro técnico: ${escapeHTML(log.erro_detalhe || 'sem detalhes')}</i></div>`,
                                                                                    icon: 'error',
                                                                                    confirmButtonText: 'Entendido'
                                                                                });
                                                                            } catch (err) {
                                                                                Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível carregar os detalhes deste log.' });
                                                                            }
                                                                        }

                                                                        // O proxy busca telefone/mensagem do próprio log — o cliente só informa o id.
                                                                        // O envio real acontece no worker de forma assíncrona; um 202 aqui significa
                                                                        // "reenvio aceito na fila", não "mensagem entregue".
                                                                        //
                                                                        // Guard de duplo clique: a garantia de verdade contra reenvio duplicado é o
                                                                        // compare-and-swap no servidor (POST /api/whatsapp/resend/:logId só transiciona
                                                                        // falha->processando uma vez, ver server/whatsapp-proxy/web/index.js), mas sem
                                                                        // nada aqui um segundo clique enquanto a primeira requisição ainda está em voo
                                                                        // gerava uma segunda chamada à toa (e, antes da correção no servidor, um
                                                                        // reenvio de verdade em duplicidade). `reenviosEmAndamento` ignora cliques
                                                                        // repetidos para o mesmo log enquanto o primeiro ainda não terminou.
                                                                        const reenviosEmAndamento = new Set();
                                                                        async function reenviarMensagemWhatsApp(logId) {
                                                                            if (reenviosEmAndamento.has(logId)) return;
                                                                            reenviosEmAndamento.add(logId);
                                                                            try {
                                                                                const { data: log, error } = await sbClient.from('whatsapp_logs').select('destinatario, destinatario_nome').eq('id', logId).single();
                                                                                if (error || !log) throw new Error("Log não encontrado.");

                                                                                Swal.fire({
                                                                                    title: 'Enfileirando reenvio...',
                                                                                    text: `Para ${log.destinatario_nome || log.destinatario}`,
                                                                                    allowOutsideClick: false,
                                                                                    didOpen: () => { Swal.showLoading(); }
                                                                                });

                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/resend/${logId}`, {
                                                                                    method: 'POST'
                                                                                });

                                                                                if (response.ok) {
                                                                                    Swal.fire('Reenvio enfileirado', 'Acompanhe o resultado no painel de logs em alguns instantes.', 'success');
                                                                                } else if (response.status === 409) {
                                                                                    Swal.fire('Reenvio já em andamento', 'Este log já está sendo reenviado (ou outra pessoa acabou de reenviá-lo). Aguarde o resultado no painel de logs.', 'info');
                                                                                } else {
                                                                                    const errData = await response.json().catch(() => ({}));
                                                                                    throw new Error(formatarErroWhatsApp(`Erro: ${response.status} - ${errData.error || 'Erro'}`));
                                                                                }
                                                                                carregarLogsWhatsApp();
                                                                            } catch (err) {
                                                                                Swal.fire('Falha no Reenvio', err.message, 'error');
                                                                            } finally {
                                                                                reenviosEmAndamento.delete(logId);
                                                                            }
                                                                        }

                                                                        async function excluirLogWhatsApp(logId) {
                                                                            const { isConfirmed } = await Swal.fire({
                                                                                title: 'Excluir Log?',
                                                                                text: "Esta ação removerá este registro de falha permanentemente.",
                                                                                icon: 'warning',
                                                                                showCancelButton: true,
                                                                                confirmButtonColor: '#d33',
                                                                                confirmButtonText: 'Sim, excluir!',
                                                                                cancelButtonText: 'Cancelar'
                                                                            });

                                                                            if (isConfirmed) {
                                                                                try {
                                                                                    const { error } = await sbClient
                                                                                        .from('whatsapp_logs')
                                                                                        .delete()
                                                                                        .eq('id', logId);

                                                                                    if (error) throw error;

                                                                                    showToast("Log excluído com sucesso.");
                                                                                    carregarLogsWhatsApp();
                                                                                } catch (err) {
                                                                                    console.error("Erro ao excluir log:", err);
                                                                                    Swal.fire('Erro', 'Não foi possível excluir o log.', 'error');
                                                                                }
                                                                            }
                                                                        }

                                                                        // Apaga de uma vez todos os logs com status 'falha' — mesmo filtro usado por
                                                                        // carregarLogsWhatsApp, então corresponde exatamente ao que está listado na tela.
                                                                        async function excluirTodosLogsFalhaWhatsApp() {
                                                                            const { isConfirmed } = await Swal.fire({
                                                                                title: 'Limpar todas as falhas?',
                                                                                text: "Todos os registros de falha listados serão removidos permanentemente. Esta ação não pode ser desfeita.",
                                                                                icon: 'warning',
                                                                                showCancelButton: true,
                                                                                confirmButtonColor: '#d33',
                                                                                confirmButtonText: 'Sim, limpar tudo!',
                                                                                cancelButtonText: 'Cancelar'
                                                                            });

                                                                            if (!isConfirmed) return;

                                                                            try {
                                                                                const { error } = await sbClient
                                                                                    .from('whatsapp_logs')
                                                                                    .delete()
                                                                                    .eq('status', 'falha');

                                                                                if (error) throw error;

                                                                                showToast("Falhas removidas com sucesso.");
                                                                                carregarLogsWhatsApp();
                                                                            } catch (err) {
                                                                                console.error("Erro ao limpar logs de falha:", err);
                                                                                Swal.fire('Erro', 'Não foi possível limpar os logs de falha.', 'error');
                                                                            }
                                                                        }

                                                                        function formatarErroWhatsApp(erroBruto) {
                                                                            if (!erroBruto) return "Erro desconhecido ou não detalhado.";

                                                                            const erro = String(erroBruto).toUpperCase();

                                                                            if (erro.includes("NÃO REENVIADO AUTOMATICAMENTE") || erro.includes("VERIFICAR MANUALMENTE SE A MENSAGEM CHEGOU")) {
                                                                                return "O envio travou depois de já ter tentado enviar ao WhatsApp — por segurança, NÃO foi reenviado automaticamente (poderia duplicar a mensagem). Confirme com o destinatário se a mensagem já chegou antes de usar 'Reenviar'.";
                                                                            }
                                                                            if (erro.includes("500") || erro.includes("CONNECTION CLOSED")) {
                                                                                return "O servidor do WhatsApp está temporariamente fora de área ou a conexão caiu. Tente novamente em alguns minutos.";
                                                                            }
                                                                            if (erro.includes("401") || erro.includes("UNAUTHORIZED")) {
                                                                                return "Falha na autenticação do sistema. Por favor, avise o administrador para verificar a chave de acesso (API Key).";
                                                                            }
                                                                            if (erro.includes("404") || erro.includes("NOT FOUND")) {
                                                                                return "A instância de envio não foi encontrada. A conexão com o celular pode ter sido deslogada.";
                                                                            }
                                                                            if (erro.includes("NUMBER NOT EXISTS") || erro.includes("INVALID NUMBER")) {
                                                                                return "O número do destinatário parece estar incorreto ou não possui uma conta de WhatsApp ativa.";
                                                                            }
                                                                            if (erro.includes("403") || erro.includes("FORBIDDEN")) {
                                                                                return "Acesso negado. O servidor bloqueou o disparo por motivo de segurança ou limites da conta.";
                                                                            }
                                                                            if (erro.includes("ECONNREFUSED") || erro.includes("FETCH ERROR")) {
                                                                                return "Não foi possível conectar ao servidor de disparos. Verifique se o servidor da Evolution API está ligado.";
                                                                            }
                                                                            if (erro.includes("TIMEDOUT") || erro.includes("TIMEOUT")) {
                                                                                return "O tempo de espera para o envio esgotou. O servidor pode estar lento ou o destinatário está inacessível.";
                                                                            }

                                                                            return "Ocorreu um erro técnico durante o processamento. Tente reenviar ou verifique o log detalhado.";
                                                                        }

                                                                        function showToast(mensagem, icon = 'success') {
                                                                            Swal.fire({
                                                                                text: mensagem,
                                                                                icon: icon,
                                                                                toast: true,
                                                                                position: 'top-end',
                                                                                showConfirmButton: false,
                                                                                timer: 3000,
                                                                                timerProgressBar: true
                                                                            });
                                                                        }

                                                                        // O proxy já resolve internamente o caso de instância inexistente (cria
                                                                        // automaticamente e devolve state:'creating') — o cliente só precisa mapear
                                                                        // o `state` recebido para o texto exibido, sem orquestrar duas chamadas.
                                                                        async function verificarStatusEvolution() {
                                                                            const statusText = document.getElementById('ws-status-text');
                                                                            if (!statusText) return;

                                                                            try {
                                                                                statusText.innerText = "Consultando instância...";
                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/status`);
                                                                                const data = await response.json().catch(() => ({}));
                                                                                const state = data.state || 'unknown';

                                                                                if (state === 'open') {
                                                                                    statusText.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-check-circle-fill"></i> Conectado (SOP)</span>';
                                                                                } else if (state === 'connecting' || state === 'close' || state === 'creating') {
                                                                                    statusText.innerHTML = `<span class="text-warning fw-bold"><i class="bi bi-qr-code"></i> Instância: ${state} (Escaneie o QR)</span>`;
                                                                                } else if (state === 'offline') {
                                                                                    statusText.innerHTML = '<span class="text-danger fw-bold"><i class="bi bi-x-circle-fill"></i> Proxy/API Offline</span>';
                                                                                } else {
                                                                                    statusText.innerHTML = `<span class="text-warning fw-bold"><i class="bi bi-exclamation-triangle"></i> Instância: ${state}</span>`;
                                                                                }
                                                                            } catch (err) {
                                                                                statusText.innerHTML = '<span class="text-danger fw-bold"><i class="bi bi-x-circle-fill"></i> API Offline</span>';
                                                                                console.error("[WhatsApp] Erro ao verificar status:", err);
                                                                            }
                                                                        }

                                                                        // Badge discreto ao lado de "Administração" (home) — roda para todo admin
                                                                        // logado, independente de estar com o painel de Administração aberto, para
                                                                        // avisar antes de alguém precisar abrir a aba e descobrir por acaso que o
                                                                        // WhatsApp está fora do ar. Some sozinho quando a conexão volta ao normal
                                                                        // (reflete whatsapp_control.degraded_since, mantido pelo watchdog no
                                                                        // servidor — ver server/whatsapp-proxy/watchdog/watchdog.js).
                                                                        // Contador de falhas reais consecutivas ao checar o badge — ver uso abaixo.
                                                                        let falhasConsecutivasBadge = 0;

                                                                        async function atualizarBadgeStatusWhatsApp() {
                                                                            if (typeof getCurrentUserRole !== 'function' || getCurrentUserRole() !== 'admin') return;
                                                                            const badge = document.getElementById('badge-alerta-whatsapp');
                                                                            if (!badge) return;
                                                                            try {
                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/status`);
                                                                                const data = await response.json().catch(() => ({}));
                                                                                falhasConsecutivasBadge = 0;
                                                                                if (data.degraded) {
                                                                                    badge.title = 'A conexão do WhatsApp está com problema. Abra Administração > Gestão Integrada de Notificações para reiniciar.';
                                                                                    badge.style.display = 'inline-flex';
                                                                                } else {
                                                                                    badge.style.display = 'none';
                                                                                }
                                                                            } catch (err) {
                                                                                // BUG CORRIGIDO (2026-08-21): antes este catch era vazio de propósito
                                                                                // "para não acender alarme falso" — mas isso também escondia um outage
                                                                                // REAL para sempre: se o badge já estava oculto (saudável) na última
                                                                                // checagem e o proxy/VM caiu de vez, toda checagem seguinte cai aqui e
                                                                                // o admin nunca via nenhum sinal, nem no badge discreto do dashboard.
                                                                                // "Sessão expirada" é o único caso que continua sendo ignorado (não é
                                                                                // sinal de outage — é a sessão do navegador ainda não estar pronta ou
                                                                                // ter sido renovada); qualquer OUTRO erro (proxy fora do ar, timeout,
                                                                                // rede) conta como falha real, e só acende o alarme após 2 falhas
                                                                                // seguidas — evita piscar o badge por causa de um blip isolado.
                                                                                if (err && err.message === 'Sessão expirada. Faça login novamente para enviar mensagens.') return;
                                                                                falhasConsecutivasBadge++;
                                                                                if (falhasConsecutivasBadge >= 2) {
                                                                                    badge.title = 'Não foi possível checar a conexão do WhatsApp (proxy/VM pode estar fora do ar). Abra Administração > Gestão Integrada de Notificações.';
                                                                                    badge.style.display = 'inline-flex';
                                                                                }
                                                                            }
                                                                        }

                                                                        // Pede ao servidor para reiniciar o container evolution-api sem precisar
                                                                        // entrar na VM por SSH. Quem executa de fato é um serviço isolado (o
                                                                        // whatsapp-watchdog), então o reinício pode levar até WATCHDOG_POLL_MS
                                                                        // (~30s por padrão) para acontecer — daí o aviso de espera abaixo.
                                                                        window.reiniciarConexaoWhatsApp = async function () {
                                                                            const { isConfirmed } = await Swal.fire({
                                                                                title: 'Reiniciar conexão do WhatsApp?',
                                                                                text: 'Isso derruba e reconecta a sessão no servidor. Pode levar até 1 minuto para normalizar.',
                                                                                icon: 'warning',
                                                                                showCancelButton: true,
                                                                                confirmButtonText: 'Sim, reiniciar',
                                                                                cancelButtonText: 'Cancelar'
                                                                            });
                                                                            if (!isConfirmed) return;

                                                                            try {
                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/instance/restart-request`, {
                                                                                    method: 'POST'
                                                                                });
                                                                                if (!response.ok) throw new Error(`Status ${response.status}`);

                                                                                showToast('Pedido de reinício enviado. Aguardando o servidor aplicar...', 'info');
                                                                                setTimeout(verificarStatusEvolution, 35000);
                                                                                setTimeout(atualizarBadgeStatusWhatsApp, 35000);
                                                                            } catch (err) {
                                                                                console.error('[WhatsApp] Erro ao pedir reinício:', err);
                                                                                Swal.fire('Erro', 'Não foi possível enviar o pedido de reinício. Tente novamente.', 'error');
                                                                            }
                                                                        };

                                                                        // Inicia verificação ao carregar se estiver na aba de config
                                                                        document.addEventListener('DOMContentLoaded', () => {
                                                                            // Pequeno delay para garantir que o DOM está pronto e estilos aplicados
                                                                            setTimeout(verificarStatusEvolution, 800); // Optimized from 2000ms
                                                                            setTimeout(atualizarBadgeStatusWhatsApp, 1500);
                                                                            setInterval(atualizarBadgeStatusWhatsApp, 60000);
                                                                        });

                                                                        window.testarConexaoWhatsApp = async function (event) {
                                                                            if (event) event.stopPropagation();

                                                                            showToast("Verificando status da instância...", "info");

                                                                            try {
                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/status`);
                                                                                const data = await response.json().catch(() => ({}));
                                                                                console.log("[WhatsApp] Status da Instância:", data);

                                                                                const state = data.state || 'desconhecido';

                                                                                if (state === 'open') {
                                                                                    Swal.fire('Conectado!', 'A API do WhatsApp está operando normalmente.', 'success');
                                                                                } else {
                                                                                    Swal.fire('Instância: ' + state, `O estado atual é "${state}". Para que o sistema funcione, a instância deve estar "open". Use o botão "Conectar (QR Code)" se precisar parear novamente.`, 'warning');
                                                                                }
                                                                            } catch (e) {
                                                                                console.error(e);
                                                                                Swal.fire('Erro na Conexão', 'Não foi possível contatar o proxy de WhatsApp. Verifique se WHATSAPP_PROXY_URL está configurado e a VM está no ar.', 'error');
                                                                            }
                                                                        };

                                                                        // Busca o QR code de pareamento no proxy (admin-only no backend) e exibe direto
                                                                        // no painel do GECOPE — a Evolution API não tem porta pública, então este é o
                                                                        // único jeito de escanear o QR sem acesso à VM.
                                                                        window.mostrarQrCodeWhatsApp = async function () {
                                                                            try {
                                                                                Swal.fire({ title: 'Buscando QR Code...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

                                                                                const response = await fetchComTimeout(`${window.WHATSAPP_PROXY_URL}/api/whatsapp/instance/qrcode`);
                                                                                if (!response.ok) {
                                                                                    if (response.status === 403) throw new Error('Apenas administradores podem visualizar o QR code.');
                                                                                    throw new Error('QR code indisponível no momento. Tente novamente em alguns segundos.');
                                                                                }
                                                                                const { qrcode } = await response.json();
                                                                                if (!qrcode) throw new Error('QR code indisponível no momento.');

                                                                                const imgSrc = qrcode.startsWith('data:') ? qrcode : `data:image/png;base64,${qrcode}`;
                                                                                Swal.fire({
                                                                                    title: 'Escaneie para conectar',
                                                                                    html: `<img src="${imgSrc}" alt="QR Code WhatsApp" style="max-width:280px;width:100%;" />`,
                                                                                    confirmButtonText: 'Fechar'
                                                                                });
                                                                            } catch (err) {
                                                                                Swal.fire('Erro ao buscar QR Code', err.message, 'error');
                                                                            }
                                                                        };





