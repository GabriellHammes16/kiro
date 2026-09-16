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

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');

async function cofreTemporario() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-plugins-'));
  const plugin = path.join(dir, '.kiro', 'plugins', 'word-count');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'manifest.json'), JSON.stringify(base));
  await fs.writeFile(path.join(plugin, 'index.js'), 'export default { async activate() {} };');
  return { dir, vault: new Vault(dir) };
}

test('o cofre lista plug-ins e serve só arquivos .js', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.equal(encontrados[0].id, 'word-count');
    assert.equal(encontrados[0].manifesto.name, 'Word Count');

    const codigo = await vault.readPluginFile('word-count', 'index.js');
    assert.match(codigo.toString('utf8'), /activate/);

    await assert.rejects(() => vault.readPluginFile('word-count', 'manifest.json'), /js/i);
    await assert.rejects(() => vault.readPluginFile('word-count', '../../caderno.json'), /inválido|Caminho/i);
    await assert.rejects(() => vault.readPluginFile('../outro', 'index.js'), /inválido|Caminho/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('escolhas do usuário vão e voltam de plugins.json', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    assert.deepEqual(await vault.readPluginChoices(), {});
    await vault.writePluginChoices({ 'word-count': { enabled: true, permissions: ['notes:read'], network: [] } });
    assert.equal((await vault.readPluginChoices())['word-count'].enabled, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('manifesto quebrado aparece como erro, sem derrubar a lista', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    await fs.writeFile(path.join(dir, '.kiro', 'plugins', 'word-count', 'manifest.json'), '{ isso não é json');
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.ok(encontrados[0].erro);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('o espaço do plug-in guarda dados e recusa passar de 1 MB', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    assert.deepEqual(await vault.readPluginData('word-count'), {});
    await vault.writePluginData('word-count', { total: 7 });
    assert.equal((await vault.readPluginData('word-count')).total, 7);
    await assert.rejects(() => vault.writePluginData('word-count', { grande: 'x'.repeat(1024 * 1024) }), /1 MB/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
