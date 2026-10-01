// tests/idiomas-cobertura.test.cjs
// Toda frase passada a t() ou frase() — e todo texto visível do index.html — precisa estar em
// idiomas/en.js; nada pode sobrar lá; os marcadores {…} precisam bater.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const FONTES = ['app.js', 'fluxo-tela.js', 'corretor.js', 'editor-nota.js', 'ortografia.js', 'domain.js', 'plugins.js', 'vault.cjs', 'electron/main.cjs', 'server.mjs', 'segredos-plugins.cjs', 'ligacao-rede-plugins.cjs', 'rede-plugins.cjs'];
const CHAMADA = /(?<![\w$.])(?:t|frase)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const TEMPLATE = /(?<![\w$.])(?:t|frase)\(\s*`/g;
const IGNORAR_NO_INDEX = new Set(['Kiro', 'Ctrl+O']);

function frasesDoCodigo() {
  const frases = new Map();   // frase → primeiro arquivo onde aparece
  for (const f of FONTES) {
    const codigo = ler(f);
    for (const m of codigo.matchAll(CHAMADA)) {
      const texto = m[2].replace(/\\(['"\\])/g, '$1');
      if (!frases.has(texto)) frases.set(texto, f);
    }
  }
  return frases;
}
function frasesDoIndex() {
  const corpo = ler('index.html').split('<body>')[1].split('<script')[0];
  const achadas = [
    ...[...corpo.matchAll(/>([^<>]+)</g)].map(m => m[1].trim()),
    ...[...corpo.matchAll(/(?:title|aria-label|alt)="([^"]+)"/g)].map(m => m[1].trim()),
  ];
  return achadas.filter(s => s && !IGNORAR_NO_INDEX.has(s));
}
const marcadores = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('nenhum t() ou frase() com template literal', () => {
  for (const f of FONTES) {
    const achado = [...ler(f).matchAll(TEMPLATE)];
    assert.equal(achado.length, 0, `${f}: use marcadores {nome}, não template literal, em t()/frase()`);
  }
});

test('inglês: toda frase usada existe, nada sobra, marcadores batem', () => {
  const en = require('../idiomas/en.js');
  const usadas = frasesDoCodigo();
  for (const s of frasesDoIndex()) if (!usadas.has(s)) usadas.set(s, 'index.html');
  const faltando = [...usadas].filter(([s]) => !Object.hasOwn(en, s)).map(([s, f]) => `${f}: ${s}`);
  assert.deepEqual(faltando, [], 'frases sem tradução em idiomas/en.js');
  const sobrando = Object.keys(en).filter(s => !usadas.has(s));
  assert.deepEqual(sobrando, [], 'frases em idiomas/en.js que o código não usa mais');
  const errados = Object.entries(en).filter(([pt, tr]) => marcadores(pt) !== marcadores(tr)).map(([pt]) => pt);
  assert.deepEqual(errados, [], 'marcadores {…} diferentes entre o português e a tradução');
  const vazias = Object.entries(en).filter(([, tr]) => typeof tr !== 'string' || !tr.trim()).map(([pt]) => pt);
  assert.deepEqual(vazias, [], 'tradução vazia');
});

test('a página carrega idiomas.js e corretor.js antes do app, e o servidor os entrega', () => {
  const index = ler('index.html');
  assert.ok(index.indexOf('src="idiomas.js"') > -1 && index.indexOf('src="idiomas.js"') < index.indexOf('src="app.js"'));
  assert.ok(index.indexOf('src="corretor.js"') > -1 && index.indexOf('src="corretor.js"') < index.indexOf('src="app.js"'));
  const servidor = ler('server.mjs');
  for (const f of ["'/idiomas.js'", "'/idiomas/en.js'", "'/corretor.js'"]) assert.ok(servidor.includes(f), `server.mjs entrega ${f}`);
});
