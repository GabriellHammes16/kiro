# Editor com visualização ao vivo — etapa 2 — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desenhar no editor (CodeMirror), fora da linha do cursor, os elementos que a leitura do Kiro já desenha: tarefa clicável, imagem com alça, fórmulas KaTeX, cabeçalho do bloco de código com Copiar, callout, comentário, e o clique que abre link/nota/etiqueta.

**Architecture:** Um módulo novo `editor-widgets.js` (`KiroWidgets`, UMD) com uma parte pura — `acharElementos(state, de, ate)` e funções que devolvem a mudança de uma tarefa/largura — testável no Node, e uma parte CodeMirror — widgets, um `StateField` para os blocos e um `ViewPlugin` para os em linha. O editor (`editor-nota.js`) inclui a extensão quando recebe `widgets` nas opções; o app (`app.js`) passa as funções de desenho que já existem (`matematica`, `htmlDaImagem`, …).

**Tech Stack:** JavaScript sem build, CodeMirror 6 (`vendor/codemirror`, global `CM`), KaTeX (`vendor/katex`, já carregado na página), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-editor-ao-vivo-etapa-2-design.md`

## Global Constraints

- Branch `editor-ao-vivo`. Nenhum instalador nesta etapa.
- Fora da linha do cursor (ou das linhas da seleção) o elemento aparece desenhado; na linha do cursor, o Markdown. Blocos (`$$`, cabeçalho do código) aparecem como Markdown quando o cursor está em qualquer linha do bloco.
- Mesmo reconhecimento da leitura: fórmula em linha `\$([^\s$](?:[^$\n]*[^\s$])?)\$` (texto colado aos cifrões); imagem `![[caminho]]` / `![[caminho|300]]` / `|300x200` com `/\.(png|jpe?g|gif|webp|avif|bmp)$/i`; bloco `$$` igual a `renderizarMarkdown` (linha que começa com `$$`; numa linha só se terminar com `$$`; senão até a linha `^\$\$\s*$`); callout `> [!tipo]`; comentário `%%…%%`. Nada é reconhecido dentro de código. Cercas ```` ```kiro:… ```` (plug-in) ficam para a etapa 3 — sem cabeçalho.
- Tarefa e largura de imagem mudam o texto por transação normal do CodeMirror (Ctrl+Z desfaz); nada grava direto em `editing.body`.
- O editor não conhece o app: recebe `widgets: { desenharFormula(tex, bloco), desenharImagem(texto), abrirImagem(caminho, nome), abrirNota(alvo), abrirSite(url), buscarEtiqueta(texto), copiar(texto), t }`.
- Clique simples (botão esquerdo, sem modificador) no texto desenhado de `[[link]]`/`[texto](url)`/`#etiqueta` fora da linha do cursor abre/busca; na linha do cursor só posiciona o cursor.
- Desempenho: nota longa (67,6 KB) quente ≤ 1,5× a referência (~7 ms); < 16 ms por tecla; Hoje/Notas sem piora.
- Frases visíveis por `t()` e em `idiomas/en.js` (`editor-widgets.js` entra em `FONTES` do teste de cobertura). `t` é variável local em vários escopos do `app.js` — renomeie o local se puser `t(` num deles.
- Código e comentários em português. Commits `Editor: …` com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca encerrar processos node.exe que você não abriu. `npm test` passa ao fim de cada task.

## Review Focus

- `R$ 5 e R$ 10` não vira fórmula; `$x$` dentro de `` `código` `` não vira fórmula. Teste na Task 1.
- Imagem com caminho que tem `|` no nome (`a|b.png|300`) e largura `300x200` → caminho e largura certos. Teste na Task 1.
- Tarefa marcada com `X` maiúsculo é feita; desmarcar devolve espaço. Teste na Task 1.
- Bloco `$$` sem fechamento até o fim da nota — não quebra (vai até o fim, como a leitura). Teste na Task 1.
- Clicar na caixa de uma tarefa não move o cursor nem abre a linha; Ctrl+Z desfaz a marcação. Verificação na Task 2 e na Task 4.

---

### Task 0: Referência (quem coordena)

- [ ] Medir no navegador (`<scratchpad>/medir-cm.mjs`): nota longa quente, por tecla. Anotar no registro.

---

### Task 1: Reconhecimento puro dos elementos

**Files:**
- Create: `editor-widgets.js` (parte pura)
- Test: `tests/editor-widgets.test.cjs`

**Interfaces:**
- Consumes: `CM` (vendor; no Node `require('../vendor/codemirror/codemirror.js')`), lido na hora de usar, nunca no carregamento.
- Produces (`KiroWidgets`):
  - `acharElementos(state, de, ate, { arvore } = {})` → array ordenado por `de` de:
    - `{ tipo: 'tarefa', de, ate, feito: boolean }` — `de/ate` cobrem `[ ]`/`[x]` (nó `TaskMarker`);
    - `{ tipo: 'imagem', de, ate, caminho, largura: number|null }` — o `![[…]]` inteiro;
    - `{ tipo: 'formula', de, ate, tex }` — `$…$` inteiro, `tex` sem os cifrões;
    - `{ tipo: 'formulaBloco', de, ate, tex }` — das linhas do bloco `$$` (do início da primeira linha ao fim da última);
    - `{ tipo: 'cabecalhoCodigo', de, ate, linguagem, codigo, blocoDe, blocoAte }` — `de/ate` = a linha da cerca de abertura; `blocoDe/blocoAte` = o bloco inteiro; `linguagem` = texto após ```` ``` ```` aparado (vazio se nenhum);
    - `{ tipo: 'callout', de, ate, nome, linhas: number[] }` — `de/ate` = o `[!tipo]` na primeira linha; `linhas` = início de cada linha do callout;
    - `{ tipo: 'comentario', de, ate }` — `%%…%%` inteiro.
  - `trocaDaTarefa(state, elemento)` → `{ from, to, insert }` que troca o caractere de dentro (`' '` ↔ `'x'`).
  - `trocaDaLargura(elemento, largura)` → `{ from, to, insert }` com `![[caminho|largura]]`.
  - `ehImagem(caminho)` → boolean (`root.Kiro?.isImagePath` se existir, senão `/\.(png|jpe?g|gif|webp|avif|bmp)$/i`).

- [ ] **Step 1: Teste**

```js
// tests/editor-widgets.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.CM = require('../vendor/codemirror/codemirror.js');
const W = require('../editor-widgets.js');

const estado = (texto, separador) => CM.state.EditorState.create({ doc: texto, extensions: [CM.markdown.markdown({ base: CM.markdown.markdownLanguage }), ...(separador ? [CM.state.EditorState.lineSeparator.of(separador)] : [])] });
const achar = (texto, sep) => { const s = estado(texto, sep); const arvore = CM.language.ensureSyntaxTree(s, s.doc.length, 5000); return { s, els: W.acharElementos(s, 0, s.doc.length, { arvore }) }; };
const fatia = (s, e) => s.sliceDoc(e.de, e.ate);

test('tarefas: [ ], [x] e [X] com -, *, + e 1.', () => {
  const { s, els } = achar('- [ ] a\n* [x] b\n+ [X] c\n1. [ ] d\n- não é [ ] tarefa');
  const t = els.filter(e => e.tipo === 'tarefa');
  assert.deepEqual(t.map(e => [fatia(s, e), e.feito]), [['[ ]', false], ['[x]', true], ['[X]', true], ['[ ]', false]]);
});

test('trocaDaTarefa troca só o caractere de dentro', () => {
  const { s, els } = achar('- [ ] a\n- [X] b');
  const [aberta, feita] = els.filter(e => e.tipo === 'tarefa');
  assert.deepEqual(W.trocaDaTarefa(s, aberta), { from: aberta.de + 1, to: aberta.de + 2, insert: 'x' });
  assert.deepEqual(W.trocaDaTarefa(s, feita), { from: feita.de + 1, to: feita.de + 2, insert: ' ' });
});

test('imagens: com e sem largura, 300x200, | no caminho; não é imagem sem extensão', () => {
  const { s, els } = achar('![[foto.png]] e ![[pasta/a|b.png|300]] e ![[x.jpg|300x200]] e ![[nota]]');
  const i = els.filter(e => e.tipo === 'imagem');
  assert.deepEqual(i.map(e => [e.caminho, e.largura]), [['foto.png', null], ['pasta/a|b.png', 300], ['x.jpg', 300]]);
  assert.equal(fatia(s, i[1]), '![[pasta/a|b.png|300]]');
  assert.deepEqual(W.trocaDaLargura(i[0], 420), { from: i[0].de, to: i[0].ate, insert: '![[foto.png|420]]' });
});

test('fórmula em linha: cifrões colados; R$ 5 e R$ 10 não; nada dentro de código', () => {
  const { els } = achar('área $x^2$ e R$ 5 e R$ 10 e `$y$`');
  assert.deepEqual(els.filter(e => e.tipo === 'formula').map(e => e.tex), ['x^2']);
});

test('fórmula em bloco: várias linhas, uma linha só, e sem fechamento', () => {
  const um = achar('a\n\n$$\nx = 1\ny = 2\n$$\n\nb');
  const b = um.els.find(e => e.tipo === 'formulaBloco');
  assert.equal(b.tex, 'x = 1\ny = 2');
  assert.equal(fatia(um.s, b), '$$\nx = 1\ny = 2\n$$');
  assert.equal(achar('$$a+b$$').els.find(e => e.tipo === 'formulaBloco').tex, 'a+b');
  const aberto = achar('$$\nz\nfim');
  assert.equal(aberto.els.find(e => e.tipo === 'formulaBloco').tex, 'z\nfim');
});

test('cabeçalho do código: linguagem, código, sem cabeçalho para kiro:', () => {
  const { s, els } = achar('```js\nlet a = 1\n```\n\n```\nx\n```\n\n```kiro:quadro\n{}\n```');
  const c = els.filter(e => e.tipo === 'cabecalhoCodigo');
  assert.deepEqual(c.map(e => [e.linguagem, e.codigo]), [['js', 'let a = 1'], ['', 'x']]);
  assert.equal(fatia(s, c[0]), '```js');
});

test('callout e comentário', () => {
  const { s, els } = achar('> [!nota] Título\n> corpo\n\ntexto %%escondido%% fim');
  const c = els.find(e => e.tipo === 'callout');
  assert.equal(c.nome, 'nota'); assert.equal(fatia(s, c), '[!nota]'); assert.equal(c.linhas.length, 2);
  assert.equal(fatia(s, els.find(e => e.tipo === 'comentario')), '%%escondido%%');
});

test('posições corretas com \\r\\n', () => {
  const { s, els } = achar('a\r\n- [ ] b\r\n$x$', '\r\n');
  assert.equal(fatia(s, els.find(e => e.tipo === 'tarefa')), '[ ]');
  assert.equal(els.find(e => e.tipo === 'formula').tex, 'x');
});
```

Run: `node --test tests/editor-widgets.test.cjs` — Expected: FAIL (`Cannot find module '../editor-widgets.js'`).

- [ ] **Step 2: Implementar a parte pura**

```js
// Elementos desenhados no editor (etapa 2 da visualização ao vivo): tarefa, imagem, fórmulas,
// cabeçalho do bloco de código, callout e comentário. Esta primeira metade é pura — acha os
// elementos no texto, com a mesma regra da leitura (renderizarMarkdown) — e roda no Node.
(function (root) {
  const CM = () => root.CM;
  const IMAGEM = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
  const ehImagem = caminho => (root.Kiro?.isImagePath ? root.Kiro.isImagePath(caminho) : IMAGEM.test(String(caminho).trim()));
  // Igual a lerImagem do app: a última parte depois de | pode ser a largura (300 ou 300x200).
  function lerImagem(dentro) {
    const partes = dentro.split('|');
    const medida = partes.length > 1 && /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(partes[partes.length - 1]);
    const caminho = (medida ? partes.slice(0, -1) : partes).join('|').trim();
    return ehImagem(caminho) ? { caminho, largura: medida ? Number(medida[1]) : null } : null;
  }
  const FORMULA = /\$([^\s$](?:[^$\n]*[^\s$])?)\$/g;
  const IMAGEM_NA_LINHA = /!\[\[([^\][\n]+)\]\]/g;
  const COMENTARIO = /%%([^\n%]+)%%/g;

  function acharElementos(state, de, ate, { arvore } = {}) {
    const doc = state.doc, els = [], codigo = [];
    const tree = arvore || CM().language.syntaxTree(state);
    tree.iterate({
      from: de, to: ate,
      enter: no => {
        if (no.name === 'TaskMarker') {
          const marca = state.sliceDoc(no.from, no.to);
          els.push({ tipo: 'tarefa', de: no.from, ate: no.to, feito: /x/i.test(marca[1] || '') });
        }
        if (no.name === 'InlineCode') codigo.push([no.from, no.to]);
        if (no.name === 'FencedCode') {
          codigo.push([no.from, no.to]);
          const primeira = doc.lineAt(no.from), ultima = doc.lineAt(no.to);
          const info = primeira.text.replace(/^\s*(```|~~~)/, '').trim();
          if (!/^kiro:/.test(info)) {
            const fechada = ultima.number > primeira.number && /^\s*(```|~~~)\s*$/.test(ultima.text);
            const corpoAte = fechada ? doc.line(ultima.number - 1).to : no.to;
            const corpoDe = Math.min(primeira.to + 1, doc.length);
            els.push({ tipo: 'cabecalhoCodigo', de: primeira.from, ate: primeira.to, linguagem: info, codigo: corpoDe <= corpoAte ? doc.sliceString(corpoDe, corpoAte) : '', blocoDe: no.from, blocoAte: no.to });
          }
          return false;
        }
        if (no.name === 'Blockquote') {
          const primeira = doc.lineAt(no.from);
          const m = /^>\s?\[!(\w+)\]/.exec(primeira.text);
          if (m) {
            const inicio = primeira.from + primeira.text.indexOf('[!');
            const linhas = [];
            for (let p = no.from; p <= no.to;) { const l = doc.lineAt(p); linhas.push(l.from); p = l.to + 1; }
            els.push({ tipo: 'callout', de: inicio, ate: inicio + m[1].length + 3, nome: m[1], linhas });
          }
        }
      },
    });
    const emCodigo = (a, b) => codigo.some(([x, y]) => a < y && b > x);
    // Blocos $$ (a árvore do Markdown não os conhece): mesma regra de renderizarMarkdown.
    const blocos = [];
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(ate).number; n++) {
      const l = doc.line(n);
      const m = /^\$\$(.*)$/.exec(l.text);
      if (!m || emCodigo(l.from, l.to)) continue;
      const numaLinha = m[1].trim();
      let fim = n, tex;
      if (numaLinha.endsWith('$$') && numaLinha.length > 2) tex = numaLinha.slice(0, -2);
      else {
        const corpo = [];
        let k = n + 1;
        while (k <= doc.lines && !/^\$\$\s*$/.test(doc.line(k).text)) corpo.push(doc.line(k++).text);
        fim = Math.min(k, doc.lines);
        tex = corpo.join('\n');
      }
      blocos.push([l.from, doc.line(fim).to]);
      els.push({ tipo: 'formulaBloco', de: l.from, ate: doc.line(fim).to, tex: tex.trim() });
      n = fim;
    }
    const foraDeTudo = (a, b) => !emCodigo(a, b) && !blocos.some(([x, y]) => a < y && b > x);
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(ate).number; n++) {
      const l = doc.line(n);
      for (const m of l.text.matchAll(IMAGEM_NA_LINHA)) {
        const a = l.from + m.index, b = a + m[0].length;
        const img = lerImagem(m[1]);
        if (img && foraDeTudo(a, b)) els.push({ tipo: 'imagem', de: a, ate: b, ...img });
      }
      // Fórmulas: mascara as imagens e o código da linha para não achar $ dentro deles.
      for (const m of l.text.matchAll(FORMULA)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b) && !els.some(e => e.tipo === 'imagem' && a < e.ate && b > e.de)) els.push({ tipo: 'formula', de: a, ate: b, tex: m[1] });
      }
      for (const m of l.text.matchAll(COMENTARIO)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b)) els.push({ tipo: 'comentario', de: a, ate: b });
      }
    }
    return els.sort((x, y) => x.de - y.de);
  }

  const trocaDaTarefa = (state, el) => ({ from: el.de + 1, to: el.de + 2, insert: el.feito ? ' ' : 'x' });
  const trocaDaLargura = (el, largura) => ({ from: el.de, to: el.ate, insert: `![[${el.caminho}|${largura}]]` });

  const api = { acharElementos, trocaDaTarefa, trocaDaLargura, ehImagem, lerImagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroWidgets = api;
})(globalThis);
```

Run: `node --test tests/editor-widgets.test.cjs`. Se um teste falhar por diferença de nome de nó da árvore (ex.: `TaskMarker`), imprima a árvore daquela entrada e corrija **o código** (o teste descreve a regra da leitura). Expected: PASS.

- [ ] **Step 3:** `tests/idiomas-cobertura.test.cjs` → `FONTES`: acrescente `'editor-widgets.js'`. `npm test` — nenhum `fail`. Commit: `Editor: reconhecimento dos elementos desenhados (tarefa, imagem, fórmulas, código, callout, comentário)`.

---

### Task 2: Widgets no editor

**Files:**
- Modify: `editor-widgets.js` (parte CodeMirror), `editor-nota.js` (opção `widgets`), `styles.css`, `index.html` (`<script src="editor-widgets.js">` antes de `editor-nota.js`), `server.mjs` (`/editor-widgets.js` em `publicFiles`)

**Interfaces:**
- Consumes: Task 1 (`acharElementos`, `trocaDaTarefa`, `trocaDaLargura`); `linhasDaSelecao(state)` de `editor-nota.js` (ou a mesma lógica — todas as linhas tocadas pela seleção).
- Produces:
  - `KiroWidgets.extensao(opcoes)` → array de extensões do CodeMirror; `opcoes` = `{ desenharFormula(tex, bloco) → html, desenharImagem(texto) → html | null, abrirImagem(caminho, nome), abrirNota(alvo), abrirSite(url), buscarEtiqueta(texto), copiar(texto) → Promise<boolean>, t }`.
  - `KiroEditor.montar(…, { …, widgets })` inclui `KiroWidgets.extensao(widgets)` quando `widgets` existe.

- [ ] **Step 1: Desenho (implementar em `editor-widgets.js`, antes de `const api`)**

Regras (todas com o cursor fora da linha do elemento — use as linhas da seleção; para blocos, fora de todas as linhas do bloco):
- **Em linha (um `ViewPlugin` sobre `view.visibleRanges`, recalculado em `docChanged`/`selectionSet`/`viewportChanged`/mudança da árvore):**
  - `tarefa`: `Decoration.replace({ widget: new CaixaDeTarefa(feito, de) })` sobre `[ ]`/`[x]`. `toDOM`: `<input type="checkbox" class="ed-caixa">` com `checked`; `mousedown` → `preventDefault()` (não move o cursor) e despacha `trocaDaTarefa` com `userEvent: 'input'`. `ignoreEvent() { return false }` só para o próprio input. A linha do item feito ganha `Decoration.line({ class: 'md-tarefa feito' })` (use a classe que a leitura usa para item feito — confira em `styles.css`).
  - `imagem`: `Decoration.replace({ widget: new Imagem(el) })`. `toDOM`: um `span` com `innerHTML = opcoes.desenharImagem(textoDoElemento)` (o HTML da leitura, com `.md-imagem img` e `.md-alca`). Clique na `img` → `opcoes.abrirImagem(caminho, nome)`. `pointerdown` na `.md-alca` → arrastar muda a largura visual da `img` (limite: largura do `.cm-content`, mínimo 48 px, como `redimensionarImagem`) e, ao soltar, despacha `trocaDaLargura(el, largura)`. `eq()` compara `caminho`+`largura`.
  - `formula`: `Decoration.replace({ widget: new Formula(tex, false) })`; `toDOM` com `innerHTML = opcoes.desenharFormula(tex, false)`; resultado guardado num `Map` por `tex` (limpar se passar de 500 entradas).
  - `comentario`: `Decoration.mark({ class: 'md-comentario' })` no conteúdo e `Decoration.replace({})` nos `%%`.
  - `callout`: `Decoration.line({ class: 'ed-citacao md-destaque' })` em cada linha e `Decoration.replace({ widget: new RotuloDoCallout(nome) })` sobre `[!tipo]` (`<span class="md-destaque-tipo">`).
- **Blocos (um `StateField<DecorationSet>`, recalculado em `docChanged` e `selection` — os blocos são poucos, recalcule o documento inteiro, `acharElementos(state, 0, doc.length)` só com os tipos de bloco; guarde o último resultado e reaproveite se `docChanged` for falso e o conjunto de linhas do cursor não tocar nenhum bloco):**
  - `formulaBloco`: `Decoration.replace({ widget: new Formula(tex, true), block: true })` de `de` a `ate`.
  - `cabecalhoCodigo`: `Decoration.replace({ widget: new CabecalhoDoCodigo(linguagem, codigo), block: true })` sobre a linha da cerca de abertura. `toDOM`: `<div class="code-area-cabecalho"><span class="code-lang">${linguagem || t('texto')}</span><button type="button" class="secondary code-copy">${t('Copiar')}</button></div>`; clique no botão → `opcoes.copiar(codigo)`; se `true`, o botão mostra `t('Copiado')` por 1,4 s; se `false`, `opcoes.copiar` já avisou.
- **Cliques em links (`EditorView.domEventHandlers({ mousedown })`):** botão esquerdo, sem `ctrlKey/metaKey/shiftKey/altKey`; se o alvo está dentro de `.ed-wikilink`/`.ed-wikilink-ausente` → `preventDefault()` e `opcoes.abrirNota(alvo)` (alvo = o texto do `[[…]]` antes de `|` e de `#`, achado pela posição `view.posAtDOM(alvo)` e `marcacoesDoKiro`/regex na linha); `.ed-link` → `opcoes.abrirSite(url)` (url do nó `Link` da árvore); `.ed-etiqueta` → `opcoes.buscarEtiqueta(texto sem #)`. Só quando a linha do alvo **não** é linha do cursor (senão deixa o CodeMirror posicionar o cursor).
- Os widgets não se sobrepõem às marcas da etapa 1/corretor: decorações `replace` vencem; não há problema em ter `mark` por baixo.

`KiroWidgets.extensao(opcoes)` devolve `[campoDosBlocos, pluginEmLinha, cliques]`.

`editor-nota.js` → `montar`: se `opcoes.widgets` existe e `root.KiroWidgets`, inclua `...root.KiroWidgets.extensao({ ...opcoes.widgets, t })` nas extensões.

- [ ] **Step 2: CSS** — em `styles.css`, seção do editor:

```css
.doc-corpo .cm-editor .ed-caixa { margin:0 6px 0 0; accent-color:var(--accent); vertical-align:middle; cursor:pointer; }
.doc-corpo .cm-editor .md-imagem { display:inline-block; max-width:100%; }
.doc-corpo .cm-editor .md-imagem img { max-width:100%; }
.doc-corpo .cm-editor .math-bloco, .doc-corpo .cm-editor .code-area-cabecalho { display:block; }
.doc-corpo .cm-editor .code-area-cabecalho { display:flex; justify-content:space-between; align-items:center; }
```

Complete com as regras da leitura que esses elementos precisam (copie de `.doc-corpo .md-imagem`, `.md-alca`, `.math-bloco`, `.code-area figcaption`, `.md-destaque-tipo`, `.md-comentario` em `styles.css`), restritas a `.doc-corpo .cm-editor`, para ficarem com a mesma cara.

- [ ] **Step 3: Verificação no navegador** (servidor de desenvolvimento em http://127.0.0.1:4180 se no ar; helper `node "~/.claude/skills/browser-automation/browser.mjs" http://127.0.0.1:4180/ --timeout 60000 --script <arquivo.mjs>`; globais com `page.evaluate(fn, null, undefined, false)`): montar um editor numa `div` com `widgets` de teste (desenharFormula devolvendo `<span class="t-formula">…</span>`, desenharImagem devolvendo o HTML de `htmlDaImagem` do app, os outros registrando chamadas) e o texto `'- [ ] tarefa\n\n![[x.png|200]]\n\n$a^2$ e %%c%%\n\n$$\nb\n$$\n\n```js\nlet a\n```\n\n> [!nota] t\n> c\n\n[[Nota]] e [s](https://x.com) e #tag'` com o cursor no fim:
  - existem `.ed-caixa`, `.md-imagem`, `.t-formula` (2), `.code-area-cabecalho`, `.md-destaque-tipo`, `.md-comentario`;
  - `mousedown` na `.ed-caixa` → o texto vira `- [x] tarefa` e a seleção não mudou; `undo` volta;
  - clique no texto de `[[Nota]]`, do link e da `#tag` → as funções de teste foram chamadas com `Nota`, `https://x.com`, `tag`;
  - pôr o cursor na linha da tarefa → a `.ed-caixa` some e aparece `[ ]`.
  Scripts no rascunho de quem coordena. `npm test` — nenhum `fail`. Commit: `Editor: tarefas, imagens, fórmulas, código, callouts e cliques desenhados no editor`.

---

### Task 3: O app liga os widgets

**Files:**
- Modify: `app.js` (`opcoesDoEditor`), `idiomas/en.js` se surgir frase nova

**Interfaces:**
- Consumes: `KiroWidgets.extensao` via `montar(…, { widgets })` (Task 2); funções existentes do `app.js`: `matematica(tex, bloco)`, `lerImagem(dentro)`, `htmlDaImagem(imagem)`, `abrirImagemInteira(fonte, nome)`, `urlDoAnexo(caminho)`, `seguirWikilink`/`abrirNota`, `notaVazia`, `Kiro.findLinkedNote`, `buscarEtiqueta(texto)`, `copiarTexto(texto)`, `status`, `t`.

- [ ] **Step 1:** em `opcoesDoEditor()`:

```js
    widgets: {
      desenharFormula: (tex, bloco) => matematica(tex, bloco),
      desenharImagem: texto => { const img = lerImagem(texto); return img ? htmlDaImagem(img) : null; },
      abrirImagem: (caminho, nome) => abrirImagemInteira(urlDoAnexo(caminho), nome),
      abrirNota: alvo => abrirNota(Kiro.findLinkedNote(state.notes, alvo) || notaVazia({ title: alvo })),
      abrirSite: url => { const limpa = Kiro.safeUrl(url); if (limpa) window.open(limpa, '_blank', 'noopener,noreferrer'); },
      buscarEtiqueta: texto => buscarEtiqueta(texto),
      copiar: async texto => { const ok = await copiarTexto(texto); if (!ok) status(t('O navegador não liberou a área de transferência.'), true); return ok; },
    },
```

(confira as assinaturas reais: `abrirImagemInteira` recebe a URL ou o caminho? — veja como `bindCorpo` a chama hoje e passe o mesmo; `desenharImagem` recebe o **conteúdo de dentro** de `![[…]]` — ajuste com a Task 2 para que ela passe esse conteúdo).

- [ ] **Step 2: Verificação no navegador** com a nota de teste do `dev-vault` (crie `dev-vault/teste-dos-widgets.md` com todos os elementos do Step 3 da Task 2 e uma imagem que exista em `dev-vault` — procure uma em `dev-vault/anexos/`): abrir a nota sem digitar → fórmulas KaTeX (`.katex`), imagem carregada (`img.naturalWidth > 0`), caixa de tarefa, cabeçalho com Copiar; clicar na caixa marca e Ctrl+Z desfaz; arrastar a alça grava `|largura` no texto; clicar no `[[link]]` de uma nota existente abre essa nota; clicar na `#etiqueta` vai para Notas com a busca preenchida; Copiar copia (leia `navigator.clipboard` se permitido, senão confira o texto do botão `Copiado`). `npm test`. Commit: `Editor: o app desenha fórmulas, imagens e abre links no editor novo`.

---

### Task 4: Verificação final (quem coordena)

- [ ] `npm test`; medição (nota longa quente ≤ 1,5× da Task 0; por tecla < 16 ms; Hoje/Notas); app desktop automatizado (perfil separado, `--dev-vault`) com `teste-dos-widgets` — os itens da Task 3 Step 2 no Electron; revisão final do branch (etapa 2) no modelo mais capaz.
