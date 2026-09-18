const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

test('injeção do kiro-frame.js vem antes de qualquer script do plug-in', () => {
  const tag = '<script src="/kiro-frame.js"></script>';
  assert.equal(P.injetarScriptsDaMoldura('<html><head><title>x</title></head></html>', '/kiro-frame.js'), `<html><head>${tag}<title>x</title></head></html>`);
  assert.equal(P.injetarScriptsDaMoldura('<HEAD data-x="1"><script src="a.js"></script>', '/kiro-frame.js'), `<HEAD data-x="1">${tag}<script src="a.js"></script>`);
  assert.equal(P.injetarScriptsDaMoldura('<p>sem head</p>', '/kiro-frame.js'), `${tag}<p>sem head</p>`);
  // head falso dentro de comentário ou texto não engana: se houver script antes do <head>, vai para o início.
  assert.equal(P.injetarScriptsDaMoldura('<script src="a.js"></script><head>', '/kiro-frame.js'), `${tag}<script src="a.js"></script><head>`);
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
