// modules/contratos/contratos.js — módulo Contratos: checklist de documentação do aditivo
// (preenchimento, versionamento e relatório de análise documental por processo).
// Estado é seedado a partir de Processos (ao abrir/cadastrar um processo) — ver main.js.
// Extraído de main.js (Fase 3 da reorganização modular).

// --- CHECKLIST DE DOCUMENTAÇÃO (ADITIVO) ---
let checklistAditivoState = {
    processoStr: null,
    processoId: null,
    descricao: null,
    sessionFinalized: false,
    latestChecklist: null,
    versoes: []
};

async function carregarChecklistAditivo(processoStr, processoId) {
    const elResumo = document.getElementById('det_checklist_status');
    const elHistWrap = document.getElementById('det_checklist_historico_wrap');
    const elHist = document.getElementById('det_checklist_historico');
    if (!elResumo) return;

    elResumo.innerHTML = '<em class="text-muted">Carregando...</em>';
    if (elHistWrap) elHistWrap.style.display = 'none';

    try {
        const { data, error } = await sbClient
            .from('checklist_documentacao_aditivo')
            .select('*')
            .eq('processo_id', String(processoId))
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            checklistAditivoState.latestChecklist = null;
            elResumo.innerHTML = '<em class="text-muted">Nenhum checklist registrado ainda.</em>';
            atualizarBadgeAba('gp-badge-documental', 0);
            return;
        }

        // Não há uma coluna "versão" no banco: cada finalização de checklist é uma
        // linha nova (nunca sobrescreve a anterior), então a posição cronológica já
        // basta pra numerar — o mais antigo é a Versão 01, cada novo registro soma 1.
        checklistAditivoState.versoes = data;
        checklistAditivoState.latestChecklist = data[0];
        // Com pelo menos um checklist salvo, o resumo/badges some daqui: a lista de
        // versões abaixo (com o botão "Ver" na linha "· Atual") já cobre tanto abrir
        // o checklist corrente quanto ver o resultado — sem duplicar informação.
        elResumo.innerHTML = '';
        const registro = data[0];
        const totalObsDocumental = CHECKLIST_ADITIVO_ITENS.filter(item => registro[item.campo] === false && item.pendenciaSeNao !== false).length
            + CHECKLIST_ADITIVO_ITENS.filter(item => registro[item.campo] === true && item.obsCampo && registro[item.obsCampo]).length;
        atualizarBadgeAba('gp-badge-documental', totalObsDocumental);

        // Lista de todas as versões, da mais antiga (01) pra mais nova, cada uma com
        // botão pra ver o checklist respondido, gerar o relatório e excluir aquela
        // versão específica — inclusive a versão atual, marcada com "· Atual".
        if (elHist) {
            const total = data.length;
            const ascendente = data.slice().reverse();
            const podeExcluir = getCurrentUserRole() === 'admin';
            elHist.innerHTML = ascendente.map((reg, idxAsc) => {
                const versao = String(idxAsc + 1).padStart(2, '0');
                const dt = new Date(reg.created_at).toLocaleString('pt-BR');
                const ehAtual = idxAsc + 1 === total;
                return `
                    <div class="mb-2 pb-2 border-bottom border-light d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <div>
                            <span class="fw-bold text-dark">Versão ${versao}</span>
                            <span class="text-muted"> · ${escapeHTML(reg.autor_nome || '')} em ${dt}</span>
                            ${ehAtual ? ' <span class="text-success fw-bold">· Atual</span>' : ''}
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalChecklistAditivo(${reg.id})"><i class="bi bi-eye me-1"></i>Ver</button>
                            <button type="button" class="btn btn-sm btn-outline-success" onclick="gerarRelatorioChecklistAditivo(${reg.id})"><i class="bi bi-file-earmark-text me-1"></i>Relatório</button>
                            ${podeExcluir ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="excluirChecklistAditivo(${reg.id}, '${versao}')" title="Excluir esta versão"><i class="bi bi-trash-fill"></i></button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
            if (elHistWrap) elHistWrap.style.display = '';
        }
    } catch (err) {
        console.error("Erro ao carregar checklist do aditivo:", err);
        elResumo.innerHTML = '<em class="text-danger">Erro ao carregar checklist.</em>';
    }
}

// Exclui uma versão do checklist de documentação. Não renumera as demais — a
// Versão 03 continua "03" mesmo se a 02 for apagada, pra não confundir quem já
// viu/citou aquele número antes (mesmo critério usado na exclusão da Curva ABC).
async function excluirChecklistAditivo(checklistId, versao) {
    if (getCurrentUserRole() !== 'admin') return;
    if (!confirm(`Excluir a Versão ${versao} do checklist de documentação? Essa ação não pode ser desfeita.`)) return;

    const { error } = await sbClient.from('checklist_documentacao_aditivo').delete().eq('id', checklistId);
    if (error) {
        alert('Erro ao excluir a versão: ' + error.message);
        return;
    }

    registrarAtividade('PROCESSO', `excluiu a Versão ${versao} do checklist de documentação do processo Nº ${checklistAditivoState.processoStr}`, checklistAditivoState.processoStr);
    await carregarChecklistAditivo(checklistAditivoState.processoStr, checklistAditivoState.processoId);
}

/* Relatório consolidado da Análise Documental (checklist do aditivo), no mesmo espírito
   do "Relatório de Análise Técnica" já existente na Curva ABC (cvGerarRelatorioComentarios,
   em curva_abc.js): monta um documento HTML formal, pronto para impressão/PDF, a partir
   de um checklist finalizado do processo — o mais recente por padrão, ou uma versão
   específica do histórico se checklistId for informado (botão "Relatório" de cada versão). */
function gerarRelatorioChecklistAditivo(checklistId) {
    const versoes = checklistAditivoState.versoes || [];
    const registro = checklistId
        ? versoes.find(v => v.id === checklistId)
        : checklistAditivoState.latestChecklist;
    if (!registro) {
        alert('Nenhum checklist de documentação finalizado para este processo ainda. Preencha o checklist antes de gerar o relatório.');
        return;
    }
    const versao = versoes.length ? versoes.length - versoes.indexOf(registro) : 1;

    const dt = new Date(registro.created_at);
    const dtConferencia = dt.toLocaleDateString('pt-BR') + ', ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const itensAplicaveis = CHECKLIST_ADITIVO_ITENS.filter(item => registro[item.campo] !== null && registro[item.campo] !== undefined);
    const pendencias = itensAplicaveis.filter(item => registro[item.campo] === false && item.pendenciaSeNao !== false);
    const inconsistencias = itensAplicaveis.filter(item => registro[item.campo] === true && item.obsCampo && registro[item.obsCampo]);
    const totalObservacoes = pendencias.length + inconsistencias.length;

    const ICON_OK = '<svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14" rx="3" fill="#dcf0e3"/><path d="M3.5 7.3 L6 9.6 L10.5 4.4" fill="none" stroke="#1c6b40" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_NO = '<svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14" rx="3" fill="#fbe0dd"/><path d="M4.2 4.2 L9.8 9.8 M9.8 4.2 L4.2 9.8" fill="none" stroke="#b02a1c" stroke-width="1.8" stroke-linecap="round"/></svg>';

    const linhasTabela = CHECKLIST_ADITIVO_ITENS.map(item => {
        const valor = registro[item.campo];
        if (valor === true) return `<tr><td>${escapeHTML(item.label)}</td><td class="st s-ok">${ICON_OK}<span class="lbl">Sim</span></td></tr>`;
        if (valor === false) return `<tr><td>${escapeHTML(item.label)}</td><td class="st s-no">${ICON_NO}<span class="lbl">Não</span></td></tr>`;
        return `<tr><td>${escapeHTML(item.label)}</td><td class="st s-na"><span class="lbl">N/A</span></td></tr>`;
    }).join('');

    const notas = [];
    pendencias.forEach(item => {
        const obs = item.obsCampo && registro[item.obsCampo]
            ? registro[item.obsCampo]
            : 'Não consta nos autos. Documento indispensável — deve ser providenciado antes do prosseguimento.';
        notas.push({ doc: item.label, tag: 'Checklist', txt: obs });
    });
    inconsistencias.forEach(item => {
        notas.push({ doc: item.label, tag: 'Checklist', txt: registro[item.obsCampo] });
    });
    if (registro.outros_flag && registro.outros_obs) {
        notas.push({ doc: 'Outros documentos relevantes', tag: 'Fora do checklist', txt: registro.outros_obs });
    }

    const notasHTML = notas.length
        ? notas.map(n => `
        <div class="note">
            <span class="doc">${escapeHTML(n.doc)}</span><span class="tag">${escapeHTML(n.tag)}</span>
            <div class="txt">${escapeHTML(n.txt)}</div>
        </div>`).join('')
        : '<div class="hint" style="font-style:normal">Nenhuma observação registrada — documentação sem pendências além do checklist padrão.</div>';

    const conclusaoTxt = totalObservacoes > 0
        ? `Situação geral: <span class="st">pendente de saneamento</span>. Constatada(s) <b>${totalObservacoes} pendência(s)/observação(ões) no checklist</b> a serem sanadas antes do prosseguimento. Após regularização, retornar os autos à GECOPE para reanálise.`
        : `Situação geral: <b>regular</b>. Não foram constatadas pendências na documentação mínima exigida para este aditivo (1º Aditivo: ${registro.eh_primeiro_aditivo ? 'Sim' : 'Não'}).`;

    const objeto = checklistAditivoState.descricao ? escapeHTML(checklistAditivoState.descricao) : '—';
    const analistaNome = escapeHTML((registro.autor_nome || '').toUpperCase());

    const conteudo = `
    <div class="head">
      ${montarCabecalhoLogosRelatorio('Relatório de Análise Documental')}
    </div>
    ${montarIdentificacaoRelatorio(escapeHTML(checklistAditivoState.processoStr || ''), objeto, analistaNome, String(versao), dtConferencia)}

    <h2>Conferência da Documentação</h2>
    <table class="check">
      <thead><tr><th>Documento</th><th class="st">Situação</th></tr></thead>
      <tbody>${linhasTabela}</tbody>
    </table>
    <div class="legenda">
      <span class="leg-item"><b>Sim</b> — Documentação anexada ao processo;</span>
      <span class="leg-item"><b>Não</b> — Documentação não anexada ao processo;</span>
      <span class="leg-item"><b>N/A</b> — Documentação não se aplica.</span>
    </div>

    <h2>Comentários do Analista</h2>
    <div class="hint">Registre aqui as observações sobre qualquer documento — do checklist ou não.</div>
    ${notasHTML}

    <h2>Conclusão</h2>
    <div class="concl">${conclusaoTxt}</div>
    `;

    // Abre em nova aba (documento HTML separado) em vez de num modal aninhado dentro
    // de GERENCIAR PROCESSO: um modal-dentro-de-modal aqui esbarra numa regra própria
    // do sistema que fixa o z-index de .modal/.modal-backdrop em !important, o que
    // impede o relatório de aparecer por cima. Abrir em aba nova evita esse problema
    // de raiz e ainda facilita imprimir/salvar em PDF.
    const janela = window.open('', '_blank');
    if (!janela) {
        alert('O navegador bloqueou a abertura do relatório em nova aba. Permita pop-ups para este site e tente novamente.');
        return;
    }
    janela.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório de Análise Documental — ${escapeHTML(checklistAditivoState.processoStr || '')}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 18mm 16mm;
    @bottom-center {
      content: "SOP-CE · GECOPE   |   Relatório de Análise Documental   |   Página " counter(page) " de " counter(pages);
      font-family: "Montserrat", sans-serif; font-size: 7pt; color: #8a978d;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f3f5; font-family: "Montserrat", "Arial", sans-serif; color: #2a332c; font-size: 10pt; line-height: 1.5; }

  .rel-toolbar { padding: 12px 20px; background: #212529; text-align: right; }
  .rel-toolbar button { padding: 8px 18px; font-weight: 600; border: none; border-radius: 4px; background: #198754; color: #fff; cursor: pointer; }
  .rel-toolbar button:hover { background: #157347; }
  .rel-page { max-width: 800px; aspect-ratio: 210 / 297; margin: 20px auto; background: #fff; padding: 50px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }

  /* cabeçalho (logos, divisor e título vêm de montarCabecalhoLogosRelatorio()) */
  .head { margin-bottom: 14px; }

  /* seções */
  h2 {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.8px;
    color: #0f3d2e; margin: 18px 0 7px 0; padding-bottom: 3px;
    border-bottom: 1px solid #d6e0d9;
  }

  /* tabela de conferência */
  table.check { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.check th {
    text-align: left; padding: 5px 8px; font-size: 7.4pt; letter-spacing: 0.5px;
    text-transform: uppercase; color: #45564c; border-bottom: 1.5px solid #0f3d2e;
  }
  table.check th.st { text-align: center; width: 120px; }
  table.check td { padding: 4px 8px; border-bottom: 0.5px solid #e6ece7; }
  table.check td.st { text-align: center; }
  .st svg { vertical-align: middle; margin-right: 5px; }
  .st .lbl { font-weight: 700; font-size: 8.6pt; vertical-align: middle; }
  .s-ok .lbl { color: #1c6b40; }
  .s-no .lbl { color: #b02a1c; }
  .s-na .lbl { color: #8a938c; }

  /* legenda da conferência de documentação */
  .legenda {
    display: flex; flex-direction: column; gap: 3px;
    margin: 8px 0 4px 0; padding: 6px 8px;
    font-size: 7.6pt; color: #63736a;
  }
  .legenda .leg-item b { color: #2a332c; }

  /* comentários do analista — área livre */
  .note { border-left: 3px solid #2e8b57; padding: 2px 0 2px 11px; margin-bottom: 11px; }
  .note .doc { font-weight: 700; color: #0f3d2e; font-size: 9.3pt; }
  .note .tag {
    font-size: 6.8pt; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
    color: #63736a; background: #eef3ef; border-radius: 3px; padding: 1px 6px; margin-left: 6px;
  }
  .note .txt { font-size: 10pt; color: #3a453d; margin-top: 3px; white-space: pre-wrap; }
  .hint { font-size: 8pt; color: #8a978d; font-style: italic; margin: -2px 0 10px 0; }

  /* conclusão */
  .concl { font-size: 9.3pt; line-height: 1.55; }
  .concl b { color: #0f3d2e; }
  .concl .st { font-weight: 700; color: #8a6410; }

  @media print {
    .rel-toolbar { display: none; }
    body { background: #fff; }
    .rel-page { box-shadow: none; margin: 0; max-width: none; padding: 0; aspect-ratio: auto; }
  }
</style>
</head>
<body>
<div class="rel-toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
<div class="rel-page">${conteudo}</div>
</body>
</html>`);
    janela.document.close();
}

function toggleChecklistCondicional(radioName, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const checked = document.querySelector(`input[name="${radioName}"]:checked`);
    container.classList.toggle('d-none', !(checked && checked.value === 'sim'));
}

// Observação de cada item fica escondida por padrão: o analista decide se quer
// comentar clicando no botão, em vez da caixa abrir sozinha ao responder Sim/Não.
function toggleObsChecklistManual(itemKey) {
    const wrap = document.getElementById(`${itemKey}_obs_wrap`);
    const btn = document.getElementById(`${itemKey}_obs_toggle`);
    if (!wrap) return;
    const estaAberta = !wrap.classList.contains('d-none');
    wrap.classList.toggle('d-none', estaAberta);
    if (estaAberta) {
        const textarea = document.getElementById(`${itemKey}_obs`);
        if (textarea) textarea.value = '';
    }
    if (btn) {
        btn.innerHTML = estaAberta
            ? '<i class="bi bi-chat-left-text me-1"></i>Adicionar observação'
            : '<i class="bi bi-dash-circle me-1"></i>Remover observação';
    }
}

function resetarFormChecklistAditivo() {
    const form = document.getElementById('formChecklistAditivo');
    if (!form) return;
    form.querySelectorAll('input[type="radio"]').forEach(r => { r.checked = false; r.disabled = false; });
    form.querySelectorAll('textarea').forEach(t => { t.value = ''; t.disabled = false; });
    document.getElementById('chk_grupo_primeiro_aditivo').classList.add('d-none');
    document.getElementById('chk_comp_analiticas_wrap').classList.add('d-none');
    CHECKLIST_ADITIVO_ITENS.forEach(item => {
        const wrap = document.getElementById(`${item.key}_obs_wrap`);
        if (wrap) wrap.classList.add('d-none');
        const btn = document.getElementById(`${item.key}_obs_toggle`);
        if (btn) btn.innerHTML = '<i class="bi bi-chat-left-text me-1"></i>Adicionar observação';
    });
    document.getElementById('chk_outros_obs_wrap').classList.add('d-none');
}

// Item 10 (Outros): diferente dos demais itens do checklist, a observação só faz
// sentido quando a resposta é "Sim" (há outra documentação a comentar) — "Não" não
// tem o que justificar, então a caixa de texto fica escondida nesse caso.
function toggleOutrosChecklist() {
    const wrap = document.getElementById('chk_outros_obs_wrap');
    if (!wrap) return;
    const checked = document.querySelector('input[name="chk_outros"]:checked');
    const mostrar = !!checked && checked.value === 'sim';
    wrap.classList.toggle('d-none', !mostrar);
    if (!mostrar) {
        const textarea = document.getElementById('chk_outros_obs');
        if (textarea) textarea.value = '';
    }
}

function abrirModalChecklistAditivo(checklistIdParaVisualizar = null) {
    resetarFormChecklistAditivo();

    const modoLeitura = !!checklistIdParaVisualizar;
    document.getElementById('chk_msg_readonly').style.display = modoLeitura ? '' : 'none';
    document.getElementById('chk_msg_obrigatorio').style.display = modoLeitura ? 'none' : '';
    document.getElementById('btn-finalizar-checklist').style.display = modoLeitura ? 'none' : '';

    document.getElementById('chk_processo_id').value = checklistAditivoState.processoId || '';
    document.getElementById('chk_processo_nup').value = checklistAditivoState.processoStr || '';
    document.getElementById('chk_processo_label').textContent = checklistAditivoState.processoStr || '';

    if (modoLeitura) {
        // Busca o registro (no atual ou no histórico já carregado) para exibir somente leitura
        let registro = null;
        if (checklistAditivoState.latestChecklist && checklistAditivoState.latestChecklist.id === checklistIdParaVisualizar) {
            registro = checklistAditivoState.latestChecklist;
        }
        if (!registro) {
            sbClient.from('checklist_documentacao_aditivo').select('*').eq('id', checklistIdParaVisualizar).single()
                .then(({ data, error }) => {
                    if (!error && data) preencherFormChecklist(data, true);
                });
        } else {
            preencherFormChecklist(registro, true);
        }
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalChecklistAditivo')).show();
}

function preencherFormChecklist(registro, desabilitar) {
    const setRadio = (name, valorBool) => {
        if (valorBool === null || valorBool === undefined) return;
        const el = document.getElementById(`${name}_${valorBool ? 'sim' : 'nao'}`);
        if (el) el.checked = true;
    };

    setRadio('chk_primeiro_aditivo', registro.eh_primeiro_aditivo);
    toggleChecklistCondicional('chk_primeiro_aditivo', 'chk_grupo_primeiro_aditivo');

    CHECKLIST_ADITIVO_ITENS.forEach(item => {
        setRadio(item.key, registro[item.campo]);
        if (item.obsCampo && registro[item.obsCampo]) {
            const textarea = document.getElementById(`${item.key}_obs`);
            if (textarea) textarea.value = registro[item.obsCampo];
            const wrap = document.getElementById(`${item.key}_obs_wrap`);
            if (wrap) wrap.classList.remove('d-none');
            const btn = document.getElementById(`${item.key}_obs_toggle`);
            if (btn) btn.innerHTML = '<i class="bi bi-dash-circle me-1"></i>Remover observação';
        }
    });
    toggleChecklistCondicional('chk_comp_propria', 'chk_comp_analiticas_wrap');

    setRadio('chk_outros', registro.outros_flag);
    const outros = document.getElementById('chk_outros_obs');
    if (outros) outros.value = registro.outros_obs || '';
    toggleOutrosChecklist();

    if (desabilitar) {
        const form = document.getElementById('formChecklistAditivo');
        form.querySelectorAll('input, textarea').forEach(el => { el.disabled = true; });
    }
}

function cancelarChecklistAditivo() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalChecklistAditivo'));
    if (modal) modal.hide();
}

async function salvarChecklistAditivo() {
    const getRadioValue = (name) => {
        const el = document.querySelector(`input[name="${name}"]:checked`);
        return el ? el.value : null;
    };
    const focarEAlertar = (msg, elId) => {
        alert(msg);
        const el = document.getElementById(elId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const primeiroAditivo = getRadioValue('chk_primeiro_aditivo');
    if (!primeiroAditivo) {
        focarEAlertar('Responda se é o 1º Aditivo deste processo.', 'chk_primeiro_aditivo_sim');
        return;
    }
    const ehPrimeiroAditivo = primeiroAditivo === 'sim';

    const payload = {
        processo_id: String(checklistAditivoState.processoId),
        processo_nup: checklistAditivoState.processoStr,
        eh_primeiro_aditivo: ehPrimeiroAditivo,
        autor_nome: sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido',
        autor_email: getCurrentUserEmail()
    };

    for (const item of CHECKLIST_ADITIVO_ITENS) {
        const ehCondicionalPrimeiroAditivo = item.obrigatorio === 'primeiro_aditivo';
        const ehCondicionalCompPropria = item.obrigatorio === 'comp_propria';

        if (ehCondicionalPrimeiroAditivo && !ehPrimeiroAditivo) {
            payload[item.campo] = null;
            if (item.obsCampo) payload[item.obsCampo] = null;
            continue;
        }
        // "Composições Analíticas" só é obrigatória quando "Composição Própria" = Sim
        // (já processada neste mesmo laço, pois vem antes no array).
        if (ehCondicionalCompPropria && payload.composicao_propria !== true) {
            payload[item.campo] = null;
            if (item.obsCampo) payload[item.obsCampo] = null;
            continue;
        }

        const valor = getRadioValue(item.key);
        if (!valor) {
            focarEAlertar(`Responda o item "${item.label}" antes de finalizar o checklist.`, `${item.key}_sim`);
            return;
        }
        payload[item.campo] = valor === 'sim';
        if (item.obsCampo) {
            // Observação é salva tanto para "Não" (justificativa de ausência) quanto
            // para "Sim" (inconsistência num documento que foi apresentado).
            const textarea = document.getElementById(`${item.key}_obs`);
            payload[item.obsCampo] = (textarea && textarea.value.trim()) ? textarea.value.trim() : null;
        }
    }

    const outrosValor = getRadioValue('chk_outros');
    if (!outrosValor) {
        focarEAlertar('Responda o item "Outros documentos relevantes não listados acima?" antes de finalizar o checklist.', 'chk_outros_sim');
        return;
    }
    payload.outros_flag = outrosValor === 'sim';
    const outros = document.getElementById('chk_outros_obs');
    payload.outros_obs = (payload.outros_flag && outros && outros.value.trim()) ? outros.value.trim() : null;

    const btn = document.getElementById('btn-finalizar-checklist');
    btn.disabled = true;
    btn.innerHTML = 'SALVANDO...';

    const { error } = await sbClient.from('checklist_documentacao_aditivo').insert([payload]);

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Finalizar Checklist';

    if (error) {
        alert('Erro ao salvar checklist: ' + error.message);
        return;
    }

    checklistAditivoState.sessionFinalized = true;
    registrarAtividade('PROCESSO', `preencheu o checklist de documentação do aditivo do processo Nº ${checklistAditivoState.processoStr}`, checklistAditivoState.processoStr);
    await carregarChecklistAditivo(checklistAditivoState.processoStr, checklistAditivoState.processoId);

    alert('Checklist salvo com sucesso!');
    cancelarChecklistAditivo();
}

// Só exige novo preenchimento do checklist se a documentação já registrada puder estar
// desatualizada: comparamos a data de "Devolução p/ Correções" do processo com a data em
// que o último checklist foi salvo. Devolução posterior ao último checklist = documentação
// pode ter mudado nesse intervalo, exige nova conferência. Sem devolução (ou devolução
// anterior ao checklist) = o checklist já registrado continua válido, mesmo que o Status
// tenha mudado para chegar em AGUAR. APROVAÇÃO/APROVADO.
function checklistValidoParaSalvar(statusFinal) {
    if (statusFinal !== 'AGUAR. APROVAÇÃO' && statusFinal !== 'APROVADO') return true;
    if (checklistAditivoState.sessionFinalized) return true;
    if (!checklistAditivoState.latestChecklist) return false;

    const elDevolucao = document.getElementById('det_data_devolucao');
    const isoDevolucao = elDevolucao ? dataParaISO(elDevolucao.value.trim()) : null;
    if (!isoDevolucao) return true;

    const dtDevolucao = isoParaDate(isoDevolucao);
    const dtChecklist = new Date(checklistAditivoState.latestChecklist.created_at);
    return !(dtDevolucao > dtChecklist);
}
