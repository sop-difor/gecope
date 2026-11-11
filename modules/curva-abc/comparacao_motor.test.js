// Testes do motor da comparação entre versões da Curva ABC (comparacao_motor.js).
// Rodar: node --test modules/curva-abc/comparacao_motor.test.js   (sem dependências)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const janela = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/comparacao_motor.js', 'utf8'), { window: janela });
const M = janela.ComparacaoMotor;

function item(conta, valor, extra) {
  return Object.assign({ conta, comp: 'C' + conta, desc: 'Serviço ' + conta, un: 'M2', valor, vReplan: valor,
    acrescQ: 10, classe: 'A', statusAnalise: 'pendente' }, extra || {});
}

test('apontamento sem alteração, com alteração e retirado', () => {
  const base = [
    item('1.1', 100, { statusAnalise: 'inconsistencia' }),
    item('1.2', 200, { statusAnalise: 'inconsistencia' }),
    item('1.3', 300, { statusAnalise: 'inconsistencia' })
  ];
  const atual = [item('1.1', 100), item('1.2', 150)];
  const r = M.comparar(base, atual);
  assert.equal(r.itens[0].situacao, 'apont_igual');
  assert.equal(r.itens[1].situacao, 'apont_alterado');
  assert.deepEqual(Array.from(r.itens[1].alterados).sort(), ['vReplan', 'valor']);
  assert.equal(r.retirados.length, 1);
  assert.equal(r.retirados[0].situacao, 'apont_retirado');
  assert.equal(r.resumo.apontamentosBase, 3);
});

test('OK que mudou, OK igual, pendente alterado e novo', () => {
  const base = [
    item('2.1', 100, { statusAnalise: 'ok' }),
    item('2.2', 100, { statusAnalise: 'ok' }),
    item('2.3', 100)
  ];
  const atual = [item('2.1', 120), item('2.2', 100), item('2.3', 90), item('2.9', 50)];
  const s = Array.from(M.comparar(base, atual).itens, x => x.situacao);
  assert.deepEqual(s, ['ok_alterado', 'igual', 'alterado', 'novo']);
});

test('vazio e zero contam como iguais; diferenças abaixo de 1 centavo também', () => {
  const base = [item('3.1', 100, { suprQ: null, vAcresc: 10.001 })];
  const atual = [item('3.1', 100, { suprQ: 0, vAcresc: 10.004 })];
  assert.equal(M.comparar(base, atual).itens[0].situacao, 'igual');
});

test('planilha renumerada: pareia por composição + descrição quando o par é único', () => {
  const base = [item('4.1', 100, { comp: 'C9', desc: 'Pintura acrílica', statusAnalise: 'inconsistencia' })];
  const atual = [item('7.3', 100, { comp: 'C9', desc: 'PINTURA  ACRÍLICA' })];
  const r = M.comparar(base, atual);
  assert.equal(r.itens[0].via, 'descricao');
  assert.equal(r.itens[0].situacao, 'apont_igual');
  assert.equal(r.retirados.length, 0);
});

test('composição + descrição repetida não pareia (ambíguo)', () => {
  const base = [item('5.1', 100, { comp: 'C1', desc: 'Igual' }), item('5.2', 100, { comp: 'C1', desc: 'Igual' })];
  const atual = [item('8.1', 100, { comp: 'C1', desc: 'Igual' })];
  const r = M.comparar(base, atual);
  assert.equal(r.itens[0].situacao, 'novo');
  assert.equal(r.retirados.length, 2);
});

test('mesma conta com descrição e classe diferentes é sinalizada', () => {
  const base = [item('6.1', 100, { desc: 'Alvenaria', classe: 'B' })];
  const atual = [item('6.1', 100, { desc: 'Reboco', classe: 'A' })];
  const x = M.comparar(base, atual).itens[0];
  assert.equal(x.descMudou, true);
  assert.equal(x.classeMudou, true);
});

test('totais do resumo usam o módulo do valor', () => {
  const r = M.comparar([item('1', -100), item('2', 50)], [item('1', -80)]);
  assert.equal(r.resumo.totalBase, 150);
  assert.equal(r.resumo.totalAtual, 80);
});

test('tendência: aumentou, diminuiu, alterado, igual e novo (pela qtd. replanilhada)', () => {
  const base = [
    item('1', 100, { replanQ: 100 }), item('2', 100, { replanQ: 100 }),
    item('3', 100, { replanQ: 100, acrescQ: 10 }), item('4', 100, { replanQ: 100 }),
    item('5', 100)                                    // planilha sem replanilhada: usa o valor
  ];
  const atual = [
    item('1', 100, { replanQ: 125 }), item('2', 100, { replanQ: 80 }),
    item('3', 100, { replanQ: 100, acrescQ: 30 }), item('4', 100, { replanQ: 100 }),
    item('5', 90), item('9', 50, { replanQ: 5 })
  ];
  const t = Array.from(M.comparar(base, atual).itens, r => M.tendencia(r));
  assert.deepEqual(t.map(x => x.tipo), ['aumentou', 'diminuiu', 'alterado', 'igual', 'diminuiu', 'novo']);
  assert.equal(t[0].pct, 25);
  assert.equal(t[1].pct, -20);
  assert.equal(t[2].pct, null);
  assert.equal(t[4].campo, 'valor');
  assert.equal(t[4].pct, -10);
});

test('curva por V. Acréscimo: tendência e preço unitário seguem o acréscimo (caso 10.4.2)', () => {
  const b = item('10.4.2', 44584.38, { qtdBase: 272.11, acrescQ: 716.33, replanQ: 988.44, vAcresc: 44584.38, vReplan: 61522 });
  const a = item('10.4.2', 40579.23, { qtdBase: 272.11, acrescQ: 651.98, replanQ: 924.09, vAcresc: 40579.23, vReplan: 57517 });
  const r = M.comparar([b], [a]).itens[0];
  assert.equal(M.parDaCurva(a).q, 'acrescQ');
  const t = M.tendencia(r);
  assert.equal(t.tipo, 'diminuiu');
  assert.equal(t.campo, 'acrescQ');
  assert.equal(Math.round(t.pct * 10) / 10, -9);
  assert.equal(M.precoUnitario(b, M.parDaCurva(b)), 62.24);
  assert.equal(M.precoUnitario(a, M.parDaCurva(a)), 62.24);
  assert.equal(M.precoUnitario(a, null), null);
});

test('filtro da tabela e OK em lote', () => {
  const base = [
    item('1', 100, { replanQ: 10, statusAnalise: 'ok' }),              // igual, OK na base -> lote
    item('2', 100, { replanQ: 10, statusAnalise: 'ok' }),              // igual, OK na base, já analisado aqui -> fora do lote
    item('3', 100, { replanQ: 10, statusAnalise: 'inconsistencia' }),  // apontamento sem ajuste
    item('4', 100, { replanQ: 10, statusAnalise: 'inconsistencia' }),  // apontamento com ajuste (aumentou)
    item('5', 100, { replanQ: 10 })                                    // pendente na base, igual -> fora do lote
  ];
  const atual = [
    item('1', 100, { replanQ: 10 }), item('2', 100, { replanQ: 10, statusAnalise: 'inconsistencia' }),
    item('3', 100, { replanQ: 10 }), item('4', 120, { replanQ: 12, vReplan: 120 }),
    item('5', 100, { replanQ: 10 }), item('9', 50, { replanQ: 5 })
  ];
  const itens = M.comparar(base, atual).itens;
  const contas = v => Array.from(itens.filter(r => M.filtrar(r, v)), r => r.atual.conta);
  assert.deepEqual(contas('apontados'), ['3', '4']);
  assert.deepEqual(contas('apont_igual'), ['3']);
  assert.deepEqual(contas('aumentou'), ['4']);
  assert.deepEqual(contas('novo'), ['9']);
  assert.deepEqual(contas('igual'), ['1', '2', '3', '5']);
  assert.deepEqual(contas('pendentes'), ['1', '3', '4', '5', '9']);
  assert.deepEqual(contas(''), ['1', '2', '3', '4', '5', '9']);          // sem filtro: todos
  assert.deepEqual(Array.from(itens.filter(M.okEmLote), r => r.atual.conta), ['1']);
  const ops = M.opcoesFiltro(itens);
  assert.ok(!ops.some(o => o.v === 'diminuiu'));                         // opção sem itens não aparece
  assert.equal(ops.find(o => o.v === 'apontados').n, 2);
});
