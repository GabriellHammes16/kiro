# Editor com visualização ao vivo — etapa 1 — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O corpo da nota passa a ser um editor CodeMirror 6 sempre editável, com visualização ao vivo do texto, corretor com sugestões, e tudo o que o editor de blocos atual faz com texto (salvar, desfazer, atalhos, menus, sugestões de `[[`).

**Architecture:** O CodeMirror 6 entra empacotado em `vendor/codemirror/codemirror.js` (global `CM`, gerado uma vez com esbuild e commitado). Um módulo novo `editor-nota.js` (`KiroEditor`) monta o editor, desenha a visualização ao vivo a partir da árvore de sintaxe e expõe um adaptador `area()` com a forma de um `textarea`, para os menus e atalhos atuais do `app.js` continuarem iguais. O `app.js` troca o editor de blocos do corpo da nota pelo `KiroEditor` e reaproveita a mesma instância entre redesenhos.

**Tech Stack:** JavaScript sem build no app (scripts clássicos), CodeMirror 6 (`@codemirror/*`, `@lezer/markdown`), esbuild só para gerar o vendor, Electron 44, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-01-editor-ao-vivo-etapa-1-design.md`

## Global Constraints

- Branch `editor-ao-vivo` (criado sobre `idiomas-etapa-1`). Nenhum instalador nesta etapa.
- Motor: CodeMirror 6, licença MIT; nenhum código do Obsidian. Licenças em `vendor/codemirror/LICENSE.txt`.
- O app continua sem etapa de build: o vendor é gerado por `npm run vendor:codemirror` e commitado; `esbuild` só em `devDependencies`.
- CodeMirror carregado sob demanda, na primeira nota aberta.
- Texto no cofre idêntico byte a byte ao recebido se nada foi editado (inclui `\r\n`): ler o texto do editor sempre com `state.sliceDoc()`, nunca `doc.toString()`.
- Símbolos de Markdown escondidos fora da linha do cursor (ou das linhas da seleção).
- `spellcheck="false"` em código (em linha e blocos), endereços de link, alvo de `[[Nota]]` e etiquetas.
- Desempenho: abrir a nota mais longa do `dev-vault` ≤ 1,5× o tempo atual; < 16 ms por tecla; `render()` de Hoje e Notas sem piora.
- Frases visíveis novas passam por `t()` e entram em `idiomas/en.js` (o teste de cobertura exige; `editor-nota.js` entra na lista `FONTES` desse teste).
- `t` é nome de variável local em vários escopos do `app.js`: ao pôr `t(...)` num escopo com `t` local, renomeie o local.
- Código e comentários em português, no estilo do arquivo editado. Commits `Editor: …` terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` passa ao fim de cada task.

## Review Focus

- Nota com `\r\n`, tabulações, espaço no fim da linha, emoji — abrir, não editar, salvar: o arquivo não muda. Teste na Task 1 (ida e volta) e na Task 3 (`texto()` de um editor montado num estado com `\r\n`).
- `[[` sem fechar, `#` no meio de palavra (`C#`, `a#b`), `#` dentro de código, `[[` dentro de código — nada disso vira marcação. Teste na Task 2.
- Seleção que atravessa várias linhas — todas mostram os símbolos (nenhum símbolo escondido dentro da seleção). Teste na Task 2.
- Redesenho (`render()`) com o cursor no meio da nota — cursor, rolagem e desfazer continuam; Ctrl+Z depois de salvar desfaz a última edição. Verificação automatizada na Task 5.
- Releitura de 5 s com o editor focado — o foco e o cursor ficam. Verificação automatizada na Task 5.

---

### Task 0: Medição de referência (feita por quem coordena)

**Files:** nenhum.

- [ ] **Step 1:** Com `npm run dev` (http://127.0.0.1:4180, `dev-vault`) e o navegador automatizado, medir, 3 rodadas, mediana:
  - `render()` de Hoje e Notas (script de `<scratchpad>/medir-pt-BR.mjs`);
  - tempo para abrir a nota mais longa do `dev-vault` (do `abrirNota(n)` até o corpo desenhado, `performance.now()`);
  - atraso por tecla no editor atual: abrir um bloco, digitar 200 caracteres com `keyboard.type(…, { delay: 0 })`, medir o tempo total / 200.
- [ ] **Step 2:** Anotar no fim deste plano, em "Medições".

---

### Task 1: CodeMirror empacotado em `vendor/codemirror`

**Files:**
- Create: `scripts/codemirror-entrada.mjs`, `scripts/build-codemirror.mjs`
- Create (gerados): `vendor/codemirror/codemirror.js`, `vendor/codemirror/LICENSE.txt`, `vendor/codemirror/VERSAO.txt`
- Modify: `package.json` (devDependencies + script `vendor:codemirror`), `server.mjs` (servir o vendor)
- Test: `tests/editor-vendor.test.cjs`

**Interfaces:**
- Produces: global `CM` no navegador e `module.exports = CM` no Node, com `CM.state`, `CM.view`, `CM.commands`, `CM.language`, `CM.markdown` (`@codemirror/lang-markdown`), `CM.lezerMarkdown` (`@lezer/markdown`). Servido em `/vendor/codemirror/codemirror.js`.

- [ ] **Step 1: Teste**

```js
// tests/editor-vendor.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CM = require('../vendor/codemirror/codemirror.js');

const estado = (texto, separador) => CM.state.EditorState.create({
  doc: texto,
  extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage }), ...(separador ? [CM.state.EditorState.lineSeparator.of(separador)] : [])],
});

test('o vendor expõe os pacotes que o editor usa', () => {
  for (const nome of ['state', 'view', 'commands', 'language', 'markdown', 'lezerMarkdown']) assert.ok(CM[nome], nome);
  assert.equal(typeof CM.view.EditorView, 'function');
  assert.equal(typeof CM.commands.history, 'function');
});

test('ida e volta: o texto sai igual ao que entrou, inclusive \\r\\n', () => {
  const texto = '# Título\r\n\r\n\tcom tab  \r\nacentuação ✨ 🧠\r\n- item\r\n';
  assert.equal(estado(texto, '\r\n').sliceDoc(), texto);
  const lf = 'linha 1\nlinha 2  \n\n';
  assert.equal(estado(lf).sliceDoc(), lf);
});

test('a árvore de sintaxe reconhece Markdown com as extensões do GitHub', () => {
  const s = estado('# T\n\n~~x~~ **y**\n\n- [ ] tarefa\n');
  const nomes = new Set();
  CM.language.ensureSyntaxTree(s, s.doc.length, 5000).iterate({ enter: n => { nomes.add(n.name); } });
  for (const n of ['ATXHeading1', 'HeaderMark', 'Strikethrough', 'StrongEmphasis', 'BulletList', 'Task']) assert.ok(nomes.has(n), n);
});

test('o servidor entrega o vendor e a licença está junto', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'server.mjs'), 'utf8').includes('codemirror'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'codemirror', 'LICENSE.txt'), 'utf8'), /MIT/);
});
```

Run: `node --test tests/editor-vendor.test.cjs` — Expected: FAIL (`Cannot find module '../vendor/codemirror/codemirror.js'`).

- [ ] **Step 2: Dependências de desenvolvimento**

```bash
npm install --save-dev esbuild @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-markdown @lezer/markdown
```

Todos em `devDependencies` (o app só usa o arquivo gerado). Acrescente em `package.json` → `scripts`: `"vendor:codemirror": "node scripts/build-codemirror.mjs"`.

- [ ] **Step 3: Entrada e gerador**

```js
// scripts/codemirror-entrada.mjs — o que o Kiro usa do CodeMirror 6, num objeto só (global CM).
export * as state from '@codemirror/state';
export * as view from '@codemirror/view';
export * as commands from '@codemirror/commands';
export * as language from '@codemirror/language';
export * as markdown from '@codemirror/lang-markdown';
export * as lezerMarkdown from '@lezer/markdown';
```

```js
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
const pacotes = ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@codemirror/lang-markdown', '@codemirror/autocomplete', '@lezer/markdown', '@lezer/common', '@lezer/highlight', '@lezer/lr', 'style-mod', 'w3c-keyname', 'crelt'];
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
```

Run: `npm run vendor:codemirror`. Confira em `VERSAO.txt` que todos os pacotes presentes em `node_modules` foram listados; se o esbuild avisar de pacote não listado em `pacotes` (veja `node_modules/@codemirror` e `node_modules/@lezer`), acrescente-o à lista e gere de novo. Tamanho esperado de `codemirror.js`: ~300–450 KB (anote no relatório).

- [ ] **Step 4: Servir o vendor na versão web**

`server.mjs`, junto da rota do KaTeX (linha ~106), uma rota fixa para o arquivo:

```js
    if (rota === '/vendor/codemirror/codemirror.js') {
      const corpo = await readFile(join(root, 'vendor', 'codemirror', 'codemirror.js'));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(corpo);
    }
```

(Use os mesmos nomes de variáveis — `rota`, `root`, `res` — e o mesmo estilo de cabeçalhos que a rota do KaTeX ao lado usa; se forem outros, adapte.)

- [ ] **Step 5: Testes e commit**

Run: `node --test tests/editor-vendor.test.cjs` — PASS; `npm test` — nenhum `fail`.

```bash
git add package.json package-lock.json scripts/codemirror-entrada.mjs scripts/build-codemirror.mjs vendor/codemirror server.mjs tests/editor-vendor.test.cjs
git commit   # "Editor: CodeMirror 6 empacotado em vendor/codemirror"
```

---

### Task 2: Visualização ao vivo — as partes puras

**Files:**
- Create: `editor-nota.js` (só as partes puras nesta task)
- Test: `tests/editor-ao-vivo.test.cjs`

**Interfaces:**
- Consumes: `CM` (Task 1) — no navegador `globalThis.CM`; no Node o teste faz `globalThis.CM = require('../vendor/codemirror/codemirror.js')` antes de carregar o módulo. O módulo lê `root.CM` na hora de usar, nunca no carregamento.
- Produces (`KiroEditor`, UMD como `hoje.js`):
  - `separadorDeLinha(texto: string): '\r\n' | '\n'` — `'\r\n'` se o texto contém `\r\n`.
  - `marcacoesDoKiro(linha: string): Array<{ tipo: 'wikilink'|'etiqueta'|'realce', de: number, ate: number, alvo?: string, apelido?: string }>` — posições relativas à linha; `de`/`ate` cobrem a marcação inteira (`[[…]]`, `#tag`, `==…==`). Não reconhece `![[` (imagem, etapa 2).
  - `analisar(state: EditorState, de: number, ate: number, linhasDoCursor: Set<number>): { esconder: Array<[number, number]>, estilos: Array<[number, number, string]>, linhas: Array<[number, string]>, trocar: Array<[number, number, string]> }`:
    - `esconder` — intervalos de símbolos a esconder (só em linhas fora de `linhasDoCursor`);
    - `estilos` — `[de, ate, classe]` para marcar texto (`ed-negrito`, `ed-italico`, `ed-tachado`, `ed-realce`, `ed-codigo`, `ed-link`, `ed-wikilink`, `ed-wikilink-ausente`, `ed-etiqueta`) e `[de, ate, 'ed-sem-corretor']` para código, endereço, alvo de wikilink e etiqueta;
    - `linhas` — `[posiçãoDoInícioDaLinha, classe]` (`ed-h1`…`ed-h6`, `ed-citacao`, `ed-codigo-bloco`, `ed-regua`);
    - `trocar` — `[de, ate, texto]` para o marcador de lista (`-`, `*`, `+` → `•`) fora da linha do cursor.
    - Números de linha em `linhasDoCursor` são os de `state.doc.lineAt(pos).number`.
  - `linhasDaSelecao(state): Set<number>` — todas as linhas tocadas por qualquer faixa da seleção.
  - Opção `existe(alvo)` passada a `analisar` como 5º argumento opcional `{ existe }` — sem ela, todo wikilink é `ed-wikilink`.

- [ ] **Step 1: Testes**

```js
// tests/editor-ao-vivo.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const E = require('../editor-nota.js');

const estado = (texto, cursor = 0, cursorFim = cursor) => CM.state.EditorState.create({
  doc: texto,
  selection: CM.state.EditorSelection.single(cursor, cursorFim),
  extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage })],
});
const ver = (texto, { cursor = texto.length, cursorFim, existe } = {}) => {
  const s = estado(texto, cursor, cursorFim ?? cursor);
  CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
  return E.analisar(s, 0, s.doc.length, E.linhasDaSelecao(s), { existe });
};
const fatias = (texto, intervalos) => intervalos.map(([a, b]) => texto.slice(a, b));

test('separadorDeLinha', () => {
  assert.equal(E.separadorDeLinha('a\r\nb'), '\r\n');
  assert.equal(E.separadorDeLinha('a\nb'), '\n');
  assert.equal(E.separadorDeLinha(''), '\n');
});

test('negrito: esconde ** fora da linha do cursor, mostra na linha do cursor', () => {
  const texto = '**forte**\n\nfim';
  const longe = ver(texto, { cursor: texto.length });
  assert.deepEqual(fatias(texto, longe.esconder), ['**', '**']);
  assert.ok(longe.estilos.some(([a, b, c]) => c === 'ed-negrito' && texto.slice(a, b).includes('forte')));
  const perto = ver(texto, { cursor: 3 });
  assert.deepEqual(perto.esconder, []);
  assert.ok(perto.estilos.some(([, , c]) => c === 'ed-negrito'), 'o estilo continua na linha do cursor');
});

test('título: classe na linha e # escondido fora do cursor', () => {
  const texto = '## Seção\n\ntexto';
  const r = ver(texto);
  assert.deepEqual(r.linhas.filter(([, c]) => c.startsWith('ed-h')), [[0, 'ed-h2']]);
  assert.deepEqual(fatias(texto, r.esconder), ['## ']);
});

test('link: mostra só o texto', () => {
  const texto = 'veja [site](https://x.com) agora\n\n.';
  const r = ver(texto);
  assert.deepEqual(fatias(texto, r.esconder), ['[', '](https://x.com)']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-link' && texto.slice(a, b) === 'site'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('https://x.com')));
});

test('wikilink com apelido: esconde [[ alvo| e ]]; ausente fica com outra classe', () => {
  const texto = 'ir para [[Plano de estudos|plano]] e [[Nada]]\n\n.';
  const r = ver(texto, { existe: alvo => alvo === 'Plano de estudos' });
  assert.deepEqual(fatias(texto, r.esconder), ['[[Plano de estudos|', ']]', '[[', ']]']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-wikilink' && texto.slice(a, b) === 'plano'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-wikilink-ausente' && texto.slice(a, b) === 'Nada'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b) === 'Nada'), 'alvo sem apelido não é verificado');
});

test('etiqueta e realce', () => {
  const texto = 'nota #ideia com ==destaque==\n\n.';
  const r = ver(texto);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-etiqueta' && texto.slice(a, b) === '#ideia'));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b) === '#ideia'));
  assert.deepEqual(fatias(texto, r.esconder), ['==', '==']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-realce' && texto.slice(a, b) === 'destaque'));
});

test('o que não é marcação do Kiro', () => {
  assert.deepEqual(E.marcacoesDoKiro('C# e a#b e [[sem fim'), []);
  assert.deepEqual(E.marcacoesDoKiro('![[imagem.png]]'), [], 'imagem é da etapa 2');
  const texto = 'texto `[[x]] #y ==z==` fim\n\n```\n[[a]] #b\n```\n\n.';
  const r = ver(texto);
  assert.ok(!r.estilos.some(([, , c]) => ['ed-wikilink', 'ed-wikilink-ausente', 'ed-etiqueta', 'ed-realce'].includes(c)), 'nada dentro de código');
});

test('lista: marcador vira • fora do cursor', () => {
  const texto = '- um\n- dois\n\n.';
  const r = ver(texto);
  assert.deepEqual(r.trocar.map(([a, b, s]) => [texto.slice(a, b), s]), [['-', '•'], ['-', '•']]);
  const naLinha = ver(texto, { cursor: 2 });
  assert.deepEqual(naLinha.trocar.map(([a, b]) => texto.slice(a, b)), ['-'], 'na linha do cursor o - fica');
});

test('citação, régua e bloco de código', () => {
  const texto = '> dito\n\n---\n\n```js\nlet a\n```\n\n.';
  const r = ver(texto);
  const classes = r.linhas.map(([, c]) => c);
  assert.ok(classes.includes('ed-citacao') && classes.includes('ed-regua') && classes.includes('ed-codigo-bloco'));
  assert.ok(fatias(texto, r.esconder).includes('> '));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('let a')));
});

test('seleção de várias linhas mostra os símbolos em todas', () => {
  const texto = '**a**\n**b**\n**c**';
  const r = ver(texto, { cursor: 0, cursorFim: texto.length });
  assert.deepEqual(r.esconder, []);
});

test('código em linha: crases escondidas fora do cursor, conteúdo sem corretor', () => {
  const texto = 'use `npm test` aqui\n\n.';
  const r = ver(texto);
  assert.deepEqual(fatias(texto, r.esconder), ['`', '`']);
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-codigo' && texto.slice(a, b).includes('npm test')));
  assert.ok(r.estilos.some(([a, b, c]) => c === 'ed-sem-corretor' && texto.slice(a, b).includes('npm test')));
});
```

Run: `node --test tests/editor-ao-vivo.test.cjs` — Expected: FAIL (`Cannot find module '../editor-nota.js'`).

- [ ] **Step 2: Implementar `editor-nota.js` (partes puras)**

```js
// Editor do corpo da nota: CodeMirror 6 (vendor/codemirror) com visualização ao vivo. Este
// arquivo tem duas metades: as partes puras (análise do texto → o que esconder e estilizar),
// testáveis no Node, e a montagem na página (Task 3). Não conhece o cofre: recebe o texto e
// entrega o novo por aoMudar.
(function (root) {
  const CM = () => root.CM;

  const separadorDeLinha = texto => (texto.includes('\r\n') ? '\r\n' : '\n');

  // [[alvo]] / [[alvo|apelido]] (não ![[ — imagem é etapa 2), #etiqueta como em domain.js
  // (início de linha ou depois de espaço), ==realce==.
  const WIKILINK = /(?<!!)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g;
  const ETIQUETA = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;
  const REALCE = /==([^=\n](?:[^\n]*?[^=\n])?)==/g;
  function marcacoesDoKiro(linha) {
    const achadas = [];
    for (const m of linha.matchAll(WIKILINK)) achadas.push({ tipo: 'wikilink', de: m.index, ate: m.index + m[0].length, alvo: m[1].trim(), apelido: m[2]?.trim() });
    for (const m of linha.matchAll(ETIQUETA)) { const de = m.index + m[1].length; achadas.push({ tipo: 'etiqueta', de, ate: de + m[2].length }); }
    for (const m of linha.matchAll(REALCE)) achadas.push({ tipo: 'realce', de: m.index, ate: m.index + m[0].length });
    return achadas.sort((a, b) => a.de - b.de);
  }

  function linhasDaSelecao(state) {
    const linhas = new Set();
    for (const faixa of state.selection.ranges) {
      const ini = state.doc.lineAt(faixa.from).number, fim = state.doc.lineAt(faixa.to).number;
      for (let n = ini; n <= fim; n++) linhas.add(n);
    }
    return linhas;
  }

  const ESTILO_DO_NO = { StrongEmphasis: 'ed-negrito', Emphasis: 'ed-italico', Strikethrough: 'ed-tachado', InlineCode: 'ed-codigo' };
  const MARCAS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);

  function analisar(state, de, ate, linhasDoCursor, { existe } = {}) {
    const r = { esconder: [], estilos: [], linhas: [], trocar: [] };
    const naLinhaDoCursor = pos => linhasDoCursor.has(state.doc.lineAt(pos).number);
    const esconder = (a, b) => { if (b > a && !naLinhaDoCursor(a)) r.esconder.push([a, b]); };
    const codigo = [];   // trechos de código: marcações do Kiro não valem dentro deles
    const linhasDe = (a, b, classe) => { for (let p = a; p <= b;) { const l = state.doc.lineAt(p); r.linhas.push([l.from, classe]); p = l.to + 1; } };
    CM().language.syntaxTree(state).iterate({
      from: de, to: ate,
      enter: no => {
        const nome = no.name;
        const titulo = /^ATXHeading([1-6])$/.exec(nome);
        if (titulo) { r.linhas.push([state.doc.lineAt(no.from).from, `ed-h${titulo[1]}`]); return; }
        if (nome === 'HeaderMark') { const fim = state.sliceDoc(no.to, no.to + 1) === ' ' ? no.to + 1 : no.to; esconder(no.from, fim); return; }
        if (ESTILO_DO_NO[nome]) r.estilos.push([no.from, no.to, ESTILO_DO_NO[nome]]);
        if (nome === 'InlineCode') { r.estilos.push([no.from, no.to, 'ed-sem-corretor']); codigo.push([no.from, no.to]); }
        if (MARCAS.has(nome)) { esconder(no.from, no.to); return; }
        if (nome === 'Link') {
          const marcas = [], url = [];
          for (let f = no.node.firstChild; f; f = f.nextSibling) { if (f.name === 'LinkMark') marcas.push(f); if (f.name === 'URL') url.push(f); }
          if (marcas.length >= 2) {
            r.estilos.push([marcas[0].to, marcas[1].from, 'ed-link']);
            esconder(marcas[0].from, marcas[0].to);
            esconder(marcas[1].from, no.to);
          }
          for (const u of url) r.estilos.push([u.from, u.to, 'ed-sem-corretor']);
          return false;
        }
        if (nome === 'Blockquote') linhasDe(no.from, no.to, 'ed-citacao');
        if (nome === 'QuoteMark') { const fim = state.sliceDoc(no.to, no.to + 1) === ' ' ? no.to + 1 : no.to; esconder(no.from, fim); return; }
        if (nome === 'HorizontalRule') { r.linhas.push([state.doc.lineAt(no.from).from, 'ed-regua']); esconder(no.from, no.to); return; }
        if (nome === 'ListMark') {
          const sinal = state.sliceDoc(no.from, no.to);
          if (/^[-*+]$/.test(sinal) && !naLinhaDoCursor(no.from)) r.trocar.push([no.from, no.to, '•']);
          return;
        }
        if (nome === 'FencedCode') {
          linhasDe(no.from, no.to, 'ed-codigo-bloco');
          codigo.push([no.from, no.to]);
          const primeira = state.doc.lineAt(no.from), ultima = state.doc.lineAt(no.to);
          if (ultima.number > primeira.number + 1) r.estilos.push([state.doc.line(primeira.number + 1).from, state.doc.line(ultima.number - 1).to, 'ed-sem-corretor']);
          esconder(primeira.from, primeira.to);
          if (/^\s*(```|~~~)/.test(ultima.text) && ultima.number > primeira.number) esconder(ultima.from, ultima.to);
          return false;
        }
      },
    });
    // Marcações do Kiro, linha a linha, fora de código.
    const dentroDeCodigo = (a, b) => codigo.some(([x, y]) => a < y && b > x);
    for (let p = de; p <= ate;) {
      const linha = state.doc.lineAt(p);
      for (const m of marcacoesDoKiro(linha.text)) {
        const a = linha.from + m.de, b = linha.from + m.ate;
        if (dentroDeCodigo(a, b)) continue;
        if (m.tipo === 'etiqueta') { r.estilos.push([a, b, 'ed-etiqueta'], [a, b, 'ed-sem-corretor']); continue; }
        if (m.tipo === 'realce') { r.estilos.push([a + 2, b - 2, 'ed-realce']); esconder(a, a + 2); esconder(b - 2, b); continue; }
        const classe = existe && !existe(m.alvo) ? 'ed-wikilink-ausente' : 'ed-wikilink';
        const inicioDoTexto = m.apelido ? a + 2 + linha.text.slice(m.de + 2).indexOf('|') + 1 : a + 2;
        r.estilos.push([inicioDoTexto, b - 2, classe]);
        if (!m.apelido) r.estilos.push([a + 2, b - 2, 'ed-sem-corretor']);
        esconder(a, inicioDoTexto);
        esconder(b - 2, b);
      }
      p = linha.to + 1;
    }
    r.esconder.sort((x, y) => x[0] - y[0]);
    return r;
  }

  const api = { separadorDeLinha, marcacoesDoKiro, linhasDaSelecao, analisar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroEditor = api;
})(globalThis);
```

Run: `node --test tests/editor-ao-vivo.test.cjs`. Se algum teste falhar por diferença de nome de nó da árvore (ex.: o `@lezer/markdown` instalado chamar `URL` de outra forma), confira os nomes com um `iterate` impresso e ajuste **o código**, nunca o que o teste pede (o comportamento no teste é o da spec). Expected: PASS.

- [ ] **Step 3: `npm test` e commit**

`npm test` — nenhum `fail`.

```bash
git add editor-nota.js tests/editor-ao-vivo.test.cjs
git commit   # "Editor: análise do texto para a visualização ao vivo"
```

---

### Task 3: `KiroEditor.montar` e o adaptador `area()`

**Files:**
- Modify: `editor-nota.js` (montagem na página, carregamento sob demanda, adaptador)
- Modify: `styles.css` (classes `ed-*`), `index.html` (script `editor-nota.js`), `server.mjs` (`/editor-nota.js`)
- Modify: `tests/idiomas-cobertura.test.cjs` (`'editor-nota.js'` em `FONTES`)
- Test: `tests/editor-area.test.cjs`

**Interfaces:**
- Consumes: Task 2 (`analisar`, `linhasDaSelecao`, `separadorDeLinha`).
- Produces (acrescentados a `KiroEditor`):
  - `carregar(): Promise<void>` — garante `root.CM` (no navegador insere `<script src="vendor/codemirror/codemirror.js">` uma vez; falha rejeita com `Error('Não foi possível carregar o editor')`).
  - `criarArea({ estado: () => EditorState, aplicar: (spec) => void, focar: () => void, posicao?: () => {left, top, altura} })` — adaptador puro: `{ get value, get selectionStart, get selectionEnd, setSelectionRange(a, b), focus(), inserir(texto), posicao() }`. `inserir` aplica `{ changes: { from, to, insert }, selection: { anchor: from + texto.length }, userEvent: 'input' }` sobre a seleção principal. `value` é `estado().sliceDoc()`.
  - `montar(elemento, { texto, aoMudar(texto), aoSalvar(), existe(alvo), aoTeclar(evento): boolean, aoMoverCursor(), aoColar(evento): boolean, aoMenu(evento): void })` → `{ dom, texto(), definirTexto(novo), area(), focar(onde?: 'inicio'|'fim'|number), temFoco(), rolarPara(pos), destruir() }`.

- [ ] **Step 1: Teste do adaptador (Node)**

```js
// tests/editor-area.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const E = require('../editor-nota.js');

function areaDe(texto, a = 0, b = a) {
  let estado = CM.state.EditorState.create({ doc: texto, selection: CM.state.EditorSelection.single(a, b), extensions: [CM.state.EditorState.lineSeparator.of(E.separadorDeLinha(texto))] });
  const area = E.criarArea({ estado: () => estado, aplicar: spec => { estado = estado.update(spec).state; }, focar() {} });
  return { area, texto: () => estado.sliceDoc() };
}

test('a área se comporta como um textarea para os menus', () => {
  const { area, texto } = areaDe('um dois três', 3, 7);
  assert.equal(area.value, 'um dois três');
  assert.equal(area.selectionStart, 3);
  assert.equal(area.selectionEnd, 7);
  area.inserir('**' + area.value.slice(area.selectionStart, area.selectionEnd) + '**');
  assert.equal(texto(), 'um **dois** três');
  assert.equal(area.selectionStart, area.selectionEnd);
  area.setSelectionRange(0, 2);
  assert.deepEqual([area.selectionStart, area.selectionEnd], [0, 2]);
});

test('com \\r\\n, posições e texto devolvido batem com o textarea do Windows', () => {
  const { area, texto } = areaDe('a\r\nb', 3);   // depois do \r\n
  area.inserir('X');
  assert.equal(texto(), 'a\r\nXb');
});
```

Atenção ao segundo teste: com `lineSeparator` `\r\n`, as posições do CodeMirror contam o separador como **1** caractere; um `textarea` também normaliza para `\n`. Se `selectionStart` 3 não cair onde o teste espera, o adaptador precisa converter posições (posição no texto com `\r\n` ↔ posição do CodeMirror) e o teste deve continuar descrevendo o comportamento de um `textarea` com o mesmo texto. Decida pelo que `envolver`/`prefixar` do `app.js` esperam (eles usam `value` e índices sobre o mesmo `value`): o requisito é **`value` e os índices serem coerentes entre si**. Se precisar, troque o teste para `'a\r\nb'` com cursor no índice de `value.indexOf('b')` e afirme `texto() === 'a\r\nXb'` — mantendo a intenção (inserção no lugar certo, separador preservado).

Run: `node --test tests/editor-area.test.cjs` — Expected: FAIL (`E.criarArea is not a function`).

- [ ] **Step 2: Implementar `criarArea`, `carregar` e `montar`**

Em `editor-nota.js`, antes de `const api`:

```js
  // Adaptador: o que os menus e atalhos do app esperam de um textarea, sobre o estado do editor.
  // value e os índices usam o mesmo texto (sliceDoc), então envolver/prefixar continuam iguais.
  function criarArea({ estado, aplicar, focar, posicao }) {
    return {
      get value() { return estado().sliceDoc(); },
      get selectionStart() { return estado().selection.main.from; },
      get selectionEnd() { return estado().selection.main.to; },
      setSelectionRange(a, b = a) { aplicar({ selection: { anchor: a, head: b } }); },
      focus() { focar(); },
      inserir(texto) {
        const { from, to } = estado().selection.main;
        aplicar({ changes: { from, to, insert: texto }, selection: { anchor: from + texto.length }, userEvent: 'input' });
      },
      posicao: () => (posicao ? posicao() : null),
    };
  }

  let carregando = null;
  function carregar() {
    if (root.CM) return Promise.resolve();
    carregando ??= new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'vendor/codemirror/codemirror.js';
      s.onload = () => (root.CM ? ok() : falha(new Error('Não foi possível carregar o editor')));
      s.onerror = () => { carregando = null; s.remove(); falha(new Error('Não foi possível carregar o editor')); };
      document.head.appendChild(s);
    });
    return carregando;
  }

  function montar(elemento, { texto, aoMudar, aoSalvar, existe, aoTeclar, aoMoverCursor, aoColar, aoMenu }) {
    const { state: S, view: V, commands: C, language: L, markdown: M } = CM();
    const decorar = view => {
      const linhas = linhasDaSelecao(view.state), marcas = [];
      for (const { from, to } of view.visibleRanges) {
        L.ensureSyntaxTree(view.state, to, 50);
        const r = analisar(view.state, from, to, linhas, { existe });
        for (const [a, , classe] of r.linhas) marcas.push(V.Decoration.line({ class: classe }).range(a));
        for (const [a, b, classe] of r.estilos) if (b > a) marcas.push(V.Decoration.mark(classe === 'ed-sem-corretor' ? { attributes: { spellcheck: 'false' } } : { class: classe }).range(a, b));
        for (const [a, b] of r.esconder) marcas.push(V.Decoration.replace({}).range(a, b));
        for (const [a, b, s] of r.trocar) marcas.push(V.Decoration.replace({ widget: new Marcador(s) }).range(a, b));
      }
      return V.Decoration.set(marcas, true);
    };
    class Marcador extends V.WidgetType {
      constructor(s) { super(); this.s = s; }
      eq(o) { return o.s === this.s; }
      toDOM() { const e = document.createElement('span'); e.className = 'ed-marcador'; e.textContent = this.s; return e; }
    }
    const aoVivo = V.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = decorar(view); }
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || L.syntaxTree(u.startState) !== L.syntaxTree(u.state)) this.decorations = decorar(u.view); }
    }, { decorations: v => v.decorations });
    const view = new V.EditorView({
      parent: elemento,
      state: S.EditorState.create({
        doc: texto,
        extensions: [
          S.EditorState.lineSeparator.of(separadorDeLinha(texto)),
          C.history(),
          S.Prec.highest(V.EditorView.domEventHandlers({
            keydown: e => Boolean(aoTeclar?.(e)),
            paste: e => Boolean(aoColar?.(e)),
            drop: e => Boolean(aoColar?.(e)),
            contextmenu: e => { aoMenu?.(e); return false; },
          })),
          V.keymap.of([
            { key: 'Mod-s', run: () => { aoSalvar?.(); return true; } },
            { key: 'Escape', run: v => { v.contentDOM.blur(); return true; } },
            ...M.markdownKeymap, C.indentWithTab, ...C.historyKeymap, ...C.defaultKeymap,
          ]),
          M.markdown({ base: M.markdownLanguage }),
          V.EditorView.lineWrapping,
          V.EditorView.contentAttributes.of({ 'aria-label': root.KiroIdiomas ? root.KiroIdiomas.t('Conteúdo da nota') : 'Conteúdo da nota' }),
          aoVivo,
          V.EditorView.updateListener.of(u => {
            if (u.docChanged) aoMudar?.(u.state.sliceDoc());
            if (u.docChanged || u.selectionSet) aoMoverCursor?.();
          }),
        ],
      }),
    });
    const aplicar = spec => view.dispatch(spec);
    const posicao = () => { const c = view.coordsAtPos(view.state.selection.main.head); return c ? { left: c.left, top: c.top, altura: c.bottom - c.top } : null; };
    const area = criarArea({ estado: () => view.state, aplicar, focar: () => view.focus(), posicao });
    return {
      dom: view.dom,
      texto: () => view.state.sliceDoc(),
      definirTexto(novo) {
        if (novo === view.state.sliceDoc()) return;
        const cursor = Math.min(view.state.selection.main.head, novo.length);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: novo }, selection: { anchor: cursor } });
      },
      area: () => area,
      focar(onde) {
        const pos = onde === 'inicio' ? 0 : onde === 'fim' ? view.state.doc.length : typeof onde === 'number' ? onde : null;
        if (pos !== null) view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      },
      temFoco: () => view.hasFocus,
      rolarPara(pos) { view.dispatch({ effects: V.EditorView.scrollIntoView(pos, { y: 'start' }) }); },
      destruir: () => view.destroy(),
    };
  }
```

e troque a linha `const api` por:

```js
  const api = { separadorDeLinha, marcacoesDoKiro, linhasDaSelecao, analisar, criarArea, carregar, montar };
```

`'Conteúdo da nota'` já existe em `idiomas/en.js` (o editor de blocos usa a mesma frase); `'Não foi possível carregar o editor'` é usada pelo `app.js` na Task 4.

Run: `node --test tests/editor-area.test.cjs tests/editor-ao-vivo.test.cjs` — PASS.

- [ ] **Step 3: Página, servidor, CSS, cobertura**

`index.html`, depois de `<script src="corretor.js"></script>`: `<script src="editor-nota.js"></script>` (o vendor **não** entra no index — é carregado sob demanda).

`server.mjs` → `publicFiles`: `'/editor-nota.js': ['editor-nota.js', 'text/javascript'],`.

`tests/idiomas-cobertura.test.cjs` → `FONTES`: acrescente `'editor-nota.js'`.

`styles.css`, uma seção nova no fim (`/* Editor da nota (CodeMirror) */`). Copie tamanhos/pesos/cores das regras da leitura (`.doc-corpo h1`…`h4` ~linha 367–368, `blockquote` 374, `hr` 377, `code` 378/487, `mark` 380, `.wikilink` 385–387, `.md-tag` 382, `a[href]` 388) para as classes do editor, sem mudar as da leitura:

```css
/* Editor da nota (CodeMirror): mesma cara da leitura (.doc-corpo …), aplicada às linhas e trechos do editor. */
.doc-corpo .cm-editor { background:transparent; font:inherit; color:inherit; }
.doc-corpo .cm-editor.cm-focused { outline:none; }
.doc-corpo .cm-content { padding:0; caret-color:var(--acento); font-family:inherit; line-height:inherit; }
.doc-corpo .cm-line { padding:0; }
.doc-corpo .cm-cursor { border-left-color:var(--acento); }
.doc-corpo .ed-negrito { font-weight:700; }
.doc-corpo .ed-italico { font-style:italic; }
.doc-corpo .ed-tachado { text-decoration:line-through; }
```

Depois dessas, acrescente uma regra para cada classe abaixo, copiando as declarações da regra da leitura indicada (abra `styles.css` nas linhas citadas e copie tamanho, peso, cor, fundo, borda e fonte; margens de bloco não se aplicam a linhas do editor):

| Classe do editor | Copiar de |
|---|---|
| `.doc-corpo .ed-h1` … `.ed-h4` | `.doc-corpo h1` … `h4` (~367–368: `font-size`, `line-height`, `letter-spacing`, peso) |
| `.doc-corpo .ed-h5`, `.ed-h6` | igual a `.ed-h4` |
| `.doc-corpo .ed-realce` | `.doc-corpo mark` (~380) |
| `.doc-corpo .ed-codigo` | `.doc-corpo code` (~378 e 487) |
| `.doc-corpo .ed-link` | `.doc-corpo a[href]` (~388) |
| `.doc-corpo .ed-wikilink`, `.ed-wikilink-ausente` | `.wikilink`, `.wikilink.ausente` (~385–387) |
| `.doc-corpo .ed-etiqueta` | `.md-tag` (~382) |
| `.doc-corpo .ed-citacao` | `.doc-corpo blockquote` (~374): só `border-left`, `background` e `padding-left` |
| `.doc-corpo .ed-regua` | `.doc-corpo hr` (~377): `border-bottom` na linha no lugar de `border-top` |
| `.doc-corpo .ed-codigo-bloco` | `.doc-corpo code` (~378, 487): `font-family` e `background` |
| `.doc-corpo .ed-marcador` | `color:var(--muted)` |

Confira a cara no navegador na Task 4: o texto no editor deve parecer o da leitura.

- [ ] **Step 4: `npm test` e commit**

`npm test` — nenhum `fail`.

```bash
git add editor-nota.js styles.css index.html server.mjs tests/editor-area.test.cjs tests/idiomas-cobertura.test.cjs
git commit   # "Editor: montagem do CodeMirror, adaptador dos menus e estilos"
```

---

### Task 4: O `app.js` passa a usar o editor novo

**Files:**
- Modify: `app.js` — `renderEditor` (~1743), `bindEditor` (~1771), `render()` (~37), `salvarNota` (~3209), `reload` (~1460), `inserirTexto` (~2959), `atualizarSugestoes`/`posicaoDoCursor`/`inserirSugestao` (~2658–2720), `abrirNoFim` (~2568) e seu uso no cartão "continuar" e no `paste` global (~2800), `rolarParaTitulo` (~945), handler de menu do corpo (~2930)
- Modify: `idiomas/en.js` (frases novas)

**Interfaces:**
- Consumes: `KiroEditor.carregar`, `KiroEditor.montar` e o objeto que ele devolve (Task 3); `menuDaNota()`, `abrirMenuContexto`, `podeCorrigir`, `esperarCorretor` (existentes); `Kiro.linkQuery`, `Kiro.linkSuggestions`, `Kiro.findLinkedNote` (domain.js).
- Produces: `let editorDaNota = null; // { chave, editor }` no `app.js`; `chaveDaNota(nota) = nota.id || 'rascunho'`.

- [ ] **Step 1: Montar o editor no lugar do corpo desenhado**

`renderEditor`: troque `<div class="doc-corpo" id="doc-corpo" data-vazio="…">${renderizarMarkdown(nota.body)}</div>` por `<div class="doc-corpo" id="doc-corpo"></div>`.

Perto de `bindEditor`:

```js
// O corpo da nota é um editor CodeMirror (editor-nota.js). A instância vive enquanto a mesma nota
// está aberta: um redesenho (salvar, releitura) recoloca o mesmo editor no lugar novo, com cursor,
// rolagem e desfazer intactos.
let editorDaNota = null; // { chave, editor }
const chaveDaNota = nota => nota.id || 'rascunho';
function opcoesDoEditor() {
  return {
    aoMudar: texto => { if (!editing) return; editing.body = texto; editorDirty = true; estadoDoc(); },
    aoSalvar: () => salvarNota(),
    existe: alvo => Boolean(Kiro.findLinkedNote(state.notes, alvo)),
    aoTeclar: evento => Boolean(sugestao && teclaNaSugestao(evento)),
    aoMoverCursor: () => atualizarSugestoes(editorDaNota?.editor.area()),
    aoColar: evento => {
      const arquivos = imagensDoEvento(evento.clipboardData || evento.dataTransfer);
      if (!arquivos.length) return false;
      evento.preventDefault();
      colarImagens(editorDaNota.editor.area(), arquivos);
      return true;
    },
    aoMenu: evento => {
      if (evento.shiftKey && !window.cadernoDesktop) return;
      const area = editorDaNota.editor.area();
      if (podeCorrigir(evento)) return esperarCorretor(evento, area, menuDaNota());
      abrirMenuContexto(evento, area);
    },
  };
}
async function montarEditorDaNota(corpo) {
  const chave = chaveDaNota(editing);
  if (editorDaNota?.chave === chave) {
    corpo.replaceChildren(editorDaNota.editor.dom);
    editorDaNota.editor.definirTexto(editing.body);
    return editorDaNota.editor;
  }
  editorDaNota?.editor.destruir(); editorDaNota = null;
  try { await KiroEditor.carregar(); }
  catch {
    status(t('Não foi possível carregar o editor'), true);
    const campo = Object.assign(document.createElement('textarea'), { className: 'doc-corpo-simples', value: editing.body });
    campo.addEventListener('input', () => { editing.body = campo.value; editorDirty = true; estadoDoc(); });
    corpo.replaceChildren(campo);
    return null;
  }
  if (!corpo.isConnected || chaveDaNota(editing || {}) !== chave) return null;   // trocou de nota enquanto carregava
  const editor = KiroEditor.montar(corpo, { texto: editing.body, ...opcoesDoEditor() });
  editorDaNota = { chave, editor };
  return editor;
}
```

Em `bindEditor`: troque `bindCorpo(corpo);` por `montarEditorDaNota(corpo);`. No `onkeydown` do título, troque `primeiro?abrirBloco(primeiro,0):abrirNoFim();` (e a linha `const primeiro=…`) por `editorDaNota?.editor.focar('inicio');`. No `onchange` de `#doc-template`, troque `corpo.innerHTML=renderizarMarkdown(editing.body);` por `editorDaNota?.editor.definirTexto(editing.body);` (e remova `blocoAberto=null;` dali). O trecho final de `bindEditor` que abre o campo para escrever em nota existente sem texto (`// Nota nova começa pelo título; …`) passa a chamar `editorDaNota?.editor.focar('fim')` em vez do editor de blocos — leia o trecho e mantenha a mesma condição.

Quando a nota fecha ou outra abre, a instância antiga é destruída pelo próprio `montarEditorDaNota` (chave diferente). Ao sair da tela do cofre (nenhum `#doc-corpo` no `render()`), destrua: no fim de `render()`, `if (editorDaNota && !document.querySelector('#doc-corpo')) { editorDaNota.editor.destruir(); editorDaNota = null; }`.

- [ ] **Step 2: Redesenhar sem perder o foco; salvar; releitura**

Em `render()`, logo no início: `const focoNoEditor = Boolean(editorDaNota?.editor.temFoco());` e no fim (depois de `bindView(); updateCount();`): `if (focoNoEditor && editorDaNota && document.querySelector('#doc-corpo')?.contains(editorDaNota.editor.dom)) editorDaNota.editor.focar();`.

Em `salvarNota`: a linha `const retomar=blocoAberto&&…` e o `if(retomar&&editing)retomarBloco(retomar);` saem (o `render()` já devolve o foco). Mantenha o resto.

Em `reload`: acrescente às condições do primeiro `if` (as que fazem a releitura automática pular) `||editorDaNota?.editor.temFoco()` — com o editor focado, a releitura automática não roda (não deixa a interface inerte, não tira o foco). A releitura manual continua igual.

- [ ] **Step 3: Menus, inserção de texto, sugestões de `[[`, sumário, colar**

`inserirTexto(area, texto)` (~2959) — primeira linha da função:

```js
  if (area.inserir) { area.focus(); area.inserir(texto); return; }
```

`posicaoDoCursor(campo)` — primeira linha: `if (campo.posicao) { const p = campo.posicao(); if (p) return p; }`.

`atualizarSugestoes(campo)` — primeira linha: `if (!campo) return fecharSugestoes();`. O resto já usa só `value`, `selectionStart`, `selectionEnd` e `posicaoDoCursor`. `inserirSugestao` já usa `setSelectionRange` + `inserirTexto` — funciona com a área.

`abrirNoFim()` — no início:

```js
  if (editorDaNota && $('#doc-corpo')?.contains(editorDaNota.editor.dom)) { editorDaNota.editor.focar('fim'); return editorDaNota.editor.area(); }
```

(o cartão "continuar" e o `paste` global passam a cair aqui.) No `paste` global (~2800), troque a condição `if (!editing || blocoAberto || …` por `if (!editing || editorDaNota?.editor.temFoco() || …` (dentro do editor, o colar é tratado por `aoColar`).

`rolarParaTitulo(pos)` (~945):

```js
function rolarParaTitulo(pos) {
  if (editorDaNota && $('#doc-corpo')?.contains(editorDaNota.editor.dom)) return editorDaNota.editor.rolarPara(pos);
  document.querySelector(`#doc-corpo [data-pos="${pos}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
```

O handler de `contextmenu` do corpo antigo (em `bindCorpo`) não é mais ligado (o corpo não chama `bindCorpo`); o menu vem de `aoMenu`. `menuDaNota()` usa `blocoAberto?.campo` para achar wikilink no cursor (`wikilinkNoCursor(blocoAberto?.campo)`): troque por `wikilinkNoCursor(editorDaNota?.editor.area() ?? blocoAberto?.campo)` — `wikilinkNoCursor` precisa só de `value`/`selectionStart` (confira).

- [ ] **Step 4: Frases e testes**

`idiomas/en.js`, seção `// app.js — editor`: `'Não foi possível carregar o editor': 'Could not load the editor'` (se o teste de cobertura disser que alguma frase sobrou porque o corpo antigo deixou de usá-la — ex.: o `data-vazio` de `renderEditor` — remova-a do `en.js`).

Run: `npm test` — nenhum `fail`. Testes antigos que inspecionam o editor de blocos no `app.js` por texto (`grep -rn "bloco-editor\|abrirBloco\|data-vazio" tests/`) devem continuar passando, porque o código do editor de blocos fica até a etapa 3; se algum testar `renderEditor` com `renderizarMarkdown(nota.body)`, ajuste o **teste** para a forma nova e diga no relatório qual e por quê.

- [ ] **Step 5: Verificação no navegador**

`npm run dev` + navegador automatizado (`node "~/.claude/skills/browser-automation/browser.mjs" http://127.0.0.1:4180/ --script <arquivo>`; globais do app com `page.evaluate(fn, null, undefined, false)`; scripts no rascunho de quem coordena: `%USERPROFILE%\AppData\Local\Temp\claude\C--Projetos-Meu-segundo-cerebro\84cf50e9-e103-4c8d-a0c6-8d906973ae4b\scratchpad`):
- abrir a nota "Bem-vindo ao modo de desenvolvimento": `#doc-corpo .cm-content` existe, `contenteditable="true"`; títulos com `.ed-h1/.ed-h2`; `**` escondidos fora do cursor;
- digitar no editor (`page.keyboard.type`) muda `editing.body` e marca a nota como alterada; Ctrl+S salva; depois de salvar o cursor continua no mesmo lugar (`editorDaNota.editor.area().selectionStart` igual antes/depois) e o foco no editor;
- digitar `[[Pla` abre a lista de sugestões; Enter completa `[[Plano de estudos]]`;
- botão direito no corpo abre o menu da nota (Adicionar link, Formatar…); "Negrito" com texto selecionado envolve com `**`;
- 10 s parado com o foco no editor: foco e cursor continuam;
- sumário do painel da direita (se houver): clicar num título rola o editor.
Pare o servidor ao terminar.

- [ ] **Step 6: Commit**

```bash
git add app.js idiomas/en.js tests
git commit   # "Editor: corpo da nota no editor novo, com menus, sugestões e salvamento"
```

---

### Task 5: Verificação final da etapa 1 (feita por quem coordena)

**Files:** nenhum (só o plano, em "Medições").

- [ ] **Step 1:** `npm test` — nenhum `fail`.
- [ ] **Step 2: Medição** — repetir a Task 0 com o editor novo; critérios da spec: abrir a nota mais longa ≤ 1,5× a referência; < 16 ms por tecla; Hoje e Notas sem piora. Anotar em "Medições".
- [ ] **Step 3: App desktop automatizado** (Electron do repositório, `--dev-vault`, perfil separado `--user-data-dir=<rascunho>/perfil-diag`, driver patchright `_electron`):
  - nota nova salva com `casa ovario`; abrir, focar, esperar 2 s; botão direito sobre "ovario": `context-menu` no processo principal com `misspelledWord: 'ovario'` e "ovário" nas sugestões; menu do Kiro com a sugestão no topo; escolher troca a palavra; Ctrl+Z desfaz;
  - Ctrl+S com o cursor no meio: cursor e foco ficam; Ctrl+Z depois de salvar desfaz a última edição;
  - 10 s com o foco no editor, sem editar: foco e cursor ficam;
  - nota com `\r\n` (gravar no `dev-vault` um `.md` com `\r\n` antes de abrir o app): abrir, não editar, Ctrl+S — o arquivo continua byte a byte igual (comparar o hash antes e depois).
- [ ] **Step 4:** Revisão final do branch (etapa 1) por um revisor no modelo mais capaz, com os itens adiados do registro.

## Medições

| Rodada | Hoje (ms) | Notas (ms) | Abrir nota longa (ms) | Por tecla (ms) |
|---|---|---|---|---|
| Referência (Task 0) | | | | |
| Editor novo (Task 5) | | | | |
