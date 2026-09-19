const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../abas.js');

const um = (...abas) => ({ paineis: [{ abas, ativa: abas.at(-1) ?? null }], ativo: 0, proporcao: 0.5 });

test('vazio tem uma metade sem abas', () => {
  assert.deepEqual(A.vazio(), { paineis: [{ abas: [], ativa: null }], ativo: 0, proporcao: 0.5 });
  assert.equal(A.notaAtiva(A.vazio()), null);
});

test('abrir troca a aba ativa; com novaAba insere à direita da ativa', () => {
  let e = A.abrir(A.vazio(), 'a');
  assert.deepEqual(e.paineis[0], { abas: ['a'], ativa: 'a' });
  e = A.abrir(e, 'b');                                   // troca a ativa
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
  e = A.abrir(e, 'c', { novaAba: true });
  e = A.ativar(e, 0, 'b');
  e = A.abrir(e, 'd', { novaAba: true });                // à direita de b
  assert.deepEqual(e.paineis[0].abas, ['b', 'd', 'c']);
  assert.equal(A.notaAtiva(e), 'd');
});

test('abrir id já aberto ativa a aba e a metade dele, sem duplicar', () => {
  let e = A.mover(A.abrir(A.abrir(A.vazio(), 'a'), 'b', { novaAba: true }), 0, 'b', 1);
  e = A.ativar(e, 0, 'a');
  e = A.abrir(e, 'b', { novaAba: true });
  assert.equal(e.ativo, 1);
  assert.deepEqual(e.paineis.map(p => p.abas), [['a'], ['b']]);
});

test('fechar ativa a vizinha da direita, senão a da esquerda', () => {
  let e = um('a', 'b', 'c');
  e = A.ativar(e, 0, 'b');
  e = A.fechar(e, 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['a', 'c'], ativa: 'c' });
  e = A.fechar(e, 0, 'c');
  assert.deepEqual(e.paineis[0], { abas: ['a'], ativa: 'a' });
  e = A.fechar(e, 0, 'a');
  assert.deepEqual(e.paineis[0], { abas: [], ativa: null });
  assert.equal(e.paineis.length, 1);                     // a única metade fica, vazia
});

test('fechar aba não ativa mantém a ativa', () => {
  const e = A.fechar(A.ativar(um('a', 'b', 'c'), 0, 'c'), 0, 'a');
  assert.deepEqual(e.paineis[0], { abas: ['b', 'c'], ativa: 'c' });
});

test('mover cria a segunda metade, mover a última aba desfaz a divisão', () => {
  let e = um('a', 'b');
  e = A.mover(e, 0, 'b', 1);
  assert.deepEqual(e.paineis, [{ abas: ['a'], ativa: 'a' }, { abas: ['b'], ativa: 'b' }]);
  assert.equal(e.ativo, 1);
  assert.deepEqual(A.mover(e, 1, 'b', 1), e);           // mesmo lado: nada muda
  e = A.mover(e, 1, 'b', 0);
  assert.deepEqual(e.paineis, [{ abas: ['a', 'b'], ativa: 'b' }]);
  assert.equal(e.ativo, 0);
});

test('mover a única aba da esquerda para a direita deixa uma metade só', () => {
  const e = A.mover(um('a'), 0, 'a', 1);
  assert.deepEqual(e.paineis, [{ abas: ['a'], ativa: 'a' }]);
  assert.equal(e.ativo, 0);
});

test('fechar a última aba de um lado junta as metades', () => {
  let e = A.mover(um('a', 'b'), 0, 'b', 1);
  e = A.fechar(e, 0, 'a');
  assert.deepEqual(e.paineis, [{ abas: ['b'], ativa: 'b' }]);
  assert.equal(e.ativo, 0);
});

test('fecharOutras deixa só a aba pedida naquela metade', () => {
  const e = A.fecharOutras(um('a', 'b', 'c'), 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
});

test('trocarId troca o rascunho pelo id salvo', () => {
  const e = A.trocarId(A.abrir(A.vazio(), A.RASCUNHO), A.RASCUNHO, 'n1');
  assert.deepEqual(e.paineis[0], { abas: ['n1'], ativa: 'n1' });
});

test('limpar recusa lixo, tira ids inexistentes e repetidos e junta metade vazia', () => {
  for (const lixo of [null, 'x', 1, [], {}, { paineis: [] }, { paineis: 'x' }, { paineis: [{}, {}, {}] }]) assert.deepEqual(A.limpar(lixo, ['a']), A.vazio());
  const sujo = { paineis: [{ abas: ['a', 'x', 'a', 7], ativa: 'x' }, { abas: ['x'], ativa: 'x' }], ativo: 1, proporcao: 9 };
  assert.deepEqual(A.limpar(sujo, ['a']), { paineis: [{ abas: ['a'], ativa: 'a' }], ativo: 0, proporcao: 0.8 });
  // o mesmo id nas duas metades: fica na primeira
  const dup = { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['a', 'b'], ativa: 'a' }], ativo: 1, proporcao: 0.5 };
  assert.deepEqual(A.limpar(dup, new Set(['a', 'b'])), { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['b'], ativa: 'b' }], ativo: 1, proporcao: 0.5 });
  assert.deepEqual(A.limpar(um(A.RASCUNHO), []), um(A.RASCUNHO));   // rascunho não some
});

test('proporção fica entre 0,2 e 0,8', () => {
  assert.equal(A.proporcao(A.vazio(), 0.1).proporcao, 0.2);
  assert.equal(A.proporcao(A.vazio(), 0.95).proporcao, 0.8);
  assert.equal(A.proporcao(A.vazio(), 'x').proporcao, 0.5);
});
