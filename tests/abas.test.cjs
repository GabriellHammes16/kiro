const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../abas.js');

const um = (...abas) => ({ paineis: [{ abas, ativa: abas.at(-1) ?? null }], ativo: 0, larguras: [1] });
const colunas = e => e.paineis.map(p => p.abas);
const soma = l => l.reduce((a, b) => a + b, 0);

test('vazio tem uma coluna sem abas', () => {
  assert.deepEqual(A.vazio(), { paineis: [{ abas: [], ativa: null }], ativo: 0, larguras: [1] });
  assert.equal(A.notaAtiva(A.vazio()), null);
});

test('abrir troca a aba ativa; com novaAba insere à direita da ativa', () => {
  let e = A.abrir(A.vazio(), 'a');
  assert.deepEqual(e.paineis[0], { abas: ['a'], ativa: 'a' });
  e = A.abrir(e, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
  e = A.abrir(e, 'c', { novaAba: true });
  e = A.ativar(e, 0, 'b');
  e = A.abrir(e, 'd', { novaAba: true });
  assert.deepEqual(e.paineis[0].abas, ['b', 'd', 'c']);
  assert.equal(A.notaAtiva(e), 'd');
});

test('abrir id já aberto ativa a aba e a coluna dele, sem duplicar', () => {
  let e = A.mover(A.abrir(A.abrir(A.vazio(), 'a'), 'b', { novaAba: true }), 0, 'b', 1, { nova: true });
  e = A.ativar(e, 0, 'a');
  e = A.abrir(e, 'b', { novaAba: true });
  assert.equal(e.ativo, 1);
  assert.deepEqual(colunas(e), [['a'], ['b']]);
});

test('fechar ativa a vizinha da direita, senão a da esquerda', () => {
  let e = A.ativar(um('a', 'b', 'c'), 0, 'b');
  e = A.fechar(e, 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['a', 'c'], ativa: 'c' });
  e = A.fechar(e, 0, 'c');
  e = A.fechar(e, 0, 'a');
  assert.deepEqual(e.paineis, [{ abas: [], ativa: null }]);   // a única coluna fica, vazia
});

test('mover com nova cria colunas em qualquer posição, quantas quiser', () => {
  let e = um('a', 'b', 'c', 'd');
  e = A.mover(e, 0, 'd', 1, { nova: true });                  // [a b c] [d]
  e = A.mover(e, 0, 'c', 1, { nova: true });                  // [a b] [c] [d]
  e = A.mover(e, 0, 'a', 0, { nova: true });                  // [a] [b] [c] [d]
  assert.deepEqual(colunas(e), [['a'], ['b'], ['c'], ['d']]);
  assert.equal(e.ativo, 0);
  assert.equal(A.notaAtiva(e), 'a');
  assert.equal(e.larguras.length, 4);
  assert.ok(Math.abs(soma(e.larguras) - 1) < 1e-9);
});

test('mover para coluna existente leva a aba; coluna que esvazia some', () => {
  let e = A.mover(A.mover(um('a', 'b', 'c'), 0, 'c', 1, { nova: true }), 0, 'b', 1, { nova: true });   // [a] [b] [c]
  e = A.ativar(e, 2, 'c');
  e = A.mover(e, 1, 'b', 2);                                   // [a] [c b]
  assert.deepEqual(colunas(e), [['a'], ['c', 'b']]);
  assert.equal(e.ativo, 1);
  assert.equal(A.notaAtiva(e), 'b');
  assert.equal(e.larguras.length, 2);
});

test('mover para o mesmo lugar ou a única aba da única coluna não faz nada', () => {
  const e = um('a', 'b');
  assert.equal(A.mover(e, 0, 'b', 0), e);
  assert.deepEqual(A.mover(um('a'), 0, 'a', 1, { nova: true }), um('a'));
  assert.deepEqual(A.mover(um('a'), 0, 'a', 5), um('a'));      // coluna que não existe
});

test('fechar a última aba de uma coluna remove a coluna e corrige a ativa', () => {
  let e = A.mover(A.mover(um('a', 'b', 'c'), 0, 'c', 1, { nova: true }), 0, 'b', 1, { nova: true });   // [a] [b] [c]
  e = A.ativar(e, 2, 'c');
  e = A.fechar(e, 0, 'a');                                     // [b] [c], ativa continua c
  assert.deepEqual(colunas(e), [['b'], ['c']]);
  assert.equal(e.ativo, 1);
  assert.equal(A.notaAtiva(e), 'c');
  e = A.fechar(e, 1, 'c');                                     // a coluna ativa some
  assert.deepEqual(colunas(e), [['b']]);
  assert.equal(e.ativo, 0);
});

test('fecharOutras deixa só a aba pedida naquela coluna', () => {
  const e = A.fecharOutras(um('a', 'b', 'c'), 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
});

test('trocarId troca o rascunho; na mesma coluna as duas abas viram uma', () => {
  const e = A.trocarId(A.abrir(A.vazio(), A.RASCUNHO), A.RASCUNHO, 'n1');
  assert.deepEqual(e.paineis[0], { abas: ['n1'], ativa: 'n1' });
  const dup = { paineis: [{ abas: ['a', 'x'], ativa: 'a' }], ativo: 0, larguras: [1] };
  assert.deepEqual(colunas(A.trocarId(dup, 'a', 'x')), [['x']]);
});

test('larguras: normaliza para somar 1; lista errada vira colunas iguais', () => {
  const e = A.mover(um('a', 'b', 'c'), 0, 'c', 1, { nova: true });
  assert.deepEqual(A.larguras(e, [3, 1]).larguras, [0.75, 0.25]);
  assert.deepEqual(A.larguras(e, [1]).larguras, [0.5, 0.5]);
  assert.deepEqual(A.larguras(e, [1, -2]).larguras, [0.5, 0.5]);
  assert.deepEqual(A.larguras(e, 'x').larguras, [0.5, 0.5]);
});

test('limpar recusa lixo, tira ids inexistentes e repetidos e remove colunas vazias', () => {
  for (const lixo of [null, 'x', 1, [], {}, { paineis: [] }, { paineis: 'x' }]) assert.deepEqual(A.limpar(lixo, ['a']), A.vazio());
  const sujo = { paineis: [{ abas: ['a', 'x', 'a', 7], ativa: 'x' }, { abas: ['x'], ativa: 'x' }, { abas: ['b'], ativa: 'b' }], ativo: 1, larguras: [0.2, 0.3, 0.5] };
  const limpo = A.limpar(sujo, ['a', 'b']);
  assert.deepEqual(colunas(limpo), [['a'], ['b']]);
  assert.equal(limpo.ativo, 0);
  assert.deepEqual(limpo.larguras, [0.5, 0.5]);                // mudou o número de colunas: iguais
  const dup = { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['a', 'b'], ativa: 'a' }], ativo: 1, larguras: [0.3, 0.7] };
  const d = A.limpar(dup, new Set(['a', 'b']));
  assert.deepEqual(d.paineis, [{ abas: ['a'], ativa: 'a' }, { abas: ['a', 'b'], ativa: 'a' }]);
  assert.equal(d.ativo, 1);
  assert.deepEqual(d.larguras, [0.3, 0.7]);                    // mesmo número de colunas: mantém
  assert.deepEqual(A.limpar(um(A.RASCUNHO), []), um(A.RASCUNHO));
});

test('limpar migra o formato antigo de duas metades (proporcao)', () => {
  const antigo = { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['b'], ativa: 'b' }], ativo: 1, proporcao: 0.3 };
  const e = A.limpar(antigo, ['a', 'b']);
  assert.equal(e.larguras.length, 2);
  assert.ok(Math.abs(e.larguras[0] - 0.3) < 1e-9 && Math.abs(e.larguras[1] - 0.7) < 1e-9);
  assert.equal(e.proporcao, undefined);
});

test('abrir com duplicar abre a mesma nota noutra coluna; sem duplicar, salta para a que já existe', () => {
  const e = A.mover(A.abrir(A.abrir(A.vazio(), 'a'), 'b', { novaAba: true }), 0, 'b', 1, { nova: true });
  // Sem duplicar (clique na árvore): salta para a coluna onde a nota já está.
  const salta = A.abrir(A.ativar(e, 0, 'a'), 'b', { novaAba: true });
  assert.deepEqual(colunas(salta), [['a'], ['b']]);
  assert.equal(salta.ativo, 1);
  // Com duplicar (arrastar da árvore): a mesma nota passa a ocupar as duas colunas.
  const dobra = A.abrir(e, 'b', { novaAba: true, painel: 0, duplicar: true });
  assert.deepEqual(colunas(dobra), [['a', 'b'], ['b']]);
  assert.equal(dobra.ativo, 0);
  // Duplicar na coluna onde já está só ativa: nunca duas abas iguais na mesma coluna.
  const mesma = A.abrir(dobra, 'b', { novaAba: true, painel: 1, duplicar: true });
  assert.deepEqual(colunas(mesma), [['a', 'b'], ['b']]);
  assert.equal(mesma.ativo, 1);
});

test('abrir com colunaNova cria a coluna na posição pedida e abre a nota nela', () => {
  const e = A.abrir(A.vazio(), 'a');
  const direita = A.abrir(e, 'a', { colunaNova: true, painel: 1, duplicar: true });
  assert.deepEqual(colunas(direita), [['a'], ['a']]);
  assert.equal(direita.ativo, 1);
  assert.deepEqual(direita.larguras, [0.5, 0.5]);
  const esquerda = A.abrir(e, 'b', { colunaNova: true, painel: 0 });
  assert.deepEqual(colunas(esquerda), [['b'], ['a']]);
  assert.equal(esquerda.ativo, 0);
  // Posição fora da faixa não cria coluna nenhuma.
  assert.deepEqual(A.abrir(e, 'b', { colunaNova: true, painel: 9 }), e);
});

test('mover para uma coluna que já tem a nota não duplica a aba', () => {
  const e = { paineis: [{ abas: ['a', 'b'], ativa: 'b' }, { abas: ['b'], ativa: 'b' }], ativo: 0, larguras: [0.5, 0.5] };
  const r = A.mover(e, 0, 'b', 1);
  assert.deepEqual(colunas(r), [['a'], ['b']]);
  assert.equal(r.ativo, 1);
});

test('trocarId e limpar desduplicam por coluna, não entre colunas', () => {
  // A mesma nota em duas colunas é legítima: trocarId mantém as duas.
  const duas = { paineis: [{ abas: [A.RASCUNHO], ativa: A.RASCUNHO }, { abas: ['n1'], ativa: 'n1' }], ativo: 0, larguras: [0.5, 0.5] };
  assert.deepEqual(colunas(A.trocarId(duas, A.RASCUNHO, 'n1')), [['n1'], ['n1']]);
  // Dentro da mesma coluna, não: o rascunho some e sobra uma aba só.
  const mesma = { paineis: [{ abas: ['n1', A.RASCUNHO], ativa: A.RASCUNHO }], ativo: 0, larguras: [1] };
  assert.deepEqual(colunas(A.trocarId(mesma, A.RASCUNHO, 'n1')), [['n1']]);
  const guardado = { paineis: [{ abas: ['a', 'a'], ativa: 'a' }, { abas: ['a'], ativa: 'a' }], ativo: 1, larguras: [0.5, 0.5] };
  assert.deepEqual(colunas(A.limpar(guardado, ['a'])), [['a'], ['a']]);
});
