const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fluxo.js');

const cartao = (id, extra = {}) => ({ id, type: 'text', text: id, x: 0, y: 0, width: 200, height: 60, ...extra });
const canvas = (nodes = [], edges = []) => ({ nodes, edges });

test('ler aceita JSON Canvas válido e preserva campos desconhecidos', () => {
  const bruto = { nodes: [cartao('a', { extra: 1 })], edges: [], 'x-obsidian': { v: 2 } };
  const { canvas: c, avisos } = F.ler(JSON.stringify(bruto));
  assert.deepEqual(c, bruto);
  assert.deepEqual(avisos, []);
});

test('ler trata arquivo vazio e {} como canvas vazio', () => {
  assert.deepEqual(F.ler('').canvas, { nodes: [], edges: [] });
  assert.deepEqual(F.ler('{}').canvas, { nodes: [], edges: [] });
  assert.deepEqual(F.ler('﻿{}').canvas, { nodes: [], edges: [] });
});

test('ler recusa JSON quebrado, formato errado, tipo desconhecido e id repetido', () => {
  assert.match(F.ler('{nope').erro, /JSON inválido/);
  assert.match(F.ler('[]').erro, /JSON Canvas/);
  assert.match(F.ler('{"nodes":{}}').erro, /listas/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { type: 'video' })]))).erro, /tipo desconhecido/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a'), cartao('a')]))).erro, /repetido/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { width: -1 })]))).erro, /tamanho/);
  assert.match(F.ler(JSON.stringify(canvas([{ ...cartao('a'), text: undefined }]))).erro, /texto/);
});

test('ler recusa cor que não é "1"–"6" nem #rrggbb (nada de CSS injetado)', () => {
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { color: 'red;background:url(x)' })]))).erro, /cor/);
  assert.equal(F.ler(JSON.stringify(canvas([cartao('a', { color: '#A1b2C3' })]))).erro, undefined);
  assert.equal(F.ler(JSON.stringify(canvas([cartao('a', { color: '4' })]))).erro, undefined);
});

test('ler ignora, com aviso, seta para cartão inexistente', () => {
  const r = F.ler(JSON.stringify(canvas([cartao('a')], [{ id: 's', fromNode: 'a', toNode: 'zzz' }])));
  assert.deepEqual(r.canvas.edges, []);
  assert.equal(r.avisos.length, 1);
});

test('ler recusa seta com lado ou ponta inválidos', () => {
  const dois = [cartao('a'), cartao('b')];
  assert.match(F.ler(JSON.stringify(canvas(dois, [{ id: 's', fromNode: 'a', toNode: 'b', fromSide: 'meio' }]))).erro, /lado/);
  assert.match(F.ler(JSON.stringify(canvas(dois, [{ id: 's', fromNode: 'a', toNode: 'b', toEnd: 'seta' }]))).erro, /ponta/);
});

test('serializar usa tabulação e volta igual pelo ler', () => {
  const c = canvas([cartao('a')], []);
  const texto = F.serializar(c);
  assert.match(texto, /\n\t"nodes"/);
  assert.deepEqual(F.ler(texto).canvas, c);
});

test('adicionarCartao cria id novo de 16 hex; não muta o original', () => {
  const c = canvas([cartao('a')]);
  const { canvas: c2, id } = F.adicionarCartao(c, { type: 'text', text: '', x: 0, y: 0, width: 260, height: 60 });
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(c.nodes.length, 1);
  assert.equal(c2.nodes.at(-1).id, id);
});

test('mover, redimensionar (com mínimo) e editar cartão', () => {
  let c = canvas([cartao('a'), cartao('b')]);
  c = F.moverCartoes(c, ['a'], 20, -40);
  assert.deepEqual([c.nodes[0].x, c.nodes[0].y, c.nodes[1].x], [20, -40, 0]);
  c = F.redimensionar(c, 'a', 10, 10);
  assert.deepEqual([c.nodes[0].width, c.nodes[0].height], [80, 40]);
  c = F.editarCartao(c, 'a', { color: '2', text: 'novo' });
  assert.equal(c.nodes[0].color, '2');
  c = F.editarCartao(c, 'a', { color: undefined });
  assert.equal('color' in c.nodes[0], false);
});

test('removerCartoes leva junto as setas ligadas', () => {
  let c = canvas([cartao('a'), cartao('b'), cartao('c')], [{ id: 's1', fromNode: 'a', toNode: 'b' }, { id: 's2', fromNode: 'b', toNode: 'c' }]);
  c = F.removerCartoes(c, ['a']);
  assert.deepEqual(c.nodes.map(n => n.id), ['b', 'c']);
  assert.deepEqual(c.edges.map(e => e.id), ['s2']);
});

test('duplicarCartoes copia cartões e as setas entre eles, com ids novos', () => {
  const c = canvas([cartao('a'), cartao('b'), cartao('c')], [{ id: 's1', fromNode: 'a', toNode: 'b' }, { id: 's2', fromNode: 'b', toNode: 'c' }]);
  const r = F.duplicarCartoes(c, ['a', 'b']);
  assert.equal(r.canvas.nodes.length, 5);
  assert.equal(r.canvas.edges.length, 3);
  const nova = r.canvas.edges.at(-1);
  assert.deepEqual([nova.fromNode, nova.toNode], r.ids);
  assert.equal(r.canvas.nodes.at(-1).x, 40);
});

test('ligar recusa ligar um cartão a ele mesmo ou a cartão inexistente', () => {
  const c = canvas([cartao('a'), cartao('b')]);
  assert.equal(F.ligar(c, { fromNode: 'a', toNode: 'a' }).id, null);
  assert.equal(F.ligar(c, { fromNode: 'a', toNode: 'x' }).id, null);
  const r = F.ligar(c, { fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' });
  assert.match(r.id, /^[0-9a-f]{16}$/);
  assert.deepEqual(r.canvas.edges[0], { fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', id: r.id });
});

test('editarSeta e removerSetas', () => {
  let c = canvas([cartao('a'), cartao('b')], [{ id: 's', fromNode: 'a', toNode: 'b' }]);
  c = F.editarSeta(c, 's', { label: 'causa', toEnd: 'none' });
  assert.equal(c.edges[0].label, 'causa');
  c = F.editarSeta(c, 's', { label: undefined });
  assert.equal('label' in c.edges[0], false);
  assert.deepEqual(F.removerSetas(c, ['s']).edges, []);
});

test('encaixar arredonda para a grade de 20', () => {
  assert.equal(F.encaixar(29), 20);
  assert.equal(F.encaixar(31), 40);
  assert.equal(F.encaixar(-31), -40);
});

test('histórico: desfazer e refazer; mudança nova limpa o refazer; limite de 100', () => {
  const c0 = canvas(), c1 = canvas([cartao('a')]), c2 = canvas([cartao('a'), cartao('b')]);
  let h = F.empilhar(F.empilhar(F.historicoVazio(), c0), c1);   // atual = c2
  let r = F.desfazer(h, c2);
  assert.equal(r.canvas, c1);
  r = F.desfazer(r.historico, r.canvas);
  assert.equal(r.canvas, c0);
  assert.equal(F.desfazer(r.historico, r.canvas), null);
  const volta = F.refazer(r.historico, r.canvas);
  assert.equal(volta.canvas, c1);
  assert.deepEqual(F.empilhar(volta.historico, c1).depois, []);
  for (let i = 0; i < 150; i++) h = F.empilhar(h, c0);
  assert.equal(h.antes.length, 100);
});

test('paraCanvas desfaz translação e zoom', () => {
  assert.deepEqual(F.paraCanvas({ x: 100, y: 50, zoom: 2 }, 300, 250), { x: 100, y: 100 });
});

test('zoomEm mantém o ponto sob o cursor e respeita os limites', () => {
  const v = { x: 10, y: 20, zoom: 1 };
  const z = F.zoomEm(v, 2, 110, 120);
  assert.deepEqual(F.paraCanvas(z, 110, 120), F.paraCanvas(v, 110, 120));
  assert.equal(z.zoom, 2);
  assert.equal(F.zoomEm(v, 100, 0, 0).zoom, F.ZOOM.max);
  assert.equal(F.zoomEm(v, 0.0001, 0, 0).zoom, F.ZOOM.min);
});

test('vistaValida recusa lixo do localStorage', () => {
  assert.equal(F.vistaValida({ x: 0, y: 0, zoom: 1 }), true);
  for (const v of [null, 'x', { x: 0, y: 0 }, { x: 0, y: 0, zoom: 9 }, { x: NaN, y: 0, zoom: 1 }]) assert.equal(F.vistaValida(v), false);
});

test('enquadrar centraliza tudo, sem ampliar além de 100%', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 100 }), cartao('b', { x: 300, y: 100, width: 100, height: 100 })];
  const v = F.enquadrar(nodes, 1000, 800);
  assert.equal(v.zoom, 1);
  const centro = F.paraCanvas(v, 500, 400);
  assert.deepEqual(centro, { x: 200, y: 100 });
  assert.ok(F.enquadrar(nodes, 200, 200).zoom < 1);
  assert.deepEqual(F.enquadrar([], 1000, 800), { x: 500, y: 400, zoom: 1 });
});

test('pontoDoLado, ladoMaisProximo e ladosDaSeta', () => {
  const n = cartao('a', { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(F.pontoDoLado(n, 'right'), { x: 200, y: 50 });
  assert.deepEqual(F.pontoDoLado(n, 'top'), { x: 100, y: 0 });
  assert.equal(F.ladoMaisProximo(n, { x: 500, y: 60 }), 'right');
  assert.equal(F.ladoMaisProximo(n, { x: 90, y: 400 }), 'bottom');
  const b = cartao('b', { x: 400, y: 0, width: 200, height: 100 });
  assert.deepEqual(F.ladosDaSeta(n, b), ['right', 'left']);
  assert.deepEqual(F.ladosDaSeta(b, n), ['left', 'right']);
  assert.deepEqual(F.ladosDaSeta(n, { ...b, x: 0, y: 400 }), ['bottom', 'top']);
});

test('caminhoDaSeta sai e chega pelos lados, com o meio entre as pontas', () => {
  const { d, meio } = F.caminhoDaSeta({ x: 0, y: 0 }, 'right', { x: 300, y: 0 }, 'left');
  assert.match(d, /^M0 0 C100 0 200 0 300 0$/);
  assert.deepEqual(meio, { x: 150, y: 0 });
});

test('geometriaDaSeta usa os lados gravados ou calcula; seta órfã dá null', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 100 }), cartao('b', { x: 400, y: 0, width: 100, height: 100 })];
  assert.match(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'b' }).d, /^M100 50 /);
  assert.match(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'b', fromSide: 'top' }).d, /^M50 0 /);
  assert.equal(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'x' }), null);
});

test('dentro acha cartões que tocam o retângulo, em qualquer sentido de arraste', () => {
  const nodes = [cartao('a', { x: 0, y: 0 }), cartao('b', { x: 500, y: 500 })];
  assert.deepEqual(F.dentro(nodes, { x: 250, y: 100, width: -300, height: -200 }), ['a']);
  assert.deepEqual(F.dentro(nodes, { x: -10, y: -10, width: 1000, height: 1000 }), ['a', 'b']);
});

const domain = require('../domain.js');
const estado = (fluxos, extra = {}) => ({ notes: [{ id: 'n1', title: 'Nota', body: '', links: [], updatedAt: 1 }], tasks: [], folders: [{ id: 'p1', title: 'Pasta', parentId: '' }], fluxos, ...extra });

test('validateState aceita fluxos ausentes, com canvas ou com erro', () => {
  assert.doesNotThrow(() => domain.validateState(estado(undefined)));
  assert.doesNotThrow(() => domain.validateState(estado([{ id: 'f1', title: 'Mapa', folderId: 'p1', canvas: { nodes: [], edges: [] } }])));
  assert.doesNotThrow(() => domain.validateState(estado([{ id: 'f1', title: 'Quebrado', erro: 'JSON inválido' }])));
});

test('validateState recusa fluxo malformado', () => {
  const ruins = [
    'x',
    [{ id: 'n1', title: 'Mesmo id da nota', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: '', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Sem canvas' }],
    [{ id: 'f1', title: 'Canvas torto', canvas: { nodes: {} , edges: [] } }],
    [{ id: 'f1', title: 'Pasta que não existe', folderId: 'p9', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Arquivo fora', file: '../x.canvas', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Extensão errada', file: 'x.md', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'A', canvas: { nodes: [], edges: [] } }, { id: 'f1', title: 'B', canvas: { nodes: [], edges: [] } }],
  ];
  for (const fluxos of ruins) assert.throws(() => domain.validateState(estado(fluxos)), /inválidos/, JSON.stringify(fluxos));
});

test('renomearArquivos troca o caminho dos cartões de arquivo; sem mudança devolve o mesmo objeto', () => {
  const c = canvas([cartao('t'), { id: 'n', type: 'file', file: 'A/nota.md', x: 0, y: 0, width: 400, height: 280 }, { id: 'i', type: 'file', file: 'anexos/x.png', x: 0, y: 0, width: 10, height: 10 }]);
  const mapa = { 'A/nota.md': 'B/nota.md' };
  const r = F.renomearArquivos(c, f => mapa[f]);
  assert.equal(r.nodes[1].file, 'B/nota.md');
  assert.equal(r.nodes[2], c.nodes[2]);
  assert.equal(F.renomearArquivos(c, () => undefined), c);
  assert.equal(F.renomearArquivos(c, f => f), c);
});

test('renomearArquivos ignora nó nulo ou sem arquivo em vez de estourar', () => {
  const c = canvas([null, { id: 'x', type: 'file' }]);
  assert.doesNotThrow(() => F.renomearArquivos(c, () => 'novo.png'));
  assert.equal(F.renomearArquivos(c, () => 'novo.png'), c);
});

test('caminhoSeguro recusa subir pastas, raiz do disco e vazio', () => {
  for (const ok of ['anexos/x.png', 'A/B/nota.md', 'x.png']) assert.equal(F.caminhoSeguro(ok), true, ok);
  for (const ruim of ['', '../x.png', 'a/../../x.png', '/etc/x.png', '\\x.png', 'C:/x.png', 'c:\\x.png', undefined, 3]) assert.equal(F.caminhoSeguro(ruim), false, String(ruim));
});

test('ehImagem usa as mesmas extensões das notas', () => {
  for (const s of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.avif', 'g.bmp']) assert.equal(F.ehImagem(s), true, s);
  for (const n of ['a.md', 'a.svg', 'png', '', undefined]) assert.equal(F.ehImagem(n), false, String(n));
});

test('contidos acha só os cartões inteiramente dentro do grupo', () => {
  const g = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 400 };
  const dentro = cartao('a', { x: 20, y: 20, width: 100, height: 60 });
  const metade = cartao('b', { x: 450, y: 20, width: 100, height: 60 });
  const fora = cartao('c', { x: 900, y: 900 });
  assert.deepEqual(F.contidos([g, dentro, metade, fora], g), ['a']);
});

test('caixaDe envolve os cartões com margem', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 50 }), cartao('b', { x: 200, y: 100, width: 100, height: 50 })];
  assert.deepEqual(F.caixaDe(nodes), { x: -40, y: -40, width: 380, height: 230 });
  assert.deepEqual(F.caixaDe(nodes, 0), { x: 0, y: 0, width: 300, height: 150 });
});

test('alturaEstimada: ~40 caracteres por linha, 24 px por linha, entre 60 e 600', () => {
  assert.equal(F.alturaEstimada('curto'), 60);
  assert.equal(F.alturaEstimada('a'.repeat(120)), 72 + 24);           // 3 linhas de texto + margem de uma linha
  assert.equal(F.alturaEstimada('um\ndois\ntres\nquatro'), 4 * 24 + 24);
  assert.equal(F.alturaEstimada('a'.repeat(10000)), 600);
});

test('fluxosQueCitam: cartão com o caminho da nota (sem diferenciar maiúsculas) ou [[link]] em cartão de texto', () => {
  const notas = [{ id: 'n1', title: 'Alvo', body: '', file: 'A/alvo-n1.md', links: [], updatedAt: 1 }, { id: 'n2', title: 'Outra', body: '', file: 'outra-n2.md', links: [], updatedAt: 1 }];
  const f = (id, nodes) => ({ id, title: id, canvas: { nodes, edges: [] } });
  const state = { notes: notas, fluxos: [
    f('f1', [{ id: 'a', type: 'file', file: 'a/ALVO-N1.md', x: 0, y: 0, width: 1, height: 1 }]),
    f('f2', [cartao('b', { text: 'veja [[Alvo]] aqui' })]),
    f('f3', [cartao('c', { text: '[[Outra]]' })]),
    { id: 'f4', title: 'Quebrado', erro: 'JSON inválido' },
  ] };
  assert.deepEqual(domain.fluxosQueCitam(state, notas[0]).map(x => x.id), ['f1', 'f2']);
  assert.deepEqual(domain.fluxosQueCitam({ notes: notas }, notas[0]), []);
  assert.deepEqual(domain.fluxosQueCitam(state, { title: 'Rascunho' }), []);
  // Fluxo importado pode ter nós nulos: validateState só checa Array.isArray
  const stateComNulo = { notes: notas, fluxos: [
    f('f5', [null, undefined, { id: 'a', type: 'file', file: 'a/ALVO-N1.md', x: 0, y: 0, width: 1, height: 1 }]),
  ] };
  assert.deepEqual(domain.fluxosQueCitam(stateComNulo, notas[0]).map(x => x.id), ['f5']);
});

// ---- Etapa 3: layout ----
const caixa = (id, width = 280, height = 60) => ({ id, width, height });
const seta = (fromNode, toNode) => ({ fromNode, toNode });
const posicoesDe = mapa => Object.fromEntries([...mapa].map(([id, p]) => [id, p]));

test('tamanhoPadrao: texto 280 × altura estimada na grade; nota, imagem, link e grupo com os tamanhos da tela', () => {
  assert.deepEqual(F.tamanhoPadrao({ type: 'text', text: 'curto' }), { width: 280, height: 60 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'text', text: 'x'.repeat(100) }), { width: 280, height: 100 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'file', file: 'Estudos/Python.md' }), { width: 400, height: 280 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'file', file: 'anexos/foto.png' }), { width: 320, height: 240 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'link', url: 'https://a.b' }), { width: 320, height: 100 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'group' }), { width: 400, height: 300 });
});

test('layout: colunas da esquerda para a direita, pai centrado no ramo, irmãos a 20 px, na grade', () => {
  const nodes = [caixa('r'), caixa('a', 280, 100), caixa('b'), caixa('a1', 280, 140), caixa('a2')];
  const edges = [seta('r', 'a'), seta('r', 'b'), seta('a', 'a1'), seta('a', 'a2')];
  // Ramo de a = 140 + 20 + 60 = 220; ramo de r = 220 + 20 + 60 = 300.
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), {
    r: { x: 0, y: 120 },
    a: { x: 360, y: 60 },
    b: { x: 360, y: 240 },
    a1: { x: 720, y: 0 },
    a2: { x: 720, y: 160 },
  });
});

test('layout: raiz implícita é o primeiro sem seta chegando; raiz explícita manda', () => {
  const nodes = [caixa('b'), caixa('a')];
  const edges = [seta('a', 'b')];
  assert.equal(F.raizDe(nodes, edges), 'a');
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), { a: { x: 0, y: 0 }, b: { x: 360, y: 0 } });
  // Com raiz "b", "a" não é alcançado pelas setas e vai para a fileira de baixo.
  assert.deepEqual(posicoesDe(F.layout(nodes, edges, { raiz: 'b' })), { b: { x: 0, y: 0 }, a: { x: 0, y: 140 } });
});

test('layout: ciclo não trava; só a primeira seta que alcança o cartão conta', () => {
  const nodes = [caixa('a'), caixa('b'), caixa('c')];
  const edges = [seta('a', 'b'), seta('b', 'c'), seta('c', 'a')];
  assert.equal(F.raizDe(nodes, edges), 'a');   // todos têm seta chegando: o primeiro
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), { a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, c: { x: 720, y: 0 } });
});

test('layout: cartões fora da árvore ficam numa fileira embaixo; vazio não quebra', () => {
  const nodes = [caixa('a'), caixa('b'), caixa('c'), caixa('d')];
  assert.deepEqual(posicoesDe(F.layout(nodes, [seta('a', 'b')])), {
    a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, c: { x: 0, y: 140 }, d: { x: 300, y: 140 },
  });
  assert.equal(F.layout([], []).size, 0);
});

test('layout: nenhum cartão se sobrepõe, mesmo com alturas fora da grade', () => {
  const nodes = [caixa('r', 280, 70), caixa('a', 280, 130), caixa('b', 280, 50), caixa('c', 280, 90),
    caixa('a1', 280, 110), caixa('a2', 280, 30), caixa('c1', 280, 250), caixa('solto', 280, 45)];
  const edges = [seta('r', 'a'), seta('r', 'b'), seta('r', 'c'), seta('a', 'a1'), seta('a', 'a2'), seta('c', 'c1')];
  const pos = F.layout(nodes, edges);
  const postos = nodes.map(n => ({ ...n, ...pos.get(n.id) }));
  for (let i = 0; i < postos.length; i++) for (let j = i + 1; j < postos.length; j++) {
    const [p, q] = [postos[i], postos[j]];
    assert.ok(!(p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height), `${p.id} e ${q.id} se sobrepõem`);
  }
  for (const p of postos) assert.ok(p.x % 20 === 0 && p.y % 20 === 0, `${p.id} fora da grade`);
});
