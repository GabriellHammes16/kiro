const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('HTTP: diagnóstico e inspeção exigem mesma origem e não expõem dados do plug-in', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-b4-'));
  const plugin = path.join(dir, '.kiro', 'plugins', 'exemplo');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'manifest.json'), '{}');
  await fs.writeFile(path.join(plugin, 'index.js'), '<script>');
  await fs.writeFile(path.join(plugin, 'data.json'), 'privado');
  await fs.writeFile(path.join(dir, 'nota.sync-conflict-20261026-120000-ABC.md'), 'texto');
  const port = 15000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), KIRO_VAULT: dir }, windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; } await fs.rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Servidor não iniciou')), 8000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Servidor terminou: ${code}`)); }); });
  const get = await fetch(`${base}/api/conflicts`, { headers: { Origin: base } });
  assert.deepEqual(await get.json(), ['nota.sync-conflict-20261026-120000-ABC.md']);
  assert.equal((await fetch(`${base}/api/conflicts`)).status, 403);
  const post = await fetch(`${base}/api/plugin-inspect`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'exemplo' }) });
  assert.deepEqual((await post.json()).map(x => x.name).sort(), ['index.js', 'manifest.json']);
  assert.equal((await fetch(`${base}/api/plugin-inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'exemplo' }) })).status, 403);
});
