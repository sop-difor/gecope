// Teste de lerTodasAsLinhas (utils.js) — revisão técnica 08/10/2026, #8.
// Rodar: node --test utils.test.js   (sem dependências; carrega utils.js num contexto isolado).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const janela = { addEventListener() {}, document: { addEventListener() {}, createElement: () => ({}) } };
vm.runInNewContext(fs.readFileSync(__dirname + '/utils.js', 'utf8'), { window: janela, document: janela.document, console });
const { lerTodasAsLinhas } = janela;

// Tabela simulada com teto de linhas por resposta (max-rows) e contagem exata opcional.
function consulta(total, { maxRows = 1000, comContagem = true, erroNaPagina = null } = {}) {
  const todas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pedidos = [];
  const montar = () => ({
    async range(de, ate) {
      pedidos.push([de, ate]);
      if (erroNaPagina !== null && pedidos.length === erroNaPagina) return { data: null, error: new Error('falhou') };
      const data = todas.slice(de, ate + 1).slice(0, maxRows);
      return comContagem ? { data, error: null, count: total } : { data, error: null };
    },
  });
  return { montar, pedidos };
}

test('lê mais de 1000 linhas', async () => {
  const c = consulta(2500);
  const r = await lerTodasAsLinhas(c.montar);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 2500);
  assert.equal(new Set(r.data.map(x => x.id)).size, 2500);
});

test('tabela vazia e tabela de exatamente uma página', async () => {
  assert.equal((await lerTodasAsLinhas(consulta(0).montar)).data.length, 0);
  const c = consulta(1000);
  assert.equal((await lerTodasAsLinhas(c.montar)).data.length, 1000);
  assert.equal(c.pedidos.length, 1); // a contagem evita um pedido extra só para descobrir o fim
});

test('max-rows do servidor menor que a página não perde linhas', async () => {
  const r = await lerTodasAsLinhas(consulta(450, { maxRows: 100 }).montar);
  assert.equal(r.data.length, 450);
});

test('sem contagem, página curta encerra', async () => {
  const r = await lerTodasAsLinhas(consulta(1500, { comContagem: false }).montar);
  assert.equal(r.data.length, 1500);
});

test('erro em qualquer página devolve error e nenhum dado parcial', async () => {
  const r = await lerTodasAsLinhas(consulta(2500, { erroNaPagina: 2 }).montar);
  assert.ok(r.error);
  assert.equal(r.data, null);
});
