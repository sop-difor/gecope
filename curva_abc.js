/* Curva ABC — análise de relevância dos itens de aditivo por valor.
   Adaptado de curva_abc.html para rodar como aba dentro do GECOPE.
   Usa o XLSX já carregado globalmente pelo index.html (cdn.sheetjs.com). */
(function () {
  "use strict";

  var pane = document.getElementById("pane-curva-abc");
  if (!pane) return;

  function $(id) { return document.getElementById(id); }
  var state = {
    rows: [], cols: [], headerRow: 0, fileName: "", valueIdx: null, curva: [], total: 0, limite: 0,
    arquivoOriginal: null,
    /* vínculo com um processo (Gerenciar Processo): curva_abc_versoes/curva_abc_itens */
    processoVinculado: null, versaoCarregadaDb: null, versaoMaisRecenteDoVinculo: null, somenteLeitura: false
  };

  /* ---------- utilidades ---------- */
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
  }
  function toNum(v) {
    if (v == null || v === "") return NaN;
    if (typeof v === "number") return v;
    var s = String(v).replace(/ /g, " ").replace(/r\$/i, "").replace(/\s/g, "");
    if (s === "") return NaN;
    var neg = /^\(.*\)$/.test(s); if (neg) s = s.slice(1, -1);
    var sinal = 1;
    if (s.charAt(0) === "-") { sinal = -1; s = s.slice(1); }
    else if (s.charAt(0) === "+") { s = s.slice(1); }
    var pontos = (s.match(/\./g) || []).length, virgulas = (s.match(/,/g) || []).length;
    if (virgulas > 1) return NaN;
    if (virgulas === 1) {
      if (pontos && !/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) return NaN;
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (pontos > 1) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return NaN;   /* 4.2.11 nao e numero */
      s = s.replace(/\./g, "");
    }
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    var n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return sinal * (neg ? -n : n);
  }
  function money(v) { return (v == null || !isFinite(v)) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function qty(v) { return (v == null || !isFinite(v)) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function erro(msg) { var e = $("cv-err"); e.innerHTML = msg; e.classList.add("on"); }
  function limpaErro() { $("cv-err").classList.remove("on"); }

  /* ---------- leitura do arquivo ---------- */
  function lerArquivo(file) {
    limpaErro();
    if (typeof XLSX === "undefined") {
      erro("<b>Biblioteca de planilhas ainda não carregou.</b> Aguarde um instante e tente novamente.");
      return;
    }
    state.fileName = file.name;
    state.arquivoOriginal = file;
    var fr = new FileReader();
    fr.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: false });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
        processarAoa(aoa);
      } catch (ex) {
        erro("<b>Não consegui ler este arquivo.</b> Verifique se é uma planilha .xlsx, .xls ou .csv válida. (" + esc(ex.message) + ")");
      }
    };
    fr.readAsArrayBuffer(file);
  }

  function acharLinhaCabecalho(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 30); i++) {
      var r = aoa[i] || [], txt = 0, temDesc = false;
      for (var j = 0; j < r.length; j++) {
        var n = norm(r[j]);
        if (n) { txt++; if (/descri/.test(n)) temDesc = true; }
      }
      if (temDesc && txt >= 3) return i;
    }
    return 0;
  }

  function processarAoa(aoa) {
    if (!aoa || aoa.length < 2) { erro("<b>Planilha vazia.</b> Nenhuma linha de dados encontrada."); return; }
    state.versaoCarregadaDb = null; /* upload novo: ainda não foi salvo como versão de nenhum processo */
    var h = acharLinhaCabecalho(aoa);
    state.headerRow = h;
    var head = aoa[h] || [];
    var largura = 0;
    for (var i = h; i < aoa.length; i++) largura = Math.max(largura, (aoa[i] || []).length);

    var cols = [];
    for (var c = 0; c < largura; c++) cols.push({ idx: c, raw: head[c], nome: String(head[c] == null ? "" : head[c]).trim(), n: norm(head[c]) });
    state.cols = cols;

    var dados = aoa.slice(h + 1);
    state.dados = dados;

    /* colunas numéricas viram candidatas a coluna de valor */
    var cands = [];
    var naoValor = /^(conta|item|comp|cod|codigo|descri|servico|un|und|unid)/;
    cols.forEach(function (col) {
      if (!col.nome || naoValor.test(col.n)) return;
      var ok = 0, tot = 0;
      for (var i = 0; i < dados.length; i++) {
        var v = (dados[i] || [])[col.idx];
        if (v == null || v === "") continue;
        tot++; if (isFinite(toNum(v))) ok++;
      }
      if (tot > 0 && ok / tot > 0.7) cands.push(col);
    });
    if (!cands.length) { erro("<b>Nenhuma coluna numérica encontrada.</b> Confira se o cabeçalho está na primeira linha da planilha."); return; }

    /* ordem de preferência: Vl. Acresc. primeiro */
    var pref = [/^vl acresc/, /acresc/, /^vl suprim/, /^vl replan/, /total/];
    cands.sort(function (a, b) {
      function score(x) { for (var i = 0; i < pref.length; i++) if (pref[i].test(x.n)) return i; return 99; }
      return score(a) - score(b);
    });

    var sel = $("cv-selCol"); sel.innerHTML = "";
    cands.forEach(function (col) {
      var o = document.createElement("option"); o.value = col.idx; o.textContent = col.nome; sel.appendChild(o);
    });
    sel.value = cands[0].idx;

    $("cv-params").style.display = "";
    $("cv-drop").style.display = "none";
    calcular();
  }

  /* ---------- localizar colunas descritivas ---------- */
  function achaCol(testes) {
    for (var t = 0; t < testes.length; t++) {
      for (var i = 0; i < state.cols.length; i++) {
        if (state.cols[i].n && testes[t].test(state.cols[i].n)) return state.cols[i].idx;
      }
    }
    return null;
  }
  function colQtdPar(valCol) {
    var base = valCol.n.replace(/^v(l|al)\s*/, "").trim();  /* "vl acresc" -> "acresc" */
    if (base && base !== valCol.n) {
      for (var i = 0; i < state.cols.length; i++) {
        var c = state.cols[i];
        if (c.idx !== valCol.idx && c.n === base) return c.idx;
      }
    }
    return achaCol([/^qtd$/, /^quant/]);
  }
  function colReplan() { return achaCol([/^replan/]); }

  /* ---------- cálculo da curva ---------- */
  function calcular() {
    limpaErro();
    var vIdx = parseInt($("cv-selCol").value, 10);
    var vCol = state.cols.filter(function (c) { return c.idx === vIdx; })[0];
    if (!vCol) return;
    state.valueIdx = vIdx;

    var iConta = achaCol([/^conta/, /^item/]);
    var iComp = achaCol([/^comp/, /^cod/]);
    var iDesc = achaCol([/descri/, /servic/]);
    var iUn = achaCol([/^un$/, /^und$/, /^unid/]);
    var iQtd = colQtdPar(vCol);
    var iRep = colReplan();
    var usouRep = false;

    var itens = [];
    state.dados.forEach(function (r) {
      if (!r) return;
      var desc = iDesc == null ? "" : String(r[iDesc] == null ? "" : r[iDesc]).trim();
      var conta = iConta == null ? "" : String(r[iConta] == null ? "" : r[iConta]).trim();
      if (!desc && !conta) return;
      var v = toNum(r[vIdx]);
      if (!isFinite(v) || v === 0) return;
      var q = iQtd == null ? NaN : toNum(r[iQtd]);
      if (!isFinite(q) && iRep != null && iRep !== iQtd) { var q2 = toNum(r[iRep]); if (isFinite(q2)) { q = q2; usouRep = true; } }
      itens.push({
        conta: conta,
        comp: iComp == null ? "" : String(r[iComp] == null ? "" : r[iComp]).trim(),
        desc: desc,
        un: iUn == null ? "" : String(r[iUn] == null ? "" : r[iUn]).trim(),
        qtd: q,
        valor: v,
        ord: Math.abs(v)
      });
    });

    if (!itens.length) {
      erro("<b>Nenhum item com valor nesta coluna.</b> Escolha outra coluna de valor no seletor acima.");
      ["cv-kpis", "cv-chartbox", "cv-tablebox"].forEach(function (id) { $(id).classList.remove("on"); });
      return;
    }

    itens.sort(function (a, b) { return b.ord - a.ord; });
    var total = itens.reduce(function (s, x) { return s + x.ord; }, 0);

    /* criterio informado por FAIXA de cada classe: A 80% / B 15% / C 5% */
    var cri = $("cv-selCri").value, fA, fB;
    if (cri === "custom") { fA = parseFloat($("cv-cutA").value); fB = parseFloat($("cv-cutB").value); }
    else { var p = cri.split(","); fA = parseFloat(p[0]); fB = parseFloat(p[1]); }
    if (!isFinite(fA) || fA < 1) fA = 1; if (fA > 98) fA = 98;
    if (!isFinite(fB) || fB < 1) fB = 1;
    if (fA + fB > 99) fB = 99 - fA;
    var cA = fA, cB = fA + fB, fC = 100 - cB;   /* cortes no percentual acumulado */
    state.fA = fA; state.fB = fB; state.fC = fC;
    $("cv-cutC").textContent = "C " + fC.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
    var borda = $("cv-selBorda").value;

    var acum = 0;
    itens.forEach(function (it, i) {
      var antes = acum / total * 100;
      acum += it.ord;
      it.pos = i + 1;
      it.pctInd = it.ord / total * 100;
      it.pctAcum = acum / total * 100;
      it.classe = (borda === "up")
        ? (antes < cA ? "A" : (antes < cB ? "B" : "C"))
        : (it.pctAcum <= cA ? "A" : (it.pctAcum <= cB ? "B" : "C"));
    });

    var q = $("cv-selQtd").value, lim;
    if (q === "custom") { lim = parseInt($("cv-qtdCustom").value, 10); if (!isFinite(lim) || lim < 1) lim = 1; }
    else lim = parseInt(q, 10) || 0;
    state.limite = (lim > 0) ? Math.min(lim, itens.length) : itens.length;
    $("cv-qtdTotal").textContent = "de " + itens.length;

    state.curva = itens; state.total = total; state.cA = cA; state.cB = cB; state.usouRep = usouRep;
    state.colNome = vCol.nome;
    render();
  }

  /* ---------- render ---------- */
  function render() {
    var it = state.curva, total = state.total;
    $("cv-fArq").textContent = state.fileName;
    $("cv-fArq").title = state.fileName;
    $("cv-fCol").textContent = state.colNome;
    $("cv-fQtd").textContent = (state.limite < it.length)
      ? state.limite + " de " + it.length.toLocaleString("pt-BR")
      : it.length.toLocaleString("pt-BR");
    $("cv-fTot").textContent = "R$ " + money(total);
    $("cv-fCri").textContent = state.fA + " / " + state.fB + " / " + state.fC + " %";
    $("cv-stamp").textContent = "gerado em " + new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

    /* indicadores por classe */
    var g = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } };
    it.forEach(function (x) { g[x.classe].n++; g[x.classe].v += x.ord; });
    var icoTotal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>';
    var icoClasse = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="4" height="10" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="17" y="13" width="4" height="7" rx="1"/></svg>';
    function cartao(cor, ico, rot, val, cap) {
      return '<div class="cv-kpi"><div class="ic" style="background:' + cor + '">' + ico + '</div>'
        + '<div class="body"><div class="cv-eyebrow">' + rot + '</div><div class="big">' + val + '</div>'
        + '<div class="cap">' + cap + '</div></div></div>';
    }
    var html = cartao("var(--cv-amber)", icoTotal, "Valor total analisado", "R$ " + money(total),
      it.length.toLocaleString("pt-BR") + " itens · coluna " + esc(state.colNome));
    ["A", "B", "C"].forEach(function (k) {
      var faixa = { A: state.fA, B: state.fB, C: state.fC }[k];
      html += cartao("var(--cv-c" + k + ")", icoClasse, "Classe " + k + " · faixa " + faixa + "%", "R$ " + money(g[k].v),
        g[k].n + " itens · " + pct(g[k].n / it.length * 100) + " dos itens · " + pct(total ? g[k].v / total * 100 : 0) + " do valor");
    });
    $("cv-kpis").innerHTML = html;
    $("cv-kpis").classList.add("on");

    desenhaGrafico();
    desenhaTabela();
    $("cv-chartbox").classList.add("on");
    $("cv-tablebox").classList.add("on");
    $("cv-foot").innerHTML = "Critério <code>" + state.fA + " / " + state.fB + " / " + state.fC + "</code>: a classe A reúne os itens que formam os primeiros "
      + "<code>" + state.fA + "%</code> do valor (acumulado até <code>" + state.cA + "%</code>), a classe B os <code>" + state.fB + "%</code> seguintes "
      + "(acumulado até <code>" + state.cB + "%</code>) e a classe C os <code>" + state.fC + "%</code> finais. "
      + "Itens com valor zero ou em branco na coluna <code>" + esc(state.colNome) + "</code> ficam fora da curva."
      + (state.usouRep ? " Para itens novos, sem quantidade na coluna correspondente, a quantidade exibida vem de <code>Replan.</code>" : "")
      + (state.limite < it.length
        ? " Estão sendo exibidos os <code>" + state.limite + "</code> maiores de <code>" + it.length + "</code> itens — os percentuais continuam calculados sobre o valor total de todos eles."
        : "")
      + " Colunas com valores negativos, como <code>Vl. Suprim.</code>, são ordenadas pelo módulo.";

    atualizarBotaoSalvar();
  }

  /* ajusta a tarja de fundo de cada rotulo de corte a largura real do texto */
  function ajustaTarjas() {
    var rotulos = pane.querySelectorAll("#cv-chart text.corte-lbl");
    for (var i = 0; i < rotulos.length; i++) {
      var t = rotulos[i], r = t.previousElementSibling;
      if (!r || r.getAttribute("class") !== "corte-bg") continue;
      var b;
      try { b = t.getBBox(); } catch (e) { continue; }
      if (!b || !b.width) continue;                      /* cartao ainda oculto: mantem a estimativa */
      r.setAttribute("x", (b.x - 7).toFixed(1));
      r.setAttribute("y", (b.y - 3).toFixed(1));
      r.setAttribute("width", (b.width + 14).toFixed(1));
      r.setAttribute("height", (b.height + 6).toFixed(1));
    }
  }

  function desenhaGrafico() {
    $("cv-chartbox").classList.add("on");   /* precisa estar visivel para medir o texto e a largura real */
    var it = state.curva, total = state.total;
    var N = state.limite, top = it.slice(0, N);

    /* desenha em escala real de pixels (1 unidade = 1px), em vez de um viewBox
       abstrato de 1000 unidades: assim a espessura de barras/linhas/fontes não
       "incha" quando o card fica muito largo — ela é definida direto em px. */
    var chartEl = $("cv-chart");
    var Wreal = Math.round(chartEl.getBoundingClientRect().width) || 900;
    var W = Math.max(320, Wreal);
    var H = 480, ml = 58, mr = 46, mt = 28, mb = 92;
    var pwFull = W - ml - mr, ph = H - mt - mb;
    var maxV = top[0].ord || 1;

    /* barra com largura máxima, pra não virar um bloco grosseiro quando há
       poucos itens num card largo — o gráfico fica compacto, sem esticar. */
    var bw = Math.min(pwFull / N, 64), gap = Math.min(8, bw * 0.18), passo = Math.ceil(N / 30);
    var pw = bw * N;
    ml += Math.max(0, (pwFull - pw) / 2);   /* centraliza o gráfico quando as barras não preenchem toda a largura */
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'];

    /* grade horizontal + eixo % à direita */
    for (var g = 0; g <= 100; g += 25) {
      var y = mt + ph - (g / 100 * ph);
      s.push('<line x1="' + ml + '" y1="' + y + '" x2="' + (ml + pw) + '" y2="' + y + '" class="grid" stroke-width="1"/>');
      s.push('<text x="' + (ml + pw + 8) + '" y="' + (y + 3.5) + '" font-size="10.5" class="rot">' + g + '%</text>');
    }
    /* eixo de valores à esquerda */
    for (var k = 0; k <= 4; k++) {
      var vy = mt + ph - (k / 4 * ph), vv = maxV * k / 4;
      s.push('<text x="' + (ml - 8) + '" y="' + (vy + 3.5) + '" font-size="10.5" class="rot" text-anchor="end">' +
        (vv >= 1000 ? (vv / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "k" : vv.toLocaleString("pt-BR", { maximumFractionDigits: 0 })) + '</text>');
    }
    /* barras */
    var cor = { A: "bA", B: "bB", C: "bC" };
    top.forEach(function (x, i) {
      var h = (x.ord / maxV) * ph, xx = ml + i * bw + gap / 2, yy = mt + ph - h;
      s.push('<rect x="' + xx.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + Math.max(bw - gap, 1).toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" class="' + cor[x.classe] + '" rx="2"><title>' + esc(x.desc) + ' — R$ ' + money(x.ord) + '</title></rect>');
      if (i % passo === 0) {
        var cx = ml + i * bw + bw / 2;
        s.push('<text transform="translate(' + cx.toFixed(1) + ',' + (mt + ph + 10) + ') rotate(-55)" font-size="9.5" class="rot" text-anchor="end">' + esc(x.conta || x.comp || ("#" + x.pos)) + '</text>');
      }
    });
    /* linha acumulada */
    var pts = top.map(function (x, i) { return (ml + i * bw + bw / 2).toFixed(1) + "," + (mt + ph - (x.pctAcum / 100 * ph)).toFixed(1); });
    s.push('<polyline points="' + pts.join(" ") + '" class="linha" stroke-width="1.6"/>');
    if (N <= 40) top.forEach(function (x, i) {
      s.push('<circle cx="' + (ml + i * bw + bw / 2).toFixed(1) + '" cy="' + (mt + ph - (x.pctAcum / 100 * ph)).toFixed(1) + '" r="2.4" class="ponto" stroke-width="1.3"><title>acumulado ' + pct(x.pctAcum) + '</title></circle>');
    });
    /* linhas de corte: por cima das barras, rotulo a direita onde nao ha barra alta */
    [[state.cA, "A|B"], [state.cB, "B|C"]].forEach(function (c) {
      var y = mt + ph - (c[0] / 100 * ph);
      s.push('<line x1="' + ml + '" y1="' + y + '" x2="' + (ml + pw) + '" y2="' + y + '" class="corte" stroke-width="1.2" stroke-dasharray="5 3"/>');
      var rot = 'CORTE ' + c[1] + ' — ' + c[0] + '%', lx = ml + pw - 6, lw = rot.length * 6.8 + 16;  /* largura provisoria, ajustada depois pelo getBBox */
      s.push('<rect x="' + (lx - lw) + '" y="' + (y - 23) + '" width="' + lw + '" height="15" rx="3" class="corte-bg"/>');
      s.push('<text x="' + (lx - 8) + '" y="' + (y - 12.5) + '" font-size="9.5" class="corte-lbl" letter-spacing="0.7" text-anchor="end">' + rot + '</text>');
    });
    /* molduras */
    s.push('<line x1="' + ml + '" y1="' + (mt + ph) + '" x2="' + (ml + pw) + '" y2="' + (mt + ph) + '" class="eixo"/>');
    s.push('</svg>');
    $("cv-chart").innerHTML = s.join("");
    ajustaTarjas();
    $("cv-chartN").textContent = (N < it.length) ? N + " maiores de " + it.length + " itens" : it.length + " itens";
  }

  /* comentário é salvo como HTML (rich text); para saber se "tem conteúdo" ou
     para exportar em texto puro é preciso descartar as tags primeiro. */
  function cvTextoSemHtml(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return tmp.textContent || tmp.innerText || "";
  }

  function colunasAnalise(x) {
    if (!x.dbId) return '<td class="cv-col-analise"></td><td class="cv-col-analise"></td>';
    var podeEditar = cvPodeEscrever() && !state.somenteLeitura;
    var disabledAttr = podeEditar ? "" : "disabled";
    var okOn = x.statusAnalise === "ok" ? "on" : "";
    var incOn = x.statusAnalise === "inconsistencia" ? "on" : "";
    var temComentario = !!(x.comentario && cvTextoSemHtml(x.comentario).trim());
    return '<td class="cv-col-analise cv-center"><div class="cv-status-btns">'
      + '<button type="button" class="cv-status-ok ' + okOn + '" data-db-id="' + x.dbId + '" data-status="ok" ' + disabledAttr + ' title="OK"><i class="bi bi-check-lg"></i></button>'
      + '<button type="button" class="cv-status-inc ' + incOn + '" data-db-id="' + x.dbId + '" data-status="inconsistencia" ' + disabledAttr + ' title="Inconsistência"><i class="bi bi-x-lg"></i></button>'
      + '</div></td>'
      + '<td class="cv-col-analise cv-center"><button type="button" class="cv-btn-comentario ' + (temComentario ? "tem" : "") + '" data-comentario-id="' + x.dbId + '" title="' + (temComentario ? "Ver comentário" : "Adicionar comentário") + '"><i class="bi ' + (temComentario ? "bi-chat-left-text-fill" : "bi-chat-left") + '"></i></button></td>';
  }

  function desenhaTabela() {
    var it = state.curva;
    var f = norm($("cv-busca").value);
    var lista = f ? it.filter(function (x) { return norm(x.desc).indexOf(f) > -1 || norm(x.conta).indexOf(f) > -1 || norm(x.comp).indexOf(f) > -1; })
      : it.slice(0, state.limite);
    var numCols = state.processoVinculado ? 12 : 10;
    var rows = [], ultimo = null;
    for (var i = 0; i < lista.length; i++) {
      var x = lista[i];
      if (!f && ultimo && ultimo !== x.classe) {
        rows.push('<tr class="cv-cut"><td colspan="' + numCols + '">corte da classe ' + ultimo + ' para a classe ' + x.classe + ' &nbsp;·&nbsp; acumulado ' + pct(lista[i - 1].pctAcum) + '</td></tr>');
      }
      ultimo = x.classe;
      var linhaClasse = state.processoVinculado
        ? (x.statusAnalise === "ok" ? "cv-row-ok" : (x.statusAnalise === "inconsistencia" ? "cv-row-inc" : ""))
        : "";
      rows.push('<tr class="' + linhaClasse + '">'
        + '<td class="cv-rank">' + x.pos + '</td>'
        + '<td class="cv-conta">' + esc(x.conta) + '</td>'
        + '<td class="cv-conta">' + esc(x.comp) + '</td>'
        + '<td class="cv-desc">' + esc(x.desc) + '</td>'
        + '<td class="cv-center">' + esc(x.un) + '</td>'
        + '<td class="cv-num">' + qty(x.qtd) + '</td>'
        + '<td class="cv-num">' + money(x.valor) + '</td>'
        + '<td class="cv-num">' + pct(x.pctInd) + '</td>'
        + '<td class="cv-acum"><span class="fill ' + x.classe + '" style="width:' + x.pctAcum.toFixed(2) + '%"></span><span class="v">' + pct(x.pctAcum) + '</span></td>'
        + '<td class="cv-center"><span class="cv-chip ' + x.classe + '">' + x.classe + '</span></td>'
        + colunasAnalise(x)
        + '</tr>');
    }
    if (!rows.length) rows.push('<tr><td colspan="' + numCols + '" style="padding:18px">Nenhum item corresponde ao filtro. Ajuste o texto da busca.</td></tr>');
    $("cv-tbody").innerHTML = rows.join("");
    $("cv-tblN").textContent = f
      ? lista.length + " item(ns) encontrado(s) na busca"
      : (lista.length < it.length ? "exibindo os " + lista.length + " maiores de " + it.length : it.length + " itens");
  }

  /* ---------- exportações ---------- */
  function matriz() {
    var recorte = state.curva.slice(0, state.limite);
    var m = [["Curva ABC — " + state.colNome],
    ["Arquivo", state.fileName],
    ["Critério", "A " + state.fA + "% / B " + state.fB + "% / C " + state.fC + "% (cortes no acumulado: " + state.cA + "% e " + state.cB + "%)"],
    ["Total", state.total],
    ["Itens exibidos", recorte.length + " de " + state.curva.length],
    ["Gerado em", new Date().toLocaleString("pt-BR")],
    [],
    ["#", "Conta", "Comp.", "Descrição", "UN", "Qtd.", "Valor", "%", "% acum.", "Classe"]];
    recorte.forEach(function (x) {
      m.push([x.pos, x.conta, x.comp, x.desc, x.un, isFinite(x.qtd) ? x.qtd : null, x.valor,
      +(x.pctInd / 100).toFixed(6), +(x.pctAcum / 100).toFixed(6), x.classe]);
    });
    return m;
  }
  function baixarXlsx() {
    if (typeof XLSX === "undefined") { alert("Biblioteca de exportação não carregada ainda. Aguarde e tente novamente."); return; }
    var ws = XLSX.utils.aoa_to_sheet(matriz());
    ws["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 70 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 9 }, { wch: 10 }, { wch: 7 }];
    var ref = XLSX.utils.decode_range(ws["!ref"]);
    for (var r = 8; r <= ref.e.r; r++) {
      ["G", "H", "I", "F"].forEach(function (c) {
        var cell = ws[c + (r + 1)]; if (!cell || cell.t !== "n") return;
        cell.z = (c === "H" || c === "I") ? "0.00%" : "#,##0.00";
      });
    }
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Curva ABC");
    XLSX.writeFile(wb, "curva-abc-" + norm(state.colNome).replace(/\s+/g, "-") + ".xlsx");
  }
  function baixarCsv() {
    var linhas = matriz().map(function (r) {
      return r.map(function (v) {
        if (v == null) return "";
        if (typeof v === "number") return String(v).replace(".", ",");
        var s = String(v).replace(/"/g, '""');
        return /[;"\n]/.test(s) ? '"' + s + '"' : s;
      }).join(";");
    }).join("\r\n");
    var blob = new Blob(["﻿" + linhas], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "curva-abc.csv"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- relatório consolidado dos comentários (para despacho) ---------- */
  function cvGerarRelatorioComentarios() {
    var itens = (state.curva || []).filter(function (x) { return x.dbId && x.comentario && cvTextoSemHtml(x.comentario).trim(); });
    if (!itens.length) { alert("Nenhum comentário cadastrado nesta Curva ABC ainda."); return; }

    var partes = [];
    partes.push('<div style="font-family:\'Montserrat\',sans-serif; font-size:11pt; text-align:justify; line-height:1.5; color:#1a1a1a">');
    partes.push('<p style="text-align:center; font-weight:700; text-transform:uppercase; margin:0 0 1em 0">Relatório de Análise Técnica — GECOPE</p>');
    if (state.processoVinculado) {
      partes.push('<p style="font-weight:700; margin:0 0 1em 0">PROCESSO NUP ' + esc(state.processoVinculado.processo)
        + (state.processoVinculado.descricao ? ' — ' + esc(state.processoVinculado.descricao) : '') + '</p>');
    }
    partes.push('<p style="margin:0 0 1.5em 0">Após análise da Curva ABC deste processo, resolve-se retornar o processo à Fiscalização com os seguintes apontamentos:</p>');

    itens.forEach(function (x, i) {
      partes.push('<p style="margin:0 0 0.4em 0"><strong>' + (i + 1) + '. ITEM ' + esc(x.conta) + ' - ' + esc(x.desc) + ':</strong></p>');
      /* comentário já vem como HTML formatado pelo próprio analista (negrito, itálico,
         alinhamento, tamanho) no editor do modal — mantém exatamente como foi salvo. */
      partes.push('<div style="margin:0 0 1.5em 0">' + x.comentario + '</div>');
    });
    partes.push('</div>');

    $("cv-relatorio-comentarios-body").innerHTML = partes.join("");
    bootstrap.Modal.getOrCreateInstance($("modalCvRelatorioComentarios")).show();
  }

  /* ---------- vínculo com um processo (Gerenciar Processo) ---------- */
  function cvPodeEscrever() {
    return (typeof getCurrentUserRole === "function")
      && (getCurrentUserRole() === "admin" || getCurrentUserRole() === "gerente");
  }

  function popularDatalistProcessos() {
    var dl = $("cv-listaProcessos");
    if (!dl) return;
    var lista = window.allData || [];
    dl.innerHTML = lista.map(function (r) {
      return '<option value="' + esc(r.processo) + '">' + esc(r.descricao || "") + '</option>';
    }).join("");
  }

  function resolverProcesso(processoStrDigitado) {
    var alvo = norm(processoStrDigitado);
    if (!alvo) return null;
    var lista = window.allData || [];
    for (var i = 0; i < lista.length; i++) {
      if (norm(lista[i].processo) === alvo) return lista[i];
    }
    return null;
  }

  function atualizarVinculoUI() {
    var elStatus = $("cv-vinc-status");
    var formVinc = $("cv-vinc-form");
    var btnVinc = $("cv-btnVincular");
    var btnDesv = $("cv-btnDesvincular");
    if (state.processoVinculado) {
      if (elStatus) {
        elStatus.textContent = "PROCESSO NUP " + state.processoVinculado.processo
          + (state.processoVinculado.descricao ? " - " + state.processoVinculado.descricao : "");
        elStatus.classList.add("on");
      }
      if (formVinc) formVinc.style.display = "none";
      if (btnVinc) btnVinc.style.display = "none";
      if (btnDesv) btnDesv.style.display = "";
    } else {
      if (elStatus) { elStatus.textContent = ""; elStatus.classList.remove("on"); }
      if (formVinc) formVinc.style.display = "";
      if (btnVinc) btnVinc.style.display = "";
      if (btnDesv) btnDesv.style.display = "none";
      var input = $("cv-vincProcesso");
      if (input) input.value = "";
    }
    atualizarBotaoSalvar();
  }

  function atualizarBotaoSalvar() {
    var btn = $("cv-btnSalvarAnalise");
    if (!btn) return;
    var mostrar = !!(state.processoVinculado && !state.versaoCarregadaDb && state.curva && state.curva.length && cvPodeEscrever());
    btn.style.display = mostrar ? "" : "none";
  }

  async function carregarVersaoDb(versaoRegistro, somenteLeitura) {
    limpaErro();
    var { data: itensDb, error } = await sbClient
      .from("curva_abc_itens")
      .select("*")
      .eq("versao_id", versaoRegistro.id)
      .order("posicao", { ascending: true });
    if (error) { erro("Erro ao carregar itens da Curva ABC: " + esc(error.message)); return; }

    var itens = (itensDb || []).map(function (x) {
      return {
        conta: x.conta || "", comp: x.comp || "", desc: x.descricao || "", un: x.unidade || "",
        qtd: x.quantidade, valor: Number(x.valor) || 0, ord: Math.abs(Number(x.valor) || 0),
        pos: x.posicao, pctInd: Number(x.pct_individual) || 0, pctAcum: Number(x.pct_acumulado) || 0,
        classe: x.classe, dbId: x.id, statusAnalise: x.status_analise, comentario: x.comentario
      };
    });

    state.cols = []; state.dados = []; state.arquivoOriginal = null;
    state.curva = itens;
    state.total = Number(versaoRegistro.total_valor) || itens.reduce(function (s, x) { return s + x.ord; }, 0);
    state.fA = Number(versaoRegistro.criterio_a) || 80;
    state.fB = Number(versaoRegistro.criterio_b) || 15;
    state.fC = (versaoRegistro.criterio_c != null) ? Number(versaoRegistro.criterio_c) : (100 - state.fA - state.fB);
    state.cA = state.fA; state.cB = state.fA + state.fB;
    state.colNome = versaoRegistro.coluna_valor || "—";
    state.fileName = versaoRegistro.arquivo_nome || ("Versão " + versaoRegistro.versao);
    state.limite = itens.length;
    state.usouRep = false;
    state.versaoCarregadaDb = versaoRegistro;
    state.somenteLeitura = somenteLeitura;

    var sel = $("cv-selCol"); sel.innerHTML = "";
    var o = document.createElement("option"); o.textContent = state.colNome; sel.appendChild(o);

    $("cv-drop").style.display = "none";
    $("cv-params").style.display = "";

    render();
  }

  async function vincularProcesso(processoStrDigitado) {
    limpaErro();
    var proc = resolverProcesso(processoStrDigitado);
    if (!proc) { erro("Processo não encontrado. Confira o número digitado."); return; }
    await carregarCurvaAbcDoProcesso(proc.id, proc.processo, null, proc.descricao);
  }

  function resetVisualizacao() {
    state.curva = []; state.total = 0; state.cols = []; state.dados = [];
    state.arquivoOriginal = null; state.fileName = ""; state.limite = 0;
    ["cv-kpis", "cv-chartbox", "cv-tablebox"].forEach(function (id) {
      var e = $(id); if (e) e.classList.remove("on");
    });
    $("cv-tbody").innerHTML = "";
    $("cv-chart").innerHTML = "";
    var busca = $("cv-busca"); if (busca) busca.value = "";
    $("cv-params").style.display = "none";
    $("cv-drop").style.display = "";
    $("cv-file").value = "";
    limpaErro();
  }

  async function desvincularProcesso() {
    if (!state.processoVinculado) return;
    var proc = state.processoVinculado;

    /* só existe algo a desfazer no banco se já havia versão(ões) salva(s) para este
       processo; sem isso, "desvincular" é só fechar a visualização em memória */
    if (state.versaoMaisRecenteDoVinculo) {
      if (!cvPodeEscrever()) { alert("Você não tem permissão para remover este vínculo."); return; }
      var ok = confirm("Isso remove definitivamente o vínculo da Curva ABC com o processo Nº " + proc.processo
        + ". Os dados de todas as versões continuam no sistema, mas deixam de aparecer nesse processo. Deseja continuar?");
      if (!ok) return;

      var btnDesv = $("cv-btnDesvincular");
      var textoOriginal = btnDesv ? btnDesv.innerHTML : "";
      if (btnDesv) { btnDesv.disabled = true; btnDesv.innerHTML = "REMOVENDO..."; }

      /* zera processo_id em TODAS as versões deste processo — não só na que está
         em tela — senão a versão anterior viraria a "mais recente" e o vínculo
         reapareceria na próxima vez que o processo fosse aberto. */
      var { error } = await sbClient.from("curva_abc_versoes").update({ processo_id: null }).eq("processo_id", String(proc.id));

      if (btnDesv) { btnDesv.disabled = false; btnDesv.innerHTML = textoOriginal; }
      if (error) { alert("Erro ao remover o vínculo: " + error.message); return; }

      if (typeof registrarAtividade === "function") {
        registrarAtividade("PROCESSO", "removeu o vínculo da Curva ABC com o processo Nº " + proc.processo, proc.processo);
      }
    }

    limparVinculoLocal();

    /* se o card de Gerenciar Processo ainda estiver na página (modal fechado, não destruído) */
    if (typeof carregarCurvaAbcResumo === "function") carregarCurvaAbcResumo(proc.processo, proc.id);
  }

  /* limpa só o lado do navegador (vínculo em memória + tela) — não mexe no banco.
     Usada tanto pelo "Desvincular" (depois de já ter tratado o banco, se preciso)
     quanto ao sair da aba, pra não deixar a curva de uma pessoa "vazar" pra próxima
     vez que a aba for aberta. */
  function limparVinculoLocal() {
    state.processoVinculado = null;
    state.versaoCarregadaDb = null;
    state.versaoMaisRecenteDoVinculo = null;
    state.somenteLeitura = false;
    pane.classList.remove("tem-vinculo");
    atualizarVinculoUI();
    resetVisualizacao();
  }

  async function carregarCurvaAbcDoProcesso(processoId, processoStr, versaoId, descricao) {
    limpaErro();
    state.processoVinculado = { id: processoId, processo: processoStr, descricao: descricao || "" };
    pane.classList.add("tem-vinculo");
    atualizarVinculoUI();

    var { data, error } = await sbClient
      .from("curva_abc_versoes")
      .select("*")
      .eq("processo_id", String(processoId))
      .order("versao", { ascending: false });
    if (error) { erro("Erro ao consultar Curva ABC do processo: " + esc(error.message)); return; }

    state.versaoMaisRecenteDoVinculo = (data && data.length) ? data[0] : null;

    if (!data || !data.length) {
      /* nenhuma versão salva ainda: limpa qualquer curva anterior em tela e fica
         na dropzone, já vinculado a este processo, pronta pra um upload novo */
      resetVisualizacao();
      atualizarBotaoSalvar();
      return;
    }

    var alvo = versaoId ? data.find(function (v) { return v.id === versaoId; }) : data[0];
    if (!alvo) alvo = data[0];
    var ehAtual = (alvo.id === data[0].id);
    await carregarVersaoDb(alvo, !cvPodeEscrever() || !ehAtual);
  }

  async function salvarComoNovaVersaoDoProcesso() {
    if (!state.processoVinculado || !cvPodeEscrever()) return;
    if (!state.curva || !state.curva.length) return;

    if (state.versaoMaisRecenteDoVinculo) {
      var ok = confirm("Uma nova versão vai virar a versão corrente da Curva ABC deste processo. A versão anterior continuará disponível no histórico, somente leitura. Deseja continuar?");
      if (!ok) return;
    }

    var btn = $("cv-btnSalvarAnalise");
    var textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "SALVANDO...";

    try {
      var proximaVersao = (state.versaoMaisRecenteDoVinculo ? state.versaoMaisRecenteDoVinculo.versao : 0) + 1;

      var arquivoUrl = null, arquivoPath = null, arquivoNome = null;
      if (state.arquivoOriginal) {
        arquivoNome = state.arquivoOriginal.name;
        var nomeLimpo = sanitizarNomeArquivo(arquivoNome);
        arquivoPath = "curva_abc/" + state.processoVinculado.id + "/v" + proximaVersao + "_" + Date.now() + "_" + nomeLimpo;
        var up = await sbClient.storage.from("orcamentos").upload(arquivoPath, state.arquivoOriginal);
        if (up.error) throw up.error;
        var pub = sbClient.storage.from("orcamentos").getPublicUrl(arquivoPath);
        arquivoUrl = pub.data.publicUrl;
      }

      var versaoPayload = {
        processo_id: String(state.processoVinculado.id),
        processo_nup: state.processoVinculado.processo,
        versao: proximaVersao,
        arquivo_nome: arquivoNome,
        arquivo_path: arquivoPath,
        arquivo_url: arquivoUrl,
        coluna_valor: state.colNome,
        criterio_a: state.fA,
        criterio_b: state.fB,
        criterio_c: state.fC,
        total_valor: state.total,
        total_itens: state.curva.length,
        autor_nome: sessionStorage.getItem("sop_user_name") || "Usuário Desconhecido",
        autor_email: (typeof getCurrentUserEmail === "function") ? getCurrentUserEmail() : ""
      };

      var insVersao = await sbClient.from("curva_abc_versoes").insert([versaoPayload]).select().single();
      if (insVersao.error) throw insVersao.error;
      var versaoId = insVersao.data.id;

      var itensPayload = state.curva.map(function (x) {
        return {
          versao_id: versaoId,
          posicao: x.pos,
          conta: x.conta,
          comp: x.comp,
          descricao: x.desc,
          unidade: x.un,
          quantidade: isFinite(x.qtd) ? x.qtd : null,
          valor: x.valor,
          pct_individual: x.pctInd,
          pct_acumulado: x.pctAcum,
          classe: x.classe,
          status_analise: "pendente"
        };
      });

      var insItens = await sbClient.from("curva_abc_itens").insert(itensPayload).select();
      if (insItens.error) throw insItens.error;

      if (typeof registrarAtividade === "function") {
        registrarAtividade("PROCESSO", "importou uma nova versão da Curva ABC do processo Nº " + state.processoVinculado.processo, state.processoVinculado.processo);
      }

      state.versaoMaisRecenteDoVinculo = insVersao.data;
      await carregarVersaoDb(insVersao.data, false);
      if (typeof carregarCurvaAbcResumo === "function") {
        carregarCurvaAbcResumo(state.processoVinculado.processo, state.processoVinculado.id);
      }
    } catch (err) {
      console.error("Erro ao salvar Curva ABC do processo:", err);
      erro("Erro ao salvar: " + esc(err.message || err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  }

  function cvEncontrarItemPorDbId(dbId) {
    return (state.curva || []).find(function (x) { return x.dbId === dbId; });
  }

  async function cvSetStatusItem(dbId, status) {
    if (!cvPodeEscrever() || state.somenteLeitura) return;
    var item = cvEncontrarItemPorDbId(dbId);
    if (!item) return;
    var patch = {
      status_analise: status,
      analisado_por: sessionStorage.getItem("sop_user_name") || ((typeof getCurrentUserEmail === "function") ? getCurrentUserEmail() : "") || "Usuário",
      analisado_em: new Date().toISOString()
    };
    var { error } = await sbClient.from("curva_abc_itens").update(patch).eq("id", dbId);
    if (error) { alert("Erro ao salvar análise do item: " + error.message); return; }
    item.statusAnalise = status;
    desenhaTabela();
    if (typeof carregarCurvaAbcResumo === "function" && state.processoVinculado) {
      carregarCurvaAbcResumo(state.processoVinculado.processo, state.processoVinculado.id);
    }
  }

  async function cvSalvarComentarioItem(dbId, valorHtml) {
    if (!cvPodeEscrever() || state.somenteLeitura) return;
    var item = cvEncontrarItemPorDbId(dbId);
    if (!item) return;
    var novo = cvTextoSemHtml(valorHtml).trim() ? valorHtml.trim() : null;
    if (item.comentario === novo) return;
    var { error } = await sbClient.from("curva_abc_itens").update({ comentario: novo }).eq("id", dbId);
    if (error) { alert("Erro ao salvar comentário: " + error.message); return; }
    item.comentario = novo;
  }

  /* ---------- eventos ---------- */
  var drop = $("cv-drop"), input = $("cv-file");
  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]); });
  /* previne que soltar o arquivo fora da zona (mas dentro da aba) faça o navegador abrir o arquivo */
  pane.addEventListener("dragover", function (e) { e.preventDefault(); });
  pane.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]); });
  input.addEventListener("change", function () { if (input.files[0]) lerArquivo(input.files[0]); });

  var btnNovo = document.createElement("button");
  btnNovo.className = "cv-ghost"; btnNovo.type = "button"; btnNovo.textContent = "Trocar arquivo";
  btnNovo.addEventListener("click", function () { input.value = ""; input.click(); });
  pane.querySelector(".cv-params").insertBefore(btnNovo, $("cv-btnXlsx"));

  $("cv-selCol").addEventListener("change", calcular);
  $("cv-selBorda").addEventListener("change", calcular);
  $("cv-selCri").addEventListener("change", function () {
    $("cv-ctlCustom").style.display = $("cv-selCri").value === "custom" ? "" : "none";
    calcular();
  });
  $("cv-cutA").addEventListener("change", calcular);
  $("cv-cutB").addEventListener("change", calcular);
  $("cv-busca").addEventListener("input", desenhaTabela);
  $("cv-selQtd").addEventListener("change", function () {
    $("cv-ctlQtd").style.display = $("cv-selQtd").value === "custom" ? "" : "none";
    calcular();
  });
  $("cv-qtdCustom").addEventListener("change", calcular);
  $("cv-qtdCustom").addEventListener("input", calcular);
  $("cv-btnXlsx").addEventListener("click", baixarXlsx);
  $("cv-btnCsv").addEventListener("click", baixarCsv);
  $("cv-btnPrint").addEventListener("click", function () { window.print(); });
  var btnRelatorioComentarios = $("cv-btnRelatorioComentarios");
  if (btnRelatorioComentarios) btnRelatorioComentarios.addEventListener("click", cvGerarRelatorioComentarios);

  /* ---------- eventos: vínculo com processo e análise item a item ---------- */
  var vincInput = $("cv-vincProcesso");
  if (vincInput) {
    vincInput.addEventListener("focus", popularDatalistProcessos);
    vincInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); vincularProcesso(vincInput.value); }
    });
  }
  var btnVincular = $("cv-btnVincular");
  if (btnVincular) btnVincular.addEventListener("click", function () { vincularProcesso(vincInput ? vincInput.value : ""); });
  var btnDesvincular = $("cv-btnDesvincular");
  if (btnDesvincular) btnDesvincular.addEventListener("click", desvincularProcesso);
  var btnSalvarAnalise = $("cv-btnSalvarAnalise");
  if (btnSalvarAnalise) btnSalvarAnalise.addEventListener("click", salvarComoNovaVersaoDoProcesso);

  /* ao sair da aba (trocar de aba/painel), limpa a tela — nada de planilha ou
     vínculo "sobrevive" de uma visita pra outra; quem quiser continuar depois
     precisa vincular/reabrir de novo. Não mexe no banco, só na tela. */
  var tabBtnCurvaAbc = document.querySelector('#dashboardTabs [data-bs-target="#pane-curva-abc"]');
  if (tabBtnCurvaAbc) {
    tabBtnCurvaAbc.addEventListener("hidden.bs.tab", function () {
      limparVinculoLocal();
    });
  }

  var tbody = $("cv-tbody");
  tbody.addEventListener("click", function (e) {
    var btnStatus = e.target.closest("button[data-db-id]");
    if (btnStatus && !btnStatus.disabled) {
      cvSetStatusItem(parseInt(btnStatus.getAttribute("data-db-id"), 10), btnStatus.getAttribute("data-status"));
      return;
    }
    var btnComentario = e.target.closest("button[data-comentario-id]");
    if (btnComentario) cvAbrirComentario(parseInt(btnComentario.getAttribute("data-comentario-id"), 10));
  });

  /* ---------- modal de comentário do item (editor rico: negrito/itálico/alinhamento/tamanho) ---------- */
  function cvAtualizarToolbarComentario(editavel) {
    var tb = $("cv-coment-toolbar");
    if (tb) tb.style.display = editavel ? "" : "none";
    var regua = $("cv-coment-ruler");
    if (regua) regua.classList.toggle("on", editavel);
    if (editavel) setTimeout(cvConstruirReguaTicks, 0);
  }

  function cvAbrirComentario(dbId) {
    var item = cvEncontrarItemPorDbId(dbId);
    if (!item) return;
    var podeEditar = cvPodeEscrever() && !state.somenteLeitura;
    $("cv-coment-db-id").value = dbId;
    $("cv-coment-item-desc").textContent = (item.conta ? item.conta + " — " : "") + item.desc;
    var ed = $("cv-coment-texto");
    ed.innerHTML = item.comentario || "";
    ed.contentEditable = "false"; /* sempre abre em modo leitura; só edita depois de clicar em "Editar" */
    cvAtualizarToolbarComentario(false);
    $("cv-ruler-firstline").style.left = "0px";
    $("cv-ruler-leftindent").style.left = "0px";
    $("cv-coment-btnEditar").style.display = podeEditar ? "" : "none";
    $("cv-coment-btnSalvar").style.display = "none";
    var modalEl = $("modalCvComentario");
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  var btnEditarComentario = $("cv-coment-btnEditar");
  if (btnEditarComentario) {
    btnEditarComentario.addEventListener("click", function () {
      var ed = $("cv-coment-texto");
      ed.contentEditable = "true";
      ed.focus();
      cvAtualizarToolbarComentario(true);
      btnEditarComentario.style.display = "none";
      $("cv-coment-btnSalvar").style.display = "";
    });
  }

  var btnSalvarComentario = $("cv-coment-btnSalvar");
  if (btnSalvarComentario) {
    btnSalvarComentario.addEventListener("click", async function () {
      var dbId = parseInt($("cv-coment-db-id").value, 10);
      await cvSalvarComentarioItem(dbId, $("cv-coment-texto").innerHTML);
      desenhaTabela();
      bootstrap.Modal.getOrCreateInstance($("modalCvComentario")).hide();
    });
  }

  /* barra de ferramentas do editor: usa o clássico document.execCommand — evita
     depender de biblioteca externa de WYSIWYG só para negrito/itálico/alinhamento. */
  var comentToolbar = $("cv-coment-toolbar");
  if (comentToolbar) {
    /* mousedown (não click) + preventDefault: impede que o foco saia do editor
       antes do comando rodar, senão a seleção de texto se perde */
    comentToolbar.addEventListener("mousedown", function (e) {
      if (e.target.closest("button[data-cmd]")) e.preventDefault();
    });
    var mapaAlinhamento = { justifyLeft: "left", justifyCenter: "center", justifyFull: "justify", justifyRight: "right" };
    comentToolbar.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-cmd]");
      if (!btn) return;
      var cmd = btn.getAttribute("data-cmd");
      if (mapaAlinhamento[cmd]) cvAplicarAlinhamento(mapaAlinhamento[cmd]);
      else document.execCommand(cmd, false, null);
      $("cv-coment-texto").focus();
    });
  }

  /* execCommand("justifyX") é inconsistente em contenteditable simples (texto sem
     parágrafo próprio às vezes não visualiza a mudança) — em vez disso, acha (ou
     cria) o bloco que contém a seleção e aplica o estilo direto nele, garantindo
     que o resultado fique dentro do innerHTML salvo (o próprio editor não é
     persistido, só o conteúdo dele). Usado tanto pelo alinhamento quanto pela régua. */
  function cvBlocoAtual() {
    var editor = $("cv-coment-texto");
    var sel = window.getSelection();
    var node = (sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null);
    if (!node || !editor.contains(node)) node = editor;
    while (node && node !== editor && node.parentNode !== editor) node = node.parentNode;
    if (node && node !== editor && node.nodeType === 1) return node;
    var wrapper = document.createElement("div");
    while (editor.firstChild) wrapper.appendChild(editor.firstChild);
    editor.appendChild(wrapper);
    return wrapper;
  }

  function cvAplicarAlinhamento(align) {
    cvBlocoAtual().style.textAlign = align;
  }

  function cvAplicarRecuo(propriedade, valorPx) {
    cvBlocoAtual().style[propriedade] = valorPx + "px";
  }

  /* ---------- régua horizontal (recuo de parágrafo, estilo Google Docs) ---------- */
  var CV_REGUA_PX_POR_CM = 37.8;

  function cvConstruirReguaTicks() {
    var regua = $("cv-coment-ruler"), ticksWrap = $("cv-ruler-ticks");
    if (!regua || !ticksWrap) return;
    var largura = regua.clientWidth;
    if (!largura) return;
    ticksWrap.innerHTML = "";
    var totalCm = Math.floor(largura / CV_REGUA_PX_POR_CM);
    for (var cm = 0; cm <= totalCm; cm++) {
      var x = cm * CV_REGUA_PX_POR_CM;
      var tick = document.createElement("div");
      tick.className = "cv-ruler-tick major";
      tick.style.left = x + "px";
      ticksWrap.appendChild(tick);
      if (cm > 0) {
        var label = document.createElement("span");
        label.className = "cv-ruler-tick-label";
        label.style.left = x + "px";
        label.textContent = cm;
        ticksWrap.appendChild(label);
      }
      if (cm < totalCm) {
        var meio = document.createElement("div");
        meio.className = "cv-ruler-tick minor";
        meio.style.left = (x + CV_REGUA_PX_POR_CM / 2) + "px";
        ticksWrap.appendChild(meio);
      }
    }
  }

  function cvTornarMarcadorArrastavel(marker, aoSoltar) {
    marker.addEventListener("mousedown", function (e) {
      e.preventDefault();
      var regua = $("cv-coment-ruler");
      var rect = regua.getBoundingClientRect();
      marker.classList.add("dragging");
      function mover(ev) {
        var x = ev.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        marker.style.left = x + "px";
      }
      function soltar() {
        document.removeEventListener("mousemove", mover);
        document.removeEventListener("mouseup", soltar);
        marker.classList.remove("dragging");
        aoSoltar(parseFloat(marker.style.left) || 0);
      }
      document.addEventListener("mousemove", mover);
      document.addEventListener("mouseup", soltar);
    });
  }

  var reguaFirstline = $("cv-ruler-firstline"), reguaLeftIndent = $("cv-ruler-leftindent");
  if (reguaFirstline && reguaLeftIndent) {
    cvTornarMarcadorArrastavel(reguaFirstline, function (x) { cvAplicarRecuo("textIndent", x); });
    cvTornarMarcadorArrastavel(reguaLeftIndent, function (x) { cvAplicarRecuo("marginLeft", x); });
  }

  /* Tab dentro do editor não insere nada por padrão no navegador (ele só troca o
     foco de elemento) — intercepta e usa como recuo da 1ª linha, 1 "tab stop" de
     1,25cm por vez (Shift+Tab desfaz), igual ao Word. Mantém a régua em sincronia. */
  var comentEditor = $("cv-coment-texto");
  if (comentEditor) {
    comentEditor.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || comentEditor.contentEditable !== "true") return;
      e.preventDefault();
      var bloco = cvBlocoAtual();
      var passo = 1.25 * CV_REGUA_PX_POR_CM;
      var atual = parseFloat(bloco.style.textIndent) || 0;
      atual = e.shiftKey ? Math.max(0, atual - passo) : atual + passo;
      bloco.style.textIndent = atual + "px";
      reguaFirstline.style.left = atual + "px";
    });
  }

  /* mantém os marcadores da régua sincronizados com o recuo do parágrafo onde
     está o cursor no momento — só reage enquanto o editor está em modo edição */
  document.addEventListener("selectionchange", function () {
    var editor = $("cv-coment-texto");
    if (!editor || editor.contentEditable !== "true") return;
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    if (!editor.contains(node)) return;
    while (node && node !== editor && node.parentNode !== editor) node = node.parentNode;
    var estilo = (node && node !== editor && node.nodeType === 1) ? node.style : null;
    reguaLeftIndent.style.left = (estilo && parseFloat(estilo.marginLeft) || 0) + "px";
    reguaFirstline.style.left = (estilo && parseFloat(estilo.textIndent) || 0) + "px";
  });
  var comentFontSize = $("cv-coment-fontsize");
  if (comentFontSize) {
    comentFontSize.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    comentFontSize.addEventListener("change", function () {
      var editor = $("cv-coment-texto");
      editor.focus();
      var tamanho = comentFontSize.value;
      /* execCommand("fontSize") só aceita 1-7 (unidades HTML antigas) — usa o
         valor 7 como marcador e troca pelo tamanho real em pt logo em seguida. */
      document.execCommand("fontSize", false, "7");
      var marcados = editor.querySelectorAll('font[size="7"]');
      marcados.forEach(function (f) {
        f.removeAttribute("size");
        f.style.fontSize = tamanho + "pt";
      });
    });
  }

  /* chamada de fora (do card "CURVA ABC" em Gerenciar Processo) para abrir esta aba já
     carregada com a curva de um processo específico — ver curva_abc_processo.js */
  window.carregarCurvaAbcDoProcesso = carregarCurvaAbcDoProcesso;

})();
