function formatMonthYearInput(input) {
                                                                            let v = input.value.replace(/\D/g, ''); // Remove tudo que não for número
                                                                            if (v.length > 6) v = v.slice(0, 6); // Limite de 6 dígitos no máximo (MMYYYY)
                                                                            if (v.length >= 3) {
                                                                                input.value = v.slice(0, 2) + '/' + v.slice(2);
                                                                            } else {
                                                                                input.value = v;
                                                                            }
                                                                        }

                                                                        async function buscarIndicesAutomatico() {
                                                                            const dataIni = document.getElementById('mercado-data-ini').value.trim();
                                                                            const dataFin = document.getElementById('mercado-data-fin').value.trim();

                                                                            if (!dataIni || !dataFin) {
                                                                                alert("Por favor, preencha as datas 'Data Cotação' e 'Data-Base Orç.' (formato MM/AAAA) antes de buscar os índices.");
                                                                                return;
                                                                            }

                                                                            const parseMesAnoStr = (str) => {
                                                                                const parts = str.split('/');
                                                                                // Lida com DD/MM/AAAA ou MM/AAAA
                                                                                if (parts.length === 3) {
                                                                                    return { mes: parseInt(parts[1], 10), ano: parseInt(parts[2], 10) };
                                                                                } else if (parts.length === 2) {
                                                                                    return { mes: parseInt(parts[0], 10), ano: parseInt(parts[1], 10) };
                                                                                }
                                                                                return null;
                                                                            };

                                                                            const dIni = parseMesAnoStr(dataIni);
                                                                            const dFin = parseMesAnoStr(dataFin);

                                                                            if (!dIni || !dFin || isNaN(dIni.mes) || isNaN(dIni.ano)) {
                                                                                alert("Formato de data inválido. Utilize o formato MM/AAAA.");
                                                                                return;
                                                                            }

                                                                            const btn = document.getElementById('btn-buscar-incc');
                                                                            const oldHtml = btn.innerHTML;
                                                                            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Buscando...';
                                                                            btn.disabled = true;

                                                                            try {
                                                                                // For some clients the built-in `functions.invoke` was generating requests
                                                                                // against the main project URL and receiving 401 before the function even ran.
                                                                                // To be sure we hit the correct endpoint with proper headers we do a manual fetch
                                                                                // against the dedicated .functions subdomain and send the anon key explicitly.
                                                                                const fetchIndexFromEdge = async (mes, ano) => {
                                                                                    const reqBody = { mes, ano };
                                                                                    const resp = await fetch('https://qexdnxqmiaarzwwwrcor.functions.supabase.co/get-economic-indices', {
                                                                                        method: 'POST',
                                                                                        headers: {
                                                                                            'Content-Type': 'application/json',
                                                                                            apikey: SUPABASE_KEY,
                                                                                            Authorization: `Bearer ${SUPABASE_KEY}`
                                                                                        },
                                                                                        body: JSON.stringify(reqBody)
                                                                                    });
                                                                                    if (!resp.ok) {
                                                                                        // 401/403 will surface here
                                                                                        throw new Error(`Edge function HTTP error: ${resp.status}`);
                                                                                    }
                                                                                    const data = await resp.json();
                                                                                    if (!data) {
                                                                                        throw new Error('Resposta vazia da função de índices.');
                                                                                    }
                                                                                    if (data.status === 'error') {
                                                                                        let msg = data.message || 'erro desconhecido';
                                                                                        if (data.details) msg += ` (${data.details})`;
                                                                                        throw new Error(msg);
                                                                                    }
                                                                                    // the API sometimes returns values with a comma decimal and
                                                                                    // dot thousands separator (e.g. "12.370,360"). normalize to
                                                                                    // a JS-friendly number string first.
                                                                                    let raw = data.valor_indice;
                                                                                    if (typeof raw === 'string') {
                                                                                        // remove dots (thousand separators) and replace comma by dot
                                                                                        raw = raw.replace(/\./g, '').replace(',', '.')
                                                                                    }
                                                                                    return raw;
                                                                                };

                                                                                const [indiceIni, indiceFin] = await Promise.all([
                                                                                    fetchIndexFromEdge(dIni.mes, dIni.ano),
                                                                                    fetchIndexFromEdge(dFin.mes, dFin.ano)
                                                                                ]);

                                                                                const formatarIndiceBR = (valor) => {
                                                                                    const num = parseFloat(valor);
                                                                                    const formatted = num.toFixed(3);
                                                                                    const [inteiro, decimais] = formatted.split('.');
                                                                                    const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                                                                                    return `${inteiroFormatado},${decimais}`;
                                                                                };
                                                                                const valIni = formatarIndiceBR(indiceIni);
                                                                                const valFin = formatarIndiceBR(indiceFin);
                                                                                document.getElementById('mercado-ind-ini').value = valIni;
                                                                                document.getElementById('mercado-ind-fin').value = valFin;
                                                                                console.log('[INCC] Valores normalizados e atribuídos:', { valIni, valFin });

                                                                                // Dispara recálculo do preço retroativo diretamente
                                                                                if (typeof window.calcularPrecoRetroativo === 'function') {
                                                                                    window.calcularPrecoRetroativo();
                                                                                }

                                                                                if (typeof window.calcularPrecoAdotado === 'function') {
                                                                                    window.calcularPrecoAdotado();
                                                                                }

                                                                                alert("Índices INCC-DI (FGV/Ipeadata) obtidos e aplicados com sucesso!");

                                                                            } catch (err) {
                                                                                console.error("[Erro ao automatizar INCC]", err);
                                                                                alert("Não foi possível automatizar. Motivo: " + (err.message || 'Erro de conexão/API.'));
                                                                            } finally {
                                                                                btn.innerHTML = oldHtml;
                                                                                btn.disabled = false;
                                                                            }
                                                                        }

