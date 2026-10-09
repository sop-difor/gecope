// shared/cronograma-persist.js — persistência do Cronograma (cronograma.html) no Supabase.
//
// Revisão técnica 08/10/2026 (docs/code-review/REVIEW.md, #1). Antes, cada salvarDados()
// APAGAVA as três tabelas inteiras e reinserisa o estado da memória. Consequências:
//  - duas pessoas com a página aberta: quem salvava por último apagava o trabalho da outra;
//  - se um insert falhava depois do delete (rede, RLS, aba fechada), os dados sumiam de vez, e
//    os erros só iam para o console;
//  - a leitura não paginava: com mais de 1000 linhas o banco devolvia só 1000 e a gravação
//    seguinte apagava o excedente.
// Agora: a leitura é paginada e guarda um "retrato" (id -> linha) do que está no banco; a
// gravação envia só o que mudou em relação a esse retrato (upsert) e apaga só os ids que ESTA
// sessão removeu. Linhas criadas por outras pessoas nunca são tocadas. O retrato só avança
// para o que o banco confirmou, então uma falha é tentada de novo na próxima gravação.
(function (root) {
  'use strict';

  const PAGINA = 1000;
  const LOTE_UPSERT = 500;
  const LOTE_DELETE = 200;

  function pedacos(lista, tamanho) {
    const out = [];
    for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
    return out;
  }

  // tabelas: [{ nome, ordem: [colunas], obter: () => [objetos em memória], paraLinha, deLinha }]
  //   A ORDEM da lista importa: pais antes dos filhos (analistas, tarefas, rotinas). Os upserts
  //   seguem essa ordem e os deletes a ordem inversa, por causa das chaves estrangeiras.
  // aoFalhar(erros) / aoRecuperar(): avisam a interface (banner), sem depender de DOM aqui.
  // aoDescartar(linhas): linhas que não puderam ser gravadas porque o analista dono foi removido
  //   por outra pessoa (FK); não são reenviadas.
  function criarPersistencia({ sb, tabelas, aoFalhar = () => {}, aoRecuperar = () => {}, aoDescartar = () => {} }) {
    const retrato = new Map(tabelas.map(t => [t.nome, new Map()])); // nome -> (id -> JSON da linha)

    async function lerTabela(t) {
      const linhas = [];
      let total = Infinity;
      while (linhas.length < total) {
        let q = sb.from(t.nome).select('*', { count: 'exact' });
        for (const col of t.ordem) q = q.order(col, { ascending: true });
        const de = linhas.length; // avança pelo que VEIO, não pelo que foi pedido: se o
                                  // servidor limitar (max-rows) abaixo de PAGINA, nada se perde
        const { data, error, count } = await q.range(de, de + PAGINA - 1);
        if (error) return { error };
        if (typeof count === 'number') total = count;
        if (!data || data.length === 0) break;
        linhas.push(...data);
        if (typeof count !== 'number' && data.length < PAGINA) break; // sem contagem: página curta = fim
      }
      return { linhas };
    }

    // Lê as três tabelas completas e registra o retrato. Devolve { [nome]: [objetos] } ou null
    // se qualquer leitura falhar (quem chama NÃO deve prosseguir com dados parciais).
    async function carregar() {
      const lidas = await Promise.all(tabelas.map(lerTabela));
      const falha = lidas.find(r => r.error);
      if (falha) {
        console.error('[Cronograma/Supabase] Erro ao carregar dados:', falha.error);
        return null;
      }
      const out = {};
      tabelas.forEach((t, i) => {
        const objetos = lidas[i].linhas.map(t.deLinha);
        out[t.nome] = objetos;
        const mapa = new Map();
        objetos.forEach(o => { const l = t.paraLinha(o); mapa.set(l.id, JSON.stringify(l)); });
        retrato.set(t.nome, mapa);
      });
      return out;
    }

    // Calcula o que mudou desde o retrato.
    function diferencas(t) {
      const antigo = retrato.get(t.nome);
      const atuais = new Map();
      t.obter().forEach(o => { const l = t.paraLinha(o); atuais.set(l.id, l); });
      const alterar = [];
      atuais.forEach((linha, id) => {
        if (antigo.get(id) !== JSON.stringify(linha)) alterar.push(linha);
      });
      const remover = [];
      antigo.forEach((_, id) => { if (!atuais.has(id)) remover.push(id); });
      return { alterar, remover };
    }

    // Grava só as diferenças. Devolve { ok, erros }. Nunca lança.
    async function salvar() {
      const erros = [];
      const planos = tabelas.map(t => ({ t, ...diferencas(t) }));

      const descartadas = [];
      for (const { t, alterar } of planos) {
        const mapa = retrato.get(t.nome);
        for (const lote of pedacos(alterar, LOTE_UPSERT)) {
          const { error } = await sb.from(t.nome).upsert(lote, { onConflict: 'id' });
          if (!error) { lote.forEach(l => mapa.set(l.id, JSON.stringify(l))); continue; }
          // Uma linha ruim derrubava o lote inteiro (até 500 linhas boas junto). Reenvia uma a
          // uma para isolar a culpada.
          for (const linha of lote) {
            const r = await sb.from(t.nome).upsert([linha], { onConflict: 'id' });
            if (!r.error) { mapa.set(linha.id, JSON.stringify(linha)); continue; }
            if (r.error.code === '23503') {
              // Violação de chave estrangeira: o analista dono desta linha foi removido por outra
              // pessoa depois que esta sessão carregou. A linha nunca vai conseguir ser gravada;
              // sem tratar, toda gravação seguinte falharia de novo e o aviso ficaria preso até
              // recarregar. Dá a linha como "resolvida" (não será reenviada) e avisa a pessoa.
              mapa.set(linha.id, JSON.stringify(linha));
              descartadas.push({ tabela: t.nome, id: linha.id });
            } else {
              erros.push({ tabela: t.nome, acao: 'gravar', id: linha.id, error: r.error });
            }
          }
        }
      }
      for (const { t, remover } of [...planos].reverse()) {
        for (const lote of pedacos(remover, LOTE_DELETE)) {
          const { error } = await sb.from(t.nome).delete().in('id', lote);
          if (error) { erros.push({ tabela: t.nome, acao: 'apagar', error }); continue; }
          const mapa = retrato.get(t.nome);
          lote.forEach(id => mapa.delete(id));
        }
      }

      if (descartadas.length) {
        console.warn('[Cronograma/Supabase] Linhas não gravadas (dono removido por outra pessoa):', descartadas);
        aoDescartar(descartadas);
      }
      if (erros.length) {
        console.error('[Cronograma/Supabase] Falha ao salvar:', erros);
        aoFalhar(erros);
      } else {
        aoRecuperar();
      }
      return { ok: erros.length === 0, erros, descartadas };
    }

    return { carregar, salvar };
  }

  const api = { criarPersistencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CronogramaPersist = api;
})(typeof window !== 'undefined' ? window : globalThis);
