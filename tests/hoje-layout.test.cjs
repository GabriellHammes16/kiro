const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../hoje.js');

// Catálogo com a forma dos nativos do app: frase inteira no topo, duas colunas.
const NATIVOS = [
  { id: 'frase', coluna: 0, largura: 'inteira' },
  { id: 'habitos', coluna: 0 }, { id: 'agora', coluna: 0 },
  { id: 'continuar', coluna: 1 }, { id: 'caixa', coluna: 1 }, { id: 'revisar', coluna: 1 },
];
const ids = l => l.cartoes.map(c => c.id);
const todos = l => new Set(ids(l));
const LIMITE = { key: 'limite', type: 'number', label: 'Quantos', default: 0, min: 0, max: 50 };
const SEMANA = { key: 'semana', type: 'boolean', label: 'Semana', default: true };
const PASTA = { key: 'pasta', type: 'select', label: 'Pasta', default: 'todas', choices: ['todas', 'trabalho'] };

test('padrão reproduz a Hoje atual: frase inteira e duas colunas', () => {
  const l = H.padrao(NATIVOS);
  assert.equal(l.colunas, 2);
  assert.deepEqual(l.ocultos, []);
  assert.deepEqual(H.faixas(l, todos(l)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [['habitos', 'agora'], ['continuar', 'caixa', 'revisar']] },
  ]);
});

test('reconciliar: cartão novo vai para a coluna mais curta; nada novo devolve o mesmo objeto', () => {
  const l = H.padrao(NATIVOS);
  assert.equal(H.reconciliar(l, NATIVOS), l);
  const r = H.reconciliar(l, [...NATIVOS, { id: 'plugin:a:x' }]);
  assert.deepEqual(H.faixas(r, todos(r))[1].colunas, [['habitos', 'agora', 'plugin:a:x'], ['continuar', 'caixa', 'revisar']]);
  // Escondidos não contam para "mais curta".
  const e = H.reconciliar(H.esconder(H.esconder(l, 'habitos'), 'agora'), [...NATIVOS, { id: 'p' }]);
  assert.equal(e.cartoes.find(c => c.id === 'p').coluna, 0);
  // Coluna pedida pelo catálogo é respeitada; largura "inteira" vai para o fim.
  const c = H.reconciliar(l, [...NATIVOS, { id: 'q', coluna: 1 }, { id: 'w', largura: 'inteira' }]);
  assert.deepEqual(H.faixas(c, todos(c)).at(-1), { tipo: 'inteira', id: 'w' });
  assert.equal(c.cartoes.find(x => x.id === 'q').coluna, 1);
});

test('reconciliar mantém no layout o que sumiu do catálogo (plug-in desligado volta ao lugar)', () => {
  const l = H.reconciliar(H.padrao(NATIVOS), [...NATIVOS, { id: 'p' }]);
  const sem = H.reconciliar(l, NATIVOS);
  assert.ok(ids(sem).includes('p'));
  const visiveis = new Set(NATIVOS.map(n => n.id));
  assert.ok(!H.faixas(sem, visiveis).flatMap(f => f.tipo === 'inteira' ? [f.id] : f.colunas.flat()).includes('p'));
});

test('mover: para outra coluna, antes de um cartão ou para o fim', () => {
  const l = H.padrao(NATIVOS);
  const a = H.mover(l, 'habitos', { coluna: 1, antes: 'caixa' });
  assert.deepEqual(H.faixas(a, todos(a))[1].colunas, [['agora'], ['continuar', 'habitos', 'caixa', 'revisar']]);
  const b = H.mover(l, 'continuar', { coluna: 0 });
  assert.deepEqual(H.faixas(b, todos(b))[1].colunas, [['habitos', 'agora', 'continuar'], ['caixa', 'revisar']]);
  assert.equal(H.mover(l, 'nao-existe', { coluna: 0 }), l);
  assert.equal(H.mover(l, 'caixa', { coluna: 9 }).cartoes.find(c => c.id === 'caixa').coluna, 1);   // coluna fora: a última
});

test('mover para coluna vazia de uma faixa depois de um cartão inteiro fica nessa faixa', () => {
  const l = H.definirLargura(H.padrao(NATIVOS), 'agora', 'inteira');
  // Soltar 'revisar' na coluna 0 vazia da faixa de baixo: fica lá, não sobe para a faixa de cima.
  const a = H.mover(l, 'revisar', { coluna: 0, antes: null, noFim: true });
  assert.deepEqual(H.faixas(a, todos(a)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [['habitos'], []] },
    { tipo: 'inteira', id: 'agora' },
    { tipo: 'colunas', colunas: [['revisar'], ['continuar', 'caixa']] },
  ]);
  // Soltar 'habitos' na coluna 1 vazia da faixa de cima: fica lá, não desce para a faixa de baixo.
  const b = H.mover(l, 'habitos', { coluna: 1, antes: 'agora' });
  assert.deepEqual(H.faixas(b, todos(b)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [[], ['habitos']] },
    { tipo: 'inteira', id: 'agora' },
    { tipo: 'colunas', colunas: [[], ['continuar', 'caixa', 'revisar']] },
  ]);
  assert.equal(H.fimDaFaixa(l, 'habitos'), 'agora');
  assert.equal(H.fimDaFaixa(l, 'continuar'), null);
});

test('subir e descer trocam com o vizinho visível da mesma coluna, pulando escondidos', () => {
  const l = H.padrao(NATIVOS);
  const d = H.descer(l, 'continuar', todos(l));
  assert.deepEqual(H.faixas(d, todos(d))[1].colunas[1], ['caixa', 'continuar', 'revisar']);
  const oculto = H.esconder(l, 'caixa');
  const vis = new Set(ids(oculto).filter(id => id !== 'caixa'));
  const p = H.descer(oculto, 'continuar', vis);
  assert.deepEqual(p.cartoes.filter(c => c.coluna === 1 && c.largura === 'normal').map(c => c.id), ['revisar', 'caixa', 'continuar']);
  assert.equal(H.subir(l, 'habitos', todos(l)).cartoes[0].id, 'habitos');   // atravessa a frase inteira
  assert.equal(H.subir(H.subir(l, 'habitos', todos(l)), 'habitos', todos(l)).cartoes[0].id, 'habitos');   // já no topo: nada muda
});

test('esconder e mostrar; esconder o que não existe não muda nada', () => {
  const l = H.padrao(NATIVOS);
  const e = H.esconder(l, 'revisar');
  assert.deepEqual(e.ocultos, ['revisar']);
  assert.ok(ids(e).includes('revisar'));   // guarda posição e opções
  assert.equal(H.esconder(e, 'revisar'), e);
  assert.equal(H.esconder(l, 'fantasma'), l);
  assert.deepEqual(H.mostrar(e, 'revisar').ocultos, []);
});

test('definirLargura: inteira quebra as colunas no lugar do cartão', () => {
  const l = H.definirLargura(H.padrao(NATIVOS), 'agora', 'inteira');
  assert.deepEqual(H.faixas(l, todos(l)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [['habitos'], []] },
    { tipo: 'inteira', id: 'agora' },
    { tipo: 'colunas', colunas: [[], ['continuar', 'caixa', 'revisar']] },
  ]);
  assert.equal(H.definirLargura(l, 'agora', 'gigante'), l);
});

test('definirColunas: de 3 para 2 leva a terceira coluna para o fim da última', () => {
  let l = H.definirColunas(H.padrao(NATIVOS), 3);
  l = H.mover(l, 'caixa', { coluna: 2 });
  l = H.mover(l, 'revisar', { coluna: 2 });
  const dois = H.definirColunas(l, 2);
  assert.deepEqual(H.faixas(dois, todos(dois))[1].colunas, [['habitos', 'agora'], ['continuar', 'caixa', 'revisar']]);
  const um = H.definirColunas(dois, 1);
  assert.deepEqual(H.faixas(um, todos(um))[1].colunas, [['habitos', 'agora', 'continuar', 'caixa', 'revisar']]);
  assert.equal(H.definirColunas(um, 4), um);
  assert.equal(H.definirColunas(um, 1), um);
});

test('definirOpcao e opcoesEfetivas: só valor válido grava; padrão apaga a chave', () => {
  const l = H.padrao(NATIVOS);
  const a = H.definirOpcao(l, 'agora', 'limite', 5, [LIMITE]);
  assert.deepEqual(a.cartoes.find(c => c.id === 'agora').opcoes, { limite: 5 });
  assert.equal(H.definirOpcao(a, 'agora', 'limite', 99, [LIMITE]), a);        // fora da faixa
  assert.equal(H.definirOpcao(a, 'agora', 'limite', '5', [LIMITE]), a);       // tipo errado
  assert.equal(H.definirOpcao(a, 'agora', 'outra', 1, [LIMITE]), a);          // chave não declarada
  assert.deepEqual(H.definirOpcao(a, 'agora', 'limite', 0, [LIMITE]).cartoes.find(c => c.id === 'agora').opcoes, {});
  assert.deepEqual(H.opcoesEfetivas(a, 'agora', [LIMITE, SEMANA]), { limite: 5, semana: true });
  // Gravado inválido (declaração mudou numa versão nova do plug-in) volta ao padrão; chave velha some.
  const velho = { ...a, cartoes: a.cartoes.map(c => c.id === 'agora' ? { ...c, opcoes: { limite: 80, pasta: 'x', sobra: 1 } } : c) };
  assert.deepEqual(H.opcoesEfetivas(velho, 'agora', [LIMITE, PASTA]), { limite: 0, pasta: 'todas' });
});

test('valorValido cobre os quatro tipos', () => {
  assert.equal(H.valorValido(SEMANA, false), true);
  assert.equal(H.valorValido(SEMANA, 'false'), false);
  assert.equal(H.valorValido(LIMITE, 50), true);
  assert.equal(H.valorValido(LIMITE, NaN), false);
  assert.equal(H.valorValido(PASTA, 'trabalho'), true);
  assert.equal(H.valorValido(PASTA, 'casa'), false);
  const TEXTO = { key: 't', type: 'text', label: 'T', default: '' };
  assert.equal(H.valorValido(TEXTO, 'a'.repeat(80)), true);
  assert.equal(H.valorValido(TEXTO, 'a'.repeat(81)), false);
});

test('limpar: recusa lixo, corrige campos e descarta repetidos', () => {
  for (const lixo of [null, 1, 'x', [], {}, { cartoes: 'x' }]) assert.equal(H.limpar(lixo), null);
  const l = H.limpar({
    colunas: 7,
    cartoes: [
      { id: 'a', coluna: 1, largura: 'inteira', opcoes: { n: 1, o: { x: 1 } } },
      { id: 'a', coluna: 0 },
      { id: '', coluna: 0 }, null, 'b',
      { id: 'b', coluna: -1, largura: 'enorme', opcoes: [] },
    ],
    ocultos: ['b', 'b', 'fantasma'],
  });
  assert.deepEqual(l, {
    colunas: 2,
    cartoes: [{ id: 'a', coluna: 1, largura: 'inteira', opcoes: { n: 1 } }, { id: 'b', coluna: 0, largura: 'normal', opcoes: {} }],
    ocultos: ['b'],
  });
  const muitos = H.limpar({ colunas: 1, cartoes: Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, coluna: 0 })) });
  assert.equal(muitos.cartoes.length, 200);
});
