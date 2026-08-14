// shared/multiselect.js — utilitário de dropdown multiselect com busca, usado pelos filtros
// de vários módulos (hoje: Financeiro). Extraído de dashboard.js (Fase 3 da reorganização modular).
(function (window) {
    'use strict';

    /* debounce local (PERFORMANCE): dashboard.js carrega antes de main.js (ver ordem de
       <script src> em index.html), então window.debounce (definido em main.js) ainda não
       existe quando os listeners abaixo são registrados. */
    function dashDebounce(fn, wait) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

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

    window.dashDebounce = dashDebounce;
    window.getSelectedValues = getSelectedValues;
    window.renderMultiSelectUI = renderMultiSelectUI;
    window.fillSelect = fillSelect;

})(window);
