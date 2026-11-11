/* Comparação entre versões da Curva ABC — botão de cada serviço e janela do item.
   Fluxo (pensado para não poluir a tela):
   - ao abrir uma versão salva que tenha versão anterior (ex.: v02), a comparação com a
     imediatamente anterior é ligada sozinha (preparar), sem janela nem botão na barra;
   - cada serviço ganha, ao lado da descrição, um pequeno selo que já diz o que aconteceu
     com ele (aumentou / diminuiu / manteve / alterado / novo, com o % da quantidade
     replanilhada) e marca se havia inconsistência apontada na versão anterior;
   - o clique no selo abre a janela do ITEM: quantidades da anterior × atual, diferença,
     valor na curva, a análise/comentário registrada na anterior e — para quem pode editar —
     a análise da versão em tela (OK/Inconsistência, comentário, "repetir apontamento");
     setas ‹ › percorrem os itens visíveis na tabela;
   - na barra da tabela: filtro "Comparação" e "OK em lote" (ficam em curva_abc.js).
   Gravação via st.ctx.gravarStatus / gravarComentario (curva_abc.js). Pareamento, classificação e tendência em comparacao_motor.js.
   Janela própria (classes .cfm de conferencia.css + .cmp-* de comparacao.css). */
(function () {
  "use strict";

  var M = window.ComparacaoMotor;
  var st = {
    ctx: null, base: null, cache: {}, res: null, porDbId: {},
    aba: "qtd",      /* quadro da janela: "qtd" | "valor" */
    ordem: [],       /* dbIds percorridos pelas setas ‹ › (fixados ao abrir pela tabela) */
    rascunho: {},    /* dbId -> comentário em edição ainda não gravado */
    aviso: null,     /* { dbId, tipo: "ok" | "erro", texto } exibido sob o comentário */
    ocupado: false
  };

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nfmt(v) {
    return (v == null || v === "" || !isFinite(Number(v))) ? "—"
      : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dif(a, b) {
    var x = (a == null || !isFinite(Number(a))) ? 0 : Number(a), y = (b == null || !isFinite(Number(b))) ? 0 : Number(b);
    var d = Math.round((y - x) * 100) / 100;
    return d === 0 ? "—" : (d > 0 ? "+" : "−") + nfmt(Math.abs(d));
  }
  function pctFmt(p) {
    return (p > 0 ? "+" : "−") + Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 }) + "%";
  }
  function pctTxt(a, b) {
    a = Math.abs(Number(a) || 0); b = Math.abs(Number(b) || 0);
    if (!a) return "";
    var p = (b - a) / a * 100;
    return Math.abs(p) < 0.05 ? "" : pctFmt(p);
  }
  function varHtml(a, b) {
    var p = pctTxt(a, b);
    if (!p) return '<span class="cmp-var">—</span>';
    return '<span class="cmp-var ' + (p.charAt(0) === "+" ? "sobe" : "desce") + '">' + p + "</span>";
  }
  function valorOuTraco(x) { return x ? nfmt(Math.abs(Number(x.valor) || 0)) : "—"; }
  function nVer(v) { return "Versão " + String(v.versao).padStart(2, "0"); }
  function vCurta(v) { return "v" + String(v.versao).padStart(2, "0"); }
  function dataBr(iso) { return iso ? new Date(iso).toLocaleDateString("pt-BR") : ""; }
  function rotStatus(s) { return s === "ok" ? "OK" : (s === "inconsistencia" ? "Inconsistência" : "Pendente"); }

  /* versões anteriores à que está em tela (mais nova primeiro) */
  function anteriores() {
    var c = st.ctx; if (!c || !c.versaoAtual) return [];
    return (c.versoes || []).filter(function (v) { return v.versao < c.versaoAtual.versao; })
      .sort(function (a, b) { return b.versao - a.versao; });
  }

  /* ---------- dados da versão de base ---------- */
  async function carregarItens(versao) {
    if (st.cache[versao.id]) return st.cache[versao.id];
    var r = await lerTodasAsLinhas(function () {
      return sbClient.from("curva_abc_itens").select("*", { count: "exact" })
        .eq("versao_id", versao.id).order("posicao", { ascending: true }).order("id", { ascending: true });
    });
    if (r.error) throw r.error;
    function n(v) { return v != null ? Number(v) : null; }
    var itens = (r.data || []).map(function (x) {
      return {
        conta: x.conta || "", comp: x.comp || "", desc: x.descricao || "", un: x.unidade || "",
        qtdBase: n(x.qtd_base), acrescQ: n(x.acresc), suprQ: n(x.suprimido), replanQ: n(x.replan),
        vAcresc: n(x.v_acresc), vSupr: n(x.v_suprim), vReplan: n(x.v_replan), valor: Number(x.valor) || 0,
        classe: x.classe, pos: x.posicao, pctInd: n(x.pct_individual), statusAnalise: x.status_analise, comentario: x.comentario,
        analisadoPor: x.analisado_por, analisadoEm: x.analisado_em
      };
    });
    st.cache[versao.id] = itens;
    return itens;
  }

  function calcular() {
    st.res = M.comparar(st.cache[st.base.id], st.ctx.itensAtuais());
    st.porDbId = {};
    st.res.itens.forEach(function (r, i) { if (r && r.atual && r.atual.dbId != null) st.porDbId[r.atual.dbId] = i; });
  }

  /* ---------- janela ---------- */
  /* Uma janela por vez; o conteúdo é trocado sem fechar (navegação entre itens).
     aoAgir(nome, el) recebe os cliques em [data-cmp]; setas ← → navegam. */
  var jan = null;
  function abrirJanela(html, aoAgir) {
    if (jan) { jan.trocar(html, aoAgir); return; }
    var anterior = document.activeElement, overflow = document.body.style.overflow;
    var fundo = document.createElement("div");
    fundo.className = "cfm-fundo"; fundo.setAttribute("role", "dialog"); fundo.setAttribute("aria-modal", "true"); fundo.setAttribute("aria-labelledby", "cmp-titulo");
    var caixa = document.createElement("div"); caixa.className = "cfm cmp";
    fundo.appendChild(caixa);
    var acao = aoAgir;
    function por(html2, manterFoco) {
      var ae = manterFoco && document.activeElement, focado = ae && ae.getAttribute && ae.getAttribute("data-cmp");
      var sel = focado ? '[data-cmp="' + focado + '"]' + (ae.getAttribute("data-v") ? '[data-v="' + ae.getAttribute("data-v") + '"]' : "") + ":not([disabled])" : null;
      var rolagem = fundo.scrollTop;
      caixa.innerHTML = '<button type="button" class="cfm-x" data-cmp="fechar" aria-label="Fechar">&times;</button>' + html2;
      var f = (sel && caixa.querySelector(sel)) || caixa.querySelector("[data-foco]") || caixa.querySelector(".cfm-x");
      if (f) f.focus({ preventScroll: true });
      fundo.scrollTop = manterFoco ? rolagem : 0;
    }
    /* "fechar" passa antes pela ação (que grava o comentário pendente); false = não fecha */
    async function tentarFechar() {
      if (acao) { var r = await acao("fechar", null); if (r === false) return; }
      fechar();
    }
    function editavel(el) { return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); }
    function fechar() {
      document.removeEventListener("keydown", tecla, true);
      fundo.remove(); document.body.style.overflow = overflow; jan = null;
      if (anterior && anterior.focus && document.contains(anterior)) anterior.focus();
    }
    function tecla(e) {
      if (e.key === "Escape") { e.stopPropagation(); tentarFechar(); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && acao && !e.altKey && !e.ctrlKey && !e.metaKey && !editavel(e.target)) {
        e.preventDefault(); acao(e.key === "ArrowLeft" ? "anterior" : "proximo", null); return;
      }
      if (e.key !== "Tab") return;
      var foco = caixa.querySelectorAll('button:not([disabled]), [contenteditable="true"]'); if (!foco.length) return;
      var primeiro = foco[0], ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
    fundo.addEventListener("click", function (e) {
      if (e.target === fundo) { tentarFechar(); return; }
      var b = e.target.closest("[data-cmp]"); if (!b || b.disabled) return;
      var nome = b.getAttribute("data-cmp");
      if (nome === "fechar") { tentarFechar(); return; }
      if (acao) acao(nome, b);
    });
    fundo.addEventListener("input", function (e) {
      var ed = e.target.closest && e.target.closest("[data-cmp-ed]");
      if (ed && acao) acao("editar", ed);
    });
    document.addEventListener("keydown", tecla, true);
    document.body.appendChild(fundo); document.body.style.overflow = "hidden";
    jan = { fechar: fechar, trocar: function (h, a) { acao = a; por(h, true); } };
    por(html, false);
  }

  /* ---------- janela do item ---------- */
  var ICO_STATUS = { ok: "bi-check-lg", inconsistencia: "bi-x-lg", pendente: "bi-clock" };
  function badgeStatus(s) {
    var k = (s === "ok" || s === "inconsistencia") ? s : "pendente";
    return '<span class="cmp-st ' + k + '"><i class="bi ' + ICO_STATUS[k] + '" aria-hidden="true"></i>' + rotStatus(k) + "</span>";
  }
  function comentarioHtml(html) {
    var limpo = html ? ((typeof sanitizeRichHTML === "function") ? sanitizeRichHTML(html) : esc(html)) : "";
    var tem = limpo && limpo.replace(/<[^>]*>/g, "").trim();
    return tem ? '<div class="cmp-coment">' + limpo + "</div>" : '<p class="cmp-vazio">Sem comentário registrado.</p>';
  }
  function seta() { return ' <i class="bi bi-arrow-right cmp-seta" aria-hidden="true"></i> '; }
  /* "A → B" quando mudou; só o valor quando igual */
  function antesDepois(a, b, fmt) {
    fmt = fmt || esc;
    var ta = (a == null || a === "") ? "—" : fmt(a), tb = (b == null || b === "") ? "—" : fmt(b);
    return ta === tb ? tb : ta + seta() + tb;
  }
  function pctCurva(p) { return (p == null || !isFinite(p)) ? null : Number(p).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; }
  function vazio(v) { return v == null || !isFinite(Number(v)) || Number(v) === 0; }

  var QTDS = [
    { k: "qtdBase", rot: "Contratada" },
    { k: "acrescQ", rot: "Acréscimo" },
    { k: "suprQ", rot: "Supressão" },
    { k: "replanQ", rot: "Replanilhada" }
  ];
  var VALS = [
    { k: "vAcresc", rot: "Acréscimo" },
    { k: "vSupr", rot: "Supressão" },
    { k: "vReplan", rot: "Replanilhado" }
  ];
  var ROT_CAMPO = { replanQ: "Qtd. replanilhada", acrescQ: "Qtd. de acréscimo", suprQ: "Qtd. suprimida", qtdBase: "Qtd. contratada", valor: "Valor na curva" };

  /* ---------- texto da situação, específico do item ---------- */
  var NOMES_CAMPO = {
    qtdBase: "quantidade contratada", acrescQ: "quantidade de acréscimo", suprQ: "quantidade suprimida", replanQ: "quantidade replanilhada",
    vAcresc: "valor do acréscimo", vSupr: "valor da supressão", vReplan: "valor replanilhado", valor: "valor na curva"
  };
  function listaPt(xs) { return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " e " + xs[xs.length - 1]; }
  /* o que mudou, em palavras: as quantidades; se nenhuma mudou, os valores */
  function oQueMudou(r) {
    var q = r.alterados.filter(function (k) { return /Q$|^qtdBase$/.test(k); });
    var lista = (q.length ? q : r.alterados).map(function (k) { return NOMES_CAMPO[k]; }).filter(Boolean);
    return lista.length ? "<b>" + esc(listaPt(lista)) + "</b>" : "alguns campos";
  }
  function textoSituacao(r) {
    var vb = esc(nVer(st.base)), va = esc(nVer(st.ctx.versaoAtual));
    switch (r.situacao) {
      case "apont_igual": return "Apontado como inconsistente na " + vb + ", o item foi mantido sem nenhuma alteração de quantidade ou valor na " + va + ". Avalie se o apontamento foi atendido.";
      case "apont_alterado": return "Apontado como inconsistente na " + vb + ", o item teve alteração de " + oQueMudou(r) + " na " + va + ". Verifique se o ajuste atende ao apontamento.";
      case "apont_retirado": return "Apontado como inconsistente na " + vb + ", o item deixou de constar na " + va + ".";
      case "ok_alterado": return "Analisado como OK na " + vb + ", o item teve alteração de " + oQueMudou(r) + " na " + va + ". Reavalie o item.";
      case "novo": return "O item não constava na " + vb + " e precisa de análise completa.";
      case "alterado": return "O item não foi analisado na " + vb + " e teve alteração de " + oQueMudou(r) + " na " + va + ".";
      case "retirado": return "O item constava na " + vb + ", sem apontamento, e deixou de constar na " + va + ".";
      default:
        return r.base && r.base.statusAnalise === "ok"
          ? "Quantidades e valores iguais aos da " + vb + ", onde o item foi analisado como OK."
          : "Quantidades e valores iguais aos da " + vb + ".";
    }
  }

  /* cartão de destaque: valor atual grande, anterior e variação embaixo */
  function cartao(rot, depois, antes, a, b, opc) {
    opc = opc || {};
    var linha;
    if (opc.novo) linha = '<span class="cmp-k-ant">não constava na ' + esc(vCurta(st.base)) + "</span>";
    else if (opc.mantido) linha = '<span class="cmp-k-ant">igual à ' + esc(vCurta(st.base)) + "</span>";
    else linha = '<span class="cmp-k-ant">era ' + antes + "</span>" + (opc.semDif ? "" : '<span class="cmp-k-dif">' + dif(a, b) + "</span>") + varHtml(a, b);
    return '<div class="cmp-k' + (opc.tom ? " " + opc.tom : "") + '"><span class="cmp-k-rot">' + rot + "</span>"
      + '<span class="cmp-k-val">' + depois + "</span>" + '<span class="cmp-k-pe">' + linha + "</span></div>";
  }

  function itemHtml(r, nav) {
    var s = M.SITUACOES[r.situacao], x = r.atual || r.base, b0 = r.base, a0 = r.atual, base = st.base, atual = st.ctx.versaoAtual;
    var ambos = !!(b0 && a0), un = x.un ? esc(x.un) : "";
    var par = M.parDaCurva(a0) || M.parDaCurva(b0);
    var t = ambos ? M.tendencia(r) : { campo: par ? par.q : "replanQ" };

    /* ----- cabeçalho ----- */
    var h = '<header class="cmp-cab"><div class="cmp-eyebrow">Comparação · ' + esc(nVer(base)) + " × " + esc(nVer(atual)) + "</div>"
      + '<h3 id="cmp-titulo"><span class="cmp-cod">' + esc(x.conta) + '</span><span class="cmp-desc" title="' + esc(x.desc) + '">' + esc(x.desc) + "</span></h3>"
      + '<dl class="cmp-meta">'
      + "<div><dt>Classe</dt><dd>" + antesDepois(b0 && b0.classe, a0 && a0.classe) + "</dd></div>"
      + "<div><dt>Posição na curva</dt><dd>" + antesDepois(b0 && b0.pos, a0 && a0.pos) + "</dd></div>"
      + ((b0 && b0.pctInd != null) || (a0 && a0.pctInd != null) ? "<div><dt>Participação</dt><dd>" + antesDepois(b0 && pctCurva(b0.pctInd), a0 && pctCurva(a0.pctInd), String) + "</dd></div>" : "")
      + (un ? "<div><dt>Unidade</dt><dd>" + un + "</dd></div>" : "")
      + (x.comp ? "<div><dt>Composição</dt><dd>" + esc(x.comp) + "</dd></div>" : "")
      + "</dl></header>";

    /* ----- situação ----- */
    h += '<div class="cmp-chip ' + s.tom + '"><i class="bi ' + s.ico + '" aria-hidden="true"></i><div><b>' + esc(s.rot) + "</b>"
      + "<span>" + textoSituacao(r) + "</span></div></div>";
    var notas = [];
    if (r.via === "descricao") notas.push("A conta mudou de <b>" + esc(b0.conta) + "</b> para <b>" + esc(a0.conta) + "</b>; o serviço foi identificado pelo código da composição e pela descrição.");
    if (r.descMudou && r.via === "conta") notas.push("Descrição na " + esc(vCurta(base)) + ": <i>" + esc(b0.desc) + "</i>. Verifique se trata do mesmo serviço.");
    if (notas.length) h += '<ul class="cmp-notas">' + notas.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul>";

    /* ----- destaques: quantidade da curva, valor na curva, preço unitário ----- */
    var cq = t.campo === "valor" ? "replanQ" : t.campo;
    var qa = b0 ? b0[cq] : null, qb = a0 ? a0[cq] : null;
    var cards = cartao(esc(ROT_CAMPO[cq]) + (un ? " (" + un + ")" : ""),
      a0 ? nfmt(qb) : "—", nfmt(qa), qa, qb, { novo: !b0, mantido: ambos && dif(qa, qb) === "—" });
    var va = b0 ? Math.abs(b0.valor) : null, vb = a0 ? Math.abs(a0.valor) : null;
    cards += cartao("Valor na curva (R$)", a0 ? nfmt(vb) : "—", nfmt(va), va, vb, { novo: !b0, mantido: ambos && dif(va, vb) === "—" });
    var pa = M.precoUnitario(b0, M.parDaCurva(b0) || par), pb = M.precoUnitario(a0, M.parDaCurva(a0) || par);
    if (pa != null || pb != null) {
      var mudouPreco = pa != null && pb != null && dif(pa, pb) !== "—";
      cards += cartao("Preço unitário (R$" + (un ? "/" + un : "") + ")", pb != null ? nfmt(pb) : "—", nfmt(pa), pa, pb,
        { novo: !b0, mantido: pa != null && pb != null && !mudouPreco, semDif: true, tom: mudouPreco ? "atencao" : "" });
    }
    h += '<div class="cmp-kpis">' + cards + "</div>";

    /* ----- quadro detalhado: quantidades ou valores ----- */
    var aba = st.aba === "valor" ? "valor" : "qtd", lista = aba === "valor" ? VALS : QTDS;
    var marcado = par ? (aba === "valor" ? par.v : par.q) : null;
    h += '<div class="cmp-sec"><h4>Detalhamento</h4><span class="cmp-seg" role="group" aria-label="Mostrar">'
      + '<button type="button" data-cmp="aba" data-v="qtd" aria-pressed="' + (aba === "qtd") + '" class="' + (aba === "qtd" ? "on" : "") + '">Quantidades</button>'
      + '<button type="button" data-cmp="aba" data-v="valor" aria-pressed="' + (aba === "valor") + '" class="' + (aba === "valor" ? "on" : "") + '">Valores (R$)</button></span></div>';
    h += '<div class="cmp-grade" role="table"><div class="cmp-gl cmp-gh" role="row"><span role="columnheader">' + (aba === "valor" ? "Valor (R$)" : "Quantidade" + (un ? " (" + un + ")" : "")) + "</span>"
      + '<span role="columnheader">' + esc(nVer(base)) + '</span><span role="columnheader">' + esc(nVer(atual)) + "</span>"
      + '<span role="columnheader">Diferença</span><span role="columnheader">%</span></div>'
      + lista.map(function (f) {
        var a = b0 ? b0[f.k] : null, b = a0 ? a0[f.k] : null;
        var mudou = ambos && dif(a, b) !== "—", nada = vazio(a) && vazio(b);
        return '<div class="cmp-gl' + (mudou ? " mudou" : "") + (nada ? " nada" : "") + '" role="row"><span role="cell">' + esc(f.rot)
          + (f.k === marcado ? ' <em class="cmp-tag" title="Coluna usada para montar a curva">curva</em>' : "") + "</span>"
          + '<span role="cell">' + (b0 ? nfmt(a) : "—") + '</span><span role="cell">' + (a0 ? nfmt(b) : "—") + "</span>"
          + '<span role="cell">' + (ambos ? dif(a, b) : "—") + '</span><span role="cell">' + (ambos ? varHtml(a, b) : "—") + "</span></div>";
      }).join("") + "</div>";

    /* ----- análise registrada na versão anterior ----- */
    if (b0) {
      var sb = b0.statusAnalise, analisado = sb === "ok" || sb === "inconsistencia";
      var por = analisado
        ? ((b0.analisadoPor || b0.analisadoEm) ? '<span class="cmp-reg-por">' + esc(b0.analisadoPor || "") + (b0.analisadoEm ? " · " + dataBr(b0.analisadoEm) : "") + "</span>" : "")
        : '<span class="cmp-reg-por">Item não analisado nessa versão</span>';
      h += '<div class="cmp-sec"><h4>Análise na ' + esc(nVer(base)) + "</h4></div>"
        + '<div class="cmp-registro"><div class="cmp-reg-cab">' + badgeStatus(sb) + por + "</div>"
        + (analisado ? comentarioHtml(b0.comentario) : "") + "</div>";
    }

    h += analiseAtualHtml(r);

    /* ----- rodapé: navegação entre itens ----- */
    h += '<footer class="cfm-acoes cmp-pe">'
      + (nav ? '<div class="cmp-nav"><button type="button" class="cmp-navb" data-cmp="anterior" aria-label="Item anterior (seta para a esquerda)" title="Item anterior (←)"' + (nav.i > 0 ? "" : " disabled") + '><i class="bi bi-chevron-left" aria-hidden="true"></i></button>'
        + '<span class="cmp-nav-txt">Item <b>' + (nav.i + 1) + "</b> de " + nav.n + "</span>"
        + '<button type="button" class="cmp-navb" data-cmp="proximo" aria-label="Próximo item (seta para a direita)" title="Próximo item (→)"' + (nav.i < nav.n - 1 ? "" : " disabled") + '><i class="bi bi-chevron-right" aria-hidden="true"></i></button></div>' : "")
      + '<button type="button" class="cfm-btn" data-cmp="fechar" data-foco>Fechar</button></footer>';
    return h;
  }

  /* ----- análise na versão em tela: status, comentário e "repetir apontamento" ----- */
  /* texto puro de um HTML; DOMParser não carrega imagens nem roda handlers (ao contrário de innerHTML num div solto) */
  function textoDe(html) {
    if (!html) return "";
    var doc = new DOMParser().parseFromString(String(html), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function limpo(html) { return (typeof sanitizeRichHTML === "function") ? sanitizeRichHTML(html || "") : esc(textoDe(html)); }
  function comentarioEmEdicao(x) { var r = st.rascunho[x.dbId]; return r != null ? r : (x.comentario || ""); }
  function comentarioSujo(x) { var r = st.rascunho[x.dbId]; return r != null && textoDe(r) !== textoDe(x.comentario); }
  /* dá para repetir: havia inconsistência com comentário na anterior e ele ainda não está no comentário atual */
  function podeRepetir(r) {
    var tb = r.base && r.base.statusAnalise === "inconsistencia" ? textoDe(r.base.comentario) : "";
    return !!tb && textoDe(comentarioEmEdicao(r.atual)).indexOf(tb) === -1;
  }

  function analiseAtualHtml(r) {
    var a0 = r.atual; if (!a0) return "";
    var va = nVer(st.ctx.versaoAtual), sa = a0.statusAnalise || "pendente";
    var pode = !!(st.ctx.podeEditar && st.ctx.podeEditar());
    var h = '<div class="cmp-sec"><h4>Análise na ' + esc(va) + "</h4></div>";
    if (!pode) {
      return h + '<div class="cmp-registro"><div class="cmp-reg-cab">' + badgeStatus(sa) + '<span class="cmp-reg-por">Somente leitura</span></div>'
        + ((sa !== "pendente" || a0.comentario) ? comentarioHtml(a0.comentario) : "") + "</div>";
    }
    function btnSt(v, ico, rot) {
      var on = sa === v;
      return '<button type="button" class="cmp-stb ' + v + (on ? " on" : "") + '" data-cmp="st" data-v="' + v + '" aria-pressed="' + on + '"'
        + (on ? ' title="Clique de novo para voltar a pendente"' : "") + '><i class="bi ' + ico + '" aria-hidden="true"></i>' + rot + "</button>";
    }
    var aviso = st.aviso && st.aviso.dbId === a0.dbId ? st.aviso : null, sujo = comentarioSujo(a0);
    var estado = aviso ? '<span class="cmp-ed-msg ' + aviso.tipo + '">' + esc(aviso.texto) + "</span>"
      : (sujo ? '<span class="cmp-ed-msg">Alterações não salvas — são salvas também ao navegar ou fechar</span>' : "");
    return h + '<div class="cmp-analise">'
      + '<div class="cmp-stbar"><span class="cmp-stg" role="group" aria-label="Status do item na ' + esc(va) + '">'
      + btnSt("ok", "bi-check-lg", "OK") + btnSt("inconsistencia", "bi-x-lg", "Inconsistência") + "</span>"
      + (podeRepetir(r) ? '<button type="button" class="cmp-lnk" data-cmp="repetir" title="Copia o comentário da ' + esc(vCurta(st.base))
        + ' para esta versão e marca o item como Inconsistência"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Repetir apontamento da ' + esc(vCurta(st.base)) + "</button>" : "")
      + "</div>"
      + '<div class="cmp-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Comentário da análise" data-cmp-ed data-ph="Comentário da análise (opcional)">'
      + limpo(comentarioEmEdicao(a0)) + "</div>"
      + '<div class="cmp-ed-pe"><span class="cmp-ed-st">' + estado + "</span>"
      + '<button type="button" class="cfm-btn sec cmp-btn-p" data-cmp="salvarCom"' + (sujo ? "" : " disabled") + ">Salvar comentário</button></div>"
      + "</div>";
  }

  /* grava o comentário em edição (se houver); devolve null ou a mensagem de erro */
  async function salvarRascunho(dbId) {
    var r = st.res && st.res.itens[st.porDbId[dbId]], x = r && r.atual;
    if (!x || st.rascunho[dbId] == null) return null;
    if (!comentarioSujo(x)) { delete st.rascunho[dbId]; return null; }
    var msg = await st.ctx.gravarComentario(dbId, st.rascunho[dbId]);
    if (!msg) delete st.rascunho[dbId];
    return msg;
  }

  /* ordem de navegação = itens visíveis na tabela (respeita busca e filtro da comparação) */
  function ordemNavegacao() {
    var lista = (st.ctx.itensVisiveis ? st.ctx.itensVisiveis() : st.ctx.itensAtuais()) || [];
    return lista.filter(function (x) { return x && x.dbId != null && st.porDbId[x.dbId] != null; })
      .map(function (x) { return x.dbId; });
  }
  function mostrarItem(dbId) {
    var r = st.res.itens[st.porDbId[dbId]]; if (!r) return;
    var ordem = st.ordem, i = ordem.indexOf(dbId);
    function avisar(tipo, texto) { st.aviso = { dbId: dbId, tipo: tipo, texto: texto }; }
    abrirJanela(itemHtml(r, i > -1 ? { i: i, n: ordem.length } : null), async function (nome, el) {
      if (nome === "editar") {
        st.rascunho[dbId] = el.innerHTML;
        if (st.aviso && st.aviso.dbId === dbId) st.aviso = null;
        var caixa = el.closest(".cmp-analise"), sujo = comentarioSujo(r.atual);
        caixa.querySelector('[data-cmp="salvarCom"]').disabled = !sujo;
        caixa.querySelector(".cmp-ed-st").innerHTML = sujo ? '<span class="cmp-ed-msg">Alterações não salvas — são salvas também ao navegar ou fechar</span>' : "";
        return;
      }
      if (st.ocupado) return false;
      if (nome === "aba") { st.aba = el.getAttribute("data-v"); mostrarItem(dbId); return; }
      st.ocupado = true;
      try {
        var msg;
        if (nome === "fechar" || nome === "anterior" || nome === "proximo") {
          var j = i + (nome === "anterior" ? -1 : 1);
          if (nome !== "fechar" && !(i > -1 && j >= 0 && j < ordem.length)) return;
          msg = await salvarRascunho(dbId);
          if (msg) { avisar("erro", "Não foi possível salvar o comentário: " + msg); mostrarItem(dbId); return false; }
          st.aviso = null;
          if (nome !== "fechar") mostrarItem(ordem[j]);
          return;
        }
        if (nome === "st") {
          var v = el.getAttribute("data-v"), novo = (r.atual.statusAnalise === v) ? "pendente" : v;
          msg = await st.ctx.gravarStatus(dbId, novo);
          if (msg) avisar("erro", "Não foi possível salvar o status: " + msg);
          else avisar("ok", novo === "pendente" ? "Item voltou para pendente." : "Status salvo: " + rotStatus(novo) + ".");
          mostrarItem(dbId); return;
        }
        if (nome === "salvarCom") {
          msg = await salvarRascunho(dbId);
          avisar(msg ? "erro" : "ok", msg ? "Não foi possível salvar o comentário: " + msg : "Comentário salvo.");
          mostrarItem(dbId); return;
        }
        if (nome === "repetir") {
          var atualTxt = comentarioEmEdicao(r.atual);
          st.rascunho[dbId] = (textoDe(atualTxt) ? atualTxt : "") + limpo(r.base.comentario);
          msg = await salvarRascunho(dbId);
          if (!msg && r.atual.statusAnalise !== "inconsistencia") msg = await st.ctx.gravarStatus(dbId, "inconsistencia");
          avisar(msg ? "erro" : "ok", msg ? "Não foi possível repetir o apontamento: " + msg : "Apontamento da " + vCurta(st.base) + " repetido e salvo.");
          mostrarItem(dbId); return;
        }
      } finally { st.ocupado = false; }
    });
  }

  /* ---------- selo da tabela ---------- */
  /* aparência de cada tendência: ícone, texto curto e frase para o título/leitor de tela */
  var SELOS = {
    aumentou: { ico: "bi-arrow-up-short", frase: "Aumentou" },
    diminuiu: { ico: "bi-arrow-down-short", frase: "Diminuiu" },
    alterado: { ico: "bi-arrow-left-right", txt: "Alterado", frase: "Quantidade final mantida, com outras alterações" },
    igual: { ico: "bi-dash", txt: "", frase: "Sem alteração" },
    novo: { ico: "bi-plus", txt: "Novo", frase: "Item incluído — não constava na versão anterior" }
  };

  function botao(x) {
    if (!st.res || !x || x.dbId == null) return "";
    var i = st.porDbId[x.dbId]; if (i == null) return "";
    var r = st.res.itens[i], t = M.tendencia(r), s = SELOS[t.tipo];
    var txt = s.txt != null ? s.txt : (t.pct != null ? pctFmt(t.pct) : "");
    var apontado = r.base && r.base.statusAnalise === "inconsistencia";
    /* apontado e nada mudou: o caso que mais interessa ao analista — escreve por extenso */
    if (t.tipo === "igual" && apontado) txt = "Igual";

    var titulo = s.frase;
    if ((t.tipo === "aumentou" || t.tipo === "diminuiu"))
      titulo += " — " + (ROT_CAMPO[t.campo] || "").toLowerCase() + (t.campo === "valor" ? " R$ " : " ") + nfmt(t.de) + " → " + nfmt(t.para) + (t.pct != null ? " (" + pctFmt(t.pct) + ")" : "");
    if (apontado) titulo += ". Inconsistência apontada na " + vCurta(st.base);
    titulo += ". Clique para comparar com a " + vCurta(st.base) + ".";

    return '<button type="button" class="cv-cmp-selo ' + t.tipo + (apontado ? " apontado" : "") + '" data-cmp-id="' + x.dbId
      + '" title="' + esc(titulo) + '" aria-label="' + esc(titulo) + '">'
      + (apontado ? '<span class="cv-cmp-pt" aria-hidden="true"></span>' : "")
      + '<i class="bi ' + s.ico + '" aria-hidden="true"></i>' + (txt ? "<span>" + esc(txt) + "</span>" : "") + "</button>";
  }

  /* ---------- API usada por curva_abc.js ---------- */
  /* Liga a comparação em silêncio contra a versão imediatamente anterior. Chamado sempre que
     uma versão salva entra em tela; se outra versão entrar antes de terminar, o resultado é
     descartado (geracao). */
  var geracao = 0;
  async function preparar(ctx) {
    limpar();
    var g = geracao;
    st.ctx = ctx;
    var ant = anteriores();
    if (!ant.length) return;
    try { await carregarItens(ant[0]); }
    catch (e) { console.warn("Comparação de versões: não foi possível carregar a versão anterior", e); return; }
    if (g !== geracao) return;
    st.base = ant[0];
    calcular();
    if (typeof ctx.aoAtualizar === "function") ctx.aoAtualizar();
  }
  function ativa() { return !!st.res; }
  function detalhe(dbId) {
    if (!st.res || st.porDbId[dbId] == null) return;
    calcular(); /* a análise da versão atual pode ter mudado desde a preparação */
    st.ordem = ordemNavegacao(); st.aviso = null;
    mostrarItem(dbId);
  }
  /* filtro "Comparação" da tabela */
  function registroDe(x) { return (st.res && x && x.dbId != null && st.porDbId[x.dbId] != null) ? st.res.itens[st.porDbId[x.dbId]] : null; }
  function filtrar(x, v) { var r = registroDe(x); return !!r && M.filtrar(r, v); }
  function opcoesFiltro() { return st.res ? M.opcoesFiltro(st.res.itens) : []; }
  /* itens da versão em tela que podem ir para "OK em lote" */
  function candidatosOkLote() { return st.res ? st.res.itens.filter(M.okEmLote).map(function (r) { return r.atual; }) : []; }
  function versaoBase() { return st.base ? vCurta(st.base) : ""; }
  /* desliga a comparação (troca de versão, novo upload, saída da aba) */
  function limpar() { geracao++; st.res = null; st.base = null; st.porDbId = {}; st.rascunho = {}; st.aviso = null; st.ordem = []; }
  /* cache das versões de base só vale para o processo aberto */
  function esquecer() { limpar(); st.cache = {}; st.ctx = null; }

  window.CvComparacao = {
    preparar: preparar, ativa: ativa, botao: botao, detalhe: detalhe, limpar: limpar, esquecer: esquecer,
    filtrar: filtrar, opcoesFiltro: opcoesFiltro, candidatosOkLote: candidatosOkLote, versaoBase: versaoBase
  };
})();
