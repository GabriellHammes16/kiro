// scripts/build-pdfjs.mjs — gera vendor/pdfjs/ (rodar só para atualizar a versão:
// npm run vendor:pdfjs). O app não tem etapa de build: o resultado é commitado, como
// o KaTeX e o CodeMirror. O build "legacy" do PDF.js vem só como ES module; aqui ele
// vira dois scripts clássicos — a biblioteca (pdfjsLib global) e o worker — porque a
// página do Kiro roda de file:// no desktop e carrega vendor por <script>, como o resto.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pacote = join(raiz, 'node_modules', 'pdfjs-dist');
const origem = join(pacote, 'legacy', 'build');
const destino = join(raiz, 'vendor', 'pdfjs');
mkdirSync(destino, { recursive: true });

const licenca = readFileSync(join(pacote, 'LICENSE'), 'utf8').trim();
const cabecalho = `/* PDF.js (build legacy empacotado) — Apache-2.0 — licença em vendor/pdfjs/LICENSE.txt */`;
await build({
  entryPoints: [join(origem, 'pdf.min.mjs')],
  bundle: true, minify: true, format: 'iife', globalName: 'pdfjsLib', target: 'es2020', platform: 'browser',
  outfile: join(destino, 'pdf.min.js'),
  banner: { js: cabecalho },
});
// O worker é o próprio corpo do PDF.js; empacotar só troca o módulo por um script
// clássico, que é o que new Worker(...) aceita sem type:'module'.
await build({
  entryPoints: [join(origem, 'pdf.worker.min.mjs')],
  bundle: true, minify: true, format: 'iife', target: 'es2020', platform: 'browser',
  outfile: join(destino, 'pdf.worker.min.js'),
  banner: { js: cabecalho },
});
const { version } = JSON.parse(readFileSync(join(pacote, 'package.json'), 'utf8'));
writeFileSync(join(destino, 'VERSAO.txt'), `pdfjs-dist ${version} (Apache-2.0)\n`);
writeFileSync(join(destino, 'LICENSE.txt'), `==== pdfjs-dist ${version} ====\n\n${licenca}\n`);
console.log(`vendor/pdfjs gerado: pdfjs-dist ${version}`);
