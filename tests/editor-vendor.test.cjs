const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CM = require('../vendor/codemirror/codemirror.js');

const estado = (texto, separador) => CM.state.EditorState.create({
  doc: texto,
  extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage }), ...(separador ? [CM.state.EditorState.lineSeparator.of(separador)] : [])],
});

test('o vendor expõe os pacotes que o editor usa', () => {
  for (const nome of ['state', 'view', 'commands', 'language', 'markdown', 'lezerMarkdown']) assert.ok(CM[nome], nome);
  assert.equal(typeof CM.view.EditorView, 'function');
  assert.equal(typeof CM.commands.history, 'function');
});

test('ida e volta: o texto sai igual ao que entrou, inclusive \r\n', () => {
  const texto = '# Título\r\n\r\n\tcom tab  \r\nacentuação ✨ 🧠\r\n- item\r\n';
  assert.equal(estado(texto, '\r\n').sliceDoc(), texto);
  const lf = 'linha 1\nlinha 2  \n\n';
  assert.equal(estado(lf).sliceDoc(), lf);
});

test('a árvore de sintaxe reconhece Markdown com as extensões do GitHub', () => {
  const s = estado('# T\n\n~~x~~ **y**\n\n- [ ] tarefa\n');
  const nomes = new Set();
  CM.language.ensureSyntaxTree(s, s.doc.length, 5000).iterate({ enter: n => { nomes.add(n.name); } });
  for (const n of ['ATXHeading1', 'HeaderMark', 'Strikethrough', 'StrongEmphasis', 'BulletList', 'Task']) assert.ok(nomes.has(n), n);
});

test('o servidor entrega o vendor e a licença está junto', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'server.mjs'), 'utf8').includes('codemirror'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'codemirror', 'LICENSE.txt'), 'utf8'), /MIT/);
});
