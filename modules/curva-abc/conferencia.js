/* Conferência Orçamentária — tela complementar da Curva ABC (piloto: escolas).
   Cruza o orçamento aprovado pela fiscalização (a planilha da Curva ABC) com o orçamento
   revisado pela SOP, escolhido na biblioteca de Orçamentos (abas SINTÉTICO e QUADRA).
   O cálculo está em conferencia_motor.js; aqui ficam só leitura dos arquivos, tela e as
   equivalências confirmadas (tabela curva_abc_equivalencias). Nada é aprovado ou reprovado
   automaticamente: a decisão continua nos botões de check e comentário da Curva ABC.
   Aberta por curva_abc.js: window.CvConferencia.abrir(contexto). */
(function () {
  "use strict";

  var pane = document.getElementById("pane-curva-abc");
  var M = window.ConferenciaMotor;
  if (!pane || !M) return;

  var SITUACAO = {
    acima: { rot: "Quantidade acima da referência", ico: "bi-arrow-up-circle-fill" },
    compativel: { rot: "Quantidade compatível", ico: "bi-check-circle-fill" },
    abaixo: { rot: "Quantidade abaixo da referência", ico: "bi-arrow-down-circle-fill" },
    sem_correspondencia: { rot: "Sem correspondência na planilha revisada", ico: "bi-question-circle-fill" },
    nao_localizado: { rot: "Não localizado no orçamento da fiscalização", ico: "bi-dash-circle-fill" },
    incerta: { rot: "Correspondência incerta", ico: "bi-exclamation-triangle-fill" }
  };
  var VIA = { descricao: "casado por descrição", codigo_na_descricao: "código lido da descrição", manual: "equivalência confirmada" };
  var FILTROS = {
    todos: null,
    dif: ["acima", "abaixo"],
    sem: ["sem_correspondencia", "nao_localizado"],
    conf: ["incerta"],
    ok: ["compativel"]
  };

  var st = {
    ctx: null, orcamentos: null, orcSel: null, aprovado: [], revisado: [], resultado: [], equiv: [],
    infoAprovado: "", infoRevisado: "", avisos: [], erro: "", ocupado: false,
    filtro: "todos", ocultarOk: false, busca: "", ordem: "curva", porConta: {}
  };
  var cacheRevisado = {};   /* arquivo_path -> { itens, abas } (o arquivo é versionado, nunca muda) */
  var tela = null;

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
    var resp = await fetch(orc.arquivo_url);
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
  async function carregarEquivalencias() {
    st.equiv = [];
    var pid = processoId();
    if (!pid) return;
    var r = await sbClient.from("curva_abc_equivalencias").select("fisc_chave,rev_chaves").eq("processo_id", pid);
    if (r.error) {
      st.avisos.push({ nivel: "aviso", texto: "As equivalências confirmadas não puderam ser carregadas (" + r.error.message + "). A conferência segue sem elas." });
      return;
    }
    st.equiv = (r.data || []).map(function (x) {
      return { fisc: x.fisc_chave, rev: (x.rev_chaves || []).map(function (c) { return c.chave; }), salvo: true };
    });
  }
  async function salvarEquivalencia(fisc, revGrupos) {
    var existente = st.equiv.filter(function (e) { return e.fisc === fisc.chave; })[0];
    var chaves = revGrupos.map(function (g) { return g.chave; });
    if (existente) existente.rev = chaves; else st.equiv.push({ fisc: fisc.chave, rev: chaves, salvo: false });
    var pid = processoId();
    if (!pid || !st.ctx.podeEscrever) return { local: true };
    var payload = {
      processo_id: pid, fisc_chave: fisc.chave, fisc_codigo: fisc.codigo || null, fisc_descricao: fisc.desc,
      rev_chaves: revGrupos.map(function (g) { return { chave: g.chave, codigo: g.codigo, descricao: g.desc, un: g.un }; }),
      orcamento_id: st.orcSel ? st.orcSel.id : null,
      autor_nome: sessionStorage.getItem("sop_user_name") || "Usuário",
      autor_email: (typeof getCurrentUserEmail === "function") ? getCurrentUserEmail() : ""
    };
    var r = await sbClient.from("curva_abc_equivalencias").upsert([payload], { onConflict: "processo_id,fisc_chave" });
    if (r.error) throw r.error;
    return { local: false };
  }
  async function removerEquivalencia(chaveFisc) {
    st.equiv = st.equiv.filter(function (e) { return e.fisc !== chaveFisc; });
    var pid = processoId();
    if (!pid || !st.ctx.podeEscrever) return;
    var r = await sbClient.from("curva_abc_equivalencias").delete().eq("processo_id", pid).eq("fisc_chave", chaveFisc);
    if (r.error) throw r.error;
  }

  /* ---------- execução ---------- */
  async function executar() {
    if (st.ocupado) return;
    var sel = tela.querySelector("#cf-sel");
    var orc = (st.orcamentos || []).filter(function (o) { return String(o.id) === sel.value; })[0];
    if (!orc) { alerta("Escolha o orçamento revisado", "Selecione na lista o orçamento revisado da SOP que servirá de referência.", "info"); return; }
    st.ocupado = true; st.erro = ""; st.avisos = []; st.resultado = [];
    st.orcSel = orc;
    marcarOcupado(true, "Lendo os orçamentos…");
    try {
      var aoa = await st.ctx.obterAoaAprovado();
      var apr = M.lerAprovado(aoa);
      if (apr.erro) throw new Error(apr.erro);
      st.aprovado = apr.itens;
      var rev = await lerRevisado(orc);
      st.revisado = rev.itens;
      var alt = apr.itens.filter(function (x) { return x.alterado; }).length;
      st.infoAprovado = apr.itens.length + " serviços (" + alt + " alterados pela fiscalização, " + (apr.itens.length - alt) + " inalterados)";
      st.infoRevisado = esc(orc.nome_obra) + " · " + esc(orc.versao_atual || "") + " · SINTÉTICO " + rev.sintetico + " serviços"
        + (rev.temQuadra ? " · QUADRA " + rev.quadra + " serviços" : " · sem aba QUADRA");
      st.avisos = M.validar(apr.itens, rev.itens);
      if (!rev.temQuadra) st.avisos.push({ nivel: "aviso", texto: "Este arquivo não tem aba QUADRA. Os serviços da quadra, se houver, aparecerão como sem correspondência." });
      var pid = processoId();
      if (pid) lsSet("cf_orc:" + pid, String(orc.id));
      await carregarEquivalencias();
      if (!st.avisos.some(function (a) { return a.nivel === "erro"; })) recalcular();
    } catch (ex) {
      console.error("Conferência orçamentária:", ex);
      st.erro = ex && ex.message ? ex.message : String(ex);
    } finally {
      st.ocupado = false;
      marcarOcupado(false);
      render();
      if (!st.resultado.length) { st.porConta = {}; notificar(); }
    }
  }
  function recalcular() {
    st.resultado = M.cruzar(st.aprovado, st.revisado, { equivalencias: st.equiv });
    st.porConta = {};
    st.resultado.forEach(function (r, i) {
      if (r.fisc) r.fisc.linhas.forEach(function (l) { st.porConta[l.conta] = i; });
    });
    notificar();
  }

  /* ---------- tela ---------- */
  function criarTela() {
    if (tela) return;
    tela = document.createElement("div");
    tela.id = "cf-tela";
    tela.innerHTML =
      '<div class="cf-topo">'
      + '<button type="button" class="cf-ghost" id="cf-voltar"><i class="bi bi-arrow-left"></i> Voltar à Curva ABC</button>'
      + '<div><h2>Conferência Orçamentária</h2><div class="cf-sub" id="cf-sub"></div></div>'
      + '<span class="cf-grow"></span></div>'
      + '<div class="cf-card"><div class="cf-card-b">'
      + '<div class="cf-ref"><div class="cf-ctl"><label for="cf-sel">Orçamento revisado pela SOP (biblioteca de Orçamentos)</label>'
      + '<select id="cf-sel"><option value="">Carregando…</option></select></div>'
      + '<button type="button" class="cf-primario" id="cf-exec"><i class="bi bi-intersect"></i> Conferir</button></div>'
      + '<div id="cf-msgs"></div></div></div>'
      + '<div id="cf-corpo"></div>';
    pane.appendChild(tela);
    tela.querySelector("#cf-voltar").addEventListener("click", fechar);
    tela.querySelector("#cf-exec").addEventListener("click", executar);
    tela.addEventListener("click", aoClicar);
    tela.addEventListener("input", function (e) {
      if (e.target.id === "cf-busca") { st.busca = e.target.value; clearTimeout(criarTela._t); criarTela._t = setTimeout(renderTabela, 200); }
    });
    tela.addEventListener("change", function (e) {
      if (e.target.id === "cf-ordem") { st.ordem = e.target.value; renderTabela(); }
      if (e.target.id === "cf-ocultar") { st.ocultarOk = e.target.checked; renderTabela(); }
    });
  }
  function marcarOcupado(on, texto) {
    var b = tela.querySelector("#cf-exec");
    b.disabled = on;
    b.innerHTML = on ? esc(texto || "Aguarde…") : '<i class="bi bi-intersect"></i> Conferir';
  }

  async function abrir(ctx) {
    st.ctx = ctx;
    criarTela();
    pane.classList.add("cf-aberta");
    window.scrollTo(0, 0);
    var sub = ctx.processo ? "Processo " + esc(ctx.processo.processo) : "Curva ABC sem processo vinculado — as equivalências confirmadas valem só nesta tela";
    tela.querySelector("#cf-sub").innerHTML = sub + " · piloto: escolas (abas SINTÉTICO e QUADRA)";
    st.erro = "";
    st.filtro = "todos"; st.busca = ""; st.ocultarOk = false; st.ordem = "curva";
    tela.querySelector("#cf-msgs").innerHTML = "";
    render();
    try {
      await carregarOrcamentos();
    } catch (ex) {
      st.erro = "Não consegui carregar a biblioteca de orçamentos: " + (ex.message || ex);
      render();
      return;
    }
    var sel = tela.querySelector("#cf-sel");
    sel.innerHTML = '<option value="">Selecione o orçamento revisado…</option>';
    var grupos = {};
    st.orcamentos.forEach(function (o) { (grupos[o.subcategoria || "Outros"] = grupos[o.subcategoria || "Outros"] || []).push(o); });
    Object.keys(grupos).forEach(function (g) {
      var og = document.createElement("optgroup"); og.label = g;
      grupos[g].forEach(function (o) {
        var op = document.createElement("option"); op.value = o.id;
        op.textContent = o.nome_obra + " — " + (o.versao_atual || "") + (o.status ? " (" + o.status + ")" : "");
        og.appendChild(op);
      });
      sel.appendChild(og);
    });
    var sug = sugerirOrcamento();
    if (st.resultado.length && st.orcSel) sel.value = String(st.orcSel.id);
    else if (sug) {
      sel.value = sug.id;
      if (sug.lembrado) executar();
      else tela.querySelector("#cf-msgs").innerHTML = '<div class="cf-aviso"><b>Sugestão:</b> escolhi o orçamento pelo número de salas do arquivo. Confira se é o correto antes de conferir.</div>';
    }
    if (!st.orcamentos.length) st.erro = "Não há orçamentos de escolas na biblioteca de Orçamentos.";
    render();
  }
  function fechar() {
    pane.classList.remove("cf-aberta");
  }

  /* ---------- renderização ---------- */
  function render() {
    var msgs = "";
    if (st.erro) msgs += '<div class="cf-aviso erro" role="alert"><b>Não foi possível conferir.</b> ' + esc(st.erro) + "</div>";
    st.avisos.forEach(function (a) {
      msgs += '<div class="cf-aviso ' + (a.nivel === "erro" ? "erro" : (a.nivel === "aviso" ? "aviso" : "")) + '">' + (a.nivel === "erro" ? "<b>Erro:</b> " : "") + esc(a.texto) + "</div>";
    });
    if (st.infoAprovado) {
      msgs = '<div class="cf-aviso"><b>Aprovado pela fiscalização:</b> ' + esc(st.infoAprovado) + "<br><b>Revisado pela SOP:</b> " + st.infoRevisado + "</div>" + msgs;
    }
    var m = tela.querySelector("#cf-msgs");
    if (st.infoAprovado || st.erro || st.avisos.length) m.innerHTML = msgs;

    var corpo = tela.querySelector("#cf-corpo");
    if (!st.resultado.length) { corpo.innerHTML = ""; return; }
    var r = M.resumir(st.resultado);
    function kpi(chave, cls, n, rot) {
      return '<button type="button" class="cf-kpi ' + cls + '" data-filtro="' + chave + '" aria-pressed="' + (st.filtro === chave) + '">'
        + '<span class="n">' + n + '</span><span class="r">' + rot + "</span></button>";
    }
    corpo.innerHTML =
      '<div class="cf-resumo">'
      + kpi("todos", "k-todos", r.analisados, "serviços analisados" + (r.nao_localizado ? " (+" + r.nao_localizado + " só na revisada)" : ""))
      + kpi("dif", "k-dif", r.comDiferenca, "com diferença (" + r.acima + " acima · " + r.abaixo + " abaixo)")
      + kpi("sem", "k-sem", r.semCorrespondencia, "sem correspondência (" + r.sem_correspondencia + " só na fiscalização · " + r.nao_localizado + " só na revisada)")
      + kpi("conf", "k-conf", r.conferir, "a conferir manualmente")
      + kpi("ok", "k-ok", r.compativel, "quantidade compatível")
      + "</div>"
      + '<div class="cf-card"><div class="cf-barra">'
      + '<input type="text" id="cf-busca" placeholder="Filtrar por descrição ou código" value="' + esc(st.busca) + '" aria-label="Filtrar serviços">'
      + '<select id="cf-ordem" aria-label="Ordenação"><option value="curva"' + (st.ordem === "curva" ? " selected" : "") + '>Ordem da Curva ABC (A, B, C)</option>'
      + '<option value="planilha"' + (st.ordem === "planilha" ? " selected" : "") + '>Ordem da planilha</option>'
      + '<option value="diferenca"' + (st.ordem === "diferenca" ? " selected" : "") + '>Maior diferença primeiro</option></select>'
      + '<label class="cf-chk"><input type="checkbox" id="cf-ocultar"' + (st.ocultarOk ? " checked" : "") + '> Ocultar compatíveis</label>'
      + '<span class="cf-n" id="cf-n"></span></div>'
      + '<div class="cf-scroll"><table><thead><tr><th></th><th>Serviço</th><th>Código</th><th>UN</th>'
      + '<th class="num">Qtd. fiscalização</th><th class="num">Qtd. revisada</th><th class="num">Diferença</th><th class="num">Dif. %</th>'
      + '<th>Situação</th><th>Na Curva ABC</th><th>Ações</th></tr></thead><tbody id="cf-tbody"></tbody></table></div></div>';
    renderTabela();
  }

  function dentroDoFiltro(r) {
    var lista = FILTROS[st.filtro];
    if (lista && lista.indexOf(r.status) < 0) return false;
    if (st.ocultarOk && r.status === "compativel") return false;
    if (st.busca) {
      var g = r.fisc || r.rev[0];
      var alvo = norm(g.desc + " " + g.codigo + " " + r.rev.map(function (x) { return x.codigo + " " + x.desc; }).join(" "));
      if (alvo.indexOf(norm(st.busca)) < 0) return false;
    }
    return true;
  }

  function curvaDoGrupo(f) {
    if (!f || !st.ctx) return [];
    var contas = {};
    f.linhas.forEach(function (l) { contas[l.conta] = true; });
    return (st.ctx.itensCurva() || []).filter(function (it) { return contas[it.conta]; });
  }
  function celulaCurva(r) {
    if (!r.fisc) return '<span class="cf-sub">—</span>';
    var itens = curvaDoGrupo(r.fisc);
    if (!itens.length) return '<span style="color:var(--cv-muted);font-size:12px">fora da curva</span>';
    var it = itens[0];
    var stt = it.statusAnalise === "ok" ? '<i class="bi bi-check-lg st-ok" title="Marcado OK na Curva ABC"></i>'
      : (it.statusAnalise === "inconsistencia" ? '<i class="bi bi-x-lg st-inc" title="Marcado como inconsistência na Curva ABC"></i>' : "");
    return '<span class="cf-curva"><span class="cv-chip ' + esc(it.classe) + '" title="Classe ' + esc(it.classe) + '">' + esc(it.classe) + "</span>"
      + "<span>#" + esc(it.pos) + "</span>" + stt
      + (itens.length > 1 ? '<span style="font-size:12px;color:var(--cv-muted)">+' + (itens.length - 1) + "</span>" : "") + "</span>";
  }

  function linhaHtml(r, i) {
    var f = r.fisc, ref = f || r.rev[0], s = SITUACAO[r.status];
    var cod = f ? (f.codigo || "(sem código)") : (r.rev[0].codigo || "(sem código)");
    var codRev = r.rev.map(function (g) { return g.codigo || "(sem código)"; });
    var sub = "";
    if (r.via && VIA[r.via]) sub += '<span class="cf-selo">' + VIA[r.via] + "</span>";
    if (f && r.rev.length && codRev.join() !== cod) sub += "revisada: " + esc(codRev.join(", "));
    if (r.motivo) sub += (sub ? "<br>" : "") + esc(r.motivo);
    if (r.status === "nao_localizado") {
      sub += "Consta só na planilha revisada (" + esc(r.rev[0].linhas.map(function (l) { return (l.origem === "QUADRA" ? "QUADRA " : "SINTÉTICO ") + l.conta; }).slice(0, 3).join(", ")) + (r.rev[0].linhas.length > 3 ? "…" : "") + ")";
      if (r.possivelParDe && r.possivelParDe.length) sub += "<br>Possível par na fiscalização: ver serviços com correspondência incerta.";
    }
    var acoes = "";
    if (r.via === "manual") acoes += '<button type="button" class="cf-ghost" data-acao="desfazer" data-i="' + i + '">Desfazer equivalência</button>';
    else if (r.status === "incerta" || r.status === "sem_correspondencia") acoes += '<button type="button" class="cf-ghost" data-acao="vincular" data-i="' + i + '">Vincular…</button>';
    else if (r.status === "nao_localizado") acoes += '<button type="button" class="cf-ghost" data-acao="vincular-rev" data-i="' + i + '">Vincular a serviço da fiscalização…</button>';
    if (f && curvaDoGrupo(f).length) acoes += '<button type="button" class="cf-ghost" data-acao="curva" data-i="' + i + '" title="Abrir este serviço na Curva ABC para registrar a decisão">Ver na Curva</button>';
    return '<tr class="cf-linha ' + r.status + '" data-i="' + i + '">'
      + '<td><button type="button" class="cf-seta" data-acao="detalhe" data-i="' + i + '" title="Ver a explicação desta linha" aria-label="Ver a explicação desta linha"><i class="bi bi-info-circle"></i></button></td>'
      + '<td class="desc">' + esc(ref.desc) + (sub ? '<span class="sub">' + sub + "</span>" : "") + "</td>"
      + '<td class="cod">' + esc(cod) + "</td><td>" + esc(ref.un) + "</td>"
      + '<td class="num">' + (f ? fmt(f.qtd) : "—") + '</td><td class="num">' + (r.qtdRev != null ? fmt(r.qtdRev) : "—") + "</td>"
      + '<td class="num">' + fmtSinal(r.dif) + '</td><td class="num">' + fmtPct(r.pct) + "</td>"
      + '<td><span class="cf-sit ' + r.status + '"><i class="bi ' + s.ico + '" aria-hidden="true"></i>' + s.rot + "</span></td>"
      + "<td>" + celulaCurva(r) + '</td><td><div class="cf-acoes">' + acoes + "</div></td></tr>";
  }

  /* ---------- janela de explicação (usada pela tela e pela coluna na Curva ABC) ---------- */
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
    if (r.via === "manual") return "Equivalência confirmada por um analista" + (r.rev.length > 1 ? " (soma de " + r.rev.length + " serviços da revisada)." : ".");
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
  function dialogoHtml(r, i, contaDestaque) {
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
    else if (r.status === "nao_localizado") acoes = '<button type="button" class="cfm-btn sec" data-pop="vincular-rev">Vincular a serviço da fiscalização…</button>';
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
    var acao = await mostrarDialogo(dialogoHtml(r, i, contaDestaque));
    if (!acao) return;
    if (acao.nome === "confirmar") await confirmarCandidato(r, acao.k);
    else if (acao.nome === "vincular") await vincular(r);
    else if (acao.nome === "vincular-rev") await vincularDeRevisada(r);
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

  /* Ordem da Curva ABC: pela posição do serviço na curva (A, depois B, depois C); depois os
     serviços da fiscalização que ficaram fora da curva (inalterados), na ordem da planilha;
     por último o que só existe na revisada. Empates mantêm a ordem original. */
  function ordenarPorCurva(lista) {
    function chave(x) {
      if (!x.r.fisc) return 2e9;
      var pos = curvaDoGrupo(x.r.fisc).map(function (it) { return Number(it.pos); }).filter(isFinite);
      return pos.length ? Math.min.apply(null, pos) : 1e9;
    }
    return lista.map(function (x) { return { x: x, k: chave(x) }; })
      .sort(function (a, b) { return (a.k - b.k) || (a.x.i - b.x.i); })
      .map(function (o) { return o.x; });
  }
  function ordenar(lista) {
    if (st.ordem === "curva") return ordenarPorCurva(lista);
    if (st.ordem !== "diferenca") return lista;
    function peso(x) {
      if (x.r.status === "incerta") return 1e9;
      if (x.r.dif == null) return -1;
      if (x.r.pct == null) return 1e8 + Math.abs(x.r.dif);
      return Math.abs(x.r.pct);
    }
    return lista.slice().sort(function (a, b) { return peso(b) - peso(a); });
  }
  function renderTabela() {
    var tb = tela.querySelector("#cf-tbody");
    if (!tb) return;
    var vis = [];
    st.resultado.forEach(function (r, i) { if (dentroDoFiltro(r)) vis.push({ r: r, i: i }); });
    vis = ordenar(vis);
    tb.innerHTML = vis.length ? vis.map(function (x) { return linhaHtml(x.r, x.i); }).join("")
      : '<tr><td colspan="11" class="cf-vazio">Nenhum serviço neste filtro.</td></tr>';
    tela.querySelector("#cf-n").textContent = vis.length + " de " + st.resultado.length + " linhas";
    tela.querySelectorAll(".cf-kpi").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-filtro") === st.filtro)); });
  }

  /* ---------- ações ---------- */
  function aoClicar(e) {
    var k = e.target.closest(".cf-kpi");
    if (k) { st.filtro = k.getAttribute("data-filtro"); renderTabela(); return; }
    var b = e.target.closest("[data-acao]");
    if (!b) return;
    var i = parseInt(b.getAttribute("data-i"), 10), r = st.resultado[i], acao = b.getAttribute("data-acao");
    if (!r) return;
    if (acao === "detalhe") abrirDialogo(i, null);
    else if (acao === "curva") verNaCurva(r);
    else if (acao === "confirmar") confirmarCandidato(r, parseInt(b.getAttribute("data-k"), 10));
    else if (acao === "vincular") vincular(r);
    else if (acao === "vincular-rev") vincularDeRevisada(r);
    else if (acao === "desfazer") desfazer(r);
  }

  function verNaCurva(r) {
    var g = r.fisc, itens = curvaDoGrupo(g);
    if (!itens.length) return;
    var it = itens[0];
    fechar();
    st.ctx.verNaCurva(it.comp && !/^CX/i.test(it.comp) ? it.comp : it.conta);
  }

  function grupoPorChave(chave) {
    var achado = null;
    st.resultado.forEach(function (r) { r.rev.forEach(function (g) { if (g.chave === chave) achado = g; }); r.candidatos.forEach(function (g) { if (g.chave === chave) achado = achado || g; }); });
    return achado;
  }
  async function gravar(fisc, revGrupos) {
    try {
      var res = await salvarEquivalencia(fisc, revGrupos);
      recalcular();
      render();
      if (res.local && processoId()) alerta("Equivalência só nesta tela", "Só o perfil de analista (admin/gerente) grava equivalências no processo. Ela vale até você fechar a Conferência.", "info");
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
      + "<br><br>As quantidades dos dois serviços passarão a ser comparadas. Isso fica registrado em seu nome.");
    if (!ok) return;
    var g = grupoPorChave(c.chave);
    await gravar(r.fisc, [g || c]);
  }
  async function desfazer(r) {
    var ok = await perguntar("Desfazer equivalência?", "O serviço volta a ser tratado pelas regras automáticas.");
    if (!ok) return;
    try { await removerEquivalencia(r.fisc.chave); recalcular(); render(); }
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
  async function vincularDeRevisada(r) {
    var g = r.rev[0], un = M._interno.normUn(g.un);
    var alvos = st.resultado.filter(function (x) { return x.fisc && (x.status === "incerta" || x.status === "sem_correspondencia") && M._interno.normUn(x.fisc.un) === un; });
    if (!alvos.length) { alerta("Nenhum serviço disponível", "Não há serviço da fiscalização sem par com a unidade " + esc(g.un) + ".", "info"); return; }
    var escolhidos = await escolher({
      titulo: "Vincular a serviço da fiscalização",
      cabecalho: "Revisada: <b>" + esc(g.codigo || "(sem código)") + "</b> · " + esc(g.desc) + " — " + fmt(g.qtd) + " " + esc(g.un),
      itens: alvos.map(function (x) { return { valor: x.fisc.chave, cod: x.fisc.codigo, desc: x.fisc.desc, un: x.fisc.un, qtd: x.fisc.qtd, destaque: (x.candidatos || []).some(function (c) { return c.chave === g.chave; }) }; }),
      multiplo: false, refQtd: g.qtd
    });
    if (!escolhidos) return;
    var alvo = alvos.filter(function (x) { return x.fisc.chave === escolhidos[0]; })[0];
    var jaEscolhidos = (st.equiv.filter(function (e) { return e.fisc === alvo.fisc.chave; })[0] || { rev: [] }).rev.map(grupoPorChave).filter(Boolean);
    await gravar(alvo.fisc, jaEscolhidos.concat([g]));
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

  window.CvConferencia = { abrir: abrir, fechar: fechar, ativa: ativa, celula: celulaDaConta, detalhe: detalheDaConta, limpar: limpar };
})();
