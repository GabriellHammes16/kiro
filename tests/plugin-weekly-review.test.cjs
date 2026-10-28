const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../examples/plugins/weekly-review/modelo.js');

test('janela usa sete dias locais e inclui hoje e o limite inicial', () => {
  const now = new Date(2026, 9, 24, 15);
  assert.deepEqual(model.windowDates(now), { start: '2026-10-18', end: '2026-10-24' });
  const data = model.collect([
    { id: 'a', title: 'Hoje', updatedAt: new Date(2026, 9, 24, 2).getTime() },
    { id: 'b', title: 'Limite', updatedAt: new Date(2026, 9, 18, 23).getTime() },
    { id: 'c', title: 'Fora', updatedAt: new Date(2026, 9, 17, 23).getTime() },
  ], [
    { id: '1', title: 'Passou', due: '2026-10-23', done: false },
    { id: '2', title: 'Hoje', due: '2026-10-24', done: false },
    { id: '3', title: 'Futuro', due: '2026-10-25', done: false },
    { id: '4', title: 'Feita', due: '2026-10-23', done: true },
    { id: '5', title: 'Sem data', done: false },
  ], now);
  assert.deepEqual(data.notes.map(n => n.id), ['a', 'b']);
  assert.deepEqual(data.overdue.map(t => t.id), ['1']);
  assert.deepEqual(data.today.map(t => t.id), ['2']);
  assert.deepEqual(data.future.map(t => t.id), ['3']);
  assert.equal(data.tasks.length, 4);
});

test('markdown neutraliza títulos de links, preserva texto de tarefa e reflexões', () => {
  const task = { title: 'Rever [plano] :: hoje', due: '2026-10-24' };
  const body = model.markdown({ start: '2026-10-18', end: '2026-10-24', notes: [{ title: 'A ] [B|C\\D' }], tasks: [task], overdue: [], today: [task], future: [] }, { advanced: 'Feito <rascunho>', pending: '', priority: 'Fechar semana' });
  assert.ok(body.includes(String.raw`A \] \[B|C\\D`));
  assert.doesNotMatch(body, /\[\[A/);
  assert.match(body, /Rever \[plano\] :: hoje/);
  assert.match(body, /Feito <rascunho>/);
  assert.match(model.markdown({ start: 'a', end: 'b', notes: [], tasks: [], overdue: [], today: [], future: [] }, { advanced: 'linha 1\nlinha 2' }), /linha 1\nlinha 2/);
  assert.match(body, /O que ficou pendente\n—/);
});

test('createReview cria apenas nota nova, bloqueia concorrência e libera retry após falha', async () => {
  let calls = 0, release;
  const api = { notes: { create: async note => { calls++; await new Promise(resolve => { release = resolve; }); return { title: note.title }; } } };
  const a = model.createReview(api, 'conteúdo', new Date(2026, 9, 24, 12));
  const b = model.createReview(api, 'outro', new Date(2026, 9, 24, 12));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.title, second.title);
  assert.match(first.title, /^Revisão semanal 2026-10-24 12-00-00-\d{3}$/);
  assert.deepEqual(Object.keys(api.notes), ['create']);
  let attempts = 0;
  const retryApi = { notes: { create: async note => { attempts++; if (attempts === 1) throw new Error('disco'); return note; } } };
  await assert.rejects(model.createReview(retryApi, 'mantido'), /disco/);
  const saved = await model.createReview(retryApi, 'mantido');
  assert.equal(attempts, 2);
  assert.equal(saved.body, 'mantido');
});

test('frame waits for runtime and offers retry after save errors', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../examples/plugins/weekly-review/page.js'), 'utf8');
  assert.match(source, /globalThis\.kiro\.ready\.then/);
  assert.match(source, /Suas reflexões continuam aqui/);
  assert.match(source, /saving \|\| saved/);
});

test('page unlocks a new note after edits and locks inputs while saving', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const elements = new Map();
  const makeElement = () => ({ value: '', textContent: '', disabled: false, dataset: {}, children: [], listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; } });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }, createElement: makeElement };
  let resolveCreate;
  const created = [];
  const api = { notes: { list: async () => [], create: note => { created.push(note); return new Promise(resolve => { resolveCreate = () => resolve(note); }); } }, tasks: { list: async () => [] } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../examples/plugins/weekly-review/page.js'), 'utf8'), {
    document, KiroWeeklyReview: model, kiro: { ready: Promise.resolve(api) }, Date, Promise, String,
  });
  await new Promise(resolve => setImmediate(resolve));
  const input = elements.get('advanced'), saveButton = elements.get('salvar'), refresh = elements.get('atualizar');
  input.value = 'primeira'; input.listeners.input();
  const firstSave = saveButton.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.disabled, true); assert.equal(refresh.disabled, true); assert.equal(created.length, 1);
  resolveCreate(); await firstSave;
  assert.equal(saveButton.disabled, true);
  input.value = 'segunda'; input.listeners.input();
  assert.equal(saveButton.disabled, false);
  assert.match(elements.get('status').textContent, /Alterações ainda não salvas/);
  const secondSave = saveButton.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created.length, 2);
  assert.notEqual(created[0].title, created[1].title);
  resolveCreate(); await secondSave;
  assert.equal(created[1].body.includes('segunda'), true);
});

test('worker registers command and panel, and command creates a tagged new note', async () => {
  const { default: plugin } = await import('../examples/plugins/weekly-review/index.js');
  const commands = [], panels = [], created = [];
  const api = {
    notes: { list: async () => [{ id: 'n', title: 'Nota', updatedAt: Date.now() }], create: async note => { created.push(note); return note; } },
    tasks: { list: async () => [{ id: 't', title: 'Tarefa', done: false }] },
    command: (...args) => commands.push(args), panel: (...args) => panels.push(args), notify() {},
  };
  await plugin.activate(api);
  assert.equal(commands[0][0], 'gerar');
  await commands[0][2]();
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].tags, ['revisao-semanal']);
  assert.match(created[0].body, /\[\[Nota\]\]/);
  assert.equal(panels[0][0], 'resumo');
  assert.equal((await panels[0][2]()).type, 'stack');
});
