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

/**
 * Calcular Dias Devolução - Função faltava, adicionada
 */
function calcularDiasDevolucao() {
    try {
        const elDevolucao = document.getElementById('det_data_devolucao');
        const elBadge = document.getElementById('det_badge_dias_dev');

        if (!elDevolucao || !elBadge) {
            console.warn('[WARN] Elementos não encontrados para calcularDiasDevolucao');
            return;
        }

        const strDataDevolucao = elDevolucao.value;

        if (!strDataDevolucao) {
            elBadge.textContent = ' dias';
            return;
        }

        const dataDevolucao = isoParaDate(dataParaISO(strDataDevolucao));

        if (dataDevolucao && !isNaN(dataDevolucao)) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const devDate = new Date(dataDevolucao);
            devDate.setHours(0, 0, 0, 0);
            const dias = Math.round((hoje - devDate) / (1000 * 60 * 60 * 24));
            elBadge.textContent = dias + ' dias';
        }
    } catch (err) {
        console.error('[ERRO] calcularDiasDevolucao:', err);
    }
}

// Variáveis globais de estado
let currentCompositionData = null;


/* --------------------------------------------------------------
   OVERLAY DE BOAS-VINDAS / LOGIN (TELA INICIAL)
-------------------------------------------------------------- */

/* HTML do overlay será injetado dinamicamente para não alterar a ordem do arquivo
   (mas já podemos defini-lo aqui para facilitar alteração futura). */

// Overlay de login agora está no HTML estático (logo após <body>).
// Aqui apenas registramos os event listeners.
document.addEventListener('DOMContentLoaded', () => {

    // Toggle Logic
    const containerLogin = document.getElementById('container-login');
    const containerReg = document.getElementById('container-register');

    const btnShowReg = document.getElementById('btn-show-register');
    const btnShowLogin = document.getElementById('btn-show-login');

    if (btnShowReg) {
        btnShowReg.addEventListener('click', (e) => {
            e.preventDefault();
            containerLogin.style.display = 'none';
            containerReg.style.display = 'block';
        });
    }

    if (btnShowLogin) {
        btnShowLogin.addEventListener('click', (e) => {
            e.preventDefault();
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
        });
    }

    // Handle Login
    document.getElementById('landingLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const loginInput = document.getElementById('landing-matricula').value.trim();
        const password = document.getElementById('landing-password').value;
        const email = loginInput.includes('@') ? loginInput : `${loginInput}@gecope.app`;
        await signInWithEmail(email, password);
    });

    // Toggle Password Visibility
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const inputPassword = document.getElementById('landing-password');
    if (btnTogglePassword && inputPassword) {
        btnTogglePassword.addEventListener('click', () => {
            const type = inputPassword.getAttribute('type') === 'password' ? 'text' : 'password';
            inputPassword.setAttribute('type', type);
            const icon = btnTogglePassword.querySelector('i');
            if (icon) {
                icon.className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
            }
        });
    }

    // Handle Forgot Password
    const btnEsqueci = document.getElementById('btn-esqueci-senha');
    if (btnEsqueci) {
        btnEsqueci.addEventListener('click', async (e) => {
            e.preventDefault();
            const prefilledMatricula = document.getElementById('landing-matricula').value.trim();

            const { value: matricula } = await Swal.fire({
                title: 'Recuperar Senha',
                text: 'Informe sua matrícula cadastrada no sistema:',
                input: 'text',
                inputValue: prefilledMatricula,
                inputPlaceholder: 'Ex: 99030487',
                showCancelButton: true,
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                inputValidator: (value) => {
                    if (!value) {
                        return 'Você precisa digitar sua matrícula!';
                    }
                }
            });

            if (matricula) {
                Swal.fire({
                    title: 'Consultando...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    // Verificar se a matrícula existe na tabela app_users
                    const { data: user, error: userErr } = await sbClient
                        .from('app_users')
                        .select('id, nome, sobrenome, email')
                        .eq('matricula', matricula.trim())
                        .maybeSingle();

                    if (userErr) throw userErr;

                    if (!user) {
                        Swal.fire('Matrícula Não Encontrada', 'A matrícula informada não está cadastrada no sistema.', 'error');
                        return;
                    }

                    const nomeCompleto = `${user.nome} ${user.sobrenome || ''}`.trim().toUpperCase();

                    const { isConfirmed } = await Swal.fire({
                        title: 'Solicitar Recuperação?',
                        html: `Deseja enviar uma solicitação de recuperação de senha para <strong>${nomeCompleto}</strong>?<br><br>O administrador do GECOPE será notificado para realizar a redefinição de sua senha.`,
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonColor: 'var(--sop-green)',
                        confirmButtonText: 'Sim, enviar solicitação',
                        cancelButtonText: 'Cancelar'
                    });

                    if (isConfirmed) {
                        Swal.fire({
                            title: 'Processando...',
                            allowOutsideClick: false,
                            didOpen: () => {
                                Swal.showLoading();
                            }
                        });

                        // Criar notificação para o Admin
                        const { error: notifErr } = await sbClient.from('app_notifications').insert([{
                            type: 'new_user_request',
                            payload: JSON.stringify({
                                matricula: matricula.trim(),
                                nome: `${nomeCompleto} - RECUPERAÇÃO DE SENHA`
                            }),
                            created_at: new Date().toISOString(),
                            read: false
                        }]);

                        if (notifErr) throw notifErr;

                        const adminMessage = `Olá! Esqueci minha senha do GECOPE. Poderia redefini-la para mim? Minha matrícula é *${matricula.trim()}* e meu nome é *${nomeCompleto}*.`;
                        const encodedMessage = encodeURIComponent(adminMessage);
                        const whatsappLink = `https://api.whatsapp.com/send?phone=558599030487&text=${encodedMessage}`;

                        Swal.fire({
                            title: 'Solicitação Enviada!',
                            html: `A solicitação foi registrada no painel do administrador.<br><br>Você também pode acelerar o processo clicando no botão abaixo para enviar uma mensagem direta via WhatsApp para o Administrador.`,
                            icon: 'success',
                            showCancelButton: true,
                            confirmButtonColor: '#25D366',
                            confirmButtonText: '<i class="bi bi-whatsapp me-1"></i> Chamar no WhatsApp',
                            cancelButtonText: 'Fechar'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                window.open(whatsappLink, '_blank');
                            }
                        });
                    }
                } catch (err) {
                    console.error(err);
                    Swal.fire('Erro', 'Não foi possível processar a solicitação no momento: ' + (err.message || err), 'error');
                }
            }
        });
    }

    // Handle Register
    document.getElementById('landingRegisterForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('reg-nome').value.trim();
        const sobrenome = document.getElementById('reg-sobrenome').value.trim();
        const matricula = document.getElementById('reg-matricula').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const senha = document.getElementById('reg-senha').value;
        const elTel = document.getElementById('reg-telefone');
        const telefone = (elTel && elTel.value) ? elTel.value.replace(/\D/g, '') : null;

        const success = await signUpRequest(nome, sobrenome, matricula, senha, telefone, email);

        if (success) {
            // Retorna ao login apenas se o cadastro foi realizado com sucesso
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
            document.getElementById('landingRegisterForm').reset();
        }
    });
    // Listeners de Abas
    const tabComposicoes = document.querySelector('button[data-bs-target="#pane-composicoes"]');
    if (tabComposicoes) {
        tabComposicoes.addEventListener('shown.bs.tab', () => {
            if (typeof carregarComposicoes === 'function') carregarComposicoes();
        });
    }

    // Inicialização
    if (typeof carregarListaFiscais === 'function') carregarListaFiscais();

    // Garantir que o modal de cadastro esteja no final do body para evitar problemas de visibilidade
    try {
        const modalCadastroEl = document.getElementById('modalCadastro');
        if (modalCadastroEl && modalCadastroEl.parentElement !== document.body) {
            document.body.appendChild(modalCadastroEl);
            console.log('[INIT] modalCadastro movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalCadastro:', e); }
});



// Ensure FISCAIS_LIST exists (avoid TDZ) and Performance tweak: optionally silence verbose console logs in production
var FISCAIS_LIST = [
    'ÁGABE SOUSA',
    'ALEXANDRE HORTÊNCIO',
    'ANTÔNIO EDSON',
    'ANTÔNIO ELDER',
    'ANTÔNIO ROLIM',
    'ARTHUR EDÍSIO',
    'CARLOS RIOS',
    'CAIO TIMBÓ',
    'CLOVIS FONTENELE',
    'CRISTIANA PALÁCIO',
    'CRISTIANO GUILHERME',
    'DAVI BRAGA',
    'DAVI GADELHA',
    'DAVID MACHADO',
    'DIEGO DEMÉTRIO',
    'EDGAR PEIXOTO',
    'EDILSON JR.',
    'EDUARDO CIDRÃO',
    'EDUARDO STÊNIO',
    'EMMANUEL CRUZ',
    'FÁBIO BONFIM',
    'FLÁVIO COLARES',
    'FLEURY NAPOLEÃO',
    'FRANCISCO GOIANA',
    'FRANCISCO PARENTE',
    'FRANCISCO TALES',
    'GECOPE DIFOR',
    'GUILHERME MAIA',
    'HEBERT ALAN',
    'IGGO EMANUEL',
    'ÍTALO HENRIQUE',
    'JÉSSICA DINIZ',
    'JOHN HERBERT',
    'JOSÉ LEONÉZIO',
    'JOSÉ MICHELL',
    'JOSÉ MUNIZ',
    'JOSÉ ROSEMBERG',
    'JOSÉ WILLIAN',
    'JOSUÉ JOHAB',
    'JURANDIR VIANA',
    'JUSTINIANO CAMURÇA',
    'KENEDDY MAYK',
    'KERLON DIÓGENES',
    'LEANDRO LESSA',
    'LEONARDI',
    'LUCAS ARAÚJO',
    'LUCIANO DENIZARDY',
    'MANOEL LUCAS',
    'MÁRCIO MONTENEGRO',
    'MÁRIO EDSON',
    'MAURO JOSÉ',
    'NERTAN FONSECA',
    'NILDENO ARAGÃO',
    'ORLANDO LIMA',
    'PAULO LOIOLA',
    'ROBERTO BRINGEL',
    'ROBERTO HOLANDA',
    'ROBERTO XAVIER',
    'RUI DE PAULA',
    'SAULLO MARINHO',
    'SILVIO CAMPOS',
    'TATHIANE ANDRADE',
    'TÚLIO REZENDE',
    'VICENTE DE SOUSA',
    'VIRNA DE PAULA',
    'WEBER TEIXEIRA',
    'WESLEY PEDROSA',
    'WILSON MACHADO'
];
FISCAIS_LIST.sort((a, b) => a.localeCompare(b, 'pt-BR'));
// Ensure EVO API globals exist to avoid ReferenceError if referenced early
window.EVO_API_URL = window.EVO_API_URL || '';
window.EVO_API_KEY = window.EVO_API_KEY || '';
window.EVO_INSTANCE = window.EVO_INSTANCE || '';
// Set `IS_PROD` to false during debugging to restore console output.
(function () {
    const IS_PROD = true;
    if (IS_PROD && typeof window.console === 'object') {
        console.log = function () { };
        console.info = function () { };
    }
})();


/* --- FUNES DE DECISO CORRIGIDAS (SEM TRAVAMENTO) --- */

function abrirModalAtender(id, index) {
    const modalEl = document.getElementById('modalAtenderRevisao');

    // TRUQUE: Move o modal para o final do body para evitar conflito de z-index (Tela Escura)
    if (modalEl.parentElement !== document.body) {
        document.body.appendChild(modalEl);
    }

    document.getElementById('atender-id-orcamento').value = id;
    document.getElementById('atender-index-comentario').value = index;
    document.getElementById('formAtender').reset();

    // Usa getOrCreateInstance para evitar duplicidade
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

function abrirModalRecusar(id, index) {
    const modalEl = document.getElementById('modalRecusarRevisao');

    // TRUQUE: Move o modal para o final do body
    if (modalEl.parentElement !== document.body) {
        document.body.appendChild(modalEl);
    }

    document.getElementById('recusar-id-orcamento').value = id;
    document.getElementById('recusar-index-comentario').value = index;
    document.getElementById('formRecusar').reset();

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

// ... Mantenha as funções processarAtendimento e processarRecusa como estavam, 
// apenas certifique-se de que no processarAtendimento o status mudou para 'Atualizado':
// status: 'Atualizado'

/* --------------------------------------------------------------
   SCRIPT PRINCIPAL - CORRIGIDO (V7)
-------------------------------------------------------------- */

// CONFIGURAO DE STORAGE: Mantém logado entre abas, mas desloga ao fechar o navegador
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

// --- MÓDULO DE AUTOMAÇÃO GLOBAL (StatusSync) ---
window.StatusSync = {
    async verificarEAtualizarStatus(processoGecope, dadosSuite) {
        try {
            if (!sbClient) return { changed: false };
            const id = processoGecope.id;
            const nup = processoGecope.processo;
            const siglaSuite = String(dadosSuite.sigla || '').toUpperCase().trim();
            const prevSigla = String(dadosSuite.prevSigla || '').toUpperCase().trim() || null;
            const statusGecope = String(processoGecope.status || '').toUpperCase().trim();
            let novoStatus = null;

            // Segurança: se o processo foi criado há pouco tempo, respeitar o status definido no GECOPE
            try {
                const criado = processoGecope && processoGecope.created_at ? new Date(processoGecope.created_at) : null;
                if (criado) {
                    const agora = new Date();
                    const diff = agora.getTime() - criado.getTime();
                    // Se criado nos últimos 3 minutos, não aplicar mudanças automáticas
                    if (diff >= 0 && diff < (3 * 60 * 1000)) {
                        return { changed: false, reason: 'recently_created' };
                    }
                }
            } catch (e) { /* noop */ }

            const suiteGecope = String(processoGecope.suite || '').toUpperCase().trim();
            const analista = String(processoGecope.analista || '').trim().toUpperCase();
            const isAnalistaEspecial = ["N", "W", "H", "P", "F"].includes(analista) || 
                                       ["N", "W", "H", "P", "F"].includes(analista.charAt(0));
            const historico = dadosSuite.historico || [];

            // REGRA 2: ARQUIVAMENTO (Prioridade Máxima)
            if (siglaSuite === 'ARQUIVADO') {
                novoStatus = 'ARQUIVADO';
            }
            // REGRA 1
            else if (statusGecope === 'AGUAR. APROVAÇÃO' && 
                     (suiteGecope === 'DIFOR' || suiteGecope === 'GECOPE') && 
                     isAnalistaEspecial && 
                     (siglaSuite !== 'DIFOR' && siglaSuite !== 'GECOPE')) {
                novoStatus = 'APROVADO';
            }
            // REGRA 3
            else if ((statusGecope === 'REANÁLISE FISCAL' || statusGecope === 'DEVOLVIDO P/ REANÁLISE FISCAL') && 
                     suiteGecope !== 'GECOPE' && 
                     isAnalistaEspecial && 
                     siglaSuite === 'GECOPE') {
                novoStatus = 'AGUAR. REANÁLISE';
            }
            // REGRA 4
            else if (statusGecope === 'ANÁLISE FISCAL' && 
                     !isAnalistaEspecial && 
                     suiteGecope !== 'GECOPE' &&
                     siglaSuite === 'GECOPE') {
                novoStatus = 'AGUAR. ANÁLISE';
            }

            if (novoStatus && novoStatus !== statusGecope) {
                const payload = {
                    status: novoStatus,
                    ultima_atualizacao: new Date().toISOString(),
                    atualizado_por: 'AUTOMAÇÃO SUITE'
                };
                let query = sbClient.from('processos').update(payload);
                if (id) query = query.eq('id', id); else query = query.eq('processo', nup);

                const { data, error } = await query.select('id, status');
                if (error) {
                    console.error("[StatusSync] ERRO DETALHADO:", error.message);
                    return { changed: false, error: error.message };
                }
                return { changed: !!(data && data.length), data: data ? data[0] : null };
            }
            return { changed: false };
        } catch (e) { console.error("[StatusSync] Erro:", e); return { changed: false, error: e }; }
    }
};

// NOTE: Supabase client initialization moved to database.js (loaded before main.js)

window.dynamicUsers = [];

async function carregarListaFiscais() {
    try {
        const { data } = await sbClient.from('app_users').select('nome, sobrenome, full_name');
        let dbUsers = [];
        if (data) {
            dbUsers = data.map(u => (u.full_name || `${u.nome || ''} ${u.sobrenome || ''}`).trim().toUpperCase()).filter(n => n);
        }
        
        // Mescla a lista estática original com os cadastros do banco para robustez máxima
        const combined = [...new Set([...FISCAIS_LIST, ...dbUsers])];
        
        // Ordenação alfabética robusta que lida com caracteres latinos e acentuações do português
        combined.sort((a, b) => a.localeCompare(b, 'pt-BR'));
        
        window.dynamicUsers = combined;
        FISCAIS_LIST = combined;
        atualizarDropdownsFiscais();
    } catch(e) {
        console.error('Erro carregarListaFiscais:', e);
    }
}

// --- 1. MÁSCARA PROCESSO ---
function mascaraProcesso(val) {
    val = val.replace(/\D/g, '');
    val = val.replace(/^(\d{5})(\d)/, '$1.$2');
    val = val.replace(/^(\d{5})\.(\d{6})(\d)/, '$1.$2/$3');
    val = val.replace(/^(\d{5})\.(\d{6})\/(\d{4})(\d)/, '$1.$2/$3-$4');
    if (val.length > 20) val = val.substring(0, 20);
    return val;
}

// --- SANITIZAR NOME DE ARQUIVO ---
function sanitizarNomeArquivo(nomeArquivo) {
    // Remove caracteres especiais, acentuação e espaços
    let nome = nomeArquivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Substitui espaços por underscore
    nome = nome.replace(/\s+/g, '_');
    // Remove caracteres especiais perigosos
    nome = nome.replace(/[^a-zA-Z0-9._-]/g, '');
    return nome;
}

// --- EXTRAIR PATH DO STORAGE DA URL ---
function extrairPathDoStorage(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        // Remove o domínio e o path base, ficando apenas o caminho relativo
        const path = urlObj.pathname.replace('/storage/v1/object/public/', '');
        return path;
    } catch (e) {
        console.error('Erro ao extrair path:', e);
        return null;
    }
}

// --- LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS ---
async function limparArquivosComentariosResolvidos(table, storageBucket, comentarios) {
    if (!comentarios || !Array.isArray(comentarios)) return;

    const arquivosParaDeletar = [];

    for (const comentario of comentarios) {
        // Só deleta arquivos de comentários que foram resolvidos (atendidos ou recusados)
        if (comentario.arquivo && (comentario.decisao === 'atendido' || comentario.decisao === 'recusado')) {
            const path = extrairPathDoStorage(comentario.arquivo);
            if (path) {
                arquivosParaDeletar.push(path);
            }
        }
    }

    if (arquivosParaDeletar.length > 0) {
        try {
            console.log(`Deletando ${arquivosParaDeletar.length} arquivos de comentários resolvidos...`);
            const { error } = await sbClient.storage.from(storageBucket).remove(arquivosParaDeletar);
            if (error) {
                console.error('Erro ao deletar arquivos:', error);
            } else {
                console.log('Arquivos deletados com sucesso');
            }
        } catch (err) {
            console.error('Erro ao limpar arquivos:', err);
        }
    }
}

// --- LISTENERS GLOBAIS REMOVIDOS (CONSOLIDADO NO DOMCONTENTLOADED) ---

function atualizarDropdownsFiscais() {
    // Atualiza apenas dropdowns estáticos que precisam ser populados logo após o carregamento
    // Modais como 'share-user-select' ou 'coment-fiscal' são populados ao abrir, usando a FISCAIS_LIST atualizada
    const ids = ['cad-fiscal', 'det_fiscal'];

    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            const valAtual = sel.value;
            // Limpa mantendo a primeira opção (Selecione...)
            const firstOpt = sel.options[0];
            sel.innerHTML = '';
            if (firstOpt) sel.appendChild(firstOpt);

            FISCAIS_LIST.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f; opt.textContent = f; sel.appendChild(opt);
            });

            if (valAtual && Array.from(sel.options).some(o => o.value === valAtual)) {
                sel.value = valAtual;
            }
        }
    });
}

// --- FUNO: ENCONTRAR FISCAL NA LISTA (MATCHING INTELIGENTE) ---
function findFiscalNameInList(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return null;

    const normalizar = (str) => {
        return str
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove acentos
            .replace(/[\s\.\-]+/g, ' '); // Normaliza espaços e hífens
    };

    const inputNormal = normalizar(nomeCompleto);

    // 1. Procura exata (depois de normalizar)
    for (const fiscal of FISCAIS_LIST) {
        if (normalizar(fiscal) === inputNormal) {
            console.log('[MATCH-1 EXATO]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 2. Procura por partes: todos os nomes do input devem estar no fiscal
    const partes = inputNormal.split(/\s+/).filter(p => p.length > 0);
    for (const fiscal of FISCAIS_LIST) {
        const fiscalNormal = normalizar(fiscal);
        if (partes.every(parte => fiscalNormal.includes(parte))) {
            console.log('[MATCH-2 PALAVRAS]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 3. Procura reversa: todos os nomes do fiscal devem estar no input
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        const partesFiscal = fiscalNormal.split(/\s+/).filter(p => p.length > 0);
        if (partesFiscal.every(parte => inputNormal.includes(parte))) {
            console.log('[MATCH-3 REVERSO]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 4. Procura por iniciais: se o input começa com as iniciais do fiscal
    const iniciaisInput = partes.map(p => p[0]).join('');
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        const partesFiscal = fiscalNormal.split(/\s+/).filter(p => p.length > 0);
        const iniciaisFiscal = partesFiscal.map(p => p[0]).join('');
        if (iniciaisInput === iniciaisFiscal && inputNormal.length < fiscalNormal.length) {
            console.log('[MATCH-4 INICIAIS]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    console.log('[SEM MATCH]', nomeCompleto);
    return null;
}

window.allData = window.allData || [];
let currentTabelaData = []; // Cache para recálculo de BDI/Desconto

// --- 2. FUNES UTILITÁRIAS DE FORMATAO ---

function dataParaISO(strData) {
    if (!strData) return null;
    if (strData.match(/^\d{4}-\d{2}-\d{2}$/)) return strData;
    const partes = strData.split('/');
    if (partes.length === 3) return `${partes[2]}-${partes[1]}-${partes[0]}`;
    return null;
}

/**
 * [FIX-ALTO] Converte string de moeda (BRL) para número
 * Suporta múltiplos formatos: 'R$ 1.234,56', '1.234,56', '1234.56'
 */
function moedaParaNumero(strValor) {
    if (!strValor && strValor !== 0) return 0;
    if (typeof strValor === 'number') {
        return isFinite(strValor) ? strValor : 0;
    }
    let limpo = strValor.toString().trim().replace(/R\$|\s+/g, '');
    if (!limpo) return 0;
    if (limpo.includes(',')) {
        limpo = limpo.replace(/\./g, '').replace(',', '.');
    }
    const resultado = parseFloat(limpo);
    return isFinite(resultado) ? resultado : 0;
}

function isoParaDate(isoStr) {
    if (!isoStr) return null;
    if (isoStr instanceof Date) return isNaN(isoStr.getTime()) ? null : isoStr;
    if (typeof isoStr !== 'string') {
        const d = new Date(isoStr);
        return isNaN(d.getTime()) ? null : d;
    }
    // Força o horário local para evitar problemas de fuso horário (UTC vs Local)
    const d = isoStr.includes('T') ? new Date(isoStr) : new Date(isoStr + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Retorna lista de feriados nacionais (Pode ser expandido para consulta em DB)
 */
function getFeriados(ano) {
    const feriados = [
        "01-01", // Confraternização Universal
        "04-21", // Tiradentes
        "05-01", // Dia do Trabalho
        "09-07", // Independência
        "10-12", // Padroeira do Brasil
        "11-02", // Finados
        "11-15", // Proclamação da República
        "11-20", // Consciência Negra
        "12-25", // Natal
        // Feriados Estaduais / Específicos (Ceará)
        "03-19", // São José
        "03-25", // Data Magna do Ceará
        "02-17", // Carnaval
        "02-18", // Carnaval
        "06-04", // Corpus Christi
        "10-28", // Servidor Público
    ];
    return feriados.map(f => `${ano}-${f}`);
}

/**
 * Retorna o próximo dia útil a partir de uma data (inclusive a própria data se for útil)
 */
function obterProximoDiaUtil(data) {
    let d = new Date(data);
    let tentativa = 0;
    while (tentativa < 15) { // Segurança contra loop infinito
        const diaSemana = d.getDay(); // 0=Dom, 6=Sab
        const dataFormatada = d.toISOString().substring(5, 10);
        const feriados = getFeriados(d.getFullYear());
        const ehFeriado = feriados.some(f => f.endsWith(dataFormatada));

        if (diaSemana === 0 || diaSemana === 6 || ehFeriado) {
            d.setDate(d.getDate() + 1);
        } else {
            return d;
        }
        tentativa++;
    }
    return d;
}

/**
 * Soma dias úteis a uma data, pulando fins de semana e feriados
 */
function somarDiasUteis(data, dias) {
    let d = new Date(data);
    let cont = 0;
    let seguranca = 0;
    while (cont < dias && seguranca < 100) {
        d.setDate(d.getDate() + 1);
        const diaSemana = d.getDay();
        const dataFormatada = d.toISOString().substring(5, 10);
        const feriados = getFeriados(d.getFullYear());
        const ehFeriado = feriados.some(f => f.endsWith(dataFormatada));

        if (diaSemana !== 0 && diaSemana !== 6 && !ehFeriado) {
            cont++;
        }
        seguranca++;
    }
    return d;
}

/**
 * Calcula a Data Meta somando 20 dias CORRIDOS a partir do PRÓXIMO dia útil do registro.
 * Se a data final cair em final de semana ou feriado, será prorrogada para o próximo dia útil.
 */
function calcularDataMeta(dataBase, diasParaSoma = 20) {
    if (!dataBase) return null;
    let data = (dataBase instanceof Date) ? new Date(dataBase) : new Date(dataBase);

    // Inicia a contagem no próximo dia útil após a dataBase
    let amanha = new Date(data);
    amanha.setDate(amanha.getDate() + 1);
    let dataInicioContagem = obterProximoDiaUtil(amanha);

    // Soma exatamente 'diasParaSoma' dias úteis começando em dataInicioContagem
    // Como 'somarDiasUteis' avança a partir da data fornecida, para contar
    // dataInicioContagem como dia 1, somamos (diasParaSoma - 1)
    const diasASomar = Math.max(0, diasParaSoma - 1);
    return somarDiasUteis(dataInicioContagem, diasASomar);
}

function dateParaInput(dateObj) {
    if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj)) return "";
    return dateObj.toLocaleDateString('pt-BR');
}

function formatCompact(num) {
    if (num === null || num === undefined) return 'R$ 0,00';
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercentage(num) {
    if (num === null || num === undefined || !isFinite(num)) return '';
    return num.toFixed(1).replace('.', ',') + '%';
}

function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

function escapeHTML(str) { const s = String(str || ''); return s.replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

/**
 * Calcula de forma inteligente quantos dias o processo está no status atual.
 * Considera heurística de transição para dados legados (anteriores a 30/04/2026).
 */
function calcularDiasNoStatus(d) {
    if (!d) return 0;
    const getSafeDate = (val) => {
        if (val instanceof Date && !isNaN(val.getTime())) return val;
        if (!val) return null;
        const dateObj = new Date(val);
        return isNaN(dateObj.getTime()) ? null : dateObj;
    };

    let dStatus = getSafeDate(d.ultima_atualizacao) || getSafeDate(d.created_at) || new Date();
    const stNormalizado = (d.status || "").toString().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const ehFluxoAnalise = stNormalizado.includes("ANALISE") || stNormalizado.includes("AGUAR") || stNormalizado.includes("EM REANALISE") || stNormalizado.includes("FISCAL");

    if (ehFluxoAnalise) {
        const dEntrada = d.dataRecebimento || d.dataAbertura;
        const dataCorte = new Date('2026-04-30T00:00:00');
        if (dStatus < dataCorte && dEntrada && dEntrada instanceof Date && dEntrada.getTime() < dStatus.getTime()) {
            dStatus = dEntrada;
        }
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0); const dataRef = new Date(dStatus); dataRef.setHours(0, 0, 0, 0); return Math.round((hoje - dataRef) / (1000 * 60 * 60 * 24));
}

function sum(rows, fn) { return rows.reduce((acc, it) => { const v = fn(it); return acc + (isFiniteNumber(v) ? v : 0); }, 0); }
function formatStatusDisplay(status) {
    if (status === "DEVOLVIDO P/ REANÁLISE FISCAL") return "REANÁLISE FISCAL";
    return status;
}


// --- FUNO DEBOUNCE (PERFORMANCE) ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// --- 3. CORE: CARREGAMENTO DE DADOS (READ) ---
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
            query = query.or(`tipo.neq.PROCESSO,fiscal.eq.${userName}`);
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
                                            <div class="fw-semibold" style="font-size: 0.95rem;">${at.usuario} ${at.descricao}</div>
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
            query = query.or(`tipo.neq.PROCESSO,fiscal.eq.${userName}`);
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

            return `
                                <div class="activity-item">
                                    <div class="activity-icon-box">
                                        <i class="bi ${iconClass} fs-5"></i>
                                    </div>
                                    <div class="activity-content">
                                        <span class="activity-time">${timeLabel}</span>
                                        <div class="activity-desc"><strong>${at.usuario}</strong> ${at.descricao}</div>
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

async function carregarDadosSupabase() {
    const loader = document.getElementById("load-error");
    if (loader) loader.style.display = "none";

    let data = null, error = null;
    try {
        console.log('[DEBUG] Iniciando carregarDadosSupabase...');
        const response = await sbClient
            .from('processos')
            .select('*')
            .order('created_at', { ascending: false });

        data = response.data;
        error = response.error;

        if (error) throw new Error(`Tabela "processos" não acessível: ${error.message}`);
        if (!Array.isArray(data)) throw new Error('Tipo de dados inválido: esperado array');

        if (data.length > 0) {
            data = data.filter(d => d.status !== 'EXCLUÍDO' && d.status !== 'EXCLUIDO');
        }
    } catch (err) {
        console.error('[ERRO] Falha ao carregar dados:', err);
        if (loader) {
            loader.style.display = "block";
            loader.innerHTML = `<strong>Erro ao carregar dados:</strong><br><code>${err.message}</code>`;
        }
        return;
    }

    const userRole = (sessionStorage.getItem('sop_role') || 'guest').toString().trim().toLowerCase();
    const userEmail = sessionStorage.getItem('sop_user');
    const isFiscal = userRole === 'fiscal';

    if (isFiscal && userEmail) {
        try {
            let fiscalName = null;
            const { data: userData, error: userError } = await sbClient
                .from('app_users')
                .select('nome, sobrenome')
                .eq('email', userEmail)
                .single();

            if (!userError && userData && userData.nome) {
                fiscalName = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim().toUpperCase();
            }

            if (!fiscalName) {
                const namePart = userEmail.split('@')[0];
                fiscalName = namePart.replace(/\./g, ' ').toUpperCase();
            }

            sessionStorage.setItem('sop_fiscal_name', fiscalName);
        } catch (e) {
            console.error('Erro ao identificar nome do fiscal:', e);
        }
    }

    if (!Array.isArray(data)) return;

    window.allData = data.map(r => {
        const dataAbertura = isoParaDate(r.data_abertura);
        const dataAprov = isoParaDate(r.data_aprovacao_gecope);
        let prazoDias = null;
        if (dataAbertura && dataAprov) {
            prazoDias = Math.round((dataAprov - dataAbertura) / (1000 * 60 * 60 * 24));
        }

        let nomeAnalista = r.analista;
        if (r.analista === "N") nomeAnalista = "Nildeno";
        else if (r.analista === "W") nomeAnalista = "Walace";

        const obj = {
            id: r.id,
            processo: r.processo,
            status: r.status || "Não informado",
            tipo: r.tipo || "Não informado",
            descricao: r.descricao || "",
            fiscal: r.fiscal || "Não informado",
            contratada: r.contratada || "Não informado",
            contratante: r.contratante || "Não informado",
            analista: r.analista,
            nomeAnalista: nomeAnalista,
            dataAbertura: dataAbertura,
            anoAbertura: dataAbertura ? dataAbertura.getFullYear() : null,
            mesAbertura: dataAbertura ? (dataAbertura.getMonth() + 1) : null,
            dataRecebimento: isoParaDate(r.data_recebimento),
            dataCompromissoFiscal: isoParaDate(r.data_compromisso_fiscal),
            dataAprovacao: dataAprov,
            dataDevolucaoCorrecoes: isoParaDate(r.data_devolucao_correcoes),
            prazoDias: prazoDias,
            acrescFiscal: Number(r.acresc_fiscal) || 0,
            supressFiscal: Number(r.supress_fiscal) || 0,
            repercFiscal: Number(r.reperc_fiscal) || 0,
            acrescGecope: Number(r.acresc_gecope) || 0,
            supressGecope: Number(r.supress_gecope) || 0,
            repercGecope: Number(r.reperc_gecope) || 0,
            prioritario: r.prioritario || false,
            avisoAtrasoEnviado: r.aviso_atraso_enviado || false,
            criador: r.criador,
            created_at: isoParaDate(r.created_at),
            atualizado_por: r.atualizado_por,
            ultima_atualizacao: isoParaDate(r.ultima_atualizacao),
            excluido_por: r.excluido_por,
            data_exclusao: r.data_exclusao
        };

        // Garantir que metas locais obsoletas sejam removidas
        try {
            const key = `meta:${r.processo}`;
            const st = (r.status || "").toString().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isAnaliseFiscal = st.includes("FISCAL") && st.includes("ANALIS");

            // Se o banco não tem meta ou o status atual não é Análise Fiscal,
            // removemos qualquer meta armazenada localmente para evitar persistência indevida.
            if (!r.data_compromisso_fiscal || !isAnaliseFiscal) {
                localStorage.removeItem(key);
                // sincroniza também o objeto em memória
                obj.dataCompromissoFiscal = null;
            }
        } catch (e) { /* noop */ }

        return obj;
    });

    // window.allData já foi atualizado acima; não é necessário reatribuir
    /* window.allData já foi atualizado acima */

    try {
        // Auto-estabelecer metas para processos em 'ANÁLISE FISCAL' sem meta
        try {
            const pendingMeta = [];
            for (const row of window.allData) {
                const st = (row.status || "").toString().toUpperCase();
                const isAnaliseFiscal = st.includes("ANÁLISE FISCAL") || (st.includes("ANALISE") && st.includes("FISCAL"));
                const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                let precisaRecalcular = false;
                if (isAnaliseFiscal && row.id) {
                    let base = null;
                    let dias = 20; // padrão para Análise
                    if (isReanalise) {
                        dias = 10;
                        base = row.dataDevolucaoCorrecoes || row.created_at || new Date();
                    } else {
                        dias = 20;
                        base = row.created_at || new Date();
                    }
                    
                    const metaDate = calcularDataMeta(base, dias);
                    if (metaDate) {
                        const isoMeta = metaDate.toISOString().substring(0, 10);
                        
                        // Se não tem meta, ou se a meta salva é diferente da calculada com as novas regras
                        const isoAtual = row.dataCompromissoFiscal ? (row.dataCompromissoFiscal instanceof Date ? row.dataCompromissoFiscal.toISOString().substring(0, 10) : new Date(row.dataCompromissoFiscal).toISOString().substring(0, 10)) : null;
                        
                        if (isoAtual !== isoMeta) {
                            precisaRecalcular = true;
                        }
                    }
                }

                if (precisaRecalcular) {
                    let base = null;
                    let dias = 20; // padrão para Análise
                    if (isReanalise) {
                        // Regra de Reanálise: Usar data de devolução para correção no cálculo da nova meta
                        dias = 10;
                        base = row.dataDevolucaoCorrecoes || row.created_at || new Date();
                    } else {
                        // Regra de Cadastro: Usar a data de cadastro no GECOPE (created_at)
                        dias = 20;
                        base = row.created_at || new Date();
                    }
                    const metaDate = calcularDataMeta(base, dias);
                    if (metaDate) {
                        const iso = metaDate.toISOString().substring(0, 10);
                        // Atualiza objeto em memória para UI imediata
                        row.dataCompromissoFiscal = isoParaDate(iso);
                        const baseDate = base instanceof Date ? base : new Date(base);
                        const est = baseDate.toISOString().substring(0, 10);
                        pendingMeta.push({ id: row.id, data_compromisso_fiscal: iso, registros: est });
                    }
                }
            }
            if (pendingMeta.length > 0) {
                // Persistir no banco (em paralelo)
                await Promise.all(pendingMeta.map(u => sbClient.from('processos').update({ data_compromisso_fiscal: u.data_compromisso_fiscal }).eq('id', u.id)));
                console.log(`[AutoMeta] metas automáticas salvas: ${pendingMeta.length}`);

                // Gravar histórico de metas em lote
                try {
                    const logs = pendingMeta.map(u => {
                        const row = window.allData.find(r => r.id === u.id);
                        const st = row ? (row.status || "").toString().toUpperCase() : "";
                        const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                        return {
                            processo_id: u.id,
                            registros: u.registros || u.data_estabelecimento,
                            dias_estipulados: isReanalise ? 10 : 20,
                            meta: u.data_compromisso_fiscal,
                            autor: 'Sistema'
                        };
                    });
                    await sbClient.from('historico_metas').insert(logs);
                } catch (errBatch) {
                    console.error('[AutoMeta] falha ao registrar lote no historico_metas:', errBatch);
                }
            }
        } catch (e) {
            console.error('[AutoMeta] falha ao estabelecer metas automáticas:', e);
        }

        populateAllTabFilters();
        renderLastUpdate();
        updateDashboard();
        clearFinanceiro();
        clearGerencial();
        clearPrazos();
        updateFinanceiro();
        if (typeof carregarAtividadesResumoHome === 'function') carregarAtividadesResumoHome();
    } catch (e) {
        console.error('Erro ao atualizar UI:', e);
    }
}

// --- 4. CORE: SALVAR NOVO PROCESSO (CREATE) ---
async function enviarParaPlanilha() {
    const form = document.getElementById('formCadastro');
    const btn = document.getElementById('btn-salvar');
    const msg = document.getElementById('msg-feedback');

    if (!form.checkValidity()) { form.reportValidity(); return; }

    const formData = new FormData(form);

    // Validações obrigatórias adicionais (campos essenciais)
    const requiredFields = [
        { key: 'PROCESSO N.', label: 'Número do Processo' },
        { key: 'STATUS', label: 'Status Inicial' },
        { key: 'TIPO', label: 'Tipologia' },
        { key: 'FISCAL', label: 'Fiscal Responsável' },
        { key: 'DESCRIÇÃO', label: 'Descrição do Objeto' },
        { key: 'CONTRATANTE', label: 'Contratante' },
        { key: 'CONTRATADA', label: 'Contratada' },
        { key: 'DATA DE ABERTURA', label: 'Data de Abertura' }
    ];

    for (const f of requiredFields) {
        const v = formData.get(f.key);
        if (!v || (typeof v === 'string' && v.trim() === '')) {
            alert(`Campo obrigatório: ${f.label}`);
            return;
        }
    }
    const numProcessoRaw = formData.get("PROCESSO N.");
    const numProcesso = numProcessoRaw ? numProcessoRaw.trim() : "";

    // 1. Validação de Formato Rigorosa (00000.000000/0000-00)
    const formatRegex = /^\d{5}\.\d{6}\/\d{4}-\d{2}$/;
    if (!formatRegex.test(numProcesso)) {
        alert("Formato inválido!\nO número deve seguir estritamente o padrão: 00000.000000/0000-00");
        return;
    }

    // 2. Verificação Local (Feedback Instantâneo)
    // Usando .trim() para evitar que falhas passadas (espaços no banco) mascarem duplicidade
    const numProcessoLimpo = numProcesso.replace(/\s+/g, "");
    const existeLocal = (window.allData || []).some(d => (d.processo || "").replace(/\s+/g, "") === numProcessoLimpo);
    if (existeLocal) {
        alert("Este número de processo já consta na lista local.");
        return;
    }

    // Salva texto/estado do botão
    btn.disabled = true;
    const btnTextoOriginal = btn.innerText;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> VERIFICANDO...';

    // 3. Verificação no Servidor (Garantia de Unicidade)
    try {
        const { data: dbCheck, error: checkError } = await sbClient
            .from('processos')
            .select('id')
            .like('processo', `${numProcesso}%`)
            .limit(1)
            .maybeSingle();

        if (checkError) {
            throw checkError; // Joga para o catch
        }

        if (dbCheck) {
            alert("ERRO CRÍTICO: Este processo já existe no banco de dados.");
            btn.disabled = false;
            btn.innerHTML = btnTextoOriginal;
            return;
        }

    } catch (err) {
        console.error("Erro ao verificar duplicidade:", err);
        alert("Erro de conexão/verificação. Tente novamente.");
        btn.disabled = false;
        btn.innerHTML = btnTextoOriginal;
        return;
    }

    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> SALVANDO...';

    const safeVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

    const payload = {
        processo: numProcesso,
        tipo: formData.get("TIPO"),
        status: formData.get("STATUS"),
        descricao: formData.get("DESCRIÇÃO"),
        contratante: formData.get("CONTRATANTE"),
        contratada: formData.get("CONTRATADA"),
        fiscal: formData.get("FISCAL"),
        analista: formData.get("ANALISTA"),

        data_abertura: dataParaISO(formData.get("DATA DE ABERTURA")),
        data_recebimento: dataParaISO(formData.get("DATA RECEBIMENTO")),
        data_compromisso_fiscal: dataParaISO(formData.get("DATA COMPROMISSO FISCAL")),

        acresc_fiscal: parseMoneyInput(safeVal('acresc_fisc')),
        supress_fiscal: parseMoneyInput(safeVal('supress_fisc')),
        reperc_fiscal: parseMoneyInput(safeVal('reperc_fisc')),
        acresc_gecope: parseMoneyInput(safeVal('acresc_gec')),
        supress_gecope: parseMoneyInput(safeVal('supress_gec')),
        reperc_gecope: parseMoneyInput(safeVal('reperc_gec')),

        // Audit: Criação
        criador: sessionStorage.getItem('sop_user_name') || 'Sistema',
        ultima_atualizacao: new Date().toISOString()
    };

    // Nota: meta será estabelecida a partir do created_at retornado pelo banco
    // (ou data_devolucao_correcoes para reanálises). Não definimos meta antes do insert
    // para garantir que a base usada seja a data de cadastro persistida.

    let data = null; let error = null;
    try {
        if (!window.sbClient) throw new Error('Supabase client não inicializado');
        const res = await sbClient.from('processos').insert([payload]);
        data = res.data; error = res.error;
    } catch (e) {
        console.error('Erro ao inserir processo:', e);
        msg.style.display = 'block';
        msg.className = 'alert alert-danger mt-3';
        msg.innerHTML = `Erro ao salvar: ${e.message || e}`;
        btn.disabled = false;
        btn.innerHTML = 'SALVAR';
        return;
    }

    if (error) {
        console.error(error);
        msg.style.display = 'block';
        msg.className = 'alert alert-danger mt-3';
        msg.innerHTML = `Erro ao salvar: ${error.message}`;
        btn.disabled = false;
        btn.innerHTML = 'SALVAR';
    } else {
        msg.style.display = 'block';
        msg.className = 'alert alert-success mt-3';
        msg.innerHTML = ' Salvo com sucesso no Banco de Dados!';

        // Após inserir, calcular a meta a partir do created_at (ou data_devolucao_correcoes para reanálises)
        (async () => {
            try {
                const { data: pData, error: errP } = await sbClient.from('processos').select('id, data_devolucao_correcoes, created_at, status').eq('processo', numProcesso).maybeSingle();
                if (errP) throw errP;
                if (pData && pData.id) {
                    const st = (pData.status || '').toString().toUpperCase();
                    const isReanalise = st.includes('REANÁLISE') || st.includes('REANALISE') || st.includes('DEVOLVIDO');
                    const dias = isReanalise ? 10 : 20;
                    const baseStr = (isReanalise && pData.data_devolucao_correcoes) ? pData.data_devolucao_correcoes : pData.created_at;
                    const baseDate = baseStr ? isoParaDate(baseStr) : new Date();
                    const metaDate = calcularDataMeta(baseDate, dias);
                    if (metaDate) {
                        const iso = metaDate.toISOString().substring(0,10);
                        // Atualiza processo com a meta correta calculada a partir do created_at
                        const { error: errUp } = await sbClient.from('processos').update({ data_compromisso_fiscal: iso }).eq('id', pData.id);
                        if (errUp) console.error('[ERRO] Falha ao atualizar processo com meta calculada:', errUp.message);

                        // Inserir histórico de metas registrando o 'registro' (data da base) e dias
                        const est = baseDate.toISOString().substring(0,10);
                        const { error: errHist } = await sbClient.from('historico_metas').insert([{
                            processo_id: pData.id,
                            registros: est,
                            dias_estipulados: dias,
                            meta: iso,
                            autor: 'Sistema'
                        }]);
                        if (errHist) console.error('[ERRO] Falha ao registrar log de meta inicial:', errHist.message);
                    }
                }
            } catch (e) {
                console.error('[ERRO] Ao calcular/gravar meta pós-inserção:', e);
            }
        })();
        

        // Log de Atividade
        registrarAtividade('PROCESSO', `cadastrou o processo Nº ${numProcesso}`, numProcesso, formData.get("DESCRIÇÃO"), formData.get("FISCAL"));

        // Notificação WhatsApp (Apenas se entrar em Análise Fiscal)
        const statusInicial = formData.get("STATUS");
        if (statusInicial === 'ANÁLISE FISCAL') {
            const metaFormatada = payload.data_compromisso_fiscal ? payload.data_compromisso_fiscal.split('-').reverse().join('/') : 'Não definida';
            processarNotificacao('novo_processo', {
                NOME_FISCAL: formData.get("FISCAL") || 'Fiscal',
                NUP_PROCESSO: numProcesso,
                NOME_OBRA: formData.get("DESCRIÇÃO") || 'Obra não informada',
                DATA_META: metaFormatada
            });
        }

        // Notificação para Analistas Específicos
        const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO'];

        let analistaExtenso = formData.get("ANALISTA") || "";
        if (analistaExtenso === "N") analistaExtenso = "Nildeno";
        else if (analistaExtenso === "W") analistaExtenso = "Walace";
        else if (analistaExtenso === "P") analistaExtenso = "Pedro";
        else if (analistaExtenso === "F") analistaExtenso = "Felipe";
        else if (analistaExtenso === "H") analistaExtenso = "Helder";

        const analistaNome = analistaExtenso.toUpperCase();
        const usuarioAtual = (sessionStorage.getItem('sop_user_name') || "").toUpperCase();

        // Dispara se for um dos alvos e não for auto-atribuição
        if (analistasAlvo.some(alvo => analistaNome.includes(alvo))) {
            const ehAutoAtribuicao = usuarioAtual && (analistaNome.includes(usuarioAtual) || usuarioAtual.includes(analistaNome));

            if (!ehAutoAtribuicao) {
                processarNotificacao('analista_designado', {
                    ANALISTA: analistaNome,
                    NUP_PROCESSO: numProcesso,
                    NOME_OBRA: formData.get("DESCRIÇÃO") || 'Obra não informada',
                    NOVO_STATUS: 'Em Análise'
                });
            }
        }

        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalCadastro'));
            if (modal) modal.hide();
            form.reset();
            msg.style.display = 'none';
            btn.disabled = false;
            btn.innerHTML = 'SALVAR';
            carregarDadosSupabase();
        }, 1500);
    }
}

// --- 5. CORE: DETALHES, ATUALIZAR E EXCLUIR ---
async function abrirDetalhes(processoStr) {
    // garante que a role local esteja atualizada com o servidor
    await refreshUserRole();
    const row = (window.allData || []).find(d => d.processo === processoStr);
    if (!row) { alert("Erro: Dados não encontrados na memória."); return; }

    document.getElementById('det_processo').value = row.processo;
    document.getElementById('det_tipo').value = row.tipo;
    document.getElementById('det_status').value = row.status;
    document.getElementById('det_descricao').value = row.descricao;
    document.getElementById('det_contratante').value = row.contratante;
    document.getElementById('det_contratada').value = row.contratada;

    const selFiscal = document.getElementById('det_fiscal');
    if (selFiscal.options.length <= 1) {
        FISCAIS_LIST.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = f; selFiscal.appendChild(opt);
        });
    }
    selFiscal.value = row.fiscal;

    document.getElementById('det_data_abertura').value = dateParaInput(row.dataAbertura);
    document.getElementById('det_data_compromisso').value = dateParaInput(row.dataCompromissoFiscal);
    document.getElementById('det_data_aprovacao').value = dateParaInput(row.dataAprovacao);
    if (document.getElementById('det_data_recebimento')) document.getElementById('det_data_recebimento').value = dateParaInput(row.dataRecebimento);
    if (document.getElementById('det_analista')) document.getElementById('det_analista').value = row.analista;

    const elDevolucao = document.getElementById('det_data_devolucao');
    if (elDevolucao) { elDevolucao.value = dateParaInput(row.dataDevolucaoCorrecoes); calcularDiasDevolucao(); }

    const toInputMoney = (val) => val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    document.getElementById('det_acresc_f').value = toInputMoney(row.acrescFiscal);
    document.getElementById('det_supress_f').value = toInputMoney(row.supressFiscal);
    document.getElementById('det_reperc_f').value = toInputMoney(row.repercFiscal);
    document.getElementById('det_acresc_g').value = toInputMoney(row.acrescGecope);
    document.getElementById('det_supress_g').value = toInputMoney(row.supressGecope);
    document.getElementById('det_reperc_g').value = toInputMoney(row.repercGecope);

    // Garante que o cálculo seja refletido visualmente logo ao abrir
    setTimeout(() => { calcularRepercussao('det'); }, 50);


    // Determina se o usuário atual é admin a partir da role mais recente
    const isAdmin = (getCurrentUserRole() === 'admin');
    const inputs = document.querySelectorAll('#formDetalhes input, #formDetalhes select, #formDetalhes textarea');
    inputs.forEach(el => { el.disabled = !isAdmin; });

    document.getElementById('msg-detalhes').style.display = 'none';
    document.getElementById('btn-atualizar').innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';
    document.getElementById('btn-excluir').innerHTML = '<i class="bi bi-trash-fill"></i> EXCLUIR PROCESSO';

    // Audit Info Display
    const dtCriacao = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '';
    const txtCriador = row.criador || 'Não Registrado';
    document.getElementById('det_criador').value = dtCriacao ? `${txtCriador} em ${dtCriacao}` : txtCriador;

    let txtUpdate = 'Sem alterações recentes';
    if (row.atualizado_por) {
        const dt = row.ultima_atualizacao ? new Date(row.ultima_atualizacao).toLocaleString('pt-BR') : '';
        txtUpdate = `${row.atualizado_por} em ${dt}`;
    }
    document.getElementById('det_atualizacao').value = txtUpdate;

    // Buscar histórico de prioridades
    carregarHistoricoPrioridades(processoStr);

    const modal = new bootstrap.Modal(document.getElementById('modalDetalhes'));
    modal.show();
}

async function carregarHistoricoPrioridades(processoStr) {
    const container = document.getElementById('det_historico_prioridade');
    if (!container) return;
    
    container.innerHTML = '<em class="text-muted">Carregando histórico...</em>';
    
    try {
        const { data, error } = await sbClient
            .from('app_atividades')
            .select('usuario, descricao, created_at')
            .eq('tipo', 'PROCESSO')
            .eq('contexto', processoStr)
            .ilike('descricao', '%prioritário%')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = '<em class="text-muted">Nenhum registro de prioridade encontrado.</em>';
            return;
        }

        container.innerHTML = data.map(registro => {
            const dt = new Date(registro.created_at).toLocaleString('pt-BR');
            const desc = registro.descricao.toLowerCase();
            const isDesmarcar = desc.includes('desmarcou');
            const icon = !isDesmarcar ? '<i class="bi bi-star-fill text-warning me-1"></i>' : '<i class="bi bi-star text-secondary me-1"></i>';
            const actionText = !isDesmarcar ? 'Marcou como prioritário' : 'Desmarcou como prioritário';
            
            return `
                <div class="mb-2 pb-2 border-bottom border-light">
                    <div class="d-flex align-items-center mb-1">
                        ${icon} <span class="fw-bold text-dark">${registro.usuario}</span>
                    </div>
                    <div class="ps-3 text-muted" style="font-size: 0.65rem;">
                        ${actionText} em ${dt}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Erro ao carregar histórico de prioridades:", err);
        container.innerHTML = '<em class="text-danger">Erro ao carregar histórico.</em>';
    }
}

async function executarAcaoDetalhes(actionType) {
    const form = document.getElementById('formDetalhes');
    const processoNome = document.getElementById('det_processo').value;

    const registroOriginal = (window.allData || []).find(d => d.processo === processoNome);
    if (!registroOriginal || !registroOriginal.id) {
        alert("Erro crítico: ID do processo não localizado.");
        return;
    }
    const idUnico = registroOriginal.id;

    if (actionType === 'delete') {
        if (!confirm("TEM CERTEZA? O processo será movido para EXCLUÍDOS e sairá da lista principal.")) return;
        const btn = document.getElementById('btn-excluir');
        btn.innerHTML = "EXCLUINDO...";
        btn.disabled = true;

        // Soft Delete com Auditoria
        const userName = sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido';
        const updates = {
            status: 'EXCLUÍDO',
            excluido_por: userName,
            data_exclusao: new Date().toISOString()
        };

        const { error } = await sbClient.from('processos').update(updates).eq('id', idUnico);

        if (error) {
            alert("Erro ao excluir: " + error.message);
            btn.disabled = false;
        } else {
            alert("Excluído com sucesso!");
            bootstrap.Modal.getInstance(document.getElementById('modalDetalhes')).hide();
            carregarDadosSupabase();
        }
        return;
    }

    if (actionType === 'update') {
        // --- VALIDAÇÕES DE CAMPOS OBRIGATÓRIOS ---
        const camposObrigatorios = [
            { id: 'det_status', nome: 'Status Atual' },
            { id: 'det_tipo', nome: 'Tipologia' },
            { id: 'det_fiscal', nome: 'Fiscal Responsável' },
            { id: 'det_descricao', nome: 'Descrição do Objeto' },
            { id: 'det_contratante', nome: 'Contratante' },
            { id: 'det_contratada', nome: 'Contratada' }
        ];

        for (const campo of camposObrigatorios) {
            const el = document.getElementById(campo.id);
            if (!el || !el.value.trim()) {
                alert(`O campo "${campo.nome}" é obrigatório.`);
                el.focus();
                return;
            }
        }

        const statusAtual = document.getElementById('det_status').value;

        // 2.1 Se o Status for AGUAR. ANÁLISE, o campo RECEBIMENTO deve estar preenchido
        if (statusAtual === 'AGUAR. ANÁLISE') {
            const valRecebimento = document.getElementById('det_data_recebimento').value.trim();
            if (!valRecebimento) {
                alert("Para o status 'AGUAR. ANÁLISE', o campo 'Recebimento' é obrigatório.");
                document.getElementById('det_data_recebimento').focus();
                return;
            }
        }

        // 2.2 Se o Status for REANÁLISE FISCAL, o campo DEVOLUÇÃO PARA CORREÇÃO deve estar preenchido
        if (statusAtual === 'DEVOLVIDO P/ REANÁLISE FISCAL') {
            const valDevolucao = document.getElementById('det_data_devolucao').value.trim();
            if (!valDevolucao) {
                alert("Para o status 'REANÁLISE FISCAL', o campo 'Devolução p/ Correções' é obrigatório.");
                document.getElementById('det_data_devolucao').focus();
                return;
            }
        }

        // 2.3 Se o Status for AGUAR. APROVAÇÃO ou APROVADO, ACRÉSCIMO, SUPRESSÃO e APROVAÇÃO GECOPE obrigatórios
        if (statusAtual === 'AGUAR. APROVAÇÃO' || statusAtual === 'APROVADO') {
            const valAcrescG = document.getElementById('det_acresc_g').value.trim();
            const valSupressG = document.getElementById('det_supress_g').value.trim();
            const valAprovacaoG = document.getElementById('det_data_aprovacao').value.trim();

            if (!valAcrescG || !valSupressG || !valAprovacaoG) {
                alert(`Para o status "${statusAtual}", os campos de ACRÉSCIMO (GECOPE), SUPRESSÃO (GECOPE) e APROVAÇÃO GECOPE devem estar preenchidos.`);
                return;
            }
        }

        const formData = new FormData(form);

        const updates = {
            tipo: formData.get("TIPO"),
            status: formData.get("STATUS"),
            descricao: formData.get("DESCRIÇÃO"),
            fiscal: document.getElementById('det_fiscal').value,
            contratante: formData.get("CONTRATANTE"),
            contratada: formData.get("CONTRATADA"),
            analista: document.getElementById('det_analista').value,

            data_abertura: dataParaISO(formData.get("DATA DE ABERTURA")),
            data_recebimento: dataParaISO(formData.get("DATA RECEBIMENTO")),
            data_compromisso_fiscal: dataParaISO(formData.get("DATA COMPROMISSO FISCAL")),
            data_aprovacao_gecope: dataParaISO(formData.get("DATA APROVAÇÃO GECOPE")),
            data_devolucao_correcoes: dataParaISO(formData.get("DATA DEVOLUO CORREES")),

            acresc_fiscal: parseMoneyInput(document.getElementById('det_acresc_f').value),
            supress_fiscal: parseMoneyInput(document.getElementById('det_supress_f').value),
            reperc_fiscal: parseMoneyInput(document.getElementById('det_reperc_f').value),
            acresc_gecope: parseMoneyInput(document.getElementById('det_acresc_g').value),
            supress_gecope: parseMoneyInput(document.getElementById('det_supress_g').value),
            reperc_gecope: parseMoneyInput(document.getElementById('det_reperc_g').value),

            // Audit: Atualização (Mantém o registro de quem mexeu por último)
            atualizado_por: sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido'
            // A data 'ultima_atualizacao' não é definida aqui para não resetar o contador de dias sem mudança de status
        };

        // NOVA LÓGICA: Recalcular metas automáticas se o status mudar ou se a data de devolução for alterada
        const novoStatus = (updates.status || registroOriginal.status || "").toString().trim().toUpperCase();
        const statusAntigo = (registroOriginal.status || "").toString().trim().toUpperCase();
        const dataDevNova = updates.data_devolucao_correcoes;
        const dataDevAntiga = registroOriginal.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes ? 
                              (isoParaDate(registroOriginal.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes).toISOString().substring(0, 10)) : null;

        const statusMudou = novoStatus && novoStatus !== statusAntigo;
        const dataDevMudou = dataDevNova && dataDevNova !== dataDevAntiga;

        if (statusMudou) {
            updates.ultima_atualizacao = new Date().toISOString(); // Reinicia o contador de dias se o status mudar
        }

        if (statusMudou || dataDevMudou) {
            // Automação GECOPE: definir metas automáticas
            if (novoStatus === 'ANÁLISE FISCAL') {
                const base = registroOriginal.created_at || new Date();
                const metaAuto = calcularDataMeta(base, 20);
                updates.data_compromisso_fiscal = metaAuto.toISOString().substring(0, 10);
            } else if (novoStatus === 'DEVOLVIDO P/ REANÁLISE FISCAL' || novoStatus === 'REANÁLISE FISCAL') {
                // Para reanálises, usar a data de devolução informada no formulário
                let base = null;
                const devolucaoFinal = updates.data_devolucao_correcoes || dataDevAntiga;
                if (devolucaoFinal) base = isoParaDate(devolucaoFinal);
                else base = new Date();
                
                const metaAuto = calcularDataMeta(base, 10);
                updates.data_compromisso_fiscal = metaAuto.toISOString().substring(0, 10);
            } else if (statusMudou) {
                // Remove a meta se o status mudou para algo que não tem meta automática
                updates.data_compromisso_fiscal = null;
                const key = `meta:${processoNome}`;
                localStorage.removeItem(key);
            }
        }

        const btn = document.getElementById('btn-atualizar');
        btn.innerHTML = "SALVANDO...";
        btn.disabled = true;

        const { error } = await sbClient
            .from('processos')
            .update(updates)
            .eq('id', idUnico);

        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';

        if (error) {
            alert("Erro ao atualizar: " + error.message);
        } else {
            const msg = document.getElementById('msg-detalhes');
            msg.style.display = 'block';
            msg.className = 'alert alert-success';
            msg.innerHTML = ' Dados atualizados!';

            // Gravar log no historico_metas se a meta mudou ou foi zerada
            const dataLimiteOriginal = registroOriginal.data_compromisso_fiscal || null;
            const dataLimiteNova = updates.data_compromisso_fiscal || null;

            if (dataLimiteNova !== dataLimiteOriginal) {
                let dias = null;
                let baseDate = new Date();
                const statusNovo = (updates.status || registroOriginal.status || "").toString().trim().toUpperCase();

                if (statusNovo === 'ANÁLISE FISCAL') {
                    dias = 20;
                    // Regra de Cadastro: Usar a data de cadastro no GECOPE (created_at)
                    baseDate = registroOriginal.created_at || new Date();
                } else if (statusNovo === 'DEVOLVIDO P/ REANÁLISE FISCAL' || statusNovo === 'REANÁLISE FISCAL') {
                    dias = 10;
                    // Regra de Reanálise: Usar data de devolução para correção no cálculo da nova meta
                    const devDate = updates.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes;
                    baseDate = devDate ? (devDate instanceof Date ? devDate : isoParaDate(devDate)) : new Date();
                } else if (dataLimiteNova) {
                    // Regra Manual: Usar a data de estabelecimento da meta (hoje/agora)
                    baseDate = new Date();
                    const diffTime = Math.abs(new Date(dataLimiteNova) - baseDate);
                    dias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                const autor = sessionStorage.getItem('sop_user_name') || 'Sistema';

                const estStr = (baseDate instanceof Date ? baseDate.toISOString().substring(0,10) : (new Date(baseDate).toISOString().substring(0,10)));
                sbClient.from('historico_metas').insert([{
                    processo_id: idUnico,
                    registros: estStr,
                    dias_estipulados: dias,
                    meta: dataLimiteNova,
                    autor: autor
                }]).then(({ error: errHist }) => {
                    if (errHist) console.error('[ERRO] Falha ao registrar log no historico_metas (Edição):', errHist.message);
                });
            }

            // Notificação WhatsApp (Apenas para Devolução para Reanálise)
            const statusAlvo = ['DEVOLVIDO P/ REANÁLISE FISCAL'];
            if (updates.status && updates.status !== registroOriginal.status && statusAlvo.includes(updates.status)) {
                processarNotificacao('mudanca_status_processo', {
                    NUP_PROCESSO: processoNome,
                    NOME_OBRA: registroOriginal.descricao,
                    NOVO_STATUS: updates.status,
                    NOME_FISCAL: registroOriginal.fiscal || 'Fiscal'
                });
            }

            // Notificação para Analistas Específicos (Se mudou o analista ou se foi marcado agora)
            const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO'];

            let aAtualExtenso = updates.analista || "";
            if (aAtualExtenso === "N") aAtualExtenso = "Nildeno";
            else if (aAtualExtenso === "W") aAtualExtenso = "Walace";
            else if (aAtualExtenso === "P") aAtualExtenso = "Pedro";
            else if (aAtualExtenso === "F") aAtualExtenso = "Felipe";
            else if (aAtualExtenso === "H") aAtualExtenso = "Helder";
            const analistaAtual = aAtualExtenso.toUpperCase();

            let aAnteriorExtenso = registroOriginal.analista || "";
            if (aAnteriorExtenso === "N") aAnteriorExtenso = "Nildeno";
            else if (aAnteriorExtenso === "W") aAnteriorExtenso = "Walace";
            else if (aAnteriorExtenso === "P") aAnteriorExtenso = "Pedro";
            else if (aAnteriorExtenso === "F") aAnteriorExtenso = "Felipe";
            else if (aAnteriorExtenso === "H") aAnteriorExtenso = "Helder";
            const analistaAnterior = aAnteriorExtenso.toUpperCase();

            const usuarioAtual = (sessionStorage.getItem('sop_user_name') || "").toUpperCase();

            if (analistaAtual && analistaAtual !== analistaAnterior && analistasAlvo.some(alvo => analistaAtual.includes(alvo))) {
                const ehAutoAtribuicao = usuarioAtual && (analistaAtual.includes(usuarioAtual) || usuarioAtual.includes(analistaAtual));

                if (!ehAutoAtribuicao) {
                    processarNotificacao('analista_designado', {
                        ANALISTA: analistaAtual,
                        NUP_PROCESSO: processoNome,
                        NOME_OBRA: registroOriginal.descricao,
                        NOVO_STATUS: 'Em Análise'
                    });
                }
            }
            setTimeout(() => {
                msg.style.display = 'none';
                bootstrap.Modal.getInstance(document.getElementById('modalDetalhes')).hide();
                carregarDadosSupabase();

                // Log de Atividade (Apenas se status mudou, ou log geral)
                if (updates.status && updates.status !== registroOriginal.status) {
                    registrarAtividade('PROCESSO', `atualizou o status do processo Nº ${processoNome} para ${updates.status}`, processoNome, registroOriginal.descricao, registroOriginal.fiscal);
                }
            }, 1000);
        }
    }
}



// --- FUNES AUXILIARES RECUPERADAS ---
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
        backBtn.style.display = (paneId === 'pane-home') ? 'none' : 'block';
    }

    // Atualiza o título do subheader
    const titles = {
        'pane-home': 'Painel Gerencial — Aditivos de Obras',
        'pane-financeiro': 'Painel Financeiro',
        'pane-gerencial': 'Painel Gerencial - Estatísticas',
        'pane-prazos': 'Prazos e Produtividade',
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
    if (paneId === 'pane-prazos') {
        if (typeof updatePrazos === 'function') updatePrazos();
    }
    if (paneId === 'pane-gerencial') {
        if (typeof updateGerencial === 'function') updateGerencial();
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
    if (typeof updateGerencial === 'function') updateGerencial();
    if (typeof updatePrazos === 'function') updatePrazos();
}

// --- 6. EVENT LISTENERS E MÁSCARAS ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] === DOMContentLoaded iniciado ===');
    console.log('[DEBUG] Usuário:', sessionStorage.getItem('sop_user') || 'nenhum');
    console.log('[DEBUG] Role:', sessionStorage.getItem('sop_role') || 'nenhum');
    const landing = document.getElementById('landingOverlay');
    console.log('[DEBUG] Landing display:', landing ? landing.style.display || 'padrão' : 'não encontrado');

    // Carrega dados automaticamente
    console.log('[DEBUG] Executando carregarDadosSupabase()...');
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

        // Ocultar filtro de Fiscal para Fiscal (Painel Gerencial)
        if (ger.fiscal && ger.fiscal.parentElement) {
            ger.fiscal.parentElement.parentElement.style.display = 'none';
        }

        // Ocultar filtro de Fiscal para Fiscal (Painel Prazos)
        if (pr.fiscal && pr.fiscal.parentElement) {
            pr.fiscal.parentElement.parentElement.style.display = 'none';
        }

        // Desabilitar botão Limpar para Fiscal (Painel Financeiro)
        if (fin.clear) {
            fin.clear.disabled = true;
            fin.clear.title = 'Filtro automático por fiscal - não pode ser alterado';
        }

        // Desabilitar botão Limpar para Fiscal (Painel Gerencial)
        if (ger.clear) {
            ger.clear.disabled = true;
            ger.clear.title = 'Filtro automático por fiscal - não pode ser alterado';
        }

        // Desabilitar botão Limpar para Fiscal (Painel Prazos)
        if (pr.clear) {
            pr.clear.disabled = true;
            pr.clear.title = 'Filtro automático por fiscal - não pode ser alterado';
        }
    }
}

function parseMoneyInput(val) {
    if (val === null || val === undefined || val === '') return 0;
    let s = val.toString().trim();
    // Normaliza múltiplos tipos de traços para o hífen padrão (ASCII 45)
    s = s.replace(/[\u2212\u2013\u2014]/g, '-');
    // Se estiver entre parênteses, trata como negativo: (1.000,00) => -1.000,00
    if (/^\(.*\)$/.test(s)) { s = '-' + s.replace(/^\(|\)$/g, ''); }
    // Remove R$, espaços normais e NBSP
    s = s.replace(/R\$|\s|\u00A0/g, '');
    // Remove quaisquer caracteres que não sejam dígito, vírgula, ponto ou sinal de menos
    s = s.replace(/[^0-9\-,.]/g, '');
    if (!s || s === '-') return 0;
    // Se formato brasileiro (com vírgula), converte para formato parseable
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.split('.').length > 2) {
        // Caso tenha mais de um ponto (ex: 1.250.00), remove todos os pontos
        s = s.replace(/\./g, '');
    }
    const res = parseFloat(s);
    return isFinite(res) ? res : 0;
}
function formatCurrencyValue(val) { return val.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }

function calcularRepercussao() {
    try {
        const pairs = [
            { a: 'det_acresc_f', s: 'det_supress_f', r: 'det_reperc_f' },
            { a: 'det_acresc_g', s: 'det_supress_g', r: 'det_reperc_g' },
            { a: 'acresc_fisc', s: 'supress_fisc', r: 'reperc_fisc' },
            { a: 'acresc_gec', s: 'supress_gec', r: 'reperc_gec' }
        ];

        pairs.forEach(p => {
            const elA = document.getElementById(p.a);
            const elS = document.getElementById(p.s);
            const elR = document.getElementById(p.r);

            if (elA && elS && elR) {
                const vA = parseMoneyInput(elA.value);
                const vS = parseMoneyInput(elS.value);
                const total = Number((vA + vS).toFixed(2));

                elR.value = formatCurrencyValue(total);

                elR.classList.remove('text-danger', 'text-success', 'text-dark');
                if (total < -0.01) elR.classList.add('text-danger');
                else if (total > 0.01) elR.classList.add('text-success');
                else { elR.classList.add('text-dark'); elR.value = "0,00"; }
            }
        });
    } catch (err) {
        console.error('Erro no cálculo:', err);
    }
}

// calcularDiasDevolucao definida anteriormente (versão mais robusta)

// Dashboard/UI helpers moved to dashboard.js

// LOGIC: REUNIO
const mt = { meta: document.getElementById("meetingMetaSelect"), prioritario: document.getElementById("meetingPrioritarioSelect"), fiscal: document.getElementById("meetingFiscalSelect"), status: document.getElementById("meetingStatusSelect"), search: document.getElementById("meetingSearch"), body: document.getElementById("meetingTableBody"), note: document.getElementById("meetingFooterNote") };
let mtBase = [];
window.currentProcessesTab = 'ativos';

function switchProcessTab(tab) {
    window.currentProcessesTab = tab;
    const tabIds = ['btn-tab-ativos', 'btn-tab-aprovados', 'btn-tab-arquivados'];
    tabIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'btn-tab-' + tab) {
            el.style.color = 'var(--sop-green)';
            el.style.borderBottom = '3px solid var(--sop-green)';
            el.style.fontWeight = '700';
        } else {
            el.style.color = '#64748b';
            el.style.borderBottom = '3px solid transparent';
            el.style.fontWeight = '500';
        }
    });
    // Ao trocar de aba, garantir que os filtros de reunião estejam em "Todos"
    try {
        if (typeof mt !== 'undefined' && mt) {
            window.isResettingFilters = true; // Previne que updateReuniao rode múltiplas vezes

            // Para multiselects (status, fiscal) recria as opções selecionadas (Todos)
            if (mt.status && typeof fillSelect === 'function' && Array.isArray(window.allData)) {
                fillSelect(mt.status, window.allData.map(d => d.status));
            }
            if (mt.fiscal && typeof fillSelect === 'function' && Array.isArray(window.allData)) {
                fillSelect(mt.fiscal, window.allData.map(d => d.fiscal));
            }

            // Para selects simples (meta, prioritario) definir como vazio => Todos
            if (mt.meta) mt.meta.value = "";
            if (mt.prioritario) mt.prioritario.value = "";

            // Disparar eventos de change para atualizar labels/estado visual (ex: bootstrap-select)
            ['status', 'fiscal', 'meta', 'prioritario'].forEach(k => {
                try { mt[k]?.dispatchEvent(new Event('change')); } catch (e) { /* noop */ }
            });

            window.isResettingFilters = false;
        }
    } catch (e) {
        console.error('[switchProcessTab] erro ao resetar filtros', e);
        window.isResettingFilters = false;
    }

    updateReuniao();
}

function getMetaDate(row, setD) {
    const key = `meta:${row.processo}`;
    if (setD !== undefined) {
        // RBAC: apenas admins podem definir/excluir metas
        if (!canMarkDateAsMeta()) {
            console.warn(`[RBAC] usuário não pode alterar meta do processo ${row.processo}`);
            return null;
        }

        const valSupabase = setD ? setD.toISOString().substring(0, 10) : null;

        if (!setD) localStorage.removeItem(key);
        else localStorage.setItem(key, valSupabase);

        row.dataCompromissoFiscal = setD;

        // Sincroniza ativamente com o Supabase quando alterado pelo Painel (Tabela)
        sbClient.from('processos')
            .update({ data_compromisso_fiscal: valSupabase })
            .eq('processo', row.processo)
            .then(({ error }) => {
                if (error) {
                    console.error('[ERRO] Falha ao sincronizar meta na base de dados: ', error.message);
                } else {
                    try {
                        const acao = valSupabase ? `definiu a meta para ${valSupabase.split('-').reverse().join('/')}` : 'removeu a meta';
                        registrarAtividade('PROCESSO', `Usuário ${acao} no processo Nº ${row.processo}`, row.processo, (row && row.descricao) || '', (row && row.fiscal) || '');
                    } catch (e) { }

                    // Gravar histórico de metas
                    try {
                        const autor = sessionStorage.getItem('sop_user_name') || 'Usuário';
                        let dias = null;
                        if (valSupabase) {
                            const hoje = new Date();
                            hoje.setHours(0, 0, 0, 0);
                            const limite = new Date(valSupabase);
                            limite.setHours(0, 0, 0, 0);
                            const diffTime = limite.getTime() - hoje.getTime();
                            dias = Math.round(diffTime / (1000 * 60 * 60 * 24));
                        }

                        sbClient.from('historico_metas').insert([{
                            processo_id: row.id,
                            registros: new Date().toISOString().substring(0,10),
                            dias_estipulados: dias,
                            meta: valSupabase,
                            autor: autor
                        }]).then(({ error: errHist }) => {
                            if (errHist) console.error('[ERRO] Falha ao registrar log no historico_metas:', errHist.message);
                        });
                    } catch (e) {
                        console.error('[ERRO] Falha ao registrar histórico de metas no getMetaDate:', e);
                    }
                }
            });

        return setD;
    }
    if (row.dataCompromissoFiscal instanceof Date) return row.dataCompromissoFiscal;
    const ls = localStorage.getItem(key); if (ls) { const d = isoParaDate(ls); if (d) { row.dataCompromissoFiscal = d; return d; } }
    return null;
}
function getMetaSt(row) {
    const md = getMetaDate(row), st = (row.status || "").toUpperCase();
    if (st.includes("APROVADO")) return "Cumprido";
    if (!md) return "Sem meta";

    return md.setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0) ? "Atrasado" : "No prazo";
}
// Ordem ORIGINAL (para preservar a ordem de carregamento padrão da tela inicial)
function statusPriority(status) {
    const raw = (status || "").toString().toUpperCase().trim();
    const s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    // 1. EM REANÁLISE
    if (s.includes("EM REAN") || (s.startsWith("EM") && s.includes("REAN"))) return 1;
    // 2. EM ANÁLISE
    if ((s.includes("EM ANALIS") || s === "ANALISE") && !s.includes("FISCAL") && !s.includes("REAN")) return 2;
    // 3. AGUAR. REANÁLISE
    if (s.includes("AGUAR") && s.includes("REAN")) return 3;
    // 4. AGUAR. ANÁLISE
    if (s.includes("AGUAR") && s.includes("ANALIS") && !s.includes("FISCAL") && !s.includes("REAN")) return 4;
    // 5. AGUAR. APROVAÇÃO
    if (s.includes("AGUAR") && s.includes("APROVA")) return 5;
    // 6. REANÁLISE FISCAL (DEVOLVIDO P/ REANÁLISE FISCAL)
    if (s.includes("DEVOLVIDO") || (s.includes("REAN") && s.includes("FISCAL"))) return 6;
    // 7. ANÁLISE FISCAL
    if (s.includes("FISCAL") && s.includes("ANALIS") && !s.includes("DEVOLVIDO") && !s.includes("REAN")) return 7;
    // 8. CONTRATANTE
    if (s.includes("CONTRATANTE")) return 8;
    
    // Status adicionais (Aprovado e Arquivado)
    if (s === "APROVADO" || (s.includes("APROVADO") && !s.includes("AGUAR"))) return 9;
    if (s.includes("ARQUIVADO")) return 10;
    
    return 99;
}

// Ordem REVISADA (aplicada apenas ao "filtro"/setinha da coluna Status quando clicada)
function statusFilterPriority(status) {
    return statusPriority(status);
}

// Funções para gerenciar processos prioritários
function isPrioritario(row) {
    return row.prioritario === true;
}

async function setPrioritario(processo, isPriority) {
    // RBAC guard - apenas administradores podem alterar prioridade
    if (!canMarkProcessAsPriority()) {
        const role = getCurrentUserRole();
        console.warn(`[RBAC] Usuário (${role}) não tem permissão para marcar como prioritário`);
        alert('Você não tem permissão para marcar processos como prioritário.');
        return;
    }

    // 1. Atualizar imediatamente em memória (feedback visual instantâneo)
    const row = (window.allData || []).find(d => d.processo === processo);
    if (row) row.prioritario = isPriority;

    // 2. Realizar comunicação com o Supabase nos bastidores (Background Sync)
    try {
        const { error } = await sbClient
            .from('processos')
            .update({ prioritario: isPriority })
            .eq('processo', processo);

        if (error) {
            console.error('[ERRO] Falha ao marcar processo prioritário: ', error.message);
            alert("Aviso: Falha de conexão ao salvar status prioritário nas nuvens.");
        } else {
            // Registrar atividade: Admin marcou/desmarcou prioridade
            try {
                const acao = isPriority ? 'marcou como prioritário' : 'desmarcou como prioritário';
                await registrarAtividade('PROCESSO', `${acao} o processo Nº ${processo}`, processo, (row && row.descricao) || '', (row && row.fiscal) || '');
            } catch (regErr) {
                console.error('Erro ao registrar atividade de prioridade:', regErr);
            }

            // Atualiza o resumo de atividades na Home, se disponível
            if (typeof carregarAtividadesResumoHome === 'function') {
                try { carregarAtividadesResumoHome(); } catch (e) { /* noop */ }
            }
        }
    } catch (e) {
        console.error("Erro interno no setPrioritario:", e);
    }
}

function safeCompare(valA, valB, dir) {
    const isEmptyA = valA === undefined || valA === null || valA === "";
    const isEmptyB = valB === undefined || valB === null || valB === "";

    if (isEmptyA && isEmptyB) return 0;
    if (isEmptyA) return dir === 'asc' ? 1 : -1; // Envia vazios para o final
    if (isEmptyB) return dir === 'asc' ? -1 : 1;

    if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB, 'pt-BR');
        return dir === 'asc' ? cmp : -cmp;
    }

    if (valA < valB) return dir === 'asc' ? -1 : 1;
    if (valA > valB) return dir === 'asc' ? 1 : -1;
    return 0;
}

let currentSort = []; // Array of { col, dir }
window.currentSort = currentSort;

function changeSort(columnKey) {
    const index = currentSort.findIndex(s => s.col === columnKey);
    if (index !== -1) {
        if (currentSort[index].dir === 'asc') {
            currentSort[index].dir = 'desc';
        } else {
            currentSort.splice(index, 1);
        }
    } else {
        currentSort.push({ col: columnKey, dir: 'asc' });
    }
    updateReuniao();
}
window.changeSort = changeSort;

function getSortIcon(columnKey) {
    const sort = currentSort.find(s => s.col === columnKey);
    const sortIndex = currentSort.findIndex(s => s.col === columnKey);
    const indexBadge = currentSort.length > 1 && sortIndex !== -1 ? `<span class="badge bg-success ms-1" style="font-size: 0.6rem; padding: 2px 4px;">${sortIndex + 1}</span>` : '';

    if (!sort) { return '<i class="bi bi-arrow-down-up text-secondary ms-1" style="font-size: 1rem; opacity: 0.4;"></i>'; }
    return (sort.dir === 'asc' ? '<i class="bi bi-sort-up text-success ms-1" style="font-size: 1.1rem;"></i>' : '<i class="bi bi-sort-down-alt text-success ms-1" style="font-size: 1.1rem;"></i>') + indexBadge;
}
window.getSortIcon = getSortIcon;

function updateReuniaoFilters(rows) { mtBase = rows; updateReuniao(); }

function updateReuniao() {
    if (window.isResettingFilters) return; // Evita loop de re-render ao resetar filtros
    if (!mt.body) return;
    const uRole = (sessionStorage.getItem('sop_role') || "").toLowerCase();

    // Prioriza sop_fiscal_name (derivado do email) sobre sop_user_name
    let uName = (sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || "").toUpperCase().trim();

    const fs = Array.from(new Set(mtBase.map(d => d.fiscal).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (mt.fiscal.options.length <= 1) fillSelect(mt.fiscal, fs);
    let rows = mtBase.slice();

    // [PAGINAÇÃO] Filtro por Aba (Ativos vs Aprovados vs Arquivados)
    if (!window.currentProcessesTab) window.currentProcessesTab = 'ativos';
    
    // Filtro Global: Ignorar paginação (aba atual) se ativado
    const elGlobalToggle = document.getElementById('searchGlobalToggle');
    const isGlobalSearch = elGlobalToggle && elGlobalToggle.checked;
    
    if (!isGlobalSearch) {
        rows = rows.filter(d => {
            const st = (d.status || "").toUpperCase().trim();
            const isAprovado = st.includes("APROVADO") || st === "SEDUC";
            const isArquivado = st.includes("ARQUIVADO");

            if (window.currentProcessesTab === 'ativos') return !isAprovado && !isArquivado;
            if (window.currentProcessesTab === 'aprovados') return isAprovado;
            if (window.currentProcessesTab === 'arquivados') return isArquivado;
            return true;
        });
    }

    if (uRole === 'fiscal') {
        const nameParts = uName.trim().split(/[\s\.\-]+/).filter(p => p.length > 0);
        rows = rows.filter(d => {
            const dFiscal = (d.fiscal || "").toUpperCase().trim();
            const dFiscalNormalizado = dFiscal.replace(/[\.\-]+/g, ' ').trim();
            if (dFiscalNormalizado === uName) return true;
            if (nameParts.every(part => dFiscalNormalizado.includes(part))) return true;
            const dFiscalParts = dFiscalNormalizado.split(/\s+/).filter(p => p.length > 0);
            if (dFiscalParts.every(part => uName.includes(part))) return true;
            return false;
        });
        if (mt.fiscal && mt.fiscal.closest('.col-12.col-md-2')) {
            mt.fiscal.closest('.col-12.col-md-2').style.display = 'none';
        }
    } else {
        if (mt.fiscal && mt.fiscal.closest('.col-12.col-md-2')) {
            mt.fiscal.closest('.col-12.col-md-2').style.display = '';
        }
    }

    const f = getSelectedValues(mt.fiscal);
    const s = getSelectedValues(mt.status);
    const m = getSelectedValues(mt.meta);
    const priorFilt = getSelectedValues(mt.prioritario);
    const qRaw = mt.search.value.trim();

    const totalF = mt.fiscal.options.length;
    const totalS = mt.status.options.length;
    const totalM = mt.meta.options.length;
    const totalP = mt.prioritario.options.length;

    // Detecção robusta de "Tudo Selecionado"
    const allF = mt.fiscal.querySelectorAll('option:checked').length === totalF;
    const allS = mt.status.querySelectorAll('option:checked').length === totalS;
    const allM = mt.meta.querySelectorAll('option:checked').length === totalM;
    const allP = mt.prioritario.querySelectorAll('option:checked').length === totalP;

    if (f.length > 0 && !allF) {
        rows = rows.filter(d => f.includes(d.fiscal || "Não informado"));
    }
    if (s.length > 0 && !allS) {
        rows = rows.filter(d => s.includes(d.status || "Não informado"));
    }
    if (m.length > 0 && !allM) {
        rows = rows.filter(d => m.includes(getMetaSt(d)));
    }
    if (priorFilt.length > 0 && !allP) {
        rows = rows.filter(d => priorFilt.includes(isPrioritario(d) ? "Sim" : "Não"));
    }

    if (qRaw) {
        const normalizeText = (text) => (text || "").normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const qNormalized = normalizeText(qRaw);
        const terms = qNormalized.split(/\s+/).filter(t => t.length > 0);
        const escapeRE = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Otimização: Compila os Regex UMA vez fora do loop
        const compiledTerms = terms.map(term => ({
            term: term,
            regex: new RegExp(`\\b${escapeRE(term)}`, 'i')
        }));

        rows = rows.filter(d => {
            const proc = (d.processo || "").toLowerCase();
            const contrat = normalizeText(d.contratante);
            const desc = normalizeText(d.descricao);
            const analistaNome = normalizeText(d.nomeAnalista);
            const fiscal = normalizeText(d.fiscal);
            const status = normalizeText(d.status);
            const contratada = normalizeText(d.contratada);

            return compiledTerms.every(({ term, regex }) => {
                return proc.includes(term) ||
                    regex.test(contratada) ||
                    regex.test(contrat) ||
                    regex.test(desc) ||
                    regex.test(analistaNome) ||
                    regex.test(fiscal) ||
                    regex.test(status);
            });
        });
    }
    document.getElementById("meetingFooterNote").textContent = `Exibindo ${rows.length} processos`;
    document.getElementById("card_proc_total").textContent = rows.length;
    document.getElementById("card_proc_andamento").textContent = rows.filter(d => (d.status || "").toUpperCase() === "AGUAR. ANÁLISE").length;
    document.getElementById("card_proc_aprovados").textContent = rows.filter(d => (d.status || "").toUpperCase() === "ANÁLISE FISCAL").length;
    document.getElementById("card_proc_dias").textContent = rows.filter(d => (d.status || "").toUpperCase() === "DEVOLVIDO P/ REANÁLISE FISCAL").length;

    const btnExport = document.getElementById("btn-reuniao-export");
    if (btnExport) {
        btnExport.disabled = rows.length === 0;
        btnExport.title = rows.length === 0 ? "Nada para exportar" : "Exportar tudo do resultado filtrado para Excel";
    }
    window.currentVisibleRows = rows; // Armazena globalmente para exportação

    const columns = [
        { title: "Ações", width: "50px", key: null, align: "center" }, { title: "Prioritário", width: "80px", key: "prioritario", align: "center" }, { title: "Processo", width: "200px", key: "processo", align: "start" }, { title: "Meta", width: "100px", key: "meta", align: "start" },
        { title: "Status", width: "146px", key: "status", align: "start" }, { title: "Suite", width: "146px", key: null, align: "start" }, { title: "Analista", width: "100px", key: "analista", align: "center" }, { title: "Abertura", width: "100px", key: "abertura", align: "center" },
        { title: "Contratada", width: "100px", key: "contratada", align: "start" }, { title: "Descrição", width: "auto", key: "descricao", align: "start" }
    ];
    const thead = document.querySelector("#pane-reuniao table thead");
    let headerHTML = "<tr>";
    columns.forEach(col => {
        const stickyStyle = "position: sticky; top: -1px; z-index: 1030; background-color: #f8f9fa !important;";
        if (col.key) { headerHTML += `<th style="width: ${col.width}; cursor: pointer; user-select: none; ${stickyStyle}" onclick="changeSort('${col.key}')" class="text-${col.align}"><div class="d-flex align-items-center justify-content-${col.align === 'center' ? 'center' : 'start'}">${col.title} ${getSortIcon(col.key)}</div></th>`; }
        else { headerHTML += `<th class="text-${col.align}" style="width: ${col.width}; ${stickyStyle}">${col.title}</th>`; }
    });
    headerHTML += "</tr>";
    thead.innerHTML = headerHTML;

    rows.sort((a, b) => {
        if (currentSort.length === 0) {
            // 1. Prioridade por Status GECOPE
            const pA = statusPriority(a.status), pB = statusPriority(b.status);
            if (pA !== pB) return pA - pB;

            // 2. Regra Especial para Arquivados (Página 3): Ordenar por tempo no SUITE do mais recente para o mais antigo (menor nº de dias primeiro)
            if (pA === 10) {
                const tA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
                const tB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
                return tB - tA;
            }

            // 3. Ordenação dentro do bloco: Tempo de Abertura (Maior tempo decorrido = mais antigo primeiro)
            const dA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
            const dB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
            if (dA !== dB) return dA - dB;

            // 4. Fallback: Tempo no status SUITE
            const timeA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
            const timeB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
            return timeA - timeB;
        }

        for (let sort of currentSort) {
            let valA, valB;
            switch (sort.col) {
                case 'prioritario': valA = isPrioritario(a) ? 1 : 0; valB = isPrioritario(b) ? 1 : 0; break;
                case 'processo': valA = a.processo || ""; valB = b.processo || ""; break;
                case 'meta': {
                    const mA = getMetaDate(a);
                    const mB = getMetaDate(b);
                    valA = mA ? mA.getTime() : 0;
                    valB = mB ? mB.getTime() : 0;
                    break;
                }
                case 'status': valA = statusFilterPriority(a.status); valB = statusFilterPriority(b.status); break;
                case 'analista': valA = a.analista || ""; valB = b.analista || ""; break;
                case 'abertura': valA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : 0; valB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : 0; break;
                case 'dias': valA = a.dataAbertura instanceof Date ? -(new Date() - a.dataAbertura) : 1; valB = b.dataAbertura instanceof Date ? -(new Date() - b.dataAbertura) : 1; break;
                case 'contratante': valA = a.contratante || ""; valB = b.contratante || ""; break;
                case 'contratada': valA = a.contratada || ""; valB = b.contratada || ""; break;
                case 'descricao': valA = a.descricao || ""; valB = b.descricao || ""; break;
                default: continue;
            }
            const cmp = safeCompare(valA, valB, sort.dir);
            if (cmp !== 0) return cmp;
        }

        // Empate no sort personalizado: aplica a Ordem Normal (Status GECOPE -> Tempo Abertura) como desempate final!
        const pA = statusPriority(a.status), pB = statusPriority(b.status);
        if (pA !== pB) return pA - pB;

        if (pA === 10) {
            const tA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
            const tB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
            return tB - tA;
        }

        const dA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
        const dB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
        if (dA !== dB) return dA - dB;

        const timeA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
        const timeB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
        return timeA - timeB;
    });

    mt.body.innerHTML = rows.map(d => {
        const mIso = getMetaDate(d)?.toISOString().substring(0, 10) || "";
        const mSt = getMetaSt(d);
        let mCls = "badge-meta-sem";
        if (mSt === "Cumprido") mCls = "badge-meta-cumprido";
        else if (mSt === "No prazo") mCls = "badge-meta-prazo";
        else if (mSt === "Atrasado") mCls = "badge-meta-atrasado";

        const stTxt = (d.status || "").toString().toUpperCase().trim();
        let stCls = "text-bg-light";
        if (stTxt.includes("DEVOLVIDO")) { stCls = "badge-status-devolvido"; }
        else if (stTxt.includes("CONTRATANTE")) { stCls = "badge-status-contratante"; }
        else if (stTxt.includes("APROVAÇÃO")) { stCls = "badge-status-dark-blue"; }
        else if (stTxt.includes("FISCAL") && (stTxt.includes("ANÁLISE") || stTxt.includes("ANALISE"))) { stCls = "badge-status-fiscal"; }
        else if (stTxt.includes("AGUAR")) {
            if (stTxt.includes("REAN")) { stCls = "badge-status-aguar-reanalise"; }
            else { stCls = "badge-status-light-blue"; }
        }
        else if (stTxt.startsWith("EM") && stTxt.includes("REANÁLISE")) { stCls = "badge-status-em-reanalise"; }
        else if (stTxt.startsWith("EM") && (stTxt.includes("ANÁLISE") || stTxt.includes("ANALISE"))) { stCls = "badge-status-em-analise"; }
        else if (stTxt.includes("APROVADO") || stTxt === "SEDUC") { stCls = "badge-status-aprovado"; }

        const abert = dateParaInput(d.dataAbertura);
        const dias = (d.dataAbertura instanceof Date) ? Math.floor((new Date() - d.dataAbertura) / (1000 * 60 * 60 * 24)) : "";
        const fiscalNome = (d.fiscal || "").toUpperCase();

        const diasNoStatus = calcularDiasNoStatus(d);
        const labelDias = diasNoStatus <= 0 ? "Hoje" : (diasNoStatus === 1 ? "1 dia" : `${diasNoStatus} dias`);

        // Preparar botões de ação para evitar aninhamento de template strings
        const canEdit = ['admin', 'gerente'].includes(uRole);
        const btnDetalhes = canEdit ? `<button class="btn btn-sm btn-light border" onclick="abrirDetalhes('${escapeHTML(d.processo)}')" title="Ver detalhes"><i class="bi bi-eye-fill" style="color: var(--sop-blue);"></i></button>` : '';

        // Link para o SUITE (NUP apenas números para evitar 404)
        const nupLimpo = escapeHTML(d.processo).replace(/\D/g, '');
        const btnSuite = `<a href="https://suite.ce.gov.br/consultar-processo/${nupLimpo}" target="_blank" class="btn btn-sm btn-light border" title="Abrir no SUITE"><i class="bi bi-box-arrow-up-right" style="color: var(--sop-green);"></i></a>`;

        // Lógica da Meta
        const metaOnclick = `window.abrirModalMeta('${escapeHTML(d.processo)}', '${mIso}')`;
        const metaStyle = 'cursor: pointer;';

        return `
        <tr style="vertical-align: middle;" data-numero="${escapeHTML(d.processo)}" class="tr-processo-row">
            <td class="text-center">
                <div class="d-flex flex-column gap-1 align-items-center">
                    ${btnDetalhes}
                    ${btnSuite}
                </div>
            </td>
            <td class="text-center"><input type="checkbox" class="checkbox-prioritario ${uRole !== 'admin' ? 'readonly-checkbox' : ''}" data-proc="${escapeHTML(d.processo)}" ${isPrioritario(d) ? 'checked' : ''} title="${uRole === 'admin' ? 'Marcar como prioritário' : 'Você não tem permissão'}" ${uRole !== 'admin' ? 'onclick=\"return false;\" tabindex=\"-1\"' : ''} /></td>
            <td><div style="font-weight: 700; font-size: 0.95rem; color: #000; white-space: nowrap;">${escapeHTML(d.processo)}</div><div class="mt-1 text-muted" style="font-size: 0.75rem; font-weight: 500;"><i class="bi bi-person-fill me-1"></i>${escapeHTML(fiscalNome)}</div></td>
            <td>
                <div class="mb-1"><span class="badge rounded-pill ${mCls}" style="font-size: 0.75rem;">${mSt}</span></div>
                <div style="font-size: 0.75rem; color: var(--sop-blue); white-space: nowrap; padding: 2px 4px; border: 1px solid #ced4da; border-radius: 4px; text-align: center; background-color: #fff; ${metaStyle}" onclick="${metaOnclick}" title="${uRole === 'admin' ? 'Alterar Meta' : 'Você não tem permissão'}">
                    <i class="bi bi-calendar-event me-1"></i>${mIso ? mIso.split('-').reverse().join('/') : "Definir"}
                </div>
            </td>
            <td>
                <div><span class="badge rounded-pill ${stCls} badge-custom-size">${formatStatusDisplay(d.status)}</span><span class="alerta-icone" style="display:none;"></span></div>
                <div class=\"mt-1 text-muted px-1\" style=\"font-size: 0.7rem; font-weight: 500; height: 1.1rem;\"></div>
            </td>
            <td class="suite-cell">
                <div class="suite-badge-container"><span class="badge rounded-pill bg-light text-dark border badge-custom-size"><i class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></i>Consultando</span></div>
                <div class="mt-1 text-muted px-1 suite-time-container" style="font-size: 0.7rem; font-weight: 500; display: none;"><i class="bi bi-clock-history me-1"></i><span class="suite-time-text"></span></div>
            </td>
            <td class="text-center fw-bold text-secondary" style="font-size: 0.8rem;">${d.analista || "-"}</td>
            <td class="text-center">
                <div style="font-size: 0.8rem; color: #555;">${abert}</div>
                <div class="mt-1 text-muted" style="font-size: 0.7rem; font-weight: 500;"><i class="bi bi-calendar3 me-1"></i>${dias} dias</div>
            </td>
            <td style="font-size: 0.80rem; color: #333; line-height: 1.3;">${escapeHTML(d.contratada)}</td>
            <td style="font-size: 0.80rem; color: #333; line-height: 1.3; text-align: justify;">${escapeHTML(d.descricao)}</td>
        </tr>`;
    }).join("");

    // SweetAlert para definir Meta
    window.abrirModalMeta = async function (processo, dataAtual) {
        const isAdmin = canMarkDateAsMeta();

        let historicoHTML = '';
        try {
            const { data: pData } = await sbClient.from('processos').select('id').eq('processo', processo).maybeSingle();
            if (pData && pData.id) {
                const { data: rawHistorico } = await sbClient
                    .from('historico_metas')
                    .select('*')
                    .eq('processo_id', pData.id)
                    .order('registros', { ascending: false });
                
                const historico = [];
                if (rawHistorico) {
                    const pRow = (window.allData || []).find(r => r.processo === processo);
                    const chavesVistas = new Set();
                    for (const h of rawHistorico) {
                        let estDate = h.registros;
                        if (h.autor === 'Sistema' && pRow && !h.registros) {
                            const st = (pRow.status || "").toString().toUpperCase();
                            const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                            if (isReanalise && pRow.dataDevolucaoCorrecoes) {
                                estDate = pRow.dataDevolucaoCorrecoes;
                            } else if (pRow.created_at) {
                                estDate = pRow.created_at;
                            }
                        }
                        
                        // Filtra logs obsoletos ou duplicados do Sistema para a mesma data base de estabelecimento.
                        // Mantém apenas o primeiro encontrado (o mais recente/atualizado, ordenado por registros DESC).
                        const diaEst = estDate ? new Date(estDate).toISOString().substring(0, 10) : '';
                        const chave = h.autor === 'Sistema' ? `sistema_${diaEst}` : `manual_${h.meta}_${h.dias_estipulados}`;
                        
                        if (!chavesVistas.has(chave)) {
                            historico.push(h);
                            chavesVistas.add(chave);
                        }
                    }
                }
                
                if (historico && historico.length > 0) {
                    const totalDiasAcumulado = historico.reduce((sum, h) => sum + (h.dias_estipulados || 0), 0);
                    historicoHTML = `
                        <div class="mt-4 text-start">
                            <label class="form-label text-muted fw-bold d-flex justify-content-between align-items-center w-100" style="font-size: 0.85rem;">
                                <span><i class="bi bi-clock-history me-1"></i> Histórico de Metas</span>
                                <span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-2 py-1" style="font-size: 0.75rem; background-color: #e6f4ea !important; color: #008F3D !important; border: 1px solid #c3e6cb !important;">Acumulado: ${totalDiasAcumulado} dias</span>
                            </label>
                            <div class="table-responsive" style="max-height: 180px; overflow-y: auto;">
                                <table class="table table-sm table-hover mb-0">
                                    <thead class="table-light sticky-top" style="z-index: 1;">
                                        <tr>
                                            <th>REGISTRO</th>
                                            <th class="text-center">DIAS</th>
                                            <th>META</th>
                                            <th>AUTOR</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${historico.map(h => {
                                            const pRow = (window.allData || []).find(r => r.processo === processo);
                                            let estDate = h.registros;
                                            if (h.autor === 'Sistema' && pRow && !h.registros) {
                                                const st = (pRow.status || "").toString().toUpperCase();
                                                const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                                                if (isReanalise && pRow.dataDevolucaoCorrecoes) {
                                                    estDate = pRow.dataDevolucaoCorrecoes;
                                                } else if (pRow.created_at) {
                                                    estDate = pRow.created_at;
                                                }
                                            }
                                            const dtEst = estDate ? new Date(estDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
                                            // Calcula meta exibida: usa h.meta se existir, senão tenta calcular a partir de registros + dias_estipulados
                                            let metaVal = h.meta || null;
                                            if (!metaVal) {
                                                try {
                                                    const diasVal = (h.dias_estipulados === null || h.dias_estipulados === undefined) ? null : Number(h.dias_estipulados);
                                                    const baseIso = estDate ? (new Date(estDate)).toISOString().substring(0,10) : null;
                                                    const baseDateObj = baseIso ? isoParaDate(baseIso) : null;
                                                    if (baseDateObj && diasVal !== null && !isNaN(diasVal)) {
                                                        const computed = calcularDataMeta(baseDateObj, diasVal);
                                                        if (computed) metaVal = computed.toISOString().substring(0,10);
                                                    }
                                                } catch (e) {
                                                    console.error('Erro ao calcular meta a partir de registros:', e);
                                                }
                                            }
                                            const dtLim = metaVal ? metaVal.split('-').reverse().join('/') : 'Zerada';
                                            const dias = h.dias_estipulados !== null && h.dias_estipulados !== undefined ? h.dias_estipulados : '-';
                                            const autor = h.autor || 'Sistema';
                                            return `
                                                <tr style="vertical-align: middle;">
                                                    <td>${dtEst}</td>
                                                    <td class="text-center font-monospace">${dias}</td>
                                                    <td>
                                                        ${h.meta ? 
                                                            `<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-2 py-0.5" style="font-size: 0.75rem;">${dtLim}</span>` : 
                                                            `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-0.5" style="font-size: 0.75rem;">Zerada</span>`
                                                        }
                                                    </td>
                                                    <td class="fw-semibold">${autor}</td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                } else {
                    historicoHTML = `
                        <div class="mt-4 text-start text-muted py-2 text-center" style="font-size: 0.8rem; border: 1px dashed #dee2e6; border-radius: 8px; background-color: #f8f9fa;">
                            <i class="bi bi-info-circle me-1"></i> Nenhum histórico de meta registrado para este processo.
                        </div>
                    `;
                }
            }
        } catch (errHist) {
            console.error('Erro ao buscar histórico de metas:', errHist);
            historicoHTML = `
                <div class="mt-4 text-start text-danger py-2 text-center" style="font-size: 0.8rem; border: 1px dashed #f8d7da; border-radius: 8px;">
                    <i class="bi bi-exclamation-triangle me-1"></i> Não foi possível carregar o histórico de metas.
                </div>
            `;
        }

        const inputDisabled = isAdmin ? '' : 'disabled';
        const inputBg = isAdmin ? '' : 'background-color: #f8f9fa; color: #666; cursor: not-allowed;';

        const htmlContent = `
                        <div class="mt-2 text-start">
                            <label for="swal-input-date" class="form-label text-muted fw-bold" style="font-size: 0.85rem;">Selecione a data máxima esperada</label>
                            <input id="swal-input-date" type="date" class="form-control form-control-lg" value="${dataAtual}" ${inputDisabled} style="border: 2px solid #e9ecef; border-radius: 8px; font-size: 1.1rem; color: #333; box-shadow: none; ${inputBg}">
                        </div>
                        ${historicoHTML}
                    `;

        const { value: formValues, isConfirmed, isDenied } = await Swal.fire({
            title: `<div style="font-size: 1.3rem; font-weight: 700; color: #1B5E20; display: flex; align-items: center;"><i class="bi bi-calendar-check text-success me-2" style="font-size: 1.5rem;"></i> ${isAdmin ? 'Definir Meta' : 'Visualizar Meta'}</div><div style="font-size: 0.9rem; color: #666; margin-top: 6px; font-weight: 500;">Processo: <span class="text-dark fw-bold">${processo}</span></div>`,
            html: htmlContent,
            showCancelButton: true,
            showConfirmButton: isAdmin,
            showDenyButton: isAdmin && !!dataAtual, // Apenas mostra o botão Remover se já existir uma meta e for admin
            confirmButtonColor: '#008F3D',
            denyButtonColor: '#feebec',
            cancelButtonColor: '#f4f4f4',
            confirmButtonText: '<i class="bi bi-check2-circle me-1"></i>Salvar',
            cancelButtonText: isAdmin ? 'Cancelar' : 'Fechar',
            denyButtonText: '<i class="bi bi-trash me-1"></i>Remover',
            customClass: {
                popup: 'rounded-4 shadow-lg border-0',
                title: 'text-start border-bottom pb-3 mb-2',
                actions: 'w-100 px-4 pb-3 justify-content-between',
                confirmButton: 'btn btn-success px-4 py-2 fw-bold text-white',
                cancelButton: 'btn btn-light px-3 py-2 text-secondary fw-semibold border',
                denyButton: 'btn px-3 py-2 text-danger fw-semibold'
            },
            buttonsStyling: false,
            focusConfirm: false,
            preConfirm: () => {
                return document.getElementById('swal-input-date').value;
            }
        });

        if (isConfirmed) {
            const novoDate = formValues ? isoParaDate(formValues) : null;
            const linha = (window.allData || []).find(d => d.processo === processo);
            if (linha) {
                getMetaDate(linha, novoDate);
                updateReuniao();
            }
        } else if (isDenied) {
            const linha = (window.allData || []).find(d => d.processo === processo);
            if (linha) {
                getMetaDate(linha, null);
                updateReuniao();
            }
        }
    };

    // Event listener para checkboxes de prioritário
    mt.body.querySelectorAll('.checkbox-prioritario').forEach(checkbox => checkbox.addEventListener('change', (e) => {
        const processo = e.target.dataset.proc;
        setPrioritario(processo, e.target.checked);
        updateReuniao();
    }));

    // Buscar status do SUITE e atualizar UI
    atualizarTabelaSuite(rows);
}

window.suiteCache = window.suiteCache || {};

async function atualizarTabelaSuite(rows) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    if (rows.length === 0) {
        return;
    }

    // Filter out cached processes to apply delay only to new API requests
    const nonCachedRows = rows.filter(d => !window.suiteCache[escapeHTML(d.processo)]);

    const promises = rows.map(async (d) => {
        const num = escapeHTML(d.processo);
        const tr = document.querySelector(`tr[data-numero="${num}"]`);
        if (!tr) return;

        const suiteCell = tr.querySelector('.suite-badge-container');
        const suiteTime = tr.querySelector('.suite-time-container');
        const suiteTimeText = tr.querySelector('.suite-time-text');
        const alertaIcone = tr.querySelector('.alerta-icone');
        const stTxt = (d.status || "").toUpperCase();

        const renderData = (data) => {
            if (data && data.sucesso) {
                const badgeSigla = `<span class="badge rounded-pill bg-light text-dark border badge-custom-size" style="background-color: #f8f9fa !important;">${escapeHTML(data.sigla)}</span>`;
                suiteCell.innerHTML = badgeSigla;

                if (data.data_chegada_unidade) {
                    // Armazena no objeto da tabela atual
                    d.suite_data_chegada = data.data_chegada_unidade;

                    // Armazena no window.allData global para futuras re-ordenações nativas sem delay de DOM
                    if (window.allData) {
                        const globalRow = window.allData.find(x => x.processo === d.processo);
                        if (globalRow) globalRow.suite_data_chegada = data.data_chegada_unidade;
                    }

                    const diffMs = new Date().getTime() - new Date(data.data_chegada_unidade).getTime();
                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    suiteTimeText.textContent = diffDays > 0 ? `${diffDays} dia${diffDays > 1 ? 's' : ''}` : "Hoje";
                    suiteTime.style.display = 'block';
                }

                const ehFiscal = stTxt.includes('ANÁLISE FISCAL') || stTxt.includes('REANÁLISE FISCAL');
                if (data.esta_no_gecop && ehFiscal) {
                    tr.classList.add('tr-alerta-fiscal');
                    suiteTime.innerHTML += ` <span class="badge-tramitado-pulse">Tramitado</span>`;
                }
            } else {
                suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-muted border" style="font-size: 0.70rem;">Não enc.</span>`;
            }
        };

        // Otimização: Cache de 5 minutos
        const cached = window.suiteCache[num];
        if (cached && (new Date().getTime() - cached.timestamp < 5 * 60 * 1000)) {
            renderData(cached.data);
            return;
        }

        try {
            // Aplica delay incremental apenas nas requisições reais (para não sobrecarregar API)
            const reqIndex = nonCachedRows.findIndex(r => r.processo === d.processo);
            if (reqIndex !== -1) await delay(reqIndex * 150);

            const { data, error } = await sbClient.functions.invoke('consultar-suite', {
                body: { numero: d.processo }
            });

            if (error) throw error;

            // Determina sigla anterior (se houver) antes de atualizar o cache
            const prevSigla = window.suiteCache[num] && window.suiteCache[num].data ? String(window.suiteCache[num].data.sigla || '').toUpperCase().trim() : null;
            // Atualiza Cache
            window.suiteCache[num] = { data: data, timestamp: new Date().getTime() };

            renderData(data);

            if (window.StatusSync && data && data.sucesso) {
                window.StatusSync.verificarEAtualizarStatus(d, {
                    status_suite: data.sigla,
                    sigla: data.sigla,
                    prevSigla: prevSigla,
                    historico: data.historico || data.tramites || data.movimentacoes || []
                }).then(res => {
                    if (res && res.changed && res.data) {
                        const novoStatus = res.data.status;
                        const statusBadge = tr.querySelector('td:nth-child(5) .badge');
                        if (statusBadge) {
                            statusBadge.textContent = formatStatusDisplay(novoStatus);
                            // Determina classe do badge dinamicamente
                            let newCls = 'text-bg-light';
                            const stUpper = novoStatus.toUpperCase();
                            if (stUpper.includes("AGUAR")) {
                                newCls = stUpper.includes("REAN") ? 'badge-status-aguar-reanalise' : 'badge-status-light-blue';
                            } else if (stUpper.includes("ARQUIVADO")) {
                                newCls = 'badge-status-aprovado';
                            }
                            statusBadge.className = `badge rounded-pill badge-custom-size ${newCls}`;
                        }
                        const timerText = tr.querySelector('td:nth-child(5) .text-muted');
                        if (timerText) timerText.innerHTML = '';
                        if (window.showToast) window.showToast(`Processo ${d.processo} atualizado para ${novoStatus}!`, 'success');
                    }
                }).catch(err => console.error("[Automação] Erro:", err));
            }
        } catch (e) {
            console.error("Erro na integração SUITE:", e);
            suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-danger border" style="font-size: 0.60rem;">Erro Cloud</span>`;
        }
    });

    await Promise.all(promises);

    // Após finalizar o fetch do SUITE, reordena o DOM para a página de ARQUIVADOS apenas
    // se houve alguma atualização nova (o cache alimenta o sort inicial, evitando o pulo)
    if (window.currentProcessesTab === 'arquivados') {
        const tbody = document.getElementById("meetingTableBody");
        if (tbody) {
            const trs = Array.from(tbody.querySelectorAll("tr.tr-processo-row"));
            trs.sort((trA, trB) => {
                const numA = trA.getAttribute('data-numero');
                const numB = trB.getAttribute('data-numero');
                const rowA = rows.find(r => r.processo === numA);
                const rowB = rows.find(r => r.processo === numB);
                const tA = (rowA && rowA.suite_data_chegada) ? new Date(rowA.suite_data_chegada).getTime() : 0;
                const tB = (rowB && rowB.suite_data_chegada) ? new Date(rowB.suite_data_chegada).getTime() : 0;
                return tB - tA; // mais recente (menor qtde de dias) primeiro
            });
            trs.forEach(tr => tbody.appendChild(tr));
        }
    }
}

function fillCommonStatusFilters() {
    try {
        const statuses = Array.from(new Set((window.allData || []).map(d => d.status))).filter(v => v);
        if (typeof fillSelect === 'function') {
            if (ger && ger.status) fillSelect(ger.status, statuses);
            if (pr && pr.status) fillSelect(pr.status, statuses);
            if (mt && mt.status) fillSelect(mt.status, statuses);
        }
    } catch (e) { console.warn('fillCommonStatusFilters error', e); }
}

function populateAllTabFilters() {
    populateFinanceiroFilters();
    fillCommonStatusFilters();

    // Força os filtros estáticos da aba Reunião a iniciarem como "Todos"
    [mt.meta, mt.prioritario].forEach(el => {
        if (el) {
            Array.from(el.options).forEach(o => o.selected = true);
            renderMultiSelectUI(el);
        }
    });

    updateGerencialFilters(window.allData); updatePrazosFilters(window.allData); updateReuniaoFilters(window.allData);

    // Verifica notificações de atraso (apenas admins ou autorizados)
    if (getCurrentUserRole() === 'admin') {
        verificarNotificacoesAtraso();
    }
}
function wireEvents() {
    fin.status.addEventListener("change", updateFinanceiro); fin.tipo.addEventListener("change", updateFinanceiro); fin.fiscal.addEventListener("change", updateFinanceiro);
    fin.contratada.addEventListener("change", updateFinanceiro); fin.contratante.addEventListener("change", updateFinanceiro); fin.ano.addEventListener("change", updateFinanceiro);
    fin.clear.addEventListener("click", (e) => { e.preventDefault(); clearFinanceiro(); });
    fin.totAno.addEventListener("change", updateFinanceiro); fin.totMes.addEventListener("change", updateFinanceiro); fin.diffMetric.addEventListener("change", updateFinanceiro);
    ger.fiscal.addEventListener("change", updateGerencial); ger.status.addEventListener("change", updateGerencial);
    ger.clear.addEventListener("click", (e) => { e.preventDefault(); clearGerencial(); });
    pr.fiscal.addEventListener("change", updatePrazos); pr.status.addEventListener("change", updatePrazos);
    pr.clear.addEventListener("click", (e) => { e.preventDefault(); clearPrazos(); });
    mt.meta.addEventListener("change", updateReuniao); mt.prioritario.addEventListener("change", updateReuniao); mt.fiscal.addEventListener("change", updateReuniao); mt.status.addEventListener("change", updateReuniao);
    // Debounce no search de reunião
    mt.search.addEventListener("input", debounce(updateReuniao, 300));
    const globalSearchToggle = document.getElementById("searchGlobalToggle");
    if (globalSearchToggle) globalSearchToggle.addEventListener("change", updateReuniao);

    document.getElementById("btn-reuniao-clear").addEventListener("click", (e) => {
        e.preventDefault();
        if (mt && mt.search) mt.search.value = "";
        if (globalSearchToggle) globalSearchToggle.checked = false;
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

// Administração movida para admin.js — chamando inicializador se presente
if (typeof verificarAdminSalvo === 'function') verificarAdminSalvo();

/* --------------------------------------------------------------
   FUNES DE AUTENTICAO (SUPABASE)
-------------------------------------------------------------- */

// Cadastro reformulado: NOME, SOBRENOME, MATRICULA, SENHA
async function signUpRequest(nome, sobrenome, matricula, senha, telefone, email) {
    try {
        // 1. Criar usuário no Auth
        const options = {
            email: email,
            password: senha,
            options: { data: { full_name: `${nome} ${sobrenome}` } }
        };

        const { data, error } = await sbClient.auth.signUp(options);

        if (error) {
            console.error('[SIGNUP] Erro no Auth.signUp:', error);
            alert('Erro ao realizar cadastro (Auth): ' + (error.message || String(error)));
            return false;
        }

        const userId = data?.user?.id;

        // 2. Buscar se já existe um registro fantasma pela matrícula
        const { data: existingGhost, error: searchError } = await sbClient
            .from('app_users')
            .select('*')
            .eq('matricula', matricula)
            .maybeSingle();

        if (existingGhost) {
            // Fazer UPDATE no registro existente (mantendo o ID original intacto)
            const payload = {
                email: email,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone || existingGhost.telefone_whatsapp,
                role: 'pending'
            };
            
            const { error: updateError } = await sbClient.from('app_users').update(payload).eq('id', existingGhost.id);
            if (updateError) {
                console.warn('[SIGNUP] Aviso ao atualizar app_users (RLS):', updateError);
            }
        } else {
            // Não existe, fazer INSERT de um novo
            const payload = {
                email: email,
                matricula: matricula,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone,
                role: 'pending',
                created_at: new Date().toISOString()
            };
            if (userId) payload.id = userId; // Fallback to auth ID if allowed, usually app_users might have bigserial id though. The schema check will determine.
            
            const { error: insertError } = await sbClient.from('app_users').insert([payload]);
            if (insertError) {
                console.warn('[SIGNUP] Aviso ao inserir app_users (RLS):', insertError);
            }
        }

        const { error: noteError } = await sbClient.from('app_notifications').insert([{ type: 'new_user_request', payload: JSON.stringify({ matricula, nome: `${nome} ${sobrenome}`, email: email }), created_at: new Date().toISOString(), read: false }]);
        if (noteError) {
            console.warn('[SIGNUP] Falha ao inserir notificação:', noteError);
        }

        alert(`Solicitação enviada para a matrícula ${matricula}.\nAguarde aprovação do Admin!`);
        return true;
    } catch (err) { console.error(err); alert('Erro inesperado ao solicitar acesso.'); return false; }
}

async function signInWithEmail(email, password) {
    try {
        // Garantia: aguarda inicialização do cliente Supabase (se necessário)
        if (!sbClient) {
            const waitInit = new Promise(res => {
                const start = Date.now();
                const iv = setInterval(() => {
                    if (sbClient) { clearInterval(iv); res(true); }
                    else if (Date.now() - start > 5000) { clearInterval(iv); res(false); }
                }, 100);
            });
            const ok = await waitInit;
            if (!ok) {
                Swal.fire('Erro de Autenticação', 'Serviço de autenticação não iniciado. Recarregue a página.', 'error');
                return;
            }
        }

        console.log('[DEBUG] signInWithEmail iniciado para:', email);

        // REMOVIDA VALIDAO SOP
        // if (!email.endsWith('@sop.ce.gov.br')) { ... }

        console.log('[DEBUG] Autenticando com Supabase Auth...');
        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });

        if (error) {
            console.error('[ERRO] Falha Auth:', error.message);
            document.getElementById('landing-feedback').style.display = 'block';
            document.getElementById('landing-feedback').textContent = error.message;
            return;
        }

        console.log('[DEBUG] Autenticação bem-sucedida. Buscando perfil no app_users...');
        // Busca perfil e roles na tabela app_users
        const profile = await sbClient.from('app_users').select('*').eq('email', email).single();
        const role = profile.data?.role || 'pending';

        console.log('[DEBUG] Perfil encontrado:', { email, role });

        // Salva no sessionStorage
        sessionStorage.setItem('sop_user', email);
        sessionStorage.setItem('sop_role', role);

        // Busca nome completo de forma robusta
        let finalName = '';
        if (profile.data) {
            if (profile.data.full_name && !/^\d+$/.test(profile.data.full_name)) {
                finalName = profile.data.full_name;
            } else if (profile.data.nome) {
                finalName = (profile.data.nome + (profile.data.sobrenome ? ' ' + profile.data.sobrenome : '')).toUpperCase();
            }
        }

        if (finalName) {
            sessionStorage.setItem('sop_user_name', finalName);
        } else {
            sessionStorage.removeItem('sop_user_name');
        }
        console.log('[DEBUG] Dados salvos em localStorage. Nome:', finalName);

        applyRoleToUI(role);

        // Esconde landing
        toggleLanding(false);
        console.log('[DEBUG] Landing overlay ocultado');

        // notifica
        // alert('Bem-vindo: ' + email + '\\nPermissão: ' + role);

        console.log('[DEBUG] Carregando dados após login...');
        setTimeout(() => carregarDadosSupabase(), 500);
    } catch (err) {
        console.error('[ERRO] Exceção em signInWithEmail:', err);
        document.getElementById('landing-feedback').style.display = 'block';
        document.getElementById('landing-feedback').textContent = 'Erro ao autenticar: ' + (err.message || err);
    }
}

async function signOutUser() {
    await sbClient.auth.signOut();
    sessionStorage.removeItem('sop_user');
    sessionStorage.removeItem('sop_role');
    sessionStorage.removeItem('sop_user_name');
    // Exibe landing novamente
    toggleLanding(true);
    // Atualiza UI
    applyRoleToUI('guest');
}

function applyRoleToUI(rawRole) {
    const role = (rawRole || 'guest').toLowerCase();

    // Remove role classes
    document.body.classList.remove('role-admin', 'role-gerente', 'role-fiscal', 'role-externo', 'role-pending', 'is-admin');
    document.body.classList.add(`role-${role}`);
    if (role === 'admin') document.body.classList.add('is-admin');

    // 1. Reset tabs and panes
    document.querySelectorAll('#dashboardTabs .nav-link').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));

    // 2. Activate Home Tab by Default
    const homeTab = document.querySelector('[data-bs-target="#pane-home"]');
    const homePane = document.getElementById('pane-home');
    if (homeTab && homePane) {
        homeTab.classList.add('active');
        homePane.classList.add('show', 'active');
        updateHome();
    }

    // 1. Visibilidade de Abas e Tiles por Atributo data-roles
    // -> cards iniciais devem permanecer visíveis para todos os papéis;
    //    a lógica de restrição de acesso é tratada no showPane() e em cada função.
    document.querySelectorAll('[data-roles]').forEach(el => {
        if (el.classList.contains('home-action-card')) {
            // sempre mostra o tile
            el.style.setProperty('display', 'flex', 'important');
            return;
        }
        const allowed = el.getAttribute('data-roles').split(',');
        if (allowed.includes(role)) {
            el.style.setProperty('display', 'block', 'important');
        } else {
            el.style.setProperty('display', 'none', 'important');
        }
    });

    // Caso especial: Selecionar a primeira aba visível se a atual sumir
    const activeTab = document.querySelector('.nav-link.active');
    if (activeTab && activeTab.closest('li').style.display === 'none') {
        const firstVisible = document.querySelector('#dashboardTabs li[style*="display: block"] .nav-link');
        if (firstVisible) showPane(firstVisible.getAttribute('data-bs-target').replace('#', ''));
    }

    // Se for Pending, bloqueia acesso e volta para landing
    if (role === 'pending') {
        alert("Sua solicitação de acesso ainda está pendente de aprovação.");
        signOutUser();
        return;
    }

    // 2. Elementos .admin-only
    document.querySelectorAll('.admin-only').forEach(el => {
        if (el.id !== 'btn-nova-comp-analitica') {
            el.style.display = (role === 'admin') ? '' : 'none';
        }
    });

    // 3. Botões Específicos
    const btnNovaComp = document.getElementById('btn-nova-comp-analitica');
    if (btnNovaComp) {
        // now all authenticated roles can see the "nova composição analítica" link
        // guests and pending users will still have it hidden via their role string
        btnNovaComp.style.display = (role && role !== 'guest' && role !== 'pending') ? 'inline-block' : 'none';
    }

    // 4. Elementos Hide Fiscal
    if (role === 'fiscal') {
        document.querySelectorAll('.hide-fiscal').forEach(el => el.style.display = 'none');
    }

    // 5. Atualiza contadores e Admin Dashboard
    if (role === 'admin') {
        fetchPendingCount();
        startNotificationsPoll();
    } else {
        const badgeEl = document.getElementById('pending-badge'); if (badgeEl) badgeEl.textContent = '';
        stopNotificationsPoll();
    }

    // 6. Atualiza Header (Sair / Nome Usuário)
    const userInfoHeader = document.getElementById('user-info-header');
    if (userInfoHeader) {
        if (role === 'guest') {
            userInfoHeader.style.setProperty('display', 'none', 'important');
        } else {
            userInfoHeader.style.setProperty('display', 'flex', 'important');
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            if (nameEl) nameEl.textContent = (sessionStorage.getItem('sop_user_name') || 'Usuário').toUpperCase();
            if (roleEl) roleEl.textContent = role;
        }
    }

    // Aplicar regras de RBAC nos painéis
    if (typeof applyRBACToPainels === 'function') {
        applyRBACToPainels();
    }
}

// --- FUNES DE CONTROLE DE RBAC (ROLE-BASED ACCESS CONTROL) ---
/**
 * Retorna o papel atual do usuário logado
 */
function getCurrentUserRole() {
    return (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
}

/**
 * Retorna o email do usuário logado
 */
function getCurrentUserEmail() {
    return sessionStorage.getItem('sop_user') || '';
}

/**
 * Busca a role atual do usuário no servidor (tabela app_users)
 * e atualiza localStorage + UI se houver alteração.
 */
async function refreshUserRole() {
    try {
        const email = getCurrentUserEmail();
        if (!email) return;
        const { data, error } = await sbClient.from('app_users').select('role').eq('email', email).single();
        if (error) {
            console.warn('[WARN] refreshUserRole: erro ao buscar role', error.message || error);
            return;
        }
        const newRole = (data?.role || 'guest').toLowerCase();
        const curRole = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
        if (newRole !== curRole) {
            sessionStorage.setItem('sop_role', newRole);
            console.log('[INFO] Role atualizada de', curRole, 'para', newRole);
            applyRoleToUI(newRole);
        }
    } catch (err) {
        console.error('[ERRO] refreshUserRole:', err);
    }
}

/**
 * Verifica se o usuario é proprietário de uma composição/orçamento
 * @param {Object} item - O item (composição ou orçamento)
 * @returns {boolean} - True se o usuário é o dono
 */
function isItemOwner(item) {
    const userEmail = getCurrentUserEmail();
    const currentUserName = (sessionStorage.getItem('sop_user_name') || '').toUpperCase();
    const currentFiscalName = (sessionStorage.getItem('sop_fiscal_name') || '').toUpperCase();

    // Para composições, verifica criador
    const criador = item.criador_email || item.criado_por || item.created_by || '';
    const autorV1 = item.historico_versoes?.[0]?.autor || criador || item.criador_nome || item.autor || '';

    if (userEmail && autorV1.toUpperCase().includes(userEmail.toUpperCase())) return true;
    if (currentUserName && autorV1.toUpperCase().includes(currentUserName)) return true;
    if (currentFiscalName && autorV1.toUpperCase().includes(currentFiscalName)) return true;
    return false;
}

/**
 * Verifica se o usuário pode editar uma composição
 * Regra: Admin pode editar todas. Gerente/Fiscal/Externo podem editar apenas suas próprias
 */
function canEditComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin') return true;
    if (['gerente', 'fiscal', 'externo'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode deletar uma composição
 * Regra: Admin pode deletar todas. Gerente/Fiscal/Externo podem deletar apenas suas próprias
 */
function canDeleteComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin') return true;
    if (['gerente', 'fiscal', 'externo'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode fazer upload de composição
 * Regra: Apenas Admin
 */
function canUploadComposition() {
    return getCurrentUserRole() === 'admin';
}

/**
 * Verifica se o usuário pode criar novo orçamento
 * Regra: Apenas Admin
 */
function canCreateBudget() {
    return getCurrentUserRole() === 'admin';
}

/**
 * Verifica se o usuário pode criar nova versão de orçamento
 * Regra: Apenas Admin
 */
function canCreateBudgetVersion() {
    return getCurrentUserRole() === 'admin';
}

/**
 * Verifica se o usuário pode deletar um orçamento
 * Regra: Apenas Admin
 */
function canDeleteBudget() {
    return getCurrentUserRole() === 'admin';
}

/**
 * Verifica se o usuário pode visualizar abas de Painel Financeiro/Gerencial/Prazos
 * e se os dados devem ser filtrados por fiscal responsável
 */
function shouldFilterDataByFiscal() {
    return getCurrentUserRole() === 'fiscal';
}

/**
 * Verifica se o usuário pode ver ações em processos (botões de ação)
 * Regra: Apenas Admin e Gerente. Fiscal e Externo não podem ver
 */
function canSeeProcessActions() {
    const role = getCurrentUserRole();
    return ['admin', 'gerente'].includes(role);
}

/**
 * Verifica se o usuário pode marcar processo como prioritário
 * Regra: Apenas Admin e Gerente. Fiscal e Externo não podem
 */
function canMarkProcessAsPriority() {
    const role = getCurrentUserRole();
    // apenas administrador pode alterar prioridades
    return role === 'admin';
}

/**
 * Verifica se o usuário pode marcar data como meta
 * Regra: apenas Admin pode (
 */
function canMarkDateAsMeta() {
    const role = getCurrentUserRole();
    // gerentes não têm essa permissão
    return role === 'admin';
}


// Ao carregar, aplica role salvo (se houver)
(function () {
    const savedRole = sessionStorage.getItem('sop_role') || 'guest';
    console.log('[DEBUG] IIFE: Role salvo ao iniciar:', savedRole);

    const savedEmail = sessionStorage.getItem('sop_user');
    const savedUserName = sessionStorage.getItem('sop_user_name');

    // Se não tem nome ou se o nome salvo é apenas números (matrícula), tenta buscar o nome real
    if (savedEmail && (!savedUserName || /^\d+$/.test(savedUserName))) {
        sbClient.from('app_users').select('full_name, nome, sobrenome').eq('email', savedEmail).single().then(res => {
            if (res.data) {
                let realName = '';
                if (res.data.full_name && !/^\d+$/.test(res.data.full_name)) {
                    realName = res.data.full_name;
                } else if (res.data.nome) {
                    realName = (res.data.nome + (res.data.sobrenome ? ' ' + res.data.sobrenome : '')).toUpperCase();
                }

                if (realName) {
                    sessionStorage.setItem('sop_user_name', realName);
                    console.log('[DEBUG] Nome do usuário corrigido/carregado:', realName);
                }
            }
        });
    }

    if (savedRole !== 'guest') {
        toggleLanding(false);
        console.log('[DEBUG] IIFE: Landing ocultado (usuário já autenticado)');
    } else {
        console.log('[DEBUG] IIFE: Nenhum usuário autenticado. Landing será exibida.');
    }
    applyRoleToUI(savedRole);
})();

/* ----------------------------------------------------------------
   Função: criar administrador inicial (nildeno e 99030487)
   Observação: agora suporta múltiplos admins iniciais.
---------------------------------------------------------------- */
/* ----------------------------------------------------------------
   Função: criar administrador inicial
---------------------------------------------------------------- */
/* ----------------------------------------------------------------
   Função: DIAGNSTICO E CORREO DE USUÁRIOS
---------------------------------------------------------------- */
/* ----------------------------------------------------------------
/* ----------------------------------------------------------------
   PROMOO AUTOMÁTICA DE ADMIN (99030487)
---------------------------------------------------------------- */
async function promoteAdmin99030487() {
    const targetEmail = '99030487@gecope.app';
    try {
        // Check user
        const { data, error } = await sbClient.from('app_users').select('role').eq('email', targetEmail).maybeSingle();

        if (data && data.role !== 'admin') {
            console.log('[AUTO-ADMIN] Promovendo 99030487 para ADMIN...');
            const { error: upErr } = await sbClient.from('app_users').update({ role: 'admin' }).eq('email', targetEmail);

            if (!upErr) {
                console.log('[AUTO-ADMIN] Sucesso!');
                // Update session if logged in
                const current = sessionStorage.getItem('sop_user');
                if (current === targetEmail) {
                    sessionStorage.setItem('sop_role', 'admin');
                    applyRoleToUI('admin');
                    alert('Sua conta foi promovida para Administrador com sucesso.');
                }
            } else {
                console.error('[AUTO-ADMIN] Falha ao atualizar:', upErr);
            }
        }
    } catch (e) {
        console.error('[AUTO-ADMIN] Erro:', e);
    }
}

// Executa verificação ao carregar
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(promoteAdmin99030487, 500); // Otimizado de 2000ms
});

/* --------------------------------------------------------------
   MODAL: SELEO DE MDULOS (PS LOGIN)
-------------------------------------------------------------- */

const modules = [
    { id: '#pane-financeiro', name: 'Painel Financeiro' },
    { id: '#pane-gerencial', name: 'Painel Gerencial' },
    { id: '#pane-prazos', name: 'Prazos e Produtividade' },
    { id: '#pane-reuniao', name: 'Processos' },
    { id: '#pane-orcamentos', name: 'Orçamentos' },
    { id: '#pane-composicoes', name: 'Composições' },
    { id: '#pane-tabelas', name: 'Tabelas' }
];

function buildModuleSelector() {
    let html = `
                    < div class= "modal fade" id = "modalModuleSelector" tabindex = "-1" >
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Escolha os módulos</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="list-group">
                                    `;
    modules.forEach(m => {
        const key = `mod${m.id.replace('#', '')}`;
        const checked = (localStorage.getItem(key) === 'true') ? 'checked' : '';
        html += `<label class="list-group-item d-flex justify-content-between align-items-center"><span>${m.name}</span><input type="checkbox" data-target="${m.id}" class="module-checkbox" ${checked}></label>`;
    });
    html += `</div></div><div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button><button class="btn btn-primary" id="btn-apply-modules">Aplicar</button></div></div></div></div > `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('btn-apply-modules').addEventListener('click', () => {
        document.querySelectorAll('.module-checkbox').forEach(cb => {
            const target = cb.dataset.target; const key = `mod${target.replace('#', '')}`;
            localStorage.setItem(key, cb.checked ? 'true' : 'false');
            const tabBtn = document.querySelector(`[data - bs - target= "${target}"]`);
            if (tabBtn) tabBtn.parentElement.style.display = cb.checked ? '' : 'none';
        });
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalModuleSelector'));
        if (modal) modal.hide();
    });
}

function openModuleSelector() {
    // Se ainda não existe, cria
    if (!document.getElementById('modalModuleSelector')) buildModuleSelector();
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalModuleSelector'));
    modal.show();
}

// Expose helper to global (for onclick from HTML)
try { window.hideAdminPendings = hideAdminPendings; } catch (e) { /* ignore */ }

// Botão do cabeçalho agora abre seleção se estiver logado, ou landing se não
document.getElementById('btn-admin-login')?.addEventListener('click', () => {
    const user = sessionStorage.getItem('sop_user');
    if (!user) {
        toggleLanding(true);
        return;
    }
    openModuleSelector();
});

// --- FIM DA LGICA ADMINISTRATIVA ---

/* --- LGICA DE ORAMENTOS (SUPABASE STORAGE + DB) --- */

// 1. SALVAR NOVO ORAMENTO (V1) - CORRIGIDO
// Função auxiliar para remover acentos e caracteres especiais (Coloque isso fora ou antes da função salvar)
function limparStringParaPath(str) {
    if (!str) return "";
    return str
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos ( -> E)
        .replace(/\s+/g, "_") // Troca espaços por underline
        .replace(/[^a-zA-Z0-9._-]/g, "") // Remove qualquer outro caractere especial
        .toUpperCase();
}

// 1. SALVAR NOVO ORAMENTO (V1) - VERSO FINAL COM CORREO DE PATH
async function salvarNovoOrcamento() {
    const form = document.getElementById('formNovoOrcamento');

    // Validação básica do HTML
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const formData = new FormData(form);
    const arquivo = document.getElementById('inputArquivoUpload').files[0];

    // Busca botão globalmente
    const btn = document.querySelector('button[onclick="salvarNovoOrcamento()"]');

    // UI Loading
    let textoOriginal = "Salvar";
    if (btn) {
        textoOriginal = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ENVIANDO...';
    }

    try {
        if (!arquivo) {
            alert("Por favor, selecione um arquivo.");
            if (btn) { btn.disabled = false; btn.innerText = textoOriginal; }
            return;
        }

        // 1. Captura os valores originais (com acento) para o Banco de Dados
        const categoria = formData.get('CATEGORIA').trim();
        const subcategoria = formData.get('SUBCATEGORIA').trim();
        const obra = formData.get('OBRA').trim();

        // 2. Gera versões "limpas" para o caminho do Storage (sem acentos/espaços)
        const catPath = limparStringParaPath(categoria);
        const subPath = limparStringParaPath(subcategoria);
        const obraPath = limparStringParaPath(obra);
        const arquivoNomePath = limparStringParaPath(arquivo.name);

        // Caminho seguro: ESCOLAS/ENSINO_MEDIO/EEM_10_SALAS/V1_ARQUIVO.PDF
        const storagePath = `${catPath} /${subPath}/${obraPath}/V1_${arquivoNomePath}`;

        // 3. Upload para o Supabase Storage
        const { data: uploadData, error: uploadError } = await sbClient
            .storage
            .from('orcamentos')
            .upload(storagePath, arquivo, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) throw uploadError;

        // 4. Obter URL Pública
        const { data: publicUrlData } = sbClient
            .storage
            .from('orcamentos')
            .getPublicUrl(storagePath);

        const publicUrl = publicUrlData.publicUrl;

        // 5. Salvar Metadados no Banco de Dados (Usando os nomes Originais com acento)
        const payload = {
            categoria: categoria.toUpperCase(),       // Salva "ESCOLAS"
            subcategoria: subcategoria.toUpperCase(), // Salva "ESCOLAS DE ENSINO MDIO"
            nome_obra: obra.toUpperCase(),            // Salva "EEM - 10 SALAS"
            status: formData.get('STATUS'),
            versao_atual: 'V1',
            arquivo_url: publicUrl,
            arquivo_path: storagePath, // Salva o caminho técnico
            historico_versoes: [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Upload Inicial',
                url: publicUrl,
                autor: 'Sistema'
            }]
        };

        const { error: dbError } = await sbClient
            .from('orcamentos_biblioteca')
            .insert([payload]);

        if (dbError) throw dbError;

        alert(" Orçamento cadastrado com sucesso!");

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `cadastrou o orçamento da obra ${obra}`, '', obra);

        // Limpar e Fechar
        form.reset();
        const modalEl = document.getElementById('modalNovoOrcamento');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.hide();

        carregarOrcamentos();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    }
}

/* --- 2. CARREGAR ORAMENTOS (CORRIGIDO VFINAL) --- */
// 2. CARREGAR ORAMENTOS (VERSO FINAL CORRIGIDA)
/* --- 2. CARREGAR ORAMENTOS (COM ORDENAO NUMRICA CORRIGIDA) --- */

async function deletarItemHistoricoOrcamento(id, index) {
    if (!confirm("️ Tem certeza que deseja excluir este registro do histórico?")) return;

    const btn = document.activeElement;
    if (btn) btn.disabled = true;

    try {
        const { data, error } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao, versao_atual').eq('id', id).single();
        if (error) throw error;

        let historico = data.comentarios_revisao || [];

        // Remove o item pelo índice (como a lista é renderizada na ordem do array, o índice bate)
        // IMPORTANTE: splice altera o array original in-place
        if (index >= 0 && index < historico.length) {
            historico.splice(index, 1);
        } else {
            throw new Error("Item não encontrado.");
        }


        let payloadUpdate = { comentarios_revisao: historico };

        // --- LGICA DE STATUS DINMICO ---
        const temPendentes = historico.some(c => c.decisao === 'pendente');

        if (temPendentes) {
            payloadUpdate.status = 'Em Revisão';
        } else {
            // Se não há pendentes, checa se há versões além da V1 para manter "Atualizado" ou voltar para "Disponível"
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        if (historico.length === 0) {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        const { error: updateError } = await sbClient.from('orcamentos_biblioteca').update(payloadUpdate).eq('id', id);
        if (updateError) throw updateError;

        alert("Registro excluído!");
        carregarOrcamentos();

    } catch (err) {
        alert("Erro ao excluir: " + err.message);
        if (btn) btn.disabled = false;
    }
}

async function carregarOrcamentos() {
    const container = document.getElementById('accordionOrcamentos');
    const termoBusca = document.getElementById('orcamento-search').value.toLowerCase();
    const role = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
    const isAdmin = (document.body.classList.contains('is-admin') || role === 'admin' || role === 'gerente') && role !== 'fiscal';

    let data = [];
    let hasMore = true;
    let blockStart = 0;
    const blockSize = 1000;
    let queryError = null;

    while (hasMore) {
        const { data: bData, error } = await sbClient
            .from('orcamentos_biblioteca')
            .select('*')
            .order('categoria', { ascending: true })
            .order('subcategoria', { ascending: true })
            .order('nome_obra', { ascending: true })
            .range(blockStart, blockStart + blockSize - 1);

        if (error) {
            queryError = error;
            break;
        }

        if (bData && bData.length > 0) {
            data = data.concat(bData);
            blockStart += blockSize;
            if (bData.length < blockSize) {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    }

    if (queryError) { container.innerHTML = `Erro: ${queryError.message}`; return; }
    if (data.length === 0) { container.innerHTML = `<div class="text-center mt-5 text-muted">Nenhum orçamento encontrado.</div>`; return; }

    const arvore = {};
    data.forEach(item => {
        const nomeObra = (item.nome_obra || "").toLowerCase();
        const categoria = (item.categoria || "").toLowerCase();
        if (termoBusca && !nomeObra.includes(termoBusca) && !categoria.includes(termoBusca)) return;

        const cat = item.categoria || "Sem Categoria";
        const sub = item.subcategoria || "Sem Subcategoria";

        if (!arvore[cat]) arvore[cat] = {};
        if (!arvore[cat][sub]) arvore[cat][sub] = [];
        arvore[cat][sub].push(item);
    });


    let html = '';
    let catIndex = 0;

    for (const [cat, subcats] of Object.entries(arvore)) {
        catIndex++;
        const collapseId = `collapseCat${catIndex}`;

        html += `
        <div class="accordion-custom-item">
            <h2 class="accordion-header">
                <button class="accordion-button accordion-custom-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    <i class="bi bi-folder2-open me-2 text-warning"></i> ${cat}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse">
                <div class="accordion-body bg-white pt-2">`;

        for (const [sub, itens] of Object.entries(subcats)) {
            html += `<div class="subcategoria-header" style="margin-left: 10px;">${sub}</div>`;

            // --- CORREO AQUI: ORDENAO NATURAL (6 antes de 10) ---
            itens.sort((a, b) => {
                const nomeA = a.nome_obra || "";
                const nomeB = b.nome_obra || "";
                return nomeA.localeCompare(nomeB, 'pt-BR', { numeric: true });
            });
            // -------------------------------------------------------


            itens.forEach(obra => {
                const iconClass = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? 'icon-pdf' : 'icon-xls';
                const iconSymbol = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? '<i class="bi bi-file-earmark-pdf"></i>' : '<i class="bi bi-file-earmark-spreadsheet"></i>';
                const dataFormatada = new Date(obra.created_at).toLocaleDateString('pt-BR');

                // --- 1. BADGES DE STATUS (DINMICO) ---
                let badgeStatus = '';
                let historicoParaStatus = [];
                try {
                    historicoParaStatus = typeof obra.comentarios_revisao === 'string' ? JSON.parse(obra.comentarios_revisao) : (obra.comentarios_revisao || []);
                    if (!Array.isArray(historicoParaStatus)) historicoParaStatus = [];
                } catch (e) { historicoParaStatus = []; }

                const temPendenteReal = historicoParaStatus.some(c => c.decisao === 'pendente');


                if (temPendenteReal) {
                    badgeStatus = `<span class="badge bg-warning text-dark ms-2" style="font-size:0.65rem">Em Revisão</span>`;
                } else if (obra.status === 'Atualizado' || parseInt(obra.versao_atual?.replace(/[^0-9]/g, '')) > 1) {
                    // Badge Azul solicitado
                    badgeStatus = `<span class="badge badge-status-atualizado">Atualizado</span>`;
                }

                // --- 2. HISTÓRICO ---
                const historico = obra.comentarios_revisao || [];
                const qtdComentarios = historico.length;
                const histId = `hist_${obra.id}`;

                let botaoHistorico = '';
                let containerHistorico = '';

                if (qtdComentarios > 0) {
                    botaoHistorico = `
                        <button class="btn-toggle-history" type="button" data-bs-toggle="collapse" data-bs-target="#${histId}">
                            <i class="bi bi-clock-history"></i> Histórico (${qtdComentarios}) <i class="bi bi-chevron-down ms-1"></i>
                        </button>`;

                    const listaComentarios = historico.map((c, index) => {
                        const dataComent = c.data ? new Date(c.data).toLocaleDateString('pt-BR') : '-';
                        let classeStatus = '';
                        let badgeDecisao = '';
                        let respostaAdminHTML = '';
                        let botoesAcaoAdmin = '';

                        const isSystemLog = (c.autor && c.autor.toLowerCase().includes('sistema')) || (c.mensagem && c.mensagem.toLowerCase().includes('gerada versão'));

                        if (isSystemLog) {
                            classeStatus = 'system-log-entry';
                        }

                        if (c.decisao === 'atendido') {
                            classeStatus = 'status-atendido';
                            badgeDecisao = `<span class="badge-decision badge-atendido"><i class="bi bi-check-lg"></i> ATENDIDO</span>`;
                            if (c.resp_admin) respostaAdminHTML = `<div class="mt-2 pt-2 border-top small text-success"><strong>Resposta:</strong> ${c.resp_admin}</div>`;
                        } else {
                            if (c.decisao === 'recusado') {
                                classeStatus = 'status-recusado';
                                badgeDecisao = `<span class="badge-decision badge-recusado"><i class="bi bi-x-lg"></i> NO ACATADO</span>`;
                                if (c.resp_admin) respostaAdminHTML = `<div class="mt-2 pt-2 border-top small text-danger"><strong>Motivo:</strong> ${c.resp_admin}</div>`;
                            } else {
                                if (isAdmin && !isSystemLog) {
                                    botoesAcaoAdmin = `
                                <div class="admin-decision-actions">
                                    <button class="btn btn-sm btn-outline-success" onclick="abrirModalAtender(${obra.id}, ${index})">
                                        <i class="bi bi-check-lg"></i> Atender
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="abrirModalRecusar(${obra.id}, ${index})">
                                        <i class="bi bi-x-lg"></i> Não Acatar
                                    </button>
                                </div>`;
                                }
                            }
                        }


                        let btnAnexo = '';
                        if (c.arquivo) {
                            btnAnexo = `<a href="${c.arquivo}" target="_blank" class="btn-history-anexo mt-2"><i class="bi bi-paperclip"></i> Ver Memória/Anexo</a>`;
                        }

                        let btnExcluirHist = '';
                        if (isAdmin) {
                            btnExcluirHist = `<button class="btn btn-sm text-danger border-0 p-0 ms-2 admin-only" title="Excluir Registro" onclick="deletarItemHistoricoOrcamento(${obra.id}, ${index})"><i class="bi bi-x-lg"></i></button>`;
                        }

                        return `
                        <div class="history-card-item ${classeStatus}">
                            <div class="history-card-header">
                                <div><strong>${c.autor}</strong> <span class="fw-normal ms-1">- ${dataComent}</span></div>
                                <div class="d-flex align-items-center">
                                    ${badgeDecisao}
                                    ${btnExcluirHist}
                                </div>
                            </div>
                            <div class="history-card-body">
                                <div>${c.mensagem}</div>
                                ${btnAnexo}
                                ${respostaAdminHTML}
                                ${botoesAcaoAdmin}
                            </div>
                        </div>`;
                    }).join('');

                    containerHistorico = `
                    <div class="collapse" id="${histId}">
                        <div class="history-collapse-box">
                            ${listaComentarios}
                        </div>
                    </div>`;
                }

                html += `
                <div class="mb-2">
                    <div class="orcamento-item-row" style="margin-bottom:0; border-radius: 8px 8px ${qtdComentarios > 0 ? '0 0' : '8px 8px'};">
                        <div class="d-flex align-items-center">
                            <div class="file-icon-box ${iconClass}">${iconSymbol}</div>
                            <div>
                                <div class="d-flex align-items-center flex-wrap">
                                    <span class="fw-bold text-dark" style="font-size:0.95rem;">${obra.nome_obra}</span>
                                    <span class="badge bg-secondary ms-2" style="font-size:0.7rem;">${obra.versao_atual}</span>
                                    ${badgeStatus}
                                </div>
                                <div class="text-muted mt-1" style="font-size:0.75rem;">Criado em: ${dataFormatada}</div>
                                ${botaoHistorico}
                            </div>
                        </div>
                        <div class="orcamento-actions">
                            <a href="${obra.arquivo_url}" target="_blank" class="btn-action-baixar" title="Baixar Arquivo"><i class="bi bi-download"></i> Baixar</a>
                            <!-- Nova Versão: APENAS ADMIN -->
                            <button class="btn btn-action-icon admin-only" onclick="prepararNovaVersao(${obra.id})" title="Nova Versão"><i class="bi bi-cloud-arrow-up-fill icon-cloud"></i></button>
                            <!-- Comentário: VISÍVEL PARA TODOS -->
                            <button class="btn btn-action-icon" onclick="prepararComentario(${obra.id})" title="Adicionar Comentário"><i class="bi bi-chat-left-text-fill text-warning"></i></button>
                            <!-- Excluir: APENAS ADMIN E NO FISCAL -->
                            <button class="btn btn-action-icon admin-only" onclick="deletarOrcamento(${obra.id}, '${obra.arquivo_path}')"><i class="bi bi-trash-fill icon-trash"></i></button>
                        </div>
                    </div>
                    ${containerHistorico}
                </div>`;
            });
        }
        html += `   </div></div></div>`;
    }
    container.innerHTML = html;
}

/* --- FUNES DE DECISO (ATUALIZADAS E SIMPLIFICADAS) --- */


// Hook para buscar ao digitar (debounce simples)
document.getElementById('orcamento-search')?.addEventListener('input', debounce(() => {
    carregarOrcamentos();
}, 500));

// Clear Listener Orçamentos
document.getElementById('btn-orc-clear')?.addEventListener('click', () => {
    const input = document.getElementById('orcamento-search');
    if (input) {
        input.value = '';
        carregarOrcamentos();
    }
});

// 3. ENVIAR NOVA VERSO (V2, V3...)
function prepararNovaVersao(id) {
    document.getElementById('update-id-orcamento').value = id;
    document.getElementById('formNovaVersao').reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersao')).show();
}

/* --- ENVIO DE NOVA VERSO (MUDA STATUS PARA ATUALIZADO) --- */
async function enviarNovaVersao() {
    const id = document.getElementById('update-id-orcamento').value;
    const arquivo = document.getElementById('inputArquivoUpdate').files[0];
    const descricao = document.getElementById('inputDescricaoUpdate').value;

    if (!arquivo) { alert("Selecione um arquivo."); return; }

    const btn = document.querySelector('#modalNovaVersao button[onclick="enviarNovaVersao()"]');
    const txtOrig = btn.innerText;
    btn.disabled = true; btn.innerText = "Processando...";

    try {
        // 1. Pegar dados atuais
        const { data: currentData } = await sbClient.from('orcamentos_biblioteca').select('*').eq('id', id).single();

        // 2. LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS
        if (currentData.comentarios_revisao && currentData.comentarios_revisao.length > 0) {
            await limparArquivosComentariosResolvidos('orcamentos_biblioteca', 'orcamentos', currentData.comentarios_revisao);
        }

        // 3. Calcular nova versão
        const currentV = parseInt(currentData.versao_atual.replace(/[^0-9]/g, '')) || 1;
        const newVersionLabel = `V${currentV + 1}`;

        // 4. Upload Novo Arquivo
        const nomeLimpo = arquivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
        const pathParts = currentData.arquivo_path.split('/');
        if (pathParts.length > 1) pathParts.pop();
        const folderPath = pathParts.join('/');
        const newStoragePath = `${folderPath}/${newVersionLabel}_${nomeLimpo}`;

        const { error: uploadError } = await sbClient.storage.from('orcamentos').upload(newStoragePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = sbClient.storage.from('orcamentos').getPublicUrl(newStoragePath);

        // 5. Atualizar Histórico de Versões
        const oldHistory = currentData.historico_versoes || [];
        oldHistory.push({
            versao: currentData.versao_atual,
            url: currentData.arquivo_url,
            data: new Date().toISOString(),
            motivo: 'Versão arquivada'
        });

        // 6. Update na Tabela -> AQUI MUDA O STATUS PARA "ATUALIZADO"
        const { error: updateError } = await sbClient
            .from('orcamentos_biblioteca')
            .update({
                versao_atual: newVersionLabel,
                arquivo_url: publicUrlData.publicUrl,
                arquivo_path: newStoragePath,
                historico_versoes: oldHistory,
                status: 'Atualizado', // <--- MUDANA AUTOMÁTICA DE STATUS
                created_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) throw updateError;

        // Notificação WhatsApp
        processarNotificacao('atualizacao_orcamento', {
            REF_ORCAMENTO: currentData?.obra || currentData?.processo || 'N/A'
        });

        // Se houver descrição, salva como comentário de sistema
        if (descricao) {
            await salvarComentarioNoBanco(id, 'Sistema (Versão)', `Gerada versão ${newVersionLabel}: ${descricao}`);
        }

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `atualizou a versão (${newVersionLabel}) do orçamento: ${currentData?.nome_obra || 'N/A'}`, '', currentData?.nome_obra);

        alert(`Versão ${newVersionLabel} enviada! Status alterado para ATUALIZADO. Arquivos de comentários resolvidos foram limpos.`);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersao')).hide();
        carregarOrcamentos();

    } catch (err) {
        alert("Erro: " + err.message);
    } finally {
        btn.disabled = false; btn.innerText = txtOrig;
    }
}

// 4. REVISES E COMENTÁRIOS
async function prepararComentario(id) {
    try {
        const modalEl = document.getElementById('modalComentarioOrcamento');
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        document.getElementById('coment-id-orcamento').value = id;
        const { data, error } = await sbClient.from('orcamentos_biblioteca').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('coment-nome-obra').value = data.nome_obra || '';
        document.querySelector('#formComentarioOrcamento textarea[name="MENSAGEM"]').value = '';

        const sel = document.getElementById('coment-fiscal');
        // Preenche automaticamente com o usuário logado
        const currentUserName = sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Usuário';
        sel.innerHTML = `<option value="${currentUserName}" selected>${currentUserName}</option>`;
        // Visualmente "readonly"
        sel.style.backgroundColor = '#e9ecef';
        sel.style.pointerEvents = 'none';

        const chatContainer = document.getElementById('historico-comentarios');
        const comentarios = data.comentarios_revisao || [];
        chatContainer.innerHTML = comentarios.length ? comentarios.map(c => `
                            <div class="mb-2 border-bottom pb-1">
                                <div class="d-flex justify-content-between"><strong class="text-primary" style="font-size:0.75rem">${c.autor}</strong><span class="text-muted" style="font-size:0.7rem">${c.data ? new Date(c.data).toLocaleDateString() : '-'}</span></div>
                                <div style="font-size:0.8rem">${c.mensagem}</div>
                                ${c.arquivo ? `<a href="${c.arquivo}" target="_blank" class="badge bg-light text-dark border mt-1"><i class="bi bi-paperclip"></i> Anexo</a>` : ''}
                            </div>`).join('') : '<em class="text-muted">Sem mensagens.</em>';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) { alert("Erro: " + err.message); }
}

/* --- ENVIO DE COMENTÁRIO (MUDA STATUS PARA EM REVISÃO) --- */
async function enviarComentarioOrcamento() {
    const id = document.getElementById('coment-id-orcamento').value;
    const autor = document.getElementById('coment-fiscal').value;
    const msg = document.querySelector('textarea[name="MENSAGEM"]').value;
    const arquivoAnexo = document.getElementById('inputArquivoComentario').files[0];

    if (!autor || !msg) { alert("Preencha autor e mensagem."); return; }

    try {
        let anexoUrl = null;
        if (arquivoAnexo) {
            const nomeLinpo = sanitizarNomeArquivo(arquivoAnexo.name);
            const path = `anexos_comentarios/${id}_${Date.now()}_${nomeLinpo}`;
            const { error: uploadError } = await sbClient.storage.from('orcamentos').upload(path, arquivoAnexo);
            if (uploadError) throw uploadError;
            const { data } = sbClient.storage.from('orcamentos').getPublicUrl(path);
            anexoUrl = data.publicUrl;
        }

        // Buscar histórico atual
        const { data: curr } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao, nome_obra').eq('id', id).single();
        const novoArr = curr.comentarios_revisao || [];

        novoArr.unshift({
            autor: autor,
            mensagem: msg,
            data: new Date().toISOString(),
            arquivo: anexoUrl,
            decisao: 'pendente' // Novo comentário nasce pendente
        });

        // Atualiza status para "Em Revisão"
        const { error: updateError } = await sbClient.from('orcamentos_biblioteca').update({
            comentarios_revisao: novoArr,
            status: 'Em Revisão'  // <--- FORA O STATUS DE REVISÃO
        }).eq('id', id);

        if (updateError) throw updateError;

        // Notificação WhatsApp
        processarNotificacao('novo_comentario_orcamento', {
            NOME_USUARIO: autor,
            REF_ORCAMENTO: curr?.nome_obra || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `adicionou um comentário no orçamento: ${curr?.nome_obra || 'N/A'}`, '', curr?.nome_obra);

        alert("Solicitação enviada!");
        bootstrap.Modal.getInstance(document.getElementById('modalComentarioOrcamento')).hide();
        carregarOrcamentos();
    } catch (err) {
        alert("Erro ao enviar: " + err.message);
    }
}

// Função auxiliar usada internamente
async function salvarComentarioNoBanco(id, autor, mensagem) {
    const { data: curr } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao').eq('id', id).single();
    const novoArr = curr.comentarios_revisao || [];
    novoArr.unshift({ autor, mensagem, data: new Date().toISOString() });
    await sbClient.from('orcamentos_biblioteca').update({ comentarios_revisao: novoArr }).eq('id', id);

    // Log de Atividade
    const { data: bData } = await sbClient.from('orcamentos_biblioteca').select('descricao').eq('id', id).single();
    registrarAtividade('ORCAMENTO', `registrou um comentário no orçamento: ${bData?.descricao || 'N/A'}`, '', bData?.descricao);
}

/* --- MOTORES GENRICOS (OTIMIZAO) --- */

async function processarDecisaoGenerica(config) {
    const { table, id, index, decision, respText, modalId, callback } = config;
    const btn = document.querySelector(`#${modalId} .btn-success, #${modalId} .btn-danger`);
    const txtOrig = btn?.innerHTML || "Confirmar";

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processando...';
    }

    try {
        const { data } = await sbClient.from(table).select('comentarios_revisao, status, versao_atual').eq('id', id).single();
        const hist = data.comentarios_revisao || [];

        // Verificar se o comentário tem arquivo anexado antes de resolver
        const comentarioAtual = hist[index];
        let arquivoParaDeletar = null;
        if (comentarioAtual && comentarioAtual.arquivo) {
            arquivoParaDeletar = comentarioAtual.arquivo;
        }

        if (hist[index]) {
            hist[index].decisao = decision;
            hist[index].resp_admin = respText || (decision === 'atendido' ? "Solicitação atendida." : "Solicitação não acatada.");
            hist[index].data_resp = new Date().toISOString();
        }

        // --- RECÁLCULO DE STATUS ---
        const temPendentes = hist.some(c => c.decisao === 'pendente');
        let novoStatus = data.status || 'Disponível';

        if (temPendentes) {
            novoStatus = 'Em Revisão';
        } else {
            // Se resolveu todos os pendentes, volta para "Atualizado" (se for V2+) ou "Disponível"
            const vStr = data.versao_atual || 'V1';
            const vNum = parseInt(vStr.replace(/[^0-9]/g, '')) || 1;
            novoStatus = (vNum > 1) ? 'Atualizado' : 'Disponível';
        }

        const { error } = await sbClient.from(table).update({
            comentarios_revisao: hist,
            status: novoStatus
        }).eq('id', id);
        if (error) throw error;

        // --- LIMPAR ARQUIVO ANEXADO APS RESOLVER O COMENTÁRIO ---
        if (arquivoParaDeletar) {
            const storageBucket = table === 'orcamentos_biblioteca' ? 'orcamentos' : 'composicoes_biblioteca';
            const path = extrairPathDoStorage(arquivoParaDeletar);
            if (path) {
                try {
                    console.log(`Deletando arquivo anexado do comentário resolvido: ${path}`);
                    const { error: deleteError } = await sbClient.storage.from(storageBucket).remove([path]);
                    if (deleteError) {
                        console.error('Erro ao deletar arquivo:', deleteError);
                    } else {
                        console.log('Arquivo deletado com sucesso');
                    }
                } catch (err) {
                    console.error('Erro ao limpar arquivo:', err);
                }
            }
        }

        alert("Ação realizada com sucesso!");
        bootstrap.Modal.getInstance(document.getElementById(modalId)).hide();
        if (callback) callback();
    } catch (err) {
        alert("Erro: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = txtOrig; }
    }
}

function abrirModalDecisao(modalId, id, idx, idInput, idxInput, formId) {
    const modalEl = document.getElementById(modalId);
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
    document.getElementById(idInput).value = id;
    document.getElementById(idxInput).value = idx;
    document.getElementById(formId)?.reset();
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function processarAtendimento() {
    const id = document.getElementById('atender-id-orcamento').value;
    const index = document.getElementById('atender-index-comentario').value;
    const resp = document.getElementById('textoAtender').value;
    await processarDecisaoGenerica({
        table: 'orcamentos_biblioteca', id, index, decision: 'atendido',
        respText: resp, modalId: 'modalAtenderRevisao', callback: carregarOrcamentos
    });
}

async function processarRecusa() {
    const id = document.getElementById('recusar-id-orcamento').value;
    const index = document.getElementById('recusar-index-comentario').value;
    const resp = document.getElementById('textoRecusar').value;
    await processarDecisaoGenerica({
        table: 'orcamentos_biblioteca', id, index, decision: 'recusado',
        respText: resp, modalId: 'modalRecusarRevisao', callback: carregarOrcamentos
    });
}

async function processarAtendimentoComposicao() {
    const id = document.getElementById('atender-id-composicao').value;
    const index = document.getElementById('atender-index-comentario-comp').value;
    const resp = document.getElementById('textoAtenderComp').value;
    await processarDecisaoGenerica({
        table: 'composicoes_biblioteca', id, index, decision: 'atendido',
        respText: resp, modalId: 'modalAtenderComposicao', callback: carregarComposicoes
    });
}

async function processarRecusaComposicao() {
    const id = document.getElementById('recusar-id-composicao').value;
    const index = document.getElementById('recusar-index-comentario-comp').value;
    const resp = document.getElementById('textoRecusarComp').value;
    await processarDecisaoGenerica({
        table: 'composicoes_biblioteca', id, index, decision: 'recusado',
        respText: resp, modalId: 'modalRecusarComposicao', callback: carregarComposicoes
    });
}

async function deletarRegistroGenerico(table, bucket, id, path, callback) {
    if (!confirm("️ TEM CERTEZA?\n\nIsso apagará permanentemente o registro e o arquivo associado.")) return;
    document.body.style.cursor = 'wait';
    try {
        if (path) await sbClient.storage.from(bucket).remove([path]);
        const { error } = await sbClient.from(table).delete().eq('id', id);
        if (error) throw error;
        alert(" Excluído com sucesso!");
        if (callback) callback();
    } catch (err) {
        alert("Erro ao excluir: " + err.message);
    } finally {
        document.body.style.cursor = 'default';
    }
}

async function deletarOrcamento(id, path) {
    await deletarRegistroGenerico('orcamentos_biblioteca', 'orcamentos', id, path, carregarOrcamentos);
}

async function deletarComposicao(id, path) {
    await deletarRegistroGenerico('composicoes_biblioteca', 'composicoes_biblioteca', id, path, carregarComposicoes);
}





/* --- FUNES DE DECISO CORRIGIDAS (RESOLVE TELA ESCURA) --- */

// 1. ABRIR MODAL ATENDER
function abrirModalAtender(id, index) {
    abrirModalDecisao('modalAtenderRevisao', id, index, 'atender-id-orcamento', 'atender-index-comentario', 'formAtender');
}

// 2. PROCESSAR ATENDIMENTO


// 3. ABRIR MODAL RECUSAR
function abrirModalRecusar(id, index) {
    abrirModalDecisao('modalRecusarRevisao', id, index, 'recusar-id-orcamento', 'recusar-index-comentario', 'formRecusar');
}

/* ==========================================================================
   LGICA DAS NOVAS ABAS: COMPOSIÇÕES E TABELAS
   ========================================================================== */

/* ==========================================================================
   LGICA DAS NOVAS ABAS: COMPOSIÇÕES E TABELAS
   ========================================================================== */

/* --- 1. LGICA DE COMPOSIÇÕES (IDNTICA A ORAMENTOS) --- */

// 1.1 SALVAR NOVA COMPOSIÇÃO
async function salvarNovaComposicao() {
    const form = document.getElementById('formNovaComposicao');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const formData = new FormData(form);
    const arquivo = document.getElementById('inputArquivoUploadComp').files[0];
    const btn = document.querySelector('button[onclick="salvarNovaComposicao()"]');

    let textoOriginal = "Salvar";
    if (btn) {
        textoOriginal = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ENVIANDO...';
    }

    try {
        if (!arquivo) throw new Error("Selecione um arquivo.");

        const categoria = formData.get('CATEGORIA').trim();
        const subcategoria = formData.get('SUBCATEGORIA').trim();
        const obra = formData.get('OBRA').trim();

        const catPath = limparStringParaPath(categoria);
        const subPath = limparStringParaPath(subcategoria);
        const obraPath = limparStringParaPath(obra);
        const arquivoNomePath = limparStringParaPath(arquivo.name);

        // Caminho no Bucket 'composicoes_biblioteca'
        const storagePath = `${catPath}/${subPath}/${obraPath}/V1_${arquivoNomePath}`;

        const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(storagePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(storagePath);

        const payload = {
            usuario: categoria.toUpperCase(),
            subcategoria: subcategoria.toUpperCase(),
            descricao: obra.toUpperCase(),
            status: formData.get('STATUS'),
            versao_atual: 'V1',
            arquivo_url: publicUrlData.publicUrl,
            arquivo_path: storagePath,
            criador_email: sessionStorage.getItem('sop_user') || 'sistema',
            criador_nome: sessionStorage.getItem('sop_user_name') || 'SISTEMA',
            criador_role: sessionStorage.getItem('sop_role') || 'fiscal',
            historico_versoes: [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Upload Inicial',
                url: publicUrlData.publicUrl,
                autor: sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Sistema'
            }]
        };

        const { error: dbError } = await sbClient.from('composicoes_biblioteca').insert([payload]);
        if (dbError) throw dbError;

        // Notificação WhatsApp
        processarNotificacao('atualizacao_composicao', {
            CODIGO_COMPOSICAO: payload.usuario || 'N/A',
            DESCRICAO: payload.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `cadastrou a composição: ${obra}`, '', obra);

        alert(" Composição cadastrada com sucesso!");
        form.reset();
        bootstrap.Modal.getInstance(document.getElementById('modalCadastrarComposicao')).hide();
        carregarComposicoes();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }
    }
}

// 1.2 CARREGAR COMPOSIÇÕES
function prepararNovaVersaoComposicao(id) {
    document.getElementById('update-id-composicao').value = id;
    document.getElementById('formNovaVersaoComposicao').reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersaoComposicao')).show();
}

async function enviarNovaVersaoComposicao() {
    const id = document.getElementById('update-id-composicao').value;
    const arquivo = document.getElementById('inputArquivoUpdateComp').files[0];
    const descricao = document.getElementById('inputDescricaoUpdateComp').value;

    if (!arquivo) return alert("Selecione um arquivo.");

    const btn = document.querySelector('#modalNovaVersaoComposicao button[onclick="enviarNovaVersaoComposicao()"]');
    const txtOrig = btn.innerText;
    btn.disabled = true; btn.innerText = "Processando...";

    try {
        const { data: currentData } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();

        // LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS
        if (currentData.comentarios_revisao && currentData.comentarios_revisao.length > 0) {
            await limparArquivosComentariosResolvidos('composicoes_biblioteca', 'composicoes_biblioteca', currentData.comentarios_revisao);
        }

        const currentV = parseInt(currentData.versao_atual.replace(/[^0-9]/g, '')) || 1;
        const newVersionLabel = `V${currentV + 1}`;

        // Upload
        const nomeLimpo = arquivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
        const pathParts = currentData.arquivo_path.split('/');
        if (pathParts.length > 1) pathParts.pop();
        const newStoragePath = `${pathParts.join('/')}/${newVersionLabel}_${nomeLimpo}`;

        const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(newStoragePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: pubUrl } = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(newStoragePath);

        // Histórico
        const oldHistory = currentData.historico_versoes || [];
        oldHistory.push({ versao: currentData.versao_atual, url: currentData.arquivo_url, data: new Date().toISOString(), motivo: 'Versão arquivada' });

        // Update Table
        await sbClient.from('composicoes_biblioteca').update({
            versao_atual: newVersionLabel,
            arquivo_url: pubUrl.publicUrl,
            arquivo_path: newStoragePath,
            historico_versoes: oldHistory,
            status: 'Atualizado',
            created_at: new Date().toISOString()
        }).eq('id', id);

        if (descricao) {
            // Salvar comentário de sistema
            const { data: curr } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao').eq('id', id).single();
            const novoArr = curr.comentarios_revisao || [];
            novoArr.unshift({ autor: 'Sistema (Versão)', mensagem: `Gerada versão ${newVersionLabel}: ${descricao}`, data: new Date().toISOString() });
            await sbClient.from('composicoes_biblioteca').update({ comentarios_revisao: novoArr }).eq('id', id);
        }

        alert(`Versão ${newVersionLabel} de Composição enviada! Arquivos de comentários resolvidos foram limpos.`);

        // Notificação WhatsApp
        processarNotificacao('atualizacao_composicao', {
            CODIGO_COMPOSICAO: currentData?.codigo || 'N/A',
            DESCRICAO: currentData?.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `atualizou a versão (${newVersionLabel}) da composição: ${currentData?.descricao || 'N/A'}`, '', currentData?.descricao);

        bootstrap.Modal.getInstance(document.getElementById('modalNovaVersaoComposicao')).hide();
        carregarComposicoes();
    } catch (err) { alert("Erro: " + err.message); } finally { btn.disabled = false; btn.innerText = txtOrig; }
}

// 1.4 COMENTÁRIOS COMPOSIÇÃO
async function prepararComentarioComposicao(id) {
    try {
        const modalEl = document.getElementById('modalComentarioComposicao');
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        document.getElementById('coment-id-composicao').value = id;
        const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('coment-nome-composicao').value = data.descricao || '';
        document.querySelector('#formComentarioComposicao textarea[name="MENSAGEM"]').value = '';

        const sel = document.getElementById('coment-fiscal-comp');
        // Preenche automaticamente com o usuário logado
        const currentUserNameComp = sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Usuário';
        sel.innerHTML = `<option value="${currentUserNameComp}" selected>${currentUserNameComp}</option>`;
        // Visualmente "readonly"
        sel.style.backgroundColor = '#e9ecef';
        sel.style.pointerEvents = 'none';

        const chat = document.getElementById('historico-comentarios-comp');
        const comments = data.comentarios_revisao || [];

        chat.innerHTML = comments.length ? comments.map(c => `
                            <div class="mb-2 border-bottom pb-1">
                                <div class="d-flex justify-content-between"><strong class="text-primary" style="font-size:0.75rem">${c.autor}</strong><span class="text-muted" style="font-size:0.7rem">${new Date(c.data).toLocaleDateString()}</span></div>
                                <div style="font-size:0.8rem">${c.mensagem}</div>
                                ${c.arquivo ? `<a href="${c.arquivo}" target="_blank" class="badge bg-light text-dark border mt-1"><i class="bi bi-paperclip"></i> Anexo</a>` : ''}
                            </div>`).join('') : '<em class="text-muted">Sem mensagens.</em>';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) {
        alert("Erro ao carregar comentários: " + err.message);
    }
}

async function enviarComentarioComposicao() {
    const btn = document.querySelector('#modalComentarioComposicao .btn-primary');
    const txtOrig = btn.innerText;

    const id = document.getElementById('coment-id-composicao').value;
    const autor = document.getElementById('coment-fiscal-comp').value;
    const msg = document.querySelector('#formComentarioComposicao textarea[name="MENSAGEM"]').value;
    const anexo = document.getElementById('inputArquivoComentarioComp').files[0];

    if (!autor || !msg) return alert("Preencha autor e mensagem.");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enviando...';

    try {
        let anexoUrl = null;
        if (anexo) {
            const nomeLinpo = sanitizarNomeArquivo(anexo.name);
            const path = `anexos_comentarios/${id}_${Date.now()}_${nomeLinpo}`;
            const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(path, anexo);
            if (uploadError) throw uploadError;
            anexoUrl = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(path).data.publicUrl;
        }

        const { data: curr, error: fetchError } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao').eq('id', id).single();
        if (fetchError) throw fetchError;

        const novoArr = curr.comentarios_revisao || [];
        novoArr.unshift({ autor, mensagem: msg, data: new Date().toISOString(), arquivo: anexoUrl, decisao: 'pendente' });

        const { error: updateError } = await sbClient.from('composicoes_biblioteca').update({ comentarios_revisao: novoArr, status: 'Em Revisão' }).eq('id', id);
        if (updateError) throw updateError;

        alert("Solicitação enviada!");

        // Notificação WhatsApp
        processarNotificacao('novo_comentario_composicao', {
            AUTOR: autor,
            CODIGO_COMPOSICAO: curr?.codigo || 'N/A',
            DESCRICAO: curr?.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `adicionou um comentário na composição: ${curr?.descricao || 'N/A'}`, '', curr?.descricao);

        bootstrap.Modal.getInstance(document.getElementById('modalComentarioComposicao')).hide();
        carregarComposicoes();
    } catch (err) {
        alert("Erro ao enviar: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = txtOrig;
    }
}

function abrirModalAtenderComposicao(id, index) {
    abrirModalDecisao('modalAtenderComposicao', id, index, 'atender-id-composicao', 'atender-index-comentario-comp', 'formAtenderComp');
}

function abrirModalRecusarComposicao(id, index) {
    abrirModalDecisao('modalRecusarComposicao', id, index, 'recusar-id-composicao', 'recusar-index-comentario-comp', 'formRecusarComp');
}

async function deletarComposicao(id, path) {
    if (!confirm("️ Tem certeza que deseja EXCLUIR esta composição?")) return;
    try {
        if (path) await sbClient.storage.from('composicoes_biblioteca').remove([path]);
        await sbClient.from('composicoes_biblioteca').delete().eq('id', id);
        alert("Composição excluída!");
        carregarComposicoes();
    } catch (e) { alert("Erro: " + e.message); }
}

async function deletarItemHistoricoComposicao(id, index) {
    if (!confirm("️ Tem certeza que deseja excluir este registro do histórico?")) return;

    const btn = document.activeElement;
    if (btn) btn.disabled = true;

    try {
        const { data, error } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao, versao_atual').eq('id', id).single();
        if (error) throw error;

        let historico = data.comentarios_revisao || [];

        if (index >= 0 && index < historico.length) {
            historico.splice(index, 1);
        } else {
            throw new Error("Item não encontrado.");
        }

        let payloadUpdate = { comentarios_revisao: historico };

        // --- LGICA DE STATUS DINMICO ---
        const temPendentes = historico.some(c => c.decisao === 'pendente');
        if (temPendentes) {
            payloadUpdate.status = 'Em Revisão';
        } else {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        if (historico.length === 0) {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        const { error: updateError } = await sbClient.from('composicoes_biblioteca').update(payloadUpdate).eq('id', id);
        if (updateError) throw updateError;

        alert("Registro excluído!");
        carregarComposicoes();

    } catch (err) {
        alert("Erro ao excluir: " + err.message);
        if (btn) btn.disabled = false;
    }
}



// 1.2 CARREGAR COMPOSIÇÕES (CORRIGIDO)
async function carregarComposicoes() {
    const container = document.getElementById('accordionComposicoes');
    const termoBusca = document.getElementById('comp-search').value.toLowerCase();
    const role = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
    const isAdmin = (document.body.classList.contains('is-admin') || role === 'admin' || role === 'gerente') && role !== 'fiscal';
    const userEmail = sessionStorage.getItem('sop_user');
    const currentUserName = (sessionStorage.getItem('sop_user_name') || '').toUpperCase();
    const currentFiscalName = (sessionStorage.getItem('sop_fiscal_name') || '').toUpperCase();

    if (!container) return;
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 text-secondary fw-bold">Carregando composições...</div></div>';

    try {
        let data = [];
        let hasMore = true;
        let blockStart = 0;
        const blockSize = 1000;
        let queryError = null;

        while (hasMore) {
            const { data: bData, error } = await sbClient
                .from('composicoes_biblioteca')
                .select('*')
                .order('usuario', { ascending: true })
                .order('subcategoria', { ascending: true })
                .order('descricao', { ascending: true })
                .range(blockStart, blockStart + blockSize - 1);

            if (error) {
                queryError = error;
                break;
            }

            if (bData && bData.length > 0) {
                data = data.concat(bData);
                blockStart += blockSize;
                if (bData.length < blockSize) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        if (queryError) {
            console.error('[ERRO Composições]', queryError);
            container.innerHTML = `<div class="alert alert-danger">Erro ao carregar banco: ${queryError.message}</div>`;
            return;
        }

        console.log(`[DEBUG] Composições carregadas: ${data?.length || 0} registros.`);

        const arvore = {};
        data.forEach(item => {
            try {
                const desc = (item.descricao || "").toLowerCase();
                const user = (item.usuario || "").toLowerCase();
                const code = (item.codigo || "").toLowerCase();

                if (termoBusca && !desc.includes(termoBusca) && !user.includes(termoBusca) && !code.includes(termoBusca)) return;

                const userKey = (item.usuario || 'OUTROS').toUpperCase();
                if (!arvore[userKey]) arvore[userKey] = [];
                arvore[userKey].push(item);
            } catch (e) {
                console.error('[ERRO Item Composicao]', e, item);
            }
        });

        const sortedUsers = Object.keys(arvore).sort((a, b) => {
            if (a === 'SOP') return -1;
            if (b === 'SOP') return 1;
            const isMeA = (a === currentUserName || a === currentFiscalName || (userEmail && a.toUpperCase().includes(userEmail.toUpperCase())));
            const isMeB = (b === currentUserName || b === currentFiscalName || (userEmail && b.toUpperCase().includes(userEmail.toUpperCase())));
            if (isMeA) return -1;
            if (isMeB) return 1;
            return a.localeCompare(b, 'pt-BR');
        });

        let html = '';
        let uIndex = 2000;

        for (const userKey of sortedUsers) {
            uIndex++;
            const collapseId = `collapseCompUser${uIndex}`;
            const itens = arvore[userKey];

            const isMe = (userKey === currentUserName || userKey === currentFiscalName || (userEmail && userKey.toUpperCase().includes(userEmail.toUpperCase())));
            const isSop = (userKey === 'SOP');

            let accordionStyle = '';
            let iconClassHeader = 'bi bi-folder2-open me-2 text-success';
            let titleLabel = userKey;

            if (isMe) {
                accordionStyle = 'background-color: #dcfce7 !important; color: #166534 !important; font-weight: 700; border: 1px solid #bbf7d0;';
                iconClassHeader = 'bi bi-person-fill-check me-2 text-success';
                titleLabel = `COMPOSIÇÕES PRÓPRIAS (${userKey})`;
            } else if (isSop) {
                accordionStyle = 'background-color: #f8f9fa !important; color: #334155 !important; font-weight: 800; border: 1px solid #e2e8f0;';
                iconClassHeader = 'bi bi-building-fill-check me-2 text-primary';
                titleLabel = 'SOP (OFICIAL)';
            }

            let itensHtml = '';
            itens.sort((a, b) => {
                const codeA = (a.codigo || "").toUpperCase();
                const codeB = (b.codigo || "").toUpperCase();
                if (codeA && codeB) return codeA.localeCompare(codeB, 'pt-BR', { numeric: true });
                return (a.descricao || "").localeCompare(b.descricao || "", 'pt-BR', { numeric: true });
            });

            itens.forEach(obra => {
                const isAnalytical = !!(obra.itens && Array.isArray(obra.itens));
                const iconClassRow = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? 'icon-pdf' : (isAnalytical ? 'icon-generic' : 'icon-xls');
                const iconSymbol = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? '<i class="bi bi-file-earmark-pdf"></i>' : (isAnalytical ? '<i class="bi bi-calculator"></i>' : '<i class="bi bi-file-earmark-spreadsheet"></i>');
                const dataFormatada = new Date(obra.created_at || obra.data).toLocaleDateString('pt-BR');

                const historico = obra.comentarios_revisao || [];
                const qtdComentarios = historico.length;
                let badgeStatus = '';
                const temPendenteComp = historico.some(c => c.decisao === 'pendente');
                if (temPendenteComp) {
                    badgeStatus = `<span class="badge bg-warning text-dark ms-2" style="font-size:0.65rem">Em Revisão</span>`;
                } else if (obra.status === 'Atualizado' || parseInt(String(obra.versao_atual || '').replace(/[^0-9]/g, '')) > 1) {
                    badgeStatus = `<span class="badge badge-status-atualizado">Atualizado</span>`;
                }

                const histId = `hist_comp_v2_${obra.id}`;
                let botaoHistorico = qtdComentarios > 0 ? `<button class="btn-toggle-history" type="button" data-bs-toggle="collapse" data-bs-target="#${histId}"><i class="bi bi-clock-history"></i> Histórico (${qtdComentarios}) <i class="bi bi-chevron-down ms-1"></i></button>` : '';

                let containerHistoricoHtml = '';
                if (qtdComentarios > 0) {
                    const listaComentarios = historico.map((c, idx) => {
                        const dC = c.data ? new Date(c.data).toLocaleDateString('pt-BR') : '-';
                        let clSt = '', bD = '', rA = '', bAA = '';
                        if (c.autor && c.autor.toLowerCase().includes('sistema')) clSt = 'system-log-entry';
                        if (c.decisao === 'atendido') {
                            clSt = 'status-atendido'; bD = `<span class="badge-decision badge-atendido"><i class="bi bi-check-lg"></i> ATENDIDO</span>`;
                            if (c.resp_admin) rA = `<div class="mt-2 pt-2 border-top small text-success"><strong>Resposta:</strong> ${c.resp_admin}</div>`;
                        } else if (c.decisao === 'recusado') {
                            clSt = 'status-recusado'; bD = `<span class="badge-decision badge-recusado"><i class="bi bi-x-lg"></i> NO ACATADO</span>`;
                            if (c.resp_admin) rA = `<div class="mt-2 pt-2 border-top small text-danger"><strong>Motivo:</strong> ${c.resp_admin}</div>`;
                        } else if (isAdmin && !clSt.includes('system')) {
                            bAA = `<div class="admin-decision-actions"><button class="btn btn-sm btn-outline-success" onclick="abrirModalAtenderComposicao(${obra.id}, ${idx})"><i class="bi bi-check-lg"></i> Atender</button><button class="btn btn-sm btn-outline-danger" onclick="abrirModalRecusarComposicao(${obra.id}, ${idx})"><i class="bi bi-x-lg"></i> Não Acatar</button></div>`;
                        }
                        let bAnex = c.arquivo ? `<a href="${c.arquivo}" target="_blank" class="btn-history-anexo mt-2"><i class="bi bi-paperclip"></i> Ver Memória Anexo</a>` : '';
                        let bExc = isAdmin ? `<button class="btn btn-sm text-danger border-0 p-0 ms-2 admin-only" title="Excluir Registro" onclick="deletarItemHistoricoComposicao(${obra.id}, ${idx})"><i class="bi bi-x-lg"></i></button>` : '';
                        return `<div class="history-card-item ${clSt}"><div class="history-card-header"><div><strong>${c.autor}</strong> <span class="fw-normal ms-1">- ${dC}</span></div><div class="d-flex align-items-center">${bD}${bExc}</div></div><div class="history-card-body"><div>${c.mensagem}</div>${bAnex}${rA}${bAA}</div></div>`;
                    }).join('');
                    containerHistoricoHtml = `<div class="collapse" id="${histId}"><div class="history-collapse-box">${listaComentarios}</div></div>`;
                }

                const historicoObra = obra.historico_versoes || [];
                const autorV1 = String((historicoObra[0] && historicoObra[0].autor) ? historicoObra[0].autor : (obra.criador_nome || obra.criador_email || 'Administrador/Legado'));
                const isOwner = (userEmail && autorV1.toUpperCase().includes(userEmail.toUpperCase())) || (currentUserName && autorV1.toUpperCase().includes(currentUserName)) || (currentFiscalName && autorV1.toUpperCase().includes(currentFiscalName));

                itensHtml += `
                                <div class="mb-2">
                                    <div class="orcamento-item-row" style="margin-bottom:0; border-radius: 8px 8px ${qtdComentarios > 0 ? '0 0' : '8px 8px'};">
                                        <div class="d-flex align-items-center">
                                            <div class="file-icon-box ${iconClassRow}">${iconSymbol}</div>
                                            <div style="flex: 1; min-width: 0;">
                                                <div class="d-flex align-items-center mb-1">
                                                    <span class="text-secondary small me-2" style="font-family: monospace; font-weight: 700; letter-spacing: 0.5px;">#${obra.codigo || 'S/C'}</span>
                                                    <span class="badge bg-dark ms-1" style="font-size:0.65rem; font-weight: 700; border-radius: 4px; padding: 2px 6px;">${obra.versao_atual || 'V1'}</span>
                                                    ${badgeStatus}
                                                </div>
                                                <div class="fw-bold text-dark pe-3" style="font-size:0.95rem; text-align: justify; line-height: 1.4;">
                                                    ${obra.descricao || "Sem Descrição"}
                                                </div>
                                                <div class="text-muted mt-1" style="font-size:0.75rem;">
                                                    ${isSop ? '  Criado por: Setor de Orçamento da SOP' : `Subcategoria: ${obra.subcategoria || 'GERAL'}  Criado por: ${autorV1} em ${dataFormatada}`}
                                                </div>
                                                ${botaoHistorico}
                                            </div>
                                        </div>
                                        <div class="orcamento-actions">
                                            <button class="btn btn-action-baixar" onclick="prepararExportacaoComposicao(${obra.id}, '${obra.arquivo_url || ''}')" title="Imprimir Composição"><i class="bi bi-printer"></i> Imprimir</button>
                                            <button class="btn btn-action-icon ms-1" onclick="visualizarComposicao(${obra.id}, '${obra.arquivo_url || ''}')" title="Visualizar Documento"><i class="bi bi-eye-fill text-primary"></i></button>
                                            ${canEditComposition(obra) ? `
                                                ${isAnalytical ?
                            `<button class="btn btn-action-icon" onclick="editarComposicaoAnalitica(${obra.id})" title="Alterar Composição"><i class="bi bi-pencil-square text-primary"></i></button>` :
                            `<button class="btn btn-action-icon" onclick="prepararNovaVersaoComposicao(${obra.id})" title="Alterar Versão"><i class="bi bi-cloud-arrow-up-fill icon-cloud"></i></button>`
                        }
                                            ` : ''}
                                            <button class="btn btn-action-icon" onclick="prepararComentarioComposicao(${obra.id})" title="Adicionar Comentário"><i class="bi bi-chat-left-text-fill text-warning"></i></button>
                                            ${canDeleteComposition(obra) ? `
                                                <button class="btn btn-action-icon" onclick="deletarComposicao(${obra.id}, '${obra.arquivo_path}')" title="Excluir Composição"><i class="bi bi-trash-fill icon-trash"></i></button>
                                            ` : ''}
                                        </div>
                                    </div>
                                    ${containerHistoricoHtml}
                                </div>`;
            });

            html += `
                            <div class="accordion-custom-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button accordion-custom-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" style="${accordionStyle}">
                                        <i class="${iconClassHeader}"></i> ${titleLabel} <span class="badge bg-white text-dark ms-2 opacity-75" style="font-size: 0.65rem;">${itens.length}</span>
                                    </button>
                                </h2>
                                <div id="${collapseId}" class="accordion-collapse collapse">
                                    <div class="accordion-body bg-white pt-2">
                                        ${itensHtml}
                                    </div>
                                </div>
                            </div>`;
        }
        container.innerHTML = html || '<div class="text-center py-5 text-muted">Nenhuma composição disponível.</div>';
    } catch (err) {
        console.error('[ERRO carregarComposicoes]', err);
        container.innerHTML = `<div class="alert alert-danger">Erro crítico ao carregar composições: ${err.message}</div>`;
    }
}

// --- GLOBAL INIT LISTENERS (Moved out to fix loop) ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial Load
    carregarComposicoes();

    // Search Listener
    document.getElementById('comp-search')?.addEventListener('input', debounce(() => {
        carregarComposicoes();
    }, 500));

    // Clear Listener
    document.getElementById('btn-comp-clear')?.addEventListener('click', () => {
        const input = document.getElementById('comp-search');
        if (input) {
            input.value = '';
            carregarComposicoes();
        }
    });

    // Fix Modals Position
    const modaisParaMover = [
        'modalCadastrarComposicao', 'modalNovaVersaoComposicao', 'modalAtenderComposicao',
        'modalRecusarComposicao', 'modalCriarComposicaoAnalitica', 'modalBuscarItemComposicao',
        'modalComentarioOrcamento', 'modalComentarioComposicao', 'modalExportarComposicao',
        'modalNovaVersao', 'modalNovoOrcamento', 'modalLogin', 'modalVincularFiscal'
    ];
    modaisParaMover.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement !== document.body) document.body.appendChild(el);
    });
});

// --- LÓGICA ABA COMPOSIÇÕES ---

// --- STATE MANAGEMENT ---
let currentCompositionItems = [];

// 2.1 ABRIR CRIADOR (Ensure Global Scope)
window.abrirCriadorComposicao = async function () {
    try {
        const modalEl = document.getElementById('modalCriarComposicaoAnalitica');
        if (!modalEl) {
            alert('Erro: Modal de criação não encontrado.');
            return;
        }

        // Reset State
        currentCompositionItems = [];
        const editIdEl = document.getElementById('edit-id-composicao');
        if (editIdEl) editIdEl.value = ''; // Limpa ID de edição

        const form = document.getElementById('formComposicaoAnalitica');
        if (form) form.reset();

        const tbody = document.getElementById('tbody-itens-composicao');
        if (tbody) tbody.innerHTML = '<tr class="text-center text-muted" id="placeholder-itens-vazio"><td colspan="8" class="py-4">Nenhum item adicionado. Clique em "Adicionar Item".</td></tr>';

        if (document.getElementById('total-material')) document.getElementById('total-material').textContent = 'R$ 0,00';
        if (document.getElementById('total-mao-de-obra')) document.getElementById('total-mao-de-obra').textContent = 'R$ 0,00';
        if (document.getElementById('total-equipamentos')) document.getElementById('total-equipamentos').textContent = 'R$ 0,00';
        if (document.getElementById('total-servico')) document.getElementById('total-servico').textContent = 'R$ 0,00';
        if (document.getElementById('total-geral')) document.getElementById('total-geral').textContent = 'R$ 0,00';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) {
        console.error('Erro ao abrir criador:', err);
        alert('Erro ao abrir o criador de composição: ' + err.message);
    }
}

window.editarComposicaoAnalitica = async function (id) {
    try {
        const { data, error } = await sbClient
            .from('composicoes_biblioteca')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        const modalEl = document.getElementById('modalCriarComposicaoAnalitica');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        // Preencher campos básicos
        document.getElementById('edit-id-composicao').value = data.id;
        document.getElementById('comp-codigo').value = data.codigo || '';
        document.getElementById('comp-descricao').value = data.descricao || '';
        document.getElementById('comp-unidade').value = data.unidade || '';
        document.getElementById('comp-data').value = data.data_base || '';
        document.getElementById('comp-bdi').value = data.bdi || '0,00';
        document.getElementById('comp-desconto').value = data.desconto || '0,00';

        // Carregar Itens
        currentCompositionItems = data.itens || [];
        renderizarItensComposicao();
        atualizarCalculosComposicao();

        modal.show();
    } catch (err) {
        console.error('Erro ao carregar para edição:', err);
        alert("Erro ao carregar composição: " + err.message);
    }
}

// (Função atualizarVersoesComposicao removida - Lógica movida para Modal de Busca abaixo)

// 2.2 MODAL BUSCAR ITEM
async function abrirModalBuscarItem() {
    document.getElementById('busca-item-termo').value = '';
    document.getElementById('lista-resultados-itens').innerHTML = '<div class="text-center py-3 text-muted small">Digite algo para buscar...</div>';

    // Reset Filters to Default
    document.getElementById('busca-item-fonte').value = 'SEINFRA';

    // Reset UI Mode
    toggleBuscaItemMode();

    await atualizarVersoesBusca(); // Load initial versions

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalBuscarItemComposicao')).show();
}

window.toggleBuscaItemMode = function () {
    const fonte = document.getElementById('busca-item-fonte').value;
    const containerBusca = document.getElementById('container-busca-item');
    const listaResultados = document.getElementById('lista-resultados-itens');
    const formMercado = document.getElementById('form-cadastro-mercado');
    const versao = document.getElementById('busca-item-versao');
    const ref = document.getElementById('busca-item-referencia');

    if (fonte === 'MERCADO') {
        containerBusca.classList.add('d-none');
        listaResultados.classList.add('d-none');
        formMercado.classList.remove('d-none');
        versao.disabled = true;
        ref.disabled = true;
    } else {
        containerBusca.classList.remove('d-none');
        listaResultados.classList.remove('d-none');
        formMercado.classList.add('d-none');
        versao.disabled = false;
        ref.disabled = false;
        atualizarVersoesBusca();
    }
}

// Currency Input Mask
window.formatMoneyInput = function (input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') return;

    const numberValue = parseFloat(value) / 100;
    input.value = numberValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    calcularPrecoRetroativo(); // Trigger recalc
}

window.calcularPrecoRetroativo = function () {
    const rawPreco = document.getElementById('mercado-preco').value.replace(/\./g, '').replace(',', '.');
    const preco = parseFloat(rawPreco) || 0;

    const parseIndex = (val) => {
        if (!val) return 0;
        return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0;
    };

    const indIni = parseIndex(document.getElementById('mercado-ind-ini').value);
    const indFin = parseIndex(document.getElementById('mercado-ind-fin').value);
    const elResult = document.getElementById('mercado-preco-calc');

    if (preco > 0 && indIni > 0 && indFin > 0) {
        const novoPreco = preco * (indFin / indIni);
        elResult.textContent = novoPreco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        elResult.dataset.value = novoPreco; // Store raw value
    } else {
        elResult.textContent = 'R$ 0,00';
        delete elResult.dataset.value;
    }
}

// Index Input Mask (3 decimals)
window.formatIndexInput = function (input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') return;

    const numberValue = parseFloat(value) / 1000;
    // Force 3 decimal places
    input.value = numberValue.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    calcularPrecoRetroativo();
}

window.adicionarLinhaFornecedor = function () {
    const container = document.getElementById('container-fornecedores');
    const div = document.createElement('div');
    div.className = 'row g-1 mb-1 align-items-center linha-fornecedor';
    div.innerHTML = `
                        <div class="col-7">
                            <input type="text" class="form-control form-control-sm input-fornecedor-nome" placeholder="Nome do Fornecedor...">
                        </div>
                        <div class="col-4">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text">R$</span>
                                <input type="text" class="form-control input-fornecedor-valor" oninput="formatMoneyInput(this); calcularPrecoAdotado()" placeholder="0,00">
                            </div>
                        </div>
                        <div class="col-1 text-end">
                            <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="removerLinhaFornecedor(this)"><i class="bi bi-dash-circle"></i></button>
                        </div>
                    `;
    container.appendChild(div);
}

window.removerLinhaFornecedor = function (btn) {
    btn.closest('.linha-fornecedor').remove();
    calcularPrecoAdotado();
}

window.calcularPrecoAdotado = function () {
    const valores = Array.from(document.querySelectorAll('.input-fornecedor-valor'))
        .map(input => parseFloat(input.value.replace(/\./g, '').replace(',', '.')) || 0)
        .filter(v => v > 0);

    if (valores.length === 0) return;

    const metodo = document.querySelector('input[name="mercado-metodo-preco"]:checked').value;
    let resultado = 0;

    if (metodo === 'MENOR') {
        resultado = Math.min(...valores);
    } else {
        resultado = valores.reduce((a, b) => a + b, 0) / valores.length;
    }

    const inputPreco = document.getElementById('mercado-preco');
    inputPreco.value = resultado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    calcularPrecoRetroativo();
}

// Listeners removed (handled by oninput)

window.adicionarItemMercadoManual = function () {
    const desc = document.getElementById('mercado-desc').value.trim();
    const unid = document.getElementById('mercado-unid').value.trim().toUpperCase();
    // Check if calculated price exists
    const calcPrice = document.getElementById('mercado-preco-calc').dataset.value;

    const rawPreco = document.getElementById('mercado-preco').value.replace(/\./g, '').replace(',', '.');
    let preco = parseFloat(rawPreco);

    if (calcPrice) {
        // FIX: Ensure 2-decimal precision to match Memory Calculation
        preco = parseFloat(parseFloat(calcPrice).toFixed(2));
    }

    const coef = parseFloat(document.getElementById('mercado-coef').value);

    // Retro Fields
    const dataIni = document.getElementById('mercado-data-ini').value;
    const indIni = document.getElementById('mercado-ind-ini').value;
    const dataFin = document.getElementById('mercado-data-fin').value;
    const indFin = document.getElementById('mercado-ind-fin').value;

    // Fields for Multiple Suppliers
    const fornecedores = Array.from(document.querySelectorAll('.linha-fornecedor')).map(div => ({
        nome: div.querySelector('.input-fornecedor-nome').value.trim(),
        valor: parseFloat(div.querySelector('.input-fornecedor-valor').value.replace(/\./g, '').replace(',', '.')) || 0
    })).filter(f => f.nome && f.valor > 0);
    const metodoPreco = document.querySelector('input[name="mercado-metodo-preco"]:checked').value;

    if (!desc) { alert("Informe a descrição."); return; }
    if (!unid) { alert("Informe a unidade."); return; }
    if (isNaN(preco) || preco <= 0) { alert("Preço inválido."); return; }
    if (isNaN(coef) || coef <= 0) { alert("Coeficiente inválido."); return; }

    // Construct detailed description if retro
    let finalDesc = desc;
    /* // Optional: Append retro info to description? User didn't ask, but it's good practice. 
       // I will stick to metadata storage for now as user just asked to fill blanks. 
    */

    adicionarItemComposicao({
        fonte: 'MERCADO',
        versao: new Date().toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase(),
        referencia: 'COTAÇÃO',
        codigo: 'COTAÇÃO',
        descricao: finalDesc,
        unidade: unid,
        preco: preco,
        tipo: 'INSUMO',
        grupo: 'MATERIAL',
        coeficiente: coef,
        anexos: [],
        retroativo: { dataIni, indIni, dataFin, indFin, base: rawPreco, fornecedores, metodoPreco }
    });

    // Reset Form
    document.getElementById('mercado-desc').value = '';
    document.getElementById('mercado-unid').value = '';
    document.getElementById('mercado-preco').value = '';
    document.getElementById('mercado-coef').value = '1.00'; // Reset validation default

    document.getElementById('mercado-data-ini').value = '';
    document.getElementById('mercado-ind-ini').value = '';
    document.getElementById('mercado-data-fin').value = '';
    document.getElementById('mercado-ind-fin').value = '';
    document.getElementById('mercado-preco-calc').textContent = 'R$ 0,00';
    delete document.getElementById('mercado-preco-calc').dataset.value;

    // Reset Fornecedores
    document.getElementById('container-fornecedores').innerHTML = '';
    document.getElementById('metodo-menor').checked = true;

    bootstrap.Modal.getInstance(document.getElementById('modalBuscarItemComposicao')).hide();
}

async function atualizarVersoesBusca() {
    const fonte = document.getElementById('busca-item-fonte').value;
    const elVersao = document.getElementById('busca-item-versao');
    const elRef = document.getElementById('busca-item-referencia');

    // 1. Lock/Unlock Reference
    if (fonte === 'ORSE') {
        elRef.value = 'Onerada';
        elRef.disabled = true;
    } else {
        elRef.disabled = false;
    }

    // 2. Populate Versions
    elVersao.innerHTML = '<option value="">Carregando...</option>';
    elVersao.disabled = true;

    let tabela = '';
    if (fonte === 'SEINFRA') tabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') tabela = 'sinapi_itens';
    else if (fonte === 'ORSE') tabela = 'orse_itens';

    try {
        let options = [];
        elVersao.innerHTML = '<option value="">Verificando...</option>';

        // Define candidates to check against DB (Dynamic 12 months)
        const mapMes = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };
        const mapMesLabels = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

        let candidates = [];
        if (fonte === 'SEINFRA') {
            candidates = ["30", "29", "28", "27", "26"];
        } else {
            const now = new Date();
            for (let i = 0; i < 12; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                candidates.push(`${mapMesLabels[d.getMonth()]}/${d.getFullYear()}`);
            }
        }

        if (fonte === 'SEINFRA') {
            const results = await Promise.all(candidates.map(async v => {
                const { count } = await sbClient.from('seinfra_itens').select('*', { count: 'exact', head: true }).eq('referencia', v);
                return { v, count: count || 0 };
            }));
            options = results.filter(r => r.count > 0).map(r => r.v);
            if (options.length === 0) options = ['28', '27'];
        }
        else if (fonte === 'SINAPI' || fonte === 'ORSE') {
            options = [];
            // Parallel checks for speed
            const checks = candidates.map(async (label) => {
                const parts = label.split('/');
                const mes = mapMes[parts[0].toUpperCase()];
                const dbDate = `${parts[1]}-${mes}-01`;

                const { count } = await sbClient
                    .from(tabela)
                    .select('*', { count: 'exact', head: true })
                    .eq('referencia', dbDate); // Check if THIS version exists

                return { label, count: count || 0 };
            });

            const results = await Promise.all(checks);
            options = results.filter(r => r.count > 0).map(r => r.label);

            // Fallback if DB empty or query fails (prevents empty dropdown)
            if (options.length === 0) options = ['DEZ/2025'];
        }

        // Render
        if (options.length === 0) {
            elVersao.innerHTML = '<option value="">Sem versões</option>';
        } else {
            elVersao.innerHTML = options.map(v => `<option value="${v}">${fonte === 'SEINFRA' ? '0' + v : v}</option>`).join('');
        }

        elVersao.disabled = false;

    } catch (e) {
        console.error(e);
        elVersao.innerHTML = '<option value="Padrao">Padrão</option>';
    }
}

async function executarBuscaItemComposicao() {
    const fonte = document.getElementById('busca-item-fonte').value;
    const termo = document.getElementById('busca-item-termo').value.trim();
    const lista = document.getElementById('lista-resultados-itens');

    // Filters from Search Modal
    const versaoSelecionada = document.getElementById('busca-item-versao').value;
    const refSelecionada = document.getElementById('busca-item-referencia').value;

    if (termo.length < 2) { alert("Digite pelo menos 2 letras."); return; }

    lista.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Buscando...</div>';

    let tabela = '';
    if (fonte === 'SEINFRA') tabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') tabela = 'sinapi_itens';
    else if (fonte === 'ORSE') tabela = 'orse_itens';

    let query = sbClient
        .from(tabela)
        .select('*')
        .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`);

    // Helper: Convert "DEZ/2025" -> "2025-12-01"
    function converterVersaoParaData(str) {
        if (!str) return null;
        const map = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };
        const parts = str.split('/');
        if (parts.length !== 2) return str; // Return as is if not matching format
        const mes = map[parts[0].toUpperCase()];
        const ano = parts[1];
        if (mes && ano) return `${ano}-${mes}-01`;
        return str;
    }

    // Apply Filters
    // 1. Reference (Onerada/Desonerada) -> Mapped to DB column 'tipo_encargo'
    if (fonte !== 'ORSE' && refSelecionada) {
        // Use ilike to handle Case Sensitivity (Onerada vs ONERADA)
        query = query.ilike('tipo_encargo', refSelecionada);
    }

    // 2. Version selection -> Mapped to DB column 'referencia'
    if (versaoSelecionada) {
        let val = versaoSelecionada;
        if (fonte === 'SINAPI' || fonte === 'ORSE') {
            val = converterVersaoParaData(versaoSelecionada);
        }
        query = query.eq('referencia', val);
    }

    let { data, error } = await query.limit(1000);

    // --- DIAGNOSTIC FALLBACK ---
    // If no results or error, try fetching by Term ONLY to inspect DB values
    if ((!data || data.length === 0) || error) {
        const previousError = error;
        console.warn("Search failed or empty, trying diagnostic...", error);

        // Try simple search without filters
        const { data: diagData, error: diagError } = await sbClient
            .from(tabela)
            .select('*')
            .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
            .limit(10); // Show more results to increase chance of finding the right one

        if (diagData && diagData.length > 0) {
            // Show items with warning
            lista.innerHTML = `
                                <div class="alert alert-warning small mb-2">
                                    <i class="bi bi-exclamation-triangle"></i> <strong>Aviso:</strong> Nenhum item exato encontrado com os filtros. Mostrando resultados similares.<br>
                                    Verifique se a Versão/Ref existem no Banco.
                                </div>
                             `;
            data = diagData;
            error = null;
        } else {
            // Really nothing found
            if (previousError) {
                lista.innerHTML = `<div class="text-danger p-2">Erro BD: ${previousError.message}</div>`;
                return;
            }
        }
    }

    if (!data || data.length === 0) {
        lista.innerHTML = '<div class="text-center py-3 text-muted">Nenhum item encontrado com estes filtros.</div>';
        return;
    }

    lista.innerHTML = '';
    data.forEach(item => {
        // Padroniza campos
        const codigo = item.codigo;
        const desc = item.descricao;
        const unidade = item.unidade;
        const preco = item.preco_unitario || item.preco || 0;
        const tipo = item.tipo_item || (fonte === 'SEINFRA' ? 'INSUMO' : 'ITEM');

        // Debug visuals
        const dbRef = item.tipo_encargo || '?';
        const dbVer = item.referencia || '?';

        const el = document.createElement('button');
        el.className = 'list-group-item list-group-item-action p-2';
        el.innerHTML = `
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <div class="fw-bold small">${codigo} - ${desc}</div>
                                    <div class="text-muted" style="font-size:0.7rem">
                                        ${fonte} | ${unidade} | ${tipo} <br>
                                        <span class="text-primary">Ref: ${dbRef} | Ver: ${dbVer}</span>
                                    </div>
                                </div>
                                <div class="fw-bold text-success small">R$ ${parseFloat(preco).toFixed(2)}</div>
                            </div>
                        `;

        // Use explicit selection to ensure what we add matches strictly what we searched
        const versao = versaoSelecionada || item.versao || item.data_referencia;
        const referencia = refSelecionada || item.referencia;

        el.onclick = () => {
            adicionarItemComposicao({
                fonte,
                versao,
                referencia,
                codigo,
                descricao: desc,
                unidade,
                preco: parseFloat(preco),
                tipo,
                coeficiente: 1.00
            });
            bootstrap.Modal.getInstance(document.getElementById('modalBuscarItemComposicao')).hide();
        };
        lista.appendChild(el);
    });
}

// 2.3 ADICIONAR E GERENCIAR ITENS
function adicionarItemComposicao(item) {
    // Verifica duplicação
    const existe = currentCompositionItems.find(i => {
        // Se for cotação de mercado, permite múltiplos itens se as descrições forem diferentes
        if (item.fonte === 'MERCADO') {
            return i.fonte === item.fonte && i.descricao === item.descricao;
        }
        return i.codigo === item.codigo && i.fonte === item.fonte;
    });
    if (existe) {
        alert("Este item já está na lista.");
        return;
    }

    // Auto-Detect Group based on Category, Type or Source
    let grupo = 'MATERIAL'; // Default
    const catUpper = (item.categoria || '').toUpperCase();
    const tipoUpper = (item.tipo || item.tipo_item || '').toUpperCase();

    if (catUpper.includes('MO') || catUpper.includes('MAO') ||
        tipoUpper.includes('MO') || tipoUpper.includes('MAO') ||
        tipoUpper.includes('SERVENTE') || tipoUpper.includes('PEDREIRO')) {
        grupo = 'MAO_DE_OBRA';
    } else if (catUpper.includes('EQUIP') || tipoUpper.includes('EQUIP') ||
        tipoUpper.includes('CAMINHAO') || tipoUpper.includes('BETONEIRA')) {
        grupo = 'EQUIPAMENTOS';
    } else if (catUpper.includes('SERV') || tipoUpper.includes('SERV')) {
        grupo = 'SERVICO';
    } else if (item.fonte === 'SINAPI' && (item.tipo_item === 'COMPOSICAO' || item.tipo === 'COMPOSICAO')) {
        grupo = 'MATERIAL';
    }

    item.grupo = grupo;


    currentCompositionItems.push(item);
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function removerItemComposicao(index) {
    currentCompositionItems.splice(index, 1);
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function atualizarGrupo(index, novoGrupo) {
    currentCompositionItems[index].grupo = novoGrupo;
    atualizarCalculosComposicao();
}

function toggleGrupo(index) {
    const item = currentCompositionItems[index];
    const grupos = ['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTOS', 'SERVICO'];
    const currentIndex = grupos.indexOf(item.grupo);
    const nextIndex = (currentIndex + 1) % grupos.length;
    item.grupo = grupos[nextIndex];
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function renderizarItensComposicao() {
    const tbody = document.getElementById('tbody-itens-composicao');
    if (currentCompositionItems.length === 0) {
        tbody.innerHTML = '<tr class="text-center text-muted" id="placeholder-itens-vazio"><td colspan="8" class="py-4">Nenhum item adicionado. Clique em "Adicionar Item".</td></tr>';
        return;
    }

    // 1. Group Data
    const groups = {
        'MAO_DE_OBRA': [],
        'MATERIAL': [],
        'EQUIPAMENTOS': [],
        'SERVICO': []
    };

    currentCompositionItems.forEach((item, index) => {
        const g = item.grupo || 'MATERIAL';
        if (groups[g]) groups[g].push({ item, index });
        else groups['MATERIAL'].push({ item, index });
    });

    // 2. Render Helper
    let html = '';

    const renderSection = (key, title, bgClass) => {
        const list = groups[key];
        if (list.length === 0) return '';

        let sectionHtml = `
                            <tr class="${bgClass} text-center fw-bold text-secondary" style="font-size: 0.75rem; background-color: #e9ecef;">
                                <td colspan="8" class="py-1 border-top">${title}</td>
                            </tr>
                        `;

        let subTotal = 0;

        const elBdi = document.getElementById('comp-bdi');
        const elDesc = document.getElementById('comp-desconto');

        const parseBrl = (val) => {
            if (!val) return 0;
            return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0;
        };

        const bdi = parseBrl(elBdi.value);
        const desc = parseBrl(elDesc.value);
        const bdiVal = bdi / 100;
        const descVal = desc / 100;

        list.forEach(({ item, index }) => {
            const precoEfetivo = item.preco;
            const totalRow = precoEfetivo * item.coeficiente;
            subTotal += totalRow;

            const refShort = (item.referencia || '').toLowerCase().includes('desonerada') ? 'Desonerada' : (item.referencia === 'COTAO' ? 'COTAO' : 'Onerada');
            const verShort = (item.versao || '').replace('Tabela ', '');

            let sourceDisplay = '';
            if (item.fonte === 'MERCADO') {
                sourceDisplay = `<span class="badge bg-light text-secondary border me-1" style="font-size:0.65rem">MERCADO</span>`;
            } else {
                sourceDisplay = `
                                    <div class="d-flex flex-column align-items-center" style="line-height:1.1;">
                                        <div>
                                            <span class="badge bg-light text-secondary border me-1" style="font-size:0.65rem">${item.fonte}</span>
                                            <span class="fw-bold small">${verShort}</span>
                                        </div>
                                        <small class="text-muted" style="font-size:0.7rem;">${refShort}</small>
                                    </div>
                                `;
            }

            sectionHtml += `
                            <tr>
                                <td class="small text-muted text-center" style="font-size: 0.75rem;">${sourceDisplay}</td>
                                <td class="small fw-bold text-center">${item.codigo}</td>
                                <td class="small text-truncate" style="max-width: 550px;" title="${item.descricao}">${item.descricao}</td>
                                <td class="small text-center">${item.unidade}</td>
                                <td class="text-center">
                                    <input type="number" class="form-control form-control-sm text-center p-0 border-0 bg-transparent mx-auto" 
                                        style="max-width: 60px;" 
                                        value="${item.coeficiente}" step="0.0001" min="0"
                                        onchange="atualizarCoeficiente(${index}, this.value)">
                                </td>
                                <td class="text-center small" title="Base: ${item.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}">${precoEfetivo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td class="text-center fw-bold small text-dark" id="total-linha-${index}">${(totalRow).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td class="text-center">
                                    <div class="d-flex justify-content-center gap-2">
                                        <button class="btn btn-sm btn-link text-secondary p-0" title="Alterar Grupo" onclick="toggleGrupo(${index})"><i class="bi bi-arrow-repeat" style="font-size: 0.9rem;"></i></button>
                                        <button class="btn btn-sm btn-link text-danger p-0" onclick="removerItemComposicao(${index})"><i class="bi bi-trash"></i></button>
                                    </div>
                                </td>
                            </tr>
                            `;
        });

        sectionHtml += `
                            <tr class="bg-light fw-bold" style="font-size: 0.75rem;">
                                <td colspan="6" class="text-end text-muted pe-3">TOTAL ${title}</td>
                                <td class="text-center text-dark">${subTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td></td>
                            </tr>
                        `;
        return sectionHtml;
    };

    html += renderSection('MAO_DE_OBRA', 'MAO DE OBRA', 'bg-body-secondary');
    html += renderSection('MATERIAL', 'MATERIAIS', 'bg-body-secondary');
    html += renderSection('EQUIPAMENTOS', 'EQUIPAMENTOS', 'bg-body-secondary');
    html += renderSection('SERVICO', 'SERVIOS', 'bg-body-secondary');

    tbody.innerHTML = html;
}

function atualizarCoeficiente(index, valor) {
    const val = parseFloat(valor);
    if (isNaN(val) || val < 0) return;
    currentCompositionItems[index].coeficiente = val;
    const elBdi = document.getElementById('comp-bdi');
    const elDesc = document.getElementById('comp-desconto');
    const parseBrl = (val) => val ? parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0 : 0;
    const bdiVal = parseBrl(elBdi ? elBdi.value : 0) / 100;
    const descVal = parseBrl(elDesc ? elDesc.value : 0) / 100;
    const item = currentCompositionItems[index];
    const precoEfetivo = item.preco;
    document.getElementById(`total-linha-${index}`).textContent = `${(precoEfetivo * item.coeficiente).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    atualizarCalculosComposicao();
}

function atualizarCalculosComposicao() {
    let totalMat = 0, totalMao = 0, totalEquip = 0, totalServ = 0;
    currentCompositionItems.forEach(item => {
        const totalItem = Math.round((item.preco * item.coeficiente) * 100) / 100;
        const grupo = item.grupo || 'MATERIAL';
        if (grupo === 'MAO_DE_OBRA') totalMao = Math.round((totalMao + totalItem) * 100) / 100;
        else if (grupo === 'EQUIPAMENTOS') totalEquip = Math.round((totalEquip + totalItem) * 100) / 100;
        else if (grupo === 'SERVICO') totalServ = Math.round((totalServ + totalItem) * 100) / 100;
        else totalMat = Math.round((totalMat + totalItem) * 100) / 100;
    });
    const totalSemBDI = totalMat + totalMao + totalEquip + totalServ;
    const bdiInput = document.getElementById('comp-bdi');
    const descInput = document.getElementById('comp-desconto');
    const parseBrl = (val) => val ? parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0 : 0;
    const bdiPercent = bdiInput ? parseBrl(bdiInput.value) : 0;
    const descPercent = descInput ? parseBrl(descInput.value) : 0;

    const totalComBDI = Math.round((totalSemBDI * (1 + (bdiPercent / 100))) * 100) / 100;
    const valorBDI = Math.round((totalComBDI - totalSemBDI) * 100) / 100;
    const valorDesconto = Math.round((totalComBDI * (descPercent / 100)) * 100) / 100;
    const totalFinal = Math.round((totalComBDI - valorDesconto) * 100) / 100;

    if (document.getElementById('total-material')) document.getElementById('total-material').textContent = `R$ ${totalMat.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-mao-de-obra')) document.getElementById('total-mao-de-obra').textContent = `R$ ${totalMao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-equipamentos')) document.getElementById('total-equipamentos').textContent = `R$ ${totalEquip.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-servico')) document.getElementById('total-servico').textContent = `R$ ${totalServ.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-bdi')) document.getElementById('total-bdi').textContent = `R$ ${valorBDI.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-desconto')) document.getElementById('total-desconto').textContent = `R$ ${valorDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-geral')) document.getElementById('total-geral').textContent = `R$ ${totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 3.4 SALVAR COMPOSIÇÃO ANALÍTICA (CREATE)
async function salvarComposicaoAnalitica() {
    if (currentCompositionItems.length === 0) { alert("Adicione pelo menos um item à composição."); return; }

    const form = document.getElementById('formComposicaoAnalitica');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const btn = document.getElementById('btn-salvar-comp-analitica');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> SALVANDO...';

    try {
        const formData = new FormData(form);
        const nomeObra = (formData.get('descricao') || 'SEM DESCRIÇÃO').toUpperCase();

        let userEmail = sessionStorage.getItem('sop_user') || 'SISTEMA';
        let userName = sessionStorage.getItem('sop_user_name');

        if (userEmail !== 'SISTEMA' && !userEmail.includes('@')) {
            userEmail = `${userEmail.replace(/\s+/g, '')}@gecope.app`;
        }

        if (!userName || /^\d+$/.test(userName)) {
            const { data: userData } = await sbClient.from('app_users')
                .select('full_name, nome, sobrenome')
                .eq('email', userEmail)
                .maybeSingle();

            if (userData) {
                if (userData.full_name && !/^\d+$/.test(userData.full_name)) {
                    userName = userData.full_name;
                } else if (userData.nome) {
                    userName = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).toUpperCase();
                }
                if (userName) sessionStorage.setItem('sop_user_name', userName);
            }
        }

        if ((!userName || /^\d+$/.test(userName)) && userEmail !== 'SISTEMA') {
            const loginOriginal = sessionStorage.getItem('sop_user');
            if (loginOriginal && !loginOriginal.includes('@') && !/^\d+$/.test(loginOriginal)) {
                userName = loginOriginal.toUpperCase();
            } else {
                const namePart = userEmail.split('@')[0];
                userName = namePart.replace(/\./g, ' ').toUpperCase();
            }
        }

        if (/^\d+$/.test(userName)) userName = "USUÁRIO " + userName;

        const categoriaFinal = (userName || 'OUTROS').toUpperCase();
        const subcategoriaFinal = 'COMPOSIÇÕES PRÓPRIAS';

        const payload = {
            descricao: nomeObra,
            usuario: categoriaFinal,
            subcategoria: subcategoriaFinal,
            codigo: formData.get('codigo') || 'S/C',
            unidade: formData.get('unidade') || '-',
            fonte: 'PRPRIA',
            data_base: formData.get('data_base') || '',
            bdi: formData.get('bdi') || '0,00',
            desconto: formData.get('desconto') || '0,00',
            itens: currentCompositionItems,
            status: 'Em Revisão'
        };

        const idEdicao = document.getElementById('edit-id-composicao').value;
        let res;

        if (idEdicao) {
            const { data: current } = await sbClient.from('composicoes_biblioteca').select('historico_versoes').eq('id', idEdicao).single();
            const hist = current ? (current.historico_versoes || []) : [];
            hist.push({
                versao: 'Edit',
                data: new Date().toISOString(),
                descricao: 'Alteração via Editor Analítico',
                autor: userName || userEmail
            });
            payload.historico_versoes = hist;
            res = await sbClient.from('composicoes_biblioteca').update(payload).eq('id', idEdicao);
        } else {
            payload.versao_atual = 'V1';
            payload.historico_versoes = [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Criação via Criador Analítico',
                autor: userName || userEmail
            }];
            res = await sbClient.from('composicoes_biblioteca').insert([payload]);
        }

        if (res.error) throw new Error(res.error.message);

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `${idEdicao ? 'editou' : 'criou manualmente'} a composição analítica: ${nomeObra}`, '', nomeObra);

        alert(" Composição salva com sucesso!");
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCriarComposicaoAnalitica')).hide();
        form.reset();
        currentCompositionItems = [];
        if (typeof renderItemsTable === 'function') renderItemsTable();
        carregarComposicoes();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }
    }
}


// --- LGICA EXPORTAO E TABELAS ---
// currentTabelaData já declarado globalmente
let compositionDataToExport = null;
window.exportarComposicao = exportarComposicao;

async function executarBuscaTabela() {
    const fonte = document.getElementById('busca-fonte').value;
    const versaoBase = document.getElementById('busca-versao').value;
    const tipoRef = document.getElementById('busca-ref').value;
    const termo = document.getElementById('busca-input-termo').value.trim();
    const areaResultados = document.getElementById('area-resultados-tabela');
    const tbody = document.getElementById('tabela-precos-body');
    const contador = document.getElementById('contador-resultados');

    if (!termo || termo.length < 2) { alert("Digite ao menos dois caracteres para pesquisar."); return; }

    let nomeTabela = '', dataFormatada = '';
    if (fonte === 'SEINFRA') nomeTabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') {
        nomeTabela = 'sinapi_itens';
        if (versaoBase.length === 6) dataFormatada = `${versaoBase.substring(2)}-${versaoBase.substring(0, 2)}-01`;
    } else if (fonte === 'ORSE') {
        nomeTabela = 'orse_itens';
        if (versaoBase.includes('/')) { const p = versaoBase.split('/'); dataFormatada = `${p[1]}-${p[0]}-01`; }
    }

    areaResultados.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 text-muted small">Buscando na base de dados...</div></td></tr>';

    try {
        let query = sbClient.from(nomeTabela).select('*');
        if (fonte === 'SEINFRA') query = query.eq('referencia', versaoBase);
        else query = query.eq('referencia', dataFormatada);

        // Ajuste para filtro de desoneração (SEINFRA pode usar termos diferentes)
        let filtroRef = tipoRef;
        if (fonte === 'SEINFRA') {
            // Tenta bater com 'onerada' ou 'não desonerada'
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else if (fonte === 'SINAPI') {
            query = query.eq('tipo_encargo', tipoRef);
        }
        // Para ORSE, ignoramos o filtro de tipo_encargo pois a tabela não possui essa coluna

        // Busca por Código OU Descrição e limite estendido conforme solicitado (1000 itens)
        query = query.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
            .limit(1000);

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Nenhum item encontrado com os critérios informados.</td></tr>';
            contador.textContent = '0 itens';
            return;
        }

        currentTabelaData = data;
        renderTabelaResults(data);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">Erro ao buscar: ${err.message}</td></tr>`;
    }
}

function limparBuscaTabela() {
    document.getElementById('busca-input-termo').value = '';
    document.getElementById('busca-desc').value = '';
    document.getElementById('busca-bdi').value = '';
    document.getElementById('area-resultados-tabela').style.display = 'none';
    document.getElementById('tabela-precos-body').innerHTML = '';
    document.getElementById('contador-resultados').textContent = '0 itens';
    currentTabelaData = [];
}

function recalcTabela() {
    if (currentTabelaData && currentTabelaData.length > 0) renderTabelaResults(currentTabelaData);
}

function gerarLinkOrse(codigo, referencia) {
    if (!referencia || referencia.length < 10) return "#";
    try {
        const dateObj = new Date(referencia);
        const ano = dateObj.getUTCFullYear();
        const mes = dateObj.getUTCMonth() + 1;
        const codigoLimpo = codigo.replace(/^[Ss]/, '');
        return `https://orse.cehop.se.gov.br/composicao.asp?font_sg_fonte=ORSE&serv_nr_codigo=${codigoLimpo}&peri_nr_ano=${ano}&peri_nr_mes=${mes}&peri_nr_ordem=1`;
    } catch (e) { console.error("Erro gerarLinkOrse", e); return "#"; }
}

function gerarLinkSeinfra(codigo, ref) {
    const enc = (ref || '').toLowerCase().trim();
    // 'nao_desonerada' se contiver termos de negação ou for exatamente 'onerada'
    // Evita que 'desonerada' seja detectada como 'onerada' pelo .includes()
    const containsNao = enc.includes('não') || enc.includes('nao') || enc.includes('sem');
    const isOnerada = enc === 'onerada' || (containsNao && enc.includes('desonerada'));

    const statusUrl = isOnerada ? 'onerada' : 'desonerada';
    return `https://sin.seinfra.ce.gov.br/site-seinfra/siproce/${statusUrl}/html/${(codigo || '').trim()}.html?a=1698149826826`;
}

function renderTabelaResults(lista) {
    const tbody = document.getElementById('tabela-precos-body');
    const contador = document.getElementById('contador-resultados');
    const bdiVal = parseFloat(document.getElementById('busca-bdi').value) || 0;
    const descVal = parseFloat(document.getElementById('busca-desc').value) || 0;
    const fonte = document.getElementById('busca-fonte').value;
    const tipoRef = document.getElementById('busca-ref').value;
    const versaoBase = document.getElementById('busca-versao').value;
    contador.textContent = `${lista.length} itens`;

    // Função auxiliar para renderizar a linha
    const renderLinha = (item) => {
        let valorBase = parseFloat(item.valor_unitario || item.preco_unitario || item.valor || item.preco || 0);
        const valorFinal = valorBase * (1 + bdiVal / 100) * (1 - descVal / 100);
        const stylePreco = (bdiVal > 0 || descVal > 0) ? 'color: #d63384 !important;' : 'color: var(--sop-gray-dark);';

        let btnAction = '';
        const btnImprimir = `<button class="btn btn-sm btn-outline-success border me-1" onclick="imprimirLinhaTabela('${item.codigo}', '${fonte}', '${versaoBase}', '${tipoRef}')" title="Imprimir Composição"><i class="bi bi-printer"></i></button>`;

        if (fonte === 'ORSE') {
            const link = gerarLinkOrse(item.codigo, item.referencia);
            btnAction = `<div class="d-flex align-items-center justify-content-end">${btnImprimir}<a href="${link}" target="_blank" class="btn btn-sm btn-outline-primary" title="Ver Composição no ORSE"><i class="bi bi-box-arrow-up-right"></i></a></div>`;
        } else {
            btnAction = `<div class="d-flex align-items-center justify-content-end">${btnImprimir}<button class="btn btn-sm btn-light border" onclick="abrirDetalheTabela('${item.codigo}', '${fonte}', '${versaoBase}', '${tipoRef}')" title="Ver Detalhes"><i class="bi bi-chevron-right"></i></button></div>`;
        }

        return `<tr>
                            <td class="text-center small fw-bold text-secondary ps-3">${item.identificacao || '-'}</td>
                            <td class="fw-bold text-primary text-center">${item.codigo}</td>
                            <td class="text-uppercase small">${item.descricao}</td>
                            <td class="text-center small fw-bold">${item.unidade}</td>
                            <td class="text-end pe-3 fw-bold" style="${stylePreco}">${valorFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                            <td class="text-end pe-3">${btnAction}</td>
                        </tr>`;
    };

    // Agrupamento por Categoria (para SEINFRA seguir a planilha oficial)
    if (fonte === 'SEINFRA') {
        const grupos = {};
        lista.forEach(item => {
            const cat = (item.categoria || item.identificacao || 'GERAL').toUpperCase();
            if (!grupos[cat]) grupos[cat] = [];
            grupos[cat].push(item);
        });

        let html = '';
        Object.keys(grupos).sort().forEach(cat => {
            html += `
                                <tr class="bg-light shadow-sm">
                                    <td colspan="6" class="py-2 ps-3 fw-bold text-success border-bottom bg-light bg-gradient" style="font-size: 0.8rem; border-left: 4px solid #008F3D;">
                                        <i class="bi bi-tag-fill me-1"></i> ${cat}
                                    </td>
                                </tr>
                            `;
            grupos[cat].forEach(item => {
                html += renderLinha(item);
            });
        });
        tbody.innerHTML = html;
    } else {
        tbody.innerHTML = lista.map(item => renderLinha(item)).join('');
    }
}


function renderizarComposicaoSINAPI(dadosPai, modalBody) {
    if (!dadosPai || !dadosPai.composicao || !Array.isArray(dadosPai.composicao)) return;

    // Limpa ações extras do rodapé
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) footerExtra.innerHTML = '';

    const formatCurrency = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formatDecimal = (v, d = 3) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

    const codigo = dadosPai.codigo || 'N/A';
    const descricao = (dadosPai.descricao || 'SEM DESCRIÇÃO').toUpperCase();
    const unidade = dadosPai.unidade || 'N/A';
    const versaoRef = formatarVersao(dadosPai.referencia || '');

    // Valor oficial do pai para evitar divergência de arredondamento de centavos
    const precoOficial = parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || dadosPai.preco || dadosPai.valor || 0);

    // Agrupamento por tipo (Insumo/Composição)
    const grupos = {};
    let totalGeral = 0;

    dadosPai.composicao.forEach(item => {
        const tipo = (item.tipo_item || 'INSUMO').toUpperCase().replace('COMPOSICAO', 'COMPOSIÇÃO');
        if (!grupos[tipo]) grupos[tipo] = [];
        const subtotal = (parseFloat(item.coeficiente) || 0) * (parseFloat(item.preco_unitario) || 0);
        totalGeral += subtotal;
        grupos[tipo].push({ ...item, total: subtotal });
    });

    let tableRows = '';
    Object.keys(grupos).sort().forEach(tipo => {
        tableRows += `
                            <tr style="background-color: #e8e8e8; font-size: 0.8rem; font-weight: bold;">
                                <td colspan="8" style="padding: 0.6rem 0.5rem; color: #333; text-align: center; text-uppercase;">${tipo}</td>
                            </tr>
                        `;

        let subtotalGrupo = 0;
        grupos[tipo].forEach(item => {
            subtotalGrupo += item.total;
            tableRows += `
                                <tr style="font-size: 0.8rem; border-bottom: 1px solid #eee;">
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">SINAPI</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${versaoRef}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center; font-weight: bold;">${item.codigo_item || item.codigo}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: justify;">${(item.descricao_item || item.descricao || '').toUpperCase()}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.unidade || '-'}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${formatDecimal(item.coeficiente)}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right;">${formatDecimal(item.preco_unitario, 2)}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right; font-weight: bold;">${formatDecimal(item.total, 2)}</td>
                                </tr>
                            `;
        });

        tableRows += `
                            <tr style="font-size: 0.8rem; background-color: #f5f5f5; font-weight: bold; border-top: 1px solid #ddd;">
                                <td colspan="7" style="padding: 0.6rem 0.5rem; text-align: right; color: #666;">TOTAL ${tipo}</td>
                                <td style="padding: 0.6rem 0.5rem; text-align: right; color: #333;">${formatDecimal(subtotalGrupo, 2)}</td>
                            </tr>
                        `;
    });

    modalBody.innerHTML = `
                        <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                            <!-- Cabeçalho Institucional SOP-CE -->
                            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                                <div class="d-flex align-items-center">
                                    <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SINAPI</div>
                                    <div>
                                        <div class="fw-bold fs-6" style="color: #008F3D; line-height: 1.2;">GOVERNO FEDERAL</div>
                                        <div class="text-dark fw-bold" style="font-size: 0.75rem;">SISTEMA NACIONAL DE PESQUISA DE CUSTOS E ÍNDICES DA CONSTRUO CIVIL</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <h5 class="fw-bold mb-0 text-dark">COMPOSIÇÃO ANALÍTICA</h5>
                                    <div class="text-muted fw-bold" style="font-size: 0.7rem;">GECOPE - GERÊNCIA DE CONTROLE DE ADITIVOS</div>
                                </div>
                            </div>

                            <!-- Metadados (Estilo SINAPI adaptado) -->
                            <div style="background: white; border: 1px solid #eee; border-left: 6px solid #008F3D; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); padding: 1.5rem 0rem; display: flex; align-items: stretch; min-height: 100px; margin-bottom: 2rem;">
                                <div style="flex: 0 0 8%; padding: 0 1rem; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">CDIGO</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${codigo}</div>
                                </div>
                                <div style="flex: 1; padding: 0 2rem; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">DESCRIÇÃO DA COMPOSIÇÃO</small>
                                    <div style="font-size: 1.05rem; font-weight: 800; color: #1a1a1a; text-transform: uppercase; text-align: justify;">${descricao}</div>
                                </div>
                                <div style="flex: 0 0 8%; padding: 0 0.5rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">UNIDADE</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a;">${unidade}</div>
                                </div>
                            </div>

                            <!-- Tabela de Itens SINAPI -->
                            <div class="table-responsive">
                                <table class="table table-sm align-middle" style="border-collapse: collapse; width: 100%;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; background-color: #f5f5f5; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd;">
                                            <th style="width: 8%;" class="fw-bold text-uppercase p-2">FONTE</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase p-2">VERSO</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-center p-2">CDIGO</th>
                                            <th style="width: 48%;" class="fw-bold text-uppercase p-2">DESCRIÇÃO DO INSUMO</th>
                                            <th style="width: 5%;" class="fw-bold text-uppercase text-center p-2">UNID.</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase text-center p-2">COEF.</th>
                                            <th style="width: 9%;" class="fw-bold text-uppercase text-end p-2">P. UNIT.</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-end p-2">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableRows}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Preço Total Unitário (Barra Verde SOP) -->
                            <div class="mt-4" style="padding: 1.8rem 2rem; background: linear-gradient(135deg, #008F3D 0%, #007233 100%); color: white; border-radius: 12px;">
                                <div class="row align-items-center">
                                    <div class="col-8">
                                        <small class="text-white-50 fw-bold d-block mb-1" style="font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase;">Preço Total Unitário (SINAPI)</small>
                                        <div style="font-size: 0.95rem; opacity: 0.9;">Versão: ${versaoRef} . Referência: ${(dadosPai.tipo_encargo || '').toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada'}</div>
                                    </div>
                                    <div class="col-4 text-end">
                                        <div style="font-size: 2.4rem; font-weight: 800;">
                                            <span style="font-size: 1.2rem; vertical-align: middle;">R$</span> ${formatDecimal(precoOficial, 2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                `;
}

function renderizarComposicaoSEINFRA(dadosPai, modalBody, tipoRef) {
    if (!dadosPai) return;

    // Adiciona botão "Ver no site" no rodapé
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) {
        // Prioriza o tipo selecionado na interface para garantir o link correto
        const linkSeinfra = gerarLinkSeinfra(dadosPai.codigo, tipoRef || dadosPai.tipo_encargo);
        footerExtra.innerHTML = `<a href="${linkSeinfra}" target="_blank" class="btn btn-outline-primary btn-sm fw-bold">
                            <i class="bi bi-box-arrow-up-right me-1"></i> SEINFRA
                        </a>`;
    }

    const formatCurrency = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formatDecimal = (v, d = 3) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

    const codigo = dadosPai.codigo || 'N/A';
    const descricao = (dadosPai.descricao || 'SEM DESCRIÇÃO').toUpperCase();
    const unidade = dadosPai.unidade || 'N/A';
    const versaoRef = formatarVersao(dadosPai.referencia || '');

    // Valor oficial do pai para evitar divergência de arredondamento de centavos
    const precoOficial = parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || dadosPai.preco || dadosPai.valor || 0);

    // Agrupamento por Categoria (Mão de Obra, Material, Equipamento, etc.)
    const grupos = {};
    const temComposicao = dadosPai.composicao && Array.isArray(dadosPai.composicao) && dadosPai.composicao.length > 0;

    if (temComposicao) {
        dadosPai.composicao.forEach(item => {
            // Prioriza o novo campo 'categoria', senão usa 'tipo_item' ou 'INSUMO' como fallback
            const categoria = (item.categoria || item.tipo_item || 'INSUMO').toUpperCase().replace('COMPOSICAO', 'COMPOSIÇÃO');
            if (!grupos[categoria]) grupos[categoria] = [];
            const subtotal = (parseFloat(item.coeficiente) || 0) * (parseFloat(item.preco_unitario) || 0);
            grupos[categoria].push({ ...item, total: subtotal });
        });
    }

    let tableContent = '';
    if (!temComposicao) {
        tableContent = `<tr><td colspan="8" class="text-center py-5 text-muted fw-bold">Nenhum dado de composição analítica disponível para este item.</td></tr>`;
    } else {
        // Ordenação personalizada para seguir o padrão da planilha oficial
        const ordemCategorias = ['MAO DE OBRA', 'MATERIAL', 'EQUIPAMENTO', 'SERVIO', 'ENCARGOS COMPLEMENTARES'];
        const categoriasExistentes = Object.keys(grupos).sort((a, b) => {
            const idxA = ordemCategorias.findIndex(cat => a.includes(cat));
            const idxB = ordemCategorias.findIndex(cat => b.includes(cat));
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        categoriasExistentes.forEach(cat => {
            tableContent += `
                                <tr style="background-color: #e8e8e8; font-size: 0.8rem; font-weight: bold;">
                                    <td colspan="8" style="padding: 0.6rem 0.5rem; color: #333; text-align: center; text-uppercase;">${cat}</td>
                                </tr>
                            `;

            let subtotalGrupo = 0;
            grupos[cat].forEach(item => {
                subtotalGrupo += item.total;
                tableContent += `
                                    <tr style="font-size: 0.8rem; border-bottom: 1px solid #eee;">
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">SEINFRA</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${versaoRef}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center; font-weight: bold;">${item.codigo_item || item.codigo}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: justify;">${(item.descricao_item || item.descricao || '').toUpperCase()}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.unidade || '-'}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${formatDecimal(item.coeficiente, 4)}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: right;">${formatDecimal(item.preco_unitario, 2)}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: right; font-weight: bold;">${formatDecimal(item.valor_total || item.total, 2)}</td>
                                    </tr>
                                `;
            });

            // Adiciona linha de TOTAL por categoria (igual a planilha oficial)
            tableContent += `
                                <tr style="font-size: 0.8rem; background-color: #f9f9f9; font-weight: bold; border-top: 1px solid #ddd;">
                                    <td colspan="7" style="padding: 0.6rem 0.5rem; text-align: right; color: #666;">TOTAL ${cat}</td>
                                    <td style="padding: 0.6rem 0.5rem; text-align: right; color: #333;">${formatDecimal(subtotalGrupo, 2)}</td>
                                </tr>
                            `;
        });
    }


    modalBody.innerHTML = `
                        <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                            <!-- Cabeçalho Institucional SOP-CE / SEINFRA -->
                            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                                <div class="d-flex align-items-center">
                                    <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SEINFRA</div>
                                    <div>
                                        <div class="fw-bold fs-6" style="color: #008F3D; line-height: 1.2;">GOVERNO DO ESTADO DO CEARÁ</div>
                                        <div class="text-dark fw-bold" style="font-size: 0.75rem;">SECRETARIA DA INFRAESTRUTURA</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <h5 class="fw-bold mb-0 text-dark">COMPOSIÇÃO ANALÍTICA</h5>
                                    <div class="text-muted fw-bold" style="font-size: 0.7rem;">GECOPE - GERÊNCIA DE CONTROLE DE ADITIVOS</div>
                                </div>
                            </div>

                            <!-- Metadados (Estilo SEINFRA adaptado) -->
                            <div style="background: white; border: 1px solid #eee; border-left: 6px solid #008F3D; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); padding: 1.5rem 0rem; display: flex; align-items: stretch; min-height: 100px; margin-bottom: 2rem;">
                                <div style="flex: 0 0 8%; padding: 0 1rem; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">CDIGO</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${codigo}</div>
                                </div>
                                <div style="flex: 1; padding: 0 2rem; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">DESCRIÇÃO DA COMPOSIÇÃO</small>
                                    <div style="font-size: 1.05rem; font-weight: 800; color: #1a1a1a; text-transform: uppercase; text-align: justify;">${descricao}</div>
                                </div>
                                <div style="flex: 0 0 8%; padding: 0 0.5rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">UNIDADE</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a;">${unidade}</div>
                                </div>
                            </div>

                            <!-- Tabela de Itens SEINFRA -->
                            <div class="table-responsive">
                                <table class="table table-sm align-middle" style="border-collapse: collapse; width: 100%;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; background-color: #f5f5f5; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd;">
                                            <th style="width: 8%;" class="fw-bold text-uppercase p-2">FONTE</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase p-2">VERSO</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-center p-2">CDIGO</th>
                                            <th style="width: 48%;" class="fw-bold text-uppercase p-2">DESCRIÇÃO DO INSUMO</th>
                                            <th style="width: 5%;" class="fw-bold text-uppercase text-center p-2">UNID.</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase text-center p-2">COEF.</th>
                                            <th style="width: 9%;" class="fw-bold text-uppercase text-end p-2">P. UNIT.</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-end p-2">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableContent}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Preço Total Unitário (Barra Verde SOP) -->
                            <div class="mt-4" style="padding: 1.8rem 2rem; background: linear-gradient(135deg, #008F3D 0%, #007233 100%); color: white; border-radius: 12px;">
                                <div class="row align-items-center">
                                    <div class="col-8">
                                        <small class="text-white-50 fw-bold d-block mb-1" style="font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase;">Preço Total Unitário (SEINFRA)</small>
                                        <div style="font-size: 0.95rem; opacity: 0.9;">Versão: ${versaoRef} . Referência: ${(tipoRef || dadosPai.tipo_encargo || '').toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada'}</div>
                                    </div>
                                    <div class="col-4 text-end">
                                        <div style="font-size: 2.4rem; font-weight: 800;">
                                            <span style="font-size: 1.2rem; vertical-align: middle;">R$</span> ${formatDecimal(precoOficial, 2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                `;
}



async function abrirDetalheTabela(codigo, fonte, versao, tipoRef) {
    const modalEl = document.getElementById('modalDetalheComposicao');
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    const modalBody = modalEl.querySelector('.modal-body');

    // Limpa ações extras do rodapé no início
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) footerExtra.innerHTML = '';

    modalBody.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 small text-muted">Carregando detalhes...</div></div>';
    modalInstance.show();

    try {
        let nomeTabela = 'seinfra_itens';
        let dataFormatada = versao;
        if (fonte === 'SINAPI') {
            nomeTabela = 'sinapi_itens';
            if (versao.length === 6) dataFormatada = `${versao.substring(2)}-${versao.substring(0, 2)}-01`;
        }

        let query = sbClient.from(nomeTabela).select('*');

        if (fonte === 'SEINFRA') {
            query = query.eq('referencia', dataFormatada);
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else {
            query = query.eq('referencia', dataFormatada).eq('tipo_encargo', tipoRef);
        }

        const { data: dadosPai, error } = await query.eq('codigo', codigo).single();

        if (dadosPai) currentCompositionData = dadosPai;

        if (error || !dadosPai) {
            modalBody.innerHTML = '<div class="alert alert-warning m-4 fw-bold text-center">Composição não encontrada no banco de dados.</div>';
            return;
        }

        // ===== DESVIO PARA RENDERIZADOR SINAPI =====
        if (fonte === 'SINAPI' && dadosPai.composicao && Array.isArray(dadosPai.composicao) && dadosPai.composicao.length > 0) {
            renderizarComposicaoSINAPI(dadosPai, modalBody);
            return;
        }

        // ===== DESVIO PARA RENDERIZADOR SEINFRA (Gatilho 100% Conectado) =====
        if (fonte === 'SEINFRA') {
            renderizarComposicaoSEINFRA(dadosPai, modalBody, tipoRef);
            return;
        }

        // ===== LGICA ANTERIOR (FALLBACK PARA OUTRAS FONTES) =====
        let itens = (dadosPai && dadosPai.composicao) ? dadosPai.composicao : [];

        if (itens.length === 0) {
            const { data: itensDB } = await sbClient
                .from('tabelas_itens')
                .select('*')
                .eq('fonte', fonte)
                .eq('versao', versao)
                .eq('referencia_pai_cod', codigo);
            itens = itensDB || [];
        }

        const totalSOPResult = itens.reduce((acc, i) => acc + (parseFloat(i.valor_total || (i.coeficiente * i.preco_unitario)) || 0), 0);
        const versaoSOP = formatarVersao(versao || dadosPai.referencia || '');

        modalBody.innerHTML = `
                            <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                                <!-- Cabeçalho Padronizado -->
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <div class="d-flex align-items-center">
                                        <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SOP-CE</div>
                                        <div>
                                            <div class="fw-bold fs-6" style="color: #008F3D;">ESTADO DO CEARÁ</div>
                                            <div class="text-dark fw-bold" style="font-size: 0.75rem;">SUPERINTENDNCIA DE OBRAS PBLICAS</div>
                                        </div>
                                    </div>
                                    <div class="text-end">
                                        <h5 class="fw-bold mb-0 text-dark">DETALHE DA COMPOSIÇÃO</h5>
                                        <div class="text-muted fw-bold" style="font-size: 0.7rem;">FONTE: ${fonte} / ${versaoSOP}</div>
                                    </div>
                                </div>

                                <!-- Metadados -->
                                <div class="mb-4" style="background: white; border: 1px solid #eee; border-left: 6px solid #F28C00; border-radius: 12px; padding: 1.2rem; display: flex; align-items: center;">
                                    <div class="me-4 border-end pe-4">
                                        <small class="text-muted fw-bold d-block mb-1">CDIGO</small>
                                        <div class="fw-bold fs-5">${dadosPai.codigo}</div>
                                    </div>
                                    <div class="flex-grow-1">
                                        <small class="text-muted fw-bold d-block mb-1">DESCRIÇÃO</small>
                                        <div class="fw-bold text-uppercase" style="font-size: 0.95rem;">${dadosPai.descricao}</div>
                                    </div>
                                    <div class="ms-4 border-start ps-4 text-center">
                                        <small class="text-muted fw-bold d-block mb-1">UNID</small>
                                        <div class="fw-bold fs-5">${dadosPai.unidade}</div>
                                    </div>
                                </div>

                                <!-- Tabela -->
                                <div class="table-responsive">
                                    <table class="table table-sm table-bordered">
                                        <thead style="background-color: #f8f9fa;">
                                            <tr class="small fw-bold">
                                                <th class="text-center">ITEM</th>
                                                <th>DESCRIÇÃO DO INSUMO</th>
                                                <th class="text-center">UNID</th>
                                                <th class="text-center">COEF.</th>
                                                <th class="text-end">P. UNIT.</th>
                                                <th class="text-end">TOTAL</th>
                                            </tr>
                                        </thead>
                                        <tbody class="small">
                                            ${itens.map(i => `
                                                <tr>
                                                    <td class="text-center">${i.codigo_item || '-'}</td>
                                                    <td class="text-uppercase">${i.descricao_item || i.descricao}</td>
                                                    <td class="text-center">${i.unidade || '-'}</td>
                                                    <td class="text-center">${parseFloat(i.coeficiente).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</td>
                                                    <td class="text-end">${parseFloat(i.preco_unitario).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                    <td class="text-end fw-bold">${parseFloat(i.valor_total || (i.coeficiente * i.preco_unitario)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>

                                <!-- Rodapé Total Verde -->
                                <div class="mt-3 p-3 text-white d-flex justify-content-between align-items-center" style="background: #008F3D; border-radius: 8px;">
                                    <div class="fw-bold">PREO TOTAL DA COMPOSIÇÃO</div>
                                    <div class="fs-4 fw-bold">R$ ${totalSOPResult.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                            </div>
                        `;
    } catch (e) {
        modalBody.innerHTML = `<div class="alert alert-danger">Erro ao carregar: ${e.message}</div>`;
    }
}

// Nova função para imprimir diretamente da lista de tabelas
async function imprimirLinhaTabela(codigo, fonte, versao, tipoRef) {
    try {
        let nomeTabela = 'seinfra_itens';
        let dataFormatada = versao;
        if (fonte === 'SINAPI') {
            nomeTabela = 'sinapi_itens';
            if (versao.length === 6) dataFormatada = `${versao.substring(2)}-${versao.substring(0, 2)}-01`;
        }

        let query = sbClient.from(nomeTabela).select('*');
        if (fonte === 'SEINFRA') {
            query = query.eq('referencia', dataFormatada);
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else {
            query = query.eq('referencia', dataFormatada).eq('tipo_encargo', tipoRef);
        }

        const { data: dadosPai, error } = await query.eq('codigo', codigo).single();
        if (error || !dadosPai) {
            alert("Dados não encontrados para impressão.");
            return;
        }

        currentCompositionData = dadosPai;
        const tempDiv = document.createElement('div');

        if (fonte === 'SINAPI' && dadosPai.composicao && Array.isArray(dadosPai.composicao)) {
            renderizarComposicaoSINAPI(dadosPai, tempDiv);
        } else if (fonte === 'SEINFRA') {
            renderizarComposicaoSEINFRA(dadosPai, tempDiv, tipoRef);
        } else {
            tempDiv.innerHTML = `
                                <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                                    <h4 class="fw-bold">${dadosPai.codigo} - ${dadosPai.descricao}</h4>
                                    <p class="text-muted">Unidade: ${dadosPai.unidade}</p>
                                    <p class="fw-bold">Valor Unitário: ${parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                </div>
                            `;
        }

        imprimirRelatorioSOP(dadosPai, tempDiv.innerHTML);

    } catch (e) {
        console.error(e);
        alert("Erro ao preparar impressão: " + e.message);
    }
}

async function atualizarSelectVersao() {
    const fonte = document.getElementById('busca-fonte').value;
    const selectVersao = document.getElementById('busca-versao');
    const selectRef = document.getElementById('busca-ref');

    if (!selectVersao) return;

    // Mostra estado de carregamento
    selectVersao.innerHTML = '<option value="">Buscando...</option>';
    selectVersao.disabled = true;

    try {
        if (fonte === 'SEINFRA') {
            // Verifica versões recentes da SEINFRA (Tabelas de referência do Ceará)
            const candidates = ["30", "29", "28", "27", "26"];
            const checks = await Promise.all(candidates.map(async v => {
                // Verifica se existe dados para esta referência
                const { count } = await sbClient.from('seinfra_itens').select('*', { count: 'exact', head: true }).eq('referencia', v);
                return { v, count: count || 0 };
            }));

            selectVersao.innerHTML = '';
            const valids = checks.filter(r => r.count > 0);
            if (valids.length > 0) {
                valids.forEach(r => selectVersao.add(new Option(`Tabela 0${r.v}`, r.v)));
            } else {
                // Fallback estático
                ["28", "27"].forEach(t => selectVersao.add(new Option(`Tabela 0${t}`, t)));
            }
            selectRef.disabled = false;
        }
        else if (fonte === 'SINAPI' || fonte === 'ORSE') {
            const tabela = (fonte === 'SINAPI') ? 'sinapi_itens' : 'orse_itens';
            const mapMesLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            const now = new Date();
            const candidates = [];

            // Verifica os últimos 12 meses para encontrar versões disponíveis no banco
            // Isso garante que se o administrador carregar nov/2025, o sistema detecta sozinho
            for (let i = 0; i < 12; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const mesIdx = d.getMonth();
                const ano = d.getFullYear();
                const mesStr = String(mesIdx + 1).padStart(2, '0');

                candidates.push({
                    label: `${mapMesLabels[mesIdx]}/${ano}`,
                    dbDate: `${ano}-${mesStr}-01`,
                    sinapiVal: `${mesStr}${ano}`, // Formato MMYYYY esperado pela busca
                    orseVal: `${mesStr}/${ano}`   // Formato MM/YYYY esperado pela busca
                });
            }

            const checks = await Promise.all(candidates.map(async c => {
                const { count } = await sbClient.from(tabela).select('*', { count: 'exact', head: true }).eq('referencia', c.dbDate);
                return { ...c, count: count || 0 };
            }));

            selectVersao.innerHTML = '';
            const valids = checks.filter(r => r.count > 0);
            if (valids.length > 0) {
                valids.forEach(r => {
                    const val = (fonte === 'SINAPI') ? r.sinapiVal : r.orseVal;
                    selectVersao.add(new Option(r.label, val));
                });
            } else {
                // Fallback se a internet/banco falhar
                if (fonte === 'SINAPI') selectVersao.add(new Option("Dez/2025", "122025"));
                else selectVersao.add(new Option("Dez/2025", "12/2025"));
            }

            if (fonte === 'ORSE') {
                selectRef.value = 'onerada';
                selectRef.disabled = true;
            } else {
                selectRef.disabled = false;
            }
        }
    } catch (err) {
        console.error("Erro ao atualizar versões:", err);
        // Fallback genérico
        if (fonte === 'SEINFRA') {
            selectVersao.innerHTML = '';
            ["28", "27"].forEach(t => selectVersao.add(new Option(`Tabela 0${t}`, t)));
        } else {
            selectVersao.innerHTML = `<option value="${fonte === 'SINAPI' ? '122025' : '12/2025'}">Dez/2025</option>`;
        }
    } finally {
        selectVersao.disabled = false;
    }
}
document.addEventListener('DOMContentLoaded', atualizarSelectVersao);

// Removida baixarComposicaoPDF pois agora usamos a impressão HTML unificada



async function prepararExportacaoComposicao(id, urlArquivo) {
    try {
        let docData = null;

        // 1. Se não temos URL ou ela é nula (Composição Analítica Direta no Banco)
        if (!urlArquivo || urlArquivo === 'undefined' || urlArquivo === 'null' || urlArquivo === '') {
            const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
            if (error || !data) throw new Error("Documento não encontrado no banco.");

            if (data.itens) {
                docData = {
                    meta: {
                        codigo: data.codigo || 'S/C',
                        descricao: data.descricao,
                        unidade: data.unidade || '-',
                        data_base: data.data_base,
                        bdi: data.bdi,
                        desconto: data.desconto,
                        totais: null
                    },
                    itens: data.itens || []
                };
            } else {
                urlArquivo = data.arquivo_url;
            }
        }

        // 2. Se temos URL e NO termina em .json, é um arquivo direto (PDF/XLS) -> BAIXAR DIRETO
        if (urlArquivo && !urlArquivo.toLowerCase().includes('.json')) {
            const link = document.createElement('a');
            link.href = urlArquivo;
            link.download = ''; // Sugere o nome original do arquivo
            link.target = '_blank';
            link.click();
            return;
        }

        // 3. Se temos URL e  um .json, buscamos o conteúdo
        if (urlArquivo && urlArquivo.toLowerCase().includes('.json')) {
            const finalUrl = `${urlArquivo}?t=${new Date().getTime()}`;
            const response = await fetch(finalUrl);
            if (!response.ok) throw new Error("Erro ao baixar dados da composição.");
            docData = await response.json();
        }

        if (docData) {
            const meta = docData.meta || {};
            const dados = {
                codigo: meta.codigo || 'S/C',
                descricao: meta.descricao,
                unidade: meta.unidade || '-',
                data_base: meta.data_base,
                bdi: meta.bdi,
                desconto: meta.desconto,
                itens: docData.itens || [],
                totais: meta.totais,
                versao_atual: meta.versao || ''
            };
            imprimirRelatorioSOP(dados);
        } else {
            alert("Esta composição não possui arquivo nem dados analíticos.");
        }
    } catch (e) {
        console.error(e);
        alert("Erro ao carregar: " + e.message);
    }
}

const formatarVersao = (texto) => {
    if (!texto || texto === '-') return '-';
    const txt = texto.toString().toUpperCase().trim();

    // Lista de abreviações dos meses
    const mesesAbrev = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    // Mapa de nomes completos para abreviações
    const mesesMap = {
        'JANEIRO': 'Jan', 'FEVEREIRO': 'Fev', 'MARO': 'Mar', 'ABRIL': 'Abr',
        'MAIO': 'Mai', 'JUNHO': 'Jun', 'JULHO': 'Jul', 'AGOSTO': 'Ago',
        'SETEMBRO': 'Set', 'OUTUBRO': 'Out', 'NOVEMBRO': 'Nov', 'DEZEMBRO': 'Dez'
    };

    // Caso 1: Detecção de números de versão (Ex: "28.1", "30") -> Manter inalterado
    if (/^\d+(\.\d+)?$/.test(txt)) return txt;

    // Caso 2: Tenta encontrar nome do mês por extenso ou abreviado (Ex: "SETEMBRO DE 2024" ou "FEV. DE 2026")
    const mesesAbrevMap = {
        'JAN': 'Jan', 'FEV': 'Fev', 'MAR': 'Mar', 'ABR': 'Abr',
        'MAI': 'Mai', 'JUN': 'Jun', 'JUL': 'Jul', 'AGO': 'Ago',
        'SET': 'Set', 'OUT': 'Out', 'NOV': 'Nov', 'DEZ': 'Dez'
    };

    // Primeiro tenta meses completos (para não casar "MAR" em "MARO")
    for (let mes in mesesMap) {
        if (txt.includes(mes)) {
            const anoMatch = txt.match(/\d{4}/);
            if (anoMatch) return `${mesesMap[mes]}/${anoMatch[0].substring(2)}`;
        }
    }

    // Depois tenta abreviações
    for (let abrev in mesesAbrevMap) {
        if (txt.includes(abrev)) {
            const anoMatch = txt.match(/\d{4}/);
            if (anoMatch) return `${mesesAbrevMap[abrev]}/${anoMatch[0].substring(2)}`;
        }
    }

    // Caso 3: Parse de datas ISO (YYYY-MM-DD) ou BR (DD/MM/YYYY)
    let d = null;
    if (txt.includes('-')) {
        const p = txt.split('-');
        if (p.length === 3) d = new Date(p[0], p[1] - 1, p[2]);
        else if (p.length === 2) d = new Date(p[0], p[1] - 1, 1);
    } else if (txt.includes('/')) {
        const p = txt.split('/');
        if (p.length === 3) d = new Date(p[2], p[1] - 1, p[0]);
        else if (p.length === 2) {
            // Se for MM/YYYY (SINAPI/ORSE)
            const mes = parseInt(p[0]);
            const ano = p[1];
            if (mes >= 1 && mes <= 12 && ano.length === 4) {
                return `${mesesAbrev[mes - 1]}/${ano.substring(2)}`;
            }
        }
    }

    if (d && !isNaN(d.getTime())) {
        return `${mesesAbrev[d.getMonth()]}/${d.getFullYear().toString().substring(2)}`;
    }

    return texto; // Retorno padrão
};

const normalizarItemParaPDF = (item) => {
    const precoUnit = Number(item.preco_unitario || item.preco || item.p || 0);
    const coef = Number(item.coeficiente || item.coef || item.c || 0);
    const total = Number(item.total || item.total_item || item.t || (precoUnit * coef)) || 0;

    // Mapeamento de nomes de grupo para padrão de exibição
    const rawGrupo = (item.tipo_grupo || item.grupo || item.g || 'GERAL').toUpperCase();
    let grupoDisplay = rawGrupo;
    if (rawGrupo === 'MAO_DE_OBRA' || rawGrupo === 'MAO DE OBRA') grupoDisplay = 'MAO DE OBRA';
    else if (rawGrupo === 'SERVICO' || rawGrupo === 'SERVICOS') grupoDisplay = 'SERVIO';
    else if (rawGrupo === 'MATERIAL' || rawGrupo === 'MATERIAIS') grupoDisplay = 'MATERIAL';
    else if (rawGrupo === 'COMPOSICAO' || rawGrupo === 'COMPOSICOES') grupoDisplay = 'COMPOSIÇÃO';

    // Fallbacks para Código e Descrição
    const codigo = item.codigo_insumo || item.codigo_item || item.codigo || item.cod || '-';
    const descricao = item.descricao_insumo || item.descricao_item || item.descricao || item.desc || '-';
    const fonte = item.origem || item.fonte || item.fonte_insumo || item.tabela || (item.retroativo ? 'COTAO' : '-');

    return {
        origem: fonte,
        versao: formatarVersao(item.versao || item.data_tabela || item.data_referencia || item.referencia_tabela || item.retroativo?.dataIni || '-'),
        codigo: codigo,
        descricao: descricao,
        unidade: item.unidade || item.unid || '-',
        coeficiente: coef,
        preco_unitario: precoUnit,
        total: total,
        grupo: grupoDisplay,
        referencia: item.referencia || item.tipo_encargo || '',
        retroativo: item.retroativo || null
    };
};

// --------------------------------------------------------------
// FUNO GERAR PDF (MANTIDA COMO FALLBACK SE NECESSÁRIO)
// --------------------------------------------------------------
async function gerarPDF_Profissional(rawInput) {
    if (!rawInput) return;

    // Feedback visual instantâneo
    const btnsBaixar = document.querySelectorAll('.btn-action-baixar, .btn-outline-success');
    const originalTexts = Array.from(btnsBaixar).map(b => b.innerHTML);
    btnsBaixar.forEach(b => {
        b.disabled = true;
        b.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    });

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const verdeSOP = [0, 143, 61];
        const cinzaHeader = [242, 242, 242];
        const cinzaTexto = [100, 100, 100];

        const fCur = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fNum4 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

        // 1. Cabeçalho Institucional SOP (Fidelidade Absoluta com a Modal)
        doc.setFillColor(...verdeSOP); doc.roundedRect(14, 10, 20, 10, 1, 1, 'F');
        doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
        doc.text("SOP-CE", 24, 16.5, { align: "center" });

        doc.setTextColor(...verdeSOP); doc.setFontSize(10); doc.text("ESTADO DO CEARÁ", 38, 14);
        doc.setTextColor(60, 60, 60); doc.setFontSize(7); doc.text("SUPERINTENDNCIA DE OBRAS PBLICAS", 38, 18);

        doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text("COMPOSIÇÃO ANALÍTICA", 196, 14, { align: "right" });
        doc.setTextColor(...cinzaTexto); doc.setFontSize(6); doc.text("GEROA - GERÊNCIA DE ORAMENTOS E AVALIAO DE IMVEIS", 196, 18, { align: "right" });

        doc.setDrawColor(200); doc.line(14, 22, 196, 22);

        // 2. Metadados Grid - Clone idêntico da Imagem 01 (Otimização Máxima de Espaço Central)
        doc.setDrawColor(220); doc.setFillColor(255);
        doc.rect(14, 25, 182, 17, 'D');
        doc.line(34, 25, 34, 42); // Barra 1 (Muito Reduzido)
        doc.line(170, 25, 170, 42); // Barra 2 (Máximo Expandida: Descrição)
        doc.line(182, 25, 182, 42); // Barra 3 (Mínimo Unit)

        doc.setFontSize(5); doc.setTextColor(150); doc.setFont("helvetica", "bold");
        doc.text("CDIGO / VERSO", 15.5, 29);
        doc.text("DESCRIÇÃO DA COMPOSIÇÃO", 36, 29);
        doc.text("UNID:", 171, 29);

        doc.setFontSize(8.5); doc.setTextColor(0); doc.setFont("helvetica", "bold");
        doc.text(rawInput.codigo || 'S/C', 15.5, 35);
        if (rawInput.versao_atual) {
            doc.setFontSize(5); doc.roundedRect(26.5, 33, 6, 3, 0.5, 0.5, 'D');
            doc.text(rawInput.versao_atual, 29.5, 35.2, { align: "center" });
        }

        doc.setFontSize(8.5); doc.setTextColor(0);
        const descLines = doc.splitTextToSize((rawInput.descricao || '').toUpperCase(), 130);
        doc.text(descLines, 36, 34, { align: "justify" });

        doc.setFontSize(10); doc.text(rawInput.unidade || '-', 176, 37.5, { align: "center" });

        // Área BDI (182 a 196)
        doc.setFontSize(6.5);
        doc.setTextColor(120); doc.text("BDI:", 183.5, 33);
        doc.setTextColor(0, 80, 200); doc.setFont("helvetica", "bold"); doc.text(`${rawInput.bdi || '0,00'}%`, 194.5, 33, { align: "right" });
        doc.setTextColor(120); doc.setFont("helvetica", "normal"); doc.text("DESC:", 183.5, 38.5);
        doc.setTextColor(200, 0, 0); doc.setFont("helvetica", "bold"); doc.text(`${rawInput.desconto || '0,00'}%`, 194.5, 38.5, { align: "right" });

        // 3. Preparação dos Itens (Utilizando normalizarItemParaPDF para consistência total com a Modal)
        const itensRaw = rawInput.itens || [];
        const itens = itensRaw.map(normalizarItemParaPDF);
        const retroativos = [];

        const body = [];
        const ordemGrupos = ['MAO DE OBRA', 'MATERIAL', 'EQUIPAMENTOS', 'SERVIO', 'GERAL'];
        const itensAgrupados = itens.reduce((acc, item) => {
            const g = item.grupo || 'GERAL';
            if (!acc[g]) acc[g] = [];
            acc[g].push(item);
            return acc;
        }, {});

        const gruposDisponiveis = Object.keys(itensAgrupados).sort((a, b) => {
            const idxA = ordemGrupos.indexOf(a);
            const idxB = ordemGrupos.indexOf(b);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        let totalSimples = 0;

        gruposDisponiveis.forEach(g => {
            body.push([{ content: g.toUpperCase(), colSpan: 8, styles: { halign: 'center', fillColor: cinzaHeader, fontStyle: 'bold', textColor: 0 } }]);

            let subtotalGrupo = 0;
            itensAgrupados[g].forEach(i => {
                let fonteStr = i.origem;
                if ((i.origem === 'SEINFRA' || i.origem === 'SINAPI') && i.referencia) {
                    const refLabel = i.referencia.toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada';
                    fonteStr += `\n${refLabel}`;
                }

                body.push([
                    fonteStr,
                    i.versao || '-',
                    i.codigo || '-',
                    i.descricao || '-',
                    i.unidade || '-',
                    fNum4(i.coeficiente),
                    fCur(i.preco_unitario),
                    fCur(i.total)
                ]);
                subtotalGrupo += i.total;
                totalSimples += i.total;
                if (i.retroativo) retroativos.push({ ...i, codInsumo: i.codigo, descInsumo: i.descricao });
            });

            body.push([{
                content: `TOTAL ${g}`,
                colSpan: 7,
                styles: { halign: 'right', fontStyle: 'bold', textColor: cinzaTexto, fontSize: 6.5 }
            }, {
                content: fCur(subtotalGrupo),
                styles: { halign: 'right', fontStyle: 'bold' }
            }]);
        });

        doc.autoTable({
            startY: 45,
            head: [['FONTE', 'VERSÃO', 'CÓDIGO', 'DESCRIÇÃO DO INSUMO', 'UNID', 'COEF.', 'P. UNIT.', 'TOTAL']],
            body: body,
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak' },
            headStyles: { fillColor: cinzaHeader, textColor: 0, halign: 'center', fontStyle: 'bold' },
            columnStyles: {
                0: { halign: 'center', cellWidth: 'auto' }, // FONTE
                1: { halign: 'center', cellWidth: 'auto' }, // VERSÃO
                2: { halign: 'center', cellWidth: 'auto' }, // CÓDIGO
                3: { cellWidth: '*' }, // DESCRIÇÃO DO INSUMO (Ocupa o resto)
                4: { halign: 'center', cellWidth: 'auto' }, // UNID
                5: { halign: 'center', cellWidth: 'auto' }, // COEF.
                6: { halign: 'right', cellWidth: 'auto' },  // P. UNIT.
                7: { halign: 'right', cellWidth: 'auto' }   // TOTAL
            },
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                doc.setFontSize(6); doc.setTextColor(150);
                doc.text(`Painel GECOPE/SOP | Página ${data.pageNumber} | Código: ${rawInput.codigo || '-'}`, 14, 285);
            }
        });

        // 4. Totais Finais
        let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 45) + 6;
        const drawTot = (label, val, col = [0, 0, 0], bold = false) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setTextColor(...col); doc.setFontSize(bold ? 10 : 7); doc.setFont("helvetica", bold ? "bold" : "normal");
            doc.text(label.toUpperCase(), 155, y, { align: 'right' });
            doc.text(`R$ ${fCur(val)}`, 196, y, { align: 'right' });
            y += bold ? 8 : 5;
        };

        const bdiVal = (totalSimples * (parseFloat(rawInput.bdi || 0) / 100));
        const tBDI = totalSimples + bdiVal;
        const descVal = (tBDI * (parseFloat(rawInput.desconto || 0) / 100));
        const pFinal = tBDI - descVal;

        drawTot("Total Simples", totalSimples);
        if (bdiVal > 0) drawTot(`(+) BDI (${rawInput.bdi}%)`, bdiVal, [0, 80, 200]);
        if (descVal > 0) drawTot(`(-) Desconto (${rawInput.desconto}%)`, descVal, [200, 0, 0]);
        doc.setDrawColor(...verdeSOP); doc.line(135, y - 2, 196, y - 2); y += 3;
        drawTot("Preço Total Unitário", pFinal, verdeSOP, true);

        // 5. Memória de Cálculo (Página Extra conforme Modal)
        if (retroativos.length > 0) {
            doc.addPage();
            doc.setTextColor(...verdeSOP); doc.setFontSize(12); doc.setFont("helvetica", "bold");
            doc.text("METODOLOGIA DE CÁLCULO (RETROAO DE PREOS)", 14, 20);

            doc.setTextColor(80, 80, 80); doc.setFontSize(8); doc.setFont("helvetica", "normal");
            const intro = "Os custos obtidos via cotação de mercado foram retroagidos financeiramente para a Data-Base do orçamento, garantindo a homogeneidade temporal dos preços.";
            doc.text(doc.splitTextToSize(intro, 182), 14, 26);

            let currentY = 35;
            retroativos.forEach(r => {
                if (currentY > 220) { doc.addPage(); currentY = 20; }
                doc.setTextColor(0); doc.setFontSize(9); doc.setFont("helvetica", "bold");
                doc.text(`Item: ${r.codInsumo} - ${r.descInsumo}`, 14, currentY);
                currentY += 5;

                const ret = r.retroativo;

                // Tabela de Fornecedores (se houver)
                if (ret.fornecedores && ret.fornecedores.length > 0) {
                    doc.setFontSize(7.5); doc.setTextColor(80);
                    doc.text(`Detalhamento das Coletas (${ret.metodoPreco === 'MEDIA' ? 'Média Aritmética' : 'Menor Preço Adotado'}):`, 14, currentY);
                    currentY += 2;

                    doc.autoTable({
                        startY: currentY,
                        head: [['Fornecedor', 'Valor Cotado']],
                        body: ret.fornecedores.map(f => [f.nome, `R$ ${fCur(f.valor)}`]),
                        theme: 'grid',
                        styles: { fontSize: 7, cellPadding: 1.5 },
                        headStyles: { fillColor: cinzaHeader, textColor: 0 },
                        margin: { left: 14, right: 100 }
                    });
                    currentY = doc.lastAutoTable.finalY + 6;
                }

                doc.setFontSize(7.5); doc.setTextColor(80);
                doc.text(`Compatibilidade Temporal (Retroação):`, 14, currentY);
                currentY += 2;

                const fator = (Number(ret.indFin) / Number(ret.indIni)) || 1;
                doc.autoTable({
                    startY: currentY,
                    head: [['Parâmetro', 'Descrição / Valor']],
                    body: [
                        ['Valor de Mercado / Base (A)', `R$ ${fCur(ret.base)}`],
                        ['Data Cotação / Índice (C)', `${ret.dataIni?.split('-').reverse().join('/') || '-'} | ${fNum4(ret.indIni)}`],
                        ['Data-Base / Índice (E)', `${ret.dataFin?.split('-').reverse().join('/') || '-'} | ${fNum4(ret.indFin)}`],
                        ['Fator (E/C)', fator.toFixed(4)],
                        ['Preço Adotado Final (A x Fator)', { content: `R$ ${fCur(Number(ret.base) * fator)}`, styles: { fontStyle: 'bold', textColor: verdeSOP } }]
                    ],
                    theme: 'grid',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: cinzaHeader, textColor: 0 },
                    margin: { left: 14, right: 70 }
                });
                currentY = doc.lastAutoTable.finalY + 12;
            });
        }

        doc.save(`${rawInput.codigo || 'SOP'}_Analitica.pdf`);
    } catch (e) {
        alert("Erro: " + e.message);
    } finally {
        btnsBaixar.forEach((b, i) => { b.disabled = false; b.innerHTML = originalTexts[i]; });
    }
}

// NOVA FUNO: VISUALIZAR COMPOSIÇÃO (Fetch JSON -> Gerar PDF Blob)
// NOVA FUNO: VISUALIZAR COMPOSIÇÃO (SOP) - Versão Relatório Professional
async function visualizarComposicao(id, url, options = {}) {
    try {
        const modalEl = document.getElementById('modalDetalheComposicao');
        if (!modalEl) {
            console.error("Modal modalDetalheComposicao não encontrado!");
            return;
        }

        // Garante que o modal esteja no body para evitar problemas de posicionamento
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        const modalBody = document.getElementById('modal-report-body');

        // Limpa e mostra loader
        if (modalBody) {
            modalBody.innerHTML = `
                                <div class="p-5 text-center text-muted">
                                    <div class="spinner-border text-success mb-3" style="width: 3rem; height: 3rem;"></div>
                                    <h5 class="fw-bold">Carregando Relatório SOP...</h5>
                                    <p>Aguarde enquanto processamos os dados técnicos.</p>
                                </div>
                            `;
            let docData = null;
            let sourceSOP = false;

            // 1. Caso 1: Composição Analítica elaborada no sistema (Direto do Banco)
            if (!url || url === 'undefined' || url === 'null' || url === '') {
                const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
                if (error || !data) throw new Error("Documento não encontrado no banco.");

                if (data.itens) {
                    sourceSOP = false;
                    docData = data; // Passamos o objeto completo
                } else {
                    url = data.arquivo_url;
                }
            }

            // 2. Arquivos PDF/XLS Diretos
            if (url && !url.toLowerCase().includes('.json')) {
                window.open(url, '_blank');
                return;
            }

            // 3. Caso 2: Composição Importada (JSON SOP)
            if (url && url.toLowerCase().includes('.json')) {
                const finalUrl = `${url}?t=${new Date().getTime()}`;
                const response = await fetch(finalUrl);
                if (!response.ok) throw new Error("Erro ao baixar arquivo JSON.");

                const json = await response.json();
                const meta = json.meta || {};
                sourceSOP = true;
                docData = {
                    ...json, // Mantém todos os campos originais
                    codigo: meta.codigo || 'S/C',
                    descricao: meta.descricao,
                    unidade: meta.unidade,
                    data_base: meta.data_base,
                    bdi: meta.bdi,
                    desconto: meta.desconto,
                    versao_atual: meta.versao || meta.versao_projeto || '',
                    itens: json.itens || [],
                    usuario: 'SOP' // Identificador de Composição Oficial
                };
            }

            if (docData) {
                currentCompositionData = docData; // Salva para download via modal
                if (docData.itens && Array.isArray(docData.itens)) {
                    // Versão Relatório HTML Premium (Imagem 01)
                    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
                    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

                    // Inicializa os inputs de BDI e Desconto no cabeçalho do Modal
                    const inputBdi = document.getElementById('modal-report-bdi');
                    const inputDesc = document.getElementById('modal-report-desc');
                    if (inputBdi) inputBdi.value = (docData.bdi || 0).toString().replace(',', '.');
                    if (inputDesc) inputDesc.value = (docData.desconto || 0).toString().replace(',', '.');

                    // Mostra loader
                    modalBody.innerHTML = `<div class="p-5 text-center text-muted"><div class="spinner-border text-success mb-3"></div><p>Carregando Relatório GECOPE...</p></div>`;
                    modal.show();

                    renderizarRelatorioSOP_HTML(docData, modalBody);
                } else {
                    // Caso não seja analítica (ex: apenas arquivo PDF/XLS arquivado)
                    if (url) window.open(url, '_blank');
                    else throw new Error("Documento não possui dados analíticos.");
                }
            } else {
                if (!url) {
                    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
                    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                    modalBody.innerHTML = '<div class="alert alert-warning m-4 fw-bold text-center">Esta composição não possui arquivo nem dados analíticos para visualização.</div>';
                    modal.show();
                }
            }
        }

    } catch (err) {
        console.error(err);
        // Garante que o modal feche se houver erro para não travar a tela, apenas se estiver aberto
        const modalEl = document.getElementById('modalDetalheComposicao');
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst && inst._isShown) inst.hide();
        alert("Erro ao visualizar: " + err.message);
    }
}

