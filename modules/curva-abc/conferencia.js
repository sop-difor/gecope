/* Conferência Orçamentária — complemento da Curva ABC (piloto: escolas).
   Cruza o orçamento aprovado pela fiscalização (a planilha da Curva ABC) com o orçamento
   revisado pela SOP, escolhido na biblioteca de Orçamentos (abas SINTÉTICO e QUADRA).
   O cálculo está em conferencia_motor.js; aqui ficam a leitura dos arquivos, a janela de
   escolha do revisado, a coluna "Conferência" da tabela da Curva ABC (com a janela de
   explicação de cada linha) e as equivalências confirmadas (tabela curva_abc_equivalencias,
   valem para TODOS os processos: confirmou uma vez, qualquer conferência futura já usa).
   Não há tela própria: o resultado é lido na coluna. Nada é aprovado ou reprovado
   automaticamente: a decisão continua nos botões de check e comentário da Curva ABC.
   Aberta por curva_abc.js: window.CvConferencia.abrir(contexto). */
(function () {
  "use strict";

  var M = window.ConferenciaMotor;
  if (!M) return;

  var SITUACAO = {
    acima: { rot: "Quantidade acima da referência", ico: "bi-arrow-up-circle-fill" },
    compativel: { rot: "Quantidade compatível", ico: "bi-check-circle-fill" },
    abaixo: { rot: "Quantidade abaixo da referência", ico: "bi-arrow-down-circle-fill" },
    sem_correspondencia: { rot: "Sem correspondência na planilha revisada", ico: "bi-question-circle-fill" },
    nao_localizado: { rot: "Não localizado no orçamento da fiscalização", ico: "bi-dash-circle-fill" },
    incerta: { rot: "Correspondência incerta", ico: "bi-exclamation-triangle-fill" }
  };
  var VIA = { descricao: "casado por descrição", codigo_na_descricao: "código lido da descrição", manual: "equivalência confirmada" };

  var st = {
    ctx: null, orcamentos: null, orcSel: null, aprovado: [], revisado: [], resultado: [], equiv: [], porConta: {}
  };
  var cacheRevisado = {};   /* arquivo_path -> { itens, abas } (o arquivo é versionado, nunca muda) */

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(v) {
    return (v == null || !isFinite(v)) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtSinal(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + fmt(v);
  }
  function fmtPct(v) { return (v == null || !isFinite(v)) ? "—" : (v > 0 ? "+" : "") + fmt(v) + "%"; }
  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage bloqueado: só não lembra */ } }
  function alerta(titulo, texto, icone) {
    if (typeof Swal === "undefined") { alert(texto ? titulo + "\n\n" + texto : titulo); return; }
    Swal.fire({ icon: icone || "error", title: titulo, html: texto || undefined, confirmButtonColor: "#007233" });
  }
  function processoId() { return st.ctx && st.ctx.processo ? String(st.ctx.processo.id) : null; }

  /* ---------- leitura dos arquivos (SheetJS sob demanda) ---------- */
  function lerWorkbook(buffer, opcoes) {
    return XLSX.read(new Uint8Array(buffer), Object.assign(
      { type: "array", cellFormula: false, cellStyles: false, cellHTML: false, cellNF: false, cellText: false }, opcoes || {}));
  }
  function aoaDaAba(wb, nome) {
    return XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: true });
  }

  /* Revisada: abre só SINTÉTICO e QUADRA. O arquivo completo tem ~14 abas (uma com 20 MB de
     XML); pedir só as duas evita ler o resto. O download é cacheado pelo navegador (o caminho
     tem a versão e o Storage serve com cache de 1 ano). */
  async function lerRevisado(orc) {
    if (cacheRevisado[orc.arquivo_path]) return cacheRevisado[orc.arquivo_path];
    await window.carregarBiblioteca("xlsx");
    var resp = await fetch(await window.urlAssinadaStorage(orc.arquivo_url)); // bucket privado
    if (!resp.ok) throw new Error("Não consegui baixar o orçamento revisado (HTTP " + resp.status + ").");
    var buf = await resp.arrayBuffer();
    var nomes = lerWorkbook(buf, { bookSheets: true }).SheetNames;
    var abas = M.escolherAbas(nomes);
    if (!abas.SINTETICO) throw new Error("A aba SINTÉTICO não foi encontrada neste arquivo. Abas existentes: " + nomes.join(", ") + ".");
    var pedir = [abas.SINTETICO].concat(abas.QUADRA ? [abas.QUADRA] : []);
    var wb = lerWorkbook(buf, { sheets: pedir });
    var sint = M.lerRevisado(aoaDaAba(wb, abas.SINTETICO), "SINTETICO");
    if (sint.erro) throw new Error(sint.erro);
    var quad = abas.QUADRA ? M.lerRevisado(aoaDaAba(wb, abas.QUADRA), "QUADRA") : { itens: [] };
    if (quad.erro) throw new Error(quad.erro);
    var r = { itens: sint.itens.concat(quad.itens), sintetico: sint.itens.length, quadra: quad.itens.length, temQuadra: !!abas.QUADRA };
    cacheRevisado[orc.arquivo_path] = r;
    return r;
  }

  /* ---------- biblioteca de orçamentos ---------- */
  async function carregarOrcamentos() {
    if (st.orcamentos) return st.orcamentos;
    var r = await sbClient.from("orcamentos_biblioteca")
      .select("id,nome_obra,categoria,subcategoria,versao_atual,status,arquivo_url,arquivo_path")
      .eq("categoria", "ESCOLAS").order("subcategoria").order("nome_obra");
    if (r.error) throw r.error;
    st.orcamentos = (r.data || []).filter(function (o) { return o.arquivo_url && /\.xls/i.test(o.arquivo_path || ""); });
    return st.orcamentos;
  }
  function sugerirOrcamento() {
    var lista = st.orcamentos || [], pid = processoId();
    var lembrado = pid ? lsGet("cf_orc:" + pid) : null;
    if (lembrado && lista.some(function (o) { return String(o.id) === lembrado; })) return { id: lembrado, lembrado: true };
    var ref = (st.ctx && st.ctx.textoReferencia) || "";
    var m = /(\d+)\s*salas/i.exec(ref);
    if (m) {
      var achou = lista.filter(function (o) { return new RegExp("(^|\\D)" + m[1] + "\\s*salas", "i").test(o.nome_obra || ""); })[0];
      if (achou) return { id: String(achou.id), lembrado: false };
    }
    return null;
  }

  /* ---------- equivalências confirmadas (banco) ---------- */
  /* Todas as equivalências, de qualquer processo (a tabela é pequena: um registro por serviço
     confirmado). Devolve um aviso (texto) quando não consegue carregar; a conferência segue sem elas. */
  async function carregarEquivalencias() {
    st.equiv = [];
    var r = await sbClient.from("curva_abc_equivalencias").select("fisc_chave,rev_chaves,autor_nome,processo_nup,created_at");
    if (r.error) return "As equivalências confirmadas não puderam ser carregadas (" + r.error.message + "). A conferência segue sem elas.";
    st.equiv = (r.data || []).map(function (x) {
      return {
        fisc: x.fisc_chave, rev: (x.rev_chaves || []).map(function (c) { return c.chave; }), salvo: true,
        autor: x.autor_nome, nup: x.processo_nup, em: x.created_at
      };
    });
    return null;
  }
  async function salvarEquivalencia(fisc, revGrupos) {
    var existente = st.equiv.filter(function (e) { return e.fisc === fisc.chave; })[0];
    var chaves = revGrupos.map(function (g) { return g.chave; });
    var autor = sessionStorage.getItem("sop_user_name") || "Usuário";
    var nup = st.ctx.processo ? st.ctx.processo.processo : null;
    var meta = { rev: chaves, autor: autor, nup: nup, em: new Date().toISOString() };
    if (existente) Object.assign(existente, meta); else st.equiv.push(Object.assign({ fisc: fisc.chave, salvo: false }, meta));
    if (!st.ctx.podeEscrever) return { local: true };
    var pid = processoId();
    var payload = {
      fisc_chave: fisc.chave, processo_id: pid, processo_nup: nup, fisc_codigo: fisc.codigo || null, fisc_descricao: fisc.desc,
      rev_chaves: revGrupos.map(function (g) { return { chave: g.chave, codigo: g.codigo, descricao: g.desc, un: g.un }; }),
      orcamento_id: st.orcSel ? st.orcSel.id : null,
      autor_nome: autor,
      autor_email: (typeof getCurrentUserEmail === "function") ? getCurrentUserEmail() : ""
    };
    var r = await sbClient.from("curva_abc_equivalencias").upsert([payload], { onConflict: "fisc_chave" });
    if (r.error) throw r.error;
    return { local: false };
  }
  async function removerEquivalencia(chaveFisc) {
    st.equiv = st.equiv.filter(function (e) { return e.fisc !== chaveFisc; });
    if (!st.ctx.podeEscrever) return;
    var r = await sbClient.from("curva_abc_equivalencias").delete().eq("fisc_chave", chaveFisc);
    if (r.error) throw r.error;
  }

  /* ---------- execução ---------- */
  /* Lê os dois orçamentos, cruza e deixa o resultado na memória (a coluna da Curva ABC é
     redesenhada por notificar). Lança Error com texto para o analista; devolve os avisos. */
  async function executar(orc) {
    var aoa = await st.ctx.obterAoaAprovado();
    var apr = M.lerAprovado(aoa);
    if (apr.erro) throw new Error(apr.erro);
    var rev = await lerRevisado(orc);
    var avisos = M.validar(apr.itens, rev.itens);
    if (!rev.temQuadra) avisos.push({ nivel: "aviso", texto: "Este arquivo não tem aba QUADRA. Os serviços da quadra, se houver, aparecerão como sem correspondência." });
    var erroFatal = avisos.filter(function (a) { return a.nivel === "erro"; })[0];
    if (erroFatal) throw new Error(erroFatal.texto);
    st.aprovado = apr.itens; st.revisado = rev.itens; st.orcSel = orc;
    var pid = processoId();
    if (pid) lsSet("cf_orc:" + pid, String(orc.id));
    var avisoEquiv = await carregarEquivalencias();
    if (avisoEquiv) avisos.push({ nivel: "aviso", texto: avisoEquiv });
    recalcular();
    return avisos;
  }
  function recalcular() {
    st.resultado = M.cruzar(st.aprovado, st.revisado, { equivalencias: st.equiv });
    st.porConta = {};
    st.resultado.forEach(function (r, i) {
      if (r.fisc) r.fisc.linhas.forEach(function (l) { st.porConta[l.conta] = i; });
    });
    notificar();
  }

  /* ---------- janela de escolha do orçamento revisado ---------- */
  function opcoesOrcamentos(selecionado) {
    var grupos = {};
    st.orcamentos.forEach(function (o) { (grupos[o.subcategoria || "Outros"] = grupos[o.subcategoria || "Outros"] || []).push(o); });
    return Object.keys(grupos).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + grupos[g].map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (String(o.id) === selecionado ? " selected" : "") + ">"
          + esc(o.nome_obra + " — " + (o.versao_atual || "") + (o.status ? " (" + o.status + ")" : "")) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
  }
  /* Resumo dos serviços que aparecem na Curva ABC (os alterados); o orçamento inteiro é
     cruzado, mas só eles ganham símbolo na coluna. */
  function resumoHtml(orc, avisos) {
    var cont = { acima: 0, abaixo: 0, compativel: 0, sem_correspondencia: 0, incerta: 0 }, n = 0;
    var naCurva = {};
    (st.ctx.itensCurva() || []).forEach(function (it) { naCurva[it.conta] = true; });
    st.resultado.forEach(function (r) {
      if (r.fisc && cont[r.status] != null && r.fisc.linhas.some(function (l) { return naCurva[l.conta]; })) { cont[r.status]++; n++; }
    });
    var h = '<div style="text-align:left;font-size:14px;line-height:1.5">'
      + "Orçamento revisado: <b>" + esc(orc.nome_obra) + " — " + esc(orc.versao_atual || "") + "</b>.<br>"
      + "Dos <b>" + n + "</b> serviços da Curva ABC: <b>" + cont.acima + "</b> acima · <b>" + cont.abaixo + "</b> abaixo · <b>"
      + cont.compativel + "</b> compatíveis · <b>" + cont.sem_correspondencia + "</b> sem correspondência · <b>" + cont.incerta + "</b> a conferir.<br><br>"
      + "Clique no símbolo da coluna <b>Conferência</b> para ver a explicação de cada serviço.";
    var notas = avisos.filter(function (a) { return a.nivel !== "erro"; });
    if (notas.length) h += '<ul style="margin:12px 0 0;padding-left:18px;font-size:13px">' + notas.map(function (a) { return "<li>" + esc(a.texto) + "</li>"; }).join("") + "</ul>";
    return h + "</div>";
  }

  async function abrir(ctx) {
    st.ctx = ctx;
    if (typeof Swal === "undefined") { alert("Não foi possível abrir a conferência: a biblioteca de janelas não carregou. Recarregue a página."); return; }
    try {
      await carregarOrcamentos();
    } catch (ex) {
      alerta("Não consegui carregar os orçamentos", "Biblioteca de orçamentos: " + esc(ex.message || ex));
      return;
    }
    if (!st.orcamentos.length) { alerta("Sem orçamentos de escolas", "Não há orçamentos de escolas na biblioteca de Orçamentos.", "info"); return; }
    var sug = sugerirOrcamento(), conferida = ativa();
    var padrao = conferida && st.orcSel ? String(st.orcSel.id) : (sug ? sug.id : "");
    var dica = !conferida && sug && !sug.lembrado
      ? '<div style="margin-top:8px;font-size:12px;opacity:.8"><b>Sugestão:</b> escolhi pelo número de salas do arquivo. Confira se é o correto.</div>' : "";
    var r = await Swal.fire({
      title: "Conferência orçamentária",
      html: '<div style="text-align:left"><label for="cf-sel" style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">'
        + "Orçamento revisado pela SOP (biblioteca de Orçamentos)</label>"
        + '<select id="cf-sel" class="swal2-select" style="width:100%;margin:0;max-width:100%"><option value="">Selecione…</option>' + opcoesOrcamentos(padrao) + "</select>"
        + dica + "</div>",
      showCancelButton: true, showDenyButton: conferida, reverseButtons: true,
      confirmButtonText: conferida ? "Conferir de novo" : "Conferir", denyButtonText: "Remover coluna", cancelButtonText: "Cancelar",
      confirmButtonColor: "#007233", denyButtonColor: "#64798c", cancelButtonColor: "#64798c",
      allowOutsideClick: function () { return !Swal.isLoading(); },
      preConfirm: async function () {
        var id = document.getElementById("cf-sel").value;
        var orc = st.orcamentos.filter(function (o) { return String(o.id) === id; })[0];
        if (!orc) { Swal.showValidationMessage("Escolha o orçamento revisado."); return false; }
        try {
          return { orc: orc, avisos: await executar(orc) };
        } catch (ex) {
          console.error("Conferência orçamentária:", ex);
          Swal.showValidationMessage(esc(ex && ex.message ? ex.message : ex));
          return false;
        }
      }
    });
    if (r.isDenied) { limpar(); notificar(); return; }
    if (!r.isConfirmed || !r.value) return;
    Swal.fire({ icon: "success", title: "Conferência concluída", html: resumoHtml(r.value.orc, r.value.avisos), confirmButtonColor: "#007233" });
  }

  /* ---------- janela de explicação (aberta pela coluna na Curva ABC) ---------- */
  function tituloCurto(r) {
    var t = SITUACAO[r.status].rot;
    if (r.fisc && r.qtdRev != null) t += ": fiscalização " + fmt(r.fisc.qtd) + " × revisada " + fmt(r.qtdRev) + (r.pct != null ? " (" + fmtPct(r.pct) + ")" : "");
    return t;
  }
  function unidade(r) { return (r.fisc || r.rev[0]).un; }
  function explicacao(r) {
    var un = esc(unidade(r)), f = r.fisc ? fmt(r.fisc.qtd) : "", rv = r.qtdRev != null ? fmt(r.qtdRev) : "";
    var lado = r.dif > 0 ? "acima" : "abaixo";
    switch (r.status) {
      case "acima":
      case "abaixo":
        return "A fiscalização aprovou <b>" + f + " " + un + "</b> no total e a planilha revisada da SOP prevê <b>" + rv + " " + un + "</b>. "
          + "A quantidade aprovada está <b>" + fmt(Math.abs(r.dif)) + " " + un + (r.pct != null ? " (" + fmt(Math.abs(r.pct)) + "%)" : "") + " " + lado + "</b> da referência."
          + (r.pct == null ? " Como a revisada prevê zero, não há percentual." : "");
      case "compativel":
        return "A quantidade aprovada pela fiscalização (<b>" + f + " " + un + "</b>) é igual à prevista na planilha revisada (até a 2ª casa decimal).";
      case "sem_correspondencia":
        return "Este serviço consta no orçamento da fiscalização, mas <b>não foi localizado na planilha revisada</b>. Pode ter mudado de código ou de descrição. Se você souber qual serviço da revisada corresponde a ele, use <i>Vincular…</i>.";
      case "nao_localizado":
        return "Este serviço consta na planilha revisada (<b>" + rv + " " + un + "</b>), mas <b>não foi identificado no orçamento da fiscalização</b>.";
      default:
        return "O sistema <b>não conseguiu garantir</b> que este serviço equivale ao da planilha revisada. " + esc(r.motivo || "") + " Confira e, se for o mesmo serviço, confirme abaixo; a comparação passa a valer em seguida.";
    }
  }
  function comoFoiCasado(r) {
    if (!r.rev.length) return "";
    var f = r.fisc, g = r.rev[0];
    if (r.via === "manual") {
      var e = st.equiv.filter(function (x) { return r.fisc && x.fisc === r.fisc.chave; })[0] || {};
      var quando = e.em ? new Date(e.em).toLocaleDateString("pt-BR") : "";
      return "Equivalência confirmada por " + (e.autor ? "<b>" + esc(e.autor) + "</b>" : "um analista") + (quando ? " em " + quando : "")
        + (e.nup ? ", no processo " + esc(e.nup) : "") + (r.rev.length > 1 ? " (soma de " + r.rev.length + " serviços da revisada)" : "")
        + ". Vale para todos os processos.";
    }
    if (r.via === "descricao") return "O serviço não tem código válido; foi casado pela <b>descrição idêntica e mesma unidade</b> (" + esc(g.un) + ").";
    if (r.via === "codigo_na_descricao") return "O código <b>" + esc((f && f.codigo) || g.codigo) + "</b> estava escrito na descrição do serviço e coincide com o da planilha revisada.";
    return "Mesmo código (<b>" + esc(g.codigo) + "</b>) e mesma unidade (" + esc(g.un) + "). Quando o serviço aparece em mais de um item, as quantidades são somadas nos dois lados.";
  }
  /* Listas em <div>, não <table>: o style.css do app redesenha qualquer tabela dentro de janelas
     do SweetAlert (cores e !important que mudam com o tema). */
  function listaLinhas(linhas, destaque) {
    var total = linhas.reduce(function (s, l) { return s + l.qtd; }, 0);
    return '<div class="cfm-lista"><div class="cfm-lh"><span>Origem</span><span>Item</span><span class="n">Qtd.</span></div>'
      + linhas.map(function (l) {
        return '<div class="cfm-lr' + (destaque && l.conta === destaque ? " dest" : "") + '"><span>'
          + (l.origem === "APROVADO" ? "Fiscalização" : (l.origem === "QUADRA" ? "Aba QUADRA" : "Aba SINTÉTICO")) + "</span><span>" + esc(l.conta) + '</span><span class="n">' + fmt(l.qtd) + "</span></div>";
      }).join("")
      + (linhas.length > 1 ? '<div class="cfm-lr tot"><span>Total</span><span></span><span class="n">' + fmt(total) + "</span></div>" : "")
      + "</div>";
  }
  function dialogoHtml(r, contaDestaque) {
    var s = SITUACAO[r.status], ref = r.fisc || r.rev[0];
    var h = '<div class="cfm-sit ' + r.status + '"><i class="bi ' + s.ico + '" aria-hidden="true"></i>' + s.rot + "</div>"
      + '<div class="cfm-srv"><b>' + esc(ref.codigo || "(sem código)") + "</b> · " + esc(ref.desc) + ' <span class="un">' + esc(ref.un) + "</span></div>";
    if (r.fisc || r.qtdRev != null) {
      h += '<div class="cfm-num">'
        + '<div><small>Fiscalização</small><b>' + (r.fisc ? fmt(r.fisc.qtd) : "—") + "</b></div>"
        + '<div><small>Planilha revisada</small><b>' + (r.qtdRev != null ? fmt(r.qtdRev) : "—") + "</b></div>"
        + '<div class="d ' + r.status + '"><small>Diferença</small><b>' + (r.dif != null ? fmtSinal(r.dif) : "—") + "</b><em>" + (r.pct != null ? fmtPct(r.pct) : "&nbsp;") + "</em></div></div>";
    }
    h += '<p class="cfm-expl">' + explicacao(r) + "</p>";
    var como = comoFoiCasado(r);
    if (como) h += '<p class="cfm-como">' + como + "</p>";
    if (r.fisc || r.rev.length) {
      h += '<div class="cfm-grade">';
      if (r.fisc) h += "<div><h4>Orçamento da fiscalização</h4>" + listaLinhas(r.fisc.linhas, contaDestaque) + "</div>";
      if (r.rev.length) h += "<div><h4>Planilha revisada (SOP)</h4>" + r.rev.map(function (g) {
        return (r.rev.length > 1 ? '<div class="cfm-g">' + esc(g.codigo || "(sem código)") + " · " + esc(g.desc) + "</div>" : "") + listaLinhas(g.linhas);
      }).join("") + "</div>";
      h += "</div>";
    }
    if (r.candidatos && r.candidatos.length) {
      h += "<h4>Candidatos da revisada (não confirmados)</h4>" + r.candidatos.map(function (c, k) {
        return '<div class="cfm-cand"><div><b>' + esc(c.codigo || "(sem código)") + "</b> · " + esc(c.desc) + "<small>" + esc(c.un) + " · " + fmt(c.qtd)
          + (c.score < 1 ? " · semelhança " + Math.round(c.score * 100) + "%" : "") + "</small></div>"
          + '<button type="button" class="cfm-btn" data-pop="confirmar" data-k="' + k + '">É o mesmo serviço</button></div>';
      }).join("");
    }
    var acoes = "";
    if (r.via === "manual") acoes = '<button type="button" class="cfm-btn sec" data-pop="desfazer">Desfazer equivalência</button>';
    else if (r.status === "incerta" || r.status === "sem_correspondencia") acoes = '<button type="button" class="cfm-btn sec" data-pop="vincular">Vincular a outro serviço…</button>';
    if (acoes) h += '<div class="cfm-acoes">' + acoes + "</div>";
    h += '<p class="cfm-nota">Esta conferência só aponta diferenças. A decisão (OK ou inconsistência) e o comentário são seus, registrados na Curva ABC.</p>';
    return h;
  }
  /* Diálogo próprio (fora do SweetAlert): Esc, clique fora e o botão fecham; o foco volta para
     quem abriu. Resolve com a ação escolhida pelo analista, ou null. */
  function mostrarDialogo(html) {
    return new Promise(function (resolve) {
      var anterior = document.activeElement, overflow = document.body.style.overflow;
      var fundo = document.createElement("div");
      fundo.className = "cfm-fundo"; fundo.setAttribute("role", "dialog"); fundo.setAttribute("aria-modal", "true"); fundo.setAttribute("aria-labelledby", "cfm-titulo");
      fundo.innerHTML = '<div class="cfm"><button type="button" class="cfm-x" data-pop="fechar" aria-label="Fechar">&times;</button>'
        + '<h3 id="cfm-titulo">Conferência orçamentária</h3>' + html + "</div>";
      function fechar(acao) {
        document.removeEventListener("keydown", tecla, true);
        fundo.remove(); document.body.style.overflow = overflow;
        if (anterior && anterior.focus) anterior.focus();
        resolve(acao);
      }
      function tecla(e) {
        if (e.key === "Escape") { e.stopPropagation(); fechar(null); return; }
        if (e.key !== "Tab") return;
        var foco = fundo.querySelectorAll("button"); if (!foco.length) return;
        var primeiro = foco[0], ultimo = foco[foco.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
      fundo.addEventListener("click", function (e) {
        if (e.target === fundo) { fechar(null); return; }
        var b = e.target.closest("[data-pop]"); if (!b) return;
        var nome = b.getAttribute("data-pop");
        fechar(nome === "fechar" ? null : { nome: nome, k: parseInt(b.getAttribute("data-k"), 10) });
      });
      document.addEventListener("keydown", tecla, true);
      document.body.appendChild(fundo); document.body.style.overflow = "hidden";
      fundo.querySelector(".cfm-x").focus();
    });
  }
  async function abrirDialogo(i, contaDestaque) {
    var r = st.resultado[i];
    if (!r) return;
    var acao = await mostrarDialogo(dialogoHtml(r, contaDestaque));
    if (!acao) return;
    if (acao.nome === "confirmar") await confirmarCandidato(r, acao.k);
    else if (acao.nome === "vincular") await vincular(r);
    else if (acao.nome === "desfazer") await desfazer(r);
  }

  /* ---------- coluna "Conferência" na tabela da Curva ABC ---------- */
  function ativa() { return st.resultado.length > 0; }
  function celulaDaConta(conta) {
    var i = st.porConta[conta];
    if (i == null || !st.resultado[i]) return '<td class="cv-col-conf cv-center"></td>';
    var r = st.resultado[i], s = SITUACAO[r.status], t = tituloCurto(r);
    return '<td class="cv-col-conf cv-center"><button type="button" class="cv-conf-ico ' + r.status + '" data-conf-conta="' + esc(conta) + '" title="' + esc(t + " — clique para ver a explicação") + '" aria-label="' + esc(t + ". Clique para ver a explicação.") + '"><i class="bi ' + s.ico + '" aria-hidden="true"></i></button></td>';
  }
  function limpar() { st.resultado = []; st.porConta = {}; }
  function detalheDaConta(conta) {
    var i = st.porConta[conta];
    if (i != null && st.resultado[i]) abrirDialogo(i, conta);
  }
  function notificar() {
    if (st.ctx && typeof st.ctx.aoAtualizar === "function") st.ctx.aoAtualizar();
  }

  /* ---------- ações ---------- */
  function grupoPorChave(chave) {
    var achado = null;
    st.resultado.forEach(function (r) { r.rev.forEach(function (g) { if (g.chave === chave) achado = g; }); r.candidatos.forEach(function (g) { if (g.chave === chave) achado = achado || g; }); });
    return achado;
  }
  async function gravar(fisc, revGrupos) {
    try {
      var res = await salvarEquivalencia(fisc, revGrupos);
      recalcular();
      if (res.local) alerta("Equivalência só nesta sessão", "Só o perfil de analista (admin/gerente) grava equivalências. Ela vale até você refazer a conferência ou enviar outra planilha.", "info");
    } catch (ex) {
      st.equiv = st.equiv.filter(function (e) { return e.fisc !== fisc.chave; });
      alerta("Não consegui salvar a equivalência", esc(ex.message || ex) + (/curva_abc_equivalencias/.test(ex.message || "") ? "<br><br>A tabela <code>curva_abc_equivalencias</code> ainda não foi criada no banco (sql/curva_abc_conferencia_equivalencias.sql)." : ""));
    }
  }
  async function confirmarCandidato(r, k) {
    var c = r.candidatos[k];
    if (!c) return;
    var ok = await perguntar("Confirmar equivalência?",
      "<b>Fiscalização:</b> " + esc(r.fisc.codigo || "(sem código)") + " · " + esc(r.fisc.desc) + "<br><b>Revisada:</b> " + esc(c.codigo || "(sem código)") + " · " + esc(c.desc)
      + "<br><br>As quantidades dos dois serviços passarão a ser comparadas. Isso fica registrado em seu nome e <b>vale para todos os processos</b>.");
    if (!ok) return;
    var g = grupoPorChave(c.chave);
    await gravar(r.fisc, [g || c]);
  }
  async function desfazer(r) {
    var ok = await perguntar("Desfazer equivalência?", "O serviço volta a ser tratado pelas regras automáticas, em <b>todos os processos</b>.");
    if (!ok) return;
    try { await removerEquivalencia(r.fisc.chave); recalcular(); }
    catch (ex) { alerta("Não consegui desfazer", esc(ex.message || ex)); }
  }

  async function vincular(r) {
    var un = M._interno.normUn(r.fisc.un);
    var livres = [];
    st.resultado.forEach(function (x) { if (x.status === "nao_localizado" && M._interno.normUn(x.rev[0].un) === un) livres.push(x.rev[0]); });
    (r.candidatos || []).forEach(function (c) { if (!livres.some(function (g) { return g.chave === c.chave; }) && M._interno.normUn(c.un) === un) livres.push(grupoPorChave(c.chave) || c); });
    if (!livres.length) { alerta("Nenhum serviço disponível", "Não há serviço sem par na planilha revisada com a unidade " + esc(r.fisc.un) + ".", "info"); return; }
    var pref = {};
    (r.candidatos || []).forEach(function (c) { pref[c.chave] = true; });
    var escolhidos = await escolher({
      titulo: "Vincular a serviço(s) da planilha revisada",
      cabecalho: "<b>" + esc(r.fisc.codigo || "(sem código)") + "</b> · " + esc(r.fisc.desc) + " — " + fmt(r.fisc.qtd) + " " + esc(r.fisc.un),
      itens: livres.map(function (g) { return { valor: g.chave, cod: g.codigo, desc: g.desc, un: g.un, qtd: g.qtd, destaque: !!pref[g.chave] }; }),
      multiplo: true, refQtd: r.fisc.qtd
    });
    if (!escolhidos) return;
    await gravar(r.fisc, escolhidos.map(function (ch) { return livres.filter(function (g) { return g.chave === ch; })[0]; }));
  }

  async function perguntar(titulo, html) {
    if (typeof Swal === "undefined") return confirm(titulo);
    var r = await Swal.fire({
      icon: "question", title: titulo, html: html, showCancelButton: true, confirmButtonText: "Sim, confirmar",
      cancelButtonText: "Cancelar", confirmButtonColor: "#007233", cancelButtonColor: "#64798c", reverseButtons: true
    });
    return r.isConfirmed;
  }

  /* Janela de escolha com busca; mostra a soma das quantidades selecionadas para o analista
     ver, antes de confirmar, o que a equivalência vai comparar. */
  async function escolher(o) {
    if (typeof Swal === "undefined") return null;
    var html = '<div class="cf-pick"><div style="margin-bottom:8px;font-size:13px">' + o.cabecalho + "</div>"
      + '<input type="text" id="cf-pick-q" placeholder="Buscar por código ou descrição" aria-label="Buscar">'
      + '<div class="lista" id="cf-pick-lista">'
      + o.itens.sort(function (a, b) { return (b.destaque ? 1 : 0) - (a.destaque ? 1 : 0); }).map(function (it) {
        return '<label data-t="' + esc(norm(it.cod + " " + it.desc)) + '"><input type="' + (o.multiplo ? "checkbox" : "radio") + '" name="cf-pick" value="' + esc(it.valor) + '" data-q="' + it.qtd + '">'
          + '<span><span class="c">' + esc(it.cod || "(sem código)") + "</span> · " + esc(it.desc) + (it.destaque ? " <b>(sugerido)</b>" : "") + '</span><span class="q">' + fmt(it.qtd) + " " + esc(it.un) + "</span></label>";
      }).join("") + '</div><div class="tot" id="cf-pick-tot">Nada selecionado.</div></div>';
    var r = await Swal.fire({
      title: o.titulo, html: html, width: 760, showCancelButton: true, confirmButtonText: "Vincular", cancelButtonText: "Cancelar",
      confirmButtonColor: "#007233", cancelButtonColor: "#64798c", reverseButtons: true,
      didOpen: function (el) {
        var q = el.querySelector("#cf-pick-q"), lista = el.querySelector("#cf-pick-lista"), tot = el.querySelector("#cf-pick-tot");
        q.addEventListener("input", function () {
          var t = norm(q.value);
          lista.querySelectorAll("label").forEach(function (l) { l.style.display = l.getAttribute("data-t").indexOf(t) > -1 ? "" : "none"; });
        });
        lista.addEventListener("change", function () {
          var soma = 0, n = 0;
          lista.querySelectorAll("input:checked").forEach(function (i) { soma += parseFloat(i.getAttribute("data-q")) || 0; n++; });
          tot.innerHTML = n ? n + " selecionado(s) · soma " + fmt(soma) + " (outro lado: " + fmt(o.refQtd) + ")" : "Nada selecionado.";
        });
      },
      preConfirm: function () {
        var marcados = Array.prototype.map.call(document.querySelectorAll("#cf-pick-lista input:checked"), function (i) { return i.value; });
        if (!marcados.length) { Swal.showValidationMessage("Selecione ao menos um serviço."); return false; }
        return marcados;
      }
    });
    return r.isConfirmed ? r.value : null;
  }

  window.CvConferencia = { abrir: abrir, ativa: ativa, celula: celulaDaConta, detalhe: detalheDaConta, limpar: limpar };
})();
