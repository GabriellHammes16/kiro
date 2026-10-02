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

test('blocos $$ achados desde o início, mesmo com de dentro de um bloco; fórmula em linha dentro de bloco não é retornada', () => {
  const texto = '$$\nx\n$$\n\ntexto\n\n$$\ny\n$$\n';
  const { s, els } = achar(texto);
  const blocos = els.filter(e => e.tipo === 'formulaBloco');
  assert.deepEqual(blocos.map(b => [b.de, b.ate, b.tex]), [[0, 7, 'x'], [16, 23, 'y']]);

  // Partial range starting inside first block: deve achar ambos os blocos que intersectam [de, ate]
  const s2 = estado(texto);
  const arvore = CM.language.ensureSyntaxTree(s2, s2.doc.length, 5000);
  const els2 = W.acharElementos(s2, 4, s2.doc.length, { arvore });
  const blocos2 = els2.filter(e => e.tipo === 'formulaBloco');
  assert.deepEqual(blocos2.map(b => [b.de, b.ate, b.tex]), [[0, 7, 'x'], [16, 23, 'y']]);

  // Fórmula em linha dentro de um bloco não deve ser retornada
  const comFormula = '$$\nmiddle $x$ line\n$$';
  const { els: els3 } = achar(comFormula);
  const formulas = els3.filter(e => e.tipo === 'formula');
  assert.deepEqual(formulas.map(f => f.tex), []);
});

test('elementos sobrepostos: comentário esconde o que está dentro, blocos escondem fórmulas em linha', () => {
  // Comentário esconde tudo dentro dele
  const { els: els1 } = achar('%%$x$ ![[a.png]]%%');
  assert.equal(els1.filter(e => e.tipo === 'comentario').length, 1);
  assert.equal(els1.filter(e => e.tipo === 'formula').length, 0);
  assert.equal(els1.filter(e => e.tipo === 'imagem').length, 0);

  // Fórmula e comentário sobrepostos: comentário vence
  const { els: els2 } = achar('$a %%b%% c$');
  const formula = els2.find(e => e.tipo === 'formula');
  const comentario = els2.find(e => e.tipo === 'comentario');
  assert.ok(comentario, 'deveria ter comentário');
  if (formula && comentario) {
    assert.ok(formula.de >= comentario.ate || formula.ate <= comentario.de, 'fórmula e comentário não deveriam se sobrepor');
  }
});

test('cabeçalho do código: blockquote com fence tem linguagem sem o > prefixo', () => {
  const { s, els } = achar('> ```js\n> let a\n> ```');
  const c = els.find(e => e.tipo === 'cabecalhoCodigo');
  assert.equal(c.linguagem, 'js', 'linguagem deve ser "js", não "> js"');
});
