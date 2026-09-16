const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../plugins.js');

const base = { id: 'word-count', name: 'Word Count', version: '1.0.0', author: 'fulano', minKiro: '0.15.0', permissions: ['notes:read'], network: [] };
const validar = (mudanca = {}) => P.validarManifesto({ ...base, ...mudanca }, { versaoDoKiro: '0.15.0' });

test('manifesto válido é aceito e normalizado', () => {
  const r = validar();
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifesto.permissions, ['notes:read']);
  assert.deepEqual(r.manifesto.network, []);
});

test('manifesto inválido é recusado com motivo', () => {
  assert.match(validar({ id: 'Word Count' }).erro, /id/i);
  assert.match(validar({ version: '1' }).erro, /versão|version/i);
  assert.match(validar({ permissions: ['disk:read'] }).erro, /permiss/i);
  assert.match(validar({ minKiro: '9.0.0' }).erro, /Kiro/i);
  assert.match(validar({ network: ['*.exemplo.com'] }).erro, /endereço|host/i);
  assert.match(validar({ network: ['http://exemplo.com'] }).erro, /https/i);
  assert.match(P.validarManifesto('nada', { versaoDoKiro: '0.15.0' }).erro, /manifesto/i);
});

test('consentimento só é pedido quando o plug-in passa a pedir mais', () => {
  const registro = { enabled: true, permissions: ['notes:read'], network: [] };
  assert.equal(P.precisaConsentir(registro, base), false);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: ['notes:read', 'notes:write'] }), true);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: [] }), false);
  assert.equal(P.precisaConsentir(registro, { ...base, network: ['api.exemplo.com'] }), true);
});

test('rótulo de permissão sai em português', () => {
  assert.match(P.rotuloDaPermissao('notes:write'), /notas/i);
});
