const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonte = fs.readFileSync(path.join(__dirname, '../fluxo-tela.js'), 'utf8');

test('copiar e recortar respeitam o texto em edição', () => {
  for (const evento of ['copy', 'cut']) {
    const i = fonte.indexOf(`raiz.addEventListener('${evento}'`);
    assert.ok(i > 0, evento);
    assert.match(fonte.slice(i, i + 160), /editor \|\| e\.target !== raiz/);
  }
});

test('a área do fluxo só vale quando o texto copiado ainda é o mesmo', () => {
  assert.match(fonte, /areaDoFluxo\?\.texto === /);
});
