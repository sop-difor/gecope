/* Curva ABC do Processo — lado de GERENCIAR PROCESSO.
   A análise em si (upload, gráfico, tabela, status/comentário item a item) acontece
   dentro da aba Curva ABC (curva_abc.js/#pane-curva-abc), que sabe se "vincular" a um
   processo e persistir em curva_abc_versoes/curva_abc_itens. Este arquivo só cuida do
   resumo mostrado no card "CURVA ABC" de Gerenciar Processo e do botão que navega para
   a aba já carregada com os dados do processo (evita duplicar gráfico/KPIs/exportação
   numa segunda UI dentro de um modal). */
(function () {
  "use strict";

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (typeof escapeHTML === "function") ? escapeHTML(s) : String(s == null ? "" : s); }

  /* ---------- resumo em GERENCIAR PROCESSO ---------- */
  async function carregarCurvaAbcResumo(processoStr, processoId) {
    var elStatus = el("det_curva_abc_status");
    var elHistWrap = el("det_curva_abc_historico_wrap");
    var elHist = el("det_curva_abc_historico");
    var btn = el("btn-abrir-curva-abc-processo");
    var btnRelatorio = el("btn-relatorio-tecnico");
    if (!elStatus) return;

    elStatus.innerHTML = '<em class="text-muted">Carregando...</em>';
    if (elHistWrap) elHistWrap.style.display = "none";

    try {
      var { data, error } = await sbClient
        .from("curva_abc_versoes")
        .select("*")
        .eq("processo_id", String(processoId))
        .order("versao", { ascending: false });
      if (error) throw error;

      if (!data || !data.length) {
        elStatus.innerHTML = '<em class="text-muted">Nenhuma Curva ABC importada ainda.</em>';
        if (btn) btn.textContent = "Importar planilha";
        if (btnRelatorio) btnRelatorio.style.display = "none";
        if (elHist) elHist.innerHTML = "";
        if (typeof atualizarBadgeAba === "function") atualizarBadgeAba("gp-badge-tecnica", 0);
        return;
      }

      var atual = data[0];
      var { data: itensStatus, error: errItens } = await sbClient
        .from("curva_abc_itens")
        .select("status_analise")
        .eq("versao_id", atual.id);
      if (errItens) throw errItens;

      var okN = 0, incN = 0, pendN = 0;
      (itensStatus || []).forEach(function (x) {
        if (x.status_analise === "ok") okN++;
        else if (x.status_analise === "inconsistencia") incN++;
        else pendN++;
      });

      var dt = atual.created_at ? new Date(atual.created_at).toLocaleString("pt-BR") : "";
      var badge = incN > 0
        ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">' + incN + ' inconsistência(s)</span>'
        : (pendN > 0
          ? '<span class="badge bg-warning-subtle text-warning border border-warning-subtle">' + pendN + ' pendente(s)</span>'
          : '<span class="badge bg-success-subtle text-success border border-success-subtle">Análise completa</span>');

      elStatus.innerHTML = '<div class="d-flex justify-content-between align-items-center mb-1">'
        + '<div>' + badge + ' <span class="text-muted ms-1">Versão ' + atual.versao + ' · ' + (atual.total_itens || (itensStatus || []).length) + ' itens</span></div>'
        + '</div>'
        + '<div class="text-muted" style="font-size:0.7rem;">Enviado por ' + esc(atual.autor_nome || "") + ' em ' + dt + '</div>';

      if (btn) btn.textContent = "Analisar versão atual";
      if (btnRelatorio) btnRelatorio.style.display = "";
      if (typeof atualizarBadgeAba === "function") atualizarBadgeAba("gp-badge-tecnica", incN);

      if (elHist && data.length > 1) {
        elHist.innerHTML = data.slice(1).map(function (v) {
          var vdt = v.created_at ? new Date(v.created_at).toLocaleString("pt-BR") : "";
          return '<div class="mb-2 pb-2 border-bottom border-light d-flex justify-content-between align-items-center">'
            + '<div><span class="fw-bold text-dark">Versão ' + v.versao + '</span>'
            + '<span class="text-muted"> · ' + esc(v.autor_nome || "") + ' em ' + vdt + '</span></div>'
            + '<button type="button" class="btn btn-link btn-sm p-0" onclick="abrirCurvaAbcDoProcesso(' + v.id + ')">Ver</button>'
            + '</div>';
        }).join("");
        if (elHistWrap) elHistWrap.style.display = "";
      } else if (elHist) {
        elHist.innerHTML = "";
      }
    } catch (err) {
      console.error("Erro ao carregar Curva ABC do processo:", err);
      elStatus.innerHTML = '<em class="text-danger">Erro ao carregar Curva ABC.</em>';
    }
  }

  /* ---------- relatório de análise técnica, direto de GERENCIAR PROCESSO ----------
     Reaproveita o mesmo formato/modal de cvGerarRelatorioComentarios (curva_abc.js),
     mas busca os itens comentados diretamente no Supabase — não depende da aba Curva
     ABC estar aberta/carregada, já que aqui o analista pode nem ter navegado até lá. */
  async function gerarRelatorioTecnicoDoProcesso() {
    var processoId = curvaAbcProcessoState.processoId;
    var processoStr = curvaAbcProcessoState.processoStr;
    var descricao = curvaAbcProcessoState.descricao;

    var { data: versoes, error: errV } = await sbClient
      .from("curva_abc_versoes")
      .select("*")
      .eq("processo_id", String(processoId))
      .order("versao", { ascending: false })
      .limit(1);
    if (errV) { alert("Erro ao buscar a Curva ABC: " + errV.message); return; }
    if (!versoes || !versoes.length) { alert("Nenhuma Curva ABC importada ainda para este processo."); return; }

    var { data: itens, error: errI } = await sbClient
      .from("curva_abc_itens")
      .select("*")
      .eq("versao_id", versoes[0].id)
      .order("posicao", { ascending: true });
    if (errI) { alert("Erro ao buscar os itens da Curva ABC: " + errI.message); return; }

    var comentados = (itens || []).filter(function (x) {
      return x.comentario && String(x.comentario).replace(/<[^>]*>/g, "").trim();
    });
    if (!comentados.length) { alert("Nenhum comentário cadastrado nesta Curva ABC ainda."); return; }

    var partes = [];
    partes.push('<div style="font-family:\'Montserrat\',sans-serif; font-size:11pt; text-align:justify; line-height:1.5; color:#1a1a1a">');
    partes.push('<p style="text-align:center; font-weight:700; text-transform:uppercase; margin:0 0 1em 0">Relatório de Análise Técnica — GECOPE</p>');
    partes.push('<p style="font-weight:700; margin:0 0 1em 0">PROCESSO NUP ' + esc(processoStr)
      + (descricao ? ' — ' + esc(descricao) : '') + '</p>');
    partes.push('<p style="margin:0 0 1.5em 0">Após análise da Curva ABC deste processo, resolve-se retornar o processo à Fiscalização com os seguintes apontamentos:</p>');
    comentados.forEach(function (x, i) {
      partes.push('<p style="margin:0 0 0.4em 0"><strong>' + (i + 1) + '. ITEM ' + esc(x.conta) + ' - ' + esc(x.descricao) + ':</strong></p>');
      partes.push('<div style="margin:0 0 1.5em 0">' + x.comentario + '</div>');
    });
    partes.push('</div>');

    document.getElementById("cv-relatorio-comentarios-body").innerHTML = partes.join("");
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalCvRelatorioComentarios")).show();
  }

  /* ---------- navegação para a aba Curva ABC, já carregada com o processo ---------- */
  function abrirCurvaAbcDoProcesso(versaoId) {
    var modalDetalhesEl = document.getElementById("modalDetalhes");
    var modalDetalhes = modalDetalhesEl ? bootstrap.Modal.getInstance(modalDetalhesEl) : null;
    if (modalDetalhes) modalDetalhes.hide();

    var processoId = curvaAbcProcessoState.processoId;
    var processoStr = curvaAbcProcessoState.processoStr;
    var descricao = curvaAbcProcessoState.descricao;

    showPane("pane-curva-abc");
    // dá tempo da aba ficar visível antes de carregar/renderizar o gráfico
    // (mesmo padrão de espera usado em main.js para o modal de detalhes, ex.: calcularRepercussao)
    setTimeout(function () {
      if (typeof carregarCurvaAbcDoProcesso === "function") {
        carregarCurvaAbcDoProcesso(processoId, processoStr, versaoId || null, descricao);
      }
    }, 50);
  }

  window.carregarCurvaAbcResumo = carregarCurvaAbcResumo;
  window.abrirCurvaAbcDoProcesso = abrirCurvaAbcDoProcesso;
  window.gerarRelatorioTecnicoDoProcesso = gerarRelatorioTecnicoDoProcesso;
})();
