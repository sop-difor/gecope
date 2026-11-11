// Cadastro de analistas do GECOPE (fonte única: tabela public.cronograma_analistas).
//
// processos.analista guarda só a sigla (ex.: "W"); este módulo traduz sigla → nome e
// monta as listas de seleção. O cadastro é feito na aba Administração (seção
// "Analistas"), sem mexer no código — ver sql/add_sigla_cronograma_analistas.sql.
//
// Uso:
//   await GecopeAnalistas.carregar();          // 1 consulta por sessão (cache)
//   GecopeAnalistas.nome('W')                  // "Walace" (ou a própria sigla, se não cadastrada)
//   GecopeAnalistas.preencherSelect(el, 'W')   // opções ativas + a atual, mesmo se inativa
//   GecopeAnalistas.invalidar()                // força recarga (após editar na Administração)
(function () {
    let _lista = [];
    let _porSigla = new Map();
    let _promessa = null;

    function _indexar(linhas) {
        _lista = (linhas || [])
            .filter(a => a && a.sigla)
            .map(a => ({ id: a.id, nome: a.nome, sigla: String(a.sigla).toUpperCase(), ativo: a.ativo !== false }))
            .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
        _porSigla = new Map(_lista.map(a => [a.sigla, a]));
    }

    function carregar() {
        if (_promessa) return _promessa;
        _promessa = (async () => {
            try {
                const sb = window.sbClient;
                if (!sb) throw new Error('sbClient indisponível');
                const { data, error } = await sb.from('cronograma_analistas')
                    .select('id, nome, sigla, ativo')
                    .not('sigla', 'is', null);
                if (error) throw error;
                _indexar(data);
            } catch (e) {
                // Sem a lista, a tela mostra a sigla no lugar do nome — não trava Processos.
                console.error('[Analistas] Falha ao carregar cadastro:', e);
                _promessa = null;
            }
            return _lista;
        })();
        return _promessa;
    }

    function invalidar() { _promessa = null; }

    function nome(sigla) {
        if (!sigla) return sigla;
        const a = _porSigla.get(String(sigla).trim().toUpperCase());
        return a ? a.nome : sigla;
    }

    function existe(sigla) {
        return !!sigla && _porSigla.has(String(sigla).trim().toUpperCase());
    }

    function lista({ incluirInativos = false } = {}) {
        return _lista.filter(a => incluirInativos || a.ativo);
    }

    function preencherSelect(select, valorAtual) {
        if (!select) return;
        const atual = valorAtual !== undefined ? valorAtual : select.value;
        const opcoes = lista();
        // Processo antigo com analista desativado (ou sigla sem cadastro): mantém a opção
        // para o valor não sumir ao abrir e salvar o formulário.
        if (atual && !opcoes.some(a => a.sigla === atual)) {
            opcoes.push({ sigla: atual, nome: nome(atual) + (existe(atual) ? ' (inativo)' : '') });
        }
        const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        select.innerHTML = '<option value="">Selecione...</option>' +
            opcoes.map(a => `<option value="${esc(a.sigla)}">${esc(a.nome)}</option>`).join('');
        select.value = atual || '';
    }

    window.GecopeAnalistas = { carregar, invalidar, nome, existe, lista, preencherSelect };
})();
