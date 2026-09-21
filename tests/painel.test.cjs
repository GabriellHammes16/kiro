const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../domain.js');

const n = (id, title, body, tags = []) => ({ id, title, body, tags, links: [], folderId: '' });

test('menções não vinculadas: sem acento e maiúsculas, palavra inteira, fora de links', () => {
  const alvo = n('a', 'Fotossíntese', '');
  const notas = [
    alvo,
    n('b', 'B', 'A fotossintese acontece nas folhas.'),
    n('c', 'C', 'Veja [[Fotossíntese]] depois.'),
    n('d', 'D', 'Fotossínteses são várias.'),
    n('e', 'E', 'Sobre FOTOSSÍNTESE:\nlinha 2'),
  ];
  const achadas = K.mencoesNaoVinculadas(notas, alvo);
  assert.deepEqual(achadas.map(m => [m.nota.id, m.trecho]), [['b', 'A fotossintese acontece nas folhas.'], ['e', 'Sobre FOTOSSÍNTESE:']]);
  assert.deepEqual(K.mencoesNaoVinculadas([n('x', 'IA', ''), n('y', 'Y', 'IA em tudo')], n('x', 'IA', '')), []);   // título curto
});

test('vincular a menção troca só a primeira ocorrência solta', () => {
  assert.equal(K.vincularMencao('A fotossintese acontece', 'Fotossíntese'), 'A [[Fotossíntese|fotossintese]] acontece');
  assert.equal(K.vincularMencao('Veja Fotossíntese aqui', 'Fotossíntese'), 'Veja [[Fotossíntese]] aqui');
  assert.equal(K.vincularMencao('Veja [[Fotossíntese]] e Fotossíntese', 'Fotossíntese'), 'Veja [[Fotossíntese]] e [[Fotossíntese]]');
  assert.equal(K.vincularMencao('Nada aqui', 'Fotossíntese'), 'Nada aqui');
});

test('sumário: títulos fora de código (só ```), com nível, ordem e pos', () => {
  // ~~~ não é cerca para o renderizador (só ``` é), então o "## também não" abaixo é
  // título de verdade — sumario tem que concordar com o que renderizarMarkdown desenha.
  const corpo = '# A\ntexto\n## B\n```\n# não\n```\n### C ##\n#tag\n# C#\n~~~\n## também não\n~~~';
  assert.deepEqual(K.sumario(corpo), [
    { nivel: 1, texto: 'A', indice: 0, pos: corpo.indexOf('# A') },
    { nivel: 2, texto: 'B', indice: 1, pos: corpo.indexOf('## B') },
    { nivel: 3, texto: 'C', indice: 2, pos: corpo.indexOf('### C ##') },
    { nivel: 1, texto: 'C#', indice: 3, pos: corpo.indexOf('# C#') },
    { nivel: 2, texto: 'também não', indice: 4, pos: corpo.indexOf('## também não') },
  ]);
  assert.deepEqual(K.sumario(''), []);
});

test('sumário: título ou cerca indentados não contam (só coluna 0, como o renderizador)', () => {
  const corpo = '  ## indentado\n# real\n   ```\n# ainda conta (cerca indentada não é cerca)\n   ```';
  assert.deepEqual(K.sumario(corpo), [
    { nivel: 1, texto: 'real', indice: 0, pos: corpo.indexOf('# real') },
    { nivel: 1, texto: 'ainda conta (cerca indentada não é cerca)', indice: 1, pos: corpo.indexOf('# ainda conta') },
  ]);
});

test('podeVincular: só com a nota salva (tem id) e sem alterações pendentes', () => {
  assert.equal(K.podeVincular({ title: 'Rascunho' }, false), false); // sem id
  assert.equal(K.podeVincular({ id: 'a', title: 'A' }, true), false); // com id, mas suja
  assert.equal(K.podeVincular({ id: 'a', title: 'A' }, false), true); // com id e limpa
});

test('árvore de etiquetas: aninhadas por barra, cada nota conta uma vez', () => {
  const notas = [n('1', 'Um', '', ['estudo/python']), n('2', 'Dois', '', ['estudo']), n('3', 'Três', 'Veja #estudo/js e #ideia')];
  assert.deepEqual(K.arvoreDeEtiquetas(notas), [
    { nome: 'estudo', caminho: 'estudo', total: 3, filhos: [
      { nome: 'js', caminho: 'estudo/js', total: 1, filhos: [] },
      { nome: 'python', caminho: 'estudo/python', total: 1, filhos: [] },
    ] },
    { nome: 'ideia', caminho: 'ideia', total: 1, filhos: [] },
  ]);
});

test('título com | ou colchetes não vira link', () => {
  assert.equal(K.vincularMencao('veja a|b aqui', 'A|B'), 'veja a|b aqui');
  assert.equal(K.vincularMencao('veja a]b aqui', 'A]B'), 'veja a]b aqui');
  assert.deepEqual(K.mencoesNaoVinculadas([n('alvo', 'A|B', ''), n('outra', 'B', 'veja a|b aqui')], n('alvo', 'A|B', '')), []);
});
