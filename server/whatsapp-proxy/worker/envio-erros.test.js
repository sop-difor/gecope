const test = require('node:test');
const assert = require('node:assert/strict');
const { envioPodeTerChegado } = require('./envio-erros');

test('timeout de resposta é ambíguo (não repetir)', () => {
  assert.equal(envioPodeTerChegado(Object.assign(new Error('network timeout at: http://x'), { type: 'request-timeout' })), true);
  assert.equal(envioPodeTerChegado(new Error('Network timeout at: http://x')), true);
});

test('conexão cortada depois de enviar é ambígua', () => {
  assert.equal(envioPodeTerChegado(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), true);
  assert.equal(envioPodeTerChegado(new Error('socket hang up')), true);
  assert.equal(envioPodeTerChegado(new Error('Premature close')), true);
});

test('falha ao conectar (nada foi enviado) pode repetir', () => {
  assert.equal(envioPodeTerChegado(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), false);
  assert.equal(envioPodeTerChegado(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })), false);
});

test('recusa explícita da Evolution (HTTP não-2xx) pode repetir', () => {
  assert.equal(envioPodeTerChegado(new Error('Connection Closed')), false);
  assert.equal(envioPodeTerChegado(new Error('Status HTTP 500')), false);
});

test('sem erro', () => assert.equal(envioPodeTerChegado(null), false));
