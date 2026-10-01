# Corretor ortográfico próprio — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sublinhar todas as palavras erradas do corpo da nota assim que ela abre (pt-BR + en-US), com sugestões e "Adicionar ao dicionário" no botão direito, como no Obsidian.

**Architecture:** Hunspell real em WebAssembly (`hunspell-asm`, MIT) empacotado em `vendor/hunspell/`, dicionários como scripts em `vendor/dicionarios/<código>.js`, um módulo `ortografia.js` (`KiroOrtografia`) com motor injetável (no navegador, o vendor; nos testes, o pacote do `node_modules`), um plug-in do CodeMirror no `editor-nota.js` que marca as palavras erradas da parte visível, e o menu do botão direito do `app.js` usando as sugestões. Dicionário pessoal em `.kiro/dicionario.txt` no cofre.

**Tech Stack:** JavaScript sem build no app, `hunspell-asm` 4.x, `dictionary-pt` 4.x (pt-BR, MPL-2.0), `dictionary-en` 4.x (MIT/BSD), CodeMirror 6 (já em `vendor/codemirror`), esbuild (devDependency), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-corretor-proprio-design.md`

## Global Constraints

- Branch `editor-ao-vivo`. Nenhum instalador nesta etapa.
- Idiomas: lista `['pt-BR', 'en-US']`; palavra certa se certa em qualquer um. Acrescentar idioma = gerar `vendor/dicionarios/<código>.js` + incluir o código na lista; motor e editor não mudam.
- Dicionário pessoal: `.kiro/dicionario.txt` no cofre, uma palavra por linha, sem repetidas.
- O app continua sem etapa de build: vendor gerado por `npm run vendor:ortografia` e commitado; `esbuild`, `hunspell-asm`, `dictionary-pt`, `dictionary-en` só em `devDependencies`.
- Bundle do `hunspell-asm` para o navegador: esbuild com `mainFields: ['main']` (a variante "browser" do pacote quebra com "k is not a function"); medido num navegador: carga pt+en 158 ms.
- O bundle do navegador não roda no Node ("environment detection error"): os testes usam `require('hunspell-asm')` injetado em `KiroOrtografia`.
- Corpo da nota: `.cm-content` sempre com `spellcheck="false"` (o corretor do Chromium segue nos outros campos).
- Desempenho: abrir a nota longa (67,6 KB) quente sem piora (hoje ~7 ms); digitar < 16 ms por tecla; sublinhado visível em até 1 s depois de abrir a primeira nota; sugestões só no clique.
- Licenças: `vendor/hunspell/LICENSE.txt` (MIT + licenças do Hunspell embutido), `vendor/dicionarios/LICENSE-pt-BR.txt` (MPL-2.0, de `dictionary-pt`), `vendor/dicionarios/LICENSE-en-US.txt`.
- Frases visíveis novas por `t()` e em `idiomas/en.js` (teste de cobertura: `ortografia.js` entra em `FONTES`).
- `t` é variável local em vários escopos do `app.js`: ao pôr `t(...)` num escopo com `t` local, renomeie o local.
- Código e comentários em português. Commits `Ortografia: …` (ou `Editor: …` para o editor) terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca encerrar todos os `node.exe`; pare só o que você abriu.
- `npm test` passa ao fim de cada task.

## Review Focus

- Palavra com maiúscula no início de frase ("Ovario"), toda em maiúsculas ("NUBANK"), com hífen ("guarda-chuva", "bem-vindo") ou apóstrofo ("don't", "d'água") — sugestões mantêm a maiúscula inicial; hífen/apóstrofo internos fazem parte da palavra. Testes na Task 2 e na Task 4.
- Palavra dentro de código, link, `[[alvo]]`, `#etiqueta` — nunca sublinhada. Teste na Task 4.
- Dicionário pessoal com linhas vazias, espaços, `\r\n`, repetidas — lido limpo; adicionar repetida não duplica. Teste na Task 3.
- Trocar de cofre — o dicionário pessoal do cofre novo substitui o anterior. Verificação na Task 5.
- Corretor desligado nas Configurações antes de abrir qualquer nota — nada carregado (nenhum `<script>` de `vendor/hunspell` ou `vendor/dicionarios` na página). Verificação na Task 5.

---

### Task 1: Motor e dicionários empacotados

**Files:**
- Create: `scripts/build-ortografia.mjs`
- Create (gerados): `vendor/hunspell/hunspell.js`, `vendor/hunspell/LICENSE.txt`, `vendor/hunspell/VERSAO.txt`, `vendor/dicionarios/pt-BR.js`, `vendor/dicionarios/en-US.js`, `vendor/dicionarios/LICENSE-pt-BR.txt`, `vendor/dicionarios/LICENSE-en-US.txt`
- Modify: `package.json` (devDependencies + script `vendor:ortografia`), `server.mjs` (servir `vendor/hunspell/hunspell.js` e `vendor/dicionarios/<código>.js`)
- Test: `tests/ortografia-vendor.test.cjs`

**Interfaces:**
- Produces:
  - `vendor/hunspell/hunspell.js`: IIFE com global `HunspellAsm` (`{ loadModule }`), para o navegador.
  - `vendor/dicionarios/<código>.js`: no navegador chama `globalThis.KiroOrtografia.registrar('<código>', { aff, dic })` (strings); no Node, `module.exports = { codigo, aff, dic }`.
  - Rotas web: `/vendor/hunspell/hunspell.js` e `/vendor/dicionarios/<código>.js` com `<código>` casando `/^[a-z]{2}-[A-Z]{2}$/`.

- [ ] **Step 1: Teste**

```js
// tests/ortografia-vendor.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');

test('dicionários empacotados exportam código, aff e dic no Node', () => {
  for (const codigo of ['pt-BR', 'en-US']) {
    const d = require(`../vendor/dicionarios/${codigo}.js`);
    assert.equal(d.codigo, codigo);
    assert.ok(d.aff.startsWith('SET') || d.aff.includes('\nSET') || d.aff.includes('SFX'), `${codigo}: .aff`);
    assert.ok(/^\d+/.test(d.dic), `${codigo}: .dic começa pela contagem de palavras`);
    assert.ok(fs.existsSync(path.join(raiz, 'vendor', 'dicionarios', `LICENSE-${codigo}.txt`)), `${codigo}: licença`);
  }
});

test('o motor empacotado existe, define HunspellAsm e traz as licenças', () => {
  const js = fs.readFileSync(path.join(raiz, 'vendor', 'hunspell', 'hunspell.js'), 'utf8');
  assert.match(js.slice(0, 200), /HunspellAsm/);
  assert.match(fs.readFileSync(path.join(raiz, 'vendor', 'hunspell', 'LICENSE.txt'), 'utf8'), /MIT/);
});

test('o servidor entrega o motor e os dicionários, e só códigos válidos', () => {
  const s = fs.readFileSync(path.join(raiz, 'server.mjs'), 'utf8');
  assert.ok(s.includes('/vendor/hunspell/hunspell.js'));
  assert.ok(s.includes('vendor/dicionarios'));
  assert.ok(s.includes('[a-z]{2}-[A-Z]{2}'));
});
```

Run: `node --test tests/ortografia-vendor.test.cjs` — Expected: FAIL (`Cannot find module '../vendor/dicionarios/pt-BR.js'`).

- [ ] **Step 2: Dependências**

```bash
npm install --save-dev hunspell-asm dictionary-pt dictionary-en
```

`package.json` → `scripts`: `"vendor:ortografia": "node scripts/build-ortografia.mjs"`.

- [ ] **Step 3: Gerador**

```js
// scripts/build-ortografia.mjs — gera vendor/hunspell/ (motor Hunspell em WebAssembly) e
// vendor/dicionarios/<código>.js. Rodar só para atualizar versões ou acrescentar idioma:
// npm run vendor:ortografia. O resultado é commitado (o app não tem etapa de build).
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
```

Run: `npm run vendor:ortografia`. Se o pacote `dictionary-pt` não trouxer o texto da licença num arquivo (só o campo `license`), escreva em `LICENSE-pt-BR.txt` o texto da MPL-2.0 (https://www.mozilla.org/MPL/2.0/) com o aviso de origem (VERO, LibreOffice) do `readme.md` do pacote, e ajuste o gerador para fazer isso sozinho.

- [ ] **Step 4: Rotas no servidor** — em `server.mjs`, junto da rota do CodeMirror (mesmo estilo, nomes e cabeçalhos dela):

```js
    if (rota === '/vendor/hunspell/hunspell.js') { /* lê vendor/hunspell/hunspell.js, text/javascript */ }
    const dicionario = rota.match(/^\/vendor\/dicionarios\/([a-z]{2}-[A-Z]{2})\.js$/);
    if (dicionario) { /* lê vendor/dicionarios/<código>.js, text/javascript; 404 se não existir */ }
```

Escreva os dois blocos completos copiando a forma da rota do CodeMirror ao lado (leitura do arquivo, `send`/cabeçalhos, 404 em erro).

- [ ] **Step 5: Verificação no navegador e commit**

Com `npm run dev`, num script do navegador automatizado: `await addScriptTag('/vendor/hunspell/hunspell.js')`, criar `globalThis.KiroOrtografia = { registrar: (c, d) => (window.__d ??= {})[c] = d }`, carregar `/vendor/dicionarios/pt-BR.js` e `/en-US.js`, montar as duas instâncias (`loadModule` → `mountBuffer(new TextEncoder().encode(aff), 'x.aff')` …) e conferir `ovario` errada, `ovário` certa, `suggest('ovario')[0] === 'ovário'`. Anote no relatório os tamanhos e o tempo de carga.

`npm test` — nenhum `fail`. Commit: `Ortografia: motor Hunspell e dicionários pt-BR e en-US empacotados`.

---

### Task 2: `ortografia.js` (`KiroOrtografia`)

**Files:**
- Create: `ortografia.js`
- Modify: `tests/idiomas-cobertura.test.cjs` (`'ortografia.js'` em `FONTES`), `index.html` (`<script src="ortografia.js">` depois de `editor-nota.js`), `server.mjs` (`/ortografia.js` em `publicFiles`)
- Test: `tests/ortografia.test.cjs`

**Interfaces:**
- Consumes: `vendor/dicionarios/<código>.js` (Task 1).
- Produces (`KiroOrtografia`, UMD como `hoje.js`):
  - `IDIOMAS: string[]` — `['pt-BR', 'en-US']`
  - `registrar(codigo, { aff, dic })`
  - `carregar({ motor?, idiomas? } = {}): Promise<void>` — `motor` é um objeto com `loadModule()` (padrão: `root.HunspellAsm`, carregando `vendor/hunspell/hunspell.js` por `<script>` se faltar); `idiomas` (padrão `IDIOMAS`); no navegador insere `vendor/dicionarios/<código>.js` dos idiomas ainda não registrados. Uma vez só (promessa guardada; falha limpa a promessa). Idioma cujo dicionário falha é pulado; se nenhum carregar, rejeita com `Error('Não foi possível carregar o corretor')`.
  - `pronto(): boolean`
  - `errada(palavra): boolean` — `false` se não carregou, se está no dicionário pessoal, se é número/tem dígito, tem uma letra só, parece endereço/e-mail (`/[@/:.]\w/`), ou se algum idioma aceita; também aceita a forma em minúsculas de palavra com maiúscula inicial e a forma "Título" de palavra toda em maiúsculas.
  - `sugestoes(palavra): string[]` — até 5, de todos os idiomas, sem repetidas, ordenadas pela distância de edição (Levenshtein) até a palavra; se a palavra começa com maiúscula, a sugestão também.
  - `adicionar(palavra)` — passa a valer na hora (todas as instâncias: `addWord`) e entra no conjunto pessoal; limpa o cache.
  - `definirPessoais(palavras: string[])` — substitui o conjunto pessoal (troca de cofre); limpa o cache.
  - `aoMudar(fn)` — avisa quando o carregamento termina ou o dicionário pessoal muda (o editor redesenha).
  - `distancia(a, b): number` — Levenshtein (exportada para teste).

- [ ] **Step 1: Teste**

```js
// tests/ortografia.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const motor = require('hunspell-asm');
const O = require('../ortografia.js');
for (const c of ['pt-BR', 'en-US']) { const d = require(`../vendor/dicionarios/${c}.js`); O.registrar(c, d); }
const pronto = O.carregar({ motor });

test('carrega pt-BR e en-US e responde', async () => {
  await pronto;
  assert.equal(O.pronto(), true);
  for (const p of ['ovario', 'bicicletta', 'nao', 'palavrra', 'wrongg']) assert.equal(O.errada(p), true, p);
  for (const p of ['ovário', 'house', 'estão', 'Casa', 'CASA', 'guarda-chuva', "don't"]) assert.equal(O.errada(p), false, p);
});

test('ignora números, palavras com dígito, uma letra e endereços', async () => {
  await pronto;
  for (const p of ['2026', 'C3PO', 'x', 'site.com', 'a@b.c']) assert.equal(O.errada(p), false, p);
});

test('sugestões: a mais parecida primeiro, mantendo a maiúscula inicial', async () => {
  await pronto;
  assert.equal(O.sugestoes('ovario')[0], 'ovário');
  assert.equal(O.sugestoes('bicicletta')[0], 'bicicleta');
  assert.equal(O.sugestoes('nao')[0], 'não');
  assert.equal(O.sugestoes('Ovario')[0], 'Ovário');
  assert.ok(O.sugestoes('ovario').length <= 5);
  assert.equal(new Set(O.sugestoes('ovario')).size, O.sugestoes('ovario').length, 'sem repetidas');
});

test('dicionário pessoal: adicionar vale na hora; definirPessoais substitui', async () => {
  await pronto;
  assert.equal(O.errada('nubank'), true);
  O.adicionar('nubank');
  assert.equal(O.errada('nubank'), false);
  O.definirPessoais(['Kiro']);
  assert.equal(O.errada('Kiro'), false);
  assert.equal(O.errada('nubank'), true, 'o conjunto anterior saiu');
});

test('aoMudar avisa quando o dicionário pessoal muda', async () => {
  await pronto;
  let n = 0; O.aoMudar(() => { n++; });
  O.adicionar('btgzz');
  assert.ok(n >= 1);
});

test('distância de edição', () => {
  assert.equal(O.distancia('ovario', 'ovário'), 1);
  assert.equal(O.distancia('casa', 'casa'), 0);
});

test('idioma fora da lista não é carregado; idioma novo registrado passa a valer', async () => {
  delete require.cache[require.resolve('../ortografia.js')];
  const O2 = require('../ortografia.js');
  O2.registrar('en-US', require('../vendor/dicionarios/en-US.js'));
  O2.registrar('pt-BR', require('../vendor/dicionarios/pt-BR.js'));
  await O2.carregar({ motor, idiomas: ['en-US'] });
  assert.equal(O2.errada('ovário'), true, 'sem pt-BR, ovário é desconhecida');
  assert.equal(O2.errada('house'), false);
});
```

Run: `node --test tests/ortografia.test.cjs` — Expected: FAIL (`Cannot find module '../ortografia.js'`).

- [ ] **Step 2: Implementar `ortografia.js`**

```js
// Corretor ortográfico do Kiro: Hunspell real (WebAssembly, vendor/hunspell) com os dicionários de
// vendor/dicionarios/<código>.js. A palavra está certa se algum idioma da lista aceitar, ou se
// estiver no dicionário pessoal do cofre. O motor é injetável: no navegador é o vendor; nos
// testes, o pacote hunspell-asm do node_modules.
(function (root) {
  const IDIOMAS = ['pt-BR', 'en-US'];
  const MAX_SUGESTOES = 5;
  const dados = new Map();      // código → { aff, dic }
  let instancias = [];          // [{ codigo, h }]
  let pessoais = new Set();
  let cache = new Map();        // palavra → errada?
  let carregando = null;
  let fabrica = null, montados = [];   // fábrica do motor e arquivos já montados, por idioma
  const ouvintes = new Set();
  const avisar = () => { for (const fn of ouvintes) { try { fn(); } catch { /* um ouvinte com erro não para os outros */ } } };

  function registrar(codigo, { aff, dic }) { dados.set(codigo, { aff, dic }); }

  function scriptUmaVez(src) {
    return new Promise((ok, falha) => {
      if (document.querySelector(`script[data-ortografia="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.src = src; s.dataset.ortografia = src;
      s.onload = () => ok();
      s.onerror = () => { s.remove(); falha(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  function carregar({ motor, idiomas = IDIOMAS } = {}) {
    carregando ??= (async () => {
      const m = motor || root.HunspellAsm || (await scriptUmaVez('vendor/hunspell/hunspell.js'), root.HunspellAsm);
      fabrica = await m.loadModule();
      const cod = new TextEncoder();
      const novos = [];
      for (const codigo of idiomas) {
        try {
          if (!dados.has(codigo) && typeof document !== 'undefined') await scriptUmaVez(`vendor/dicionarios/${codigo}.js`);
          const d = dados.get(codigo);
          if (!d) continue;
          novos.push({ codigo, aff: fabrica.mountBuffer(cod.encode(d.aff), `${codigo}.aff`), dic: fabrica.mountBuffer(cod.encode(d.dic), `${codigo}.dic`) });
        } catch { /* esse idioma fica de fora; os outros continuam */ }
      }
      if (!novos.length) throw new Error('Não foi possível carregar o corretor');
      montados = novos;
      criarInstancias();
    })().catch(erro => { carregando = null; throw erro; });
    return carregando;
  }
  // Uma instância Hunspell por idioma, com as palavras pessoais. O Hunspell não remove palavra
  // adicionada; por isso, quando o dicionário pessoal perde palavras, as instâncias são recriadas
  // a partir dos arquivos já montados (rápido: não lê os dicionários de novo do disco).
  function criarInstancias() {
    for (const { h } of instancias) { try { h.dispose(); } catch { /* já liberada */ } }
    instancias = montados.map(({ codigo, aff, dic }) => {
      const h = fabrica.create(aff, dic);
      for (const p of pessoais) h.addWord(p);
      return { codigo, h };
    });
    cache = new Map(); avisar();
  }
  const pronto = () => instancias.length > 0;

  const IGNORAR = p => p.length < 2 || /\d/.test(p) || /[@/:]|\.\w/.test(p);
  const aceita = p => instancias.some(({ h }) => h.spell(p));
  function errada(palavra) {
    if (!pronto() || IGNORAR(palavra) || pessoais.has(palavra)) return false;
    if (cache.has(palavra)) return cache.get(palavra);
    const titulo = palavra[0] + palavra.slice(1).toLowerCase();
    const r = !(aceita(palavra) || aceita(palavra.toLowerCase()) || (palavra === palavra.toUpperCase() && aceita(titulo)));
    cache.set(palavra, r);
    return r;
  }

  function distancia(a, b) {
    const linha = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let anterior = linha[0]; linha[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const guardado = linha[j];
        linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
        anterior = guardado;
      }
    }
    return linha[b.length];
  }

  function sugestoes(palavra) {
    if (!pronto()) return [];
    const maiuscula = palavra[0] !== palavra[0].toLowerCase();
    const todas = new Set();
    for (const { h } of instancias) for (const s of h.suggest(palavra)) todas.add(maiuscula ? s[0].toUpperCase() + s.slice(1) : s);
    todas.delete(palavra);
    return [...todas].sort((x, y) => distancia(palavra, x) - distancia(palavra, y)).slice(0, MAX_SUGESTOES);
  }

  function adicionar(palavra) {
    pessoais.add(palavra);
    for (const { h } of instancias) h.addWord(palavra);
    cache = new Map(); avisar();
  }
  function definirPessoais(palavras) {
    const antes = pessoais;
    pessoais = new Set(palavras);
    const saiuAlguma = [...antes].some(p => !pessoais.has(p));
    if (saiuAlguma && montados.length) return criarInstancias();
    for (const p of pessoais) if (!antes.has(p)) for (const { h } of instancias) h.addWord(p);
    cache = new Map(); avisar();
  }
  const aoMudar = fn => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

  const api = { IDIOMAS, registrar, carregar, pronto, errada, sugestoes, adicionar, definirPessoais, aoMudar, distancia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroOrtografia = api;
})(globalThis);
```

Run: `node --test tests/ortografia.test.cjs` — PASS.

- [ ] **Step 3: Página, servidor, cobertura** — `index.html`: `<script src="ortografia.js"></script>` depois de `<script src="editor-nota.js"></script>` (os vendors **não** entram no index). `server.mjs` → `publicFiles`: `'/ortografia.js': ['ortografia.js', 'text/javascript'],`. `tests/idiomas-cobertura.test.cjs` → `FONTES`: `'ortografia.js'`.

- [ ] **Step 4:** `npm test` — nenhum `fail`. Commit: `Ortografia: módulo do corretor com idiomas em lista e dicionário pessoal`.

---

### Task 3: Dicionário pessoal no cofre

**Files:**
- Modify: `vault.cjs` (perto de `readHomeLayout`, ~linha 416), `electron/main.cjs` (perto de `home:get`), `electron/preload.cjs`, `server.mjs` (perto de `/api/home-layout`)
- Test: `tests/vault.test.cjs` (acrescentar), `tests/ortografia-canais.test.cjs`

**Interfaces:**
- Produces:
  - `vault.readDictionary(): Promise<string[]>` — `.kiro/dicionario.txt`; ausente → `[]`; linhas aparadas, vazias fora, sem repetidas, aceita `\r\n`.
  - `vault.addToDictionary(palavra): Promise<string[]>` — valida com `palavraParaDicionario` de `corretor.js` (senão lança `Error('Palavra inválida.')`), acrescenta se não existir, grava atômico, devolve a lista.
  - Preload: `dicionario: () => ipcRenderer.invoke('dicionario:get')`, `adicionarAoDicionarioDoCofre: palavra => ipcRenderer.invoke('dicionario:add', palavra)`.
  - Web: `GET /api/dicionario` → `string[]`; `POST /api/dicionario` com `{ palavra }` → `string[]`.

- [ ] **Step 1: Testes**

Em `tests/vault.test.cjs`, no mesmo estilo do teste de `readHomeLayout` (~linha 251, que cria um cofre temporário):

```js
test('dicionário pessoal: ausente = vazio; adiciona sem repetir; lê \\r\\n e linhas vazias', async () => {
  // crie o cofre temporário como o teste de readHomeLayout faz
  assert.deepEqual(await vault.readDictionary(), []);
  assert.deepEqual(await vault.addToDictionary('nubank'), ['nubank']);
  assert.deepEqual(await vault.addToDictionary('nubank'), ['nubank']);
  await fs.writeFile(path.join(pasta, '.kiro', 'dicionario.txt'), 'Kiro\r\n\r\n  BTG  \r\nKiro\r\n');
  assert.deepEqual(await vault.readDictionary(), ['Kiro', 'BTG']);
  await assert.rejects(vault.addToDictionary('duas palavras'), /Palavra inválida/);
});
```

(Use os nomes de variáveis do teste vizinho — `vault`, a pasta do cofre, `fs`/`path`.)

```js
// tests/ortografia-canais.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('canais do dicionário pessoal no app e na web', () => {
  const main = ler('electron/main.cjs'), preload = ler('electron/preload.cjs'), servidor = ler('server.mjs');
  assert.ok(/ipcMain\.handle\('dicionario:get', \(\) => vault\.readDictionary\(\)\)/.test(main));
  assert.ok(/ipcMain\.handle\('dicionario:add', \(_event, palavra\) => vault\.addToDictionary\(palavra\)\)/.test(main));
  assert.ok(preload.includes("dicionario: () => ipcRenderer.invoke('dicionario:get')"));
  assert.ok(preload.includes("adicionarAoDicionarioDoCofre: palavra => ipcRenderer.invoke('dicionario:add', palavra)"));
  assert.ok(servidor.includes("'/api/dicionario'"));
});
```

Run os dois — FAIL.

- [ ] **Step 2: Implementar**

`vault.cjs`, depois de `writeHomeLayout`:

```js
  /** Dicionário pessoal do corretor em .kiro/dicionario.txt: uma palavra por linha. */
  async readDictionary(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','dicionario.txt'));
    return [...new Set((bruto||'').split(/\r?\n/).map(p=>p.trim()).filter(Boolean))];
  }
  async addToDictionary(palavra){
    if(!palavraParaDicionario(palavra))throw new Error(frase('Palavra inválida.'));
    const palavras=await this.readDictionary();
    if(!palavras.includes(palavra)){palavras.push(palavra);await atomicWrite(path.join(this.directory,'.kiro','dicionario.txt'),palavras.join('\n')+'\n');}
    return palavras;
  }
```

No topo de `vault.cjs`: `const { palavraParaDicionario } = require('./corretor.js');` (confira que `frase` já existe no arquivo — a etapa de idiomas o criou). Acrescente `'Palavra inválida.': 'Invalid word.'` em `idiomas/en.js` (seção de mensagens de outros módulos). Confirme que `atomicWrite` cria a pasta `.kiro` se faltar (como `writeHomeLayout` precisa); se não criar, faça `mkdir` antes.

`electron/main.cjs`, junto de `home:get`/`home:set`:

```js
  ipcMain.handle('dicionario:get', () => vault.readDictionary());
  ipcMain.handle('dicionario:add', (_event, palavra) => vault.addToDictionary(palavra));
```

`electron/preload.cjs`: as duas linhas da interface acima.

`server.mjs`, junto de `/api/home-layout` (mesmo estilo):

```js
    if (rota === '/api/dicionario') {
      if (request.method === 'GET') return send(response, 200, await vault.readDictionary());
      if (request.method === 'POST') return send(response, 200, await vault.addToDictionary(String((await lerJson(request, 4096))?.palavra ?? '')));
    }
```

`asarUnpack` do `package.json` já inclui `vault.cjs`; confira que `corretor.js` também é encontrado de dentro do `app.asar.unpacked` (se `vault.cjs` está desempacotado e `corretor.js` não, o `require('./corretor.js')` falha no app instalado): acrescente `"corretor.js"` ao `asarUnpack`, e `"idiomas.js"` também se `vault.cjs` usar `frase` vindo dele. Diga no relatório o que conferiu.

- [ ] **Step 3:** os dois testes — PASS; `npm test` — nenhum `fail`. Commit: `Ortografia: dicionário pessoal no cofre`.

---

### Task 4: Sublinhado no editor

**Files:**
- Modify: `editor-nota.js`, `styles.css`
- Test: `tests/editor-ao-vivo.test.cjs` (acrescentar)

**Interfaces:**
- Consumes: `analisar` (já existe; seus `estilos` com classe `ed-sem-corretor` são os trechos a ignorar).
- Produces (em `KiroEditor`):
  - `palavrasDaLinha(texto: string, ignorar: Array<[number, number]>): Array<{ de, ate, palavra }>` — pura; posições relativas a `texto`.
  - `montar(…, { …, ortografia: { ativa: boolean, errada: (p) => boolean } })` — `errada` vem do app (`KiroOrtografia.errada`); o editor não conhece `KiroOrtografia`.
  - métodos novos no objeto devolvido: `definirOrtografia(ativa: boolean)`, `redesenharOrtografia()` (o app chama quando `KiroOrtografia.aoMudar` avisa), `palavraEm(x, y): { de, ate, palavra } | null`, `trocarTrecho(de, ate, texto)` (transação normal, desfazível).
  - `.cm-content` sempre com `spellcheck="false"`: remova `atributosDoCorretor`, o `compartimentoCorretor`, a opção `corretor` e `definirCorretor` (o app deixa de usá-los na Task 5); apague também o teste de `atributosDoCorretor`.

- [ ] **Step 1: Testes da função pura**

```js
test('palavrasDaLinha: letras com acento, hífen e apóstrofo internos, pula trechos ignorados', () => {
  const p = (t, ig = []) => E.palavrasDaLinha(t, ig).map(x => t.slice(x.de, x.ate));
  assert.deepEqual(p('O ovário e a bicicletta.'), ['O', 'ovário', 'e', 'a', 'bicicletta']);
  assert.deepEqual(p("guarda-chuva, don't e d'água"), ['guarda-chuva', "don't", 'e', "d'água"]);
  assert.deepEqual(p('-borda- e ’aspas’'), ['borda', 'e', 'aspas']);
  assert.deepEqual(p('ver código aqui', [[4, 10]]), ['ver', 'aqui']);
  assert.deepEqual(p('ano 2026 e C3PO'), ['ano', '2026', 'e', 'C3PO'], 'o editor entrega; quem ignora números é o corretor');
});
```

Run — FAIL (`E.palavrasDaLinha is not a function`).

- [ ] **Step 2: Implementar**

`palavrasDaLinha` (perto de `marcacoesDoKiro`):

```js
  // Palavras de uma linha para o corretor: letras e números (Unicode), com hífen ou apóstrofo só
  // entre letras (guarda-chuva, don't, d'água). Trechos em `ignorar` (código, endereço, alvo de
  // [[link]], etiqueta) ficam de fora.
  const PALAVRA = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  function palavrasDaLinha(texto, ignorar = []) {
    const fora = (a, b) => !ignorar.some(([x, y]) => a < y && b > x);
    return [...texto.matchAll(PALAVRA)].map(m => ({ de: m.index, ate: m.index + m[0].length, palavra: m[0] })).filter(({ de, ate }) => fora(de, ate));
  }
```

No `montar`: um segundo `ViewPlugin` (`ortografiaPlugin`) que, quando `ortografia.ativa`, percorre as linhas visíveis, pega os `ed-sem-corretor` daquela linha (do mesmo `analisar` já calculado na decoração ao vivo — passe-os adiante ou calcule `analisar` uma vez por linha visível), chama `palavrasDaLinha` e marca `Decoration.mark({ class: 'ed-erro' })` nas palavras com `ortografia.errada(palavra)`. Recalcule em `docChanged`, `viewportChanged` e quando receber o efeito de `redesenharOrtografia()` (um `StateEffect.define()` despachado pelo método). Para não varrer a parte visível inteira a cada tecla: guarde as decorações e, em `docChanged`, refaça só as linhas tocadas pela mudança (`u.changes.iterChangedRanges`) mapeando o resto com `decorations.map(u.changes)`. `definirOrtografia(false)` limpa; `true` recalcula.

`palavraEm(x, y)`: `const pos = view.posAtCoords({ x, y }); if (pos == null) return null; const l = view.state.doc.lineAt(pos);` e devolva a palavra de `palavrasDaLinha(l.text)` que contém `pos - l.from` (com `de/ate` convertidos para posição no documento).

`trocarTrecho(de, ate, texto)`: `view.dispatch({ changes: { from: de, to: ate, insert: texto }, selection: { anchor: de + texto.length }, userEvent: 'input' })`.

`styles.css` (seção do editor):

```css
.doc-corpo .ed-erro { text-decoration:underline wavy #e5484d; text-decoration-skip-ink:none; text-underline-offset:3px; }
/* O tema padrão do CodeMirror põe monospace no .cm-scroller: o texto da nota usa a fonte da leitura. */
.doc-corpo .cm-scroller { font-family:inherit; line-height:inherit; }
```

Confira no navegador que o texto do editor tem a mesma `font-family` computada que `.doc-corpo` na leitura (pegue a de um elemento `.doc-leitura` do painel da direita, ou a de `#doc-corpo`).

- [ ] **Step 3:** `node --test tests/editor-ao-vivo.test.cjs tests/editor-area.test.cjs` e `npm test` — nenhum `fail`. Verificação no navegador (`npm run dev`, helper headless): montar um editor numa `div` com `ortografia: { ativa: true, errada: p => p === 'ovario' }` e texto `'casa ovario fim'` → um `.ed-erro` com texto `ovario`; `palavraEm` no centro desse elemento devolve `{ palavra: 'ovario' }`; `definirOrtografia(false)` remove o sublinhado. Commit: `Editor: sublinhado do corretor próprio e fonte da leitura`.

---

### Task 5: O app usa o corretor próprio

**Files:**
- Modify: `app.js` (`opcoesDoEditor` ~1826, `montarEditorDaNota`, `aplicarCorretor` ~474, `aoMenu`, troca de cofre), `idiomas/en.js`

**Interfaces:**
- Consumes: `KiroOrtografia` (Task 2), `cadernoDesktop.dicionario`/`adicionarAoDicionarioDoCofre` e `/api/dicionario` (Task 3), métodos do editor da Task 4, `KiroCorretor.itensDoCorretor` (existente).

- [ ] **Step 1: Carregar e ligar**

```js
// Corretor próprio (ortografia.js): carregado em segundo plano depois que a primeira nota aparece,
// só com a opção ligada. O dicionário pessoal vem do cofre aberto.
let ortografiaIniciada = false;
async function iniciarOrtografia() {
  if (ortografiaIniciada || !corretorLigado) return;
  ortografiaIniciada = true;
  try {
    const pessoais = await (window.cadernoDesktop ? window.cadernoDesktop.dicionario() : api('dicionario'));
    KiroOrtografia.definirPessoais(Array.isArray(pessoais) ? pessoais : []);
    KiroOrtografia.aoMudar(() => editorDaNota?.editor.redesenharOrtografia());
    await KiroOrtografia.carregar();
  } catch {
    ortografiaIniciada = false;
    status(t('Não foi possível carregar o corretor'), true);
  }
}
```

(`api('dicionario')` sem corpo faz GET — confira a assinatura de `api()` no `app.js`; se ela não fizer GET sem corpo, use `fetch('/api/dicionario').then(r => r.json())`.)

Em `opcoesDoEditor()`: troque `corretor: corretorLigado,` por `ortografia: { ativa: corretorLigado, errada: p => KiroOrtografia.errada(p) },`. Depois que `montarEditorDaNota` monta o editor (ramo novo, não o de reaproveitamento), chame `setTimeout(iniciarOrtografia, 0)` (fora do caminho da abertura).

Em `aplicarCorretor()`: troque `editorDaNota?.editor.definirCorretor?.(corretorLigado);` por `editorDaNota?.editor.definirOrtografia(corretorLigado); if (corretorLigado) iniciarOrtografia();`.

Na troca de cofre (onde o app recarrega o estado depois de escolher outro cofre — procure `chooseVault`/`escolherOutroCofre`), recarregue o dicionário pessoal: `if (KiroOrtografia.pronto()) KiroOrtografia.definirPessoais(await (window.cadernoDesktop ? window.cadernoDesktop.dicionario() : api('dicionario')));`.

- [ ] **Step 2: Menu do botão direito**

`aoMenu` em `opcoesDoEditor`:

```js
    aoMenu: evento => {
      if (evento.shiftKey && !window.cadernoDesktop) return;
      const editor = editorDaNota.editor, area = editor.area();
      const alvo = corretorLigado && KiroOrtografia.pronto() ? editor.palavraEm(evento.clientX, evento.clientY) : null;
      if (alvo && KiroOrtografia.errada(alvo.palavra)) {
        evento.preventDefault();
        const doCorretor = KiroCorretor.itensDoCorretor({ palavra: alvo.palavra, sugestoes: KiroOrtografia.sugestoes(alvo.palavra) }, {
          trocar: s => editor.trocarTrecho(alvo.de, alvo.ate, s),
          adicionar: p => adicionarAoDicionario(p),
          t,
        });
        return abrirMenuContexto(evento, area, [...doCorretor, { separador: true }, ...menuDaNota()]);
      }
      abrirMenuContexto(evento, area);
    },
```

```js
async function adicionarAoDicionario(palavra) {
  KiroOrtografia.adicionar(palavra);   // o sublinhado some na hora
  try { await (window.cadernoDesktop ? window.cadernoDesktop.adicionarAoDicionarioDoCofre(palavra) : api('dicionario', { palavra })); }
  catch (erro) { status(t('Não foi possível salvar no dicionário: {erro}', { erro: mensagemDoErro(erro) }), true); }
}
```

O caminho antigo (`podeCorrigir`/`esperarCorretor`) deixa de ser chamado dentro do corpo da nota — o `.cm-content` tem `spellcheck="false"`, então `podeCorrigir` já não deve casar; confira que o ouvinte global de `contextmenu` (fim do `app.js`) não abre um segundo menu no corpo.

- [ ] **Step 3: Frases** — `idiomas/en.js`: `'Não foi possível carregar o corretor': 'Could not load the spell checker'`, `'Não foi possível salvar no dicionário: {erro}': 'Could not save to the dictionary: {erro}'`. Se a descrição da opção "Corretor ortográfico" nas Configurações (aba Editor) disser algo que deixou de ser verdade, ajuste o texto em português e o inglês correspondente.

- [ ] **Step 4: Verificação no navegador** (`npm run dev`, helper headless, globais pelo mundo principal): abrir `teste-do-corretor` (está no `dev-vault`) **sem digitar**; em até 1 s depois que a nota aparece, existem `.ed-erro` para `Xp`, `nubank`, `ovario`, `bicicletta`, `palavrra`; botão direito em `ovario` → menu com `ovário` no topo e "Adicionar "ovario" ao dicionário"; escolher troca o texto e Ctrl+Z volta; "Adicionar" em `nubank` → o `.ed-erro` some e `dev-vault/.kiro/dicionario.txt` contém `nubank` (apague a linha depois); `corretorLigado = false; aplicarCorretor()` → nenhum `.ed-erro`; recarregar a página com `localStorage.setItem('kiro.corretor','0')` e abrir uma nota → nenhum `<script>` com `vendor/hunspell` ou `vendor/dicionarios` na página (restaure a preferência depois).

- [ ] **Step 5:** `npm test` — nenhum `fail`. Commit: `Ortografia: corpo da nota com o corretor próprio, sugestões e dicionário do cofre`.

---

### Task 6: Verificação final (feita por quem coordena)

- [ ] `npm test`.
- [ ] Medição (scripts do rascunho `medir-cm.mjs` e `medir-pt-BR.mjs`): abrir a nota longa quente sem piora (referência ~7 ms), por tecla < 16 ms (referência 1,8 ms), Hoje e Notas sem piora; tempo até o primeiro `.ed-erro` depois de abrir a primeira nota ≤ 1 s.
- [ ] App desktop automatizado (perfil separado, `--dev-vault`): os itens da Task 5 Step 4, no Electron.
- [ ] Revisão final do branch `editor-ao-vivo` inteiro (etapa 1 + corretor) no modelo mais capaz, com os itens adiados dos dois registros.
