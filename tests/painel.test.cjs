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

test('sumário: títulos fora de código, com nível e ordem', () => {
  const corpo = '# A\ntexto\n## B\n```\n# não\n```\n### C ##\n#tag\n# C#\n~~~\n## também não\n~~~';
  assert.deepEqual(K.sumario(corpo), [
    { nivel: 1, texto: 'A', indice: 0 },
    { nivel: 2, texto: 'B', indice: 1 },
    { nivel: 3, texto: 'C', indice: 2 },
    { nivel: 1, texto: 'C#', indice: 3 },
  ]);
  assert.deepEqual(K.sumario(''), []);
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
