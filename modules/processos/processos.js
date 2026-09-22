
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


// --- AUTOMAÇÃO DE STATUS: NÃO MORA MAIS AQUI ---
// O antigo `window.StatusSync.verificarEAtualizarStatus` foi removido na revisão de
// 22/09/2026. Era uma cópia cliente das REGRA 1-5 de transição de status, sem nenhum
// chamador desde que o polling saiu do navegador — ou seja, 88 linhas de regra de negócio
// que só podiam divergir da regra de verdade com o tempo.
//
// A automação de status roda hoje SÓ no servidor, no job `sincronizar-suite`
// (supabase/functions/sincronizar-suite/index.ts, função `decidirNovoStatus`), disparado
// pelo pg_cron. O navegador apenas LÊ `processos.suite` e `processos.status` da tabela.
//
// Se precisar mudar uma regra de status, é lá — e baixe a versão publicada antes de editar.

// --- ALERTA DE PRÉ-DILIGÊNCIA ---
// Setores da SOP por onde um processo já APROVADO pode voltar a tramitar antes de
// retornar formalmente à GECOPE (o que hoje só é detectado quando o SUITE marca sigla = GECOPE,
// gerando o status DILIGÊNCIA). Avisar aqui permite intervir antes de o processo chegar.
const SETORES_RISCO_DILIGENCIA = ['DIFOR', 'GEFOE', 'DIRED', 'GEDOP'];

function isSetorRiscoDiligencia(sigla) {
    const s = String(sigla || '').toUpperCase().trim();
    if (!s || s === 'GECOPE') return false;
    return SETORES_RISCO_DILIGENCIA.some(setor => s.startsWith(setor));
}

// Busca, em lote, o comentário mais recente de justificativa do alerta de retorno
// para cada processo de window.allData, e anexa em d.alertaRetornoUltimo.
async function carregarAlertasRetornoComentarios() {
    if (!sbClient || !window.allData || !window.allData.length) return;
    try {
        // Só processo com status APROVADO chega a LER alertaRetornoUltimo — veja
        // aplicarAlertaPreDiligencia logo abaixo: emRiscoBruto exige stTxt.includes('APROVADO').
        // Para os demais, o campo fica null e nunca é consultado, então baixar o histórico
        // deles aqui era desperdício. Colunas explícitas: created_at só ordena no servidor,
        // não precisa vir na resposta. Egress, 18/09/2026 — docs/auditoria-egress-2026-09.md,
        // item 8.
        const ids = window.allData
            .filter(d => d.id && (d.status || '').toString().toUpperCase().includes('APROVADO'))
            .map(d => String(d.id));
        if (!ids.length) return;

        const { data, error } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('processo_id, sigla, comentario')
            .in('processo_id', ids)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const ultimoPorProcesso = {};
        (data || []).forEach(reg => {
            if (!ultimoPorProcesso[reg.processo_id]) ultimoPorProcesso[reg.processo_id] = reg;
        });

        window.allData.forEach(d => {
            d.alertaRetornoUltimo = ultimoPorProcesso[String(d.id)] || null;
        });
    } catch (e) {
        console.error('[ERRO] Falha ao carregar comentários de alerta de retorno:', e);
    }
}

function montarAlertaIconeHTML(d) {
    if (d.alerta_pre_diligencia) {
        const siglaTxt = d.suite_sigla_risco ? escapeHTML(d.suite_sigla_risco) : 'setor de risco';
        return ` <i class="bi bi-exclamation-triangle-fill text-alerta-diligencia ms-1" style="cursor:pointer;" onclick="abrirModalAlertaRetorno('${escapeHTML(d.processo)}')" title="Atenção: processo aprovado tramitando em ${siglaTxt} — risco de retornar para diligência antes de chegar à GECOPE. Clique para registrar o motivo."></i>`;
    }
    if (d.alerta_retorno_resolvido && d.alertaRetornoUltimo) {
        const comentarioTxt = escapeHTML(d.alertaRetornoUltimo.comentario);
        return ` <i class="bi bi-check-circle-fill text-success ms-1" style="cursor:pointer;" onclick="abrirModalAlertaRetorno('${escapeHTML(d.processo)}')" title="${comentarioTxt}"></i>`;
    }
    return '';
}

// Atualiza o flag de risco de um processo (na linha em tela, se houver, e no window.allData)
// e mantém o contador da aba "Aprovados" sincronizado. Um processo já comentado para a
// sigla atual conta como resolvido (ícone check); se a sigla mudar para outro setor de
// risco diferente do último comentário, o alerta reabre (ícone exclamação de novo).
// Índice processo -> linha de window.allData, para não varrer o vetor inteiro a cada
// chamada. Invalidado sempre que window.allData é substituído. — 22/09/2026
let _indiceAllDataPorProcesso = null;
let _indiceAllDataOrigem = null;

/** Força a reconstrução do índice. Necessário para quem MUTA window.allData no lugar
 *  (push/unshift/splice), porque a invalidação abaixo compara identidade de vetor. */
function invalidarIndiceAllData() {
    _indiceAllDataPorProcesso = null;
    _indiceAllDataOrigem = null;
}

function linhaGlobalPorProcesso(numeroProcesso) {
    const base = window.allData;
    if (!base) return null;
    if (_indiceAllDataOrigem !== base) {
        _indiceAllDataPorProcesso = new Map();
        base.forEach(x => { if (x && x.processo) _indiceAllDataPorProcesso.set(x.processo, x); });
        _indiceAllDataOrigem = base;
    }
    return _indiceAllDataPorProcesso.get(numeroProcesso) || null;
}

/**
 * @param {boolean} adiarBadge  quando true, NÃO atualiza o contador da aba Aprovados.
 *   Usado pelos laços que chamam esta função uma vez por linha: o contador varria
 *   window.allData inteiro a cada chamada (e chamava mais duas varreduras dentro de
 *   atualizarBadgeAbaAprovados), dando ~3n² varreduras por render. Quem adia é responsável
 *   por chamar atualizarBadgeAbaAprovados() uma única vez ao terminar.
 */
function aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, stTxtParam, adiarBadge) {
    const stTxt = (stTxtParam || d.status || '').toString().toUpperCase();
    const emRiscoBruto = stTxt.includes('APROVADO') && isSetorRiscoDiligencia(sigla);

    const ultimo = d.alertaRetornoUltimo;
    const resolvidoParaEstaSigla = !!(emRiscoBruto && ultimo && ultimo.sigla === sigla);

    d.alerta_pre_diligencia = emRiscoBruto && !resolvidoParaEstaSigla;
    d.alerta_retorno_resolvido = resolvidoParaEstaSigla;
    d.suite_sigla_risco = emRiscoBruto ? sigla : null;

    const globalRow = linhaGlobalPorProcesso(d.processo);
    if (globalRow && globalRow !== d) {
        globalRow.alerta_pre_diligencia = d.alerta_pre_diligencia;
        globalRow.alerta_retorno_resolvido = d.alerta_retorno_resolvido;
        globalRow.suite_sigla_risco = d.suite_sigla_risco;
    }

    if (tr && alertaIcone) {
        const html = montarAlertaIconeHTML(d);
        alertaIcone.innerHTML = html;
        alertaIcone.style.display = html ? 'inline' : 'none';
        tr.classList.toggle('tr-alerta-pre-diligencia', d.alerta_pre_diligencia);
    }

    if (!adiarBadge) atualizarBadgeAbaAprovados();
}

// Flag de reentrância: `atualizarBadgeAbaAprovados` pode chamar `updateReuniao()`, que por
// sua vez remonta a tabela e volta a chamar esta função. Quando isso acontecia no meio de um
// render, o laço externo continuava escrevendo em <tr> que já tinham sido descartados do DOM
// — a coluna SUITE e os ícones de alerta das linhas restantes iam parar em nós órfãos.
// Agora, se o pedido de re-render chegar durante um render, ele é adiado para depois. — 22/09/2026
let _renderReuniaoEmAndamento = false;

// Contador de alerta exibido no botão da aba "Aprovados"
function atualizarBadgeAbaAprovados() {
    const qtd = (window.allData || []).filter(d => d.alerta_pre_diligencia).length;

    const badge = document.getElementById('badge-alerta-aprovados');
    if (badge) {
        const contador = badge.querySelector('span');
        if (qtd > 0) {
            if (contador) contador.textContent = qtd > 9 ? '9+' : String(qtd);
            badge.title = `${qtd} processo(s) aprovado(s) já tramitando em setor de risco (DIFOR/GEFOE/DIRED/GEDOP) — provável retorno para diligência`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    const contadorFiltro = document.getElementById('contador-filtro-alerta');
    if (contadorFiltro) contadorFiltro.textContent = String(qtd);

    // Se o filtro estava ativo e o alerta zerou (ex.: processo saiu do setor de risco), desliga sozinho
    if (qtd === 0 && window.filtroSomenteAlertaDiligencia) {
        window.filtroSomenteAlertaDiligencia = false;
        const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
        if (btnFiltroAlerta) btnFiltroAlerta.classList.remove('active');
        if (window.currentProcessesTab === 'aprovados' && typeof updateReuniao === 'function') {
            // Nunca remontar a tabela no meio de um render: agenda para o próximo tique.
            if (_renderReuniaoEmAndamento) setTimeout(() => updateReuniao(), 0);
            else updateReuniao();
        }
    }

    // `qtd` já está calculado — evita a terceira varredura de window.allData por chamada.
    atualizarVisibilidadeBtnFiltroAlerta(qtd);
}

// O botão só aparece na aba Aprovados e apenas quando existe ao menos 1 processo com alerta
function atualizarVisibilidadeBtnFiltroAlerta(qtdConhecida) {
    const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
    if (!btnFiltroAlerta) return;
    const qtd = (typeof qtdConhecida === 'number')
        ? qtdConhecida
        : (window.allData || []).filter(d => d.alerta_pre_diligencia).length;
    const deveMostrar = window.currentProcessesTab === 'aprovados' && qtd > 0;
    btnFiltroAlerta.style.display = deveMostrar ? 'flex' : 'none';
}

function montarHistoricoAlertaRetornoHTML(lista) {
    if (!lista || lista.length === 0) {
        return '<em class="text-muted">Nenhum comentário registrado ainda.</em>';
    }
    return lista.map(reg => {
        const dt = new Date(reg.created_at).toLocaleString('pt-BR');
        return `
            <div class="mb-2 pb-2 border-bottom border-light">
                <div class="d-flex justify-content-between">
                    <span class="fw-bold text-dark">${escapeHTML(reg.sigla)}</span>
                    <span class="text-muted" style="font-size: 0.7rem;">${dt}</span>
                </div>
                <div>${escapeHTML(reg.comentario)}</div>
                <div class="text-muted" style="font-size: 0.7rem;">${escapeHTML(reg.autor_nome || '')}</div>
            </div>
        `;
    }).join('');
}

async function abrirModalAlertaRetorno(processoStr) {
    const d = (window.allData || []).find(x => x.processo === processoStr);
    if (!d) { alert('Erro: processo não localizado.'); return; }

    document.getElementById('alerta_processo_id').value = d.id || '';
    document.getElementById('alerta_processo_nup').value = d.processo || '';
    document.getElementById('alerta_processo_label').textContent = d.processo || '';
    document.getElementById('alerta_sigla_atual').textContent = d.suite_sigla_risco || 'setor de risco';
    document.getElementById('alerta_novo_comentario').value = '';

    const podeEscrever = typeof canSeeProcessActions === 'function' && canSeeProcessActions();
    document.getElementById('alerta_form_novo_comentario').style.display = podeEscrever ? '' : 'none';
    document.getElementById('btn-salvar-alerta-retorno').style.display = podeEscrever ? '' : 'none';

    const elHistorico = document.getElementById('alerta_historico');
    elHistorico.innerHTML = '<em class="text-muted">Carregando histórico...</em>';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAlertaRetorno')).show();

    try {
        const { data, error } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('*')
            .eq('processo_id', String(d.id))
            .order('created_at', { ascending: false });
        if (error) throw error;
        elHistorico.innerHTML = montarHistoricoAlertaRetornoHTML(data);
    } catch (err) {
        console.error('Erro ao carregar histórico do alerta de retorno:', err);
        elHistorico.innerHTML = '<em class="text-danger">Erro ao carregar histórico.</em>';
    }
}

async function salvarAlertaRetornoComentario() {
    const processoNup = document.getElementById('alerta_processo_nup').value;
    const processoId = document.getElementById('alerta_processo_id').value;
    const textarea = document.getElementById('alerta_novo_comentario');
    const comentario = textarea.value.trim();

    if (!comentario) {
        alert('Escreva um comentário antes de salvar.');
        textarea.focus();
        return;
    }

    const d = (window.allData || []).find(x => x.processo === processoNup);
    if (!d) { alert('Erro: processo não localizado.'); return; }

    const payload = {
        processo_id: String(processoId),
        processo_nup: processoNup,
        sigla: d.suite_sigla_risco || 'DESCONHECIDA',
        comentario: comentario,
        autor_nome: sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido',
        autor_email: getCurrentUserEmail()
    };

    const btn = document.getElementById('btn-salvar-alerta-retorno');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'SALVANDO...';
    }

    // Sem o try/catch, uma falha de rede deixava o botão preso em "SALVANDO..." e
    // desabilitado para sempre, sem nenhuma mensagem. — 22/09/2026
    let data = null, error = null;
    try {
        const res = await sbClient.from('alerta_retorno_comentarios').insert([payload]).select().single();
        data = res.data;
        error = res.error;
    } catch (e) {
        error = { message: (e && e.message) ? e.message : String(e) };
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Registrar Comentário';
    }

    if (error) {
        alert('Erro ao salvar comentário: ' + error.message);
        return;
    }

    d.alertaRetornoUltimo = data;
    textarea.value = '';

    // O navegador guarda o atributo já DECODIFICADO, então re-escapar antes de procurar
    // fazia a busca falhar em silêncio para qualquer NUP com & < > " ' — e ainda abria
    // espaço para injeção no seletor. `CSS.escape` é o jeito correto. — 22/09/2026
    const tr = document.querySelector(`tr[data-numero="${CSS.escape(String(processoNup || ''))}"]`);
    const alertaIcone = tr ? tr.querySelector('.alerta-icone') : null;
    aplicarAlertaPreDiligencia(d, tr, alertaIcone, d.suite_sigla_risco, d.status);

    const elHistorico = document.getElementById('alerta_historico');
    try {
        const { data: historico, error: errHist } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('*')
            .eq('processo_id', String(processoId))
            .order('created_at', { ascending: false });
        if (errHist) throw errHist;
        elHistorico.innerHTML = montarHistoricoAlertaRetornoHTML(historico);
    } catch (err) {
        console.error('Erro ao recarregar histórico do alerta de retorno:', err);
    }

    alert('Comentário registrado com sucesso!');
}

// Varredura em segundo plano: verifica TODOS os processos APROVADO no SUITE, mesmo que a
// aba "Aprovados" não esteja aberta na tela, para que o alerta apareça antes de o usuário
// precisar navegar até lá. Lê a sigla direto de window.allData (sem chamadas de rede).
let varreduraDiligenciaEmAndamento = false;
async function varrerRiscoDiligenciaSegundoPlano() {
    if (varreduraDiligenciaEmAndamento) return;
    varreduraDiligenciaEmAndamento = true;
    try {
        const candidatos = (window.allData || []).filter(d => (d.status || '').toString().toUpperCase().trim() === 'APROVADO');
        if (!candidatos.length) return;

        const trPorNumero = new Map();
        document.querySelectorAll('tr[data-numero]').forEach(tr => {
            trPorNumero.set(tr.getAttribute('data-numero'), tr);
        });

        // Lê a sigla já vinda da tabela `processos` (mantida pelo job central sincronizar-suite).
        // Zero chamadas à Edge Function.
        candidatos.forEach(d => {
            const sigla = d.suite ? String(d.suite).toUpperCase().trim() : null;
            if (!sigla) return;
            const tr = trPorNumero.get(d.processo);
            const alertaIcone = tr ? tr.querySelector('.alerta-icone') : null;
            // adiarBadge = true: o contador é atualizado uma vez só, ao fim da varredura.
            aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, d.status, true);
        });
        atualizarBadgeAbaAprovados();
    } catch (e) {
        console.error('[Alerta Pré-Diligência] erro na varredura:', e);
    } finally {
        varreduraDiligenciaEmAndamento = false;
    }
}

function iniciarVarreduraRiscoDiligencia() {
    varrerRiscoDiligenciaSegundoPlano();
    // Polling removido: a sigla do SUITE vem da tabela `processos`, atualizada pelo
    // job central sincronizar-suite. Sem chamadas à Edge Function no cliente.
}

// NOTE: Supabase client initialization moved to database.js (loaded before main.js)

window.dynamicUsers = [];
// Lista canônica de fiscais: [{ matricula, nome }] — nome já em CAIXA ALTA, sem espaços nas pontas.
// Fonte única: app_users, todo mundo (usuário, 2026-09-17 — gerente/admin também fiscalizam
// processos). O <option>.value do dropdown de Fiscal passa a ser a
// matrícula (gravada em processos.fiscal_matricula, FK -> app_users.matricula); processos.fiscal
// (texto) continua sendo gravado a partir do rótulo, para as telas que ainda leem o nome.
window.fiscais = [];
let _fiscaisPromise = null;

async function carregarListaFiscais() {
    try {
        // Sem filtro de role (usuário, 2026-09-17): gerente/admin também aparecem como fiscal
        // em processos reais (ex.: matrícula 70024810, role 'gerente', fiscal de 7 processos) e
        // ficavam de fora do dropdown, obrigando alteração só por SQL direto.
        const { data, error } = await sbClient
            .from('app_users')
            .select('matricula, nome, sobrenome, full_name');
        if (error) throw error;

        window.fiscais = (data || [])
            .map(u => ({
                matricula: (u.matricula || '').trim(),
                nome: (u.full_name || `${u.nome || ''} ${u.sobrenome || ''}`).trim().toUpperCase()
            }))
            .filter(f => f.matricula && f.nome)
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        // Compat: admin.js e findFiscalNameInList ainda consomem window.dynamicUsers (só nomes).
        window.dynamicUsers = window.fiscais.map(f => f.nome);
        atualizarDropdownsFiscais();
    } catch (e) {
        console.error('Erro carregarListaFiscais:', e);
    }
}

// Garante que window.fiscais esteja carregado antes de usar o dropdown de Fiscal — evita a
// corrida em que o modal (abrirDetalhes / cadastro) abre antes de carregarListaFiscais()
// terminar e todo fiscal cai no fallback "fora do cadastro". Reaproveita a chamada em voo.
async function garantirFiscaisCarregados() {
    if (window.fiscais && window.fiscais.length) return;
    if (!_fiscaisPromise) _fiscaisPromise = carregarListaFiscais().finally(() => { _fiscaisPromise = null; });
    await _fiscaisPromise;
}

// Resolve um fiscal por matrícula (exato) ou por nome (normalizado) contra window.fiscais.
function fiscalPorMatricula(mat) {
    if (!mat) return null;
    const alvo = normalizarMatriculaFiscal(mat);
    return window.fiscais.find(f => normalizarMatriculaFiscal(f.matricula) === alvo) || null;
}
function fiscalPorNome(nome) {
    if (!nome) return null;
    const alvo = normalizarNomeFiscal(nome);
    if (!alvo) return null;
    return window.fiscais.find(f => normalizarNomeFiscal(f.nome) === alvo)
        || window.fiscais.find(f => {
            const fn = normalizarNomeFiscal(f.nome);
            return fn.startsWith(alvo + ' ') || alvo.startsWith(fn + ' ');
        })
        || null;
}

function adicionarFiscalDaComissao({ matricula = null, nome = null } = {}) {
    const matriculaTexto = String(matricula || '').trim();
    const nomeTexto = String(nome || '').trim().toUpperCase();
    if (!matriculaTexto || !nomeTexto || fiscalPorMatricula(matriculaTexto)) return;
    window.fiscais.push({ matricula: matriculaTexto, nome: nomeTexto });
    window.fiscais.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    window.dynamicUsers = window.fiscais.map(f => f.nome);
    atualizarDropdownsFiscais();
}

// Popula um <select> de Fiscal com as opções (value=matrícula, texto=nome), mantendo a 1ª
// opção ("Selecione...") se existir.
function preencherSelectFiscais(selectEl) {
    if (!selectEl) return;
    const firstOpt = selectEl.options[0] && !selectEl.options[0].value ? selectEl.options[0] : null;
    selectEl.innerHTML = '';
    if (firstOpt) selectEl.appendChild(firstOpt);
    window.fiscais.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.matricula;
        opt.textContent = f.nome;
        selectEl.appendChild(opt);
    });
}

// Seleciona no <select> o fiscal por { matricula } (preferencial) ou por { nome } (resolvido
// contra a lista). Se não resolver, insere uma opção-sentinela p/ não zerar o campo:
//  - lista carregada e nome não bate  -> "⚠ <nome> (fora do cadastro)" (desabilitada)
//  - lista ainda vazia (corrida/erro) -> "<nome>" simples (habilitada), sem alarme
// Idealmente chamado depois de `await garantirFiscaisCarregados()`.
function selecionarFiscal(selectEl, { matricula = null, nome = null } = {}) {
    if (!selectEl) return;
    if (!selectEl.options.length || (selectEl.options.length === 1 && !selectEl.options[0].value)) {
        preencherSelectFiscais(selectEl);
    }
    let alvo = matricula ? fiscalPorMatricula(matricula) : null;
    if (!alvo && nome) alvo = fiscalPorNome(nome);
    if (alvo) { selectEl.value = alvo.matricula; return; }

    if (nome) {
        const listaVazia = !window.fiscais || !window.fiscais.length;
        if (listaVazia) console.warn('[Fiscal] lista de fiscais vazia ao selecionar', nome);
        const SENT = '__fiscal_fora_cadastro__';
        let opt = Array.from(selectEl.options).find(o => o.value === SENT);
        if (!opt) { opt = document.createElement('option'); opt.value = SENT; selectEl.appendChild(opt); }
        opt.textContent = listaVazia ? nome : `⚠ ${nome} (fora do cadastro)`;
        opt.disabled = !listaVazia;
        selectEl.value = SENT;
    } else {
        selectEl.selectedIndex = 0;
    }
}

// Lê o par { matricula, nome } selecionado num <select> de Fiscal. matricula = null quando
// nada válido está selecionado (inclui a opção-sentinela de fiscal fora do cadastro).
function lerFiscalSelecionado(selectEl) {
    if (!selectEl) return { matricula: null, nome: null };
    const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
    const val = selectEl.value;
    const valido = val && val !== '__fiscal_fora_cadastro__';
    return {
        matricula: valido ? val : null,
        nome: opt ? opt.textContent.replace(/^⚠\s*/, '').replace(/\s*\(fora do cadastro\)$/, '').trim() : null
    };
}

function normalizarNomeFiscal(nome) {
    return (nome || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function normalizarMatriculaFiscal(matricula) {
    return String(matricula || '').trim().toUpperCase().replace(/[.\-\/\s]+/g, '');
}

// REMOVIDAS na revisão de 22/09/2026, ambas sem nenhum chamador no repositório:
//   - `mesclarDuplicatasPorAcento`: fundia "AGABE SOUSA" (app_users, sem acento) com
//     "ÁGABE SOUSA" (comissao_fiscalizacao, com acento) numa entrada só do dropdown.
//   - `colapsarVariantesFiscais`: colapsava "DIEGO DEMÉTRIO" e "DIEGO DEMÉTRIO TORRES".
// O dropdown de fiscais é montado por matrícula (`fiscalPorMatricula`), não por nome, então
// a deduplicação por grafia deixou de ser necessária quando essa mudança aconteceu.

// --- INTEGRAÇÃO COM CONTRATOS SOP (SIGSOP) — busca de obra por código para autopreencher o cadastro ---

// Classifica o "tipo" de um integrante da comissão de fiscalização, usando a
// hierarquia para decidir quem aparece como fiscal responsável:
// Fiscal > 1º Membro > Presidente > 2º/3º Membro > Suplente.
function classifyComissaoProcesso(tipoRaw) {
    const norm = (tipoRaw || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (norm.includes('FISCAL')) return { label: 'FISCAL', rank: 7 };
    // Precisa vir antes dos testes de dígito: "1º Suplente" contém "1", então SUPLENTE
    // tem que ser checado primeiro — senão seria classificado como titular "1º Membro".
    if (norm.includes('SUPLENTE')) return { label: 'SUPLENTE', rank: 1 };
    if (norm.includes('1') || norm.includes('PRIMEIRO')) return { label: '1º MEMBRO', rank: 6 };
    if (norm.includes('PRESIDENTE')) return { label: 'PRESIDENTE', rank: 5 };
    if (norm.includes('2') || norm.includes('SEGUNDO')) return { label: '2º MEMBRO', rank: 4 };
    if (norm.includes('3') || norm.includes('TERCEIRO')) return { label: '3º MEMBRO', rank: 3 };
    if (norm.includes('MEMBRO')) return { label: 'MEMBRO', rank: 0 };
    return { label: tipoRaw ? String(tipoRaw).toUpperCase() : 'MEMBRO', rank: -1 };
}

function selecionarComissaoVigente(comissao) {
    if (!Array.isArray(comissao) || !comissao.length) return [];
    const datas = comissao
        .map(m => String(m.atualizado_em || '').slice(0, 10))
        .filter(Boolean)
        .sort();
    if (!datas.length) return comissao;
    const dataVigente = datas[datas.length - 1];
    return comissao.filter(m => String(m.atualizado_em || '').slice(0, 10) === dataVigente);
}

// Busca uma obra em contratos_edificacao pelo Código da Obra e sua comissão de
// fiscalização em comissao_fiscalizacao, para pré-preencher o cadastro/vínculo de
// processos. Nunca lança: quem chama trata { encontrado:false } como "não achou, segue
// manual" — código não encontrado nunca deve bloquear o cadastro do processo.
async function buscarObraPorCodigo(codigo) {
    const cod = (codigo || '').trim();
    if (!cod) return { encontrado: false };
    try {
        const { data: obra, error } = await sbClient
            .from('contratos_edificacao')
            .select('id_obra, codigo_obra, descricao_obra, contratada, contratante, distrito_operacional, municipio')
            .eq('codigo_obra', cod)
            .maybeSingle();

        if (error || !obra) return { encontrado: false };

        let comissaoCompleta = [];
        if (obra.id_obra != null) {
            const { data: comissao, error: errCom } = await sbClient
                .from('comissao_fiscalizacao')
                .select('nome_completo, nome_referencia, tipo, matricula, atualizado_em')
                .eq('id_obra', obra.id_obra);
            if (!errCom && comissao) {
                comissaoCompleta = selecionarComissaoVigente(comissao)
                    .map(m => ({
                        nome: (m.nome_completo || m.nome_referencia || '').trim(),
                        matricula: (m.matricula || '').trim() || null,
                        ...classifyComissaoProcesso(m.tipo)
                    }))
                    .filter(m => m.nome)
                    .sort((a, b) => b.rank - a.rank);
            }
        }

        return {
            encontrado: true,
            descricao_obra: obra.descricao_obra || '',
            contratante: obra.contratante || '',
            contratada: obra.contratada || '',
            distrito_operacional: obra.distrito_operacional || '',
            municipio: obra.municipio || '',
            fiscalSugerido: comissaoCompleta[0] ? comissaoCompleta[0].nome : '',
            fiscalSugeridoMatricula: comissaoCompleta[0] ? comissaoCompleta[0].matricula : null,
            comissaoCompleta
        };
    } catch (e) {
        console.error('[ERRO] buscarObraPorCodigo:', e);
        return { encontrado: false };
    }
}

async function sincronizarFiscaisDosProcessos() {
    const codigos = [...new Set(window.allData.map(row => row.codigoObra).filter(Boolean))];
    if (!codigos.length) return;
    const { data: obras, error: errObras } = await sbClient
        .from('contratos_edificacao')
        .select('id_obra, codigo_obra')
        .in('codigo_obra', codigos);
    if (errObras || !obras || !obras.length) return;

    const idsObra = obras.map(obra => obra.id_obra).filter(id => id != null);
    const { data: comissao, error: errComissao } = await sbClient
        .from('comissao_fiscalizacao')
        .select('id_obra, nome_completo, nome_referencia, tipo, matricula, atualizado_em')
        .in('id_obra', idsObra);
    if (errComissao || !comissao) return;

    const porObra = new Map();
    obras.forEach(obra => porObra.set(obra.codigo_obra, []));
    const codigoPorObra = new Map(obras.map(obra => [obra.id_obra, obra.codigo_obra]));
    const grupos = new Map();
    comissao.forEach(membro => {
        const grupo = grupos.get(membro.id_obra) || [];
        grupo.push(membro);
        grupos.set(membro.id_obra, grupo);
    });
    grupos.forEach((membros, idObra) => {
        const vigentes = selecionarComissaoVigente(membros);
        const fiscal = vigentes
            .map(membro => ({ ...membro, ...classifyComissaoProcesso(membro.tipo) }))
            .sort((a, b) => b.rank - a.rank)[0];
        if (fiscal) porObra.set(codigoPorObra.get(idObra), fiscal);
    });
    window.allData.forEach(row => {
        const fiscal = porObra.get(row.codigoObra);
        if (!fiscal) return;
        row.fiscal = (fiscal.nome_completo || fiscal.nome_referencia || '').trim();
        row.fiscalMatricula = (fiscal.matricula || '').trim() || null;
    });
}

// (Removido garantirOpcaoFiscal — o dropdown de Fiscal agora é chaveado por matrícula;
//  usar selecionarFiscal({ matricula } | { nome }).)

// Monta os botões da comissão completa (mostrados quando há mais de 1 integrante), para
// o usuário poder trocar o Fiscal sugerido (1º da hierarquia) por outro nome da comissão.
// O primeiro (rank mais alto) já nasce marcado como selecionado, pois é quem
// garantirOpcaoFiscal já deixou selecionado no campo Fiscal Responsável.
function montarListaComissaoHTML(comissaoCompleta, onClickFnName) {
    return comissaoCompleta.map((m, idx) =>
        `<button type="button" class="btn btn-sm ${idx === 0 ? 'btn-outline-primary' : 'btn-outline-secondary'}" onclick="${onClickFnName}(this, '${escapeHTML(m.nome).replace(/'/g, "\\'")}', '${escapeHTML(m.matricula || '').replace(/'/g, "\\'")}')">${escapeHTML(m.label)}: ${escapeHTML(m.nome)}</button>`
    ).join('');
}

// --- Cadastro (NOVO PROCESSO): busca por Código da Obra ---
async function buscarObraCadastro() {
    await garantirFiscaisCarregados();
    const codigo = document.getElementById('cad_codigo_obra').value;
    const statusEl = document.getElementById('cad_obra_status');
    const wrapComissao = document.getElementById('cad_comissao_wrap');
    const listaComissao = document.getElementById('cad_comissao_lista');
    const btn = document.getElementById('btn-buscar-obra');

    if (!codigo || !codigo.trim()) {
        statusEl.className = 'form-text text-muted';
        statusEl.textContent = 'Informe o Código da Obra para buscar.';
        return;
    }

    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    const resultado = await buscarObraPorCodigo(codigo);

    btn.disabled = false;
    btn.innerHTML = textoOriginal;

    if (!resultado.encontrado) {
        statusEl.className = 'form-text text-warning';
        statusEl.textContent = 'Código não encontrado na base de contratos — preencha os campos manualmente.';
        wrapComissao.style.display = 'none';
        return;
    }

    document.getElementById('cad_descricao').value = resultado.descricao_obra;
    document.getElementById('cad_contratante').value = resultado.contratante;
    document.getElementById('cad_contratada').value = resultado.contratada;
    document.getElementById('cad_distrito').value = resultado.distrito_operacional;
    document.getElementById('cad_municipio').value = resultado.municipio;
    adicionarFiscalDaComissao({
        matricula: resultado.fiscalSugeridoMatricula,
        nome: resultado.fiscalSugerido
    });
    selecionarFiscal(document.getElementById('cad-fiscal'), {
        matricula: resultado.fiscalSugeridoMatricula,
        nome: resultado.fiscalSugerido
    });

    const descCurta = (resultado.descricao_obra || '').slice(0, 80);
    statusEl.className = 'form-text text-success';
    statusEl.textContent = `Obra encontrada: ${descCurta}${(resultado.descricao_obra || '').length > 80 ? '…' : ''}`;

    if (resultado.comissaoCompleta.length > 1) {
        listaComissao.innerHTML = montarListaComissaoHTML(resultado.comissaoCompleta, 'selecionarFiscalCadastro');
        wrapComissao.style.display = '';
    } else {
        wrapComissao.style.display = 'none';
    }
}

function selecionarFiscalCadastro(btnEl, nome, matricula) {
    adicionarFiscalDaComissao({ matricula, nome });
    selecionarFiscal(document.getElementById('cad-fiscal'), { matricula, nome });
    // Marcação sutil de qual integrante está selecionado: o botão clicado troca para o
    // mesmo estilo outline-primary usado no resto do app, os demais voltam a secondary.
    if (btnEl && btnEl.parentElement) {
        btnEl.parentElement.querySelectorAll('button').forEach(b => {
            b.classList.remove('btn-outline-primary');
            b.classList.add('btn-outline-secondary');
        });
        btnEl.classList.remove('btn-outline-secondary');
        btnEl.classList.add('btn-outline-primary');
    }
}

// --- Gerenciar Processo: vincular/atualizar obra de um processo já cadastrado (admin) ---
async function buscarObraDetalhes() {
    await garantirFiscaisCarregados();
    const codigo = document.getElementById('det_codigo_obra').value;
    const statusEl = document.getElementById('det_obra_status');

    if (!codigo || !codigo.trim()) {
        statusEl.className = 'form-text text-muted';
        statusEl.textContent = 'Informe o Código da Obra para vincular.';
        return;
    }

    const btn = document.getElementById('btn-vincular-obra');
    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    const resultado = await buscarObraPorCodigo(codigo);

    btn.disabled = false;
    btn.innerHTML = textoOriginal;

    if (!resultado.encontrado) {
        statusEl.className = 'form-text text-warning';
        statusEl.textContent = 'Código não encontrado na base de contratos.';
        return;
    }

    document.getElementById('det_descricao').value = resultado.descricao_obra;
    document.getElementById('det_contratante').value = resultado.contratante;
    document.getElementById('det_contratada').value = resultado.contratada;
    document.getElementById('det_distrito').value = resultado.distrito_operacional;
    document.getElementById('det_municipio').value = resultado.municipio;
    adicionarFiscalDaComissao({
        matricula: resultado.fiscalSugeridoMatricula,
        nome: resultado.fiscalSugerido
    });
    selecionarFiscal(document.getElementById('det_fiscal'), {
        matricula: resultado.fiscalSugeridoMatricula,
        nome: resultado.fiscalSugerido
    });

    statusEl.className = 'form-text text-success';
    statusEl.textContent = 'Obra encontrada — revise os campos e clique em "Salvar Alterações" para confirmar o vínculo.';
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
            const { error } = await sbClient.storage.from(storageBucket).remove(arquivosParaDeletar);
            if (error) {
                console.error('Erro ao deletar arquivos:', error);
            }
        } catch (err) {
            console.error('Erro ao limpar arquivos:', err);
        }
    }
}

// --- LISTENERS GLOBAIS REMOVIDOS (CONSOLIDADO NO DOMCONTENTLOADED) ---

function atualizarDropdownsFiscais() {
    // Popula os dropdowns estáticos de Fiscal (value=matrícula, texto=nome) a partir de window.fiscais.
    // Preserva a seleção atual quando ela ainda existe na lista.
    ['cad-fiscal', 'det_fiscal'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const valAtual = sel.value;
        preencherSelectFiscais(sel);
        if (valAtual && Array.from(sel.options).some(o => o.value === valAtual)) sel.value = valAtual;
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
    for (const fiscal of window.dynamicUsers) {
        if (normalizar(fiscal) === inputNormal) {
            return fiscal;
        }
    }

    // 2. Procura por partes: todos os nomes do input devem estar no fiscal
    const partes = inputNormal.split(/\s+/).filter(p => p.length > 0);
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        if (partes.every(parte => fiscalNormal.includes(parte))) {
            return fiscal;
        }
    }

    // 3. Procura reversa: todos os nomes do fiscal devem estar no input
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        const partesFiscal = fiscalNormal.split(/\s+/).filter(p => p.length > 0);
        if (partesFiscal.every(parte => inputNormal.includes(parte))) {
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
            return fiscal;
        }
    }

    return null;
}

window.allData = window.allData || [];
window.financeiroData = window.financeiroData || [];
let currentTabelaData = []; // Cache para recálculo de BDI/Desconto

// escapeHTML() é definida em utils.js (carregado antes deste arquivo) e exposta em
// window.escapeHTML — não redeclarar aqui para evitar duas cópias idênticas.

// `calcularDiasNoStatus` foi REMOVIDA na revisão de 22/09/2026.
// Era chamada uma vez por linha no laço que monta a tabela, para preencher a variável
// `labelDias` — que nunca era usada: a célula destinada a ela está vazia no HTML (a <div>
// de altura 1.1rem logo abaixo do badge de status). Cada chamada normalizava acentos e
// alocava três objetos Date, tudo descartado em seguida. Nenhum outro arquivo a chamava.
// Se o "dias no status" voltar a ser exibido, a regra (com a heurística de transição para
// dados anteriores a 30/04/2026) está no histórico do git.

// `debounce()` é definida em utils.js e exposta em window.debounce — a cópia idêntica que
// existia aqui foi removida na revisão de 22/09/2026. Como processos.js é o ÚLTIMO script
// carregado (ver index.html), a cópia daqui sobrescrevia a de utils.js para o aplicativo
// inteiro (shell.js, composicoes.js e orcamentos.js chamam `debounce`) — duas definições da
// mesma coisa, com a de menor visibilidade vencendo. Mesmo motivo já documentado logo acima
// para escapeHTML().

// --- 3. CORE: CARREGAMENTO DE DADOS (READ) ---

function mapProcessoRow(r) {
    const dataAbertura = isoParaDate(r.data_abertura);
    const dataAprov = isoParaDate(r.data_aprovacao_gecope);
    let prazoDias = null;
    if (dataAbertura && dataAprov) {
        prazoDias = Math.round((dataAprov - dataAbertura) / (1000 * 60 * 60 * 24));
    }

    let nomeAnalista = r.analista;
    if (r.analista === "N") nomeAnalista = "Nildeno";
    else if (r.analista === "W") nomeAnalista = "Walace";
    else if (r.analista === "H") nomeAnalista = "Helder";
    else if (r.analista === "P") nomeAnalista = "Pedro";
    else if (r.analista === "F") nomeAnalista = "Felipe";
    else if (r.analista === "A") nomeAnalista = "Ada";

    return {
        id: r.id,
        processo: r.processo,
        status: r.status || "Não informado",
        tipo: r.tipo || "Não informado",
        descricao: r.descricao || "",
        fiscal: r.fiscal || "Não informado",
        fiscalMatricula: r.fiscal_matricula || null,
        contratada: r.contratada || "Não informado",
        contratante: r.contratante || "Não informado",
        codigoObra: r.codigo_obra || null,
        distritoOperacional: r.distrito_operacional || null,
        municipio: r.municipio || null,
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
        analiseAprofundada: r.analise_aprofundada !== undefined ? !!r.analise_aprofundada : true,
        prioritario: r.prioritario || false,
        avisoAtrasoEnviado: r.aviso_atraso_enviado || false,
        suite: r.suite || null,
        suite_data_chegada: r.suite_data_chegada || null,
        criador: r.criador,
        created_at: isoParaDate(r.created_at),
        atualizado_por: r.atualizado_por,
        ultima_atualizacao: isoParaDate(r.ultima_atualizacao),
        excluido_por: r.excluido_por,
        data_exclusao: r.data_exclusao
    };
}

// Mesma sequência de atualização de tela que o final de carregarDadosSupabase() roda,
// sem refazer nenhuma consulta de rede que uma edição/exclusão pontual não precisa
// (processos inteiro, contratos_edificacao, comissao_fiscalizacao, alerta_retorno_
// comentarios em lote). carregarDadosFinanceiro() já é só cálculo em memória sobre
// window.allData (ver financeiro.js) — chamar de novo aqui é barato.
async function atualizarPainelAposEdicaoLocal() {
    await carregarDadosFinanceiro();
    populateAllTabFilters();
    renderLastUpdate();
    updateDashboard();
    updateFinanceiro();
    if (typeof carregarAtividadesResumoHome === 'function') carregarAtividadesResumoHome();
    iniciarVarreduraRiscoDiligencia();
}

// Busca só a LINHA recém-gravada (não a tabela inteira) e mescla no objeto que já existe
// em window.allData — Object.assign, não substituição, para preservar campos que outras
// rotinas anexam ao objeto por fora do mapProcessoRow (ex.: alertaRetornoUltimo,
// alerta_pre_diligencia, suite_sigla_risco — recalculados de qualquer forma por
// iniciarVarreduraRiscoDiligencia() dentro de atualizarPainelAposEdicaoLocal(), mas só
// para ESTA linha se ela sobreviver aqui). Usa o mesmo mapProcessoRow que o carregamento
// completo usa, para garantir a mesma forma e os mesmos tipos (Date/Number) dos campos.
// Se a busca falhar, cai para o full reload em vez de arriscar deixar a tela com dado
// velho. Egress, 18/09/2026 — docs/auditoria-egress-2026-09.md, item 5.
async function atualizarLinhaProcessoLocal(id) {
    // Revisão 22/09/2026 — `atualizarPainelAposEdicaoLocal()` estava DENTRO deste try, então
    // qualquer erro de renderização (updateDashboard, updateFinanceiro, populateAllTabFilters)
    // caía no catch e disparava uma varredura completa da tabela — exatamente o egress que
    // esta função existe para evitar. Agora o catch cobre só a busca da linha; falha de
    // renderização é reportada, não vira recarga.
    try {
        const { data, error } = await sbClient.from('processos').select('*').eq('id', id).single();
        if (error || !data) throw error || new Error('Linha não encontrada após salvar.');

        const fresh = mapProcessoRow(data);
        window.allData = window.allData || [];
        const idx = window.allData.findIndex(d => d.id === id);
        if (idx === -1) {
            window.allData.unshift(fresh);
            // `unshift` MUTA o vetor sem trocar a referência, e o índice de
            // linhaGlobalPorProcesso() invalida por identidade — sem esta linha, o processo
            // recém-criado fica fora do índice até a próxima carga completa. — 22/09/2026
            invalidarIndiceAllData();
        } else {
            Object.assign(window.allData[idx], fresh);
        }
    } catch (e) {
        console.error('[ERRO] Falha ao buscar a linha do processo, recarregando tudo:', e);
        await carregarDadosSupabase();
        return;
    }

    await atualizarPainelAposEdicaoLocal();
}

// Exclusão de processo é lógica (status='EXCLUÍDO'): carregarDadosSupabase() já filtra
// esse status ao montar window.allData, então remover a linha localmente reproduz
// exatamente o efeito de uma recarga completa.
async function removerProcessoLocal(id) {
    window.allData = (window.allData || []).filter(d => d.id !== id);
    await atualizarPainelAposEdicaoLocal();
}

// Guarda de chamada concorrente. `carregarDadosSupabase` é disparada de três lugares
// independentes (core/auth.js após o login, core/shell.js no DOMContentLoaded, e o fallback
// de erro de `atualizarLinhaProcessoLocal`), que podiam sobrepor-se: duas varreduras
// completas da tabela ao mesmo tempo, as duas atribuindo `window.allData`, e as alterações
// locais feitas entre uma e outra perdidas. Mesmo padrão que `garantirFiscaisCarregados` já
// usava neste arquivo. — 22/09/2026
let _carregarDadosPromise = null;

async function carregarDadosSupabase() {
    if (_carregarDadosPromise) return _carregarDadosPromise;
    _carregarDadosPromise = _carregarDadosSupabaseInterno()
        .finally(() => { _carregarDadosPromise = null; });
    return _carregarDadosPromise;
}

async function _carregarDadosSupabaseInterno() {
    const loader = document.getElementById("load-error");
    if (loader) loader.style.display = "none";

    let data = null;
    try {
        // Paginação explícita. Antes era um `select('*')` único, sem `.limit()` nem `.range()`:
        // o PostgREST corta a resposta no `max-rows` do servidor (tipicamente 1000 linhas) SEM
        // erro nenhum, então o aplicativo simplesmente pararia de enxergar os processos mais
        // antigos e ninguém ficaria sabendo. O laço busca em blocos até a tabela acabar.
        //
        // O descarte de EXCLUÍDO segue no navegador de propósito: no servidor,
        // `not.in.(EXCLUÍDO,EXCLUIDO)` também descartaria as linhas com status NULO, porque em
        // SQL `NOT (NULL IN (...))` não é verdadeiro — esconderia processos sem status
        // preenchido. Ver a pendência registrada em docs/revisoes/2026-09-22-processos.md.
        // O desempate por `id` NÃO é decorativo: `created_at` não é único, e cada bloco é uma
        // consulta nova. Em Postgres `now()` é por transação, então carga em lote grava dezenas
        // de linhas com o mesmo instante; se um grupo empatado cruzar a fronteira do bloco, a
        // ordem entre as duas consultas é indefinida e a mesma linha pode vir duas vezes
        // enquanto outra não vem nenhuma — em silêncio, que é a falha que esta paginação veio
        // justamente matar.
        //
        // O passo do laço é `bloco.length`, e não `TAMANHO_BLOCO`: se o `max-rows` do servidor
        // for MENOR que 1000, o primeiro bloco volta curto e um laço que comparasse com 1000
        // pararia ali, ressuscitando a truncagem silenciosa. Assim funciona com qualquer
        // `max-rows`, inclusive um que mude no servidor sem ninguém avisar. — 22/09/2026
        const TAMANHO_BLOCO = 1000;
        // Teto de segurança: o laço só sai sozinho com bloco vazio. Se o `Range` deixar de ser
        // honrado em algum ponto do caminho (proxy, CDN, mudança de configuração do PostgREST),
        // toda volta devolveria o MESMO conjunto não vazio e a aba travaria acumulando memória.
        // 200 blocos = 200 mil processos, muito acima de qualquer cenário real desta tabela.
        const MAX_BLOCOS = 200;
        const acumulado = [];
        for (let inicio = 0, volta = 0; ; volta++) {
            if (volta >= MAX_BLOCOS) {
                throw new Error('Carga de processos interrompida: limite de blocos atingido. '
                    + 'A paginação não está avançando — avise o administrador do sistema.');
            }
            const { data: bloco, error } = await sbClient
                .from('processos')
                .select('*')
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(inicio, inicio + TAMANHO_BLOCO - 1);

            if (error) throw new Error(`Tabela "processos" não acessível: ${error.message}`);
            if (!Array.isArray(bloco)) throw new Error('Tipo de dados inválido: esperado array');

            acumulado.push(...bloco);
            if (bloco.length === 0) break;
            inicio += bloco.length;
        }

        data = acumulado.filter(d => d.status !== 'EXCLUÍDO' && d.status !== 'EXCLUIDO');
    } catch (err) {
        console.error('[ERRO] Falha ao carregar dados:', err);
        if (loader) {
            loader.style.display = "block";
            // `err.message` pode ecoar valores enviados pelo próprio usuário (o PostgREST faz
            // isso em erro de sintaxe), então vai escapado. — 22/09/2026
            loader.innerHTML = `<strong>Erro ao carregar dados:</strong><br><code>${escapeHTML(err.message)}</code>`;
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
        const obj = mapProcessoRow(r);

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

    try {
        await sincronizarFiscaisDosProcessos();
    } catch (e) {
        console.warn('[Fiscal] Não foi possível sincronizar comissões vigentes:', e);
    }

    // window.allData já foi atualizado acima; não é necessário reatribuir
    /* window.allData já foi atualizado acima */

    // Carrega o último comentário de justificativa do alerta de retorno de cada processo,
    // ANTES de qualquer polling do SUITE, para que aplicarAlertaPreDiligencia já saiba
    // se a situação atual já foi comentada ou não.
    await carregarAlertasRetornoComentarios();

    try {
        // Auto-estabelecer metas para processos em 'ANÁLISE FISCAL' sem meta
        try {
            let pendingMeta = [];
            for (const row of window.allData) {
                const st = (row.status || "").toString().toUpperCase();
                const isAnaliseFiscal = st.includes("ANÁLISE FISCAL") || (st.includes("ANALISE") && st.includes("FISCAL"));
                const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                // Revisão 22/09/2026 — este trecho calculava `base`, `dias` e
                // `calcularDataMeta(base, dias)` só para decidir se precisava recalcular, e em
                // seguida recalculava os TRÊS de novo, com código idêntico copiado.
                // `calcularDataMeta` percorre dias úteis consultando a tabela de feriados, ou
                // seja, era o dobro do trabalho para cada processo em ANÁLISE FISCAL.
                // Agora calcula uma vez só.
                if (!isAnaliseFiscal || !row.id) continue;

                // Reanálise: conta a partir da devolução para correção, 10 dias.
                // Cadastro comum: conta a partir da entrada no GECOPE, 20 dias.
                const dias = isReanalise ? 10 : 20;
                const base = isReanalise
                    ? (row.dataDevolucaoCorrecoes || row.created_at || new Date())
                    : (row.created_at || new Date());

                // O descarte de quem já tem meta vem ANTES do cálculo de propósito:
                // `calcularDataMeta` percorre dias úteis consultando a tabela de feriados, e
                // rodava para todo processo em ANÁLISE FISCAL só para ter o resultado jogado
                // fora na linha seguinte. — 22/09/2026
                const jaTemMeta = !!row.dataCompromissoFiscal;
                if (jaTemMeta) continue;

                const metaDate = calcularDataMeta(base, dias);
                if (!metaDate) continue;

                const iso = metaDate.toISOString().substring(0, 10);
                // Atualiza objeto em memória para UI imediata
                row.dataCompromissoFiscal = isoParaDate(iso);
                const baseDate = base instanceof Date ? base : new Date(base);
                if (isNaN(baseDate.getTime())) continue;
                const est = baseDate.toISOString().substring(0, 10);
                pendingMeta.push({ id: row.id, data_compromisso_fiscal: iso, registros: est });
            }
            // Achado do rev-correcao (Fase 4): meta é só-Admin no banco agora (RLS) —
            // pra qualquer outro papel, o UPDATE abaixo seria recusado silenciosamente
            // (a Promise resolve com {error}, não lança), e o código continuaria dizendo
            // "metas automáticas salvas" e gravando isso no histórico como se tivesse
            // funcionado. Em vez de tentar e mascarar a falha, só tenta persistir quando
            // for Admin — pros demais papéis, o cálculo em memória acima já mostra a meta
            // sugerida na tela (só não fica salva até um Admin abrir o painel).
            if (pendingMeta.length > 0 && getCurrentUserRole() === 'admin') {
                // Persistir no banco (em paralelo).
                // O supabase-js resolve com `{ error }` em vez de rejeitar, então um
                // `Promise.all` cru dava "salvas com sucesso" mesmo com todas as gravações
                // recusadas — e o histórico logo abaixo era escrito como se tivesse dado certo.
                // Agora as falhas são contadas e o histórico só registra o que realmente foi
                // gravado. — 22/09/2026
                const resultados = await Promise.all(pendingMeta.map(async u => {
                    try {
                        const { error } = await sbClient.from('processos')
                            .update({ data_compromisso_fiscal: u.data_compromisso_fiscal })
                            .eq('id', u.id);
                        return { u, ok: !error, erro: error ? error.message : null };
                    } catch (e) {
                        return { u, ok: false, erro: (e && e.message) ? e.message : String(e) };
                    }
                }));

                const falhas = resultados.filter(r => !r.ok);
                if (falhas.length > 0) {
                    console.error(`[AutoMeta] ${falhas.length} de ${pendingMeta.length} metas NÃO foram salvas. `
                        + `Primeiro erro: ${falhas[0].erro}`);
                }

                // Só entra no histórico o que de fato foi gravado.
                pendingMeta = resultados.filter(r => r.ok).map(r => r.u);

                // Gravar histórico de metas em lote
                if (pendingMeta.length > 0) try {
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
                    // upsert idempotente: a constraint historico_metas_dedupe_key
                    // (processo_id, registros, meta, dias_estipulados, autor) impede
                    // a reinserção da mesma linha numa recarga/corrida.
                    await sbClient.from('historico_metas').upsert(logs, {
                        onConflict: 'processo_id,registros,meta,dias_estipulados,autor',
                        ignoreDuplicates: true
                    });
                } catch (errBatch) {
                    console.error('[AutoMeta] falha ao registrar lote no historico_metas:', errBatch);
                }
            }
        } catch (e) {
            console.error('[AutoMeta] falha ao estabelecer metas automáticas:', e);
        }

        await carregarDadosFinanceiro();

        populateAllTabFilters();
        renderLastUpdate();
        updateDashboard();
        // Não chamar clearFinanceiro() aqui: isso forçava "Todos" nos filtros do
        // Financeiro em toda recarga de dados (inclusive após criar/editar/excluir
        // qualquer processo em outra aba), descartando a seleção manual do usuário.
        // populateAllTabFilters() já popula/preserva os filtros; clearFinanceiro()
        // continua disponível só no botão explícito "Limpar filtros".
        updateFinanceiro();
        if (typeof carregarAtividadesResumoHome === 'function') carregarAtividadesResumoHome();
        iniciarVarreduraRiscoDiligencia();
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

    // O <select> de Fiscal agora carrega a matrícula no value; o nome vem do rótulo da opção.
    const fiscalCad = lerFiscalSelecionado(document.getElementById('cad-fiscal'));

    const payload = {
        processo: numProcesso,
        tipo: formData.get("TIPO"),
        status: formData.get("STATUS"),
        descricao: formData.get("DESCRIÇÃO"),
        contratante: formData.get("CONTRATANTE"),
        contratada: formData.get("CONTRATADA"),
        fiscal: fiscalCad.nome,
        fiscal_matricula: fiscalCad.matricula,
        analista: formData.get("ANALISTA"),
        codigo_obra: safeVal('cad_codigo_obra').trim() || null,
        distrito_operacional: safeVal('cad_distrito').trim() || null,
        municipio: safeVal('cad_municipio').trim() || null,

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
        msg.innerHTML = `Erro ao salvar: ${escapeHTML(e && e.message ? e.message : String(e))}`;
        btn.disabled = false;
        btn.innerHTML = 'SALVAR';
        return;
    }

    if (error) {
        console.error(error);
        msg.style.display = 'block';
        msg.className = 'alert alert-danger mt-3';
        // A mensagem do PostgREST costuma ecoar o valor que o usuário enviou, então vai
        // escapada antes de entrar como HTML. — 22/09/2026
        msg.innerHTML = `Erro ao salvar: ${escapeHTML(error.message)}`;
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
                        const iso = metaDate.toISOString().substring(0, 10);
                        // Atualiza processo com a meta correta calculada a partir do created_at
                        const { error: errUp } = await sbClient.from('processos').update({ data_compromisso_fiscal: iso }).eq('id', pData.id);
                        if (errUp) console.error('[ERRO] Falha ao atualizar processo com meta calculada:', errUp.message);

                        // Inserir histórico de metas registrando o 'registro' (data da base) e dias
                        const est = baseDate.toISOString().substring(0, 10);
                        const { error: errHist } = await sbClient.from('historico_metas').upsert([{
                            processo_id: pData.id,
                            registros: est,
                            dias_estipulados: dias,
                            meta: iso,
                            autor: 'Sistema'
                        }], { onConflict: 'processo_id,registros,meta,dias_estipulados,autor', ignoreDuplicates: true });
                        if (errHist) console.error('[ERRO] Falha ao registrar log de meta inicial:', errHist.message);
                    }
                }
            } catch (e) {
                console.error('[ERRO] Ao calcular/gravar meta pós-inserção:', e);
            }
        })();

        // Log de Atividade
        registrarAtividade('PROCESSO', `cadastrou o processo Nº ${numProcesso}`, numProcesso, formData.get("DESCRIÇÃO"), fiscalCad.nome);

        // Notificação WhatsApp (Apenas se entrar em Análise Fiscal)
        const statusInicial = formData.get("STATUS");

        // Localiza o id recém-criado — precisa dele sempre agora (não só quando nasce em
        // AGUAR. APROVAÇÃO, para abrir o checklist), pois o setTimeout abaixo usa o id
        // para atualizar só essa linha em vez de recarregar toda a tabela (egress,
        // 18/09/2026 — mesmo padrão de atualizarLinhaProcessoLocal/removerProcessoLocal
        // já usado em editar/excluir).
        let processoIdRecemCriado = null;
        try {
            const { data: pRow, error: errRow } = await sbClient.from('processos').select('id').eq('processo', numProcesso).maybeSingle();
            if (!errRow && pRow) processoIdRecemCriado = pRow.id;
        } catch (e) {
            console.error('[ERRO] Ao localizar processo recém-criado:', e);
        }

        if (statusInicial === 'ANÁLISE FISCAL') {
            const metaFormatada = payload.data_compromisso_fiscal ? payload.data_compromisso_fiscal.split('-').reverse().join('/') : 'Não definida';
            processarNotificacao('novo_processo', {
                NOME_FISCAL: fiscalCad.nome || 'Fiscal',
                NUP_PROCESSO: numProcesso,
                NOME_OBRA: formData.get("DESCRIÇÃO") || 'Obra não informada',
                DATA_META: metaFormatada
            });
        }

        // Notificação para Analistas Específicos
        const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO', 'ADA'];

        let analistaExtenso = formData.get("ANALISTA") || "";
        if (analistaExtenso === "N") analistaExtenso = "Nildeno";
        else if (analistaExtenso === "W") analistaExtenso = "Walace";
        else if (analistaExtenso === "P") analistaExtenso = "Pedro";
        else if (analistaExtenso === "F") analistaExtenso = "Felipe";
        else if (analistaExtenso === "H") analistaExtenso = "Helder";
        else if (analistaExtenso === "A") analistaExtenso = "Ada";

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
            const elObraStatus = document.getElementById('cad_obra_status');
            if (elObraStatus) elObraStatus.textContent = '';
            const elComissaoWrap = document.getElementById('cad_comissao_wrap');
            if (elComissaoWrap) elComissaoWrap.style.display = 'none';
            // Busca só a linha recém-criada em vez de recarregar toda a tabela — mesmo
            // padrão do editar/excluir. Se o id não foi localizado por algum motivo, cai
            // para o reload completo em vez de deixar a tela sem o processo novo.
            if (processoIdRecemCriado) atualizarLinhaProcessoLocal(processoIdRecemCriado);
            else carregarDadosSupabase();

            // Checklist de documentação do aditivo só faz sentido para quem já nasce em
            // AGUAR. APROVAÇÃO (fecha a brecha do cadastro) — processoIdRecemCriado agora
            // é buscado sempre (linha acima também usa), não é mais um proxy dessa
            // condição, então o status precisa ser checado aqui de novo.
            if (processoIdRecemCriado && statusInicial === 'AGUAR. APROVAÇÃO') {
                checklistAditivoState = {
                    processoStr: numProcesso,
                    processoId: processoIdRecemCriado,
                    descricao: formData.get("DESCRIÇÃO") || "",
                    sessionFinalized: false,
                    latestChecklist: null
                };
                abrirModalChecklistAditivo();
            }
        }, 1500);
    }
}

// --- 5. CORE: DETALHES, ATUALIZAR E EXCLUIR ---

// Ativa uma das abas de GERENCIAR PROCESSO (Geral/Financeiro/Documental/Técnica/
// Histórico) via API de Tab do Bootstrap. Usado ao reabrir o modal (sempre começa
// em "Geral") e para levar o usuário até a aba certa quando a validação falha num
// campo que está numa aba não visível no momento.
function mostrarAbaGerenciarProcesso(tabBtnId) {
    const btn = document.getElementById(tabBtnId);
    if (btn && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
        bootstrap.Tab.getOrCreateInstance(btn).show();
    }
}

// IDs das abas/painéis de GERENCIAR PROCESSO, na ordem em que aparecem.
const GP_TABS = [
    { btn: 'gp-tab-geral-btn', pane: 'gp-pane-geral' },
    { btn: 'gp-tab-documental-btn', pane: 'gp-pane-documental' },
    { btn: 'gp-tab-tecnica-btn', pane: 'gp-pane-tecnica' },
    { btn: 'gp-tab-historico-btn', pane: 'gp-pane-historico' }
];

// Volta para a aba "Geral" via manipulação direta de classes (sem passar pela API
// animada bootstrap.Tab.show()). É usada ANTES do modal.show(), com o modal ainda
// oculto (display:none) — nesse estado a transição CSS do Bootstrap nunca dispara um
// transitionend real, e o fallback por timeout do bootstrap.Tab pode terminar de
// aplicar as classes só depois do modal já estar visível, deixando por um instante
// (ou, em alguns casos, permanentemente) nenhuma aba marcada como ativa — e por isso
// nenhum conteúdo aparece. Setando as classes na hora, isso não pode acontecer.
function resetarAbasGerenciarProcesso() {
    GP_TABS.forEach((tab, i) => {
        const btn = document.getElementById(tab.btn);
        const pane = document.getElementById(tab.pane);
        if (btn) {
            btn.classList.toggle('active', i === 0);
            btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
        }
        if (pane) {
            pane.classList.toggle('active', i === 0);
            pane.classList.toggle('show', i === 0);
        }
    });
}

// Mostra/oculta o badge numérico no rótulo de uma aba (ex.: pendências/inconsistências).
function atualizarBadgeAba(elId, count) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (count > 0) {
        el.textContent = count;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

async function abrirDetalhes(processoStr) {
    // garante que a role local esteja atualizada com o servidor
    await refreshUserRole();
    await garantirFiscaisCarregados();
    const row = (window.allData || []).find(d => d.processo === processoStr);
    if (!row) { alert("Erro: Dados não encontrados na memória."); return; }

    resetarAbasGerenciarProcesso();

    document.getElementById('det_processo').value = row.processo;
    document.getElementById('det_tipo').value = row.tipo;
    document.getElementById('det_status').value = row.status;
    aplicarCorStatusSelect(document.getElementById('det_status'));
    document.getElementById('det_descricao').value = row.descricao;

    // Reseta o estado da Curva ABC para este processo
    curvaAbcProcessoState = {
        processoStr: row.processo,
        processoId: row.id,
        descricao: row.descricao || "",
        vindoDoModal: false
    };

    // Reseta o estado do checklist de documentação para este processo
    checklistAditivoState = {
        processoStr: row.processo,
        processoId: row.id,
        descricao: row.descricao || "",
        sessionFinalized: false,
        latestChecklist: null
    };
    document.getElementById('det_contratante').value = row.contratante;
    document.getElementById('det_contratada').value = row.contratada;
    if (document.getElementById('det_codigo_obra')) document.getElementById('det_codigo_obra').value = row.codigoObra || '';
    if (document.getElementById('det_distrito')) document.getElementById('det_distrito').value = row.distritoOperacional || '';
    if (document.getElementById('det_municipio')) document.getElementById('det_municipio').value = row.municipio || '';
    if (document.getElementById('det_obra_status')) document.getElementById('det_obra_status').textContent = '';

    // Seleciona pelo vínculo estável (fiscal_matricula); cai no nome só para processos
    // antigos ainda sem matrícula. "Não informado" é fallback de exibição, não é nome real.
    selecionarFiscal(document.getElementById('det_fiscal'), {
        matricula: row.fiscalMatricula,
        nome: (row.fiscal && row.fiscal !== 'Não informado') ? row.fiscal : null
    });

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
    // Revisão 22/09/2026 — os campos eram liberados só para admin, enquanto a política
    // `processos_update` do banco já autorizava gerente. Decisão do usuário: alinhar a tela
    // ao banco. As duas exceções só-admin (prioridade e meta manual) continuam valendo e
    // estão logo abaixo — ver podeEditarProcesso() em core/auth.js.
    const podeEditar = podeEditarProcesso();
    const inputs = document.querySelectorAll('#formDetalhes input, #formDetalhes select, #formDetalhes textarea');
    inputs.forEach(el => { el.disabled = !podeEditar; });

    // "Meta Fiscal" segue só-admin: o trigger `processos_restringir_prioridade_meta` recusa o
    // UPDATE quando `data_compromisso_fiscal` é a única coluna alterada. Sem este gate, o
    // gerente que mexesse só nesse campo levaria um erro do banco na cara ao salvar.
    //
    // ATENÇÃO — é `readOnly`, NUNCA `disabled`: campo desabilitado não entra no `FormData`,
    // e o payload de executarAcaoDetalhes é montado com `new FormData(form)`. Com `disabled`,
    // `formData.get("DATA COMPROMISSO FISCAL")` devolveria `null` e TODO salvamento de gerente
    // apagaria a meta do processo em silêncio. (O payload também é gateado, mais abaixo — as
    // duas proteções são deliberadas: esta preserva o valor, aquela garante que ele não seja
    // reenviado como alteração.) `readOnly` também mantém o `title` funcionando: navegador não
    // dispara evento de mouse em campo desabilitado, então o tooltip não abriria.
    const elMetaFiscal = document.getElementById('det_data_compromisso');
    if (elMetaFiscal) {
        const metaSoAdmin = !canMarkDateAsMeta();
        // As três atribuições são incondicionais de propósito: com um `if (metaSoAdmin)` o
        // estado não seria revertido se o papel mudasse na mesma sessão e o modal reabrisse.
        elMetaFiscal.readOnly = metaSoAdmin;
        elMetaFiscal.classList.toggle('bg-body-secondary', metaSoAdmin);
        elMetaFiscal.title = metaSoAdmin ? 'Definida automaticamente pelo status. Apenas administradores alteram manualmente.' : '';
    }

    // Botão "Vincular/Atualizar Obra" não é input/select/textarea, então precisa do
    // próprio gate — religar um processo legado a um contrato é uma correção de dados,
    // mesmo padrão de restrição a admin usado em excluirChecklistAditivo (contratos.js).
    const btnVincularObra = document.getElementById('btn-vincular-obra');
    if (btnVincularObra) btnVincularObra.disabled = !isAdmin;

    // ...e os três campos do MESMO bloco seguem o botão: são o vínculo com o contrato do
    // SIGSOP, que o texto fixo do formulário anuncia como restrito a administradores.
    // O laço acima os havia liberado junto com o resto do formulário quando o gerente passou
    // a editar (22/09/2026) — abertura não intencional, e pior que a contradição visual:
    // digitados à mão, eles pulam `buscarObraDetalhes()`, que é quem confere o código contra a
    // base de contratos e preenche distrito/município a partir do SIGSOP. Um erro de digitação
    // aqui desfaz o vínculo processo↔obra em silêncio — o mesmo vínculo que alimenta o painel
    // de desempenho e o mapa de obras.
    //
    // Aqui `disabled` é seguro (ao contrário da Meta Fiscal): estes três são lidos por
    // `getElementById().value` no payload, e `.value` continua legível em campo desabilitado.
    // Quem sai do FormData é só quem é lido POR ele.
    ['det_codigo_obra', 'det_distrito', 'det_municipio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !isAdmin;
            el.title = isAdmin ? '' : 'Restrito a administradores — use o botão Vincular para alterar o vínculo com a obra.';
        }
    });

    document.getElementById('msg-detalhes').style.display = 'none';

    // O botão SALVAR era escondido pela classe `.admin-only` no HTML (core/auth.js esconde
    // tudo que tem essa classe para quem não é admin). Com o gerente autorizado a editar, o
    // controle passou para cá — mesmo padrão do botão EXCLUIR logo abaixo.
    const btnSalvarModal = document.getElementById('btn-atualizar');
    if (btnSalvarModal) {
        btnSalvarModal.innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';
        btnSalvarModal.disabled = !podeEditar;
        btnSalvarModal.style.display = podeEditar ? '' : 'none';
    }

    // Revisão 22/09/2026 — este trecho reabilitava o botão EXCLUIR para QUALQUER usuário que
    // conseguisse abrir o modal, inclusive quem não tinha autorização nenhuma, desfazendo a
    // intenção do `.admin-only` no HTML e entregando um erro do banco a quem clicasse. Agora o
    // botão aparece exatamente para quem o banco autoriza a excluir hoje — admin e gerente,
    // pela política `processos_update` viva. A autorização especial `processos_gravar` NÃO
    // entra: ver podeGravarProcessos() em core/auth.js.
    const btnExcluirModal = document.getElementById('btn-excluir');
    if (btnExcluirModal) {
        const podeExcluir = podeExcluirProcesso();
        btnExcluirModal.innerHTML = '<i class="bi bi-trash-fill"></i> EXCLUIR PROCESSO';
        btnExcluirModal.disabled = !podeExcluir;
        btnExcluirModal.style.display = podeExcluir ? '' : 'none';
    }

    // Audit Info Display
    const dtCriacao = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '';
    const txtCriador = row.criador || 'Não Registrado';
    document.getElementById('det_criador').textContent = dtCriacao ? `${txtCriador} em ${dtCriacao}` : txtCriador;

    let txtUpdate = 'Sem alterações recentes';
    if (row.atualizado_por) {
        const dt = row.ultima_atualizacao ? new Date(row.ultima_atualizacao).toLocaleString('pt-BR') : '';
        txtUpdate = `${row.atualizado_por} em ${dt}`;
    }
    document.getElementById('det_atualizacao').textContent = txtUpdate;

    // Buscar histórico de prioridades
    carregarHistoricoPrioridades(processoStr);

    // Buscar checklist de documentação do aditivo (resumo + histórico)
    carregarChecklistAditivo(processoStr, row.id);

    // Buscar Curva ABC do processo (resumo + versões anteriores)
    if (typeof carregarCurvaAbcResumo === 'function') carregarCurvaAbcResumo(processoStr, row.id);

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
                        ${icon} <span class="fw-bold text-dark">${escapeHTML(registro.usuario)}</span>
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

// Configuração dos itens Sim/Não do checklist (chave do radio -> coluna no banco)
const CHECKLIST_ADITIVO_ITENS = [
    { key: 'chk_planilha', campo: 'planilha_orcamentaria_validada', obsCampo: 'planilha_orcamentaria_obs', label: 'Planilha Orçamentária Validada', obrigatorio: 'sempre' },
    { key: 'chk_memoria', campo: 'memoria_calculo', obsCampo: 'memoria_calculo_obs', label: 'Memória de Cálculo', obrigatorio: 'sempre' },
    { key: 'chk_parecer', campo: 'parecer_tecnico', obsCampo: 'parecer_tecnico_obs', label: 'Parecer Técnico', obrigatorio: 'sempre' },
    { key: 'chk_art_fiscalizacao', campo: 'art_fiscalizacao', obsCampo: 'art_fiscalizacao_obs', label: 'ART de Fiscalização', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_art_execucao', campo: 'art_execucao', obsCampo: 'art_execucao_obs', label: 'ART de Execução', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_portaria', campo: 'portaria_fiscalizacao', obsCampo: 'portaria_fiscalizacao_obs', label: 'Portaria de Fiscalização', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_curva_abc', campo: 'curva_abc', obsCampo: 'curva_abc_obs', label: 'Curva ABC', obrigatorio: 'sempre' },
    // pendenciaSeNao: false -> "Não" aqui só significa que a Composição Própria não foi
    // aprovada neste aditivo (nada a providenciar), então não conta como pendência nem
    // gera a observação automática de documento indispensável.
    { key: 'chk_comp_propria', campo: 'composicao_propria', obsCampo: 'composicao_propria_obs', label: 'Composição Própria (CXXXX)', obrigatorio: 'sempre', pendenciaSeNao: false },
    // Sub-pergunta condicional: só é obrigatória (e só aparece no formulário) quando
    // composicao_propria = true — se não houve Composição Própria aprovada, não faz
    // sentido perguntar se as composições estão de forma analítica.
    { key: 'chk_comp_analiticas', campo: 'composicoes_analiticas', obsCampo: 'composicoes_analiticas_obs', label: 'Composições Analíticas', obrigatorio: 'comp_propria' },
    { key: 'chk_docs_assinados', campo: 'docs_assinados_fiscalizacao', obsCampo: 'docs_assinados_fiscalizacao_obs', label: 'Documentos assinados pela Fiscalização', obrigatorio: 'sempre' }
];

function onChangeStatusDetalhes(selectEl) {
    aplicarCorStatusSelect(selectEl);
    if (!selectEl || selectEl.value !== 'AGUAR. APROVAÇÃO') return;
    if (getCurrentUserRole() !== 'admin') return;
    // Só força a abertura (e o reset) do checklist quando ele realmente precisar ser
    // refeito — evita interromper/limpar o formulário à toa quando já existe um
    // checklist válido para o processo (ver checklistValidoParaSalvar).
    if (checklistValidoParaSalvar(selectEl.value)) return;
    checklistAditivoState.sessionFinalized = false;
    abrirModalChecklistAditivo();
}

// Mesma classificação de cor por status já usada nos badges da tabela de processos
// (ver render da tabela de metas/prazos), reaproveitada aqui para colorir o próprio
// <select> de Status dentro de GERENCIAR PROCESSO — dá pra reconhecer o status de
// relance, sem precisar ler o texto.
const GP_STATUS_BADGE_CLASSES = ['badge-status-devolvido', 'badge-status-diligencia', 'badge-status-contratante',
    'badge-status-dark-blue', 'badge-status-fiscal', 'badge-status-aguar-reanalise', 'badge-status-light-blue',
    'badge-status-em-reanalise', 'badge-status-em-analise', 'badge-status-aprovado', 'badge-status-arquivado'];

function classeBadgeStatus(statusRaw) {
    const stTxt = (statusRaw || '').toString().toUpperCase().trim();
    if (stTxt.includes('DEVOLVIDO')) return 'badge-status-devolvido';
    if (stTxt.includes('DILIG')) return 'badge-status-diligencia';
    if (stTxt.includes('CONTRATANTE')) return 'badge-status-contratante';
    if (stTxt.includes('APROVAÇÃO')) return 'badge-status-dark-blue';
    if (stTxt.includes('FISCAL') && (stTxt.includes('ANÁLISE') || stTxt.includes('ANALISE'))) return 'badge-status-fiscal';
    if (stTxt.includes('AGUAR')) return stTxt.includes('REAN') ? 'badge-status-aguar-reanalise' : 'badge-status-light-blue';
    if (stTxt.startsWith('EM') && stTxt.includes('REANÁLISE')) return 'badge-status-em-reanalise';
    if (stTxt.startsWith('EM') && (stTxt.includes('ANÁLISE') || stTxt.includes('ANALISE'))) return 'badge-status-em-analise';
    if (stTxt.includes('APROVADO') || stTxt === 'SEDUC') return 'badge-status-aprovado';
    if (stTxt.includes('ARQUIVADO')) return 'badge-status-arquivado';
    return '';
}

function aplicarCorStatusSelect(selectEl) {
    if (!selectEl) return;
    GP_STATUS_BADGE_CLASSES.forEach(c => selectEl.classList.remove(c));
    const cls = classeBadgeStatus(selectEl.value);
    if (cls) selectEl.classList.add(cls);
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
        // Revisão 22/09/2026 — antes, esta função não checava papel nenhum: a única barreira
        // era a classe CSS `.admin-only` no botão, que `abrirDetalhes()` reabilitava para
        // todo mundo que conseguisse abrir o modal. Quem não podia excluir chegava ao botão
        // e levava um erro do banco. A regra abaixo é a MESMA da política `processos_update`
        // que está viva no banco — admin e gerente (ver podeGravarProcessos() em core/auth.js,
        // que explica por que a autorização especial `processos_gravar` ficou de fora desde
        // 18/09/2026). As duas precisam continuar concordando.
        if (!podeExcluirProcesso()) {
            alert("Você não tem permissão para excluir processos.");
            return;
        }
        if (!confirm("TEM CERTEZA? O processo será movido para EXCLUÍDOS e sairá da lista principal.")) return;

        const btn = document.getElementById('btn-excluir');
        const rotuloOriginal = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = "EXCLUINDO...";
            btn.disabled = true;
        }

        // Soft Delete com Auditoria
        const userName = sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido';
        const updates = {
            status: 'EXCLUÍDO',
            excluido_por: userName,
            data_exclusao: new Date().toISOString()
        };

        try {
            const { error } = await sbClient.from('processos').update(updates).eq('id', idUnico);
            if (error) throw new Error(error.message);

            alert("Excluído com sucesso!");
            const modalEl = document.getElementById('modalDetalhes');
            if (modalEl) {
                const instancia = bootstrap.Modal.getInstance(modalEl);
                if (instancia) instancia.hide();
            }
            // Egress, 18/09/2026 — docs/auditoria-egress-2026-09.md, item 5.
            removerProcessoLocal(idUnico);
        } catch (e) {
            // Sem este catch, uma falha de rede deixava o botão preso em "EXCLUINDO..."
            // desabilitado para sempre, sem nenhuma mensagem ao usuário.
            alert("Erro ao excluir: " + (e && e.message ? e.message : e));
            if (btn) {
                btn.innerHTML = rotuloOriginal;
                btn.disabled = false;
            }
        }
        return;
    }

    if (actionType === 'update') {
        // Mesma guarda do ramo 'delete': a trava da tela é cosmética (o botão some), e quem
        // decide de verdade é a política `processos_update`. Esta checagem existe para que
        // quem não pode editar receba um aviso legível em vez de um erro do banco. — 22/09/2026
        if (!podeEditarProcesso()) {
            alert("Você não tem permissão para editar processos.");
            return;
        }

        // --- VALIDAÇÕES DE CAMPOS OBRIGATÓRIOS ---
        const camposObrigatorios = [
            { id: 'det_status', nome: 'Status Atual' },
            { id: 'det_tipo', nome: 'Tipologia' },
            { id: 'det_fiscal', nome: 'Fiscal Responsável', tab: 'gp-tab-geral-btn' },
            { id: 'det_descricao', nome: 'Descrição do Objeto', tab: 'gp-tab-geral-btn' },
            { id: 'det_contratante', nome: 'Contratante', tab: 'gp-tab-geral-btn' },
            { id: 'det_contratada', nome: 'Contratada', tab: 'gp-tab-geral-btn' }
        ];

        for (const campo of camposObrigatorios) {
            const el = document.getElementById(campo.id);
            if (!el || !el.value.trim()) {
                if (campo.tab) mostrarAbaGerenciarProcesso(campo.tab);
                alert(`O campo "${campo.nome}" é obrigatório.`);
                // `el.focus()` sem guarda estourava justamente no caso `!el` (campo ausente
                // no HTML), trocando o aviso legível por um erro de script. — 22/09/2026
                if (el) el.focus();
                return;
            }
        }

        const statusAtual = document.getElementById('det_status').value;

        // 2.1 Se o Status for AGUAR. ANÁLISE, o campo RECEBIMENTO deve estar preenchido
        if (statusAtual === 'AGUAR. ANÁLISE') {
            const valRecebimento = document.getElementById('det_data_recebimento').value.trim();
            if (!valRecebimento) {
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
                alert("Para o status 'AGUAR. ANÁLISE', o campo 'Recebimento' é obrigatório.");
                document.getElementById('det_data_recebimento').focus();
                return;
            }
        }

        // 2.2 Se o Status for REANÁLISE FISCAL, o campo DEVOLUÇÃO PARA CORREÇÃO deve estar preenchido
        if (statusAtual === 'DEVOLVIDO P/ REANÁLISE FISCAL') {
            const valDevolucao = document.getElementById('det_data_devolucao').value.trim();
            if (!valDevolucao) {
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
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
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
                alert(`Para o status "${statusAtual}", os campos de ACRÉSCIMO (GECOPE), SUPRESSÃO (GECOPE) e APROVAÇÃO GECOPE devem estar preenchidos.`);
                return;
            }
        }

        // 2.4 Checklist de Documentação do Aditivo obrigatório para AGUAR. APROVAÇÃO/APROVADO
        if (!checklistValidoParaSalvar(statusAtual)) {
            mostrarAbaGerenciarProcesso('gp-tab-documental-btn');
            alert('É obrigatório preencher o Checklist de Documentação do Aditivo antes de salvar o processo com este status.');
            abrirModalChecklistAditivo();
            return;
        }

        const formData = new FormData(form);

        const fiscalDet = lerFiscalSelecionado(document.getElementById('det_fiscal'));

        const updates = {
            tipo: formData.get("TIPO"),
            status: formData.get("STATUS"),
            descricao: formData.get("DESCRIÇÃO"),
            fiscal: fiscalDet.nome,
            fiscal_matricula: fiscalDet.matricula,
            contratante: formData.get("CONTRATANTE"),
            contratada: formData.get("CONTRATADA"),
            analista: document.getElementById('det_analista').value,
            codigo_obra: document.getElementById('det_codigo_obra').value.trim() || null,
            distrito_operacional: document.getElementById('det_distrito').value.trim() || null,
            municipio: document.getElementById('det_municipio').value.trim() || null,

            data_abertura: dataParaISO(formData.get("DATA DE ABERTURA")),
            data_recebimento: dataParaISO(formData.get("DATA RECEBIMENTO")),
            // `data_compromisso_fiscal` NÃO entra aqui — ver o gate logo depois do objeto.
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

        // A meta é só-admin no banco (trigger `processos_restringir_prioridade_meta`), então
        // para quem não é admin a coluna nem entra no payload vindo do formulário. Reenviar o
        // valor seria inofensivo ENQUANTO fosse idêntico ao gravado — mas basta uma diferença
        // de formatação de data para o banco ler aquilo como alteração manual e recusar o
        // salvamento inteiro. O recálculo automático logo abaixo continua podendo gravar a
        // coluna: aí é efeito colateral de troca de status, que o trigger aceita de propósito
        // (ver o comentário dele em sql/rls_processos_composicoes_orcamentos.sql). — 22/09/2026
        if (canMarkDateAsMeta()) {
            updates.data_compromisso_fiscal = dataParaISO(formData.get("DATA COMPROMISSO FISCAL"));
        }

        // NOVA LÓGICA: Recalcular metas automáticas se o status mudar ou se a data de devolução for alterada
        const novoStatus = (updates.status || registroOriginal.status || "").toString().trim().toUpperCase();
        const statusAntigo = (registroOriginal.status || "").toString().trim().toUpperCase();
        const dataDevNova = updates.data_devolucao_correcoes;
        // Revisão 22/09/2026 — esta linha chamava `.toISOString()` direto no retorno de
        // `isoParaDate()`, que devolve null para valor não reconhecido: bastava uma data
        // inválida no registro para o salvamento estourar no meio, com o botão já em
        // "SALVANDO..." e nenhuma mensagem. Agora a conversão é verificada antes de usar.
        // (`registroOriginal.data_devolucao_correcoes` nunca existe — `mapProcessoRow` só
        //  produz `dataDevolucaoCorrecoes` —, mas o operando fica por segurança.)
        const dataDevOriginalBruta = registroOriginal.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes || null;
        const dataDevOriginalDate = dataDevOriginalBruta ? isoParaDate(dataDevOriginalBruta) : null;
        const dataDevAntiga = (dataDevOriginalDate && !isNaN(dataDevOriginalDate.getTime()))
            ? dataDevOriginalDate.toISOString().substring(0, 10)
            : null;

        const statusMudou = novoStatus && novoStatus !== statusAntigo;
        const dataDevMudou = dataDevNova && dataDevNova !== dataDevAntiga;

        if (statusMudou) {
            updates.ultima_atualizacao = new Date().toISOString(); // Reinicia o contador de dias se o status mudar

            // Mantém `status_pre_arquivamento` consistente também quando o arquivamento/
            // desarquivamento é feito manualmente por aqui (não só pelo job sincronizar-suite):
            // guarda de onde veio ao arquivar, limpa ao sair do arquivado.
            if (novoStatus === 'ARQUIVADO') {
                updates.status_pre_arquivamento = registroOriginal.status || null;
            } else if (statusAntigo === 'ARQUIVADO') {
                updates.status_pre_arquivamento = null;
            }
        }

        // `calcularDataMeta` devolve null quando a data base não é reconhecida, e o código
        // antigo chamava `.toISOString()` no resultado sem conferir — o salvamento estourava
        // no meio, com o botão travado em "SALVANDO..." e sem mensagem nenhuma ao usuário.
        // Agora a meta só é gravada se a conta tiver dado certo. — 22/09/2026
        const metaISOouNulo = (base, dias) => {
            const d = base ? calcularDataMeta(base, dias) : null;
            return (d && !isNaN(d.getTime())) ? d.toISOString().substring(0, 10) : null;
        };

        if (statusMudou || dataDevMudou) {
            // Automação GECOPE: definir metas automáticas
            if (novoStatus === 'ANÁLISE FISCAL') {
                updates.data_compromisso_fiscal = metaISOouNulo(registroOriginal.created_at || new Date(), 20);
            } else if (novoStatus === 'DEVOLVIDO P/ REANÁLISE FISCAL' || novoStatus === 'REANÁLISE FISCAL') {
                // Para reanálises, usar a data de devolução informada no formulário.
                // `REANÁLISE FISCAL` (forma curta) não existe em nenhum dropdown, mas é aceita
                // aqui e na regra 3 do job sincronizar-suite — dado legado.
                const devolucaoFinal = updates.data_devolucao_correcoes || dataDevAntiga;
                const base = devolucaoFinal ? isoParaDate(devolucaoFinal) : new Date();
                updates.data_compromisso_fiscal = metaISOouNulo(base, 10);
            } else if (statusMudou) {
                // Remove a meta se o status mudou para algo que não tem meta automática
                updates.data_compromisso_fiscal = null;
                const key = `meta:${processoNome}`;
                localStorage.removeItem(key);
            }
        }

        const btn = document.getElementById('btn-atualizar');
        if (btn) {
            btn.innerHTML = "SALVANDO...";
            btn.disabled = true;
        }

        // Um erro de rede aqui (fetch rejeitado) não voltava como `{ error }`: era exceção,
        // e sem try/catch o botão ficava preso em "SALVANDO..." desabilitado, sem aviso.
        let error = null;
        try {
            const res = await sbClient.from('processos').update(updates).eq('id', idUnico);
            error = res.error;
        } catch (e) {
            error = { message: (e && e.message) ? e.message : String(e) };
        }

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';
        }

        if (error) {
            alert("Erro ao atualizar: " + error.message);
        } else {
            const msg = document.getElementById('msg-detalhes');
            msg.style.display = 'block';
            msg.className = 'alert alert-success';
            msg.innerHTML = ' Dados atualizados!';

            // Gravar log no historico_metas se a meta mudou ou foi zerada
            // registroOriginal vem de window.allData (mapProcessoRow), que expõe a data como
            // Date em dataCompromissoFiscal — não existe campo data_compromisso_fiscal aqui.
            const dataLimiteOriginal = registroOriginal.dataCompromissoFiscal
                ? registroOriginal.dataCompromissoFiscal.toISOString().substring(0, 10)
                : null;
            // Quando a coluna não foi ao payload (não-admin — ver o gate acima) e o recálculo
            // automático também não a definiu, a meta simplesmente NÃO mudou. Ler `undefined`
            // como `null` faria o histórico registrar uma "meta zerada" que nunca aconteceu no
            // banco. Por isso o fallback é a data original, não `null`. — 22/09/2026
            const metaNoPayload = Object.prototype.hasOwnProperty.call(updates, 'data_compromisso_fiscal');
            const dataLimiteNova = metaNoPayload ? (updates.data_compromisso_fiscal || null) : dataLimiteOriginal;

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

                const estStr = (baseDate instanceof Date ? baseDate.toISOString().substring(0, 10) : (new Date(baseDate).toISOString().substring(0, 10)));
                sbClient.from('historico_metas').upsert([{
                    processo_id: idUnico,
                    registros: estStr,
                    dias_estipulados: dias,
                    meta: dataLimiteNova,
                    autor: autor
                }], { onConflict: 'processo_id,registros,meta,dias_estipulados,autor', ignoreDuplicates: true }).then(({ error: errHist }) => {
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
            const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO', 'ADA'];

            let aAtualExtenso = updates.analista || "";
            if (aAtualExtenso === "N") aAtualExtenso = "Nildeno";
            else if (aAtualExtenso === "W") aAtualExtenso = "Walace";
            else if (aAtualExtenso === "P") aAtualExtenso = "Pedro";
            else if (aAtualExtenso === "F") aAtualExtenso = "Felipe";
            else if (aAtualExtenso === "H") aAtualExtenso = "Helder";
            else if (aAtualExtenso === "A") aAtualExtenso = "Ada";
            const analistaAtual = aAtualExtenso.toUpperCase();

            let aAnteriorExtenso = registroOriginal.analista || "";
            if (aAnteriorExtenso === "N") aAnteriorExtenso = "Nildeno";
            else if (aAnteriorExtenso === "W") aAnteriorExtenso = "Walace";
            else if (aAnteriorExtenso === "P") aAnteriorExtenso = "Pedro";
            else if (aAnteriorExtenso === "F") aAnteriorExtenso = "Felipe";
            else if (aAnteriorExtenso === "H") aAnteriorExtenso = "Helder";
            else if (aAnteriorExtenso === "A") aAnteriorExtenso = "Ada";
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
                // Não aguardado de propósito: igual ao antigo carregarDadosSupabase() que
                // estava aqui, o código abaixo lê registroOriginal (estado ANTES da
                // gravação) — atualizarLinhaProcessoLocal só muta window.allData depois
                // que a busca de rede (assíncrona) resolver, então esta comparação segue
                // vendo o valor antigo. Egress, 18/09/2026 — item 5 da auditoria.
                atualizarLinhaProcessoLocal(idUnico);

                // Log de Atividade (Apenas se status mudou, ou log geral)
                if (updates.status && updates.status !== registroOriginal.status) {
                    registrarAtividade('PROCESSO', `atualizou o status do processo Nº ${processoNome} para ${updates.status}`, processoNome, registroOriginal.descricao, registroOriginal.fiscal);
                }
            }, 1000);
        }
    }
}

// --- FUNES AUXILIARES RECUPERADAS ---

// `parseMoneyInput()` é definida em utils.js e exposta em window.parseMoneyInput — a cópia
// idêntica que existia aqui foi removida na revisão de 22/09/2026, pelo mesmo motivo do
// debounce() acima: processos.js carrega por último e sobrescrevia a versão de utils.js.

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

window.filtroSomenteAlertaDiligencia = false;

function toggleFiltroAlertaDiligencia() {
    window.filtroSomenteAlertaDiligencia = !window.filtroSomenteAlertaDiligencia;
    const btn = document.getElementById('btn-filtro-alerta-diligencia');
    if (btn) btn.classList.toggle('active', window.filtroSomenteAlertaDiligencia);
    updateReuniao();
}

function switchProcessTab(tab) {
    window.currentProcessesTab = tab;
    const tabIds = ['btn-tab-ativos', 'btn-tab-aprovados', 'btn-tab-arquivados'];
    tabIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', id === 'btn-tab-' + tab);
    });

    // Botão de filtro "somente com alerta de retorno" só faz sentido na aba Aprovados
    if (tab !== 'aprovados') {
        window.filtroSomenteAlertaDiligencia = false;
        const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
        if (btnFiltroAlerta) btnFiltroAlerta.classList.remove('active');
    }
    atualizarVisibilidadeBtnFiltroAlerta();
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

        // Achado do rev-produto (Fase 4): guarda o valor anterior pra poder
        // desfazer a atualização otimista abaixo — se o banco recusar (RLS:
        // meta é só-Admin), a tela não pode continuar mostrando a meta como
        // alterada quando na verdade não foi gravada.
        const valorAnteriorLS = localStorage.getItem(key);
        const dataAnterior = row.dataCompromissoFiscal;

        if (!setD) localStorage.removeItem(key);
        else localStorage.setItem(key, valSupabase);

        row.dataCompromissoFiscal = setD;

        // Sincroniza ativamente com o Supabase quando alterado pelo Painel (Tabela)
        sbClient.from('processos')
            .update({ data_compromisso_fiscal: valSupabase })
            .eq('id', row.id)
            .select('id')
            .then(({ data: updData, error }) => {
                if (error || !updData || updData.length === 0) {
                    // Desfaz a atualização otimista: sem isso, a tela continuaria
                    // mostrando a meta nova mesmo o banco tendo recusado a gravação.
                    if (valorAnteriorLS) localStorage.setItem(key, valorAnteriorLS);
                    else localStorage.removeItem(key);
                    row.dataCompromissoFiscal = dataAnterior;
                    alert('Não foi possível salvar a meta: ' + (error ? error.message : 'nenhum processo foi atualizado.'));
                    if (typeof updateReuniao === 'function') updateReuniao();
                }
                if (error) {
                    console.error('[ERRO] Falha ao sincronizar meta na base de dados: ', error.message);
                } else if (!updData || updData.length === 0) {
                    console.error('[ERRO] Nenhuma linha atualizada ao definir meta para o processo:', row.processo);
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

                        sbClient.from('historico_metas').upsert([{
                            processo_id: row.id,
                            registros: new Date().toISOString().substring(0, 10),
                            dias_estipulados: dias,
                            meta: valSupabase,
                            autor: autor
                        }], { onConflict: 'processo_id,registros,meta,dias_estipulados,autor', ignoreDuplicates: true }).then(({ error: errHist }) => {
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

    const mdTime = new Date(md.getFullYear(), md.getMonth(), md.getDate()).getTime();
    const todayTime = new Date().setHours(0, 0, 0, 0);
    return mdTime < todayTime ? "Atrasado" : "No prazo";
}
// Ordem ORIGINAL (para preservar a ordem de carregamento padrão da tela inicial)
function statusPriority(status) {
    const raw = (status || "").toString().toUpperCase().trim();
    const s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 0. DILIGÊNCIA (topo da lista: processo aprovado que retornou para correções, exige atenção prioritária)
    if (s.includes("DILIGEN")) return 0;
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

// A função statusFilterPriority foi removida na revisão de 22/09/2026: era um repasse puro
// para statusPriority (`return statusPriority(status);`), e o comentário que a acompanhava
// dizia ser uma "ordem REVISADA, aplicada apenas ao filtro da coluna Status" — o que deixou
// de ser verdade quando as duas ordens foram unificadas. A chamada passou a ser direta.

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
    const prioridadeAnterior = row ? row.prioritario : undefined;
    if (row) row.prioritario = isPriority;

    // 2. Realizar comunicação com o Supabase nos bastidores (Background Sync)
    try {
        const { error } = await sbClient
            .from('processos')
            .update({ prioritario: isPriority })
            .eq('processo', processo);

        if (error) {
            console.error('[ERRO] Falha ao marcar processo prioritário: ', error.message);
            // Achado do rev-produto (Fase 4): a mensagem fixa "falha de conexão"
            // mascarava a causa real (ex.: RLS recusando por não ser Admin) —
            // mostra o erro de verdade, e desfaz a atualização otimista da linha 2263.
            if (row) row.prioritario = prioridadeAnterior;
            alert('Não foi possível salvar o status prioritário: ' + error.message);
            if (typeof updateReuniao === 'function') updateReuniao();
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

// Paleta categórica validada (contraste/CVD) para os cards de KPI de Processos —
// ver skill de dataviz. Índice 0 é o fiscal com mais processos, e assim por diante.
const KPI_BREAKDOWN_CORES = {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']
};
const KPI_BREAKDOWN_CINZA = { light: '#c3c2b7', dark: '#5c5c58' };

// Classifica as linhas por uma chave (fiscal, distrito, ...) e devolve os pares
// [rótulo, quantidade] em ordem decrescente. Valor vazio cai em `rotuloVazio`.
function _classificarBreakdown(linhas, chaveFn, rotuloVazio) {
    const contagem = new Map();
    linhas.forEach(d => {
        const k = String(chaveFn(d) || '').trim() || rotuloVazio;
        contagem.set(k, (contagem.get(k) || 0) + 1);
    });
    return Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]);
}

// Rosca SVG (donut) de 180x180 a partir de pares [rótulo, qtd] já ordenados.
// Mais de 7 categorias: mantém as 7 maiores e agrupa o resto em "Outros" para
// não estourar o teto de cores categoricamente seguras (ver dataviz skill). O
// mesmo limiar de 7 é usado por `_corBreakdown` (a partir do 8º item = cinza),
// para a cor da fatia bater com a do 'bullet' na lista.
function _roscaBreakdownSVG(entradas, total, isDark) {
    const paleta = isDark ? KPI_BREAKDOWN_CORES.dark : KPI_BREAKDOWN_CORES.light;
    const cinza = isDark ? KPI_BREAKDOWN_CINZA.dark : KPI_BREAKDOWN_CINZA.light;

    let fatias = entradas;
    if (entradas.length > 7) {
        const principais = entradas.slice(0, 7);
        const somaOutros = entradas.slice(7).reduce((acc, [, q]) => acc + q, 0);
        fatias = [...principais, ["Outros", somaOutros]];
    }

    const r = 70, cx = 90, cy = 90, sw = 26;
    const circ = 2 * Math.PI * r;
    let acc = 0;
    const arcosSVG = fatias.map(([nome, qtd], i) => {
        const frac = total ? qtd / total : 0;
        const len = frac * circ;
        const dashoffset = -acc;
        acc += len;
        const cor = nome === "Outros" ? cinza : paleta[i % paleta.length];
        const pct = Math.round(frac * 1000) / 10;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cor}" stroke-width="${sw}"
            stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${dashoffset}"
            transform="rotate(-90 ${cx} ${cy})"><title>${escapeHTML(nome)}: ${qtd} (${pct}%)</title></circle>`;
    }).join('');

    return `<div style="position:relative;flex:none;">
        <svg width="180" height="180" viewBox="0 0 180 180">${arcosSVG}</svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div style="font-size:1.6rem;font-weight:800;color:var(--text-heading);line-height:1;">${total}</div>
            <div style="font-size:0.68rem;color:var(--text-muted);">processo${total === 1 ? '' : 's'}</div>
        </div>
    </div>`;
}

// Cor do 'bullet' do i-ésimo item da lista — casa com a rosca: itens 0..6 usam a
// paleta; do 8º em diante viram cinza, igual à fatia "Outros" da rosca.
function _corBreakdown(i, isDark) {
    const paleta = isDark ? KPI_BREAKDOWN_CORES.dark : KPI_BREAKDOWN_CORES.light;
    const cinza = isDark ? KPI_BREAKDOWN_CINZA.dark : KPI_BREAKDOWN_CINZA.light;
    return i < 7 ? paleta[i % paleta.length] : cinza;
}

// Seção única do modal de drill-down: rosca "Por Distrito Operacional" + lista de
// distritos onde cada linha expande para revelar os fiscais daquele distrito que
// estão com processos. Divulgação progressiva — a janela abre enxuta e o usuário
// abre distrito a distrito conforme analisa.
// `linhas` = processos já filtrados; `porDistrito` = pares [distrito, qtd] ordenados;
// `total` > 0 (o chamador trata o caso vazio antes de chegar aqui).
function _secaoDistritoComFiscais(linhas, porDistrito, total, isDark, infoDireita, SEM_DISTRITO, SEM_FISCAL) {
    const linhasHTML = porDistrito.map(([distrito, qtd], i) => {
        const cor = _corBreakdown(i, isDark);
        const pct = Math.round((qtd / total) * 1000) / 10;

        // Fiscais só deste distrito, na mesma classificação/ordem das demais quebras.
        // A regra "chave vazia -> rótulo padrão" tem que ser idêntica à de
        // `_classificarBreakdown` (senão a soma dos fiscais não fecha com `qtd`).
        const fiscaisDoDistrito = _classificarBreakdown(
            linhas.filter(d => (String(d.distritoOperacional || '').trim() || SEM_DISTRITO) === distrito),
            d => d.fiscal, SEM_FISCAL
        );
        // Mesma convenção do cabeçalho ("N distritos + sem distrito"): conta só os
        // fiscais nomeados e sinaliza "+ sem fiscal" à parte quando houver.
        const nFiscaisReais = fiscaisDoDistrito.filter(([n]) => n !== SEM_FISCAL).length;
        const temSemFiscal = fiscaisDoDistrito.some(([n]) => n === SEM_FISCAL);
        const rotuloFiscais = `${nFiscaisReais} ${nFiscaisReais === 1 ? 'fiscal' : 'fiscais'}`
            + (temSemFiscal ? ' + sem fiscal' : '');

        const subItens = fiscaisDoDistrito.map(([fisc, fq]) => {
            const fpct = Math.round((fq / qtd) * 1000) / 10;
            return `<div class="d-flex align-items-start justify-content-between py-1 gap-2" style="font-size:0.82rem;padding-left:1.9rem;">
                <span style="color:var(--text-heading);opacity:0.85;word-break:break-word;">${escapeHTML(fisc)}</span>
                <span class="fw-semibold" style="color:var(--text-heading);white-space:nowrap;">${fq} <span class="fw-normal" style="color:var(--text-muted);">(${fpct}%)</span></span>
            </div>`;
        }).join('');
        // Percentual do subitem é relativo ao distrito — o cabeçalho abaixo deixa isso explícito.
        const cabecalhoFiscais = `<div class="py-1" style="padding-left:1.9rem;font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.03em;">Fiscais neste distrito <span style="text-transform:none;letter-spacing:0;">(% relativo ao distrito)</span></div>`;

        const panelId = `kpiBreakdownDistrito-${i}`;
        return `<div class="kpi-distrito-row">
            <button type="button" class="kpi-distrito-toggle d-flex w-100 align-items-center justify-content-between gap-2 py-2 px-1"
                aria-expanded="false" aria-controls="${panelId}"
                onclick="_toggleDistritoBreakdown(this,'${panelId}')">
                <span class="d-flex align-items-center flex-wrap gap-2" style="min-width:0;flex:1;">
                    <i class="bi bi-chevron-right" aria-hidden="true" style="font-size:0.72rem;color:var(--text-muted);flex:none;transition:transform .15s;"></i>
                    <span style="width:10px;height:10px;border-radius:2px;background:${cor};flex:none;"></span>
                    <span style="color:var(--text-heading);font-weight:600;word-break:break-word;">${escapeHTML(distrito)}</span>
                    <span style="color:var(--text-muted);font-size:0.76rem;white-space:nowrap;">${rotuloFiscais}</span>
                </span>
                <span class="fw-bold" style="color:var(--text-heading);white-space:nowrap;">${qtd} <span class="fw-normal" style="color:var(--text-muted);">(${pct}%)</span></span>
            </button>
            <div id="${panelId}" hidden style="padding-bottom:0.45rem;">${subItens ? cabecalhoFiscais + subItens : '<div class="text-muted small py-1" style="padding-left:1.9rem;">Sem fiscais informados.</div>'}</div>
        </div>`;
    }).join('');

    return `
        <div class="d-flex align-items-baseline justify-content-between mb-3 gap-2">
            <span class="fw-bold" style="color:var(--text-heading);">Por Distrito Operacional</span>
            ${infoDireita ? `<span style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${escapeHTML(infoDireita)}</span>` : ''}
        </div>
        <div class="d-flex flex-column flex-sm-row align-items-start gap-4 mb-3">
            ${_roscaBreakdownSVG(porDistrito, total, isDark)}
            <div style="flex:1;min-width:0;width:100%;font-size:0.8rem;color:var(--text-muted);padding-top:0.4rem;">
                <i class="bi bi-info-circle me-1" aria-hidden="true"></i>Clique num distrito para ver os fiscais com processos naquele distrito.
                <div class="mt-1" style="font-size:0.74rem;">Distrito e fiscal aqui seguem quem respondeu pelo processo (troca de fiscal) — podem diferir do que aparece na linha desse processo na lista abaixo.</div>
            </div>
        </div>
        <div style="overflow-x:hidden;">${linhasHTML}</div>`;
}

// Expande/recolhe a lista de fiscais de um distrito no modal de drill-down.
function _toggleDistritoBreakdown(btn, panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const vaiAbrir = panel.hidden;
    panel.hidden = !vaiAbrir;
    btn.setAttribute('aria-expanded', String(vaiAbrir));
    const chevron = btn.querySelector('.bi-chevron-right');
    if (chevron) chevron.style.transform = vaiAbrir ? 'rotate(90deg)' : '';
}
window._toggleDistritoBreakdown = _toggleDistritoBreakdown;

// Estado do modal de drill-down entre re-renders (troca do filtro de status de
// meta sem reabrir o modal): linhas já recortadas por status + faixas de meta
// selecionadas nos chips (Set vazio = "Todas").
let _breakdownState = null;

// Chips de filtro por status de meta no topo do modal. Contagens fixas sobre o
// conjunto recortado por status (linhasBase), para o usuário saber o que cada
// chip rende independentemente do que já está selecionado. Quando há algum
// recorte ativo, sinaliza à direita quantos processos "Sem meta" ficam de fora
// (não têm chip próprio), para o total menor da rosca não confundir.
function _chipsMetaBreakdown(metas, linhasBase) {
    const cont = { 'Atrasado': 0, 'No prazo': 0, 'Sem meta': 0 };
    linhasBase.forEach(d => { const m = getMetaSt(d); if (cont[m] !== undefined) cont[m]++; });

    const chip = (valor, rotulo, extraCls) => {
        const ativo = metas.has(valor);
        return `<button type="button" class="kpi-meta-chip${extraCls ? ' ' + extraCls : ''}${ativo ? ' ativo' : ''}"
            data-meta="${escapeHTML(valor)}" aria-pressed="${ativo}" onclick="_toggleBreakdownMetaFiltro('${valor}')">${escapeHTML(rotulo)}<span class="kpi-meta-chip-n">${cont[valor]}</span></button>`;
    };
    const todasAtivo = metas.size === 0;
    const notaOcultos = (!todasAtivo && cont['Sem meta'] > 0)
        ? `<span style="color:var(--text-muted);font-size:0.75rem;">${cont['Sem meta']} sem meta (fora deste filtro)</span>`
        : '';
    return `<div class="d-flex flex-wrap align-items-center gap-2 mb-3" style="font-size:0.8rem;"
        role="group" aria-label="Filtrar por status da meta">
        <span style="color:var(--text-muted);">Status da meta:</span>
        <button type="button" class="kpi-meta-chip${todasAtivo ? ' ativo' : ''}" data-meta="Todas" aria-pressed="${todasAtivo}" onclick="_toggleBreakdownMetaFiltro('')">Todas<span class="kpi-meta-chip-n">${linhasBase.length}</span></button>
        ${chip('Atrasado', 'Atrasado', 'chip-atrasado')}
        ${chip('No prazo', 'No prazo', 'chip-prazo')}
        ${notaOcultos}
    </div>`;
}

// (Re)monta o corpo do modal de drill-down a partir de `_breakdownState`,
// aplicando o filtro de status de meta atual. Chamada na abertura e a cada
// clique nos chips.
function _renderBreakdownConteudo() {
    if (!_breakdownState) return;
    const { linhasBase, metas } = _breakdownState;
    const conteudo = document.getElementById('kpiBreakdownConteudo');

    if (linhasBase.length === 0) {
        conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-inbox fs-2 d-block mb-2"></i>Nenhum processo neste status.</div>`;
        return;
    }

    // Set vazio = "Todas" (nenhum recorte por meta).
    const linhas = metas.size === 0 ? linhasBase : linhasBase.filter(d => metas.has(getMetaSt(d)));
    const total = linhas.length;
    const chipsHTML = _chipsMetaBreakdown(metas, linhasBase);

    if (total === 0) {
        conteudo.innerHTML = chipsHTML
            + `<div class="text-center text-muted py-4"><i class="bi bi-inbox fs-2 d-block mb-2"></i>Nenhum processo com esse filtro de meta.</div>`;
        return;
    }

    const isDark = document.body.classList.contains('theme-dark');
    const SEM_FISCAL = "Não informado";
    const SEM_DISTRITO = "Sem distrito operacional";
    const porDistrito = _classificarBreakdown(linhas, d => d.distritoOperacional, SEM_DISTRITO);
    const nDistritos = porDistrito.filter(([n]) => n !== SEM_DISTRITO).length;
    const temSemDistrito = porDistrito.some(([n]) => n === SEM_DISTRITO);
    const infoDistritos = `${nDistritos} distrito${nDistritos === 1 ? '' : 's'}`
        + (temSemDistrito ? ' + sem distrito' : '');

    conteudo.innerHTML = chipsHTML
        + _secaoDistritoComFiscais(linhas, porDistrito, total, isDark, infoDistritos, SEM_DISTRITO, SEM_FISCAL);
}

// Liga/desliga uma faixa de meta nos chips do modal. `valor` vazio = "Todas"
// (limpa o recorte). "Atrasado" e "No prazo" são independentes (dá pra ver as
// duas juntas, ou só uma). Sem nenhuma marcada, volta a "Todas".
function _toggleBreakdownMetaFiltro(valor) {
    if (!_breakdownState) return;
    const metas = _breakdownState.metas;
    if (valor === '') metas.clear();
    else if (metas.has(valor)) metas.delete(valor);
    else metas.add(valor);
    _renderBreakdownConteudo();
    // O innerHTML foi reconstruído, então o chip clicado foi recriado — devolve o
    // foco ao equivalente para não jogar o teclado pro topo do documento.
    const conteudo = document.getElementById('kpiBreakdownConteudo');
    const alvo = conteudo && conteudo.querySelector(`.kpi-meta-chip[data-meta="${valor === '' ? 'Todas' : valor}"]`);
    if (alvo) alvo.focus();
}
window._toggleBreakdownMetaFiltro = _toggleBreakdownMetaFiltro;

// Abre o modal de drill-down ao clicar num dos cards de KPI da aba Processos.
// Abre enxuto: só a quebra por Distrito Operacional (replanilhamentos), com
// TODOS os processos do status. Cada distrito expande, ao clique, para mostrar
// os fiscais daquele distrito. Os chips no topo permitem recortar por status de
// meta (Atrasado / No prazo) sem fechar o modal.
// `statusFiltro`: null = todas as linhas visíveis; string = um status; array =
// vários status (ex.: card "Processos Fiscalização" = ANÁLISE + REANÁLISE FISCAL).
//
// E7 (fonte única com o painel de desempenho dos fiscais, 2026-09-18): o CONJUNTO
// de linhas continua sendo o que a tela já filtrou (busca, aba, meta, prioritário —
// `window.currentVisibleRows`, "Filtrado na tela" no card) — isso não muda. O que
// muda é DE ONDE vem o distrito e o fiscal de cada linha: antes liam direto
// `processos.distrito_operacional`/`processos.fiscal` (o fiscal ATUAL, mesmo que já
// tenha passado o processo pra outra pessoa); agora vêm de
// `vw_painel_desempenho_fiscais` — mesma fonte do painel do mapa, mesma definição de
// "quem responde pelo processo" (troca de fiscal) e de distrito da obra (com fallback
// pra contratos_edificacao). Sem isso, as duas telas podiam contar pessoas diferentes
// pro mesmo processo. A view é restrita a admin/gerente (RLS fail-closed) — quem não
// tem acesso recebe zero linhas da consulta, tratado abaixo; o clique nem chega a
// disparar essa consulta pra quem já sabemos ser fiscal (ver `.fiscal-no-breakdown`
// em core/auth.js e index.html — a interface não oferece o que o banco vai negar).
// Id da chamada em voo — incrementado a cada clique. Um clique mais recente (no
// mesmo card ou noutro) invalida a resposta de qualquer chamada anterior que ainda
// não tenha voltado: sem isso, uma resposta mais lenta podia sobrescrever o
// conteúdo com os dados de OUTRO card depois que o título já tinha mudado pro card
// novo — título e corpo do modal dessincronizados (achado do rev-aderencia, E7).
let _breakdownReqId = 0;
async function abrirBreakdownFiscal(statusFiltro, titulo, iconClass) {
    const meuReqId = ++_breakdownReqId;
    const todasLinhas = window.currentVisibleRows || [];
    const alvos = statusFiltro == null ? null
        : (Array.isArray(statusFiltro) ? statusFiltro : [statusFiltro]).map(s => String(s).toUpperCase());
    const linhasFiltro = alvos
        ? todasLinhas.filter(d => alvos.includes((d.status || "").toUpperCase()))
        : todasLinhas;

    const titleEl = document.getElementById('kpiBreakdownTitulo');
    titleEl.innerHTML = `<i class="bi ${iconClass || 'bi-pie-chart'} me-2"></i>${escapeHTML(titulo)}`;

    const modalEl = document.getElementById('modalKpiBreakdown');
    // O HTML deste projeto tem divs não fechadas em vários trechos, o que faz
    // modais definidos mais abaixo no arquivo herdarem um ancestral errado
    // (às vezes um outro .modal com display:none, colapsando para 0x0). O
    // mesmo padrão de correção já é usado em outros modais do sistema.
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
    const conteudo = document.getElementById('kpiBreakdownConteudo');
    // A consulta à view é de rede — o modal abre já mostrando que está carregando
    // em vez de ficar mudo até a resposta chegar.
    conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-hourglass-split fs-2 d-block mb-2"></i>Carregando…</div>`;
    new bootstrap.Modal(modalEl).show();

    if (linhasFiltro.length === 0) {
        _breakdownState = { linhasBase: linhasFiltro, metas: new Set() };
        _renderBreakdownConteudo();
        return;
    }

    const ids = linhasFiltro.map(d => d.id).filter(id => id != null);

    // Sem o try/catch, uma falha de rede deixava o modal parado em "Carregando…" para
    // sempre. Agora a exceção vira a mesma mensagem de erro do caminho `{ error }`.
    // — 22/09/2026
    let data = null, error = null;
    try {
        const res = await sbClient
            .from('vw_painel_desempenho_fiscais')
            .select('id, obra_distrito_operacional, fiscal_nome')
            .in('id', ids);
        data = res.data;
        error = res.error;
    } catch (e) {
        error = { message: (e && e.message) ? e.message : String(e) };
    }

    if (meuReqId !== _breakdownReqId) return; // outro clique já assumiu a tela — descarta esta resposta

    if (error) {
        console.error('[abrirBreakdownFiscal] erro ao consultar vw_painel_desempenho_fiscais:', error.message);
        conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-exclamation-triangle fs-2 d-block mb-2"></i>Não foi possível carregar o distrito/fiscal agora. Tente de novo em alguns instantes.</div>`;
        return;
    }

    if (data.length === 0) {
        // RLS fail-closed avalia o papel pra CONSULTA INTEIRA (meu_papel() no WHERE),
        // nunca linha a linha — então zero linhas quase sempre é "sem acesso". Mas há
        // uma segunda forma de bater zero, sem ser permissão: a tela filtra exclusão
        // só por texto de status, a view filtra por `excluido_por` (colunas
        // diferentes, cabeçalho do sql/create_vw_painel_desempenho_fiscais.sql admite
        // legado onde discordam) — um recorte de status que calhe de conter só
        // processos nesse legado bateria zero mesmo pra quem tem acesso pleno
        // (achado do rev-correcao). Uma sonda sem filtro de id decide: se a view
        // devolve QUALQUER linha pra este usuário, ele tem acesso — só estes ids
        // específicos não bateram, e o motivo é dado, não permissão.
        // Mesmo motivo do try/catch acima: exceção de rede deixaria o modal em "Carregando…".
        let sonda = null, erroSonda = null;
        try {
            const res = await sbClient
                .from('vw_painel_desempenho_fiscais')
                .select('id')
                .limit(1);
            sonda = res.data;
            erroSonda = res.error;
        } catch (e) {
            erroSonda = { message: (e && e.message) ? e.message : String(e) };
        }
        if (meuReqId !== _breakdownReqId) return;

        if (erroSonda) {
            // Falha de rede na sonda não é a mesma coisa que "sem acesso" — não
            // confunde as duas (observação do rev-correcao na revisão da E7).
            console.error('[abrirBreakdownFiscal] erro na sonda de acesso a vw_painel_desempenho_fiscais:', erroSonda.message);
            conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-exclamation-triangle fs-2 d-block mb-2"></i>Não foi possível carregar o distrito/fiscal agora. Tente de novo em alguns instantes.</div>`;
            return;
        }
        if (sonda && sonda.length > 0) {
            // Tem acesso — marca como não confirmado em vez de fingir que são
            // "Não informado" (que soaria como dado real de que não há fiscal/
            // distrito) ou de reaparecer com o valor antigo da tabela em silêncio.
            _breakdownState = {
                linhasBase: linhasFiltro.map(d => ({ ...d, distritoOperacional: "Distrito não confirmado", fiscal: "Fiscal não confirmado" })),
                metas: new Set()
            };
            _renderBreakdownConteudo();
            return;
        }
        conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-lock fs-2 d-block mb-2"></i>Você não tem acesso a esta visão por distrito/fiscal.</div>`;
        return;
    }

    const porId = new Map(data.map(r => [r.id, r]));
    const linhas = linhasFiltro.map(d => {
        const v = porId.get(d.id);
        if (!v) {
            // Mesmo descompasso de exclusão do bloco acima, agora só pra ALGUNS ids
            // do recorte, não todos. Marca como não confirmado em vez de manter o
            // valor antigo (processos.distrito_operacional/processos.fiscal) —
            // misturar fonte antiga e fonte nova na mesma lista, em silêncio, é
            // exatamente o problema que a E7 existe pra evitar (achado do
            // rev-correcao). Vira um grupo próprio, contável, na quebra.
            return { ...d, distritoOperacional: "Distrito não confirmado", fiscal: "Fiscal não confirmado" };
        }
        // A view usa '(sem fiscal)' como sentinela de "sem ninguém respondendo" —
        // diferente do sentinela local ("Não informado") que _classificarBreakdown
        // já usa pra agrupar a barra "sem fiscal" do resto da tela. Sem esta troca,
        // "(sem fiscal)" virava um nome de pessoa a mais na lista, em vez de cair
        // no mesmo grupo "Não informado" dos demais.
        const fiscalNome = (v.fiscal_nome && v.fiscal_nome !== '(sem fiscal)') ? v.fiscal_nome : "Não informado";
        return { ...d, distritoOperacional: v.obra_distrito_operacional || null, fiscal: fiscalNome };
    });

    _breakdownState = { linhasBase: linhas, metas: new Set() };
    _renderBreakdownConteudo();
}
window.abrirBreakdownFiscal = abrirBreakdownFiscal;

function updateReuniaoFilters(rows) { mtBase = rows; updateReuniao(); }

function updateReuniao() {
    if (window.isResettingFilters) return; // Evita loop de re-render ao resetar filtros
    if (!mt.body) return;
    _renderReuniaoEmAndamento = true;
    try {
        _updateReuniaoInterno();
    } finally {
        _renderReuniaoEmAndamento = false;
    }
}

function _updateReuniaoInterno() {
    const uRole = (sessionStorage.getItem('sop_role') || "").toLowerCase();

    // Prioriza sop_fiscal_name (derivado do email) sobre sop_user_name
    let uName = (sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || "").toUpperCase().trim();

    // `fs` só é usado dentro do if logo abaixo — construir e ordenar a lista de fiscais a
    // cada render, para descartá-la na maioria das vezes, era trabalho puro. — 22/09/2026
    if (mt.fiscal.options.length <= 1) {
        const fs = Array.from(new Set(mtBase.map(d => d.fiscal).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        fillSelect(mt.fiscal, fs);
    }
    let rows = mtBase.slice();

    // [PAGINAÇÃO] Filtro por Aba (Ativos vs Aprovados vs Arquivados)
    if (!window.currentProcessesTab) window.currentProcessesTab = 'ativos';

    // Com busca textual ativa, ignora a paginação por aba e busca em todas as páginas
    const isGlobalSearch = mt.search.value.trim().length > 0;

    if (!isGlobalSearch) {
        rows = rows.filter(d => {
            const st = (d.status || "").toUpperCase().trim();
            const isAprovado = st.includes("APROVADO") || st === "SEDUC";
            const isArquivado = st.includes("ARQUIVADO");

            if (window.currentProcessesTab === 'ativos') return !isAprovado && !isArquivado;
            if (window.currentProcessesTab === 'aprovados') {
                if (window.filtroSomenteAlertaDiligencia) return isAprovado && !!d.alerta_pre_diligencia;
                return isAprovado;
            }
            if (window.currentProcessesTab === 'arquivados') return isArquivado;
            return true;
        });
    }

    // Fase 5: Fiscal com a autorização especial "processos_ver_todos" concedida
    // pelo Admin pula o recorte por vínculo — vê todos os processos e o filtro
    // por fiscal aparece pra ele, igual admin/gerente/externo (cai no `else`).
    const fiscalRestrito = uRole === 'fiscal'
        && !(typeof temAutorizacao === 'function' && temAutorizacao('processos_ver_todos'));

    if (fiscalRestrito) {
        // Plano de permissões por papel (Fase 3): prioriza o vínculo por matrícula
        // (processos.fiscal_matricula <-> app_users.matricula), mais confiável que
        // comparar nome — mas só quando os DOIS lados têm matrícula preenchida.
        // Nem todo processo tem fiscal_matricula gravado ainda (achado do usuário
        // ao aprovar esta troca): quando falta de um dos lados, cai de volta pro
        // casamento por nome de sempre, pra não esconder processos de quem só
        // tem o vínculo antigo (por nome).
        // Revisão 22/09/2026 — a matrícula NORMALIZADA (`normalizarMatriculaFiscal`, que
        // descarta ponto/hífen/barra/espaço) é a única chave de decisão. Antes, este filtro
        // usava `.trim().toUpperCase()` cru, uma terceira normalização diferente da do resto
        // do arquivo, e um casamento por nome nos dois sentidos que sobrava: um fiscal
        // "ANA SOUSA LIMA" enxergava tudo que era de "ANA SOUSA". O sentido reverso saiu.
        //
        // IMPORTANTE: este filtro NÃO é a fronteira de segurança — quem decide é a política
        // `processos_select` no banco, que só entrega ao fiscal as linhas com a matrícula
        // dele ou sem matrícula nenhuma. Aqui é só apresentação. Por isso, quando o vínculo
        // é reconhecido por um caminho que não a matrícula, o processo APARECE com aviso, em
        // vez de sumir calado — sumir sem avisar foi o defeito que motivou esta correção.
        const uMatriculaRaw = (sessionStorage.getItem('sop_matricula') || '').trim();
        const uMatricula = normalizarMatriculaFiscal(uMatriculaRaw);
        const nameParts = uName.trim().split(/[\s\.\-]+/).filter(p => p.length > 0);
        const nomeBateCom = (nomeDoProcesso) => nomeDoProcesso
            && (nomeDoProcesso === uName || nameParts.every(part => nomeDoProcesso.includes(part)));

        rows = rows.filter(d => {
            const dFiscal = (d.fiscal || "").toUpperCase().trim();
            const dFiscalNormalizado = dFiscal.replace(/[\.\-]+/g, ' ').trim();
            const dMatricula = normalizarMatriculaFiscal(d.fiscalMatricula);

            // Limpa a marca da rodada anterior — este filtro roda a cada re-render.
            d.vinculoFiscalAviso = null;

            if (uMatricula && dMatricula) {
                if (dMatricula === uMatricula) return true;
                // Matrícula não confere. Se o nome confere, o cadastro está dessincronizado
                // e o processo é mesmo deste fiscal: mostra e explica, não esconde.
                if (nomeBateCom(dFiscalNormalizado)) {
                    d.vinculoFiscalAviso = `A matrícula gravada neste processo (${d.fiscalMatricula}) não confere com a sua (${uMatriculaRaw}). `
                        + `O vínculo foi reconhecido pelo seu nome. Peça ao administrador para acertar o cadastro.`;
                    return true;
                }
                return false;
            }

            // Processo sem matrícula de fiscal gravada (legado). O vínculo só pode ser pelo
            // nome; sinaliza para que o cadastro seja completado.
            if (nomeBateCom(dFiscalNormalizado)) {
                d.vinculoFiscalAviso = 'Este processo não tem a matrícula do fiscal gravada; o vínculo foi reconhecido pelo nome. '
                    + 'Peça ao administrador para gravar a matrícula.';
                return true;
            }
            return false;
        });

        const comAviso = rows.filter(d => d.vinculoFiscalAviso).length;
        if (comAviso > 0) {
            console.warn(`[permissões] ${comAviso} processo(s) vinculados a você pelo nome, não pela matrícula. `
                + `Veja o aviso ⚠ ao lado do nome do fiscal em cada linha.`);
        }
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
    // Card "Processos Fiscalização": consolida ANÁLISE FISCAL + REANÁLISE FISCAL.
    document.getElementById("card_proc_andamento").textContent = rows.filter(d => {
        const s = (d.status || "").toUpperCase();
        return s === "ANÁLISE FISCAL" || s === "DEVOLVIDO P/ REANÁLISE FISCAL";
    }).length;
    document.getElementById("card_proc_aprovados").textContent = rows.filter(d => (d.status || "").toUpperCase() === "ANÁLISE FISCAL").length;
    document.getElementById("card_proc_dias").textContent = rows.filter(d => (d.status || "").toUpperCase() === "DEVOLVIDO P/ REANÁLISE FISCAL").length;

    const btnExport = document.getElementById("btn-reuniao-export");
    if (btnExport) {
        btnExport.disabled = rows.length === 0;
        btnExport.title = rows.length === 0 ? "Nada para exportar" : "Exportar tudo do resultado filtrado para Excel";
    }
    window.currentVisibleRows = rows; // Armazena globalmente para exportação

    const columns = [
        { title: "Ações", width: "50px", key: null, align: "center" }, { title: "Prior.", width: "80px", key: "prioritario", align: "center" }, { title: "Processo", width: "200px", key: "processo", align: "start" }, { title: "Meta", width: "110px", key: "meta", align: "center" },
        { title: "Status", width: "146px", key: "status", align: "center" }, { title: "Suíte", width: "146px", key: null, align: "center" }, { title: "Analista", width: "100px", key: "analista", align: "center" }, { title: "Abertura", width: "100px", key: "abertura", align: "center" },
        { title: "Contratada", width: "100px", key: "contratada", align: "start" }, { title: "Descrição", width: "auto", key: "descricao", align: "start" }
    ];
    const thead = document.querySelector("#pane-reuniao table thead");
    let headerHTML = "<tr>";
    columns.forEach(col => {
        if (col.key) { headerHTML += `<th style="width: ${col.width}; cursor: pointer; user-select: none;" onclick="changeSort('${col.key}')" class="text-${col.align}"><div class="d-flex align-items-center justify-content-${col.align === 'center' ? 'center' : 'start'}">${col.title} ${getSortIcon(col.key)}</div></th>`; }
        else { headerHTML += `<th class="text-${col.align}" style="width: ${col.width};">${col.title}</th>`; }
    });
    headerHTML += "</tr>";
    // Só reescreve o thead quando o HTML muda de fato (ex.: seta de ordenação) — updateReuniao()
    // roda a cada filtro/busca/refresh, e o cabeçalho quase sempre é idêntico ao anterior.
    if (thead.innerHTML !== headerHTML) thead.innerHTML = headerHTML;

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
                case 'status': valA = statusPriority(a.status); valB = statusPriority(b.status); break;
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

    // Contagem de processos por grupo de status, para exibir no cabeçalho de cada bloco
    const statusGroupCounts = {};
    rows.forEach(d => {
        const label = formatStatusDisplay(d.status) || "SEM STATUS";
        statusGroupCounts[label] = (statusGroupCounts[label] || 0) + 1;
    });
    let lastStatusGroup = null;
    const groupedHTML = [];

    // Cor de destaque do cabeçalho de grupo, na mesma família de cor do badge de status da linha
    // — tons mais escuros/dessaturados que os do badge, para não pesar visualmente
    const groupAccentColor = {
        "badge-status-devolvido": "#a33a44",
        "badge-status-diligencia": "#a33a44",
        "badge-status-light-blue": "#3d68a3",
        "badge-status-em-reanalise": "#3f7d5c",
        "badge-status-em-analise": "#a1801f",
        "badge-status-aguar-reanalise": "#a1801f",
        "badge-status-fiscal": "#6c757d",
        "badge-status-dark-blue": "#3d68a3",
        "badge-status-aprovado": "#3f7d5c",
        "badge-status-contratante": "#8a9200",
        "badge-status-arquivado": "#7c8ba1",
    };
    // Fundo do cabeçalho: tingimento translúcido bem suave da cor de destaque, para se
    // diferenciar do fundo da tabela sem competir visualmente com o conteúdo das linhas
    const groupBgColor = {
        "badge-status-devolvido": "rgba(163, 58, 68, 0.10)",
        "badge-status-diligencia": "rgba(163, 58, 68, 0.10)",
        "badge-status-light-blue": "rgba(61, 104, 163, 0.10)",
        "badge-status-em-reanalise": "rgba(63, 125, 92, 0.10)",
        "badge-status-em-analise": "rgba(161, 128, 31, 0.10)",
        "badge-status-aguar-reanalise": "rgba(161, 128, 31, 0.10)",
        "badge-status-fiscal": "rgba(108, 117, 125, 0.10)",
        "badge-status-dark-blue": "rgba(61, 104, 163, 0.10)",
        "badge-status-aprovado": "rgba(63, 125, 92, 0.10)",
        "badge-status-contratante": "rgba(138, 146, 0, 0.10)",
        "badge-status-arquivado": "rgba(124, 139, 161, 0.10)",
    };
    // Fundo das próprias linhas do grupo: um único tom neutro para todas, independente
    // do status — só o cabeçalho de cada bloco carrega a cor de destaque
    const groupRowBgColor = "rgba(255, 255, 255, 0.035)";

    // Fora do laço de propósito: a permissão não muda de linha para linha, e temAutorizacao()
    // faz um JSON.parse por chamada — dentro do forEach isso era um parse por processo.
    const podeVerDetalhes = canSeeProcessActions();

    rows.forEach(d => {
        const mIso = getMetaDate(d)?.toISOString().substring(0, 10) || "";
        const mSt = getMetaSt(d);
        let mCls = "badge-meta-sem";
        if (mSt === "Cumprido") mCls = "badge-meta-cumprido";
        else if (mSt === "No prazo") mCls = "badge-meta-prazo";
        else if (mSt === "Atrasado") mCls = "badge-meta-atrasado";

        // Revisão 22/09/2026 — aqui existia uma cópia byte-a-byte da cascata de
        // `classeBadgeStatus()`, com um detalhe divergente: o padrão era "text-bg-light" nesta
        // cópia e "" na função. Duas implementações da mesma regra que precisavam ser editadas
        // juntas; agora a função é a fonte única, e o padrão fica explícito aqui.
        const stTxt = (d.status || "").toString().toUpperCase().trim();
        const stCls = classeBadgeStatus(stTxt) || "text-bg-light";

        // Cabeçalho de grupo: insere uma linha divisória sempre que o status muda,
        // mantendo a ordenação já aplicada (mesma regra de data de abertura dentro do grupo)
        const statusGroupLabel = formatStatusDisplay(d.status) || "SEM STATUS";
        if (statusGroupLabel !== lastStatusGroup) {
            const accentColor = groupAccentColor[stCls] || "#94a3b8";
            const bgColor = groupBgColor[stCls] || "rgba(148, 163, 184, 0.16)";
            groupedHTML.push(`
        <tr class="tr-status-group-header">
            <td colspan="${columns.length}" style="background: ${bgColor}; padding: 9px 16px; border-top: 1px solid var(--sop-slate-200, #e2e8f0); border-left: 4px solid ${accentColor};">
                <span class="d-inline-flex align-items-center" style="gap: 7px;">
                    <span style="width: 7px; height: 7px; border-radius: 50%; background: ${accentColor}; flex-shrink: 0;"></span>
                    <span class="text-uppercase" style="font-size: 0.76rem; font-weight: 700; letter-spacing: 0.04em; color: var(--text-heading);">${escapeHTML(statusGroupLabel)}</span>
                    <span class="text-muted" style="font-size: 0.74rem; font-weight: 500;">${statusGroupCounts[statusGroupLabel]} processo${statusGroupCounts[statusGroupLabel] === 1 ? '' : 's'}</span>
                </span>
            </td>
        </tr>`);
            lastStatusGroup = statusGroupLabel;
        }

        const abert = dateParaInput(d.dataAbertura);
        const dias = (d.dataAbertura instanceof Date) ? Math.floor((new Date() - d.dataAbertura) / (1000 * 60 * 60 * 24)) : "";
        const fiscalNome = (d.fiscal || "").toUpperCase();

        // Aviso de vínculo reconhecido por nome em vez de matrícula (ver o filtro do papel
        // 'fiscal', acima). Só aparece para quem caiu nesse caso, e só para quem enxerga a
        // lista restrita — ou seja, o papel 'fiscal', inclusive quando ele tem a autorização
        // `processos_gravar`. Admin e gerente nunca veem.
        const avisoVinculoHTML = d.vinculoFiscalAviso
            ? `<i class="bi bi-exclamation-triangle-fill ms-1" style="color: var(--sop-orange);" title="${escapeHTML(d.vinculoFiscalAviso)}"></i>`
            : '';

        // Preparar botões de ação para evitar aninhamento de template strings.
        // Era uma terceira cópia literal da regra de quem vê as ações (as outras duas estavam em
        // canSeeProcessActions e nas funções novas de permissão). Passou a ler da fonte única em
        // core/auth.js — três cópias da mesma regra de acesso só podem divergir com o tempo, e
        // foi divergência assim que gerou os achados desta revisão. — 22/09/2026
        //
        // `canSeeProcessActions()` e não `podeEditarProcesso()` de propósito: quem tem a
        // autorização especial `processos_gravar` abre o modal em leitura. São regras diferentes
        // desde 18/09/2026 — ver podeGravarProcessos() em core/auth.js.
        const canEdit = podeVerDetalhes;
        const btnDetalhes = canEdit ? `<button class="btn btn-sm btn-light border" onclick="abrirDetalhes('${escapeHTML(d.processo)}')" title="Ver detalhes"><i class="bi bi-eye-fill" style="color: var(--sop-blue);"></i></button>` : '';

        // Link para o SUITE (NUP apenas números para evitar 404).
        // A ordem importa: `escapeHTML` primeiro transformava ' em &#39;, e o 39 SOBREVIVIA ao
        // replace(/\D/g,''), entrando no meio do NUP e gerando uma URL corrompida. Tirar os
        // não-dígitos já deixa a string segura para interpolar. — 22/09/2026
        const nupLimpo = String(d.processo || '').replace(/\D/g, '');
        const btnSuite = `<a href="https://suite.ce.gov.br/consultar-processo/${nupLimpo}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-light border" title="Abrir no SUITE"><i class="bi bi-box-arrow-up-right" style="color: var(--sop-green);"></i></a>`;

        // Lógica da Meta
        const metaOnclick = `window.abrirModalMeta('${escapeHTML(d.processo)}', '${mIso}')`;
        const metaStyle = 'cursor: pointer;';

        // Iniciais do Analista para o avatar circular
        const analistaIniciais = (d.analista || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || "-";

        // Alerta de pré-diligência: aprovado, mas já sinalizado (varredura anterior) tramitando
        // em setor de risco (DIFOR/GEFOE/DIRED/GEDOP) — ver isSetorRiscoDiligencia()
        const temAlertaDiligencia = !!(d.alerta_pre_diligencia || d.alerta_retorno_resolvido);
        const alertaIconeHTML = temAlertaDiligencia ? montarAlertaIconeHTML(d) : '';
        groupedHTML.push(`
        <tr style="vertical-align: middle; --bs-table-bg: ${groupRowBgColor};" data-numero="${escapeHTML(d.processo)}" class="tr-processo-row${d.alerta_pre_diligencia ? ' tr-alerta-pre-diligencia' : ''}">
            <td class="text-center">
                <div class="d-flex flex-column gap-1 align-items-center">
                    ${btnDetalhes}
                    ${btnSuite}
                </div>
            </td>
            <td class="text-center"><i class="bi ${isPrioritario(d) ? 'bi-star-fill' : 'bi-star'} proc-star-prioritario" data-proc="${escapeHTML(d.processo)}" style="color: ${isPrioritario(d) ? 'var(--sop-orange)' : 'var(--sop-slate-200)'}; font-size: 1.1rem; cursor: ${uRole === 'admin' ? 'pointer' : 'not-allowed'};" title="${uRole === 'admin' ? (isPrioritario(d) ? 'Remover prioridade' : 'Marcar como prioritário') : 'Você não tem permissão'}"></i></td>
            <td><div style="font-weight: 700; font-size: 1rem; color: var(--text-heading); white-space: nowrap;">${escapeHTML(d.processo)}</div><div class="mt-1" style="font-size: 0.76rem; color: var(--sop-slate-700); line-height: 1.4;"><i class="bi bi-person-fill me-1"></i>${escapeHTML(fiscalNome)}${avisoVinculoHTML}</div></td>
            <td class="text-center">
                <div class="mb-1"><span class="badge rounded-pill ${mCls} badge-meta-size">${mSt}</span></div>
                <div style="font-size: 0.74rem; color: var(--sop-blue); white-space: nowrap; text-align: center; ${metaStyle}" onclick="${metaOnclick}" title="${uRole === 'admin' ? 'Alterar Meta' : 'Você não tem permissão'}">
                    <i class="bi bi-calendar-event me-1"></i>${mIso ? mIso.split('-').reverse().join('/') : "Definir"}
                </div>
            </td>
            <td class="text-center">
                <div style="white-space: nowrap;"><span class="badge rounded-pill ${stCls} badge-custom-size">${escapeHTML(formatStatusDisplay(d.status))}</span><span class="alerta-icone" style="${temAlertaDiligencia ? '' : 'display:none;'}">${alertaIconeHTML}</span></div>
                <div class=\"mt-1 text-muted px-1\" style=\"font-size: 0.7rem; font-weight: 500; height: 1.1rem;\"></div>
            </td>
            <td class="suite-cell text-center">
                <div class="suite-badge-container"><span class="badge rounded-pill bg-light text-dark border badge-custom-size"><i class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></i>Consultando</span></div>
                <div class="mt-1 text-muted px-1 suite-time-container" style="font-size: 0.74rem; font-weight: 500; display: none;"><i class="bi bi-clock-history me-1"></i><span class="suite-time-text"></span></div>
            </td>
            <td class="text-center"><div class="proc-avatar" title="${escapeHTML(d.analista || "Não atribuído")}">${analistaIniciais}</div></td>
            <td class="text-center">
                <div style="font-weight: 400; font-size: 0.85rem; color: var(--text-heading);">${abert}</div>
                <div class="mt-1 text-muted" style="font-size: 0.74rem; font-weight: 500;"><i class="bi bi-calendar3 me-1"></i>${dias} dias</div>
            </td>
            <td style="max-width: 200px; font-size: 0.82rem; color: var(--sop-slate-700); line-height: 1.4;">${escapeHTML(d.contratada)}</td>
            <td style="max-width: 280px; font-size: 0.82rem; color: var(--sop-slate-700); line-height: 1.4; text-align: justify;">${escapeHTML(d.descricao)}</td>
        </tr>`);
    });
    mt.body.innerHTML = groupedHTML.join("");

    // SweetAlert para definir Meta
    window.abrirModalMeta = async function (processo, dataAtual) {
        const isAdmin = canMarkDateAsMeta();

        let historicoHTML = '';
        try {
            // Revisão 22/09/2026 — aqui havia uma ida à rede só para descobrir o `id` do
            // processo, que já está carregado em window.allData (e era buscado localmente duas
            // linhas abaixo, no `pRow`). Uma viagem de rede por abertura do modal de meta, à
            // toa. Agora o id sai do próprio objeto em memória.
            const pRow = (window.allData || []).find(r => r.processo === processo);
            const processoId = pRow ? pRow.id : null;
            if (processoId) {
                const { data: rawHistorico } = await sbClient
                    .from('historico_metas')
                    .select('*')
                    .eq('processo_id', processoId)
                    .order('registros', { ascending: false });

                const historico = [];
                if (rawHistorico) {
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
                    // PERFORMANCE: pRow não depende de `h` — é o mesmo processo para toda
                    // linha do histórico, então é calculado 1x aqui em vez de refazer o
                    // find() em window.allData a cada iteração do .map() abaixo.
                    const pRowHistorico = (window.allData || []).find(r => r.processo === processo);
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
                        const pRow = pRowHistorico;
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
                                const baseIso = estDate ? (new Date(estDate)).toISOString().substring(0, 10) : null;
                                const baseDateObj = baseIso ? isoParaDate(baseIso) : null;
                                if (baseDateObj && diasVal !== null && !isNaN(diasVal)) {
                                    const computed = calcularDataMeta(baseDateObj, diasVal);
                                    if (computed) metaVal = computed.toISOString().substring(0, 10);
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
                                                    <td class="fw-semibold">${escapeHTML(autor)}</td>
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
            title: `<div style="font-size: 1.3rem; font-weight: 700; color: #1B5E20; display: flex; align-items: center;"><i class="bi bi-calendar-check text-success me-2" style="font-size: 1.5rem;"></i> ${isAdmin ? 'Definir Meta' : 'Visualizar Meta'}</div><div style="font-size: 0.9rem; color: #666; margin-top: 6px; font-weight: 500;">Processo: <span class="text-dark fw-bold">${escapeHTML(processo)}</span></div>`,
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

    // Event listener para o ícone de estrela (prioritário) — somente admin pode alterar
    if (uRole === 'admin') {
        mt.body.querySelectorAll('.proc-star-prioritario').forEach(star => star.addEventListener('click', (e) => {
            const target = e.currentTarget;
            const processo = target.dataset.proc;
            const novoValor = !target.classList.contains('bi-star-fill');
            setPrioritario(processo, novoValor);
            updateReuniao();
        }));
    }

    // Buscar status do SUITE e atualizar UI
    atualizarTabelaSuite(rows);
}

// Zero chamadas à Edge Function: renderiza a partir dos dados já vindos da tabela `processos`.
function atualizarTabelaSuite(rows) {
    if (!rows || rows.length === 0) return;

    const trPorNumero = new Map();
    document.querySelectorAll('tr[data-numero]').forEach(tr => {
        trPorNumero.set(tr.getAttribute('data-numero'), tr);
    });

    rows.forEach(d => {
        // Mesmo caso do querySelector lá em cima: o Map é indexado pelo valor DECODIFICADO
        // que o navegador devolve em getAttribute, então re-escapar aqui só fazia a busca
        // devolver undefined em silêncio para NUPs com caractere especial. — 22/09/2026
        const tr = trPorNumero.get(d.processo);
        if (!tr) return;

        const suiteCell = tr.querySelector('.suite-badge-container');
        const suiteTime = tr.querySelector('.suite-time-container');
        const suiteTimeText = tr.querySelector('.suite-time-text');
        const alertaIcone = tr.querySelector('.alerta-icone');
        const stTxt = (d.status || "").toUpperCase();
        const sigla = d.suite ? String(d.suite).toUpperCase().trim() : null;

        if (!sigla) {
            suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-muted border badge-custom-size">—</span>`;
            return;
        }

        suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-dark border badge-custom-size" style="background-color:#f8f9fa !important;color:#212529 !important;">${escapeHTML(sigla)}</span>`;

        if (d.suite_data_chegada) {
            const diffDays = Math.floor((Date.now() - new Date(d.suite_data_chegada).getTime()) / 86400000);
            suiteTimeText.textContent = diffDays > 0 ? `${diffDays} dia${diffDays > 1 ? 's' : ''}` : "Hoje";
            suiteTime.style.display = 'block';

            const ehFiscal = stTxt.includes('ANÁLISE FISCAL') || stTxt.includes('REANÁLISE FISCAL');
            if (['GECOPE', 'GECOP'].includes(sigla) && ehFiscal) {
                tr.classList.add('tr-alerta-fiscal');
                suiteTime.innerHTML += ` <span class="badge-tramitado-pulse">Tramitado</span>`;
            }
        }
        // Independente de haver data de chegada registrada: o alerta de pré-diligência
        // (usado também por varrerRiscoDiligenciaSegundoPlano, que chama isso sem essa
        // guarda) depende só de status/sigla, nunca de suite_data_chegada. Mantê-lo preso
        // ao "if" acima fazia o ícone/contagem da aba Aprovados sumir sempre que a tabela
        // `processos` ainda não tinha a data de chegada preenchida para aquele processo.
        // adiarBadge = true: o contador é atualizado uma vez só, depois do laço — antes ele
        // varria window.allData a cada linha, e ainda podia disparar um novo render no meio
        // deste (ver `_renderReuniaoEmAndamento`).
        aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, stTxt, true);
    });

    atualizarBadgeAbaAprovados();
}

function fillCommonStatusFilters() {
    try {
        const statuses = Array.from(new Set((window.allData || []).map(d => d.status))).filter(v => v);
        if (typeof fillSelect === 'function') {
            if (mt && mt.status) fillSelect(mt.status, statuses);
        }
    } catch (e) { console.warn('fillCommonStatusFilters error', e); }
}

function populateAllTabFilters() {
    populateFinanceiroFilters();
    fillCommonStatusFilters();

    // Força os filtros estáticos da aba Reunião a iniciarem como "Todos"
    // (são <select> simples, não multiple — marcar todas as options como selected
    // faz o navegador manter apenas a última, ex: "Sem meta"/"Não Prioritário")
    [mt.meta, mt.prioritario].forEach(el => {
        if (!el) return;
        if (el.multiple) {
            Array.from(el.options).forEach(o => o.selected = true);
            renderMultiSelectUI(el);
        } else {
            el.value = "";
        }
    });

    updateReuniaoFilters(window.allData);

    // Verifica notificações de atraso (apenas admins ou autorizados)
    if (getCurrentUserRole() === 'admin') {
        verificarNotificacoesAtraso();
    }
}

// Administração movida para admin.js — chamando inicializador se presente
if (typeof verificarAdminSalvo === 'function') verificarAdminSalvo();

// Ao carregar, aplica role salvo (se houver)
(function () {
    const savedRole = sessionStorage.getItem('sop_role') || 'guest';

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
                }
            }
        });
    }

    if (savedRole !== 'guest') {
        toggleLanding(false);
    }
    applyRoleToUI(savedRole);
})();

// Expose helper to global (for onclick from HTML)
try { window.hideAdminPendings = hideAdminPendings; } catch (e) { /* ignore */ }

// --- FIM DA LGICA ADMINISTRATIVA ---

