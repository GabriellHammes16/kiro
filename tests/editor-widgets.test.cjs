const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const W = require('../editor-widgets.js');

const estado = (texto, separador) => CM.state.EditorState.create({ doc: texto, extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage }), ...(separador ? [CM.state.EditorState.lineSeparator.of(separador)] : [])] });
const achar = (texto, sep) => { const s = estado(texto, sep); const arvore = CM.language.ensureSyntaxTree(s, s.doc.length, 5000); return { s, els: W.acharElementos(s, 0, s.doc.length, { arvore }) }; };
const fatia = (s, e) => s.sliceDoc(e.de, e.ate);

test('tarefas: [ ], [x] e [X] com -, *, + e 1.', () => {
  const { s, els } = achar('- [ ] a\n* [x] b\n+ [X] c\n1. [ ] d\n- não é [ ] tarefa');
  const t = els.filter(e => e.tipo === 'tarefa');
  assert.deepEqual(t.map(e => [fatia(s, e), e.feito]), [['[ ]', false], ['[x]', true], ['[X]', true], ['[ ]', false]]);
});

test('trocaDaTarefa troca só o caractere de dentro', () => {
  const { s, els } = achar('- [ ] a\n- [X] b');
  const [aberta, feita] = els.filter(e => e.tipo === 'tarefa');
  assert.deepEqual(W.trocaDaTarefa(s, aberta), { from: aberta.de + 1, to: aberta.de + 2, insert: 'x' });
  assert.deepEqual(W.trocaDaTarefa(s, feita), { from: feita.de + 1, to: feita.de + 2, insert: ' ' });
});

test('imagens: com e sem largura, 300x200, | no caminho; não é imagem sem extensão', () => {
  const { s, els } = achar('![[foto.png]] e ![[pasta/a|b.png|300]] e ![[x.jpg|300x200]] e ![[nota]]');
  const i = els.filter(e => e.tipo === 'imagem');
  assert.deepEqual(i.map(e => [e.caminho, e.largura]), [['foto.png', null], ['pasta/a|b.png', 300], ['x.jpg', 300]]);
  assert.equal(fatia(s, i[1]), '![[pasta/a|b.png|300]]');
  assert.deepEqual(W.trocaDaLargura(i[0], 420), { from: i[0].de, to: i[0].ate, insert: '![[foto.png|420]]' });
});

test('fórmula em linha: cifrões colados; R$ 5 e R$ 10 não; nada dentro de código', () => {
  const { els } = achar('área $x^2$ e R$ 5 e R$ 10 e `$y$`');
  assert.deepEqual(els.filter(e => e.tipo === 'formula').map(e => e.tex), ['x^2']);
});

test('fórmula em bloco: várias linhas, uma linha só, e sem fechamento', () => {
  const um = achar('a\n\n$$\nx = 1\ny = 2\n$$\n\nb');
  const b = um.els.find(e => e.tipo === 'formulaBloco');
  assert.equal(b.tex, 'x = 1\ny = 2');
  assert.equal(fatia(um.s, b), '$$\nx = 1\ny = 2\n$$');
  assert.equal(achar('$$a+b$$').els.find(e => e.tipo === 'formulaBloco').tex, 'a+b');
  const aberto = achar('$$\nz\nfim');
  assert.equal(aberto.els.find(e => e.tipo === 'formulaBloco').tex, 'z\nfim');
});

test('cabeçalho do código: linguagem, código, sem cabeçalho para kiro:', () => {
  const { s, els } = achar('```js\nlet a = 1\n```\n\n```\nx\n```\n\n```kiro:quadro\n{}\n```');
  const c = els.filter(e => e.tipo === 'cabecalhoCodigo');
  assert.deepEqual(c.map(e => [e.linguagem, e.codigo]), [['js', 'let a = 1'], ['', 'x']]);
  assert.equal(fatia(s, c[0]), '```js');
});

test('callout e comentário', () => {
  const { s, els } = achar('> [!nota] Título\n> corpo\n\ntexto %%escondido%% fim');
  const c = els.find(e => e.tipo === 'callout');
  assert.equal(c.nome, 'nota'); assert.equal(fatia(s, c), '[!nota]'); assert.equal(c.linhas.length, 2);
  assert.equal(fatia(s, els.find(e => e.tipo === 'comentario')), '%%escondido%%');
});

test('posições corretas com \\r\\n', () => {
  const { s, els } = achar('a\r\n- [ ] b\r\n$x$', '\r\n');
  assert.equal(fatia(s, els.find(e => e.tipo === 'tarefa')), '[ ]');
  assert.equal(els.find(e => e.tipo === 'formula').tex, 'x');
});
