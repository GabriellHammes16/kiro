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

test('as CSPs permitem WebAssembly e o binário embutido do motor', () => {
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const htmlCsp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];

  const server = fs.readFileSync(path.join(raiz, 'server.mjs'), 'utf8');
  const serverCspMatch = server.match(/response\.setHeader\('Content-Security-Policy', "([^"]+)"/);
  assert.ok(serverCspMatch, 'CSP do servidor encontrada');
  const serverCsp = serverCspMatch[1];

  // index.html deve permitir WebAssembly e dados embutidos
  assert.ok(htmlCsp.includes("'wasm-unsafe-eval'"), 'index.html: script-src tem wasm-unsafe-eval');
  // kiro-anexo: no connect-src é o fetch do PDF.js ao documento (pdf-nota.js): no
  // desktop a página é file:// e o PDF vem do esquema cruzado, não de data:.
  assert.ok(/(^|; )connect-src 'self' data: kiro-anexo:(;|$)/.test(htmlCsp), 'index.html: connect-src permite data: e kiro-anexo:');

  // server.mjs deve ter o mesmo
  assert.ok(serverCsp.includes("'wasm-unsafe-eval'"), 'server.mjs: script-src tem wasm-unsafe-eval');
  assert.ok(/(^|; )connect-src 'self' data:(;|$)/.test(serverCsp), 'server.mjs: connect-src permite data:');

  // CSP do worker não deve mudar (deve ter connect-src 'none')
  const workerCspMatch = server.match(/CSP.*WORKER.*?["']([^"']*connect-src[^"']*)['"]/i) ||
                         server.match(/connect-src 'none'.*plugin-worker/);
  // Verificar que em algum lugar do server há refer=ência à CSP do worker com connect-src 'none'
  assert.ok(server.includes("connect-src 'none'"), 'server.mjs: CSP do worker mantém connect-src none');
});
