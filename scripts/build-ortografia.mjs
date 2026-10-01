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
writeFileSync(join(destinoMotor, 'LICENSE.txt'), `==== hunspell-asm ${motor.version} (MIT) ====\n\n${readFileSync(licencaDe('hunspell-asm'), 'utf8').trim()}\n\nO WebAssembly embutido é o Hunspell (https://github.com/hunspell/hunspell), sob MPL 1.1 / GPL 2.0 / LGPL 2.1, à escolha.\n`);

// Dicionários: um script por idioma, que se registra no KiroOrtografia (navegador) ou exporta (Node).
const destinoDic = join(raiz, 'vendor', 'dicionarios');
mkdirSync(destinoDic, { recursive: true });
for (const [codigo, nome] of Object.entries(DICIONARIOS)) {
  const aff = readFileSync(join(pacote(nome), 'index.aff'), 'utf8');
  const dic = readFileSync(join(pacote(nome), 'index.dic'), 'utf8');
  const { version, license } = info(nome);
  const corpo = `/* Dicionário ${codigo} — ${nome} ${version} (${license}) — licença em vendor/dicionarios/LICENSE-${codigo}.txt */\n`
    + `(function (root) {\n  const d = { codigo: ${JSON.stringify(codigo)}, aff: ${JSON.stringify(aff)}, dic: ${JSON.stringify(dic)} };\n`
    + `  if (typeof module !== 'undefined' && module.exports) module.exports = d;\n  else root.KiroOrtografia.registrar(d.codigo, d);\n})(globalThis);\n`;
  writeFileSync(join(destinoDic, `${codigo}.js`), corpo);
  writeFileSync(join(destinoDic, `LICENSE-${codigo}.txt`), `${nome} ${version} — ${license}\n\n${readFileSync(licencaDe(nome), 'utf8').trim()}\n`);
  console.log(`dicionário ${codigo}: ${(corpo.length / 1e6).toFixed(1)} MB`);
}
console.log('vendor/hunspell e vendor/dicionarios gerados');
