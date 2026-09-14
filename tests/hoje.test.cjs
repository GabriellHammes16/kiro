const test = require('node:test');
const assert = require('node:assert/strict');
const { toReview, withoutInbox, inInbox } = require('../domain.js');
const dia = 864e5, agora = Date.parse('2026-09-13T12:00:00Z');
const nota = (id, extra = {}) => ({ id, title: id, body: '', links: [], tags: [], folderId: '', updatedAt: agora, ...extra });

test('soltas: sem pasta, sem ligações, sem menções, fora da caixa de entrada e das diárias', () => {
  const notas = [
    nota('solta'), nota('citada'), nota('cita', { body: 'ver [[citada]]' }), nota('na-pasta', { folderId: 'p1' }),
    nota('caixa', { tags: ['inbox'] }), nota('caixa-corpo', { body: 'algo #inbox' }), nota('2026-09-13'),
  ];
  assert.deepEqual(toReview(notas, agora).loose.map(n => n.id), ['solta']);
});

test('esquecidas: paradas há mais de 30 dias, mais antigas primeiro, até 5', () => {
  const notas = [nota('nova'), nota('31', { updatedAt: agora - 31 * dia }), nota('90', { updatedAt: agora - 90 * dia }), nota('30', { updatedAt: agora - 30 * dia })];
  assert.deepEqual(toReview(notas, agora).forgotten.map(n => n.id), ['90', '31']);
  assert.equal(toReview(Array.from({ length: 8 }, (_, i) => nota(`v${i}`, { updatedAt: 0 })), agora).forgotten.length, 5);
  assert.deepEqual(toReview([nota('2026-01-01', { updatedAt: 0 }), nota('cx', { tags: ['inbox'], updatedAt: 0 })], agora).forgotten, []);
});

test('arquivar tira inbox das etiquetas e o token #inbox do corpo, sem mexer no resto', () => {
  const n = withoutInbox(nota('x', { tags: ['inbox', 'java'], body: '#inbox começo\nmeio #inbox fim #inboxing #inbox/sub\n#java #inbox' }));
  assert.deepEqual(n.tags, ['java']);
  assert.equal(n.body, 'começo\nmeio fim #inboxing #inbox/sub\n#java');
  assert.equal(inInbox(n), false);
});
