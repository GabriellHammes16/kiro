const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calendarioDoMes, somarMeses } = require('../domain.js');

test('calendário mensal cobre seis semanas com datas locais em fevereiro bissexto', () => {
  const dias = calendarioDoMes('2024-02-12');
  assert.equal(dias.length, 42);
  assert.equal(dias[0].date, '2024-01-29'); // segunda-feira
  assert.equal(dias.filter(d => d.inMonth).length, 29);
  assert.ok(dias.some(d => d.date === '2024-02-29' && d.inMonth));
  assert.equal(dias.at(-1).date, '2024-03-10');
});

test('calendário atravessa ano e soma meses com ajuste para o último dia válido', () => {
  const dias = calendarioDoMes('2027-01-05');
  assert.equal(dias[0].date, '2026-12-28');
  assert.equal(somarMeses('2025-12-31', 1), '2026-01-31');
  assert.equal(somarMeses('2026-01-31', -1), '2025-12-31');
  assert.equal(somarMeses('2025-01-31', 1), '2025-02-28');
});

test('datas inválidas ou deslocamentos de mês inválidos não geram grade', () => {
  assert.equal(calendarioDoMes('2026-02-30'), null);
  assert.equal(calendarioDoMes('2026-13-01'), null);
  assert.equal(somarMeses('2026-01-01', 1.5), null);
  assert.equal(somarMeses('2026-01-01', NaN), null);
});
