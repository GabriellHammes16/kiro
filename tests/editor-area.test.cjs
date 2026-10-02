// tests/editor-area.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const E = require('../editor-nota.js');

function areaDe(texto, a = 0, b = a) {
  let estado = CM.state.EditorState.create({ doc: texto, selection: CM.state.EditorSelection.single(a, b), extensions: [CM.state.EditorState.lineSeparator.of(E.separadorDeLinha(texto))] });
  const area = E.criarArea({ estado: () => estado, aplicar: spec => { estado = estado.update(spec).state; }, focar() {} });
  return { area, texto: () => estado.sliceDoc() };
}

test('a área se comporta como um textarea para os menus', () => {
  const { area, texto } = areaDe('um dois três', 3, 7);
  assert.equal(area.value, 'um dois três');
  assert.equal(area.selectionStart, 3);
  assert.equal(area.selectionEnd, 7);
  area.inserir('**' + area.value.slice(area.selectionStart, area.selectionEnd) + '**');
  assert.equal(texto(), 'um **dois** três');
  assert.equal(area.selectionStart, area.selectionEnd);
  area.setSelectionRange(0, 2);
  assert.deepEqual([area.selectionStart, area.selectionEnd], [0, 2]);
});

test('com \\r\\n, value vem com \\n (como um textarea) e a inserção preserva o separador', () => {
  const { area, texto } = areaDe('a\r\nb');
  assert.equal(area.value, 'a\nb');
  area.setSelectionRange(area.value.indexOf('b'));
  area.inserir('X');
  assert.equal(texto(), 'a\r\nXb');
});

test('inserir com \n numa nota \r\n não mistura finais de linha', () => {
  const { area, texto } = areaDe('a\r\nb', 1);
  area.inserir('\nX');
  assert.equal(texto(), 'a\r\nX\r\nb');
  assert.ok(!/(^|[^\r])\n/.test(texto()));
});

test('transacaoDeTexto: cursor limitado ao novo texto, fora do histórico e marcada como externa', () => {
  const S = CM.state;
  let s = S.EditorState.create({ doc: 'x\r\ny\r\nzzzzzz', selection: { anchor: 10 }, extensions: [S.EditorState.lineSeparator.of('\r\n')] });
  const tr = s.update(E.transacaoDeTexto(s, 'a\r\nb\r\nc'));
  assert.equal(tr.state.sliceDoc(), 'a\r\nb\r\nc');
  assert.equal(tr.state.selection.main.head, tr.state.doc.length);
  assert.equal(tr.annotation(S.Transaction.addToHistory), false);
  assert.equal(E.veioDeFora(tr), true);
  assert.equal(E.veioDeFora(s.update({ changes: { from: 0, insert: 'q' } })), false);
});
