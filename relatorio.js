
// --------------------------------------------------------------
// NOVA FUNCAOO DE IMPRESSO HTML (Substitui o PDF direto)
// --------------------------------------------------------------
                                function imprimirRelatorioSOP(dados, htmlOpcional = null) {
                                    if (!dados) return;

                                    let htmlParaImprimir = htmlOpcional || "";
                                    const modalBody = document.getElementById('modal-report-body');

                                    if (!htmlParaImprimir) {
                                        if (modalBody && modalBody.querySelector('.report-print-area') && typeof currentCompositionData !== 'undefined' && currentCompositionData && (currentCompositionData.id === dados.id || currentCompositionData.codigo === dados.codigo)) {
                                            htmlParaImprimir = modalBody.innerHTML;
                                        } else {
                                            const tempDiv = document.createElement('div');
                                            renderizarRelatorioSOP_HTML(dados, tempDiv);
                                            htmlParaImprimir = tempDiv.innerHTML;
                                        }
                                    }

                                    const printWindow = window.open('', '_blank');
                                    const tagsHead = '<meta charset="UTF-8"><title>Impressão - ' + (dados.codigo || 'SOP') + '<\/title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"><style>body { font-family: "Montserrat", sans-serif; background-color: white !important; } .report-print-area { padding: 0 !important; margin: 0 !important; box-shadow: none !important; border: none !important; } @media print { .d-print-none, .btn, .modal-footer, .btn-close { display: none !important; } @page { margin: 1cm; size: auto; } body { padding: 0; } } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }</style><script src="https://cdn.tailwindcss.com"><\/script>';

                                    printWindow.document.write('<!DOCTYPE html><html lang="pt-BR"><head>' + tagsHead + '<\/head><body><div class="container-fluid p-4">' + htmlParaImprimir + '<\/div><script>window.onload = () => { setTimeout(() => { window.print(); }, 1000); };<\/script><\/body><\/html>');
                                    printWindow.document.close();
                                }

                                // NOVA FUNÇÃO: Recalcula o relatório com base nos inputs de BDI e DESC do Modal
                                function recalcularRelatorioSOP() {
                                    if (!currentCompositionData) return;
                                    const modalBdi = document.getElementById('modal-report-bdi');
                                    const modalDesc = document.getElementById('modal-report-desc');

                                    // Converte string para número com fallback para 0, tratando vírgula
                                    const parseVal = (str) => parseFloat((str || "0").toString().replace(',', '.')) || 0;

                                    currentCompositionData.bdi = modalBdi ? parseVal(modalBdi.value) : 0;
                                    currentCompositionData.desconto = modalDesc ? parseVal(modalDesc.value) : 0;

                                    const modalBody = document.getElementById('modal-report-body');
                                    if (modalBody) {
                                        renderizarRelatorioSOP_HTML(currentCompositionData, modalBody);
                                    }
                                }

                                function renderizarRelatorioSOP_HTML(dados, container) {
                                    const parseLocalNum = (v) => {
                                        if (v === undefined || v === null || v === '') return 0;
                                        if (typeof v === 'number') return v;
                                        let str = v.toString().trim();
                                        if (str.includes(',')) {
                                            return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
                                        }
                                        return parseFloat(str) || 0;
                                    };

                                    const safeLoc = (val, dec = 2) => {
                                        const n = (typeof val === 'string') ? parseLocalNum(val) : (Number(val) || 0);
                                        return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
                                    };

                                    const codigo = dados.codigo || 'N/A';
                                    const descricao = (dados.descricao || 'SEM DESCRIÇÃO').toUpperCase();
                                    const unidade = dados.unidade || 'N/A';
                                    const bdiText = (dados.bdi !== null && dados.bdi !== undefined) ? (safeLoc(dados.bdi, 2) + '%') : '0,00%';
                                    const descText = (dados.desconto !== null && dados.desconto !== undefined) ? (safeLoc(dados.desconto, 2) + '%') : '0,00%';

                                    // Lógica de Diferenciação: SOP Oficial (GEROA) vs Usuário (GECOPE)
                                    const isOficial = (dados.usuario || '').toUpperCase() === 'SOP';
                                    const gerenciaTexto = isOficial ? 'GEROA - GERÊNCIA DE ORAMENTO E AVALIAO DE IMVEIS' : 'GECOPE - GERÊNCIA DE CONTROLE DE ADITIVOS';
                                    const relatorioLabel = isOficial ? 'GEROA' : 'GECOPE';

                                    const itensRaw = dados.itens || [];
                                    const itens = itensRaw.map(normalizarItemParaPDF);

                                    const itensAgrupados = itens.reduce((acc, item) => {
                                        const grupo = item.grupo || 'GERAL';
                                        if (!acc[grupo]) acc[grupo] = [];
                                        acc[grupo].push(item);
                                        return acc;
                                    }, {});

                                    let totalSimples = 0;
                                    let tableRows = '';
                                    const retroativos = [];

                                    const ordemGrupos = ['MO DE OBRA', 'MATERIAL', 'EQUIPAMENTOS', 'SERVIO', 'GERAL'];
                                    const gruposOrdenados = Object.keys(itensAgrupados).sort((a, b) => {
                                        const idxA = ordemGrupos.indexOf(a);
                                        const idxB = ordemGrupos.indexOf(b);
                                        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
                                    });

                                    gruposOrdenados.forEach((nomeGrupo) => {
                                        const insumosDoGrupo = itensAgrupados[nomeGrupo];
                                        let subtotalGrupo = 0;

                                        tableRows += `
                            <tr style="background-color: #e8e8e8; font-size: 0.8rem; font-weight: bold;">
                                <td colspan="8" style="padding: 0.6rem 0.5rem; color: #333; text-align: center; text-uppercase; letter-spacing: 0.5px;">${nomeGrupo}</td>
                            </tr>
                        `;

                                        insumosDoGrupo.forEach(item => {
                                            subtotalGrupo += item.total;
                                            totalSimples += item.total;

                                            if (item.retroativo) {
                                                retroativos.push({ ...item, codInsumo: item.codigo, descInsumo: item.descricao });
                                            }

                                            let fonteDisplay = `<div>${item.origem}</div>`;
                                            if ((item.origem === 'SEINFRA' || item.origem === 'SINAPI') && item.referencia) {
                                                const refLabel = item.referencia.toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada';
                                                fonteDisplay += `<div class="text-muted" style="font-size: 0.65rem;">${refLabel}</div>`;
                                            }

                                            tableRows += `
                                <tr style="font-size: 0.8rem; border-bottom: 1px solid #eee;">
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${fonteDisplay}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.versao || '-'}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center; font-weight: bold;">${item.codigo}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: justify;">
                                        <div class="text-dark">${item.descricao}</div>
                                        ${item.retroativo ? '<div class="text-success fw-bold mt-1" style="font-size: 0.6rem;"><i class="bi bi-info-circle me-1"></i> Ver Memória de Cálculo na Pág. 02</div>' : ''}
                                    </td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.unidade}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${safeLoc(item.coeficiente, 4)}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right;">${safeLoc(item.preco_unitario)}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right; font-weight: bold;">${safeLoc(item.total)}</td>
                                </tr>
                            `;
                                        });

                                        tableRows += `
                            <tr style="font-size: 0.8rem; background-color: #f5f5f5; font-weight: bold; border-top: 1px solid #ddd;">
                                <td colspan="7" style="padding: 0.6rem 0.5rem; text-align: right; color: #666; text-transform: uppercase;">TOTAL ${nomeGrupo}</td>
                                <td style="padding: 0.6rem 0.5rem; text-align: right; color: #333;">${safeLoc(subtotalGrupo)}</td>
                            </tr>
                        `;
                                    });

                                    const bdiVal = parseLocalNum(dados.bdi) / 100;
                                    const descVal = parseLocalNum(dados.desconto) / 100;
                                    const valorBDI = (totalSimples || 0) * (bdiVal || 0);
                                    const totalComBDI = (totalSimples || 0) + valorBDI;
                                    const valorDesconto = totalComBDI * (descVal || 0);
                                    const precoFinal = totalComBDI - valorDesconto;

                                    let explicitMemoryHTML = '';
                                    if (retroativos.length > 0) {
                                        explicitMemoryHTML = `
                            <div class="print-page-break p-4">
                                <h6 class="fw-bold text-success mb-3" style="font-size: 0.9rem;">Metodologia de Cálculo de Insumo Não Tabelado (Cotação de Mercado)</h6>
                                <p class="text-muted" style="font-size: 0.75rem; text-align: justify; line-height: 1.4;">
                                    O(s) presente(s) custo(s) unitário(s) foi(ram) obtido(s) através de cotação de mercado, visto que o(s) insumo(s) não consta(m) nas tabelas de referência oficiais (SINAPI/SICRO/ORSE). Para garantir a integridade e a homogeneidade financeira do orçamento, foi realizado o processo de retroação (deflacionamento) do(s) valor(es) cotado(s).
                                </p>
                                <p class="text-muted" style="font-size: 0.75rem; text-align: justify; line-height: 1.4;">
                                    O objetivo é compatibilizar o(s) preço(s) de mercado atual(is) com a Data-Base da Licitação/Orçamento, expurgando a inflação acumulada no período. Desta forma, todos os custos do orçamento permanecem referenciados no mesmo marco temporal, permitindo a correta aplicação de reajustes contratuais futuros.
                                </p>

                                <h6 class="fw-bold mt-4 mb-2" style="font-size: 0.85rem;">Memória de Cálculo e Compatibilização de Preços</h6>
                                <p class="text-muted mb-4" style="font-size: 0.75rem; text-align: justify;">
                                    Considerando a defasagem temporal entre a data da(s) cotação(ões) de mercado e a data-base original deste orçamento, aplicou-se a retroação financeira dos valores. O cálculo consiste na divisão do valor cotado pelo índice inflacionário acumulado no período (ou pela razão entre os índices das datas final e inicial), utilizando o indexador informado na(s) tabela(s) a seguir:
                                </p>
                                 ${retroativos.map(r => {
                                            const ret = r.retroativo;
                                            const base = parseLocalNum(ret.base);
                                            const iIni = parseLocalNum(ret.indIni);
                                            const iFin = parseLocalNum(ret.indFin);
                                            const fator = (iFin / iIni) || 1;
                                            const dCot = ret.dataIni ? ret.dataIni.split('-').reverse().join('/') : '-';
                                            const dBase = ret.dataFin ? ret.dataFin.split('-').reverse().join('/') : '-';

                                            const fornecedoresHTML = (ret.fornecedores && ret.fornecedores.length > 0) ? `
                                <div class="mb-3">
                                    <div class="fw-bold text-dark mb-1" style="font-size: 0.75rem;">Detalhamento das Coletas (${ret.metodoPreco === 'MEDIA' ? 'Média Aritmética' : 'Menor Preço Adotado'}):</div>
                                    <table class="table table-sm table-bordered mb-2" style="font-size: 0.7rem; max-width: 500px;">
                                        <thead class="bg-light"><tr><th>Fornecedor</th><th class="text-end" style="width: 120px;">Valor Cotado</th></tr></thead>
                                        <tbody>
                                            ${ret.fornecedores.map(f => `<tr><td>${f.nome}</td><td class="text-end">R$ ${safeLoc(f.valor)}</td></tr>`).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            ` : '';

                                            return `
                                        <div class="mb-5 border-bottom pb-3">
                                            <div class="fw-bold text-dark mb-2" style="font-size: 0.85rem;">Item: ${r.codInsumo} - ${r.descInsumo}</div>
                                            
                                            ${fornecedoresHTML}

                                            <div class="fw-bold text-dark mb-1" style="font-size: 0.75rem;">Compatibilidade Temporal (Retroação):</div>
                                            <table class="table table-bordered table-sm" style="font-size: 0.75rem; max-width: 600px;">
                                                <thead style="background-color: #f5f5f5;">
                                                    <tr><th style="width: 70%">Parâmetro</th><th class="text-center">Valor / Descrição</th></tr>
                                                </thead>
                                                <tbody>
                                                    <tr><td>Valor de Mercado / Base (A)</td><td class="text-center fw-bold">R$ ${safeLoc(base)}</td></tr>
                                                    <tr><td>Data Cotação / Índice (C)</td><td class="text-center">${dCot} | ${safeLoc(iIni, 3)}</td></tr>
                                                    <tr><td>Data-Base / Índice (E)</td><td class="text-center">${dBase} | ${safeLoc(iFin, 3)}</td></tr>
                                                    <tr><td>Fator de Retroação (E / C)</td><td class="text-center fw-bold">${fator.toFixed(4)}</td></tr>
                                                    <tr><td>Preço Adotado Final (A x Fator)</td><td class="text-center fw-bold text-success">R$ ${safeLoc(base * fator)}</td></tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    `;
                                        }).join('')}
                            </div>
                        `;
                                    }

                                    container.innerHTML = `
                        <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                                <div class="d-flex align-items-center">
                                    <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SOP-CE</div>
                                    <div>
                                        <div class="fw-bold fs-6" style="color: #008F3D; line-height: 1.2;">ESTADO DO CEARÁ</div>
                                        <div class="text-dark fw-bold" style="font-size: 0.75rem;">SUPERINTENDÊNCIA DE OBRAS PÚBLICAS</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <h5 class="fw-bold mb-0 text-dark" style="font-size: 1.25rem;">COMPOSIÇÃO ANALÍTICA</h5>
                                    <div class="text-muted fw-bold" style="font-size: 0.7rem;">${gerenciaTexto}</div>
                                </div>
                            </div>

                            <div style="background: white; border: 1px solid #eee; border-left: 6px solid #008F3D; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); padding: 1.5rem 0rem; display: flex; align-items: stretch; min-height: 100px; margin-bottom: 2rem;">
                                <div style="flex: 0 0 8%; padding: 0 1rem; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">CÓDIGO</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${codigo}</div>
                                </div>
                                <div style="flex: 1; padding: 0 2rem; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">DESCRIÇÃO DA COMPOSIÇÃO</small>
                                    <div style="font-size: 1.05rem; font-weight: 800; color: #1a1a1a; line-height: 1.35; text-transform: uppercase; text-align: justify;">
                                        ${descricao}
                                    </div>
                                </div>
                                <div style="flex: 0 0 8%; padding: 0 0.5rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">UNIDADE</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${unidade}</div>
                                </div>
                                <div style="flex: 0 0 14%; padding: 0 1.2rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; gap: 2px;">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <small class="text-muted fw-bold" style="font-size: 0.6rem; letter-spacing: 0.5px; width: 35px;">BDI:</small>
                                        <span class="fw-bold text-primary" style="font-size: 1rem;">${bdiText}</span>
                                    </div>
                                    <div class="d-flex justify-content-between align-items-center">
                                        <small class="text-muted fw-bold" style="font-size: 0.6rem; letter-spacing: 0.5px; width: 35px;">DESC:</small>
                                        <span class="fw-bold text-danger" style="font-size: 1rem;">${descText}</span>
                        </div>
                    </div>
                </div>

                            <div class="table-responsive">
                                <table class="table table-sm align-middle" style="border-collapse: collapse; width: 100%;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; background-color: #f5f5f5; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd; color: #333;">
                                            <th style="width: 8%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase">FONTE</th>
                                            <th style="width: 7%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase">VERSÃO</th>
                                            <th style="width: 8%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase text-center">CÓDIGO</th>
                                            <th style="width: 48%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase">DESCRIÇÃO DO INSUMO</th>
                                            <th style="width: 5%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase text-center">UNID.</th>
                                            <th style="width: 7%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase text-center">COEF.</th>
                                            <th style="width: 9%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase text-end">P. UNIT.</th>
                                            <th style="width: 8%; padding: 0.75rem 0.5rem;" class="fw-bold text-uppercase text-end">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableRows}
                                    </tbody>
                                </table>
                            </div>

                            <div style="margin-top: 1.5rem; border-top: 1px solid #eee; padding-top: 1rem;">
                                <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end; padding-right: 0.5rem; margin-bottom: 1.5rem;">
                                    <div style="display: flex; gap: 40px; justify-content: flex-end; width: 100%;">
                                        <span class="text-muted fw-bold text-uppercase" style="font-size: 0.72rem; letter-spacing: 0.5px;">Total Simples (Insumos)</span>
                                        <span class="fw-bold text-dark" style="font-size: 0.9rem; min-width: 110px; text-align: right;">R$ ${safeLoc(totalSimples)}</span>
                                    </div>
                                    ${valorBDI > 0 ? `
                                    <div style="display: flex; gap: 40px; justify-content: flex-end; width: 100%;">
                                        <span class="text-primary fw-bold text-uppercase" style="font-size: 0.72rem; letter-spacing: 0.5px;">(+) BDI Aplicado (${bdiText})</span>
                                        <span class="fw-bold text-primary" style="font-size: 0.9rem; min-width: 110px; text-align: right;">R$ ${safeLoc(valorBDI)}</span>
                                    </div>` : ''}
                                    ${valorDesconto > 0 ? `
                                    <div style="display: flex; gap: 40px; justify-content: flex-end; width: 100%;">
                                        <span class="text-danger fw-bold text-uppercase" style="font-size: 0.72rem; letter-spacing: 0.5px;">(-) Desconto Aplicado (${descText})</span>
                                        <span class="fw-bold text-danger" style="font-size: 0.9rem; min-width: 110px; text-align: right;">R$ ${safeLoc(valorDesconto)}</span>
                                    </div>` : ''}
                                </div>

                                <div style="padding: 1.8rem 2rem; background: linear-gradient(135deg, #008F3D 0%, #007233 100%); color: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 143, 61, 0.2);">
                                    <div class="row align-items-center">
                                        <div class="col-8">
                                            <small class="text-white-50 fw-bold d-block mb-1" style="font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase;">Preço Total Unitário</small>
                                            <div style="font-size: 0.95rem; font-weight: 500; opacity: 0.9;">Relatório Analítico ${relatorioLabel}/SOP-CE</div>
                                        </div>
                                        <div class="col-4 text-end">
                                            <div style="font-size: 2.4rem; font-weight: 800; letter-spacing: -1px; line-height: 1;">
                                                <span style="font-size: 1.2rem; font-weight: 600; vertical-align: middle; margin-right: 4px;">R$</span>${safeLoc(precoFinal)}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mt-2 text-white-50 text-end" style="font-size: 0.65rem;">
                                        <div>Gerado eletronicamente via Painel GECOPE/SOP</div>
                                        <div>Página 1 de 1</div>
                                        <div>${new Date().toLocaleString('pt-BR')}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        ${explicitMemoryHTML}
                    `;
                                }

                                function gerarDOCX_Profissional(dados) {
                                    const { Document, Packer, Paragraph, Table, TableCell, TableRow, WidthType, HeadingLevel, TextRun, AlignmentType, VerticalAlign, BorderStyle } = window.docx;

                                    const formatarNumero = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

                                    // CONFIGURAO DE BORDAS INVISÍVEIS PARA CABEALHO
                                    const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

                                    // 1. CONSTRUO DO CABEALHO (SIMULANDO O LAYOUT DO MODAL)
                                    const headerTable = new Table({
                                        width: { size: 100, type: WidthType.PERCENTAGE },
                                        borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DEE2E6" }, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
                                        rows: [
                                            new TableRow({
                                                children: [
                                                    // Lado Esquerdo: Logo e Governo
                                                    new TableCell({
                                                        width: { size: 60, type: WidthType.PERCENTAGE },
                                                        children: [
                                                            new Paragraph({
                                                                children: [
                                                                    new TextRun({ text: "SOP-CE", bold: true, color: "FFFFFF", size: 24, shading: { fill: "008F3D" } }),
                                                                    new TextRun({ text: "ESTADO DO CEARÁ", bold: true, color: "008F3D", size: 22 }),
                                                                ],
                                                                spacing: { after: 100 }
                                                            }),
                                                            new Paragraph({
                                                                children: [
                                                                    new TextRun({ text: "SUPERINTENDÊNCIA DE OBRAS PÚBLICAS", bold: true, color: "343A40", size: 16 })
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    // Lado Direito: Título
                                                    new TableCell({
                                                        width: { size: 40, type: WidthType.PERCENTAGE },
                                                        verticalAlign: VerticalAlign.CENTER,
                                                        children: [
                                                            new Paragraph({
                                                                children: [
                                                                    new TextRun({ text: "COMPOSIÇÃO ANALÍTICA", bold: true, color: "212529", size: 28 })
                                                                ],
                                                                alignment: AlignmentType.RIGHT
                                                            }),
                                                            new Paragraph({
                                                                children: [
                                                                    new TextRun({ text: "GEROA - GERÊNCIA DE ORAMENTOS E AVALIAO DE IMVEIS", bold: true, color: "6C757D", size: 14 })
                                                                ],
                                                                alignment: AlignmentType.RIGHT
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    });

                                    // 2. METADADOS (BOXED GRID)
                                    const metaTable = new Table({
                                        width: { size: 100, type: WidthType.PERCENTAGE },
                                        rows: [
                                            new TableRow({
                                                children: [
                                                    new TableCell({
                                                        shading: { fill: "F8F9FA" },
                                                        children: [
                                                            new Paragraph({ children: [new TextRun({ text: "CÓDIGO", bold: true, size: 12, color: "6C757D" })] }),
                                                            new Paragraph({ children: [new TextRun({ text: dados.codigo || '-', bold: true, size: 18 })] })
                                                        ]
                                                    }),
                                                    new TableCell({
                                                        width: { size: 50, type: WidthType.PERCENTAGE },
                                                        shading: { fill: "F8F9FA" },
                                                        children: [
                                                            new Paragraph({ children: [new TextRun({ text: "DESCRIÇÃO DA COMPOSIÇÃO", bold: true, size: 12, color: "6C757D" })] }),
                                                            new Paragraph({ children: [new TextRun({ text: (dados.descricao || '-').toUpperCase(), bold: true, size: 18 })] })
                                                        ]
                                                    }),
                                                    new TableCell({
                                                        shading: { fill: "F8F9FA" },
                                                        children: [
                                                            new Paragraph({ children: [new TextRun({ text: "UNID.", bold: true, size: 12, color: "6C757D" })] }),
                                                            new Paragraph({ children: [new TextRun({ text: dados.unidade || '-', bold: true, size: 18 })] })
                                                        ]
                                                    }),
                                                    new TableCell({
                                                        shading: { fill: "F8F9FA" },
                                                        children: [
                                                            new Paragraph({ children: [new TextRun({ text: "TAXAS", bold: true, size: 12, color: "6C757D" })] }),
                                                            new Paragraph({ children: [new TextRun({ text: `BDI: ${dados.bdi || '0,00'}%`, bold: true, size: 14, color: "007BFF" })] }),
                                                            new Paragraph({ children: [new TextRun({ text: `DESC: ${dados.desconto || '0,00'}%`, bold: true, size: 14, color: "DC3545" })] })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    });

                                    // 3. TABELA DE ITENS
                                    const headerRow = new TableRow({
                                        children: [
                                            "FONTE", "VERSÃO", "CÓDIGO", "DESCRIÇÃO DO INSUMO", "UNID", "COEF.", "P. UNIT.", "TOTAL"
                                        ].map(h => new TableCell({
                                            shading: { fill: "343A40" },
                                            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 14 })], alignment: AlignmentType.CENTER })]
                                        }))
                                    });

                                    const itemRows = [];
                                    let currentGroup = '';
                                    let subtotalSimples = 0;

                                    const itensRaw = dados.itens || [];
                                    const itens = itensRaw.map(normalizarItemParaPDF);

                                    const itensOrdenados = [...itens].sort((a, b) => {
                                        const ordem = { 'MO DE OBRA': 1, 'MATERIAL': 2, 'EQUIPAMENTOS': 3, 'SERVIO': 4, 'GERAL': 99 };
                                        return (ordem[a.grupo] || 99) - (ordem[b.grupo] || 99);
                                    });

                                    itensOrdenados.forEach(item => {
                                        const grupo = item.grupo;
                                        subtotalSimples += item.total;

                                        if (grupo !== currentGroup) {
                                            currentGroup = grupo;
                                            itemRows.push(new TableRow({
                                                children: [new TableCell({
                                                    columnSpan: 8,
                                                    shading: { fill: "F2F2F2" },
                                                    children: [new Paragraph({ children: [new TextRun({ text: currentGroup.toUpperCase(), bold: true, size: 16 })], alignment: AlignmentType.CENTER })]
                                                })]
                                            }));
                                        }

                                        // Descrição com Memória
                                        const descChildren = [new Paragraph({ children: [new TextRun({ text: item.descricao, bold: true, size: 16 })], alignment: AlignmentType.JUSTIFIED })];

                                        if (item.retroativo) {
                                            const r = item.retroativo;
                                            const dCot = r.dataIni ? r.dataIni.split('-').reverse().join('/') : '-';
                                            const dBase = r.dataFin ? r.dataFin.split('-').reverse().join('/') : '-';
                                            const fator = (Number(r.indFin) / Number(r.indIni)) || 1;

                                            descChildren.push(new Paragraph({
                                                children: [
                                                    new TextRun({ text: "\n[MEMRIA DE CÁLCULO - RETROAO]", bold: true, color: "008F3D", size: 12 }),
                                                    new TextRun({ text: `\nValor Cotado: R$ ${formatarNumero(r.base)} | Data: ${dCot} | Índice Cot.: ${formatarNumero(r.indIni, 3)}`, size: 12 }),
                                                    new TextRun({ text: `\nData-Base: ${dBase} | Índice Base: ${formatarNumero(r.indFin, 3)} | Fator: ${fator.toFixed(4)}`, size: 12 })
                                                ],
                                                spacing: { before: 100 }
                                            }));
                                        }

                                        // Lógica de exibição da Fonte com Referência no DOCX
                                        const fonteChildren = [new Paragraph({ children: [new TextRun({ text: item.origem, size: 14 })], alignment: AlignmentType.CENTER })];
                                        if ((item.origem === 'SEINFRA' || item.origem === 'SINAPI') && item.referencia) {
                                            const refLabel = item.referencia.toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada';
                                            fonteChildren.push(new Paragraph({ children: [new TextRun({ text: refLabel, size: 10, color: "6C757D" })], alignment: AlignmentType.CENTER }));
                                        }

                                        itemRows.push(new TableRow({
                                            children: [
                                                new TableCell({ children: fonteChildren }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.versao, size: 14 })], alignment: AlignmentType.CENTER })] }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.codigo, bold: true, size: 16 })], alignment: AlignmentType.CENTER })] }),
                                                new TableCell({ children: descChildren }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.unidade, size: 14 })], alignment: AlignmentType.CENTER })] }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatarNumero(item.coeficiente, 4), size: 14 })], alignment: AlignmentType.CENTER })] }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatarNumero(item.preco_unitario), size: 14 })], alignment: AlignmentType.RIGHT })] }),
                                                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatarNumero(item.total), bold: true, size: 14 })], alignment: AlignmentType.RIGHT })] })
                                            ]
                                        }));
                                    });

                                    // 4. TOTAIS E RODAP
                                    const bdiVal = parseFloat((dados.bdi || 0).toString().replace(',', '.')) / 100;
                                    const descVal = parseFloat((dados.desconto || 0).toString().replace(',', '.')) / 100;
                                    const valorBDI = subtotalSimples * bdiVal;
                                    const totalComBDI = subtotalSimples + valorBDI;
                                    const valorDesconto = totalComBDI * descVal;
                                    const precoFinal = totalComBDI - valorDesconto;

                                    const doc = new Document({
                                        sections: [{
                                            properties: {},
                                            children: [
                                                headerTable,
                                                new Paragraph({ text: "", spacing: { after: 200 } }),
                                                metaTable,
                                                new Paragraph({ text: "", spacing: { after: 200 } }),
                                                new Table({
                                                    width: { size: 100, type: WidthType.PERCENTAGE },
                                                    rows: [headerRow, ...itemRows]
                                                }),
                                                new Paragraph({ text: "", spacing: { before: 400 } }),
                                                // Totais
                                                new Paragraph({ children: [new TextRun({ text: `TOTAL SIMPLES: R$ ${formatarNumero(subtotalSimples)}`, size: 16 })], alignment: AlignmentType.RIGHT }),
                                                ...(valorBDI > 0 ? [new Paragraph({ children: [new TextRun({ text: `BDI (${dados.bdi}%): R$ ${formatarNumero(valorBDI)}`, size: 16, color: "007BFF" })], alignment: AlignmentType.RIGHT })] : []),
                                                ...(valorDesconto > 0 ? [new Paragraph({ children: [new TextRun({ text: `DESCONTO (${dados.desconto}%): R$ ${formatarNumero(valorDesconto)}`, size: 16, color: "DC3545" })], alignment: AlignmentType.RIGHT })] : []),
                                                new Paragraph({ children: [new TextRun({ text: `PREO TOTAL UNITÁRIO: R$ ${formatarNumero(precoFinal)}`, bold: true, size: 24, color: "008F3D" })], alignment: AlignmentType.RIGHT, spacing: { before: 200 } }),
                                                new Paragraph({ children: [new TextRun({ text: `Gerado em: ${new Date().toLocaleString('pt-BR')}`, size: 12, color: "6C757D" })], alignment: AlignmentType.RIGHT, spacing: { before: 400 } })
                                            ]
                                        }]
                                    });

                                    Packer.toBlob(doc).then(blob => {
                                        const link = document.createElement("a");
                                        link.href = URL.createObjectURL(blob);
                                        link.download = `${dados.codigo}_Analitica.docx`;
                                        link.click();
                                    });
                                }

                                async function exportarProcessos() {
                                    const rows = window.currentVisibleRows || [];
                                    if (rows.length === 0) {
                                        alert("Nenhum dado visível para exportar.");
                                        return;
                                    }

                                    // Verificar se ExcelJS está disponível
                                    if (typeof ExcelJS === 'undefined') {
                                        alert(" Biblioteca ExcelJS não carregada ainda. Aguarde e tente novamente.");
                                        return;
                                    }

                                    const btn = document.getElementById('btn-reuniao-export');
                                    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Gerando...'; }

                                    try {
                                        const now = new Date();
                                        const dateExport = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
                                        const userName = sessionStorage.getItem('sop_user_name') || 'Não identificado';

                                        // Coletar filtros ativos
                                        const filtrosAtivos = [];
                                        const metaVal = document.getElementById('meetingMetaSelect')?.value;
                                        const priorVal = document.getElementById('meetingPrioritarioSelect')?.value;
                                        const searchVal = document.getElementById('meetingSearch')?.value?.trim();
                                        if (metaVal) filtrosAtivos.push(`Meta: ${metaVal}`);
                                        if (priorVal) filtrosAtivos.push(`Prioritário: ${priorVal}`);
                                        if (searchVal) filtrosAtivos.push(`Busca: "${searchVal}"`);
                                        // Multi-selects de status e fiscal
                                        const statusSel = Array.from(document.getElementById('meetingStatusSelect')?.selectedOptions || []).map(o => o.text).filter(t => t !== 'Todos');
                                        const fiscalSel = Array.from(document.getElementById('meetingFiscalSelect')?.selectedOptions || []).map(o => o.text).filter(t => t !== 'Todos');
                                        if (statusSel.length > 0) filtrosAtivos.push(`Status: ${statusSel.join(', ')}`);
                                        if (fiscalSel.length > 0) filtrosAtivos.push(`Fiscal: ${fiscalSel.join(', ')}`);
                                        const filtrosStr = filtrosAtivos.length > 0 ? filtrosAtivos.join(' | ') : 'Sem filtros aplicados';

                                        //  Criar workbook ExcelJS 
                                        const workbook = new ExcelJS.Workbook();
                                        workbook.creator = 'GECOPE / SOP-CE';
                                        workbook.created = now;
                                        const ws = workbook.addWorksheet('Processos GECOPE', {
                                            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
                                        });

                                        //  PALETA DE CORES SOP 
                                        const COR_VERDE = '008F3D';   // Verde SOP principal
                                        const COR_VERDE_DARK = '007233';
                                        const COR_VERDE_CLARO = 'E8F5E9';   // fundo bloco logo
                                        const COR_CINZA_CLARO = 'F5F5F5';   // fundo linhas zebra
                                        const COR_HEADER_BG = '1B5E20';   // Verde escuro para cabeçalho da tabela
                                        const COR_META_BG = 'EEF8F1';   // Fundo linha de metadados

                                        //  DEFINIO DAS COLUNAS (LARGURAS FIXAS CONFORME SOLICITADO) 
                                        const colConfig = [
                                            { key: 'prioritario', header: 'Prioritário', width: 11 },
                                            { key: 'processo', header: 'Processo', width: 23 },
                                            { key: 'metaStatus', header: 'Meta (Status)', width: 16 },
                                            { key: 'dataMeta', header: 'Data Meta', width: 16 },
                                            { key: 'status', header: 'Status', width: 32 },
                                            { key: 'analista', header: 'Analista', width: 12 },
                                            { key: 'dataAbertura', header: 'Data Abertura', width: 16 },
                                            { key: 'dias', header: 'Dias', width: 9 },
                                            { key: 'contratante', header: 'Contratante', width: 14 },
                                            { key: 'contratada', header: 'Contratada', width: 35 },
                                            { key: 'descricao', header: 'Descrição', width: 75 },
                                        ];
                                        const totalCols = colConfig.length; // 11
                                        const ROW_MIN_H = 20;

                                        // Aplicar larguras fixas e chaves
                                        colConfig.forEach((c, i) => {
                                            ws.getColumn(i + 1).width = c.width;
                                            ws.getColumn(i + 1).key = c.key;
                                        });

                                        // 
                                        // LINHA 1  BLOCO LOGO (SOP-CE simulado)
                                        // 
                                        ws.mergeCells(1, 1, 2, 2);
                                        const logoCell = ws.getCell('A1');
                                        logoCell.value = 'SOP-CE';
                                        logoCell.font = { name: 'Montserrat', bold: true, size: 22, color: { argb: 'FF' + COR_VERDE } };
                                        logoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_VERDE_CLARO } };
                                        logoCell.alignment = { vertical: 'middle', horizontal: 'center' };
                                        logoCell.border = {
                                            top: { style: 'medium', color: { argb: 'FF' + COR_VERDE } },
                                            left: { style: 'medium', color: { argb: 'FF' + COR_VERDE } },
                                            bottom: { style: 'medium', color: { argb: 'FF' + COR_VERDE } },
                                            right: { style: 'thin', color: { argb: 'FF' + COR_VERDE } },
                                        };

                                        // Células C1 e C2  Texto institucional
                                        ws.mergeCells(1, 3, 1, 6);
                                        const instCell1 = ws.getCell('C1');
                                        instCell1.value = 'ESTADO DO CEARÁ';
                                        instCell1.font = { name: 'Montserrat', bold: true, size: 12, color: { argb: 'FF333333' } };
                                        instCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_VERDE_CLARO } };
                                        instCell1.alignment = { vertical: 'middle', horizontal: 'left' };

                                        ws.mergeCells(2, 3, 2, 6);
                                        const instCell2 = ws.getCell('C2');
                                        instCell2.value = 'SUPERINTENDÊNCIA DE OBRAS PÚBLICAS';
                                        instCell2.font = { name: 'Montserrat', bold: true, size: 11, color: { argb: 'FF' + COR_VERDE_DARK } };
                                        instCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_VERDE_CLARO } };
                                        instCell2.alignment = { vertical: 'middle', horizontal: 'left' };

                                        // Células G1-K2  Título do relatório
                                        ws.mergeCells(1, 7, 2, totalCols);
                                        const tituloCell = ws.getCell('G1');
                                        tituloCell.value = 'RELATÓRIO DE PROCESSOS  GECOPE';
                                        tituloCell.font = { name: 'Montserrat', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
                                        tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_VERDE } };
                                        tituloCell.alignment = { vertical: 'middle', horizontal: 'center' };
                                        tituloCell.border = {
                                            top: { style: 'medium', color: { argb: 'FF' + COR_VERDE_DARK } },
                                            right: { style: 'medium', color: { argb: 'FF' + COR_VERDE_DARK } },
                                            bottom: { style: 'medium', color: { argb: 'FF' + COR_VERDE_DARK } },
                                        };

                                        // Alturas do bloco de cabeçalho institucional (Título com altura de 22 conforme pedido)
                                        ws.getRow(1).height = 22;
                                        ws.getRow(2).height = 22;

                                        // 
                                        // LINHA 3  METADADOS
                                        // 
                                        ws.mergeCells(3, 1, 3, 4);
                                        const metaDataCell = ws.getCell('A3');
                                        metaDataCell.value = `Exportado em: ${dateExport}`;
                                        metaDataCell.font = { name: 'Montserrat', italic: true, size: 9, color: { argb: 'FF555555' } };
                                        metaDataCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_META_BG } };
                                        metaDataCell.alignment = { vertical: 'middle', horizontal: 'left' };

                                        ws.mergeCells(3, 5, 3, 7);
                                        const metaUserCell = ws.getCell('E3');
                                        metaUserCell.value = `Usuário: ${userName}`;
                                        metaUserCell.font = { name: 'Montserrat', italic: true, size: 9, color: { argb: 'FF555555' } };
                                        metaUserCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_META_BG } };
                                        metaUserCell.alignment = { vertical: 'middle', horizontal: 'left' };

                                        ws.mergeCells(3, 8, 3, totalCols);
                                        const metaFiltCell = ws.getCell('H3');
                                        metaFiltCell.value = `Filtros: ${filtrosStr}`;
                                        metaFiltCell.font = { name: 'Montserrat', italic: true, size: 9, color: { argb: 'FF555555' } };
                                        metaFiltCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_META_BG } };
                                        metaFiltCell.alignment = { vertical: 'middle', horizontal: 'left' };

                                        ws.getRow(3).height = Math.max(ROW_MIN_H, 16);

                                        // 
                                        // LINHA 4  CONTADOR DE REGISTROS
                                        // 
                                        ws.mergeCells(4, 1, 4, totalCols);
                                        const countCell = ws.getCell('A4');
                                        countCell.value = `Total de registros exportados: ${rows.length}`;
                                        countCell.font = { name: 'Montserrat', bold: true, size: 10, color: { argb: 'FF' + COR_VERDE_DARK } };
                                        countCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FFF4' } };
                                        countCell.alignment = { vertical: 'middle', horizontal: 'center' };
                                        ws.getRow(4).height = Math.max(ROW_MIN_H, 16);

                                        // 
                                        // LINHA 5  CABEALHO DA TABELA
                                        // 
                                        const TABLE_HEADER_ROW = 5;
                                        const headerRow = ws.getRow(TABLE_HEADER_ROW);
                                        headerRow.height = Math.max(ROW_MIN_H, 22);

                                        colConfig.forEach((c, i) => {
                                            const cell = headerRow.getCell(i + 1);
                                            cell.value = c.header;
                                            cell.font = { name: 'Montserrat', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
                                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_HEADER_BG } };
                                            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                                            cell.border = {
                                                top: { style: 'medium', color: { argb: 'FFFFFFFF' } },
                                                bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
                                                left: { style: 'thin', color: { argb: 'FF2E7D32' } },
                                                right: { style: 'thin', color: { argb: 'FF2E7D32' } },
                                            };
                                        });

                                        // 
                                        // LINHAS DE DADOS
                                        // 
                                        rows.forEach((d, idx) => {
                                            const metaSt = getMetaSt(d);
                                            const metaDate = getMetaDate(d)?.toLocaleDateString('pt-BR') || '';
                                            const abert = dateParaInput(d.dataAbertura);
                                            const dias = (d.dataAbertura instanceof Date)
                                                ? Math.floor((new Date() - d.dataAbertura) / (1000 * 60 * 60 * 24))
                                                : null;

                                            const rowNum = TABLE_HEADER_ROW + 1 + idx;
                                            const dataRow = ws.getRow(rowNum);

                                            // Ajuste Dinâmico de Altura para Legibilidade (Folga na Altura)
                                            const descText = d.descricao || '';
                                            const numLines = Math.max(1, Math.ceil(descText.length / 75), (descText.match(/\n/g) || []).length + 1);
                                            if (numLines > 1) {
                                                dataRow.height = (numLines * 15) + 12; // Folga proporcional
                                            } else {
                                                dataRow.height = 22; // Altura padrão com folga
                                            }

                                            const cellsData = [
                                                { v: isPrioritario(d) ? 'Sim' : 'Não', hz: 'center', bold: isPrioritario(d) },
                                                { v: String(d.processo || ''), hz: 'center', bold: true, font: 9.5 },
                                                { v: metaSt, hz: 'center' },
                                                { v: metaDate, hz: 'center' },
                                                { v: formatStatusDisplay(d.status) || '', hz: 'left' },
                                                { v: d.analista || '', hz: 'center' },
                                                { v: abert, hz: 'center' },
                                                { v: dias, hz: 'center' },
                                                { v: d.contratante || '', hz: 'center' },
                                                { v: d.contratada || '', hz: 'left' },
                                                { v: d.descricao || '', hz: 'justify' },
                                            ];

                                            cellsData.forEach((cd, ci) => {
                                                const cell = dataRow.getCell(ci + 1);
                                                cell.value = (cd.v !== null && cd.v !== '') ? cd.v : '';
                                                cell.font = {
                                                    name: 'Montserrat',
                                                    size: cd.font || 9,
                                                    bold: cd.bold || false,
                                                    color: { argb: 'FF222222' }
                                                };
                                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                                                cell.alignment = {
                                                    vertical: 'middle',
                                                    horizontal: cd.hz || 'left',
                                                    wrapText: true  // Permitir ajuste na altura
                                                };
                                                cell.border = {
                                                    top: { style: 'hair', color: { argb: 'FFDDDDDD' } },
                                                    bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } },
                                                    left: { style: 'hair', color: { argb: 'FFDDDDDD' } },
                                                    right: { style: 'hair', color: { argb: 'FFDDDDDD' } },
                                                };
                                                if (ci === 7 && typeof cd.v === 'number') { cell.numFmt = '0'; }
                                                if (ci === 1) { cell.value = String(cd.v); cell.numFmt = '@'; }
                                            });

                                            // Prioritário: apenas realça o texto da célula "Sim" em verde
                                            if (isPrioritario(d)) {
                                                dataRow.getCell(1).font = { name: 'Montserrat', bold: true, size: 9, color: { argb: 'FF008F3D' } };
                                            }
                                        });

                                        // 
                                        // FREEZE PANES  congelar até linha 5 (cabeçalho)
                                        // 
                                        ws.views = [{
                                            state: 'frozen',
                                            xSplit: 0,
                                            ySplit: TABLE_HEADER_ROW,
                                            topLeftCell: `A${TABLE_HEADER_ROW + 1}`,
                                            activeCell: 'A6'
                                        }];

                                        // 
                                        // AUTOFILTER na linha do cabeçalho da tabela
                                        // 
                                        ws.autoFilter = {
                                            from: { row: TABLE_HEADER_ROW, column: 1 },
                                            to: { row: TABLE_HEADER_ROW, column: totalCols }
                                        };

                                        // 
                                        // GERAR E BAIXAR ARQUIVO
                                        // 
                                        const dateStr = now.toISOString().split('T')[0];
                                        const hh = String(now.getHours()).padStart(2, '0');
                                        const mm = String(now.getMinutes()).padStart(2, '0');
                                        const fileName = `Processos_GECOPE_${dateStr}_${hh}${mm}.xlsx`;

                                        const buffer = await workbook.xlsx.writeBuffer();
                                        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = fileName;
                                        document.body.appendChild(a);
                                        a.click();
                                        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800); // Reduced cleanup delay

                                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-file-earmark-excel"></i> Exportar'; }
                                        // Feedback discreto (sem alert que interrompe)
                                        btn && (btn.innerHTML = '<i class="bi bi-check-lg text-success"></i> Exportado!');
                                        setTimeout(() => { if (btn) btn.innerHTML = '<i class="bi bi-file-earmark-excel"></i> Exportar'; }, 2000); // Reduced feedback time

                                    } catch (err) {
                                        console.error("Erro na exportação ExcelJS:", err);
                                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-file-earmark-excel"></i> Excel'; }
                                        alert(" Ocorreu um erro ao gerar a planilha. Verifique o console para detalhes.");
                                    }
                                }

                                async function exportarProcessosPDF() {
                                    const rows = window.currentVisibleRows || [];
                                    if (rows.length === 0) {
                                        alert("Nenhum dado visível para exportar.");
                                        return;
                                    }

                                    if (typeof jspdf === 'undefined') {
                                        alert("Biblioteca jsPDF não carregada ainda.");
                                        return;
                                    }

                                    const btn = document.getElementById('btn-reuniao-pdf');
                                    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>...'; }

                                    try {
                                        const { jsPDF } = window.jspdf;
                                        const doc = new jsPDF('l', 'mm', 'a4'); // Paisagem

                                        // Título e Metadados
                                        const now = new Date();
                                        const dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');

                                        doc.setFontSize(16);
                                        doc.setTextColor(0, 143, 61); // Verde SOP
                                        doc.text('RELATÓRIO DE PROCESSOS - GECOPE', 14, 15);

                                        doc.setFontSize(10);
                                        doc.setTextColor(100);
                                        doc.text(`Exportado em: ${dateStr}`, 14, 22);
                                        doc.text(`Total de registros: ${rows.length}`, 14, 27);

                                        const tableData = rows.map(d => [
                                            isPrioritario(d) ? 'SIM' : 'NÃO',
                                            d.processo || '-',
                                            getMetaSt(d),
                                            getMetaDate(d)?.toLocaleDateString('pt-BR') || '-',
                                            formatStatusDisplay(d.status) || '-',
                                            d.analista || '-',
                                            d.dataAbertura instanceof Date ? d.dataAbertura.toLocaleDateString('pt-BR') : '-',
                                            d.dataAbertura instanceof Date ? Math.floor((new Date() - d.dataAbertura) / (1000 * 60 * 60 * 24)) : '-',
                                            d.contratante || '-',
                                            d.contratada || '-',
                                            d.descricao || '-'
                                        ]);

                                        doc.autoTable({
                                            startY: 32,
                                            head: [['Prior.', 'Processo', 'Meta', 'Data Meta', 'Status', 'Analista', 'Abertura', 'Dias', 'Contratante', 'Contratada', 'Descrição']],
                                            body: tableData,
                                            theme: 'grid',
                                            headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 8 },
                                            styles: { fontSize: 7, cellPadding: 1, overflow: 'linebreak' },
                                            columnStyles: {
                                                0: { cellWidth: 10 },
                                                1: { cellWidth: 25 },
                                                4: { cellWidth: 35 },
                                                10: { cellWidth: 'auto' }
                                            },
                                            margin: { left: 10, right: 10 }
                                        });

                                        const fileName = `Processos_GECOPE_${now.toISOString().split('T')[0]}.pdf`;
                                        doc.save(fileName);

                                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> PDF'; }
                                    } catch (err) {
                                        console.error("Erro na exportação PDF:", err);
                                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> PDF'; }
                                        alert("Erro ao gerar PDF.");
                                    }
                                }

                                function exportarComposicao(formato) {
                                    if (!compositionDataToExport) return;
                                    const meta = compositionDataToExport.meta || {};
                                    const dados = {
                                        codigo: meta.codigo || 'S/C', descricao: meta.descricao, unidade: meta.unidade, data_base: meta.data_base,
                                        bdi: meta.bdi, desconto: meta.desconto, itens: compositionDataToExport.itens || [], totais: meta.totais
                                    };
                                    if (formato === 'PDF') gerarPDF_Profissional(dados);
                                    else if (formato === 'DOCX') gerarDOCX_Profissional(dados);
                                    bootstrap.Modal.getInstance(document.getElementById('modalExportarComposicao')).hide();
                                }                       