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

test('o atalho de criar balão é lido antes do editor, em captura', () => {
  assert.ok(fonte.includes("opcoes.atalho?.('fluxoProximo')"));
  assert.match(fonte, /campo\.addEventListener\('keydown', aoCriarVizinho, true\)/);
});

test('Enter sozinho não cria balão', () => {
  assert.doesNotMatch(fonte, /e\.key === 'Enter'[^\n]*criarVizinho/);
});

test('redimensionar à mão fixa a altura e a edição a respeita', () => {
  assert.match(fonte, /kiroAlturaFixa: true/);
  assert.match(fonte, /\.kiroAlturaFixa/);
});

test('as guias são limpas ao soltar e ao cancelar o gesto', () => {
  assert.ok((fonte.match(/limparGuias\(\)/g) || []).length >= 2);
});

test('PDF não é tratado como nota', () => {
  assert.match(fonte, /F\.ehPdf\(c\.file\)/);
  assert.doesNotMatch(fonte, /type === 'file' && !F\.ehImagem\(no\(idNo\)\.file\) \?/);
});

test('o PDF reaproveita o elemento para não piscar ao redesenhar', () => {
  const i = fonte.indexOf('function desenhar()');
  assert.match(fonte.slice(i, i + 900), /fluxo-pdf/);
});

test('rolar as páginas não é capturado pelo Fluxo', () => {
  const i = fonte.indexOf("raiz.addEventListener('wheel'");
  assert.match(fonte.slice(i, i + 300), /md-pdf-paginas/);
});

test('Copiar e Recortar do menu não usam execCommand', () => {
  assert.doesNotMatch(fonte, /execCommand/);
  assert.match(fonte, /rotulo: t\('Copiar'\)[^\n]*copiarSelecao\(\)/);
  assert.match(fonte, /rotulo: t\('Recortar'\)[^\n]*removerCartoes\(canvas, copiarSelecao\(\)\)/);
});

test('segurar o atalho de balão não cria um cartão por repetição', () => {
  assert.match(fonte, /e\.repeat/);
});
