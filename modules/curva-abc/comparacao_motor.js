/* Comparação entre versões da Curva ABC de um processo — motor (funções puras).
   Pareia os serviços de duas versões (a "base", mais antiga, e a "atual", em tela) e diz o
   que aconteceu com cada um: igual, alterado, novo, retirado — cruzado com a análise que o
   analista registrou na base (OK / Inconsistência / pendente). Não toca em DOM nem banco.
   Os itens seguem o formato de state.curva em curva_abc.js (conta, comp, desc, un, qtdBase,
   acrescQ, suprQ, replanQ, vAcresc, vSupr, vReplan, valor, classe, statusAnalise...).
   Testes: node --test modules/curva-abc/comparacao_motor.test.js */
(function (raiz) {
  "use strict";

  /* Campos comparados, na ordem em que aparecem na janela do item. */
  var CAMPOS = [
    { k: "qtdBase", rot: "Qtd. contratada", tipo: "qtd" },
    { k: "acrescQ", rot: "Acréscimo (qtd.)", tipo: "qtd" },
    { k: "suprQ", rot: "Supressão (qtd.)", tipo: "qtd" },
    { k: "replanQ", rot: "Replanilhado (qtd.)", tipo: "qtd" },
    { k: "vAcresc", rot: "V. Acréscimo", tipo: "valor" },
    { k: "vSupr", rot: "V. Supressão", tipo: "valor" },
    { k: "vReplan", rot: "V. Replanilhado", tipo: "valor" },
    { k: "valor", rot: "Valor na curva", tipo: "valor" }
  ];

  /* Situação de cada serviço. `atencao` = o analista provavelmente precisa olhar;
     `tom` dá a cor (atencao | info | ok | neutro) e `ico` o ícone (Bootstrap Icons). */
  var SITUACOES = {
    apont_igual:    { rot: "Apontamento sem ajuste", dica: "Item apontado como inconsistente não teve nenhuma alteração na nova versão", atencao: true, tom: "atencao", ico: "bi-exclamation-circle" },
    apont_alterado: { rot: "Apontamento com ajuste", dica: "Item apontado como inconsistente foi alterado na nova versão — verificar se o ajuste atende", atencao: false, tom: "info", ico: "bi-arrow-repeat" },
    apont_retirado: { rot: "Item apontado retirado da curva", dica: "Item apontado como inconsistente deixou de constar na nova versão", atencao: false, tom: "ok", ico: "bi-check2-circle" },
    ok_alterado:    { rot: "Item aprovado foi alterado", dica: "Item analisado como OK foi alterado na nova versão — reavaliar", atencao: true, tom: "atencao", ico: "bi-exclamation-triangle" },
    novo:           { rot: "Item novo", dica: "Não constava na versão anterior — requer análise completa", atencao: true, tom: "atencao", ico: "bi-plus-circle" },
    alterado:       { rot: "Item alterado", dica: "Item não analisado na versão anterior foi alterado na nova versão", atencao: false, tom: "info", ico: "bi-arrow-repeat" },
    retirado:       { rot: "Item retirado da curva", dica: "Item sem apontamento deixou de constar na nova versão", atencao: false, tom: "neutro", ico: "bi-dash-circle" },
    igual:          { rot: "Sem alteração", dica: "Quantidades e valores iguais aos da versão anterior", atencao: false, tom: "neutro", ico: "bi-check2" }
  };
  var ORDEM = ["apont_igual", "apont_alterado", "apont_retirado", "ok_alterado", "novo", "alterado", "retirado", "igual"];

  function semAcento(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function normConta(s) { return String(s == null ? "" : s).replace(/\s+/g, "").toUpperCase(); }
  function normDesc(s) { return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  /* número da planilha → número com 2 casas, ou null quando vazio */
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  /* vazio e zero contam como iguais (a planilha às vezes deixa a célula em branco) */
  function iguais(a, b) {
    var x = num(a), y = num(b);
    if (x === y) return true;
    return (x === null && y === 0) || (x === 0 && y === null);
  }

  /* Pareia por Conta; o que sobrar, por código da composição + descrição (planilha
     renumerada), desde que o par seja único dos dois lados. */
  function parear(base, atual) {
    var porConta = {}, usadosBase = {}, pares = [];
    base.forEach(function (b, i) {
      var c = normConta(b.conta);
      if (c && porConta[c] == null) porConta[c] = i;
    });
    var semPar = [];
    atual.forEach(function (a, j) {
      var i = porConta[normConta(a.conta)];
      if (normConta(a.conta) && i != null && !usadosBase[i]) { usadosBase[i] = true; pares.push({ j: j, i: i, via: "conta" }); }
      else semPar.push(j);
    });

    function chave(x) { var c = normConta(x.comp), d = normDesc(x.desc); return (c && d) ? c + "|" + d : null; }
    var contagemBase = {}, idxBase = {};
    base.forEach(function (b, i) {
      if (usadosBase[i]) return;
      var k = chave(b); if (!k) return;
      contagemBase[k] = (contagemBase[k] || 0) + 1; idxBase[k] = i;
    });
    var contagemAtual = {};
    semPar.forEach(function (j) { var k = chave(atual[j]); if (k) contagemAtual[k] = (contagemAtual[k] || 0) + 1; });

    var novos = [];
    semPar.forEach(function (j) {
      var k = chave(atual[j]);
      if (k && contagemBase[k] === 1 && contagemAtual[k] === 1) {
        usadosBase[idxBase[k]] = true;
        pares.push({ j: j, i: idxBase[k], via: "descricao" });
      } else novos.push(j);
    });
    var retirados = [];
    base.forEach(function (b, i) { if (!usadosBase[i]) retirados.push(i); });
    return { pares: pares, novos: novos, retirados: retirados };
  }

  function camposAlterados(b, a) {
    return CAMPOS.filter(function (f) { return !iguais(b[f.k], a[f.k]); }).map(function (f) { return f.k; });
  }

  function situacaoDe(statusBase, alterado) {
    if (statusBase === "inconsistencia") return alterado ? "apont_alterado" : "apont_igual";
    if (statusBase === "ok") return alterado ? "ok_alterado" : "igual";
    return alterado ? "alterado" : "igual";
  }

  /* Devolve:
     itens     — um por serviço da versão ATUAL: { atual, base|null, via, situacao, alterados[], descMudou, classeMudou }
     retirados — um por serviço que só existe na BASE: { atual:null, base, situacao }
     resumo    — contagens por situação, apontamentos da base e totais de valor */
  function comparar(base, atual) {
    base = base || []; atual = atual || [];
    var p = parear(base, atual);
    var itens = new Array(atual.length);

    p.pares.forEach(function (par) {
      var a = atual[par.j], b = base[par.i];
      var alt = camposAlterados(b, a);
      itens[par.j] = {
        atual: a, base: b, via: par.via,
        situacao: situacaoDe(b.statusAnalise, alt.length > 0),
        alterados: alt,
        descMudou: normDesc(a.desc) !== normDesc(b.desc),
        classeMudou: (a.classe || "") !== (b.classe || "")
      };
    });
    p.novos.forEach(function (j) {
      itens[j] = { atual: atual[j], base: null, via: null, situacao: "novo", alterados: [], descMudou: false, classeMudou: false };
    });
    var retirados = p.retirados.map(function (i) {
      var b = base[i];
      return { atual: null, base: b, via: null, situacao: b.statusAnalise === "inconsistencia" ? "apont_retirado" : "retirado",
        alterados: [], descMudou: false, classeMudou: false };
    });

    var contagem = {};
    ORDEM.forEach(function (s) { contagem[s] = 0; });
    itens.concat(retirados).forEach(function (r) { contagem[r.situacao]++; });

    function soma(lista) { return lista.reduce(function (s, x) { return s + Math.abs(Number(x.valor) || 0); }, 0); }
    var resumo = {
      contagem: contagem,
      apontamentosBase: base.filter(function (b) { return b.statusAnalise === "inconsistencia"; }).length,
      totalBase: soma(base), totalAtual: soma(atual),
      qtdBase: base.length, qtdAtual: atual.length
    };
    return { itens: itens, retirados: retirados, resumo: resumo };
  }

  /* ---------- coluna da curva e preço unitário ---------- */
  /* A curva é montada por uma coluna de valor (V. Replanilhado, V. Acréscimo ou V. Supressão).
     Descobre qual, comparando o "valor" do item com cada coluna, e devolve o par
     quantidade/valor correspondente — é ele que a análise acompanha. */
  var PARES = [
    { q: "replanQ", v: "vReplan", rot: "Replanilhada" },
    { q: "acrescQ", v: "vAcresc", rot: "Acréscimo" },
    { q: "suprQ", v: "vSupr", rot: "Supressão" }
  ];
  function parDaCurva(x) {
    if (!x) return null;
    var val = Math.abs(num(x.valor) || 0);
    if (!val) return null;
    for (var i = 0; i < PARES.length; i++) {
      var v = num(x[PARES[i].v]);
      if (v !== null && Math.abs(Math.abs(v) - val) < 0.015) return PARES[i];
    }
    return null;
  }
  /* preço unitário implícito (valor ÷ quantidade da mesma coluna); null se não dá para calcular */
  function precoUnitario(x, par) {
    if (!x || !par) return null;
    var q = num(x[par.q]), v = num(x[par.v]);
    return (q && v !== null) ? Math.round(Math.abs(v) / Math.abs(q) * 100) / 100 : null;
  }

  /* ---------- tendência (selo da tabela) ---------- */
  /* O que aconteceu com o serviço em relação à versão anterior, para o analista ver sem abrir:
     tipo "novo" | "aumentou" | "diminuiu" | "alterado" (quantidade da curva igual, outro campo
     mudou) | "igual". Mede pela quantidade da coluna que monta a curva (ex.: acréscimo, se a
     curva é por V. Acréscimo); sem ela, pela replanilhada; sem nenhuma, pelo valor na curva.
     pct = variação % (null se a base é 0). */
  function campoDaTendencia(r) {
    var par = parDaCurva(r.atual) || parDaCurva(r.base);
    var tem = function (k) { return num(r.base[k]) !== null || num(r.atual[k]) !== null; };
    if (par && tem(par.q)) return par.q;
    return tem("replanQ") ? "replanQ" : "valor";
  }
  function tendencia(r) {
    if (!r.base) return { tipo: "novo", campo: null, de: null, para: null, pct: null };
    var campo = campoDaTendencia(r);
    var de = num(r.base[campo]) || 0, para = num(r.atual[campo]) || 0;
    if (campo === "valor") { de = Math.abs(de); para = Math.abs(para); }
    var pct = de ? (para - de) / Math.abs(de) * 100 : null;
    var tipo = para > de ? "aumentou" : (para < de ? "diminuiu" : (r.alterados.length ? "alterado" : "igual"));
    return { tipo: tipo, campo: campo, de: de, para: para, pct: tipo === "aumentou" || tipo === "diminuiu" ? pct : null };
  }

  /* ---------- filtro da tabela e OK em lote ---------- */
  function pendente(x) { return !!x && (!x.statusAnalise || x.statusAnalise === "pendente"); }
  function tipoT(r) { return r.atual ? tendencia(r).tipo : null; }
  /* opções do filtro "Comparação" (na ordem do menu); `t(r)` diz se o registro entra */
  var FILTROS = [
    { v: "apontados", rot: "Apontados na versão anterior", t: function (r) { return !!r.base && r.base.statusAnalise === "inconsistencia"; } },
    { v: "apont_igual", rot: SITUACOES.apont_igual.rot, t: function (r) { return r.situacao === "apont_igual"; } },
    { v: "apont_alterado", rot: SITUACOES.apont_alterado.rot, t: function (r) { return r.situacao === "apont_alterado"; } },
    { v: "ok_alterado", rot: SITUACOES.ok_alterado.rot, t: function (r) { return r.situacao === "ok_alterado"; } },
    { v: "novo", rot: "Itens novos", t: function (r) { return r.situacao === "novo"; } },
    { v: "aumentou", rot: "Aumentaram", t: function (r) { return tipoT(r) === "aumentou"; } },
    { v: "diminuiu", rot: "Diminuíram", t: function (r) { return tipoT(r) === "diminuiu"; } },
    { v: "alterado", rot: "Outras alterações", t: function (r) { return tipoT(r) === "alterado"; } },
    { v: "igual", rot: "Sem alteração", t: function (r) { return tipoT(r) === "igual"; } },
    { v: "pendentes", rot: "Pendentes de análise nesta versão", t: function (r) { return pendente(r.atual); } }
  ];
  function filtrar(r, v) {
    var f = FILTROS.find(function (x) { return x.v === v; });
    return !f || (!!r && !!r.atual && f.t(r));
  }
  /* opções com contagem (só as que têm itens) */
  function opcoesFiltro(itens) {
    return FILTROS.map(function (f) {
      return { v: f.v, rot: f.rot, n: itens.filter(function (r) { return r && r.atual && f.t(r); }).length };
    }).filter(function (o) { return o.n > 0; });
  }
  /* OK em lote: igual à versão anterior, lá analisado como OK e ainda pendente aqui */
  function okEmLote(r) { return !!r && r.situacao === "igual" && !!r.base && r.base.statusAnalise === "ok" && pendente(r.atual); }

  raiz.ComparacaoMotor = {
    comparar: comparar, tendencia: tendencia, filtrar: filtrar, opcoesFiltro: opcoesFiltro, okEmLote: okEmLote, FILTROS: FILTROS, parDaCurva: parDaCurva, precoUnitario: precoUnitario, PARES: PARES,
    CAMPOS: CAMPOS, SITUACOES: SITUACOES, ORDEM: ORDEM,
    _interno: { parear: parear, iguais: iguais, normDesc: normDesc }
  };
})(typeof window !== "undefined" ? window : globalThis);
