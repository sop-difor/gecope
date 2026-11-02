/* Conferência orçamentária — motor de cruzamento entre o orçamento aprovado pela
   fiscalização (planilha de replanilhamento da Curva ABC) e o orçamento revisado pela
   SOP (abas SINTÉTICO e QUADRA). Funções puras: recebem matrizes de células (o que o
   SheetJS devolve com header:1) e não tocam em DOM, banco nem Storage.
   Testes: node --test modules/curva-abc/conferencia_motor.test.js */
(function (raiz) {
  "use strict";

  var CASAS = 2;                 /* quantidades iguais até a 2ª casa decimal são "compatíveis" */
  var LIMIAR_PARECIDO = 0.85;    /* semelhança mínima de descrição para sugerir candidato */

  /* ---------- normalização ---------- */
  function semAcento(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function normCab(s) {
    return semAcento(s).toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
  }
  function normDesc(s) {
    return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function normUn(s) {
    return semAcento(s).toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/[^a-z0-9%]/g, "");
  }
  function txt(v) { return v == null ? "" : String(v).trim(); }
  function num(v) {
    if (v == null || v === "") return NaN;
    if (typeof v === "number") return v;
    var s = String(v).replace(/\s/g, "");
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    return /^-?\d*\.?\d+$/.test(s) ? parseFloat(s) : NaN;
  }
  function arred(v) { var f = Math.pow(10, CASAS); return Math.round(v * f) / f; }

  /* "CXXXX", "CX9000" e vazio não identificam composição nenhuma. */
  function codigoPlaceholder(c) { return !c || /^CX/i.test(c); }
  /* O orçamento da fiscalização às vezes traz o código real no começo da descrição
     ("#SOP0287 FORNECIMENTO ..."). */
  function codigoNaDescricao(desc) {
    var m = /^#\s*([A-Za-z]{1,4}\d{3,6})\b/.exec(desc || "");
    return m ? m[1].toUpperCase() : "";
  }
  function descSemMarca(desc) { return String(desc || "").replace(/^#\s*[A-Za-z]{1,4}\d{3,6}\s*/, ""); }

  /* ---------- localizar cabeçalho ---------- */
  function mapearCabecalho(aoa, campos) {
    for (var i = 0; i < Math.min(aoa.length, 40); i++) {
      var linha = aoa[i] || [], mapa = {}, falta = false;
      Object.keys(campos).forEach(function (campo) {
        for (var j = 0; j < linha.length; j++) {
          if (campos[campo].re.test(normCab(linha[j]))) { mapa[campo] = j; return; }
        }
        if (campos[campo].obrigatorio) falta = true;
      });
      if (!falta) { mapa.linhaCabecalho = i; return mapa; }
    }
    return null;
  }

  var CAMPOS_APROVADO = {
    conta: { re: /^(conta|item)$/ },
    comp: { re: /^(comp|cod|codigo)$/ },
    desc: { re: /^descri/, obrigatorio: true },
    un: { re: /^(un|und|unid)$/, obrigatorio: true },
    qtd: { re: /^(qtd|quant)$/, obrigatorio: true },
    acresc: { re: /^acresc$/ },
    supr: { re: /^supr(im)?$/ },
    replan: { re: /^replan$/, obrigatorio: true }
  };
  var CAMPOS_REVISADO = {
    item: { re: /^item$/ },
    cod: { re: /^cod(igo)?$/, obrigatorio: true },
    fonte: { re: /^fonte$/ },
    desc: { re: /^descri/, obrigatorio: true },
    un: { re: /^(un|und|unid)$/, obrigatorio: true },
    qtd: { re: /^(qtd|quant)$/, obrigatorio: true }
  };

  function montarItem(origem, linha, conta, cod, desc, un, qtd) {
    var real = codigoPlaceholder(cod) ? "" : cod.toUpperCase();
    var viaDescricao = false;
    if (!real) { real = codigoNaDescricao(desc); viaDescricao = !!real; }
    return {
      origem: origem, linha: linha, conta: conta, cod: cod, codigo: real, codigoNaDescricao: viaDescricao,
      desc: desc, descN: normDesc(descSemMarca(desc)), un: un, unN: normUn(un), qtd: qtd
    };
  }

  /* ---------- leitura ---------- */
  /* Aprovado: quantidade final = Replan. quando o serviço foi alterado; senão Qtd.
     Linhas de grupo (sem UN) ficam de fora. Serviços sem alteração entram normalmente. */
  function lerAprovado(aoa) {
    var cab = mapearCabecalho(aoa || [], CAMPOS_APROVADO);
    if (!cab) return { erro: "Não achei as colunas Descrição, UN, Qtd. e Replan. no orçamento aprovado.", itens: [] };
    var itens = [];
    for (var i = cab.linhaCabecalho + 1; i < aoa.length; i++) {
      var r = aoa[i] || [];
      var un = txt(r[cab.un]), desc = txt(r[cab.desc]);
      if (!un || !desc) continue;
      var qtd = num(r[cab.qtd]), replan = num(r[cab.replan]);
      var acresc = cab.acresc == null ? NaN : num(r[cab.acresc]);
      var supr = cab.supr == null ? NaN : num(r[cab.supr]);
      var final;
      if (isFinite(replan)) final = replan;
      else final = (isFinite(qtd) ? qtd : 0) + (isFinite(acresc) ? acresc : 0) - (isFinite(supr) ? supr : 0);
      var it = montarItem("APROVADO", i + 1, cab.conta == null ? "" : txt(r[cab.conta]),
        cab.comp == null ? "" : txt(r[cab.comp]), desc, un, final);
      it.qtdContrato = isFinite(qtd) ? qtd : 0;
      it.alterado = isFinite(replan) || isFinite(acresc) || isFinite(supr);
      itens.push(it);
    }
    return { itens: itens };
  }

  /* Revisado: uma aba por chamada. Serviço = linha com código e unidade. */
  function lerRevisado(aoa, aba) {
    var cab = mapearCabecalho(aoa || [], CAMPOS_REVISADO);
    if (!cab) return { erro: "Não achei as colunas Código, Descrição, UND e QTD na aba " + aba + ".", itens: [] };
    var itens = [];
    for (var i = cab.linhaCabecalho + 1; i < aoa.length; i++) {
      var r = aoa[i] || [];
      var cod = txt(r[cab.cod]), un = txt(r[cab.un]);
      if (!cod || !un) continue;
      var qtd = num(r[cab.qtd]);
      itens.push(montarItem(aba, i + 1, cab.item == null ? "" : txt(r[cab.item]), cod, txt(r[cab.desc]), un, isFinite(qtd) ? qtd : 0));
    }
    return { itens: itens };
  }

  /* Só SINTÉTICO e QUADRA; "MEMÓRIA QUADRA", "ESTRUTURA QUADRA" etc. não contam. */
  function escolherAbas(nomes) {
    var achou = { SINTETICO: null, QUADRA: null };
    (nomes || []).forEach(function (n) {
      var k = normCab(n);
      if (k === "sintetico") achou.SINTETICO = n;
      else if (k === "quadra") achou.QUADRA = n;
    });
    return achou;
  }

  /* ---------- validação (avisos, nunca descarta nada) ---------- */
  function validar(aprovado, revisado) {
    var avisos = [];
    if (!aprovado.length) avisos.push({ nivel: "erro", texto: "Nenhum serviço encontrado no orçamento aprovado." });
    if (!revisado.length) avisos.push({ nivel: "erro", texto: "Nenhum serviço encontrado nas abas SINTÉTICO e QUADRA." });
    var vistos = {}, dup = 0, entreAbas = 0;
    revisado.forEach(function (x) {
      var k = x.conta + "|" + x.cod + "|" + x.qtd;
      if (vistos[k] && vistos[k] !== x.origem) entreAbas++;
      else if (vistos[k]) dup++;
      vistos[k] = vistos[k] || x.origem;
    });
    if (dup) avisos.push({ nivel: "aviso", texto: dup + " linha(s) da planilha revisada repetem item, código e quantidade na mesma aba. Conferir se não é duplicidade." });
    if (entreAbas) avisos.push({ nivel: "aviso", texto: entreAbas + " linha(s) repetem item, código e quantidade entre SINTÉTICO e QUADRA. Conferir se a quadra não foi contada duas vezes." });
    var vazias = revisado.filter(function (x) { return !x.qtd; }).length;
    if (vazias) avisos.push({ nivel: "info", texto: vazias + " serviço(s) da revisada sem quantidade; tratados como zero." });
    return avisos;
  }

  /* ---------- agrupamento ---------- */
  /* Mesmo serviço repetido em vários ambientes/categorias vira um total só. A chave é
     (código, unidade); sem código válido, (descrição, unidade). A hierarquia da planilha
     (Infraestrutura × Estrutura etc.) não entra na chave. */
  function agrupar(itens) {
    var mapa = {}, ordem = [];
    itens.forEach(function (x) {
      var chave = x.codigo ? "C|" + x.codigo + "|" + x.unN : "D|" + x.descN + "|" + x.unN;
      var g = mapa[chave];
      if (!g) {
        g = mapa[chave] = {
          chave: chave, codigo: x.codigo, semCodigo: !x.codigo, codigoNaDescricao: x.codigoNaDescricao,
          desc: x.desc, descN: x.descN, un: x.un, unN: x.unN, qtd: 0, linhas: []
        };
        ordem.push(g);
      }
      g.qtd += x.qtd;
      g.codigoNaDescricao = g.codigoNaDescricao || x.codigoNaDescricao;
      g.linhas.push({ origem: x.origem, linha: x.linha, conta: x.conta, qtd: x.qtd });
    });
    return ordem;
  }

  /* ---------- semelhança (só para SUGERIR candidato, nunca para casar) ---------- */
  function bigramas(s) {
    var m = {}, n = 0;
    for (var i = 0; i < s.length - 1; i++) { var b = s.substr(i, 2); m[b] = (m[b] || 0) + 1; n++; }
    return { m: m, n: n };
  }
  function dice(a, b) {
    if (!a.n || !b.n) return 0;
    var comum = 0;
    Object.keys(a.m).forEach(function (k) { if (b.m[k]) comum += Math.min(a.m[k], b.m[k]); });
    return 2 * comum / (a.n + b.n);
  }

  /* ---------- comparação ---------- */
  function comparar(qFisc, qRev) {
    var f = arred(qFisc), r = arred(qRev), dif = arred(qFisc - qRev);
    var pct = null;
    if (r > 0) pct = (f - r) / r * 100;
    else if (r === 0 && f === 0) pct = 0;
    var status = f === r ? "compativel" : (f > r ? "acima" : "abaixo");
    return { status: status, dif: dif, pct: pct };
  }

  function resumoGrupo(g) {
    return { codigo: g.codigo, desc: g.desc, un: g.un, qtd: g.qtd, linhas: g.linhas, chave: g.chave, codigoNaDescricao: g.codigoNaDescricao };
  }

  /* ---------- cruzamento ---------- */
  /* opcoes.equivalencias: [{ fisc: chaveDoGrupoAprovado, rev: [chaves do revisado] }] —
     decisões do analista; só elas somam códigos diferentes. */
  function cruzar(aprovado, revisado, opcoes) {
    opcoes = opcoes || {};
    var gF = agrupar(aprovado), gR = agrupar(revisado);
    var porChaveR = {}, porCodigoR = {}, porDescR = {};
    gR.forEach(function (g) {
      porChaveR[g.chave] = g;
      if (g.codigo) (porCodigoR[g.codigo] = porCodigoR[g.codigo] || []).push(g);
      (porDescR[g.descN + "|" + g.unN] = porDescR[g.descN + "|" + g.unN] || []).push(g);
      g.bg = bigramas(g.descN);
    });
    var usados = {};          /* chave do revisado -> chave do aprovado que a reivindicou */
    var linhas = {};          /* chave do aprovado -> resultado */

    function fechar(f, rGrupos, via) {
      var qRev = rGrupos.reduce(function (s, g) { return s + g.qtd; }, 0);
      var c = comparar(f.qtd, qRev);
      rGrupos.forEach(function (g) { usados[g.chave] = f.chave; });
      linhas[f.chave] = {
        status: c.status, via: via, dif: c.dif, pct: c.pct, fisc: resumoGrupo(f),
        rev: rGrupos.map(resumoGrupo), qtdRev: qRev, candidatos: [], motivo: ""
      };
    }
    function incerta(f, motivo, candidatos) {
      linhas[f.chave] = {
        status: "incerta", via: "", dif: null, pct: null, fisc: resumoGrupo(f), rev: [], qtdRev: null,
        candidatos: candidatos || [], motivo: motivo
      };
    }

    /* 1) equivalências confirmadas pelo analista */
    (opcoes.equivalencias || []).forEach(function (e) {
      var f = gF.filter(function (g) { return g.chave === e.fisc; })[0];
      var rs = (e.rev || []).map(function (k) { return porChaveR[k]; }).filter(Boolean);
      if (f && rs.length && !linhas[f.chave]) fechar(f, rs, "manual");
    });

    /* 2) mesmo código real e mesma unidade */
    gF.forEach(function (f) {
      if (linhas[f.chave] || !f.codigo) return;
      var r = porChaveR[f.chave];
      if (r && !usados[r.chave]) fechar(f, [r], (f.codigoNaDescricao || r.codigoNaDescricao) ? "codigo_na_descricao" : "codigo");
    });

    /* 3) sem código válido: descrição idêntica + unidade idêntica, e só se for única */
    gF.forEach(function (f) {
      if (linhas[f.chave] || f.codigo) return;
      var cand = porDescR[f.descN + "|" + f.unN] || [];
      if (cand.length === 1 && !usados[cand[0].chave]) fechar(f, [cand[0]], "descricao");
      else if (cand.length) incerta(f, cand.length > 1 ? "Mais de um serviço da revisada com a mesma descrição e unidade." : "A descrição bate, mas o serviço da revisada já foi casado com outro.", cand.map(function (g) { return candidato(g, 1); }));
    });

    /* 4) o que sobrou: unidade diferente, descrição parecida ou nada */
    var livres = gR.filter(function (g) { return !usados[g.chave]; });
    gF.forEach(function (f) {
      if (linhas[f.chave]) return;
      var mesmoCodigo = f.codigo ? (porCodigoR[f.codigo] || []).filter(function (g) { return !usados[g.chave]; }) : [];
      if (mesmoCodigo.length) {
        incerta(f, "Mesmo código na revisada, mas com unidade diferente (" + mesmoCodigo.map(function (g) { return g.un; }).join(", ") + ").", mesmoCodigo.map(function (g) { return candidato(g, 1); }));
        return;
      }
      var bf = bigramas(f.descN), cands = [];
      livres.forEach(function (g) {
        if (g.unN !== f.unN) return;
        var s = dice(bf, g.bg);
        if (s >= LIMIAR_PARECIDO) cands.push(candidato(g, s));
      });
      cands.sort(function (a, b) { return b.score - a.score; });
      if (cands.length) incerta(f, "Código não consta na revisada, mas há serviço com descrição parecida. Podem ser composições diferentes.", cands.slice(0, 5));
      else linhas[f.chave] = { status: "sem_correspondencia", via: "", dif: null, pct: null, fisc: resumoGrupo(f), rev: [], qtdRev: null, candidatos: [], motivo: "" };
    });

    var resultado = gF.map(function (f) { return linhas[f.chave]; });

    /* revisada sem par: sobra da SOP que a fiscalização não trouxe */
    var sugeridos = {};
    resultado.forEach(function (r) { r.candidatos.forEach(function (c) { (sugeridos[c.chave] = sugeridos[c.chave] || []).push(r.fisc.chave); }); });
    gR.forEach(function (g) {
      if (usados[g.chave]) return;
      resultado.push({
        status: "nao_localizado", via: "", dif: null, pct: null, fisc: null, rev: [resumoGrupo(g)], qtdRev: g.qtd,
        candidatos: [], motivo: "", possivelParDe: sugeridos[g.chave] || []
      });
    });
    return resultado;
  }

  function candidato(g, score) {
    return { chave: g.chave, codigo: g.codigo, desc: g.desc, un: g.un, qtd: g.qtd, score: score };
  }

  function resumir(resultado) {
    var r = { total: 0, compativel: 0, acima: 0, abaixo: 0, sem_correspondencia: 0, nao_localizado: 0, incerta: 0 };
    resultado.forEach(function (x) { r.total++; r[x.status]++; });
    r.analisados = r.total - r.nao_localizado;
    r.comDiferenca = r.acima + r.abaixo;
    r.semCorrespondencia = r.sem_correspondencia + r.nao_localizado;
    r.conferir = r.incerta;
    return r;
  }

  raiz.ConferenciaMotor = {
    lerAprovado: lerAprovado, lerRevisado: lerRevisado, escolherAbas: escolherAbas, validar: validar,
    cruzar: cruzar, resumir: resumir, comparar: comparar,
    _interno: { normDesc: normDesc, normUn: normUn, codigoPlaceholder: codigoPlaceholder, agrupar: agrupar }
  };
})(typeof window !== "undefined" ? window : globalThis);
