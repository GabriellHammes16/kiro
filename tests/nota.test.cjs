const test = require('node:test');
const assert = require('node:assert/strict');
const { mentions, linkQuery, linkSuggestions } = require('../domain.js');

const nota = (id, title, body = '') => ({ id, title, body, tags: [], links: [], folderId: '', updatedAt: 0 });

test('menções: só quem tem [[link]] que resolve para a nota, sem ela mesma e sem imagens', () => {
  const alvo = nota('a', 'Álgebra');
  const notas = [alvo, nota('b', 'Cita', 'Veja [[algebra|a matéria]]'), nota('c', 'Própria'), nota('d', 'Imagem', '![[Álgebra.png]] [[Outra]]')];
  notas[0].body = 'Eu mesma: [[Álgebra]]';
  assert.deepEqual(mentions(notas, alvo).map(n => n.id), ['b']);
});

test('sugestão: consulta só dentro de [[ aberto e ordem começa-com antes de contém', () => {
  assert.equal(linkQuery('texto [[Alg'), 'Alg');
  assert.equal(linkQuery('texto [['), '');
  assert.equal(linkQuery('[[Feito]] depois'), null);
  assert.equal(linkQuery('sem link'), null);
  assert.equal(linkQuery('imagem ![[fot'), null);
  const notas = ['Geometria analítica', 'Análise', 'Cálculo de análise', 'Outra'].map((t, i) => nota(String(i), t));
  assert.deepEqual(linkSuggestions(notas, 'anal'), ['Análise', 'Geometria analítica', 'Cálculo de análise']);
  assert.equal(linkSuggestions(notas.concat(notas.map((n, i) => nota('x' + i, n.title + ' 2')), [nota('z', 'Z')]), '').length, 8);
});
