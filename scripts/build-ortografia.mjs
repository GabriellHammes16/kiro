import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pacote = nome => join(raiz, 'node_modules', ...nome.split('/'));
const info = nome => JSON.parse(readFileSync(join(pacote(nome), 'package.json'), 'utf8'));
const licencaDe = nome => ['license', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].map(n => join(pacote(nome), n)).find(existsSync);

// Idiomas: código → pacote dictionary-*. Para um idioma novo, acrescente aqui e rode de novo.
const DICIONARIOS = { 'pt-BR': 'dictionary-pt', 'en-US': 'dictionary-en' };

// Motor: a entrada CommonJS ("main"); a variante "browser" do pacote quebra no navegador.
const destinoMotor = join(raiz, 'vendor', 'hunspell');
mkdirSync(destinoMotor, { recursive: true });
await build({
  stdin: { contents: 'export { loadModule } from "hunspell-asm";', resolveDir: raiz },
  bundle: true, format: 'iife', globalName: 'HunspellAsm', platform: 'browser', mainFields: ['main'],
  minify: true, target: 'es2020', external: ['fs', 'path', 'crypto'],
  outfile: join(destinoMotor, 'hunspell.js'),
  banner: { js: '/* HunspellAsm — hunspell-asm (MIT), Hunspell (MPL/LGPL/GPL) — licenças em vendor/hunspell/LICENSE.txt */' },
});
const motor = info('hunspell-asm');
writeFileSync(join(destinoMotor, 'VERSAO.txt'), `hunspell-asm ${motor.version} (${motor.license})\n`);
writeFileSync(join(destinoMotor, 'LICENSE.txt'), `==== hunspell-asm ${motor.version} (MIT) ====\n\n${readFileSync(licencaDe('hunspell-asm'), 'utf8').trim()}\n\n==== Hunspell (MPL 1.1 / GPL 2.0 / LGPL 2.1) ====\n\nCopyright (C) 2002-2023 Hunspell Developers\nhttps://github.com/hunspell/hunspell\n\nHunspell é fornecido sob a Mozilla Public License 1.1 (https://www.mozilla.org/MPL/1.1/), GNU General Public License version 2.0 (GPL 2.0), ou GNU Lesser General Public License version 2.1 (LGPL 2.1), à sua escolha.\n`);

// Dicionários: um script por idioma, que se registra no KiroOrtografia (navegador) ou exporta (Node).
const destinoDic = join(raiz, 'vendor', 'dicionarios');
mkdirSync(destinoDic, { recursive: true });
const mpl20 = readFileSync(join(raiz, 'scripts', 'licencas', 'MPL-2.0.txt'), 'utf8');
for (const [codigo, nome] of Object.entries(DICIONARIOS)) {
  const aff = readFileSync(join(pacote(nome), 'index.aff'), 'utf8');
  const dic = readFileSync(join(pacote(nome), 'index.dic'), 'utf8');
  const { version, license } = info(nome);
  // Remover parênteses duplicados do license se já tiver
  const licenseForComment = license.startsWith('(') ? license : license;
  const corpo = `/* Dicionário ${codigo} — ${nome} ${version} ${licenseForComment} — licença em vendor/dicionarios/LICENSE-${codigo}.txt */\n`
    + `(function (root) {\n  const d = { codigo: ${JSON.stringify(codigo)}, aff: ${JSON.stringify(aff)}, dic: ${JSON.stringify(dic)} };\n`
    + `  if (typeof module !== 'undefined' && module.exports) module.exports = d;\n  else root.KiroOrtografia.registrar(d.codigo, d);\n})(globalThis);\n`;
  writeFileSync(join(destinoDic, `${codigo}.js`), corpo);

  // Para dictionary-pt, incluir o texto completo da MPL-2.0 após a atribuição
  let licenseText;
  if (nome === 'dictionary-pt') {
    const attribution = readFileSync(licencaDe(nome), 'utf8').trim();
    licenseText = `${nome} ${version} — LGPL-3.0 OR MPL-2.0\n\n${attribution}\n\n==== Mozilla Public License Version 2.0 ====\n\n${mpl20}`;
  } else {
    licenseText = `${nome} ${version} — ${license}\n\n${readFileSync(licencaDe(nome), 'utf8').trim()}`;
  }
  writeFileSync(join(destinoDic, `LICENSE-${codigo}.txt`), licenseText + '\n');
  console.log(`dicionário ${codigo}: ${(corpo.length / 1e6).toFixed(1)} MB`);
}
console.log('vendor/hunspell e vendor/dicionarios gerados');
