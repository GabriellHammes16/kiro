const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../domain.js');

const estado = tarefas => ({ notes: [], tasks: tarefas, habits: [], habitLog: {}, studies: [] });
const tarefa = (extra = {}) => ({ id: 't1', title: 'Ler', due: '2026-10-03', priority: 'Média', done: false, ...extra });

test('descrição da tarefa: opcional, texto até 5000 caracteres', () => {
  assert.doesNotThrow(() => domain.validateState(estado([tarefa()])));
  assert.doesNotThrow(() => domain.validateState(estado([tarefa({ description: 'Capítulos 3 e 4' })])));
  assert.throws(() => domain.validateState(estado([tarefa({ description: 7 })])));
  assert.throws(() => domain.validateState(estado([tarefa({ description: 'x'.repeat(5001) })])));
});

test('[[tarefa:id|Título]] não é link entre notas; taskLinks acha o id', () => {
  const corpo = 'Veja [[Plano]] e [[tarefa:t1|Ler cap. 3]] e [[TAREFA:t2]] e ![[foto.png]]';
  assert.deepEqual(domain.wikiLinks(corpo).map(l => l.target), ['Plano']);
  assert.deepEqual(domain.taskLinks(corpo), ['t1', 't2']);
});

test('notas que citam uma tarefa e a citação pronta para colar', () => {
  const notas = [{ id: 'a', body: 'x [[tarefa:t1|Ler]]' }, { id: 'b', body: 'nada' }, { id: 'c', body: '[[tarefa:t1]] e [[tarefa:t1]]' }];
  assert.deepEqual(domain.notesCitingTask(notas, 't1').map(n => n.id), ['a', 'c']);
  assert.equal(domain.taskReference({ id: 't1', title: 'Ler [cap|3]\nfim' }), '[[tarefa:t1|Ler cap 3 fim]]');
});

test('status da tarefa: feita é "concluido"; andamento/pausado guardados; resto "nao-comecado"', () => {
  assert.equal(domain.statusDaTarefa(tarefa()), 'nao-comecado');
  assert.equal(domain.statusDaTarefa(tarefa({ status: 'andamento' })), 'andamento');
  assert.equal(domain.statusDaTarefa(tarefa({ status: 'pausado', done: true })), 'concluido');
  assert.doesNotThrow(() => domain.validateState(estado([tarefa({ status: 'pausado' })])));
  assert.throws(() => domain.validateState(estado([tarefa({ status: 'inventado' })])));
});

test('mover tarefa de status: concluir marca done e guarda o status de antes; reabrir volta a ele', () => {
  const andando = tarefa({ status: 'andamento' });
  const feita = domain.moverTarefa(andando, 'concluido');
  assert.equal(feita.done, true);
  assert.equal(feita.status, 'andamento', 'guarda de onde veio');
  assert.equal(domain.statusDaTarefa(domain.moverTarefa(feita, 'pausado')), 'pausado');
  const reaberta = domain.moverTarefa(feita, 'nao-comecado');
  assert.equal(reaberta.done, false);
  assert.ok(!('status' in reaberta), 'não começado não guarda campo');
  assert.equal(domain.moverTarefa(andando, 'lixo'), andando);
});
