(function (window) {
    'use strict';

    // Helpers de interface e dashboards extraídos de main.js

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

            if (selecteds.length === totalOpts && totalOpts > 0) {
                btnSpan.textContent = 'Todos'; btnSpan.style.color = '#777'; btnSpan.style.fontWeight = '400';
            } else if (selecteds.length === 0) {
                btnSpan.textContent = 'Nenhum'; btnSpan.style.color = '#dc3545'; btnSpan.style.fontWeight = '600';
            } else if (selecteds.length === 1) {
                btnSpan.textContent = selecteds[0].text; btnSpan.style.color = '#333'; btnSpan.style.fontWeight = '400';
            } else {
                btnSpan.textContent = `${selecteds.length} selecionados`; btnSpan.style.color = '#008F3D'; btnSpan.style.fontWeight = '600';
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
        options += values.map(v => `<option value="${escapeHTML(v)}" selected>${escapeHTML(formatStatusDisplay(v))}</option>`).join("");
        selectEl.innerHTML = options;
        renderMultiSelectUI(selectEl);
    }

    // DASHBOARD: estruturas e funções de atualização
    const fin = { status: document.getElementById("filter-status"), tipo: document.getElementById("filter-tipo"), fiscal: document.getElementById("filter-fiscal"), contratada: document.getElementById("filter-contratada"), contratante: document.getElementById("filter-contratante"), ano: document.getElementById("filter-ano"), clear: document.getElementById("btn-clear-filters"), totAno: document.getElementById("tot-ano"), totMes: document.getElementById("tot-mes"), diffMetric: document.getElementById("metric-diff") };

    function populateFinanceiroFilters() {
        const base = window.financeiroData || [];
        fillSelect(fin.status, base.map(d => d.status)); fillSelect(fin.tipo, base.map(d => d.tipo)); fillSelect(fin.fiscal, base.map(d => d.fiscal)); fillSelect(fin.contratada, base.map(d => d.contratada)); fillSelect(fin.contratante, base.map(d => d.contratante));
        const anos = Array.from(new Set(base.map(d => d.anoAbertura).filter(v => v))); fillSelect(fin.ano, anos);
        if (fin.totAno) fin.totAno.innerHTML = '<option value="">Ano: Todos</option>' + anos.map(a => `<option value="${a}">${a}</option>`).join("");
    }

    function getFinanceiroData() {
        const sts = getSelectedValues(fin.status); const tps = getSelectedValues(fin.tipo); const fis = getSelectedValues(fin.fiscal);
        const cts = getSelectedValues(fin.contratada); const crs = getSelectedValues(fin.contratante); const ans = getSelectedValues(fin.ano);

        const role = getCurrentUserRole();
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
            if (tps.length > 0 && !tps.includes(d.tipo)) return false;
            if (fis.length > 0 && !fis.includes(d.fiscal)) return false;
            if (cts.length > 0 && !cts.includes(d.contratada)) return false;
            if (crs.length > 0 && !crs.includes(d.contratante)) return false;
            if (ans.length > 0 && !ans.includes(String(d.anoAbertura))) return false;
            return true;
        });
    }

    function clearFinanceiro() {
        [fin.status, fin.tipo, fin.fiscal, fin.contratada, fin.contratante, fin.ano].forEach(el => { if (el) { Array.from(el.options).forEach(o => o.selected = true); renderMultiSelectUI(el); } });
        updateFinanceiro();
    }

    // Gerencial
    const ger = { fiscal: document.getElementById("gerencial-filter-fiscal"), status: document.getElementById("gerencial-filter-status"), clear: document.getElementById("btn-gerencial-clear") };
    let gerBase = [];
    function updateGerencialFilters(rows) { gerBase = rows; fillSelect(ger.fiscal, gerBase.map(d => d.fiscal)); fillSelect(ger.status, gerBase.map(d => d.status)); updateGerencial(); }
    function getGerencialData() {
        const f = getSelectedValues(ger.fiscal);
        const s = getSelectedValues(ger.status);

        const role = getCurrentUserRole();
        const userFiscal = role === 'fiscal' ? sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || '' : '';

        return gerBase.filter(d => {
            if (role === 'fiscal' && userFiscal) {
                const dFiscal = (d.fiscal || "").toUpperCase().trim();
                const userFiscalUpper = userFiscal.toUpperCase().trim();
                const dFiscalNorm = dFiscal.replace(/[\.\-]+/g, ' ').trim();
                const userFiscalNorm = userFiscalUpper.replace(/[\.\-]+/g, ' ').trim();
                if (dFiscalNorm !== userFiscalNorm) return false;
            }

            return (f.length === 0 || f.includes(d.fiscal)) && (s.length === 0 || s.includes(d.status));
        });
    }
    function updateGerencial() {
        const f = getSelectedValues(ger.fiscal);
        const s = getSelectedValues(ger.status);
        let rows = [...gerBase];

        if (f.length < (ger.fiscal?.options?.length || 0)) {
            rows = rows.filter(d => f.includes(d.fiscal || "Não informado"));
        }
        if (s.length < (ger.status?.options?.length || 0)) {
            rows = rows.filter(d => s.includes(d.status || "Não informado"));
        }

        document.getElementById("gerencial-count-badge") && (document.getElementById("gerencial-count-badge").textContent = `${rows.length} processos`);
        renderHBar("chart_proc_por_fiscal", topN(groupCount(rows, d => d.fiscal), 20), "Qtd");
        const pieD = groupCount(rows, d => d.status).sort((a, b) => b.value - a.value);
        Plotly.react(document.getElementById("chart_proc_por_status"), [{ type: "pie", labels: pieD.map(d => formatStatusDisplay(d.key)), values: pieD.map(d => d.value), textinfo: "percent+label", marker: { colors: ['#008F3D', '#F28C00', '#018ABD', '#4CC17C', '#D35400'] } }], { margin: { l: 20, r: 20, t: 10, b: 10 }, height: 360 }, { displayModeBar: false });
        renderHBar("chart_proc_por_tipo", topN(groupCount(rows, d => d.tipo), 20), "Qtd");
    }

    // Clear helpers for filters (compat with legacy calls from main.js)
    function clearGerencial() {
        [ger.fiscal, ger.status].forEach(el => {
            if (el) {
                Array.from(el.options).forEach(o => o.selected = true);
                renderMultiSelectUI(el);
            }
        });
        updateGerencial();
    }

    // Agrupamentos e utilitários pequenos
    function groupCount(rows, kFn) { const c = {}; rows.forEach(r => { const k = kFn(r); c[k] = (c[k] || 0) + 1; }); return Object.keys(c).map(k => ({ key: k, value: c[k] })); }
    function groupAvg(rows, kFn, vFn) { const s = {}, c = {}; rows.forEach(r => { const k = kFn(r), v = vFn(r); if (isFiniteNumber(v)) { s[k] = (s[k] || 0) + v; c[k] = (c[k] || 0) + 1; } }); return Object.keys(s).map(k => ({ key: k, value: c[k] > 0 ? s[k] / c[k] : 0 })).filter(d => d.value > 0); }
    function topNArr(g, n) { return g.sort((a, b) => b.value - a.value).slice(0, n); }
    function quantile(arr, q) { const p = (arr.length - 1) * q, b = Math.floor(p), r = p - b; return arr[b + 1] !== undefined ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b]; }
    function renderHBar(id, g, tx) {
        if (!g.length) { Plotly.react(document.getElementById(id), [], { title: "Sem dados" }); return; }
        const y = g.map(r => r.key).reverse(), x = g.map(r => r.value).reverse();
        Plotly.react(document.getElementById(id), [{ x, y, type: 'bar', orientation: 'h', text: x.map(v => v.toFixed(0)), textposition: 'outside', marker: { color: "#018ABD" } }], { margin: { l: 180, r: 20, t: 10, b: 40 }, xaxis: { title: tx }, yaxis: { automargin: true }, height: Math.max(300, 26 * y.length + 80) }, { displayModeBar: false });
    }

    // Re-export nomes compatíveis (mantendo window.* usados no código legado)
    window.getSelectedValues = getSelectedValues;
    window.renderMultiSelectUI = renderMultiSelectUI;
    window.fillSelect = fillSelect;
    window.populateFinanceiroFilters = populateFinanceiroFilters;
    window.getFinanceiroData = getFinanceiroData;
    window.clearFinanceiro = clearFinanceiro;
    window.updateGerencialFilters = updateGerencialFilters;
    window.getGerencialData = getGerencialData;
    window.updateGerencial = updateGerencial;
    window.groupCount = groupCount;
    window.groupAvg = groupAvg;
    window.topN = topNArr;
    window.quantile = quantile;
    window.renderHBar = renderHBar;
    window.clearGerencial = clearGerencial;

})(window);
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

            if (selecteds.length === totalOpts && totalOpts > 0) {
                btnSpan.textContent = 'Todos'; btnSpan.style.color = '#777'; btnSpan.style.fontWeight = '400';
            } else if (selecteds.length === 0) {
                btnSpan.textContent = 'Nenhum'; btnSpan.style.color = '#dc3545'; btnSpan.style.fontWeight = '600';
            } else if (selecteds.length === 1) {
                btnSpan.textContent = selecteds[0].text; btnSpan.style.color = '#333'; btnSpan.style.fontWeight = '400';
            } else {
                btnSpan.textContent = `${selecteds.length} selecionados`; btnSpan.style.color = '#008F3D'; btnSpan.style.fontWeight = '600';
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

    function renderKPIsFinanceiro(rows) {
        const acrescFiscal = window.sum ? window.sum(rows, d => d.acrescFiscal) : rows.reduce((a,b)=>a+(b.acrescFiscal||0),0);
        const supressFiscal = window.sum ? window.sum(rows, d => d.supressFiscal) : rows.reduce((a,b)=>a+(b.supressFiscal||0),0);
        const repercFiscal = window.sum ? window.sum(rows, d => d.repercFiscal) : rows.reduce((a,b)=>a+(b.repercFiscal||0),0);
        const acrescGecope = window.sum ? window.sum(rows, d => d.acrescGecope) : rows.reduce((a,b)=>a+(b.acrescGecope||0),0);
        const supressGecope = window.sum ? window.sum(rows, d => d.supressGecope) : rows.reduce((a,b)=>a+(b.supressGecope||0),0);
        const repercGecope = window.sum ? window.sum(rows, d => d.repercGecope) : rows.reduce((a,b)=>a+(b.repercGecope||0),0);
        const diffReperc = repercGecope - repercFiscal; const diffAcresc = acrescGecope - acrescFiscal; const diffSupress = supressGecope - supressFiscal;
        let diffAbs = 0; let diffPerc = 0; const metric = fin.diffMetric.value;
        if (metric === "reperc") { diffAbs = diffReperc; diffPerc = (repercFiscal !== 0) ? (Math.abs(diffAbs) / Math.abs(repercFiscal)) * 100 : 0; }
        else if (metric === "acresc") { diffAbs = diffAcresc; diffPerc = (acrescFiscal !== 0) ? (Math.abs(diffAbs) / Math.abs(acrescFiscal)) * 100 : 0; }
        else if (metric === "supress") { diffAbs = diffSupress; diffPerc = (supressFiscal !== 0) ? (Math.abs(diffAbs) / Math.abs(supressFiscal)) * 100 : 0; }
        document.getElementById("kpi-acresc-fiscal").textContent = window.formatCompact ? window.formatCompact(acrescFiscal) : String(acrescFiscal);
        document.getElementById("kpi-supress-fiscal").textContent = window.formatCompact ? window.formatCompact(supressFiscal) : String(supressFiscal);
        document.getElementById("kpi-reperc-fiscal").textContent = window.formatCompact ? window.formatCompact(repercFiscal) : String(repercFiscal);
        document.getElementById("kpi-acresc-gecope").textContent = window.formatCompact ? window.formatCompact(acrescGecope) : String(acrescGecope);
        document.getElementById("kpi-supress-gecope").textContent = window.formatCompact ? window.formatCompact(supressGecope) : String(supressGecope);
        document.getElementById("kpi-reperc-gecope").textContent = window.formatCompact ? window.formatCompact(repercGecope) : String(repercGecope);
        document.getElementById("kpi-diff-abs").textContent = window.formatCompact ? window.formatCompact(diffAbs) : String(diffAbs);
        document.getElementById("kpi-diff-perc").textContent = window.formatPercentage ? window.formatPercentage(diffPerc) : String(diffPerc);
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

    function groupSumPair(rows, kFn, v1Fn, v2Fn) {
        const m = new Map();
        rows.forEach(r => {
            const k = kFn(r);
            if (k === null || k === undefined) return;
            if (!m.has(k)) m.set(k, { key: k, v1: 0, v2: 0 });
            const g = m.get(k);
            g.v1 += v1Fn(r) || 0;
            g.v2 += v2Fn(r) || 0;
        });
        return Array.from(m.values());
    }

    function renderPorFiscalFinanceiro(rows) {
        const grupos = groupSumPair(rows, d => d.fiscal || "Não informado", d => d.repercFiscal, d => d.repercGecope);
        grupos.sort((a, b) => (Math.abs(b.v1) + Math.abs(b.v2)) - (Math.abs(a.v1) + Math.abs(a.v2)));
        const top = grupos.slice(0, 15).reverse();
        const data = [
            { y: top.map(g => g.key), x: top.map(g => g.v1), name: "Fiscalização", type: "bar", orientation: "h", marker: { color: "#008F3D" } },
            { y: top.map(g => g.key), x: top.map(g => g.v2), name: "GECOPE", type: "bar", orientation: "h", marker: { color: "#018ABD" } }
        ];
        const layout = { margin: { l: 140, r: 20, t: 10, b: 40 }, barmode: "group", xaxis: { title: "Repercussão", tickprefix: "R$ " }, legend: { orientation: "h", y: -0.15 }, height: Math.max(300, 34 * top.length + 80) };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-fiscal"), top.length ? data : [], layout, { displayModeBar: false, responsive: true });
    }

    function renderPrazoValorFinanceiro(rows) {
        const comPrazo = rows.filter(d => typeof d.prazoDias === "number" && isFinite(d.prazoDias));
        const prazoMedio = comPrazo.length ? Math.round(comPrazo.reduce((a, b) => a + b.prazoDias, 0) / comPrazo.length) : 0;
        const kpiEl = document.getElementById("kpi-fin-prazo-medio");
        if (kpiEl) kpiEl.textContent = `${prazoMedio} dias`;

        const m = new Map();
        comPrazo.forEach(d => {
            const k = d.fiscal || "Não informado";
            if (!m.has(k)) m.set(k, { valor: 0, somaPrazo: 0, qtd: 0 });
            const g = m.get(k);
            g.valor += d.repercGecope || 0;
            g.somaPrazo += d.prazoDias;
            g.qtd += 1;
        });
        const grupos = Array.from(m.entries()).map(([key, g]) => ({ key, valor: g.valor, prazoMedio: g.qtd ? g.somaPrazo / g.qtd : 0 }));
        grupos.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
        const top = grupos.slice(0, 10);

        const data = [
            { x: top.map(g => g.key), y: top.map(g => g.valor), name: "Valor revisado (GECOPE)", type: "bar", marker: { color: "#018ABD" }, yaxis: "y" },
            { x: top.map(g => g.key), y: top.map(g => g.prazoMedio), name: "Prazo médio (dias)", mode: "lines+markers", line: { color: "#F28C00", width: 3 }, marker: { size: 8 }, yaxis: "y2" }
        ];
        const layout = { margin: { l: 60, r: 60, t: 10, b: 60 }, yaxis: { title: "R$" }, yaxis2: { title: "Dias", overlaying: "y", side: "right" }, legend: { orientation: "h", y: -0.25 }, height: 320 };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-prazo-valor"), top.length ? data : [], layout, { displayModeBar: false, responsive: true });
    }

    let finDrilldownRows = [];
    let finSort = { key: "repercGecope", dir: "desc" };
    const finFmtMoney = v => window.formatCompact ? window.formatCompact(v) : String(v);
    const finFmtData = d => (d instanceof Date && !isNaN(d)) ? d.toLocaleDateString("pt-BR") : "-";

    function renderDrilldownFinanceiro(rows) {
        const withDiff = rows.map(d => {
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
        if (countEl) countEl.textContent = `${withDiff.length} processos · clique numa coluna para ordenar`;

        const esc = v => window.escapeHTML ? window.escapeHTML(v || "") : String(v || "");
        const tbody = document.getElementById("fin-drilldown-body");
        if (!tbody) return;
        tbody.innerHTML = withDiff.map(d => `
            <tr>
                <td>${esc(d.processo)}</td>
                <td>${esc(window.formatStatusDisplay ? window.formatStatusDisplay(d.status) : d.status)}</td>
                <td>${esc(d.fiscal)}</td>
                <td>${esc(d.nomeAnalista)}</td>
                <td>${esc(d.contratada)}</td>
                <td>${finFmtData(d.dataAbertura)}</td>
                <td>${finFmtData(d.dataAprovacao)}</td>
                <td>${typeof d.prazoDias === "number" && isFinite(d.prazoDias) ? d.prazoDias + "d" : "-"}</td>
                <td>${finFmtMoney(d.repercFiscal)}</td>
                <td>${finFmtMoney(d.repercGecope)}</td>
                <td class="${d._diff < 0 ? "diff-neg" : "diff-pos"}">${finFmtMoney(d._diff)}</td>
                <td class="${d._diffPerc < 0 ? "diff-neg" : "diff-pos"}">${d._diffPerc.toFixed(1)}%</td>
            </tr>`).join("");
    }

    (function wireFinDrilldownSort() {
        const head = document.getElementById("fin-drilldown-head");
        if (!head) return;
        head.querySelectorAll("th[data-key]").forEach(th => {
            th.addEventListener("click", () => {
                const key = th.getAttribute("data-key");
                finSort = { key, dir: (finSort.key === key && finSort.dir === "desc") ? "asc" : "desc" };
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        });
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
        renderPorFiscalFinanceiro(filtered);
        renderPrazoValorFinanceiro(filtered);
        renderDrilldownFinanceiro(filtered);
    }

    const groupCount = (rows, kFn) => { const c = {}; (rows||[]).forEach(r => { const k = kFn(r); c[k] = (c[k] || 0) + 1; }); return Object.keys(c).map(k => ({ key: k, value: c[k] })); };
    const groupAvg = (rows, kFn, vFn) => { const s = {}, c = {}; (rows||[]).forEach(r => { const k = kFn(r), v = vFn(r); if (window.isFiniteNumber ? window.isFiniteNumber(v) : (typeof v === 'number' && isFinite(v))) { s[k] = (s[k] || 0) + v; c[k] = (c[k] || 0) + 1; } }); return Object.keys(s).map(k => ({ key: k, value: c[k] > 0 ? s[k] / c[k] : 0 })).filter(d => d.value > 0); };
    const topN = (g, n) => g.sort((a, b) => b.value - a.value).slice(0, n);
    const quantile = (arr, q) => { const p = (arr.length - 1) * q, b = Math.floor(p), r = p - b; return arr[b + 1] !== undefined ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b]; };
    const renderHBar = (id, g, tx) => {
        if (!g.length) { if (window.Plotly) Plotly.react(document.getElementById(id), [], { title: "Sem dados" }); return; }
        const y = g.map(r => r.key).reverse(), x = g.map(r => r.value).reverse();
        if (window.Plotly) Plotly.react(document.getElementById(id), [{ x, y, type: 'bar', orientation: 'h', text: x.map(v => v.toFixed(0)), textposition: 'outside', marker: { color: "#018ABD" } }], { margin: { l: 180, r: 20, t: 10, b: 40 }, xaxis: { title: tx }, yaxis: { automargin: true }, height: Math.max(300, 26 * y.length + 80) }, { displayModeBar: false });
    };

    var ger = { fiscal: document.getElementById("gerencial-filter-fiscal"), status: document.getElementById("gerencial-filter-status"), clear: document.getElementById("btn-gerencial-clear") };
    let gerBase = [];
    function updateGerencialFilters(rows) { gerBase = rows; fillSelect(ger.fiscal, gerBase.map(d => d.fiscal)); fillSelect(ger.status, gerBase.map(d => d.status)); updateGerencial(); }
    function getGerencialData() {
        const f = getSelectedValues(ger.fiscal);
        const s = getSelectedValues(ger.status);

        const role = window.getCurrentUserRole ? window.getCurrentUserRole() : (sessionStorage.getItem('sop_role') || 'guest');
        const userFiscal = role === 'fiscal' ? sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || '' : '';

        return (gerBase || []).filter(d => {
            if (role === 'fiscal' && userFiscal) {
                const dFiscal = (d.fiscal || "").toUpperCase().trim();
                const userFiscalUpper = userFiscal.toUpperCase().trim();
                const dFiscalNorm = dFiscal.replace(/[\.\-]+/g, ' ').trim();
                const userFiscalNorm = userFiscalUpper.replace(/[\.\-]+/g, ' ').trim();
                if (dFiscalNorm !== userFiscalNorm) return false;
            }

            return (f.length === 0 || f.includes(d.fiscal)) && (s.length === 0 || s.includes(d.status));
        });
    }
    function updateGerencial() {
        const f = getSelectedValues(ger.fiscal);
        const s = getSelectedValues(ger.status);
        let rows = [...gerBase];

        if (f.length < (ger.fiscal?.options?.length || 0)) {
            rows = rows.filter(d => f.includes(d.fiscal || "Não informado"));
        }
        if (s.length < (ger.status?.options?.length || 0)) {
            rows = rows.filter(d => s.includes(d.status || "Não informado"));
        }

        document.getElementById("gerencial-count-badge").textContent = `${rows.length} processos`;
        renderHBar("chart_proc_por_fiscal", topN(groupCount(rows, d => d.fiscal), 20), "Qtd");
        const pieD = groupCount(rows, d => d.status).sort((a, b) => b.value - a.value);
        if (window.Plotly) Plotly.react(document.getElementById("chart_proc_por_status"), [{ type: "pie", labels: pieD.map(d => window.formatStatusDisplay ? window.formatStatusDisplay(d.key) : d.key), values: pieD.map(d => d.value), textinfo: "percent+label", marker: { colors: ['#008F3D', '#F28C00', '#018ABD', '#4CC17C', '#D35400'] } }], { margin: { l: 20, r: 20, t: 10, b: 10 }, height: 360 }, { displayModeBar: false });
        renderHBar("chart_proc_por_tipo", topN(groupCount(rows, d => d.tipo), 20), "Qtd");
    }

    // Expose globals
    window.getSelectedValues = getSelectedValues;
    window.renderMultiSelectUI = renderMultiSelectUI;
    window.fillSelect = fillSelect;
    window.populateFinanceiroFilters = populateFinanceiroFilters;
    window.getFinanceiroData = getFinanceiroData;
    window.clearFinanceiro = clearFinanceiro;
    window.updateFinanceiro = updateFinanceiro;
    window.groupCount = groupCount;
    window.groupAvg = groupAvg;
    window.topN = topN;
    window.quantile = quantile;
    window.renderHBar = renderHBar;
    window.populateFinanceiroFilters = populateFinanceiroFilters;
    window.updateGerencialFilters = updateGerencialFilters;
    window.getGerencialData = getGerencialData;
    window.updateGerencial = updateGerencial;

    // Also expose fin/ger as globals
    window.fin = fin; window.ger = ger;

})(window);
