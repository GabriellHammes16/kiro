const test = require('node:test');
const assert = require('node:assert/strict');
const { habitStats, habitDays, withHabits, validateState } = require('../domain.js');

// 2026-09-15 é uma terça-feira.
const hoje = '2026-09-15';
const diario = { id: 'agua', title: 'Beber água', frequency: { type: 'daily' } };

test('sequência diária conta dias seguidos e não quebra só porque hoje ainda não foi feito', () => {
  assert.equal(habitStats(diario, ['2026-09-15', '2026-09-14', '2026-09-13', '2026-09-11'], hoje).streak, 3);
  assert.equal(habitStats(diario, ['2026-09-14', '2026-09-13'], hoje).streak, 2);
  assert.equal(habitStats(diario, ['2026-09-13'], hoje).streak, 0);
});

test('hábito em dias da semana pula os dias sem compromisso', () => {
  // segunda (1), quarta (3) e sexta (5)
  const treino = { id: 'treino', title: 'Treino', frequency: { type: 'days', days: [1, 3, 5] } };
  const s = habitStats(treino, ['2026-09-14', '2026-09-11', '2026-09-09'], hoje);
  assert.equal(s.streak, 3);
  assert.equal(s.dueToday, false);
  assert.deepEqual(s.week.map(d => d.due), [true, false, true, false, false, true, false]);
});

test('hábito semanal conta semanas em que a meta foi batida; a semana atual não quebra a sequência', () => {
  const leitura = { id: 'ler', title: 'Ler', frequency: { type: 'weekly', times: 2 } };
  // semana atual (14-20): 1 vez; semanas de 7-13 e 31/08-06/09: 2 vezes cada
  const dias = ['2026-09-14', '2026-09-08', '2026-09-12', '2026-09-01', '2026-09-03'];
  const s = habitStats(leitura, dias, hoje);
  assert.equal(s.streak, 2);
  assert.equal(s.weekCount, 1);
  assert.equal(s.dueToday, true);
});

test('dias antes da criação não contam como falta', () => {
  const novo = { ...diario, createdAt: new Date(2026, 8, 14).getTime() };
  const s = habitStats(novo, ['2026-09-14'], hoje);
  assert.equal(s.streak, 1);
  assert.equal(s.rate30, 100);
  assert.deepEqual(habitDays(novo, ['2026-09-14'], hoje, 3).map(d => d.due), [false, true, true]);
});

test('cumprimento em 30 dias ignora hoje enquanto não foi feito', () => {
  const dias = Array.from({ length: 15 }, (_, i) => `2026-09-${String(14 - i).padStart(2, '0')}`).filter(d => d >= '2026-09-01');
  const s = habitStats({ ...diario, createdAt: new Date(2026, 8, 1).getTime() }, dias, hoje);
  assert.equal(s.rate30, 100);
  assert.equal(s.totalDone, 14);
});

test('rotina antiga vira hábito diário com o dia marcado; histórico de hábito apagado some', () => {
  const antigo = withHabits({ notes: [], tasks: [], folders: [], routine: [{ id: 'r1', title: 'Beber água', date: '2026-09-14', done: true }, { id: 'r2', title: 'Ler', date: '2026-09-10', done: false }] });
  assert.equal(antigo.routine, undefined);
  assert.deepEqual(antigo.habits.map(h => [h.id, h.frequency.type]), [['r1', 'daily'], ['r2', 'daily']]);
  assert.deepEqual(antigo.habitLog, { r1: ['2026-09-14'] });
  const limpo = withHabits({ habits: [diario], habitLog: { agua: ['2026-09-15', '2026-09-15', 'lixo'], sumido: ['2026-09-01'] } });
  assert.deepEqual(limpo.habitLog, { agua: ['2026-09-15'] });
});

test('validateState recusa frequência inválida', () => {
  const base = { notes: [], tasks: [], folders: [], habitLog: {} };
  assert.doesNotThrow(() => validateState({ ...base, habits: [{ ...diario }] }));
  assert.throws(() => validateState({ ...base, habits: [{ ...diario, frequency: { type: 'days', days: [] } }] }));
  assert.throws(() => validateState({ ...base, habits: [{ ...diario, frequency: { type: 'weekly', times: 9 } }] }));
  assert.throws(() => validateState({ ...base, habits: [{ ...diario, frequency: { type: 'hourly' } }] }));
});
