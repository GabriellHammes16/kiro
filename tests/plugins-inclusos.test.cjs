const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Vault } = require('../vault.cjs');
const { instalarPluginsInclusos, IDS } = require('../electron/plugins-inclusos.cjs');
const origem = path.join(__dirname, '..', 'examples', 'plugins');

test('inclui plugins completos sem ativar ou substituir conteúdo existente', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-inclusos-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const vault = new Vault(dir);
  await Promise.all([instalarPluginsInclusos(vault, origem), instalarPluginsInclusos(vault, origem)]);
  assert.deepEqual((await vault.listPlugins()).map(p => p.id).sort(), [...IDS].sort());
  assert.deepEqual(await vault.readPluginChoices(), {});
  for (const id of IDS) for (const nome of ['manifest.json', 'index.js', 'page.html', 'page.js', 'modelo.js', 'style.css']) {
    assert.deepEqual(await fs.readFile(await vault.pluginPath(id, nome)), await fs.readFile(path.join(origem, id, nome)));
  }
  const plugin = path.join(dir, '.kiro/plugins/flashcards');
  await fs.writeFile(path.join(plugin, 'index.js'), 'versão do usuário');
  await fs.writeFile(path.join(plugin, 'data.json'), '{"progresso":42}');
  await instalarPluginsInclusos(vault, origem);
  assert.equal(await fs.readFile(path.join(plugin, 'index.js'), 'utf8'), 'versão do usuário');
  assert.equal(await fs.readFile(path.join(plugin, 'data.json'), 'utf8'), '{"progresso":42}');
});

test('recusa origem incompleta sem publicar pasta parcial', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-inclusos-falha-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const fonte = path.join(dir, 'fonte', IDS[0]);
  await fs.mkdir(fonte, { recursive: true });
  await fs.writeFile(path.join(fonte, 'manifest.json'), '{}');
  const vault = new Vault(path.join(dir, 'cofre'));
  await assert.rejects(instalarPluginsInclusos(vault, path.join(dir, 'fonte')), /incompleto/);
  assert.deepEqual(await vault.listPlugins(), []);
});

test('Windows repete a publicação após bloqueio transitório sem perder o plugin', { skip: process.platform !== 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-inclusos-ocupado-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rename = fs.rename;
  let bloqueios = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    if (bloqueios++ === 0) throw Object.assign(new Error('arquivo em uso'), { code: 'EPERM' });
    return rename(...args);
  });
  const vault = new Vault(dir);
  await instalarPluginsInclusos(vault, origem);
  assert.ok(bloqueios > IDS.length);
  assert.deepEqual((await vault.listPlugins()).map(p => p.id).sort(), [...IDS].sort());
  assert.deepEqual(await fs.readFile(await vault.pluginPath(IDS[0], 'page.js')), await fs.readFile(path.join(origem, IDS[0], 'page.js')));
});

test('recusa links simbólicos na pasta gerenciada', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-inclusos-link-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cofre = path.join(dir, 'cofre'), fora = path.join(dir, 'fora');
  await fs.mkdir(cofre); await fs.mkdir(fora);
  await fs.symlink(fora, path.join(cofre, '.kiro'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(instalarPluginsInclusos(new Vault(cofre), origem), /simbólicos/);
  assert.deepEqual(await fs.readdir(fora), []);
});

test('instalador inclui os plugins de produtividade nos recursos', () => {
  const pkg = require('../package.json');
  assert.deepEqual(pkg.build.extraResources.map(r => r.to).sort(), IDS.map(id => `plugins/${id}`).sort());
  assert.ok(pkg.build.files.includes('!examples/**'));
});
