const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');

test('dicionários empacotados exportam código, aff e dic no Node', () => {
  for (const codigo of ['pt-BR', 'en-US']) {
    const d = require(`../vendor/dicionarios/${codigo}.js`);
    assert.equal(d.codigo, codigo);
    assert.ok(d.aff.startsWith('SET') || d.aff.includes('\nSET') || d.aff.includes('SFX'), `${codigo}: .aff`);
    assert.ok(/^\d+/.test(d.dic), `${codigo}: .dic começa pela contagem de palavras`);
    assert.ok(fs.existsSync(path.join(raiz, 'vendor', 'dicionarios', `LICENSE-${codigo}.txt`)), `${codigo}: licença`);
  }
});

test('o motor empacotado existe, define HunspellAsm e traz as licenças', () => {
  const js = fs.readFileSync(path.join(raiz, 'vendor', 'hunspell', 'hunspell.js'), 'utf8');
  assert.match(js.slice(0, 200), /HunspellAsm/);
  assert.match(fs.readFileSync(path.join(raiz, 'vendor', 'hunspell', 'LICENSE.txt'), 'utf8'), /MIT/);
});

test('o servidor entrega o motor e os dicionários, e só códigos válidos', () => {
  const s = fs.readFileSync(path.join(raiz, 'server.mjs'), 'utf8');
  assert.ok(s.includes('/vendor/hunspell/hunspell.js'));
  assert.ok(s.includes('vendor/dicionarios'));
  assert.ok(s.includes('[a-z]{2}-[A-Z]{2}'));
});
