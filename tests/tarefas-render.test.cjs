const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Kiro = require('../domain.js');
const fonte = fs.readFileSync(require.resolve('../app.js'), 'utf8');

test('lista e calendário renderizam tarefas citadas sem tratar índice como notas', () => {
  const task = { id: 't1', title: 'Entregar proposta', due: '2026-10-26', priority: 'Alta', done: false };
  const notes = [{ id: 'n1', title: 'Contexto da proposta', body: Kiro.taskReference(task) }];
  for (const visao of ['data', 'calendario']) {
    const contexto = {
      Kiro, state: { tasks: [task], notes }, today: () => '2026-10-26',
      filtroDasTarefas: 'todas', diaSelecionadoNoCalendario: '2026-10-26',
      lerPreferencia: () => visao, tarefasDasNotas: () => [], head: () => '',
      t: s => s, icone: () => '', escapeHtml: String, dateLabel: String,
      getNote: id => notes.find(n => n.id === id), linkDaNota: n => n.title,
      check: () => '', ordemDaPrioridade: () => 0, linhaDaTarefaDaNota: () => '',
      textoDataCalendario: String, rotuloDaRepeticao: () => '',
      GRUPOS_DE_DATA: [['hoje', 'Hoje']], grupoDaData: () => 'hoje',
    };
    vm.createContext(contexto);
    for (const nome of ['citadaEm', 'taskRow', 'renderCalendario', 'renderTasks']) {
      const inicio = fonte.indexOf(`function ${nome}(`);
      vm.runInContext(fonte.slice(inicio, fonte.indexOf('\n}', inicio) + 2), contexto);
    }
    const html = contexto.renderTasks();
    assert.match(html, /Entregar proposta/);
    assert.match(html, /Contexto da proposta/);
    assert.match(html, /data-status-tarefa="t1"/);
    if (visao === 'calendario') assert.equal((html.match(/role="gridcell"/g) || []).length, 42);
  }
});

test('troca de estado desenha uma única vez de forma otimista sem segundo redesenho no save', async () => {
  const task = { id: 't1', title: 'Estudar', due: '2026-10-26', priority: 'Média', done: false };
  let renders = 0, opcoesSave = null;
  const contexto = {
    Kiro, state: { tasks: [task], notes: [] }, busy: false, failed: false, loaded: true,
    ROTULOS_DE_STATUS: { 'nao-comecado': 'Não começado', andamento: 'Em andamento', pausado: 'Pausado', concluido: 'Concluído' },
    t: s => s, criarProximas() {}, status() {}, editorDaNota: null,
    CSS: { escape: String }, document: { querySelector: () => ({ focus() {} }) },
    render: () => { renders++; },
    save: async (_o, _t, op) => { opcoesSave = op; return true; },
  };
  vm.createContext(contexto);
  const inicio = fonte.indexOf('async function moverStatusDaTarefa(');
  vm.runInContext(fonte.slice(inicio, fonte.indexOf('\n}', inicio) + 2), contexto);
  await contexto.moverStatusDaTarefa('t1', 'andamento');
  assert.equal(Kiro.statusDaTarefa(contexto.state.tasks[0]), 'andamento');
  assert.equal(renders, 1);
  assert.equal(opcoesSave?.semRender, true);
});
