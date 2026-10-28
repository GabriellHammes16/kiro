const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.join(__dirname, '../examples/plugins/flashcards');
const model = require(path.join(dir, 'modelo.js'));

test('parser ignora cercas, exige delimitador espaçado, remove listas e deduplica por nota', () => {
  const body = ['- Capital? :: Brasília :: DF', '* Capital? :: Brasília :: DF', '1. Ano? :: 2026', 'Q::A', ' :: Vazio', 'Vazio :: ', '```js', 'Oculta :: Sim', '~~~~', 'Ainda oculta :: Sim', '```', '~~~', 'Oculta também :: Sim', '~~~', 'Final :: Visível'].join('\n');
  const cards = model.parse([{ id: 'n', title: 'Origem', body }, { id: 'outra', body: 'Capital? :: Brasília :: DF' }]);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map(c => c.question), ['Capital?', 'Ano?', 'Final', 'Capital?']);
  assert.equal(cards[0].answer, 'Brasília :: DF');
  assert.equal(cards[0].title, 'Origem');
  assert.equal(cards[0].id, JSON.stringify(['n', 'Capital?', 'Brasília :: DF']));
  assert.notEqual(cards[0].id, cards[3].id);
});

test('identidade estável; editar resposta cria cartão novo; cerca maior exige fechamento correspondente', () => {
  const parse = body => model.parse([{ id: 'n', body }]);
  assert.equal(parse('Q :: A')[0].id, parse('- Q :: A')[0].id);
  assert.notEqual(parse('Q :: A')[0].id, parse('Q :: B')[0].id);
  assert.equal(parse('````\nQ :: A\n```\nQ :: B\n````\nQ :: C').length, 1);
  assert.equal(parse('~~~\nQ :: A').length, 0);
});

test('lembrei segue dias locais até 30; errei volta a dez minutos e reinicia sequência', () => {
  const now = new Date(2026, 9, 24, 14, 32).getTime();
  let row;
  for (const days of [1, 3, 7, 14, 30, 30]) {
    row = model.schedule(row, true, now);
    const expected = new Date(now); expected.setDate(expected.getDate() + days);
    assert.equal(row.dueAt, expected.getTime());
    assert.equal(new Date(row.dueAt).getHours(), 14);
  }
  assert.equal(row.step, 5);
  row = model.schedule(row, false, now);
  assert.equal(row.dueAt, now + 600000);
  assert.equal(row.step, 0);
  assert.equal(row.revisions, 7);
  assert.equal(row.lastReviewedAt, now);
  assert.equal(model.schedule(row, true, now).step, 1);
});

test('persistência só grava progresso, preserva agenda e não aceita sucesso em falha', async () => {
  let saved = null;
  const storage = { get: async key => { assert.equal(key, model.KEY); return saved; }, set: async (key, rows) => { saved = JSON.parse(JSON.stringify(rows)); } };
  const cards = model.parse([{ id: 'n', body: 'Q :: A\nQ2 :: A2' }]);
  assert.equal(model.queue(cards, {}, 1000).length, 2);
  const rows = await model.review(storage, cards[0].id, false, 1000);
  assert.deepEqual(Object.keys(rows[cards[0].id]).sort(), ['dueAt', 'lastReviewedAt', 'revisions', 'step']);
  assert.deepEqual(model.queue(cards, model.progress(saved), 1001), [cards[1]]);
  assert.equal(model.queue(cards, rows, 601000).length, 2);
  const previous = JSON.stringify(saved);
  await assert.rejects(model.review({ ...storage, set: async () => { throw Error('Storage cheio'); } }, cards[0].id, true, 2000), /Storage cheio/);
  assert.equal(JSON.stringify(saved), previous);
  assert.deepEqual(Object.keys(model.progress({ bad: { dueAt: 'oops' } })), []);
});

test('manifesto e worker usam somente leitura, mesmo após require do modelo', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['notes:read']);
  assert.deepEqual(manifest.network, []);
  assert.equal(manifest.page.file, 'page.html');
  const worker = await import(require('node:url').pathToFileURL(path.join(dir, 'index.js')).href);
  let render;
  worker.default.activate({ panel: (id, title, fn) => { render = fn; }, notes: { list: async () => [{ id: 'n', body: 'Q :: A' }] }, storage: { get: async () => null } });
  const panel = await render();
  assert.match(panel.children[0].text, /1 cartão para revisar/);
  worker.default.activate({ panel: (id, title, fn) => { render = fn; }, notes: { list: async () => { throw Error('Leitura recusada'); } }, storage: { get: async () => null } });
  assert.match((await render()).text, /Leitura recusada/);
});

test('página mantém resposta e fila quando gravação falha, bloqueia duplo clique e permite retry', async () => {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', disabled: false, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {}, focus() {} });
    return elements.get(id);
  };
  let fail = true, writes = 0, saved;
  const api = { notes: { list: async () => [{ id: 'n', title: '<script>', body: 'Q :: <b>Resposta</b>' }] }, storage: { get: async () => saved, set: async (key, rows) => { writes++; if (fail) throw Error('Cheio'); saved = rows; } } };
  const context = { document: { getElementById: el }, kiro: { ready: Promise.resolve(api) }, KiroFlashcards: model, Date };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'page.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('answer').textContent, '');
  el('reveal').handlers.click();
  assert.equal(el('answer').textContent, '<b>Resposta</b>');
  const first = el('right').handlers.click();
  await el('right').handlers.click();
  await first;
  assert.equal(writes, 1);
  assert.equal(el('study').hidden, false);
  assert.equal(el('rating').hidden, false);
  assert.match(el('error').textContent, /não foi salva/);
  fail = false;
  await el('right').handlers.click();
  assert.equal(writes, 2);
  assert.equal(el('study').hidden, true);
  assert.equal(el('empty-title').textContent, 'Revisão concluída');
});
