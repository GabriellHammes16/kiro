// tests/editor-ao-vivo.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const E = require('../editor-nota.js');

const estado = (texto, cursor = 0, cursorFim = cursor) => CM.state.EditorState.create({
  doc: texto,
  selection: CM.state.EditorSelection.single(cursor, cursorFim),
  extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage })],
});
const ver = (texto, { cursor = texto.length, cursorFim, existe } = {}) => {
  const s = estado(texto, cursor, cursorFim ?? cursor);
  CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
  return E.analisar(s, 0, s.doc.length, E.linhasDaSelecao(s), { existe });
};
const fatias = (texto, intervalos) => intervalos.map(([a, b]) => texto.slice(a, b));

test('separadorDeLinha', () => {
  assert.equal(E.separadorDeLinha('a\r\nb'), '\r\n');
  assert.equal(E.separadorDeLinha('a\nb'), '\n');
  assert.equal(E.separadorDeLinha(''), '\n');
});

test('negrito: esconde ** fora da linha do cursor, mostra na linha do cursor', () => {
  const texto = '**forte**\n\nfim';
  const longe = ver(texto, { cursor: texto.length });
  assert.deepEqual(fatias(texto, longe.esconder), ['**', '**']);
  assert.ok(longe.estilos.some(([a, b, c]) => c === 'ed-negrito' && texto.slice(a, b).includes('forte')));
  const perto = ver(texto, { cursor: 3 });
  assert.deepEqual(perto.esconder, []);
  assert.ok(perto.estilos.some(([, , c]) => c === 'ed-negrito'), 'o estilo continua na linha do cursor');
});

test('título: classe na linha e # escondido fora do cursor', () => {
  const texto = '## Seção\n\ntexto';
  const r = ver(texto);
  assert.deepEqual(r.linhas.filter(([, c]) => c.startsWith('ed-h')), [[0, 'ed-h2']]);
  assert.deepEqual(fatias(texto, r.esconder), ['## ']);
});

test('link: mostra só o texto', () => {
  const texto = 'veja [site](https://x.com) agora\n\n.';
  const r = ver(texto);
  assert.deepEqual(fatias(texto, r.esconder), ['[', '](https://x.com)']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-link' && texto.slice(a, b) === 'site'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('https://x.com')));
});

test('wikilink com apelido: esconde [[ alvo| e ]]; ausente fica com outra classe', () => {
  const texto = 'ir para [[Plano de estudos|plano]] e [[Nada]]\n\n.';
  const r = ver(texto, { existe: alvo => alvo === 'Plano de estudos' });
  assert.deepEqual(fatias(texto, r.esconder), ['[[Plano de estudos|', ']]', '[[', ']]']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-wikilink' && texto.slice(a, b) === 'plano'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-wikilink-ausente' && texto.slice(a, b) === 'Nada'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b) === 'Nada'), 'alvo sem apelido não é verificado');
});

test('etiqueta e realce', () => {
  const texto = 'nota #ideia com ==destaque==\n\n.';
  const r = ver(texto);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-etiqueta' && texto.slice(a, b) === '#ideia'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b) === '#ideia'));
  assert.deepEqual(fatias(texto, r.esconder), ['==', '==']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-realce' && texto.slice(a, b) === 'destaque'));
});

test('o que não é marcação do Kiro', () => {
  assert.deepEqual(E.marcacoesDoKiro('C# e a#b e [[sem fim'), []);
  assert.deepEqual(E.marcacoesDoKiro('![[imagem.png]]'), [], 'imagem é da etapa 2');
  const texto = 'texto `[[x]] #y ==z==` fim\n\n```\n[[a]] #b\n```\n\n.';
  const r = ver(texto);
  assert.ok(!r.estilos.some(([, , c]) => ['ed-wikilink', 'ed-wikilink-ausente', 'ed-etiqueta', 'ed-realce'].includes(c)), 'nada dentro de código');
});

test('lista: marcador vira • fora do cursor', () => {
  const texto = '- um\n- dois\n\n.';
  const r = ver(texto);
  assert.deepEqual(r.trocar.map(([a, b, s]) => [texto.slice(a, b), s]), [['-', '•'], ['-', '•']]);
  const naLinha = ver(texto, { cursor: 2 });
  assert.deepEqual(naLinha.trocar.map(([a, b]) => texto.slice(a, b)), ['-'], 'na linha do cursor o - fica');
});

test('citação, régua e bloco de código', () => {
  const texto = '> dito\n\n---\n\n```js\nlet a\n```\n\n.';
  const r = ver(texto);
  const classes = r.linhas.map(([, c]) => c);
  assert.ok(classes.includes('ed-citacao') && classes.includes('ed-regua') && classes.includes('ed-codigo-bloco'));
  assert.ok(fatias(texto, r.esconder).includes('> '));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('let a')));
});

test('seleção de várias linhas mostra os símbolos em todas', () => {
  const texto = '**a**\n**b**\n**c**';
  const r = ver(texto, { cursor: 0, cursorFim: texto.length });
  assert.deepEqual(r.esconder, []);
});

test('código em linha: crases escondidas fora do cursor, conteúdo sem corretor', () => {
  const texto = 'use `npm test` aqui\n\n.';
  const r = ver(texto);
  assert.deepEqual(fatias(texto, r.esconder), ['`', '`']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-codigo' && texto.slice(a, b).includes('npm test')));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('npm test')));
});

const semSobreposicao = (intervalos, msg) => {
  for (let i = 1; i < intervalos.length; i++) assert.ok(intervalos[i][0] >= intervalos[i - 1][1], `${msg}: ${JSON.stringify(intervalos)}`);
};

test('endereços e autolinks não têm marcações do Kiro', () => {
  for (const texto of ['[a](http://x?a==b==c)\n\n.', '<https://x.com/#a==b==>\n\n.']) {
    const r = ver(texto);
    assert.ok(!r.estilos.some(([, , c]) => c === 'ed-realce'), `sem realce em ${texto}`);
    const ini = texto.indexOf('http');
    assert.ok(!r.esconder.some(([a, b]) => a >= ini && b <= texto.indexOf('\n') - (texto[0] === '<' ? 1 : 1) && texto.slice(a, b) === '=='), 'nada escondido dentro do endereço');
  }
});

test('trechos escondidos nunca se sobrepõem', () => {
  for (const t of ['**[[Nota]]**', '==[[x]]==', '~~[[x]]~~', '# Tit [[Nota]] #tag', '*a [[b]] c*', '[a **b** c](u)', '[a](http://x?a==b==c)', '<https://x.com/#a==b==>']) {
    semSobreposicao(ver(t + '\n\n.').esconder, t);
  }
});

test('trechos escondidos nunca atravessam uma quebra de linha', () => {
  for (const t of ['[a](http://x\n"t")\n\nfim', '[a](http://x\n"t")\nfim', '**a\nb**\n\nfim']) {
    const s = estado(t, t.length);
    CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
    const r = E.analisar(s, 0, s.doc.length, E.linhasDaSelecao(s), {});
    assert.ok(r.esconder.length > 0, t);
    for (const [a, b] of r.esconder) assert.equal(s.doc.lineAt(a).number, s.doc.lineAt(b - 1).number, `${JSON.stringify(t)} [${a},${b}]`);
  }
});

test('analisar usa a árvore recebida, quando há', () => {
  const s = estado('**a**\n\nfim', 9), outra = estado('xxaxx\n\nfim', 9);
  CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
  CM.language.ensureSyntaxTree(outra, outra.doc.length, 5000);
  const r = E.analisar(s, 0, s.doc.length, E.linhasDaSelecao(s), { arvore: CM.language.syntaxTree(outra) });
  assert.deepEqual(r.esconder, []);
  assert.ok(!r.estilos.some(([, , c]) => c === 'ed-negrito'));
});

test('palavrasDaLinha: letras com acento, hífen e apóstrofo internos, pula trechos ignorados', () => {
  const p = (t, ig = []) => E.palavrasDaLinha(t, ig).map(x => t.slice(x.de, x.ate));
  assert.deepEqual(p('O ovário e a bicicletta.'), ['O', 'ovário', 'e', 'a', 'bicicletta']);
  assert.deepEqual(p("guarda-chuva, don't e d'água"), ['guarda-chuva', "don't", 'e', "d'água"]);
  assert.deepEqual(p('-borda- e ’aspas’'), ['borda', 'e', 'aspas']);
  assert.deepEqual(p('ver código aqui', [[4, 10]]), ['ver', 'aqui']);
  assert.deepEqual(p('ano 2026 e C3PO'), ['ano', '2026', 'e', 'C3PO'], 'o editor entrega; quem ignora números é o corretor');
});
