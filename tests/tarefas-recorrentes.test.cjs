const test = require('node:test'), assert = require('node:assert/strict');
const K = require('../domain.js');
const base = { id: 't1', title: 'x', due: '2026-01-31', priority: 'Média', done: false };

test('próximo prazo: dia, semana, N dias', () => {
  assert.equal(K.proximoPrazo('2026-12-31', { every: 'day' }), '2027-01-01');
  assert.equal(K.proximoPrazo('2026-10-25', { every: 'week' }), '2026-11-01');
  assert.equal(K.proximoPrazo('2026-10-25', { every: 'days', n: 10 }), '2026-11-04');
});
test('próximo prazo: mês usa o último dia quando falta o dia', () => {
  assert.equal(K.proximoPrazo('2026-01-31', { every: 'month' }), '2026-02-28');
  assert.equal(K.proximoPrazo('2028-01-31', { every: 'month' }), '2028-02-29');
  assert.equal(K.proximoPrazo('2026-12-15', { every: 'month' }), '2027-01-15');
  assert.equal(K.proximoPrazo('2026-10-25', { every: 'nunca' }), null);
});
test('validação do campo repeat; tarefa sem o campo segue válida', () => {
  const estado = r => ({ notes: [], studies: [], tasks: [{ ...base, ...(r === undefined ? {} : { repeat: r }) }] });
  assert.doesNotThrow(() => K.validateState(estado()));
  assert.doesNotThrow(() => K.validateState(estado({ every: 'days', n: 3 })));
  for (const ruim of [{ every: 'year' }, { every: 'days' }, { every: 'days', n: 0 }, { every: 'day', n: 2 }, 'day', null]) assert.throws(() => K.validateState(estado(ruim)), /inválidos/);
});
test('próxima ocorrência mantém os dados e abre de novo', () => {
  const n = K.proximaOcorrencia({ ...base, done: true, status: 'pausado', noteId: 'n1', repeat: { every: 'month' } }, 't2');
  assert.deepEqual(n, { ...base, id: 't2', due: '2026-02-28', noteId: 'n1', repeat: { every: 'month' }, done: false });
  assert.equal(K.proximaOcorrencia(base, 't2'), null);
});

test('conclusão emite uma ocorrência; reabrir, repetir a escrita e excluir não duplicam', () => {
  const antes = [{ ...base, repeat: { every: 'day' } }];
  const criado = K.criarProximas([{ ...antes[0], done: true }], antes, () => 't2');
  assert.equal(criado.length, 2);
  assert.equal(criado[1].repeatNextId, 't2');
  assert.equal(criado[0].repeatNextId, undefined);
  const reaberto = criado.map(t => ({ ...t, done: false }));
  const concluido = K.criarProximas(reaberto.map(t => t.id === 't1' ? { ...t, done: true } : t), reaberto, () => assert.fail('não pode emitir novamente'));
  assert.equal(concluido.length, 2);
  assert.equal(K.criarProximas(concluido, concluido, () => assert.fail()).length, 2);
  const semProxima = reaberto.filter(t => t.id === 't1');
  assert.equal(K.criarProximas(semProxima.map(t => ({ ...t, done: true })), semProxima, () => assert.fail()).length, 1);
});

test('lembrete semanal não cobra meta já cumprida nem hábito futuro', () => {
  const habitos = [
    { id: 'h', title: 'h', frequency: { type: 'weekly', times: 2 } },
    { id: 'f', title: 'f', frequency: { type: 'daily' }, createdAt: new Date(2026, 9, 27).getTime() },
  ];
  const args = { agora: new Date(2026, 9, 25, 21), habitos, habitLog: { h: ['2026-10-20', '2026-10-22'] } };
  assert.equal(K.avisosDeHoje(args).habitos, 0);
  assert.equal(K.avisosDeHoje({ ...args, habitLog: { h: ['2026-10-20'] } }).habitos, 1);
});
test('avisos: horário, uma vez por dia e só com pendências', () => {
  const tarefas = [{ ...base, due: '2026-10-24' }, { ...base, id: 'b', due: '2026-10-25' }, { ...base, id: 'c', due: '2026-10-26' }, { ...base, id: 'd', due: '2026-10-25', done: true }];
  const habitos = [{ id: 'h', title: 'h', frequency: { type: 'daily' } }, { id: 'g', title: 'g', frequency: { type: 'daily' } }];
  const em = (h, m, ultimo = {}, log = { h: ['2026-10-25'] }) => K.avisosDeHoje({ agora: new Date(2026, 9, 25, h, m), tarefas, habitos, habitLog: log, ultimo });
  assert.deepEqual(em(8, 59), { tarefas: 0, habitos: 0 });
  assert.deepEqual(em(9, 0), { tarefas: 2, habitos: 0 });
  assert.deepEqual(em(21, 0), { tarefas: 2, habitos: 1 });
  assert.deepEqual(em(21, 0, { tarefas: '2026-10-25', habitos: '2026-10-25' }), { tarefas: 0, habitos: 0 });
  assert.deepEqual(em(21, 0, {}, { h: ['2026-10-25'], g: ['2026-10-25'] }), { tarefas: 2, habitos: 0 });
});
