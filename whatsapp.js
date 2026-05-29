                                                                        async function notificarAtualizacaoTabelas() {
                                                                            const fonte = document.getElementById('busca-fonte').value;
                                                                            const versao = document.getElementById('busca-versao').value;
                                                                            const ref = document.getElementById('busca-ref').value;

                                                                            const { isConfirmed } = await Swal.fire({
                                                                                title: 'Notificar Todos?',
                                                                                text: `Deseja enviar um comunicado via WhatsApp para TODOS os usuários informando que a tabela ${fonte} (${versao}) foi atualizada?`,
                                                                                icon: 'question',
                                                                                showCancelButton: true,
                                                                                confirmButtonText: 'Sim, disparar!',
                                                                                cancelButtonText: 'Cancelar'
                                                                            });

                                                                            if (isConfirmed) {
                                                                                processarNotificacao('atualizacao_tabelas', {
                                                                                    TABELA_NOME: fonte,
                                                                                    VERSAO: versao,
                                                                                    MES_REFERENCIA: ref.toUpperCase()
                                                                                });
                                                                                Swal.fire('Disparo Iniciado', 'As mensagens estão sendo enviadas em segundo plano (com delay de segurança).', 'success');
                                                                            }
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
                                                                                            const name = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || '').toUpperCase();
                                                                                            if (!name) return;
                                                                                            const isGhost = u.email && u.email.includes('@sop-ghost.internal');

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
                                                                                        html += `<option value="${u.telefone_whatsapp || 'missing_' + u.name}" data-name="${u.name}" data-email="${u.email}" ${!hasPhone ? 'style="color: #dc3545;"' : ''}>
                                ${u.name} (${u.role.toUpperCase()}) ${u.isGhost ? '[CONTATO SALVO]' : ''} ${!hasPhone ? ' [SEM WHATSAPP]' : ''}
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

                                                                                Swal.fire('Broadcast Finalizado', `${successCount} mensagens enviadas com sucesso.${failCount > 0 ? ` ${failCount} falhas ou pulados.` : ''}`, 'success');

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
                                                                                        // Cria um "contato fantasma" para futuras comunicações
                                                                                        const dummyEmail = `contato_${name.toLowerCase().replace(/\s+/g, '_')}@sop-ghost.internal`;
                                                                                        await sbClient.from('app_users').upsert({
                                                                                            email: dummyEmail,
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
                                                                        const NOTIFICATION_MAP = {
                                                                            'novo_processo': { titulo: ' *Novo Processo*', sub: ' Cadastro Inicial' },
                                                                            'mudanca_status_processo': { titulo: ' *Mudança de Status*', sub: ' Reanálise Solicitada' },
                                                                            'novas_metas_processo': { titulo: '️ *Alerta de Atraso*', sub: ' Prazo Excedido' },
                                                                            'atualizacao_composicao': { titulo: ' *Nova Composição*', sub: ' Cadastro de Referência' },
                                                                            'atualizacao_orcamento': { titulo: ' *Atualização de Orçamento*', sub: ' Revisão de Dados' },
                                                                            'novo_comentario_orcamento': { titulo: ' *Novo Comentário*', sub: ' Revisão Técnica' },
                                                                            'atualizacao_tabelas': { titulo: ' *Atualização de Tabelas*', sub: ' Tabelas de Referência' },
                                                                            'analista_designado': { titulo: ' *Analista Designado*', sub: ' Replanilhamento' }
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
                                                                                CODIGO_COMPOSICAO: 'COMP-001',
                                                                                TABELA_NOME: 'SEINFRA 28',
                                                                                VERSAO: '028',
                                                                                MES_REFERENCIA: 'Jan/2026'
                                                                            };

                                                                            const msg = gerarMensagemAmigavel(eventoGatilho, dadosFalsos);

                                                                            Swal.fire({
                                                                                title: 'Pré-visualização (Redação Dinâmica)',
                                                                                html: `<pre style="text-align: left; background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; white-space: pre-wrap; font-size: 14px; border: 1px solid #dee2e6;">${msg}</pre>`,
                                                                                icon: 'info',
                                                                                confirmButtonText: 'Fechar Prévia'
                                                                            });
                                                                        };

                                                                        function gerarMensagemAmigavel(evento, dados) {
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

                                                                            const objetoTexto = dados.NOME_OBRA || dados.DESCRICAO || 'Obra não informada';
                                                                            const nup = dados.NUP_PROCESSO || 'Não informado';

                                                                            let linhas = [
                                                                                ` 📑*OBJETO:* ${objetoTexto}`,
                                                                                ` 📍 Aditivo de Serviços`,
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

                                                                            return `*${conf.titulo.trim()}*\n\n${saudacao}\n${conector}\n\n${linhas.join('\n')}${avisoSuite}\n\n${footer}`;
                                                                        }

                                                                        // Cache para evitar disparos duplicados (debounce)
                                                                        const lastNotificationCache = new Map();

                                                                        async function enviarMensagemIndividual(telefone, texto, nomeDestinatario = "Destinatário", eventoGatilho = "disparo_manual", dadosExtras = {}) {
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
                                                                                let logRow = null;
                                                                                try {
                                                                                    const { data, error: insertError } = await sbClient.from('whatsapp_logs').insert({
                                                                                        evento: eventoGatilho,
                                                                                        destinatario: cleanPhone,
                                                                                        destinatario_nome: nomeDestinatario,
                                                                                        mensagem: texto,
                                                                                        status: 'processando',
                                                                                        erro_detalhe: 'Iniciando disparo...',
                                                                                        // nup e objeto removidos por não existirem na tabela
                                                                                    }).select('id').single();

                                                                                    if (insertError) {
                                                                                        console.warn("[WhatsApp] Aviso ao criar log:", insertError.message);
                                                                                    }
                                                                                    logRow = data;
                                                                                } catch (e) {
                                                                                    console.warn("[WhatsApp] Erro não-crítico ao registrar log inicial:", e);
                                                                                }

                                                                                const response = await fetch(`${EVO_API_URL}/message/sendText/${EVO_INSTANCE}`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json', 'apikey': EVO_API_KEY },
                                                                                    body: JSON.stringify({
                                                                                        number: cleanPhone,
                                                                                        text: texto,
                                                                                        delay: 1200,
                                                                                        linkPreview: false
                                                                                    })
                                                                                });

                                                                                const resData = await response.json();
                                                                                const isOk = response.ok;
                                                                                const statusEnvio = isOk ? 'sucesso' : 'falha';
                                                                                const detalheErro = isOk ? `ID:${resData.key?.id || resData.id || ''}` : `Erro: ${response.status} - ${resData.response?.message || resData.error || 'Desconhecido'}`;

                                                                                if (logRow) {
                                                                                    await sbClient.from('whatsapp_logs').update({
                                                                                        status: statusEnvio,
                                                                                        erro_detalhe: detalheErro
                                                                                    }).eq('id', logRow.id);
                                                                                }

                                                                                return isOk;
                                                                            } catch (err) {
                                                                                console.error("[WhatsApp] Erro no disparo:", err);
                                                                                if (logRow && logRow.id) {
                                                                                    try {
                                                                                        await sbClient.from('whatsapp_logs').update({
                                                                                            status: 'falha',
                                                                                            erro_detalhe: `Erro de rede/API: ${err.message || String(err)}`
                                                                                        }).eq('id', logRow.id);
                                                                                    } catch (dbErr) {
                                                                                        console.warn("[WhatsApp] Não foi possível atualizar o log de erro no banco:", dbErr);
                                                                                    }
                                                                                }
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

                                                                                            let found = realUsers.find(u => {
                                                                                                const dbName = (`${u.nome || ''} ${u.sobrenome || ''}`.trim() || u.full_name || '').toUpperCase();
                                                                                                return dbName === search || dbName.includes(search) || search.includes(dbName);
                                                                                            });

                                                                                            if (!found) {
                                                                                                found = ghostUsers.find(u => {
                                                                                                    const dbName = (u.full_name || '').toUpperCase();
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
                                                                                        const mensagemUnica = gerarMensagemAmigavel(eventoGatilho, dadosDinamicos);

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
                            <td><span class="badge bg-light text-dark" style="font-size:0.6rem">${log.evento}</span></td>
                            <td class="fw-bold small text-truncate" style="max-width: 120px;">${log.destinatario_nome || '-'}</td>
                            <td class="small">${log.destinatario}</td>
                            <td class="small text-muted">${nupExibicao}</td>
                            <td class="small text-truncate" style="max-width: 150px;" title="${objetoExibicao}">${objetoExibicao}</td>
                            <td>
                                <span class="badge ${statusColor}" style="font-size:0.65rem">
                                    ${log.status.toUpperCase()}
                                </span>
                            </td>
                            <td class="text-center">
                                <div class="d-flex gap-1 justify-content-center">
                                    <button class="btn btn-xs btn-outline-danger p-0 px-1" title="Ver Detalhes do Erro"
                                        onclick="Swal.fire({
                                            title: 'Dificuldade no Envio', 
                                            html: \`<div class='text-start small'><b>O que ocorreu?</b><br><span class='text-danger'>${erroFormatado}</span><br><br><b>Destinatário:</b> ${log.destinatario_nome || 'Não identificado'}<br><b>Telefone:</b> ${log.destinatario}<br><hr><i class='text-muted'>Erro técnico: ${log.erro_detalhe || 'sem detalhes'}</i></div>\`, 
                                            icon: 'error',
                                            confirmButtonText: 'Entendido'
                                        })">
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

                                                                        async function reenviarMensagemWhatsApp(logId) {
                                                                            try {
                                                                                const { data: log, error } = await sbClient.from('whatsapp_logs').select('*').eq('id', logId).single();
                                                                                if (error || !log) throw new Error("Log não encontrado.");

                                                                                Swal.fire({
                                                                                    title: 'Reenviando...',
                                                                                    text: `Tentando para ${log.destinatario_nome || log.destinatario}`,
                                                                                    allowOutsideClick: false,
                                                                                    didOpen: () => { Swal.showLoading(); }
                                                                                });

                                                                                let targetNumber = log.destinatario;
                                                                                if (targetNumber.length === 13 && (targetNumber.startsWith('55889') || targetNumber.startsWith('55859'))) {
                                                                                    targetNumber = targetNumber.substring(0, 4) + targetNumber.substring(5);
                                                                                }

                                                                                const response = await fetch(`${EVO_API_URL}/message/sendText/${EVO_INSTANCE}`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json', 'apikey': EVO_API_KEY },
                                                                                    body: JSON.stringify({ number: targetNumber, text: log.mensagem, delay: 500, linkPreview: false })
                                                                                });

                                                                                if (response.ok) {
                                                                                    await sbClient.from('whatsapp_logs').update({
                                                                                        status: 'sucesso',
                                                                                        erro_detalhe: 'Reenviado em ' + new Date().toLocaleString()
                                                                                    }).eq('id', logId);
                                                                                    Swal.fire('Sucesso!', 'Mensagem reenviada.', 'success');
                                                                                } else {
                                                                                    const errData = await response.json();
                                                                                    throw new Error(formatarErroWhatsApp(`Erro: ${response.status} - ${errData.response?.message || errData.error || 'Erro'}`));
                                                                                }
                                                                                carregarLogsWhatsApp();
                                                                            } catch (err) {
                                                                                Swal.fire('Falha no Reenvio', err.message, 'error');
                                                                            }
                                                                        }

                                                                        async function consultarStatusWhatsApp(messageId, logId, destinatario) {
                                                                            try {
                                                                                Swal.fire({ title: 'Consultando...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
                                                                                const jid = destinatario.includes('@') ? destinatario : (destinatario + '@s.whatsapp.net');
                                                                                const response = await fetch(`${EVO_API_URL}/chat/findMessages/${EVO_INSTANCE}`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json', 'apikey': EVO_API_KEY },
                                                                                    body: JSON.stringify({ where: { id: messageId }, remoteJid: jid })
                                                                                });

                                                                                let msg = null;
                                                                                if (response.ok) {
                                                                                    const data = await response.json();
                                                                                    const messages = data.messages || (Array.isArray(data) ? data : []);
                                                                                    msg = messages.find(m => m.key?.id === messageId || m.id === messageId);
                                                                                }

                                                                                if (!msg) {
                                                                                    Swal.fire({
                                                                                        title: 'Status: Enviado',
                                                                                        html: 'A mensagem foi despachada para o WhatsApp. Se você ainda não recebeu, verifique a conexão do celular que faz os disparos.<br><br><small class="text-muted">ID: ' + messageId + '</small>',
                                                                                        icon: 'success'
                                                                                    });
                                                                                    return;
                                                                                }

                                                                                const statusMap = {
                                                                                    'PENDING': { t: 'Pendente (Aguardando Internet)', i: 'warning' },
                                                                                    'SENT': { t: 'Enviado ao Servidor (Um tique)', i: 'success' },
                                                                                    'DELIVERED': { t: 'Entregue ao Aparelho (Dois tiques)', i: 'success' },
                                                                                    'READ': { t: 'Lido pelo Destinatário (Azul)', i: 'info' }
                                                                                };

                                                                                const rawStatus = (msg.status || '').toUpperCase();
                                                                                const info = statusMap[rawStatus] || { t: 'Enviado com Sucesso', i: 'success' };

                                                                                Swal.fire({
                                                                                    title: 'Status da Mensagem',
                                                                                    html: `<b>Situação Atual:</b><br>${info.t}<br><br><small class="text-muted">Rastreador: ${messageId}</small>`,
                                                                                    icon: info.i
                                                                                });
                                                                            } catch (err) {
                                                                                console.error("Erro no status:", err);
                                                                                Swal.fire('Erro na Consulta', 'Não foi possível conectar ao rastreio.', 'error');
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

                                                                        function formatarErroWhatsApp(erroBruto) {
                                                                            if (!erroBruto) return "Erro desconhecido ou não detalhado.";

                                                                            const erro = String(erroBruto).toUpperCase();

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

                                                                        async function verificarStatusEvolution() {
                                                                            const statusText = document.getElementById('ws-status-text');
                                                                            if (!statusText) return;

                                                                            try {
                                                                                statusText.innerText = "Consultando instância...";
                                                                                const response = await fetch(`${EVO_API_URL}/instance/connectionState/${EVO_INSTANCE}`, {
                                                                                    headers: { 'apikey': EVO_API_KEY }
                                                                                });

                                                                                if (response.ok) {
                                                                                    const data = await response.json();
                                                                                    const state = data.instance?.state || 'unknown';

                                                                                    if (state === 'open') {
                                                                                        statusText.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-check-circle-fill"></i> Conectado (SOP)</span>';
                                                                                    } else if (state === 'connecting' || state === 'close') {
                                                                                        statusText.innerHTML = `<span class="text-warning fw-bold"><i class="bi bi-qr-code"></i> Instância: ${state} (Escaneie o QR)</span>`;
                                                                                    } else {
                                                                                        statusText.innerHTML = `<span class="text-warning fw-bold"><i class="bi bi-exclamation-triangle"></i> Instância: ${state}</span>`;
                                                                                    }
                                                                                } else if (response.status === 404) {
                                                                                    // Se a instância não existir, tenta criar
                                                                                    statusText.innerText = "Instância não encontrada. Tentando criar...";
                                                                                    await criarInstanciaEvolution();
                                                                                } else {
                                                                                    statusText.innerHTML = '<span class="text-danger fw-bold"><i class="bi bi-x-circle-fill"></i> Erro na API</span>';
                                                                                }
                                                                            } catch (err) {
                                                                                statusText.innerHTML = '<span class="text-danger fw-bold"><i class="bi bi-x-circle-fill"></i> API Offline</span>';
                                                                                console.error("[WhatsApp] Erro ao verificar status:", err);
                                                                            }
                                                                        }

                                                                        async function criarInstanciaEvolution() {
                                                                            try {
                                                                                const response = await fetch(`${EVO_API_URL}/instance/create`, {
                                                                                    method: 'POST',
                                                                                    headers: {
                                                                                        'Content-Type': 'application/json',
                                                                                        'apikey': EVO_API_KEY
                                                                                    },
                                                                                    body: JSON.stringify({
                                                                                        instanceName: EVO_INSTANCE,
                                                                                        token: EVO_API_KEY,
                                                                                        integration: "WHATSAPP-BAILEYS",
                                                                                        qrcode: true
                                                                                    })
                                                                                });
                                                                                if (response.ok) {
                                                                                    document.getElementById('ws-status-text').innerText = "Instância 'SOP' criada. Conecte-se agora.";
                                                                                    // Recarrega status após criar
                                                                                    setTimeout(verificarStatusEvolution, 800); // Optimized from 2000ms
                                                                                }
                                                                            } catch (e) {
                                                                                console.error("Erro ao criar instância:", e);
                                                                            }
                                                                        }

                                                                        // Inicia verificação ao carregar se estiver na aba de config
                                                                        document.addEventListener('DOMContentLoaded', () => {
                                                                            // Pequeno delay para garantir que o DOM está pronto e estilos aplicados
                                                                            setTimeout(verificarStatusEvolution, 800); // Optimized from 2000ms
                                                                        });

                                                                        window.testarConexaoWhatsApp = async function (event) {
                                                                            if (event) event.stopPropagation();

                                                                            showToast("Verificando status da instância...", "info");

                                                                            try {
                                                                                const response = await fetch(`${EVO_API_URL}/instance/connectionState/${EVO_INSTANCE}`, {
                                                                                    method: 'GET',
                                                                                    headers: { 'apikey': EVO_API_KEY }
                                                                                });

                                                                                const data = await response.json();
                                                                                console.log("[WhatsApp] Status da Instância:", data);

                                                                                const state = data.instance?.state || data.state || 'desconhecido';

                                                                                if (state === 'open') {
                                                                                    Swal.fire('Conectado!', 'A API do WhatsApp está operando normalmente.', 'success');
                                                                                } else {
                                                                                    Swal.fire('Instância: ' + state, `O estado atual é "${state}". Para que o sistema funcione, a instância deve estar "open". Verifique no painel da Evolution.`, 'warning');
                                                                                }
                                                                            } catch (e) {
                                                                                console.error(e);
                                                                                Swal.fire('Erro na Conexão', 'Não foi possível contatar o servidor da API. Verifique a URL e a API Key no código.', 'error');
                                                                            }
                                                                        };





