(function (window) {
    'use strict';

    // UI helpers (moved from main.js)
    function getSelectedValues(selectEl) {
        if (!selectEl) return [];
        if (selectEl.multiple) {
            return Array.from(selectEl.options).filter(opt => opt.selected && opt.value).map(opt => opt.value);
        }
        return (selectEl.value && selectEl.value !== '') ? [selectEl.value] : [];
    }

    function renderMultiSelectUI(selectEl) {
        const id = selectEl.id;
        const containerId = `ms-container-${id}`;
        let container = document.getElementById(containerId);

        if (!container) {
            selectEl.style.display = 'none';
            selectEl.multiple = true;
            container = document.createElement('div');
            container.id = containerId;
            container.className = 'dropdown multiselect-container';

            const btn = document.createElement('button');
            btn.className = 'multiselect-btn';
            btn.type = 'button';
            btn.setAttribute('data-bs-toggle', 'dropdown');
            // Sem isso o Bootstrap usa Popper.js pra posicionar o menu, que às
            // vezes "flipa" o dropdown pra cima quando acha (errado, nesse
            // layout) que não tem espaço suficiente embaixo. Com display
            // static o Bootstrap só posiciona via CSS puro, sempre abrindo
            // pra baixo do botão.
            btn.setAttribute('data-bs-display', 'static');
            btn.setAttribute('aria-expanded', 'false');
            btn.innerHTML = '<span class="text-truncate">Todos</span>';

            const menu = document.createElement('div');
            menu.className = 'dropdown-menu multiselect-dropdown';

            let searchBuffer = ""; let searchTimer = null;
            btn.addEventListener('keydown', (e) => {
                if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
                if (!btn.classList.contains('show')) return;
                clearTimeout(searchTimer);
                searchBuffer += e.key;
                searchTimer = setTimeout(() => { searchBuffer = ""; }, 500);
                const term = searchBuffer.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const options = Array.from(menu.querySelectorAll('.multiselect-option'));
                const match = options.find(opt => {
                    const text = opt.textContent.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return text.startsWith(term);
                });
                if (match) {
                    match.scrollIntoView({ block: 'nearest' });
                    const originalBg = match.style.backgroundColor;
                    match.style.backgroundColor = '#e2e6ea';
                    setTimeout(() => { match.style.backgroundColor = originalBg; }, 800);
                }
            });

            container.appendChild(btn);
            container.appendChild(menu);
            selectEl.parentNode.insertBefore(container, selectEl.nextSibling);
        }

        const btnSpan = container.querySelector('button span');
        const menu = container.querySelector('.dropdown-menu');
        const oldSearchValue = menu.querySelector('input')?.value || '';
        menu.innerHTML = '';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'form-control form-control-sm mx-2 my-1';
        searchInput.placeholder = 'Filtrar opções...';
        searchInput.style.width = 'calc(100% - 16px)';
        searchInput.value = oldSearchValue;
        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => {
            const term = e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            menu.querySelectorAll('.multiselect-option').forEach(opt => {
                const text = opt.textContent.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                opt.style.display = text.includes(term) ? '' : 'none';
            });
        };
        menu.appendChild(searchInput);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'd-flex justify-content-between px-2 mb-1 border-bottom pb-1';
        actionsDiv.style.marginTop = "2px";
        actionsDiv.innerHTML = `
            <button type="button" class="btn btn-link btn-sm p-0 text-success fw-bold text-decoration-none" style="font-size: 0.75rem;">Marcar Todos</button>
            <button type="button" class="btn btn-link btn-sm p-0 text-danger fw-bold text-decoration-none" style="font-size: 0.75rem;">Limpar</button>
        `;
        const [btnMarcar, btnLimpar] = actionsDiv.querySelectorAll('button');
        btnMarcar.onclick = (e) => {
            e.stopPropagation();
            const term = searchInput.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            Array.from(selectEl.options).forEach(opt => {
                if (!opt.value) return;
                const text = opt.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (text.includes(term)) opt.selected = true;
            });
            menu.querySelectorAll('.multiselect-option').forEach(div => {
                const text = div.textContent.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (text.includes(term)) {
                    const chk = div.querySelector('input');
                    if (chk) chk.checked = true;
                }
            });
            updateLabel();
            selectEl.dispatchEvent(new Event('change'));
        };
        btnLimpar.onclick = (e) => {
            e.stopPropagation();
            const term = searchInput.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (!term) {
                Array.from(selectEl.options).forEach(opt => opt.selected = false);
                menu.querySelectorAll('.multiselect-option input').forEach(chk => chk.checked = false);
            } else {
                Array.from(selectEl.options).forEach(opt => {
                    if (!opt.value) return;
                    const text = opt.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    if (text.includes(term)) opt.selected = false;
                });
                menu.querySelectorAll('.multiselect-option').forEach(div => {
                    const text = div.textContent.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    if (text.includes(term)) {
                        const chk = div.querySelector('input');
                        if (chk) chk.checked = false;
                    }
                });
            }
            updateLabel();
            selectEl.dispatchEvent(new Event('change'));
        };
        menu.appendChild(actionsDiv);

        Array.from(selectEl.options).forEach(opt => {
            if (!opt.value) return;
            const div = document.createElement('div');
            div.className = 'multiselect-option';
            div.style.padding = "6px 12px";
            div.onclick = (e) => {
                e.stopPropagation();
                const chk = div.querySelector('input');
                if (e.target !== chk) chk.checked = !chk.checked;
                opt.selected = chk.checked;
                updateLabel();
                selectEl.dispatchEvent(new Event('change'));
            };
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = opt.selected;
            checkbox.style.cursor = "pointer";
            const label = document.createElement('span');
            label.textContent = opt.text;
            label.style.marginLeft = "8px";
            label.style.userSelect = "none";
            div.appendChild(checkbox);
            div.appendChild(label);
            menu.appendChild(div);
        });

        function updateLabel() {
            const selecteds = Array.from(selectEl.options).filter(o => o.selected && o.value);
            const totalOpts = Array.from(selectEl.options).filter(o => o.value).length;

            btnSpan.classList.remove('ms-label-all', 'ms-label-none', 'ms-label-single', 'ms-label-multi');
            if (selecteds.length === totalOpts && totalOpts > 0) {
                btnSpan.textContent = 'Todos'; btnSpan.classList.add('ms-label-all');
            } else if (selecteds.length === 0) {
                btnSpan.textContent = 'Nenhum'; btnSpan.classList.add('ms-label-none');
            } else if (selecteds.length === 1) {
                btnSpan.textContent = selecteds[0].text; btnSpan.classList.add('ms-label-single');
            } else {
                btnSpan.textContent = `${selecteds.length} selecionados`; btnSpan.classList.add('ms-label-multi');
            }
        }
        updateLabel();
    }

    function fillSelect(selectEl, list) {
        if (!selectEl) return;
        selectEl.multiple = true;
        const normalizedList = list.map(v => (v === null || v === undefined || String(v).trim() === "") ? "Não informado" : v);
        const values = Array.from(new Set(normalizedList));
        values.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

        let options = '';
        options += values.map(v => `<option value="${window.escapeHTML ? window.escapeHTML(v) : String(v)}" selected>${window.formatStatusDisplay ? window.formatStatusDisplay(v) : String(v)}</option>`).join("");
        selectEl.innerHTML = options;
        renderMultiSelectUI(selectEl);
    }

    // LOGIC: DASHBOARDS
    var fin = { status: document.getElementById("filter-status"), fiscal: document.getElementById("filter-fiscal"), contratada: document.getElementById("filter-contratada"), contratante: document.getElementById("filter-contratante"), ano: document.getElementById("filter-ano"), clear: document.getElementById("btn-clear-filters"), diffMetric: document.getElementById("metric-diff") };

    function populateFinanceiroFilters() {
        const base = window.financeiroData || [];
        fillSelect(fin.status, base.map(d => d.status)); fillSelect(fin.fiscal, base.map(d => d.fiscal)); fillSelect(fin.contratada, base.map(d => d.contratada)); fillSelect(fin.contratante, base.map(d => d.contratante));
        const anos = Array.from(new Set(base.map(d => d.anoAbertura).filter(v => v))); fillSelect(fin.ano, anos);
    }

    function getFinanceiroData() {
        const sts = getSelectedValues(fin.status); const fis = getSelectedValues(fin.fiscal);
        const cts = getSelectedValues(fin.contratada); const crs = getSelectedValues(fin.contratante); const ans = getSelectedValues(fin.ano);

        const role = window.getCurrentUserRole ? window.getCurrentUserRole() : (sessionStorage.getItem('sop_role') || 'guest');
        const userFiscal = role === 'fiscal' ? sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || '' : '';

        return (window.financeiroData || []).filter(d => {
            if (role === 'fiscal' && userFiscal) {
                const dFiscal = (d.fiscal || "").toUpperCase().trim();
                const userFiscalUpper = userFiscal.toUpperCase().trim();
                const dFiscalNorm = dFiscal.replace(/[\.\-]+/g, ' ').trim();
                const userFiscalNorm = userFiscalUpper.replace(/[\.\-]+/g, ' ').trim();
                if (dFiscalNorm !== userFiscalNorm) return false;
            }

            if (sts.length > 0 && !sts.includes(d.status)) return false;
            if (fis.length > 0 && !fis.includes(d.fiscal)) return false;
            if (cts.length > 0 && !cts.includes(d.contratada)) return false;
            if (crs.length > 0 && !crs.includes(d.contratante)) return false;
            if (ans.length > 0 && !ans.includes(String(d.anoAbertura))) return false;
            return true;
        });
    }

    function clearFinanceiro() {
        [fin.status, fin.fiscal, fin.contratada, fin.contratante, fin.ano].forEach(el => { if (el) { Array.from(el.options).forEach(o => o.selected = true); renderMultiSelectUI(el); } });
        updateFinanceiro();
    }

    function calcularTotaisFinanceiro(rows) {
        const s = fn => window.sum ? window.sum(rows, fn) : rows.reduce((a, b) => a + (fn(b) || 0), 0);
        return {
            acrescFiscal: s(d => d.acrescFiscal),
            supressFiscal: s(d => d.supressFiscal),
            repercFiscal: s(d => d.repercFiscal),
            acrescGecope: s(d => d.acrescGecope),
            supressGecope: s(d => d.supressGecope),
            repercGecope: s(d => d.repercGecope)
        };
    }

    // Calcula o nível de revisão da GECOPE processo a processo (não pelo agregado),
    // para que contratos de alto valor não mascarem o quanto os demais processos
    // foram de fato alterados. Retorna média, mediana e a taxa de processos alterados.
    function calcularIndiceRevisao(rows, fiscalKey, gecopeKey) {
        const variacoes = [];
        let alterados = 0;
        rows.forEach(d => {
            const fiscalVal = d[fiscalKey] || 0;
            const gecopeVal = d[gecopeKey] || 0;
            if (gecopeVal !== fiscalVal) alterados++;
            if (fiscalVal !== 0) variacoes.push(Math.abs(gecopeVal - fiscalVal) / Math.abs(fiscalVal) * 100);
        });
        variacoes.sort((a, b) => a - b);
        const media = variacoes.length ? variacoes.reduce((a, b) => a + b, 0) / variacoes.length : 0;
        const mid = Math.floor(variacoes.length / 2);
        const mediana = variacoes.length ? (variacoes.length % 2 !== 0 ? variacoes[mid] : (variacoes[mid - 1] + variacoes[mid]) / 2) : 0;
        const taxaRevisao = rows.length ? (alterados / rows.length) * 100 : 0;
        return { media, mediana, taxaRevisao, alterados, total: rows.length };
    }

    function renderKPIsFinanceiro(rows) {
        const t = calcularTotaisFinanceiro(rows);
        const diffReperc = t.repercGecope - t.repercFiscal; const diffAcresc = t.acrescGecope - t.acrescFiscal; const diffSupress = t.supressGecope - t.supressFiscal;
        let diffAbs = 0; const metric = fin.diffMetric.value;
        let fiscalKey = "repercFiscal", gecopeKey = "repercGecope";
        if (metric === "reperc") { diffAbs = diffReperc; fiscalKey = "repercFiscal"; gecopeKey = "repercGecope"; }
        else if (metric === "acresc") { diffAbs = diffAcresc; fiscalKey = "acrescFiscal"; gecopeKey = "acrescGecope"; }
        else if (metric === "supress") { diffAbs = diffSupress; fiscalKey = "supressFiscal"; gecopeKey = "supressGecope"; }
        const indice = calcularIndiceRevisao(rows, fiscalKey, gecopeKey);
        document.getElementById("kpi-acresc-fiscal").textContent = window.formatCompact ? window.formatCompact(t.acrescFiscal) : String(t.acrescFiscal);
        document.getElementById("kpi-supress-fiscal").textContent = window.formatCompact ? window.formatCompact(t.supressFiscal) : String(t.supressFiscal);
        document.getElementById("kpi-reperc-fiscal").textContent = window.formatCompact ? window.formatCompact(t.repercFiscal) : String(t.repercFiscal);
        document.getElementById("kpi-acresc-gecope").textContent = window.formatCompact ? window.formatCompact(t.acrescGecope) : String(t.acrescGecope);
        document.getElementById("kpi-supress-gecope").textContent = window.formatCompact ? window.formatCompact(t.supressGecope) : String(t.supressGecope);
        document.getElementById("kpi-reperc-gecope").textContent = window.formatCompact ? window.formatCompact(t.repercGecope) : String(t.repercGecope);
        document.getElementById("kpi-diff-abs").textContent = window.formatCompact ? window.formatCompact(diffAbs) : String(diffAbs);
        document.getElementById("kpi-diff-perc").textContent = window.formatPercentage ? window.formatPercentage(indice.media) : String(indice.media);
        const medianaEl = document.getElementById("kpi-diff-mediana");
        if (medianaEl) medianaEl.textContent = "Mediana: " + (window.formatPercentage ? window.formatPercentage(indice.mediana) : String(indice.mediana));
        const taxaEl = document.getElementById("kpi-taxa-revisao");
        if (taxaEl) taxaEl.textContent = window.formatPercentage ? window.formatPercentage(indice.taxaRevisao) : String(indice.taxaRevisao);
        const taxaSubEl = document.getElementById("kpi-taxa-revisao-sub");
        if (taxaSubEl) taxaSubEl.textContent = `${indice.alterados} de ${indice.total} processos alterados`;
    }

    function renderContadorFinanceiro(rows) {
        const aprovados = rows.filter(d => String(d.status).toUpperCase() === "APROVADO").length;
        const arquivados = rows.filter(d => String(d.status).toUpperCase() === "ARQUIVADO").length;
        const totalEl = document.getElementById("fin-count-total");
        const aprovEl = document.getElementById("fin-count-aprovados");
        const arqEl = document.getElementById("fin-count-arquivados");
        if (totalEl) totalEl.textContent = `${rows.length} processos`;
        if (aprovEl) aprovEl.textContent = String(aprovados);
        if (arqEl) arqEl.textContent = String(arquivados);
    }

    // Paleta/tipografia dos gráficos Plotly do Financeiro, adaptada ao tema
    // claro/escuro do app (Plotly não lê variáveis CSS, então isso é recalculado
    // a cada render a partir da classe body.theme-dark).
    function finChartTheme() {
        const dark = document.body.classList.contains("theme-dark");
        return {
            font: { family: "Montserrat, Segoe UI, system-ui, -apple-system, Roboto, sans-serif", color: dark ? "rgba(255,255,255,0.75)" : "#475569", size: 11 },
            gridColor: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.07)",
            lineColor: dark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.14)"
        };
    }

    function renderComparativoFinanceiro(rows) {
        const t = calcularTotaisFinanceiro(rows);
        const theme = finChartTheme();
        const categorias = ["Acréscimo", "Supressão", "Repercussão"];
        const data = [
            { x: categorias, y: [t.acrescFiscal, t.supressFiscal, t.repercFiscal], name: "Fiscalização", type: "bar", marker: { color: "#008F3D" }, hovertemplate: "%{x}<br>Fiscalização: R$ %{y:,.2f}<extra></extra>" },
            { x: categorias, y: [t.acrescGecope, t.supressGecope, t.repercGecope], name: "GECOPE", type: "bar", marker: { color: "#018ABD" }, hovertemplate: "%{x}<br>GECOPE: R$ %{y:,.2f}<extra></extra>" }
        ];
        const layout = {
            margin: { l: 60, r: 20, t: 10, b: 40 },
            barmode: "group",
            bargap: 0.3,
            bargroupgap: 0.12,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: theme.font,
            yaxis: { title: "R$", tickprefix: "R$ ", gridcolor: theme.gridColor, zerolinecolor: theme.lineColor },
            xaxis: { gridcolor: theme.gridColor, linecolor: theme.lineColor },
            legend: { orientation: "h", y: -0.18, font: theme.font },
            height: 320
        };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-comparativo"), data, layout, { displayModeBar: false, responsive: true });
    }

    function renderWaterfallFinanceiro(rows) {
        const t = calcularTotaisFinanceiro(rows);
        const theme = finChartTheme();
        const diff = t.repercGecope - t.repercFiscal;
        const fmt = v => window.formatCompact ? window.formatCompact(v) : String(v);
        const data = [{
            type: "waterfall",
            orientation: "v",
            x: ["Fiscalização", diff >= 0 ? "Acréscimo GECOPE" : "Redução GECOPE", "GECOPE"],
            measure: ["absolute", "relative", "total"],
            y: [t.repercFiscal, diff, 0],
            text: [fmt(t.repercFiscal), (diff >= 0 ? "+" : "") + fmt(diff), fmt(t.repercGecope)],
            textposition: "outside",
            // Sem isso o Plotly recorta o texto que fica acima da barra mais alta
            // quando ele ultrapassa a área do gráfico (era o corte visto no topo).
            cliponaxis: false,
            connector: { line: { color: theme.lineColor, width: 1 } },
            increasing: { marker: { color: "#008F3D" } },
            decreasing: { marker: { color: "#dc3545" } },
            totals: { marker: { color: "#018ABD" } }
        }];
        // Dá folga acima da maior barra para o rótulo "outside" caber sem ser
        // cortado pela borda do eixo (o autorange do Plotly não reserva espaço
        // para texto, só para as barras em si).
        const valores = [0, t.repercFiscal, t.repercGecope];
        const maxV = Math.max(...valores);
        const minV = Math.min(...valores);
        const folga = Math.max((maxV - minV) * 0.22, 1);
        const layout = {
            margin: { l: 60, r: 20, t: 40, b: 40 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: theme.font,
            showlegend: false,
            yaxis: { title: "R$", tickprefix: "R$ ", gridcolor: theme.gridColor, zerolinecolor: theme.lineColor, range: [minV < 0 ? minV - folga : 0, maxV + folga] },
            xaxis: { gridcolor: theme.gridColor, linecolor: theme.lineColor },
            height: 320
        };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-waterfall"), data, layout, { displayModeBar: false, responsive: true });
    }

    let finDrilldownRows = [];
    let finSort = { key: "repercGecope", dir: "desc" };
    let finTableSearch = "";
    let finTableStatus = "";
    const finFmtMoney = v => window.formatCompact ? window.formatCompact(v) : String(v);
    const finFmtData = d => (d instanceof Date && !isNaN(d)) ? d.toLocaleDateString("pt-BR") : "-";
    const finNorm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    function populateFinDrilldownStatusFilter(rows) {
        const sel = document.getElementById("fin-drilldown-status-filter");
        if (!sel) return;
        const atual = sel.value;
        const statusUnicos = Array.from(new Set(rows.map(d => d.status || "Não informado"))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
        sel.innerHTML = '<option value="">Todos os status</option>' + statusUnicos.map(s => {
            const label = window.formatStatusDisplay ? window.formatStatusDisplay(s) : s;
            return `<option value="${window.escapeHTML ? window.escapeHTML(s) : s}">${window.escapeHTML ? window.escapeHTML(label) : label}</option>`;
        }).join("");
        if (statusUnicos.includes(atual)) sel.value = atual;
    }

    function renderDrilldownFinanceiro(rows) {
        populateFinDrilldownStatusFilter(rows);

        let filtrado = rows;
        if (finTableStatus) filtrado = filtrado.filter(d => (d.status || "Não informado") === finTableStatus);
        if (finTableSearch) {
            const termo = finNorm(finTableSearch);
            filtrado = filtrado.filter(d => [d.processo, d.fiscal, d.contratada, d.nomeAnalista].some(v => finNorm(v).includes(termo)));
        }

        const withDiff = filtrado.map(d => {
            const diff = (d.repercGecope || 0) - (d.repercFiscal || 0);
            const diffPerc = d.repercFiscal ? (diff / Math.abs(d.repercFiscal)) * 100 : 0;
            return Object.assign({}, d, { _diff: diff, _diffPerc: diffPerc });
        });

        const { key, dir } = finSort;
        withDiff.sort((a, b) => {
            let va = a[key], vb = b[key];
            if (va instanceof Date) va = va.getTime(); if (vb instanceof Date) vb = vb.getTime();
            if (typeof va === "string") va = va.toLowerCase(); if (typeof vb === "string") vb = vb.toLowerCase();
            if (va === undefined || va === null) va = "";
            if (vb === undefined || vb === null) vb = "";
            if (va < vb) return dir === "asc" ? -1 : 1;
            if (va > vb) return dir === "asc" ? 1 : -1;
            return 0;
        });

        finDrilldownRows = withDiff;
        window.finDrilldownRows = withDiff;

        const countEl = document.getElementById("fin-drilldown-count");
        if (countEl) countEl.textContent = `${withDiff.length} de ${rows.length} processos · clique numa coluna para ordenar`;

        const esc = v => window.escapeHTML ? window.escapeHTML(v || "") : String(v || "");
        const tbody = document.getElementById("fin-drilldown-body");
        if (!tbody) return;
        tbody.innerHTML = withDiff.map(d => {
            const statusTxt = window.formatStatusDisplay ? window.formatStatusDisplay(d.status) : d.status;
            const statusCls = window.classeBadgeStatus ? window.classeBadgeStatus(d.status) : "";
            const diffIcon = d._diff < 0 ? "bi-arrow-down-short" : "bi-arrow-up-short";
            const diffPercIcon = d._diffPerc < 0 ? "bi-arrow-down-short" : "bi-arrow-up-short";
            return `
            <tr>
                <td>${esc(d.processo)}</td>
                <td><span class="badge ${statusCls}">${esc(statusTxt)}</span></td>
                <td>${esc(d.fiscal)}</td>
                <td>${esc(d.nomeAnalista)}</td>
                <td>${esc(d.contratada)}</td>
                <td class="fin-td-mono">${finFmtData(d.dataAbertura)}</td>
                <td class="fin-td-mono">${finFmtData(d.dataAprovacao)}</td>
                <td class="fin-td-mono">${typeof d.prazoDias === "number" && isFinite(d.prazoDias) ? d.prazoDias + "d" : "-"}</td>
                <td class="fin-td-mono">${finFmtMoney(d.repercFiscal)}</td>
                <td class="fin-td-mono">${finFmtMoney(d.repercGecope)}</td>
                <td class="fin-td-mono"><span class="fin-diff-pill ${d._diff < 0 ? "diff-neg" : "diff-pos"}"><i class="bi ${diffIcon}"></i>${finFmtMoney(Math.abs(d._diff))}</span></td>
                <td class="fin-td-mono"><span class="fin-diff-pill ${d._diffPerc < 0 ? "diff-neg" : "diff-pos"}"><i class="bi ${diffPercIcon}"></i>${Math.abs(d._diffPerc).toFixed(1)}%</span></td>
            </tr>`;
        }).join("");
    }

    (function wireFinDrilldownSort() {
        const head = document.getElementById("fin-drilldown-head");
        if (!head) return;
        function updateSortIndicators() {
            head.querySelectorAll("th[data-key]").forEach(th => {
                const active = th.getAttribute("data-key") === finSort.key;
                th.classList.toggle("fin-th-sorted", active);
                if (active) th.setAttribute("data-dir", finSort.dir); else th.removeAttribute("data-dir");
            });
        }
        head.querySelectorAll("th[data-key]").forEach(th => {
            th.addEventListener("click", () => {
                const key = th.getAttribute("data-key");
                finSort = { key, dir: (finSort.key === key && finSort.dir === "desc") ? "asc" : "desc" };
                updateSortIndicators();
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        });
        updateSortIndicators();
    })();

    (function wireFinDrilldownTableFilters() {
        const searchEl = document.getElementById("fin-drilldown-search");
        const statusEl = document.getElementById("fin-drilldown-status-filter");
        if (searchEl) {
            searchEl.addEventListener("input", () => {
                finTableSearch = searchEl.value;
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        }
        if (statusEl) {
            statusEl.addEventListener("change", () => {
                finTableStatus = statusEl.value;
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        }
    })();

    function updateFinanceiro() {
        const rows = getFinanceiroData();
        const f = getSelectedValues(fin.fiscal);
        const s = getSelectedValues(fin.status);

        let filtered = rows;
        if (f.length < (fin.fiscal?.options?.length || 0)) {
            filtered = filtered.filter(d => f.includes(d.fiscal || "Não informado"));
        }
        if (s.length < (fin.status?.options?.length || 0)) {
            filtered = filtered.filter(d => s.includes(d.status || "Não informado"));
        }

        renderKPIsFinanceiro(filtered);
        renderContadorFinanceiro(filtered);
        renderComparativoFinanceiro(filtered);
        renderWaterfallFinanceiro(filtered);
        renderDrilldownFinanceiro(filtered);
    }

    // Expose globals
    window.getSelectedValues = getSelectedValues;
    window.renderMultiSelectUI = renderMultiSelectUI;
    window.fillSelect = fillSelect;
    window.populateFinanceiroFilters = populateFinanceiroFilters;
    window.getFinanceiroData = getFinanceiroData;
    window.clearFinanceiro = clearFinanceiro;
    window.updateFinanceiro = updateFinanceiro;

    // Also expose fin as global
    window.fin = fin;

})(window);
