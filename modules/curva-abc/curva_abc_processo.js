// --- CURVA ABC DO PROCESSO (referência usada ao navegar para a aba Curva ABC) ---
// vindoDoModal: true quando a navegação partiu do botão "Curva ABC"/"Nova Curva
// ABC" de dentro de GERENCIAR PROCESSO — troca o botão "Processos →" da Curva ABC
// por "Voltar", que reabre o mesmo processo na aba Análise Técnica, em vez de
// simplesmente levar à lista geral de Processos.
let curvaAbcProcessoState = {
    processoStr: null,
    processoId: null,
    vindoDoModal: false
};

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
  // Mesma regra de escrita usada pela RLS de curva_abc_versoes/itens (admin ou gerente).
  function podeEscreverCurvaAbc() {
    return (typeof getCurrentUserRole === "function")
      && (getCurrentUserRole() === "admin" || getCurrentUserRole() === "gerente");
  }

  /* ---------- resumo em GERENCIAR PROCESSO ---------- */
  async function carregarCurvaAbcResumo(processoStr, processoId) {
    var elStatus = el("det_curva_abc_status");
    var elHistWrap = el("det_curva_abc_historico_wrap");
    var elHist = el("det_curva_abc_historico");
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

      var incN = 0;
      (itensStatus || []).forEach(function (x) {
        if (x.status_analise === "inconsistencia") incN++;
      });

      // Com pelo menos uma versão salva, o resumo/status some daqui: a lista de
      // versões abaixo (com o botão "Curva ABC" na linha "· Atual") já cobre tanto
      // abrir a análise corrente quanto ver o resultado — sem duplicar informação.
      elStatus.innerHTML = "";
      if (typeof atualizarBadgeAba === "function") atualizarBadgeAba("gp-badge-tecnica", incN);

      // Lista de todas as versões, da mais antiga (01) pra mais nova, cada uma com
      // botão pra abrir a análise (Curva ABC), gerar o relatório e excluir aquela
      // versão específica — inclusive a versão atual, marcada com "· Atual".
      var podeExcluir = podeEscreverCurvaAbc();
      if (elHist) {
        var ascendente = data.slice().reverse();
        elHist.innerHTML = ascendente.map(function (v) {
          var vdt = v.created_at ? new Date(v.created_at).toLocaleString("pt-BR") : "";
          var numero = String(v.versao).padStart(2, "0");
          var ehAtual = v.id === atual.id;
          return '<div class="mb-2 pb-2 border-bottom border-light d-flex justify-content-between align-items-center flex-wrap gap-2">'
            + '<div><span class="fw-bold text-dark">Versão ' + numero + '</span>'
            + '<span class="text-muted"> · ' + esc(v.autor_nome || "") + ' em ' + vdt + '</span>'
            + (ehAtual ? ' <span class="text-success fw-bold">· Atual</span>' : '') + '</div>'
            + '<div class="d-flex gap-2">'
            + '<button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirCurvaAbcDoProcesso(' + v.id + ')">'
            + '<i class="bi bi-bar-chart-fill me-1"></i>Curva ABC</button>'
            + '<button type="button" class="btn btn-sm btn-outline-success" onclick="gerarRelatorioTecnicoDoProcesso(' + v.id + ')">'
            + '<i class="bi bi-file-earmark-text me-1"></i>Relatório</button>'
            + (podeExcluir
              ? '<button type="button" class="btn btn-sm btn-outline-danger" onclick="excluirVersaoCurvaAbc(' + v.id + ', \'' + numero + '\')" title="Excluir esta versão">'
                + '<i class="bi bi-trash-fill"></i></button>'
              : '')
            + '</div>'
            + '</div>';
        }).join("");
        if (elHistWrap) elHistWrap.style.display = "";
      }
    } catch (err) {
      console.error("Erro ao carregar Curva ABC do processo:", err);
      elStatus.innerHTML = '<em class="text-danger">Erro ao carregar Curva ABC.</em>';
    }
  }

  /* ---------- exclusão de uma versão da Curva ABC ----------
     Apaga curva_abc_versoes (curva_abc_itens some junto via on delete cascade).
     Não reordena o número das demais versões — a Versão 03 continua "03" mesmo
     se a 02 for apagada, pra não confundir quem já viu/citou aquele número antes. */
  async function excluirVersaoCurvaAbc(versaoId, numeroVersao) {
    if (!podeEscreverCurvaAbc()) return;
    var ok = confirm("Excluir a Versão " + numeroVersao + " da Curva ABC? Essa ação não pode ser desfeita.");
    if (!ok) return;

    var { error } = await sbClient.from("curva_abc_versoes").delete().eq("id", versaoId);
    if (error) { alert("Erro ao excluir a versão: " + error.message); return; }

    if (typeof registrarAtividade === "function") {
      registrarAtividade("PROCESSO", "excluiu a Versão " + numeroVersao + " da Curva ABC do processo Nº " + curvaAbcProcessoState.processoStr, curvaAbcProcessoState.processoStr);
    }
    await carregarCurvaAbcResumo(curvaAbcProcessoState.processoStr, curvaAbcProcessoState.processoId);
  }

  /* ---------- relatório de análise técnica, direto de GERENCIAR PROCESSO ----------
     Mesmo conteúdo de cvGerarRelatorioComentarios (curva_abc.js), mas busca os itens
     comentados diretamente no Supabase — não depende da aba Curva ABC estar
     aberta/carregada, já que aqui o analista pode nem ter navegado até lá. Aceita um
     versaoId opcional pra gerar o relatório de uma versão específica do histórico
     (por padrão, usa a mais recente). Abre em nova aba (documento HTML separado) em
     vez de reaproveitar o modalCvRelatorioComentarios: aberto de dentro de
     GERENCIAR PROCESSO ele fica aninhado num modal já aberto, o que esbarra numa
     regra própria do sistema que fixa o z-index de .modal/.modal-backdrop em
     !important e impede o relatório de aparecer por cima (mesmo problema já
     corrigido no relatório de Análise Documental). */
  async function gerarRelatorioTecnicoDoProcesso(versaoId) {
    var processoId = curvaAbcProcessoState.processoId;
    var processoStr = curvaAbcProcessoState.processoStr;
    var descricao = curvaAbcProcessoState.descricao;

    var versaoQuery = sbClient.from("curva_abc_versoes").select("*");
    versaoQuery = versaoId
      ? versaoQuery.eq("id", versaoId)
      : versaoQuery.eq("processo_id", String(processoId)).order("versao", { ascending: false }).limit(1);
    var { data: versoes, error: errV } = await versaoQuery;
    if (errV) { alert("Erro ao buscar a Curva ABC: " + errV.message); return; }
    if (!versoes || !versoes.length) { alert("Nenhuma Curva ABC importada ainda para este processo."); return; }
    var versaoRegistro = versoes[0];

    var { data: itens, error: errI } = await sbClient
      .from("curva_abc_itens")
      .select("*")
      .eq("versao_id", versaoRegistro.id)
      .order("posicao", { ascending: true });
    if (errI) { alert("Erro ao buscar os itens da Curva ABC: " + errI.message); return; }

    var comentados = (itens || []).filter(function (x) {
      return x.comentario && String(x.comentario).replace(/<[^>]*>/g, "").trim();
    });
    if (!comentados.length) { alert("Nenhum comentário cadastrado nesta Curva ABC ainda."); return; }

    var partes = [];
    partes.push('<div style="font-family:\'Montserrat\',sans-serif; font-size:10pt; text-align:justify; line-height:1.5; color:#1a1a1a">');
    partes.push(montarCabecalhoLogosRelatorio('Relatório de Análise Técnica'));

    var dtConf = '';
    if (versaoRegistro.created_at) {
      var dConf = new Date(versaoRegistro.created_at);
      dtConf = dConf.toLocaleDateString('pt-BR') + ', ' + dConf.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    partes.push(montarIdentificacaoRelatorio(
      esc(processoStr),
      descricao ? esc(descricao) : '',
      esc((versaoRegistro.autor_nome || '').toUpperCase()),
      String(versaoRegistro.versao),
      dtConf
    ));

    partes.push('<p style="margin:0 0 1.5em 0">Após análise da Curva ABC deste processo, resolve-se retornar o processo à Fiscalização com os seguintes apontamentos:</p>');
    comentados.forEach(function (x, i) {
      partes.push('<p style="margin:0 0 0.4em 0"><strong>' + (i + 1) + '. ITEM ' + esc(x.conta) + ' - ' + esc(x.descricao) + ':</strong></p>');
      /* mesmo padrão do editor do comentário (Montserrat 10pt, entrelinha 1,5,
         justificado, parágrafos com recuo na 1ª linha e sem linha em branco entre
         eles — ver .cv-coment-editor em style.css), aplicado aqui de novo porque
         o container do relatório inteiro usa 10pt (ver acima) — o comentário em
         si sempre sai no tamanho em que foi escrito, mesmo que o resto do
         relatório mude. */
      partes.push('<div class="coment-corpo" style="margin:0 0 1.5em 0; font-family:\'Montserrat\',sans-serif; font-size:10pt; line-height:1.5; text-align:justify; white-space:pre-wrap">' + sanitizeRichHTML(x.comentario) + '</div>');
    });
    partes.push('</div>');

    var janela = window.open('', '_blank');
    if (!janela) {
      alert('O navegador bloqueou a abertura do relatório em nova aba. Permita pop-ups para este site e tente novamente.');
      return;
    }
    janela.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
      + '<title>Relatório de Análise Técnica — ' + esc(processoStr) + '</title>'
      + '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">'
      + '<style>'
      + 'body{margin:0;background:#f1f3f5;font-family:"Montserrat","Arial",sans-serif;font-size:10pt;}'
      + '.rel-toolbar{padding:12px 20px;background:#212529;text-align:right;}'
      + '.rel-toolbar button{padding:8px 18px;font-weight:600;border:none;border-radius:4px;background:#198754;color:#fff;cursor:pointer;}'
      + '.rel-toolbar button:hover{background:#157347;}'
      + '.rel-page{max-width:800px;aspect-ratio:210/297;margin:20px auto;background:#fff;padding:50px;box-shadow:0 1px 4px rgba(0,0,0,0.15);}'
      + '.coment-corpo p{margin:0;text-indent:1.25cm;}'
      + '@media print{.rel-toolbar{display:none;}body{background:#fff;}.rel-page{box-shadow:none;margin:0;max-width:none;aspect-ratio:auto;}}'
      + '</style></head><body>'
      + '<div class="rel-toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>'
      + '<div class="rel-page">' + partes.join('') + '</div>'
      + '</body></html>');
    janela.document.close();
  }

  /* ---------- navegação para a aba Curva ABC, já carregada com o processo ---------- */
  function abrirCurvaAbcDoProcesso(versaoId) {
    var modalDetalhesEl = document.getElementById("modalDetalhes");
    var modalDetalhes = modalDetalhesEl ? bootstrap.Modal.getInstance(modalDetalhesEl) : null;
    if (modalDetalhes) modalDetalhes.hide();

    var processoId = curvaAbcProcessoState.processoId;
    var processoStr = curvaAbcProcessoState.processoStr;
    var descricao = curvaAbcProcessoState.descricao;

    curvaAbcProcessoState.vindoDoModal = true;
    showPane("pane-curva-abc");
    // dá tempo da aba ficar visível antes de carregar/renderizar o gráfico
    // (mesmo padrão de espera usado em main.js para o modal de detalhes, ex.: calcularRepercussao)
    setTimeout(function () {
      if (typeof carregarCurvaAbcDoProcesso === "function") {
        carregarCurvaAbcDoProcesso(processoId, processoStr, versaoId || null, descricao);
      }
    }, 50);
  }

  /* ---------- botão "Nova Curva ABC" de Gerenciar Processo ----------
     Diferente de abrirCurvaAbcDoProcesso: não carrega nenhuma versão existente,
     vai direto pra dropzone (já vinculada ao processo) pronta pra receber a
     planilha da nova análise — vira uma versão nova ao salvar, sem tocar nas
     versões anteriores. */
  function iniciarNovaCurvaAbcDoProcesso() {
    var modalDetalhesEl = document.getElementById("modalDetalhes");
    var modalDetalhes = modalDetalhesEl ? bootstrap.Modal.getInstance(modalDetalhesEl) : null;
    if (modalDetalhes) modalDetalhes.hide();

    var processoId = curvaAbcProcessoState.processoId;
    var processoStr = curvaAbcProcessoState.processoStr;
    var descricao = curvaAbcProcessoState.descricao;

    curvaAbcProcessoState.vindoDoModal = true;
    showPane("pane-curva-abc");
    setTimeout(function () {
      if (typeof carregarCurvaAbcDoProcesso === "function") {
        carregarCurvaAbcDoProcesso(processoId, processoStr, null, descricao, true);
      }
    }, 50);
  }

  /* ---------- botão "Voltar" da Curva ABC, quando aberta a partir de GERENCIAR
     PROCESSO ---------- reabre o mesmo processo direto na aba Análise Técnica,
     em vez de levar à lista geral de Processos (comportamento do botão padrão
     "Processos →", usado quando a Curva ABC é aberta direto pelo card do Início). */
  function voltarCurvaAbcParaProcesso() {
    var processoStr = curvaAbcProcessoState.processoStr;
    curvaAbcProcessoState.vindoDoModal = false;
    if (!processoStr || typeof abrirDetalhes !== "function") {
      showPane("pane-reuniao");
      return;
    }
    showPane("pane-reuniao");
    Promise.resolve(abrirDetalhes(processoStr)).then(function () {
      if (typeof mostrarAbaGerenciarProcesso === "function") mostrarAbaGerenciarProcesso("gp-tab-tecnica-btn");
    });
  }

  window.carregarCurvaAbcResumo = carregarCurvaAbcResumo;
  window.abrirCurvaAbcDoProcesso = abrirCurvaAbcDoProcesso;
  window.iniciarNovaCurvaAbcDoProcesso = iniciarNovaCurvaAbcDoProcesso;
  window.gerarRelatorioTecnicoDoProcesso = gerarRelatorioTecnicoDoProcesso;
  window.excluirVersaoCurvaAbc = excluirVersaoCurvaAbc;
  window.voltarCurvaAbcParaProcesso = voltarCurvaAbcParaProcesso;
})();
