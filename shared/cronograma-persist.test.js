// Testes de shared/cronograma-persist.js (revisão técnica 08/10/2026, #1).
// Rodar: node --test shared/cronograma-persist.test.js   (sem dependências; Supabase simulado).
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPersistencia } = require('./cronograma-persist');

// Supabase simulado: tabelas em memória, teto de linhas por resposta (max-rows) e falhas injetáveis.
function fakeSb({ tabelas = {}, maxRows = 1000, falhar = {} } = {}) {
  const dados = {};
  Object.keys(tabelas).forEach(n => { dados[n] = tabelas[n].map(r => ({ ...r })); });
  const log = [];
  const sb = {
    dados, log,
    from(nome) {
      return {
        select() {
          let ordem = [];
          const q = {
            order(col) { ordem.push(col); return q; },
            async range(de, ate) {
              log.push(['select', nome, de, ate]);
              if (falhar.select === nome) return { error: new Error('select falhou') };
              const todas = [...dados[nome]].sort((a, b) => String(a.id).localeCompare(String(b.id)));
              const pedaco = todas.slice(de, ate + 1).slice(0, maxRows);
              return { data: pedaco.map(r => ({ ...r })), count: todas.length, error: null };
            },
          };
          return q;
        },
        async upsert(lote) {
          log.push(['upsert', nome, lote.map(r => r.id)]);
          if (falhar.upsert === nome) return { error: new Error('upsert falhou') };
          if (falhar.fk && lote.some(r => r.id === falhar.fk)) return { error: Object.assign(new Error('fk'), { code: '23503' }) };
          if (falhar.generica && lote.some(r => r.id === falhar.generica)) return { error: new Error('erro generico') };
          lote.forEach(r => {
            const i = dados[nome].findIndex(x => x.id === r.id);
            if (i >= 0) dados[nome][i] = { ...dados[nome][i], ...r }; else dados[nome].push({ ...r });
          });
          return { error: null };
        },
        delete() {
          return {
            async in(_col, ids) {
              log.push(['delete', nome, [...ids]]);
              if (falhar.delete === nome) return { error: new Error('delete falhou') };
              dados[nome] = dados[nome].filter(r => !ids.includes(r.id));
              return { error: null };
            },
          };
        },
      };
    },
  };
  return sb;
}

// Modelo mínimo: objetos {id, nome} em memória <-> linhas.
function montar(sb, listas, ganchos = {}) {
  const t = nome => ({
    nome, ordem: ['id'],
    obter: () => listas[nome],
    paraLinha: o => ({ id: o.id, nome: o.nome }),
    deLinha: r => ({ id: r.id, nome: r.nome }),
  });
  const tabelas = [t('analistas'), t('tarefas')];
  const p = criarPersistencia({ sb, tabelas, ...ganchos });
  return p;
}

const sempre = (n, prefixo) => Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${String(i).padStart(5, '0')}`, nome: `n${i}` }));
const escritas = sb => sb.log.filter(e => e[0] !== 'select');

test('carregar lê além de 1000 linhas', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(2500, 't') }, maxRows: 1000 });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  const r = await p.carregar();
  assert.equal(r.tarefas.length, 2500);
  assert.equal(new Set(r.tarefas.map(x => x.id)).size, 2500);
});

test('carregar não perde linhas se o servidor limitar abaixo da página pedida', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(450, 't') }, maxRows: 100 });
  const p = montar(sb, { analistas: [], tarefas: [] });
  const r = await p.carregar();
  assert.equal(r.tarefas.length, 450);
});

test('carregar devolve null se uma leitura falhar', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: [] }, falhar: { select: 'tarefas' } });
  const p = montar(sb, { analistas: [], tarefas: [] });
  assert.equal(await p.carregar(), null);
});

test('sem alterações, salvar não escreve nada', async () => {
  const sb = fakeSb({ tabelas: { analistas: sempre(2, 'a'), tarefas: sempre(3, 't') } });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  const r = await p.carregar();
  listas.analistas = r.analistas; listas.tarefas = r.tarefas;
  sb.log.length = 0;
  const s = await p.salvar();
  assert.equal(s.ok, true);
  assert.deepEqual(escritas(sb), []);
});

test('grava só o que mudou e apaga só o que esta sessão removeu', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(3, 't') } });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  const r = await p.carregar();
  listas.tarefas = r.tarefas;
  listas.tarefas[0].nome = 'editada';                    // alterada
  listas.tarefas.push({ id: 'nova', nome: 'nova' });     // criada
  listas.tarefas = listas.tarefas.filter(t => t.id !== 't00002'); // removida
  sb.log.length = 0;
  const s = await p.salvar();
  assert.equal(s.ok, true);
  assert.deepEqual(escritas(sb), [
    ['upsert', 'tarefas', ['t00000', 'nova']],
    ['delete', 'tarefas', ['t00002']],
  ]);
  assert.deepEqual(sb.dados.tarefas.map(t => t.id).sort(), ['nova', 't00000', 't00001']);
});

test('linha criada por outra pessoa depois do carregamento sobrevive à gravação', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(2, 't') } });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  listas.tarefas = (await p.carregar()).tarefas;
  sb.dados.tarefas.push({ id: 'da-outra-pessoa', nome: 'x' });   // outra aba/usuário
  listas.tarefas[0].nome = 'minha edição';
  await p.salvar();
  assert.ok(sb.dados.tarefas.some(t => t.id === 'da-outra-pessoa'));
  assert.equal(sb.dados.tarefas.find(t => t.id === 't00000').nome, 'minha edição');
});

test('falha ao gravar: avisa a interface e o banco fica intacto (nada é apagado)', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(1, 't') }, falhar: { upsert: 'tarefas' } });
  const listas = { analistas: [], tarefas: [] };
  const avisos = [];
  const p = montar(sb, listas, { aoFalhar: e => avisos.push(['falhou', e.length]) });
  listas.tarefas = (await p.carregar()).tarefas;
  listas.tarefas[0].nome = 'mudou';
  const s1 = await p.salvar();
  assert.equal(s1.ok, false);
  assert.equal(sb.dados.tarefas.length, 1);
  assert.equal(sb.dados.tarefas[0].nome, 'n0');
  assert.deepEqual(avisos, [['falhou', 1]]);
  assert.equal(escritas(sb).some(e => e[0] === 'delete'), false);
});

test('retrato só avança no que foi confirmado: reenvia na gravação seguinte', async () => {
  const falhar = { upsert: 'tarefas' };
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(1, 't') }, falhar });
  const listas = { analistas: [], tarefas: [] };
  const avisos = [];
  const p = montar(sb, listas, { aoFalhar: () => avisos.push('falhou'), aoRecuperar: () => avisos.push('ok') });
  listas.tarefas = (await p.carregar()).tarefas;
  listas.tarefas[0].nome = 'mudou';
  assert.equal((await p.salvar()).ok, false);
  delete falhar.upsert;                                   // a rede/RLS voltou
  assert.equal((await p.salvar()).ok, true);
  assert.equal(sb.dados.tarefas[0].nome, 'mudou');
  assert.deepEqual(avisos, ['falhou', 'ok']);
});

test('falha ao apagar não desfaz o resto e é reenviada depois', async () => {
  const falhar = { delete: 'tarefas' };
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(2, 't') }, falhar });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  listas.tarefas = (await p.carregar()).tarefas;
  listas.tarefas = listas.tarefas.filter(t => t.id !== 't00001');
  assert.equal((await p.salvar()).ok, false);
  assert.equal(sb.dados.tarefas.length, 2);
  delete falhar.delete;
  assert.equal((await p.salvar()).ok, true);
  assert.deepEqual(sb.dados.tarefas.map(t => t.id), ['t00000']);
});

test('pais são gravados antes dos filhos e apagados depois', async () => {
  const sb = fakeSb({ tabelas: { analistas: [{ id: 'a1', nome: 'A' }], tarefas: [{ id: 't1', nome: 'T' }] } });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  const r = await p.carregar();
  listas.analistas = r.analistas; listas.tarefas = r.tarefas;
  listas.analistas[0].nome = 'A2'; listas.tarefas[0].nome = 'T2';
  sb.log.length = 0;
  await p.salvar();
  assert.deepEqual(escritas(sb).map(e => e[1]), ['analistas', 'tarefas']);
  listas.analistas = []; listas.tarefas = [];
  sb.log.length = 0;
  await p.salvar();
  assert.deepEqual(escritas(sb).map(e => e[1]), ['tarefas', 'analistas']);
});

test('base vazia: primeira gravação insere tudo', async () => {
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: [] } });
  const listas = { analistas: [{ id: 'a', nome: 'A' }], tarefas: [] };
  const p = montar(sb, listas);
  await p.carregar();
  listas.analistas = [{ id: 'a', nome: 'A' }];
  assert.equal((await p.salvar()).ok, true);
  assert.equal(sb.dados.analistas.length, 1);
});

test('linha com FK violada não derruba as outras e não prende o aviso', async () => {
  const falhar = { fk: 'orfa' };
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(2, 't') }, falhar });
  const listas = { analistas: [], tarefas: [] };
  const eventos = [];
  const p = montar(sb, listas, {
    aoFalhar: () => eventos.push('falhou'), aoRecuperar: () => eventos.push('ok'),
    aoDescartar: d => eventos.push(['descartada', d.map(x => x.id)]),
  });
  listas.tarefas = (await p.carregar()).tarefas;
  listas.tarefas[0].nome = 'boa';
  listas.tarefas.push({ id: 'orfa', nome: 'dono removido' });
  const s1 = await p.salvar();
  assert.equal(s1.ok, true);                                   // nada ficou "falhando"
  assert.equal(sb.dados.tarefas.find(t => t.id === 't00000').nome, 'boa'); // a boa foi gravada
  assert.ok(!sb.dados.tarefas.some(t => t.id === 'orfa'));
  assert.deepEqual(eventos, [['descartada', ['orfa']], 'ok']);
  sb.log.length = 0;
  await p.salvar();                                            // não tenta de novo a descartada
  assert.deepEqual(escritas(sb), []);
});

test('erro genérico em uma linha: as outras do lote são gravadas e só ela fica pendente', async () => {
  const falhar = { generica: 'ruim' };
  const sb = fakeSb({ tabelas: { analistas: [], tarefas: sempre(2, 't') }, falhar });
  const listas = { analistas: [], tarefas: [] };
  const p = montar(sb, listas);
  listas.tarefas = (await p.carregar()).tarefas;
  listas.tarefas[0].nome = 'boa';
  listas.tarefas.push({ id: 'ruim', nome: 'x' });
  const s1 = await p.salvar();
  assert.equal(s1.ok, false);
  assert.equal(s1.erros.length, 1);
  assert.equal(s1.erros[0].id, 'ruim');
  assert.equal(sb.dados.tarefas.find(t => t.id === 't00000').nome, 'boa');
  delete falhar.generica;
  assert.equal((await p.salvar()).ok, true);                   // a pendente é reenviada
  assert.ok(sb.dados.tarefas.some(t => t.id === 'ruim'));
});
