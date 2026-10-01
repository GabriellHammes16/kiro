// scripts/build-codemirror.mjs — gera vendor/codemirror/ (rodar só para atualizar a versão:
// npm run vendor:codemirror). O app não tem etapa de build: o resultado é commitado, como o KaTeX.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'vendor', 'codemirror');
mkdirSync(destino, { recursive: true });
await build({
  entryPoints: [join(raiz, 'scripts', 'codemirror-entrada.mjs')],
  bundle: true, minify: true, format: 'iife', globalName: 'CM', target: 'es2020', platform: 'browser',
  outfile: join(destino, 'codemirror.js'),
  banner: { js: '/* CodeMirror 6 — MIT — licenças em vendor/codemirror/LICENSE.txt */' },
  footer: { js: "if (typeof module !== 'undefined' && module.exports) module.exports = CM;" },
});
// Versões e licenças de todos os pacotes que entraram no arquivo.
const pacotes = ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@codemirror/lang-markdown', '@codemirror/autocomplete', '@codemirror/lang-css', '@codemirror/lang-html', '@codemirror/lang-javascript', '@codemirror/lint', '@lezer/css', '@lezer/html', '@lezer/javascript', '@lezer/markdown', '@lezer/common', '@lezer/highlight', '@lezer/lr', 'style-mod', 'w3c-keyname', 'crelt'];
const versoes = [], licencas = [];
for (const p of pacotes) {
  const pasta = join(raiz, 'node_modules', ...p.split('/'));
  if (!existsSync(join(pasta, 'package.json'))) continue;
  const { version, license } = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'));
  versoes.push(`${p} ${version} (${license})`);
  const arquivo = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(n => join(pasta, n)).find(existsSync);
  if (arquivo) licencas.push(`==== ${p} ${version} ====\n\n${readFileSync(arquivo, 'utf8').trim()}\n`);
}
writeFileSync(join(destino, 'VERSAO.txt'), versoes.join('\n') + '\n');
writeFileSync(join(destino, 'LICENSE.txt'), licencas.join('\n'));
console.log(`vendor/codemirror gerado: ${versoes.length} pacotes`);
