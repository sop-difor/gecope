// shared/crud-genericos.js — engine genérico de decisão (atender/recusar) e exclusão de registro,
// reutilizado pelos módulos Orçamentos e Composições (ambos têm o mesmo fluxo de revisão/exclusão).
// Extraído de main.js (Fase 3 da reorganização modular).

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
