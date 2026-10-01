// tests/ortografia.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const motor = require('hunspell-asm');
const O = require('../ortografia.js');
for (const c of ['pt-BR', 'en-US']) { const d = require(`../vendor/dicionarios/${c}.js`); O.registrar(c, d); }
const pronto = O.carregar({ motor });

test('carrega pt-BR e en-US e responde', async () => {
  await pronto;
  assert.equal(O.pronto(), true);
  for (const p of ['ovario', 'bicicletta', 'nao', 'palavrra', 'wrongg']) assert.equal(O.errada(p), true, p);
  for (const p of ['ovário', 'house', 'estão', 'Casa', 'CASA', 'guarda-chuva', "don't"]) assert.equal(O.errada(p), false, p);
});

test('ignora números, palavras com dígito, uma letra e endereços', async () => {
  await pronto;
  for (const p of ['2026', 'C3PO', 'x', 'site.com', 'a@b.c']) assert.equal(O.errada(p), false, p);
});

test('sugestões: a mais parecida primeiro, mantendo a maiúscula inicial', async () => {
  await pronto;
  assert.equal(O.sugestoes('ovario')[0], 'ovário');
  assert.equal(O.sugestoes('bicicletta')[0], 'bicicleta');
  assert.equal(O.sugestoes('nao')[0], 'não');
  assert.equal(O.sugestoes('Ovario')[0], 'Ovário');
  assert.ok(O.sugestoes('ovario').length <= 5);
  assert.equal(new Set(O.sugestoes('ovario')).size, O.sugestoes('ovario').length, 'sem repetidas');
});

test('dicionário pessoal: adicionar vale na hora; definirPessoais substitui', async () => {
  await pronto;
  assert.equal(O.errada('nubank'), true);
  O.adicionar('nubank');
  assert.equal(O.errada('nubank'), false);
  O.definirPessoais(['Kiro']);
  assert.equal(O.errada('Kiro'), false);
  assert.equal(O.errada('nubank'), true, 'o conjunto anterior saiu');
});

test('aoMudar avisa quando o dicionário pessoal muda', async () => {
  await pronto;
  let n = 0; O.aoMudar(() => { n++; });
  O.adicionar('btgzz');
  assert.ok(n >= 1);
});

test('distância de edição', () => {
  assert.equal(O.distancia('ovario', 'ovário'), 1);
  assert.equal(O.distancia('casa', 'casa'), 0);
});

test('idioma fora da lista não é carregado; idioma novo registrado passa a valer', async () => {
  delete require.cache[require.resolve('../ortografia.js')];
  const O2 = require('../ortografia.js');
  O2.registrar('en-US', require('../vendor/dicionarios/en-US.js'));
  O2.registrar('pt-BR', require('../vendor/dicionarios/pt-BR.js'));
  await O2.carregar({ motor, idiomas: ['en-US'] });
  assert.equal(O2.errada('ovário'), true, 'sem pt-BR, ovário é desconhecida');
  assert.equal(O2.errada('house'), false);
});
