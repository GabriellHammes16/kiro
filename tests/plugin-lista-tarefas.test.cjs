const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../examples/plugins/lista-tarefas/estados.js');
const P = require('../plugins.js');
const fs = require('node:fs');
const path = require('node:path');

const t = (id, extra = {}) => ({ id, title: id, due: '2026-10-05', priority: 'Média', done: false, ...extra });

test('status: done no Kiro manda; guardado vale para as abertas; desconhecido vira "não começado"', () => {
  const guardados = { a: 'andamento', b: 'pausado', c: 'concluido', d: 'inventado' };
  assert.equal(E.statusDe(t('a'), guardados), 'andamento');
  assert.equal(E.statusDe(t('b'), guardados), 'pausado');
  assert.equal(E.statusDe(t('c'), guardados), 'nao-comecado', 'reaberta no Kiro sai de concluído');
  assert.equal(E.statusDe(t('d'), guardados), 'nao-comecado');
  assert.equal(E.statusDe(t('e', { done: true }), {}), 'concluido');
});

test('mudança: concluir marca done; sair de concluído desmarca; entre abertos não mexe no done', () => {
  assert.deepEqual(E.mudanca(t('a'), 'concluido'), { status: 'concluido', done: true });
  assert.deepEqual(E.mudanca(t('a', { done: true }), 'pausado'), { status: 'pausado', done: false });
  assert.deepEqual(E.mudanca(t('a'), 'andamento'), { status: 'andamento', done: undefined });
  assert.equal(E.mudanca(t('a'), 'lixo'), null);
});

test('teclado e ordem: vizinho para nas pontas; data, depois Alta, depois título', () => {
  assert.equal(E.vizinho('nao-comecado', -1), 'nao-comecado');
  assert.equal(E.vizinho('nao-comecado', 1), 'andamento');
  assert.equal(E.vizinho('concluido', 1), 'concluido');
  const ordem = E.ordenar([t('z', { due: '2026-10-06' }), t('b'), t('a', { priority: 'Alta' })]).map(x => x.id);
  assert.deepEqual(ordem, ['a', 'b', 'z']);
});

test('manifesto válido e todos os arquivos servíveis pelo Kiro', () => {
  const pasta = path.join(__dirname, '../examples/plugins/lista-tarefas');
  const r = P.validarManifesto(JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8')), { versaoDoKiro: require('../package.json').version });
  assert.equal(r.ok, true, r.erro);
  for (const arq of fs.readdirSync(pasta)) assert.ok(P.tipoDoArquivoDoPlugin(arq) || arq === 'manifest.json', `${arq} não seria servido`);
});
