const test = require('node:test');
const assert = require('node:assert/strict');
const { mesclarEstados } = require('../domain.js');

// base = o que a janela leu; local = a janela agora; disco = o cofre agora (mudado por outro programa).
const nota = (id, body, extra = {}) => ({ id, title: id, body, links: [], tags: [], folderId: '', updatedAt: 1, file: `${id}.md`, ...extra });
const tarefa = (id, extra = {}) => ({ id, title: id, due: '2026-10-04', priority: 'Média', done: false, ...extra });
const estado = (extra = {}) => ({ notes: [], tasks: [], habits: [], habitLog: {}, folders: [], fluxos: [], revision: 'r1', ...extra });

test('outro programa escreve numa nota e a janela cria uma tarefa: fica o texto do disco e a tarefa nova', () => {
  const base = estado({ notes: [nota('mira', 'linha 1')] });
  const local = estado({ notes: [nota('mira', 'linha 1')], tasks: [tarefa('t1')] });
  const disco = estado({ notes: [nota('mira', 'linha 1\nerro 2', { updatedAt: 9 })], revision: 'r2' });
  const r = mesclarEstados(base, local, disco);
  assert.deepEqual(r.conflitos, []);
  assert.equal(r.estado.notes[0].body, 'linha 1\nerro 2', 'não sobrescreve o que o outro programa escreveu');
  assert.deepEqual(r.estado.tasks.map(t => t.id), ['t1']);
  assert.equal(r.estado.revision, 'r2');
});

test('a janela edita uma nota que ninguém mais tocou: vale a edição da janela', () => {
  const base = estado({ notes: [nota('a', 'antes'), nota('mira', 'x')] });
  const local = estado({ notes: [nota('a', 'depois'), nota('mira', 'x')] });
  const disco = estado({ notes: [nota('a', 'antes'), nota('mira', 'x y')] });
  const r = mesclarEstados(base, local, disco);
  assert.deepEqual(r.conflitos, []);
  assert.deepEqual(r.estado.notes.map(n => n.body), ['depois', 'x y']);
});

test('a mesma nota mudou dos dois lados de jeitos diferentes: conflito (nada é escolhido em silêncio)', () => {
  const base = estado({ notes: [nota('a', 'antes')] });
  const r = mesclarEstados(base, estado({ notes: [nota('a', 'minha versão')] }), estado({ notes: [nota('a', 'versão de fora')] }));
  assert.deepEqual(r.conflitos.map(c => c.id), ['a']);
  // Mudança igual dos dois lados não é conflito.
  assert.deepEqual(mesclarEstados(base, estado({ notes: [nota('a', 'igual')] }), estado({ notes: [nota('a', 'igual')] })).conflitos, []);
});

test('apagar e criar: de cada lado vale o que só aquele lado fez', () => {
  const base = estado({ notes: [nota('some-aqui', 'x'), nota('some-la', 'y')], tasks: [tarefa('t')] });
  const local = estado({ notes: [nota('some-la', 'y'), nota('nova-aqui', 'n')], tasks: [tarefa('t', { done: true })] });
  const disco = estado({ notes: [nota('some-aqui', 'x'), nota('nova-la', 'm')], tasks: [tarefa('t')] });
  const r = mesclarEstados(base, local, disco);
  assert.deepEqual(r.conflitos, []);
  assert.deepEqual(r.estado.notes.map(n => n.id).sort(), ['nova-aqui', 'nova-la']);
  assert.equal(r.estado.tasks[0].done, true);
  // Apagada de fora e editada aqui: conflito.
  const c = mesclarEstados(estado({ notes: [nota('a', '1')] }), estado({ notes: [nota('a', '2')] }), estado());
  assert.deepEqual(c.conflitos.map(x => x.id), ['a']);
});

test('registro de hábitos mescla por hábito', () => {
  const base = estado({ habitLog: { h1: ['2026-10-01'], h2: [] } });
  const local = estado({ habitLog: { h1: ['2026-10-01', '2026-10-02'], h2: [] } });
  const disco = estado({ habitLog: { h1: ['2026-10-01'], h2: ['2026-10-02'] } });
  const r = mesclarEstados(base, local, disco);
  assert.deepEqual(r.conflitos, []);
  assert.deepEqual(r.estado.habitLog, { h1: ['2026-10-01', '2026-10-02'], h2: ['2026-10-02'] });
});
