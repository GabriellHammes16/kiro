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
    if (visao === 'calendario') assert.equal((html.match(/role="gridcell"/g) || []).length, 42);
  }
});
