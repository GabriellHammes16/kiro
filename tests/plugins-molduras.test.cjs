const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const P = require('../plugins.js');
const { Vault } = require('../vault.cjs');

const base = { id: 'habit-heatmap', name: 'Habit Heatmap', version: '1.0.0', author: 'Kiro', minKiro: '0.14.0', permissions: ['habits:read'], network: [] };
const validar = (mudanca = {}) => P.validarManifesto({ ...base, ...mudanca }, { versaoDoKiro: '0.14.0' });

test('page no manifesto: válido passa, o resto recusa', () => {
  assert.equal(validar().manifesto.page, null);
  assert.deepEqual(validar({ page: { title: 'Heatmap', file: 'page.html' } }).manifesto.page, { title: 'Heatmap', file: 'page.html' });
  for (const page of [
    'page.html', [], { title: 'X', file: 'page.js' }, { title: 'X', file: 'sub/page.html' },
    { title: 'X', file: '../page.html' }, { title: 'X', file: '..html' }, { title: '', file: 'page.html' },
    { title: 'x'.repeat(41), file: 'page.html' }, { title: 'X\nY', file: 'page.html' },
  ]) assert.equal(validar({ page }).ok, false, JSON.stringify(page));
});

test('ganhar page numa atualização não pede consentimento', () => {
  const registro = { enabled: true, permissions: ['habits:read'], network: [] };
  assert.equal(P.precisaConsentir(registro, validar({ page: { title: 'Heatmap', file: 'page.html' } }).manifesto), false);
});

test('validarMoldura confere arquivo e altura', () => {
  assert.deepEqual(P.validarMoldura({ frame: 'chart.html', data: { a: 1 } }), { ok: true, frame: 'chart.html', height: 240, data: { a: 1 } });
  assert.equal(P.validarMoldura({ frame: 'chart.html', height: 10 }).height, 40);
  assert.equal(P.validarMoldura({ frame: 'chart.html', height: 9999 }).height, 2000);
  assert.equal(P.validarMoldura({ frame: 'chart.html', height: 'alto' }).height, 240);
  assert.equal(P.validarMoldura({ frame: 'chart.html' }).data, null);
  assert.equal(P.validarMoldura({ frame: 'index.js' }).ok, false);
  assert.equal(P.validarMoldura({ frame: '../x.html' }).ok, false);
  assert.equal(P.validarMoldura({ frame: 'https://x.com/a.html' }).ok, false);
  assert.equal(P.validarMoldura(null).ok, false);
});

test('tipo do arquivo servido sai da extensão, e só três passam', () => {
  assert.match(P.tipoDoArquivoDoPlugin('index.js'), /^text\/javascript/);
  assert.match(P.tipoDoArquivoDoPlugin('page.HTML'), /^text\/html/);
  assert.match(P.tipoDoArquivoDoPlugin('style.css'), /^text\/css/);
  for (const nome of ['manifest.json', 'a.svg', 'a.mjs', 'a.htm', 'js']) assert.equal(P.tipoDoArquivoDoPlugin(nome), null, nome);
});

test('CSP da moldura: sandbox, sem rede, só a própria origem', () => {
  const web = P.cspDaMoldura('http://127.0.0.1:4180');
  for (const trecho of ['sandbox allow-scripts', "default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
    "script-src http://127.0.0.1:4180", "img-src http://127.0.0.1:4180 data:"]) assert.ok(web.includes(trecho), trecho);
  assert.doesNotMatch(web, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
  assert.doesNotMatch(web, /'self'|\bhttps?:(?!\/\/127)/);
  assert.match(web, /frame-ancestors http:\/\/127\.0\.0\.1:4180/);
  const app = P.cspDaMoldura('kiro-plugin:');
  assert.match(app, /script-src kiro-plugin:/);
  assert.doesNotMatch(app, /frame-ancestors/);   // página file:// não casa com nada: o Electron omite
});

test('injeção do kiro-frame.js vem sempre no início do documento (ou logo após o doctype)', () => {
  const tag = '<script src="/kiro-frame.js"></script>';
  assert.equal(P.injetarScriptsDaMoldura('<html><head><title>x</title></head></html>', '/kiro-frame.js'), `${tag}<html><head><title>x</title></head></html>`);
  assert.equal(P.injetarScriptsDaMoldura('<p>sem doctype</p>', '/kiro-frame.js'), `${tag}<p>sem doctype</p>`);
  assert.equal(P.injetarScriptsDaMoldura('<!doctype html><html></html>', '/kiro-frame.js'), `<!doctype html>${tag}<html></html>`);
  assert.equal(P.injetarScriptsDaMoldura('  <!DOCTYPE HTML>\n<html></html>', '/kiro-frame.js'), `  <!DOCTYPE HTML>${tag}\n<html></html>`);
  // <head> "falso" dentro de um comentário não engana mais: a busca por <head> foi removida.
  assert.equal(P.injetarScriptsDaMoldura('<!doctype html><!-- <head> --><html><script src="a.js"></script></html>', '/kiro-frame.js'), `<!doctype html>${tag}<!-- <head> --><html><script src="a.js"></script></html>`);
});

test('variáveis do tema incluem as 15 cores e as fontes', () => {
  assert.equal(P.VARIAVEIS_DO_TEMA.length, 18);
  for (const v of ['--bg', '--ink', '--acento', '--primario-texto', '--fonte-interface', '--fonte-codigo', '--fonte-leitura']) assert.ok(P.VARIAVEIS_DO_TEMA.includes(v), v);
});

test('readPluginFile serve .js, .html e .css e recusa o resto', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-molduras-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pasta = path.join(dir, '.kiro', 'plugins', 'habit-heatmap');
  await fs.mkdir(pasta, { recursive: true });
  for (const [nome, corpo] of [['index.js', 'export default {}'], ['page.html', '<p>oi</p>'], ['style.css', 'p{}'], ['manifest.json', '{}'], ['a.svg', '<svg/>']]) await fs.writeFile(path.join(pasta, nome), corpo);
  const vault = new Vault(dir);
  assert.equal(String(await vault.readPluginFile('habit-heatmap', 'page.html')), '<p>oi</p>');
  assert.equal(String(await vault.readPluginFile('habit-heatmap', 'style.css')), 'p{}');
  await assert.rejects(() => vault.readPluginFile('habit-heatmap', 'manifest.json'), /js/i);
  await assert.rejects(() => vault.readPluginFile('habit-heatmap', 'a.svg'), /js/i);
});

test('servidor entrega a tela com sandbox, sem rede e com o runtime injetado', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-molduras-http-'));
  const pasta = path.join(dir, '.kiro', 'plugins', 'habit-heatmap');
  await fs.mkdir(pasta, { recursive: true });
  await fs.writeFile(path.join(pasta, 'page.html'), '<html><head></head><body><script src="page.js"></script></body></html>');
  await fs.writeFile(path.join(pasta, 'style.css'), 'p{}');
  const port = 14000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), KIRO_VAULT: dir }, windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null) { const parou = new Promise(r => child.once('exit', r)); child.kill(); await parou; }
    await fs.rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error('Servidor não iniciou')), 8000);
    child.stdout.once('data', () => { clearTimeout(prazo); resolve(); });
    child.once('exit', code => { clearTimeout(prazo); reject(new Error(`Servidor terminou: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const tela = await fetch(`${base}/plugins/habit-heatmap/page.html`);
  assert.equal(tela.status, 200);
  assert.match(tela.headers.get('content-type'), /^text\/html/);
  assert.equal(tela.headers.get('x-dns-prefetch-control'), 'off');
  const csp = tela.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(csp.includes(`script-src ${base}`), csp);
  assert.ok(csp.includes(`frame-ancestors ${base}`), csp);
  assert.match(await tela.text(), /^<script src="\/kiro-frame\.js"><\/script><html><head><\/head>/);
  const css = await fetch(`${base}/plugins/habit-heatmap/style.css`);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  // .js continua com a CSP do worker, sem injeção.
  assert.equal((await fetch(`${base}/plugins/habit-heatmap/manifest.json`)).status, 404);
  const runtime = await fetch(`${base}/kiro-frame.js`);
  assert.equal(runtime.status, 200);
  assert.match(await runtime.text(), /RTCPeerConnection/);
});

test('exemplo habit-heatmap: manifesto válido, tela e docs', async () => {
  const raiz = path.join(__dirname, '..');
  const versao = require('../package.json').version;
  const m = JSON.parse(await fs.readFile(path.join(raiz, 'examples/plugins/habit-heatmap/manifest.json'), 'utf8'));
  const r = P.validarManifesto(m, { versaoDoKiro: versao });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.manifesto.permissions, ['habits:read']);
  assert.deepEqual(r.manifesto.page, { title: 'Habit Heatmap', file: 'heatmap.html' });
  const html = await fs.readFile(path.join(raiz, 'examples/plugins/habit-heatmap/heatmap.html'), 'utf8');
  assert.match(html, /heatmap\.js/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/);   // sem script inline: a CSP não deixa
  const docs = await fs.readFile(path.join(raiz, 'docs/plugins.md'), 'utf8');
  for (const trecho of ['kiro.ready', 'kiro.resize', 'kiro.openLink', 'kiro.onData', '"page"', 'frame']) assert.ok(docs.includes(trecho), trecho);
  assert.doesNotMatch(docs, /Stage 4 — isolated frames/);
});
