const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../examples/plugins/focus-pomodoro/modelo.js');
const settings = { foco: 25, pausa: 5 };
const start = () => M.transition(M.initial(settings), 'toggle', settings, 1000, 'cycle1', { id: 't1', title: 'Escrever' });
test('foco: manifesto valido e permissoes minimas', () => {
  const manifest = require('../examples/plugins/focus-pomodoro/manifest.json');
  const result = require('../plugins.js').validarManifesto(manifest, { versaoDoKiro: '0.20.3' });
  assert.equal(result.ok, true, result.erro);
  assert.deepEqual(manifest.permissions, ['tasks:read', 'notes:read']);
  assert.deepEqual(manifest.network, []);
});
test('foco: pausar e retomar conserva restante e settings da sessao ativa', () => {
  const paused = M.transition(start(), 'toggle', settings, 61000, 'pause');
  assert.equal(paused.remainingMs, 24 * 60000); assert.equal(paused.deadline, null);
  const resumed = M.transition(paused, 'toggle', { foco: 1, pausa: 1 }, 120000, 'resume');
  assert.equal(resumed.deadline, 120000 + 24 * 60000);
  assert.equal(resumed.durationMs, 25 * 60000); assert.equal(resumed.cycleId, 'cycle1');
});
test('foco: deadline atrasado registra uma sessao, pausa aguarda e reload nao duplica', () => {
  const active = start();
  const complete = M.transition(active, 'complete', settings, active.deadline + 999999, 'done');
  assert.equal(complete.status, 'ready'); assert.equal(complete.phase, 'break');
  assert.equal(complete.history.length, 1); assert.equal(complete.history[0].completedAt, active.deadline);
  assert.equal(complete.history[0].task.title, 'Escrever');
  const reload = M.read(JSON.parse(JSON.stringify(complete)), settings);
  assert.strictEqual(M.transition(reload, 'complete', settings, 99999999, 'again'), reload);
  const pause = M.transition(complete, 'toggle', settings, 10000000, 'break');
  const next = M.transition(pause, 'complete', settings, pause.deadline, 'next');
  assert.equal(next.phase, 'focus'); assert.equal(next.status, 'ready'); assert.equal(next.history.length, 1);
});
test('foco: cancelar nao registra; historico guarda ultimas 200', () => {
  assert.equal(M.transition(start(), 'cancel', settings, 2000, 'cancel').history.length, 0);
  const active = start(); active.history = Array.from({ length: 200 }, (_, i) => ({ id: `old${i}`, completedAt: 100, durationMs: 60000 }));
  const done = M.transition(active, 'complete', settings, active.deadline, 'done');
  assert.equal(done.history.length, 200); assert.equal(done.history[0].id, 'old1');
  assert.equal(done.history.at(-1).id, 'cycle1');
});
test('foco: storage falho preserva estado; revisao posterior nao e sobrescrita', async () => {
  let saved = start(), writes = 0;
  const next = M.transition(saved, 'complete', settings, saved.deadline, 'done');
  const storage = { get: async () => saved, set: async () => { writes++; throw new Error('cheio'); } };
  await assert.rejects(M.commit(storage, saved, next, settings), /cheio/);
  assert.equal(saved.history.length, 0); assert.equal(writes, 1);
  const old = saved; saved = next;
  await assert.rejects(M.commit(storage, old, next, settings), error => error.latest === next);
  assert.equal(writes, 1);
});
test('foco: grava chave unica com estado e historico por transicao', async () => {
  const old = start(), next = M.transition(old, 'complete', settings, old.deadline, 'done');
  let writes = 0;
  const storage = { get: async key => { assert.equal(key, 'timer'); return old; }, set: async (key, value) => { writes++; assert.equal(key, 'timer'); assert.strictEqual(value, next); } };
  assert.strictEqual(await M.commit(storage, old, next, settings), next); assert.equal(writes, 1);
  assert.throws(() => M.read({ phase: 'bad' }, settings), /preservados/);
});
test('foco relatorio: periodo corta hoje, 7 e 30 dias em meia-noite local', () => {
  const now = new Date(2026, 9, 25, 15, 30).getTime();
  const at = (dias, h = 10) => new Date(2026, 9, 25 - dias, h).getTime();
  assert.equal(M.inicioPeriodo('hoje', now), new Date(2026, 9, 25).getTime());
  assert.equal(M.inicioPeriodo('semana', now), new Date(2026, 9, 19).getTime());
  assert.equal(M.inicioPeriodo('mes', now), new Date(2026, 8, 26).getTime());
  const history = [
    { id: 'a', task: null, durationMs: 25 * 60000, completedAt: at(0, 9) },
    { id: 'b', task: null, durationMs: 25 * 60000, completedAt: at(1) },
    { id: 'c', task: null, durationMs: 25 * 60000, completedAt: at(6) },
    { id: 'd', task: null, durationMs: 25 * 60000, completedAt: at(7) },
    { id: 'e', task: null, durationMs: 25 * 60000, completedAt: at(29) },
    { id: 'f', task: null, durationMs: 25 * 60000, completedAt: at(30) },
  ];
  const minutos = periodo => M.relatorio(history, () => null, periodo, now).total;
  assert.equal(minutos('hoje'), 25);
  assert.equal(minutos('semana'), 75);
  assert.equal(minutos('mes'), 125);
});
test('foco relatorio: foco livre e tarefas removidas conservam o tempo sem inventar classificação', () => {
  const now = new Date(2026, 9, 25, 18).getTime();
  const history = [
    { id: 'a', task: null, durationMs: 60 * 60000, completedAt: now - 1000 },
    { id: 'b', task: { id: 't1', title: 'Escrever' }, durationMs: 30 * 60000, completedAt: now - 2000 },
    { id: 'c', task: { id: 't2', title: 'Apagada' }, durationMs: 15 * 60000, completedAt: now - 3000 },
  ];
  const lookup = id => (id === 't1' ? { folder: 'Projetos/Kiro', tags: ['foco', 'código'] } : null);
  const r = M.relatorio(history, lookup, 'hoje', now);
  assert.equal(r.total, 105);
  assert.deepEqual(r.porPasta, [
    { nome: 'Sem tarefa', minutos: 60 },
    { nome: 'Projetos/Kiro', minutos: 30 },
    { nome: 'Sem classificação', minutos: 15 },
  ]);
  assert.deepEqual(r.porTag, [
    { nome: 'código', minutos: 30 },
    { nome: 'foco', minutos: 30 },
  ]);
});

test('foco relatorio: nota na raiz e tags repetidas não duplicam a pasta nem o total', () => {
  const now = Date.now();
  const history = [{ id: 'a', task: { id: 't1' }, durationMs: 90 * 60000, completedAt: now }];
  const before = JSON.stringify(history);
  const report = M.relatorio(history, () => ({ folder: '', tags: ['foco', 'foco', 'estudo'] }), 'hoje', now);
  assert.equal(report.total, 90);
  assert.deepEqual(report.porPasta, [{ nome: 'Sem pasta', minutos: 90 }]);
  assert.deepEqual(report.porTag, [{ nome: 'estudo', minutos: 90 }, { nome: 'foco', minutos: 90 }]);
  assert.equal(JSON.stringify(history), before);
});

test('foco relatorio: legado sem tarefa é livre; registros inválidos e futuros não entram', () => {
  const now = Date.now();
  const history = [
    { id: 'legado', durationMs: 25 * 60000, completedAt: now },
    { durationMs: 60000 },
    { durationMs: -60000, completedAt: now },
    { durationMs: '60000', completedAt: now },
    { durationMs: 60000, completedAt: now + 1 },
    null,
  ];
  const report = M.relatorio(history, () => { throw new Error('Não consultar tarefa inexistente'); }, 'hoje', now);
  assert.equal(report.total, 25);
  assert.deepEqual(report.porPasta, [{ nome: 'Sem tarefa', minutos: 25 }]);
  assert.deepEqual(report.porTag, []);
});
test('foco relatorio: formata horas e minutos', () => {
  assert.equal(M.formatarMinutos(0), '0 min');
  assert.equal(M.formatarMinutos(45), '45 min');
  assert.equal(M.formatarMinutos(120), '2 h');
  assert.equal(M.formatarMinutos(135), '2 h 15 min');
});

test('foco relatorio: página consulta nota ligada, preserva sessão removida e avisa falha de leitura', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  for (const indisponivel of [false, true]) {
    const elements = new Map();
    const node = () => ({
      textContent: '', hidden: false, value: '', style: {}, options: [], children: [],
      classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, after() {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
    });
    const document = {
      getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
      createElement: node, createDocumentFragment: node,
    };
    document.getElementById('report-period').value = 'hoje';
    const state = M.initial(settings), now = Date.now();
    state.history = [
      { id: 'a', task: { id: 't1', title: 'Concluída' }, durationMs: 60000, completedAt: now },
      { id: 'b', task: { id: 'removida', title: 'Removida' }, durationMs: 120000, completedAt: now },
    ];
    const original = JSON.stringify(state);
    const api = {
      settings: { get: async () => settings },
      storage: { get: async () => state, set: async () => assert.fail('Relatório não deve gravar estado') },
      tasks: { list: async () => [{ id: 't1', done: true, noteId: 'n1' }] },
      notes: { get: async id => {
        assert.equal(id, 'n1');
        if (indisponivel) throw new Error('Nota removida');
        return { folder: 'Projetos/Kiro', tags: ['foco'] };
      } },
    };
    let loaded;
    const context = { document, KiroFocus: M, setInterval() {}, kiro: { ready: { then(fn) { loaded = fn(api); return { catch() {} }; } } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../examples/plugins/focus-pomodoro/page.js'), 'utf8'), context);
    await loaded;
    assert.equal(document.getElementById('report-total').textContent, '3 min');
    assert.equal(document.getElementById('report-warning').hidden, !indisponivel);
    const rows = document.getElementById('report-folders').children;
    assert.equal(rows[0].children[0].textContent, 'Sem classificação');
    assert.equal(rows.length, indisponivel ? 1 : 2);
    if (!indisponivel) assert.equal(rows[1].children[0].textContent, 'Projetos/Kiro');
    assert.equal(JSON.stringify(state), original);
  }
});
