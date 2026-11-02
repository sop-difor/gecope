// Testes do motor da Conferência Orçamentária (conferencia_motor.js).
// Rodar: node --test modules/curva-abc/conferencia_motor.test.js   (sem dependências)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const janela = {};
vm.runInNewContext(fs.readFileSync(__dirname + '/conferencia_motor.js', 'utf8'), { window: janela });
const M = janela.ConferenciaMotor;

// Orçamento aprovado no formato da matriz de replanilhamento.
const CAB_APR = ['', 'Conta', 'Comp.', 'Descrição', 'UN', 'Qtd.', 'Val.', 'Acresc.', 'Suprim.', 'Replan.'];
function aprovado(...servicos) {
  // servico: [conta, comp, desc, un, qtd, acresc, suprim, replan]
  return [CAB_APR, ['', '1', '', 'GRUPO SEM UNIDADE', '', 0, 0, null, null, null],
    ...servicos.map(s => ['', s[0], s[1], s[2], s[3], s[4], 0, s[5] ?? null, s[6] ?? null, s[7] ?? null])];
}
// Aba do orçamento revisado: cabeçalho com linhas de título antes, como na planilha real.
function revisada(...servicos) {
  return [['PLANILHA DE QUANTIDADES'], [], ['ITEM', 'CÓDIGO', 'FONTE', 'DESCRIÇÃO DO SERVIÇO', 'UND', 'QTD', 'CUSTO'],
    ['1', '', '', 'GRUPO', '', null, null],
    ...servicos.map(s => [s[0], s[1], 'SEINFRA', s[2], s[3], s[4], 1])];
}
const cruzar = (apr, ...abas) => {
  const a = M.lerAprovado(apr).itens;
  const r = abas.flatMap((aoa, i) => M.lerRevisado(aoa, i ? 'QUADRA' : 'SINTETICO').itens);
  return M.cruzar(a, r);
};
const porCodigo = (res, cod) => res.find(x => (x.fisc || x.rev[0]).codigo === cod);

test('quantidade final: Replan. se alterado, senão Qtd. (caso C0095 do contrato)', () => {
  const { itens } = M.lerAprovado(aprovado(
    ['3.3.2', 'C0095', 'APILOAMENTO', 'M2', 318.48, 436.56, null, 755.04],
    ['3.3.3', 'C0001', 'SEM ALTERACAO', 'M2', 10]));
  assert.equal(itens.length, 2, 'linha de grupo (sem UN) não é serviço');
  assert.equal(itens[0].qtd, 755.04);
  assert.equal(itens[0].alterado, true);
  assert.equal(itens[1].qtd, 10, 'serviço inalterado entra com a Qtd. do contrato');
  assert.equal(itens[1].alterado, false);
});

test('serviço novo (sem Qtd., só Replan.) e rascunho só com Acresc./Suprim.', () => {
  const { itens } = M.lerAprovado(aprovado(
    ['5.6.1', 'CXXXX', 'ESTACA BROCA', 'M', null, null, null, 834],
    ['5.6.2', 'C0002', 'RASCUNHO', 'M2', 100, 20, 5, null]));
  assert.equal(itens[0].qtd, 834);
  assert.equal(itens[1].qtd, 115);
});

test('compara pelo total após o aditivo: 100 aprovado × 80 revisado = acima, +25%', () => {
  const res = cruzar(aprovado(['1', 'C1', 'CONCRETO', 'M3', 50, 50, null, 100]), revisada(['1', 'C1', 'CONCRETO', 'M3', 80]));
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'acima');
  assert.equal(res[0].dif, 20);
  assert.equal(res[0].pct, 25);
  assert.equal(res[0].via, 'codigo');
});

test('compatível, abaixo, e igualdade até a 2ª casa (609,2988 × 609,30)', () => {
  const res = cruzar(
    aprovado(['1', 'C1', 'A', 'M3', 10], ['2', 'C2', 'B', 'M3', 5], ['3', 'C3', 'C', 'M3', 609.3]),
    revisada(['1', 'C1', 'A', 'M3', 10], ['2', 'C2', 'B', 'M3', 8], ['3', 'C3', 'C', 'M3', 609.2988908333334]));
  assert.equal(porCodigo(res, 'C1').status, 'compativel');
  assert.equal(porCodigo(res, 'C2').status, 'abaixo');
  assert.equal(porCodigo(res, 'C2').pct, -37.5);
  assert.equal(porCodigo(res, 'C3').status, 'compativel');
});

test('revisada zerada: sem erro de cálculo; 0 × 0 é compatível', () => {
  const res = cruzar(aprovado(['1', 'C1', 'A', 'M3', 4], ['2', 'C2', 'B', 'M3', 0]),
    revisada(['1', 'C1', 'A', 'M3', 0], ['2', 'C2', 'B', 'M3', 0]));
  assert.equal(porCodigo(res, 'C1').status, 'acima');
  assert.equal(porCodigo(res, 'C1').pct, null);
  assert.equal(porCodigo(res, 'C2').status, 'compativel');
  assert.equal(porCodigo(res, 'C2').pct, 0);
});

test('mesmo serviço em várias categorias/ambientes soma nos dois lados, sem alerta por agrupamento', () => {
  // revisada: Infraestrutura (30) + Superestrutura (20); aprovado: tudo em "Estrutura" (50)
  const res = cruzar(
    aprovado(['4.1', 'C9', 'CONCRETO FCK 25', 'M3', 50]),
    revisada(['3.1.1', 'C9', 'CONCRETO FCK 25', 'M3', 30], ['4.2.1', 'C9', 'CONCRETO FCK 25', 'M3', 20]));
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'compativel');
  assert.equal(res[0].rev[0].linhas.length, 2);
});

test('SINTÉTICO + QUADRA somam contra o aprovado único', () => {
  const res = cruzar(aprovado(['1', 'C1', 'PISO', 'M2', 150]), revisada(['1', 'C1', 'PISO', 'M2', 100]), revisada(['1', 'C1', 'PISO', 'M2', 50]));
  assert.equal(res[0].status, 'compativel');
  assert.deepEqual([...res[0].rev[0].linhas.map(l => l.origem)].sort(), ['QUADRA', 'SINTETICO']);
});

test('códigos diferentes NUNCA são somados, mesmo com descrição e unidade iguais', () => {
  const res = cruzar(aprovado(['1', 'C1', 'TUBO PVC 25MM', 'M', 100]),
    revisada(['1', 'C2', 'TUBO PVC 25MM', 'M', 60], ['2', 'C3', 'TUBO PVC 25MM', 'M', 40]));
  const f = res.find(x => x.fisc);
  assert.equal(f.status, 'incerta', 'sem código na revisada: manual');
  assert.equal(res.filter(x => x.status === 'nao_localizado').length, 2);
});

test('mesmo código, unidade diferente → incerta', () => {
  const res = cruzar(aprovado(['1', 'C1', 'ALVENARIA', 'M2', 10]), revisada(['1', 'C1', 'ALVENARIA', 'M3', 10]));
  assert.equal(res.find(x => x.fisc).status, 'incerta');
  assert.match(res.find(x => x.fisc).motivo, /unidade diferente/);
});

test('descrição parecida mas composição diferente (fck 30 × fck 20) → incerta, nunca casa sozinho', () => {
  const res = cruzar(aprovado(['1', 'C0844', 'CONCRETO P/VIBR., FCK 30 MPA COM AGREGADO ADQUIRIDO', 'M3', 32.88]),
    revisada(['1', 'C0842', 'CONCRETO P/VIBR., FCK 20 MPA COM AGREGADO ADQUIRIDO', 'M3', 32.88]));
  const f = res.find(x => x.fisc);
  assert.equal(f.status, 'incerta');
  assert.equal(f.candidatos[0].codigo, 'C0842');
  assert.equal(f.dif, null);
});

test('sem correspondência na revisada e não localizado no aprovado', () => {
  const res = cruzar(aprovado(['1', 'C1', 'SERVICO EXCLUSIVO DA FISCALIZACAO XYZ', 'UN', 1]),
    revisada(['1', 'C7', 'OUTRA COISA TOTALMENTE DIFERENTE', 'KG', 9]));
  assert.equal(res.find(x => x.fisc).status, 'sem_correspondencia');
  assert.equal(res.find(x => !x.fisc).status, 'nao_localizado');
  const r = M.resumir(res);
  assert.equal(r.semCorrespondencia, 2);
  assert.equal(r.analisados, 1);
});

test('código CXXXX: casa por descrição idêntica + unidade, se única', () => {
  const res = cruzar(aprovado(['1', 'CXXXX', 'ADMINISTRAÇÃO LOCAL DA OBRA', '%', 100]),
    revisada(['1.1', 'CX9000', 'ADMINISTRAÇÃO LOCAL DA OBRA', '%', 100]));
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'compativel');
  assert.equal(res[0].via, 'descricao');
});

test('CXXXX: linhas da revisada com mesma descrição+unidade somam num total só', () => {
  const res = cruzar(aprovado(['1', 'CXXXX', 'TOMADA', 'UN', 10]),
    revisada(['1', 'CX1', 'TOMADA', 'UN', 4], ['2', 'CX2', 'TOMADA', 'UN', 6]));
  assert.equal(res[0].status, 'compativel');
  assert.equal(res[0].rev[0].qtd, 10);
});

test('código real escrito na descrição (#SOP0287) casa com o código da revisada', () => {
  const res = cruzar(aprovado(['5.2.4', 'CXXXX', '#SOP0287 FORNECIMENTO DE TELA SOLDADA', 'M2', 2400.21, 2400.21, null, 2400.21]),
    revisada(['5.2.4', 'SOP0287', 'FORNECIMENTO DE TELA SOLDADA', 'M2', 2438]));
  assert.equal(res[0].via, 'codigo_na_descricao');
  assert.equal(res[0].status, 'abaixo');
});

test('equivalência confirmada pelo analista soma códigos diferentes', () => {
  const a = M.lerAprovado(aprovado(['1', 'C1', 'TUBO', 'M', 100])).itens;
  const r = M.lerRevisado(revisada(['1', 'C2', 'TUBO A', 'M', 60], ['2', 'C3', 'TUBO B', 'M', 40]), 'SINTETICO').itens;
  const res = M.cruzar(a, r, { equivalencias: [{ fisc: 'C|C1|m', rev: ['C|C2|m', 'C|C3|m'] }] });
  assert.equal(res.length, 1);
  assert.equal(res[0].via, 'manual');
  assert.equal(res[0].status, 'compativel');
});

test('um serviço da revisada não é usado por dois do aprovado', () => {
  const res = cruzar(aprovado(['1', 'C1', 'PISO', 'M2', 10], ['2', 'CXXXX', 'PISO', 'M2', 10]),
    revisada(['1', 'C1', 'PISO', 'M2', 10]));
  assert.equal(res.find(x => x.fisc.codigo === 'C1').status, 'compativel');
  assert.equal(res.find(x => !x.fisc.codigo).status, 'incerta');
});

test('abas: só SINTÉTICO e QUADRA, não MEMÓRIA QUADRA nem ESTRUTURA QUADRA', () => {
  const a = M.escolherAbas(['RESUMO', 'SINTÉTICO', 'MEMÓRIA', 'QUADRA', 'MEMÓRIA QUADRA', 'ESTRUTURA QUADRA', 'TABELAS']);
  assert.deepEqual({ ...a }, { SINTETICO: 'SINTÉTICO', QUADRA: 'QUADRA' });
});

test('validação: cabeçalho ausente e repetição entre abas', () => {
  assert.ok(M.lerRevisado([['x', 'y']], 'QUADRA').erro);
  const r = [...M.lerRevisado(revisada(['1', 'C1', 'A', 'M2', 5]), 'SINTETICO').itens,
    ...M.lerRevisado(revisada(['1', 'C1', 'A', 'M2', 5]), 'QUADRA').itens];
  const av = M.validar([{}], r);
  assert.ok(av.some(x => /entre SINTÉTICO e QUADRA/.test(x.texto)));
});
