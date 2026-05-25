(function (window) {
    'use strict';

    // Funções puras de matemática e formatação extraídas de main.js

    function mascaraProcesso(val) {
        val = val.replace(/\D/g, '');
        val = val.replace(/^(\d{5})(\d)/, '$1.$2');
        val = val.replace(/^(\d{5})\.(\d{6})(\d)/, '$1.$2/$3');
        val = val.replace(/^(\d{5})\.(\d{6})\/(\d{4})(\d)/, '$1.$2/$3-$4');
        if (val.length > 20) val = val.substring(0, 20);
        return val;
    }

    function sanitizarNomeArquivo(nomeArquivo) {
        let nome = nomeArquivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        nome = nome.replace(/\s+/g, '_');
        nome = nome.replace(/[^a-zA-Z0-9._-]/g, '');
        return nome;
    }

    function extrairPathDoStorage(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.replace('/storage/v1/object/public/', '');
            return path;
        } catch (e) {
            console.error('Erro ao extrair path:', e);
            return null;
        }
    }

    function dataParaISO(strData) {
        if (!strData) return null;
        if (strData.match(/^\d{4}-\d{2}-\d{2}$/)) return strData;
        const partes = strData.split('/');
        if (partes.length === 3) return `${partes[2]}-${partes[1]}-${partes[0]}`;
        return null;
    }

    function moedaParaNumero(strValor) {
        if (!strValor && strValor !== 0) return 0;
        if (typeof strValor === 'number') {
            return isFinite(strValor) ? strValor : 0;
        }
        let limpo = strValor.toString().trim().replace(/R\$|\s+/g, '');
        if (!limpo) return 0;
        if (limpo.includes(',')) {
            limpo = limpo.replace(/\./g, '').replace(',', '.');
        }
        const resultado = parseFloat(limpo);
        return isFinite(resultado) ? resultado : 0;
    }

    function isoParaDate(isoStr) {
        if (!isoStr) return null;
        const d = isoStr.includes('T') ? new Date(isoStr) : new Date(isoStr + "T00:00:00");
        return isNaN(d.getTime()) ? null : d;
    }

    function getFeriados(ano) {
        const feriados = [
            "01-01",
            "04-21",
            "05-01",
            "09-07",
            "10-12",
            "11-02",
            "11-15",
            "11-20",
            "12-25",
            "03-19",
            "03-25",
            "02-17",
            "02-18",
            "06-04",
            "10-28",
        ];
        return feriados.map(f => `${ano}-${f}`);
    }

    function obterProximoDiaUtil(data) {
        let d = new Date(data);
        let tentativa = 0;
        while (tentativa < 15) {
            const diaSemana = d.getDay();
            const dataFormatada = d.toISOString().substring(5, 10);
            const feriados = getFeriados(d.getFullYear());
            const ehFeriado = feriados.some(f => f.endsWith(dataFormatada));

            if (diaSemana === 0 || diaSemana === 6 || ehFeriado) {
                d.setDate(d.getDate() + 1);
            } else {
                return d;
            }
            tentativa++;
        }
        return d;
    }

    function somarDiasUteis(data, dias) {
        let d = new Date(data);
        let cont = 0;
        let seguranca = 0;
        while (cont < dias && seguranca < 100) {
            d.setDate(d.getDate() + 1);
            const diaSemana = d.getDay();
            const dataFormatada = d.toISOString().substring(5, 10);
            const feriados = getFeriados(d.getFullYear());
            const ehFeriado = feriados.some(f => f.endsWith(dataFormatada));

            if (diaSemana !== 0 && diaSemana !== 6 && !ehFeriado) {
                cont++;
            }
            seguranca++;
        }
        return d;
    }

    function calcularDataMeta(dataBase, diasParaSoma = 20) {
        if (!dataBase) return null;
        let data = (dataBase instanceof Date) ? new Date(dataBase) : new Date(dataBase);

        // Inicia a contagem no próximo dia útil após a dataBase
        let amanha = new Date(data);
        amanha.setDate(amanha.getDate() + 1);
        let dataInicioContagem = obterProximoDiaUtil(amanha);

        // Soma exatamente 'diasParaSoma' dias úteis começando em dataInicioContagem
        // Como 'somarDiasUteis' avança a partir da data fornecida, para contar
        // dataInicioContagem como dia 1, somamos (diasParaSoma - 1)
        const diasASomar = Math.max(0, diasParaSoma - 1);
        return somarDiasUteis(dataInicioContagem, diasASomar);
    }

    function dateParaInput(dateObj) {
        if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj)) return "";
        return dateObj.toLocaleDateString('pt-BR');
    }

    function formatCompact(num) {
        if (num === null || num === undefined) return 'R$ 0,00';
        return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatPercentage(num) {
        if (num === null || num === undefined || !isFinite(num)) return '';
        return num.toFixed(1).replace('.', ',') + '%';
    }

    function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

    function escapeHTML(str) { const s = String(str || ''); return s.replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

    function sum(rows, fn) { return rows.reduce((acc, it) => { const v = fn(it); return acc + (isFiniteNumber(v) ? v : 0); }, 0); }

    function formatStatusDisplay(status) {
        if (status === "DEVOLVIDO P/ REANÁLISE FISCAL") return "REANÁLISE FISCAL";
        return status;
    }

    function parseMoneyInput(val) {
        if (val === null || val === undefined || val === '') return 0;
        let s = val.toString().trim();
        s = s.replace(/[\u2212\u2013\u2014]/g, '-');
        if (/^\(.*\)$/.test(s)) { s = '-' + s.replace(/^\(|\)$/g, ''); }
        s = s.replace(/R\$|\s|\u00A0/g, '');
        s = s.replace(/[^0-9\-,.]/g, '');
        if (!s || s === '-') return 0;
        if (s.includes(',')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else if (s.split('.').length > 2) {
            s = s.replace(/\./g, '');
        }
        const res = parseFloat(s);
        return isFinite(res) ? res : 0;
    }

    function formatCurrencyValue(val) { return val.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }

    function quantile(arr, q) { const p = (arr.length - 1) * q, b = Math.floor(p), r = p - b; return arr[b + 1] !== undefined ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b]; }

    function topN(g, n) { return g.sort((a, b) => b.value - a.value).slice(0, n); }

    // Expor no escopo global (conforme diretriz: anexar ao objeto window)
    window.mascaraProcesso = mascaraProcesso;
    window.sanitizarNomeArquivo = sanitizarNomeArquivo;
    window.extrairPathDoStorage = extrairPathDoStorage;
    window.dataParaISO = dataParaISO;
    window.moedaParaNumero = moedaParaNumero;
    window.isoParaDate = isoParaDate;
    window.getFeriados = getFeriados;
    window.obterProximoDiaUtil = obterProximoDiaUtil;
    window.somarDiasUteis = somarDiasUteis;
    window.calcularDataMeta = calcularDataMeta;
    window.dateParaInput = dateParaInput;
    window.formatCompact = formatCompact;
    window.formatPercentage = formatPercentage;
    window.isFiniteNumber = isFiniteNumber;
    window.escapeHTML = escapeHTML;
    window.sum = sum;
    window.formatStatusDisplay = formatStatusDisplay;
    window.parseMoneyInput = parseMoneyInput;
    window.formatCurrencyValue = formatCurrencyValue;
    window.quantile = quantile;
    window.topN = topN;

})(window);
