# Plug-ins etapa 4 — Molduras isoladas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plug-ins ganham telas próprias (HTML/CSS/JS do autor) numa moldura isolada, dentro de blocos, painéis e numa página cheia com item na barra lateral.

**Architecture:** O Kiro serve o `.html` do plug-in com uma CSP que o põe em sandbox e corta a rede, injetando `kiro-frame.js`, que monta o objeto `kiro` da tela e fala com a página por `postMessage`. O hospedeiro (`app.js`) acha o plug-in pela moldura que mandou a mensagem (`event.source`) e atende pelo mesmo caminho das chamadas do worker (`podeChamar` + `executarMetodo`).

**Tech Stack:** JavaScript puro, Electron 44, Node `node:test`. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-15-plugins-design.md`, seção "Molduras isoladas (etapa 4)".

## Global Constraints

- Sem framework, sem TypeScript, sem build, sem dependência nova.
- API pública do plug-in em inglês; código interno, comentários, commits e interface em português do Brasil.
- Nunca operação genérica de arquivo, processo ou rede. A tela não ganha nada além das permissões já concedidas ao plug-in.
- Não usar `confirm()`/`alert()` nativos.
- Testes só em cofre temporário (`fs.mkdtemp`). Nunca tocar em `C:\Projetos\Meu segundo cerebro\vault` nem em `C:\Users\bielg\Documents\KUROI\vault`.
- Não versionar `kuroi-2026-09-12.json`. Não fazer push.
- Valor de chave (segredo) nunca vai para a página, a moldura, o worker ou logs.
- Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Rodar a suíte com `node --test` na raiz; hoje: 153 testes, 152 passam, 1 pulado.

## Decisões fechadas no plano (refinam a spec)

1. **CSP com origem explícita, não `'self'`.** Numa moldura de origem opaca, `'self'` é ambíguo; usamos a origem da URL: na web `http://<host da requisição>` (ex.: `http://127.0.0.1:4180`), no Electron o esquema `kiro-plugin:`. Nunca `http:`/`https:` inteiros (seriam canal de vazamento via `<script src>`/`<img src>` para fora). Isso dispensa o teste exploratório previsto na spec.
2. **Aperto de mão manda `metodos`**, a lista já filtrada por `metodosPermitidos(permissoes)`, em vez de `permissoes`: `kiro-frame.js` não precisa carregar `plugins.js`.
3. **`kiro.ready`**: a API da tela chega no aperto de mão, que é assíncrono. O autor escreve `kiro.ready.then(() => …)` (ou `await kiro.ready`); antes disso `kiro` só tem `ready`, `onData`, `resize` e `openLink`.
4. **Defesa em profundidade na tela:** `kiro-frame.js` apaga `RTCPeerConnection`, `webkitRTCPeerConnection`, `RTCDataChannel` e `RTCSessionDescription` antes de o código do plug-in rodar (WebRTC não é coberto por `connect-src`), e a resposta leva `X-DNS-Prefetch-Control: off`. A navegação da própria moldura para fora é barrada pelo `frame-src` do `index.html`.
5. **Redesenho:** `render()` reescreve `#app`. A página cheia do plug-in é preservada quando a tela redesenhada é a mesma página; painéis com moldura recebem `dados` novos em vez de recriar a moldura quando o arquivo não mudou. Blocos em notas recriam a moldura ao redesenhar a nota (marcado com `ponytail:`).

## Arquivos

| Arquivo | Muda |
|---|---|
| `plugins.js` | `page` no manifesto; `validarMoldura`, `tipoDoArquivoDoPlugin`, `cspDaMoldura`, `injetarScriptsDaMoldura`, `VARIAVEIS_DO_TEMA`, `ALTURA_DA_MOLDURA` |
| `vault.cjs` | `readPluginFile` serve `.js`, `.html`, `.css` |
| `kiro-frame.js` (novo) | Runtime da tela: `kiro` da moldura, tema, altura, links |
| `server.mjs` | Rota `/plugins/<id>/<arquivo>` com tipo, CSP da moldura e injeção; `/kiro-frame.js` público |
| `electron/main.cjs` | Mesmo no esquema `kiro-plugin`; `kiro-frame.js` em `ARQUIVOS_DO_KIRO` |
| `index.html` | CSP ganha `frame-src 'self' kiro-plugin:`; grupo `#nav-plugins` na barra lateral |
| `app.js` | Molduras em blocos/painéis, mensagens, tema, página cheia, item lateral, linha no consentimento |
| `styles.css` | `.plugin-moldura`, `.plugin-pagina`, grupo lateral |
| `examples/plugins/habit-heatmap/` (novo) | Exemplo |
| `docs/plugins.md`, `docs/KIRO-resumo-para-IA.md` | Documentação |
| `tests/plugins-molduras.test.cjs` (novo) | Testes puros, de cofre e de rota |

---

### Task 1: Parte pura — manifesto `page`, moldura, CSP e injeção

**Files:**
- Modify: `plugins.js` (função `validarManifesto` em ~40–74 e o objeto `api` no fim)
- Modify: `vault.cjs:337-344` (`readPluginFile`)
- Modify: `tests/plugins.test.cjs:62` (mensagem do `.json` recusado continua casando com `/js/i`; conferir)
- Create: `tests/plugins-molduras.test.cjs`

**Interfaces:**
- Produces (em `KiroPlugins` / `require('../plugins.js')`):
  - `validarManifesto(...)` agora devolve `manifesto.page`: `{ title, file } | null`.
  - `ALTURA_DA_MOLDURA = { min: 40, max: 2000, padrao: 240 }`
  - `validarMoldura(valor) → { ok: true, frame, height, data } | { ok: false, erro }` — `valor` é o que o bloco/painel devolveu (`{ frame, data, height }`).
  - `arquivoDeTela(nome) → boolean` — `[a-z0-9][a-z0-9._-]{0,60}\.html`, sem `..`.
  - `tipoDoArquivoDoPlugin(nome) → 'text/javascript; charset=utf-8' | 'text/html; charset=utf-8' | 'text/css; charset=utf-8' | null`
  - `cspDaMoldura(origem) → string` — `origem` é `'http://127.0.0.1:4180'` (web) ou `'kiro-plugin:'` (Electron).
  - `injetarScriptsDaMoldura(html, urlDoScript) → string`
  - `VARIAVEIS_DO_TEMA` — lista das 15 cores + 3 fontes.
- `vault.readPluginFile(id, arquivo)` aceita `.js`, `.html`, `.css`.

- [ ] **Step 1: Write the failing test** — `tests/plugins-molduras.test.cjs`:

```js
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
```

- [ ] **Step 2: Run** `node --test tests/plugins-molduras.test.cjs` → FAIL (`validarMoldura is not a function`, etc.).

- [ ] **Step 3: Implement** em `plugins.js`, antes de `validarManifesto`:

```js
  // ---- Molduras isoladas (etapa 4) ----
  const ALTURA_DA_MOLDURA = { min: 40, max: 2000, padrao: 240 };
  const arquivoDeTela = nome => typeof nome === 'string' && /^[a-z0-9][a-z0-9._-]{0,60}\.html$/i.test(nome) && !nome.includes('..');
  const TIPOS_DE_ARQUIVO = { js: 'text/javascript; charset=utf-8', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8' };
  const tipoDoArquivoDoPlugin = nome => {
    const m = /\.([a-z]+)$/i.exec(String(nome || ''));
    return (m && TIPOS_DE_ARQUIVO[m[1].toLowerCase()]) || null;
  };
  function validarMoldura(valor) {
    if (!valor || typeof valor !== 'object' || !arquivoDeTela(valor.frame)) return { ok: false, erro: 'A moldura precisa de um arquivo .html da pasta do plug-in.' };
    const { min, max, padrao } = ALTURA_DA_MOLDURA;
    const altura = Number.isFinite(valor.height) ? Math.min(max, Math.max(min, Math.round(valor.height))) : padrao;
    return { ok: true, frame: valor.frame, height: altura, data: valor.data === undefined ? null : valor.data };
  }
  /**
   * CSP do .html do plug-in. `origem` é a origem explícita dos arquivos do Kiro
   * ('http://127.0.0.1:4180' na web, 'kiro-plugin:' no Electron): numa moldura de
   * origem opaca 'self' é ambíguo, e esquema inteiro (http:) abriria vazamento por
   * <script src>/<img src>. `sandbox` isola mesmo se a URL for aberta direto.
   */
  function cspDaMoldura(origem) {
    const partes = [
      'sandbox allow-scripts', "default-src 'none'", `script-src ${origem}`, `style-src ${origem} 'unsafe-inline'`,
      `img-src ${origem} data:`, `font-src ${origem} data:`, "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
    ];
    // No Electron a página é file://, que nenhuma fonte de frame-ancestors casa: lá fica sem.
    if (/^https?:\/\//.test(origem)) partes.push(`frame-ancestors ${origem}`);
    return partes.join('; ');
  }
  // O runtime da tela entra antes de qualquer script do plug-in: logo depois de <head>,
  // ou no começo do arquivo se não houver <head> antes do primeiro <script>.
  function injetarScriptsDaMoldura(html, urlDoScript) {
    const tag = `<script src="${urlDoScript}"></script>`;
    const texto = String(html);
    const head = /<head\b[^>]*>/i.exec(texto);
    const script = /<script\b/i.exec(texto);
    if (head && (!script || head.index < script.index)) return texto.slice(0, head.index + head[0].length) + tag + texto.slice(head.index + head[0].length);
    return tag + texto;
  }
  const VARIAVEIS_DO_TEMA = ['--bg', '--panel', '--panel-raised', '--sidebar-bg', '--content-bg', '--campo', '--ink', '--muted', '--line',
    '--acento', '--acento-2', '--acento-forte', '--acento-escuro', '--acento-texto', '--primario-texto', '--fonte-interface', '--fonte-leitura', '--fonte-codigo'];
```

Em `validarManifesto`, antes do `return { ok: true, … }`:

```js
    let page = null;
    if (bruto.page !== undefined) {
      const p = bruto.page;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return recusa('O campo page precisa ser um objeto { title, file }.');
      if (!texto(p.title, 40) || temControle(p.title)) return recusa('O título da página (page.title) é obrigatório e vai até 40 caracteres.');
      if (!arquivoDeTela(p.file)) return recusa('page.file precisa ser um arquivo .html da pasta do plug-in, sem barra.');
      page = { title: p.title, file: p.file };
    }
```

e acrescente `page` no objeto `manifesto` devolvido. (Confira que `texto` recusa string vazia; se não recusar, teste `p.title.trim()` também.) Acrescente ao objeto `api`: `ALTURA_DA_MOLDURA, VARIAVEIS_DO_TEMA, validarMoldura, arquivoDeTela, tipoDoArquivoDoPlugin, cspDaMoldura, injetarScriptsDaMoldura`.

Em `vault.cjs`, `readPluginFile`:

```js
  /** Código e telas: .js para o worker, .html e .css para as molduras. */
  async readPluginFile(id,arquivo){
    const alvo=await this.pluginPath(id,arquivo);
    if(!/\.(js|html|css)$/i.test(arquivo))throw new Error('Só arquivos .js, .html ou .css de plug-in são servidos.');
```

- [ ] **Step 4: Run** `node --test` → tudo PASS (incluindo `tests/plugins.test.cjs:62`).
- [ ] **Step 5: Commit** — `git add plugins.js vault.cjs tests/plugins-molduras.test.cjs && git commit -m "Plug-ins: manifesto page, moldura e CSP da tela"` (com o Co-Authored-By).

---

### Task 2: Servir a tela — rota web, esquema do Electron e `kiro-frame.js`

**Files:**
- Create: `kiro-frame.js`
- Modify: `server.mjs:22` (`publicFiles` ganha `/kiro-frame.js`), `server.mjs:150-167` (rota `/plugins/`)
- Modify: `electron/main.cjs:19-23,70-86`
- Modify: `index.html:6` (CSP)
- Test: `tests/plugins-molduras.test.cjs` (acrescentar o teste de rota)

**Interfaces:**
- Consumes (Task 1): `tipoDoArquivoDoPlugin`, `cspDaMoldura`, `injetarScriptsDaMoldura`, `vault.readPluginFile`.
- Produces: URLs de tela — web `/plugins/<id>/<arquivo>.html`, Electron `kiro-plugin://<id>/<arquivo>.html`; runtime em `/kiro-frame.js` e `kiro-plugin://kiro.app/kiro-frame.js`.
- Protocolo da moldura (fixo; Task 3 implementa o lado do hospedeiro):
  - tela → Kiro: `{ tipo: 'pronto' }`, `{ tipo: 'chamada', chamada, metodo, args }`, `{ tipo: 'altura', valor }`, `{ tipo: 'link', url }`
  - Kiro → tela: `{ tipo: 'ativar', metodos, data, tema }`, `{ tipo: 'resposta', chamada, valor | erro }`, `{ tipo: 'dados', data }`, `{ tipo: 'tema', tema }` — `tema` é `{ '--bg': '#…', … }`.

- [ ] **Step 1: Write the failing test** — acrescente a `tests/plugins-molduras.test.cjs`:

```js
const { spawn } = require('node:child_process');
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
  assert.match(await tela.text(), /<head><script src="\/kiro-frame\.js"><\/script><\/head>/);
  const css = await fetch(`${base}/plugins/habit-heatmap/style.css`);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  // .js continua com a CSP do worker, sem injeção.
  assert.equal((await fetch(`${base}/plugins/habit-heatmap/manifest.json`)).status, 404);
  const runtime = await fetch(`${base}/kiro-frame.js`);
  assert.equal(runtime.status, 200);
  assert.match(await runtime.text(), /RTCPeerConnection/);
});
```

- [ ] **Step 2: Run** `node --test tests/plugins-molduras.test.cjs` → FAIL.

- [ ] **Step 3: Implement.**

`kiro-frame.js` (script clássico, raiz do projeto):

```js
// Runtime das telas de plug-in (código do Kiro, roda dentro da moldura isolada).
// A moldura tem origem opaca e CSP sem rede: tudo o que a tela faz passa por
// mensagem à página do Kiro, que confere a permissão de novo a cada chamada.
//
// Protocolo (tela → Kiro): { tipo: 'pronto' } · { tipo: 'chamada', chamada, metodo, args }
//   · { tipo: 'altura', valor } · { tipo: 'link', url }
// (Kiro → tela): { tipo: 'ativar', metodos, data, tema } · { tipo: 'resposta', chamada, valor | erro }
//   · { tipo: 'dados', data } · { tipo: 'tema', tema }
(function () {
  'use strict';
  // WebRTC não é coberto por connect-src: sem isto, a tela conversaria com um servidor STUN de fora.
  for (const nome of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) {
    try { delete window[nome]; } catch { /* não configurável: fica a CSP */ }
  }
  const pai = window.parent;
  const enviar = mensagem => pai.postMessage(mensagem, '*');   // origem opaca: não há alvo nomeável
  const pendentes = new Map();
  const ouvintes = [];
  let proxima = 1, pronto;
  const chamar = (metodo, args) => new Promise((resolve, reject) => {
    const chamada = proxima++;
    pendentes.set(chamada, { resolve, reject });
    enviar({ tipo: 'chamada', chamada, metodo, args });
  });
  const aplicarTema = tema => {
    for (const [nome, valor] of Object.entries(tema || {})) if (/^--[a-z0-9-]+$/.test(nome)) document.documentElement.style.setProperty(nome, String(valor));
  };
  const kiro = {
    data: null,
    ready: new Promise(resolve => { pronto = resolve; }),
    onData: fn => { if (typeof fn === 'function') ouvintes.push(fn); },
    resize: altura => enviar({ tipo: 'altura', valor: Number(altura) }),
    openLink: url => enviar({ tipo: 'link', url: String(url) }),
  };
  window.kiro = kiro;
  window.addEventListener('message', ({ source, data }) => {
    if (source !== pai || !data || typeof data !== 'object') return;
    if (data.tipo === 'ativar') {
      for (const metodo of Array.isArray(data.metodos) ? data.metodos : []) {
        const [grupo, nome] = metodo.includes('.') ? metodo.split('.') : ['', metodo];
        const fn = (...args) => chamar(metodo, args);
        if (!grupo) kiro[nome] = fn; else (kiro[grupo] = kiro[grupo] || {})[nome] = fn;
      }
      kiro.data = data.data ?? null;
      aplicarTema(data.tema);
      pronto(kiro);
    } else if (data.tipo === 'resposta') {
      const p = pendentes.get(data.chamada);
      if (!p) return;
      pendentes.delete(data.chamada);
      data.erro ? p.reject(new Error(data.erro)) : p.resolve(data.valor);
    } else if (data.tipo === 'dados') {
      kiro.data = data.data ?? null;
      for (const fn of ouvintes) try { fn(kiro.data); } catch (erro) { console.error(erro); }
    } else if (data.tipo === 'tema') aplicarTema(data.tema);
  });
  enviar({ tipo: 'pronto' });
})();
```

`server.mjs`: acrescente `'/kiro-frame.js': ['kiro-frame.js', 'text/javascript']` a `publicFiles`. Na rota `/plugins/`, troque o `writeHead` fixo por:

```js
      try {
        const id = decodeURIComponent(partes[0]), arquivo = decodeURIComponent(partes[1]);
        const tipo = KiroPlugins.tipoDoArquivoDoPlugin(arquivo);
        let corpo = await vault.readPluginFile(id, arquivo);
        const cabecalhos = { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'" };
        // Tela de plug-in: sandbox e rede cortada na própria resposta, com o runtime do Kiro injetado.
        if (tipo.startsWith('text/html')) {
          const origem = `http://${request.headers.host}`;   // já conferido em allowedHosts
          corpo = KiroPlugins.injetarScriptsDaMoldura(corpo.toString('utf8'), '/kiro-frame.js');
          cabecalhos['Content-Security-Policy'] = KiroPlugins.cspDaMoldura(origem);
          cabecalhos['X-DNS-Prefetch-Control'] = 'off';
        }
        response.writeHead(200, cabecalhos);
        return response.end(corpo);
```

(`KiroPlugins` = `require` de `plugins.js`; se `server.mjs` ainda não importa, use `createRequire(import.meta.url)('./plugins.js')` como já é feito para os `.cjs`.)

`electron/main.cjs`: `ARQUIVOS_DO_KIRO` ganha `'kiro-frame.js'`; importe `const KiroPlugins = require('../plugins.js');` e no `protocol.handle('kiro-plugin', …)`:

```js
      const tipo = url.hostname === HOST_DO_KIRO ? 'text/javascript; charset=utf-8' : KiroPlugins.tipoDoArquivoDoPlugin(arquivo);
      let corpo = url.hostname === HOST_DO_KIRO ? await readFile(join(__dirname, '..', arquivo)) : await vault.readPluginFile(url.hostname, arquivo);
      const cabecalhos = { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP_DO_WORKER, 'Access-Control-Allow-Origin': '*' };
      if (tipo.startsWith('text/html')) {
        corpo = KiroPlugins.injetarScriptsDaMoldura(corpo.toString('utf8'), `kiro-plugin://${HOST_DO_KIRO}/kiro-frame.js`);
        cabecalhos['Content-Security-Policy'] = KiroPlugins.cspDaMoldura('kiro-plugin:');
        cabecalhos['X-DNS-Prefetch-Control'] = 'off';
        delete cabecalhos['Access-Control-Allow-Origin'];
      }
      return new Response(corpo, { headers: cabecalhos });
```

`index.html:6`: acrescente `frame-src 'self' kiro-plugin:;` à CSP (antes de `style-src`).

- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: servir a tela do plug-in isolada, na web e no app"`.

---

### Task 3: Hospedeiro — molduras em blocos e painéis

**Files:**
- Modify: `app.js` — seção `// ---- Plug-ins ----` (~2026–2440): `atenderPlugin`, `guardarPainel`, `htmlDoBloco`, `gravarAparencia` (~2564)
- Modify: `styles.css` (fim das regras `.plugin-*`)

**Interfaces:**
- Consumes: `KiroPlugins.validarMoldura`, `KiroPlugins.metodosPermitidos`, `KiroPlugins.podeChamar`, `KiroPlugins.VARIAVEIS_DO_TEMA`, `KiroPlugins.ALTURA_DA_MOLDURA`; protocolo da Task 2.
- Produces (usados pela Task 4):
  - `urlDaTela(id, arquivo) → string`
  - `molduraHtml(id, arquivo, altura, chave) → string` — `<iframe class="plugin-moldura" sandbox="allow-scripts" …>`
  - `dadosDasMolduras: Map<chave, data>`
  - `temaAtual() → { '--bg': …, … }`
  - `responderChamada(id, estado, data, enviar)` — atende `{ chamada, metodo, args }` e chama `enviar(resposta)`.

- [ ] **Step 1: Implement** (sem teste unitário: a parte testável está na Task 1; esta é verificada no navegador no Step 3).

Extraia de `atenderPlugin` o atendimento de `'chamada'` para uma função reaproveitada pelo worker e pela moldura:

```js
// Worker e moldura passam pela mesma porta: permissão conferida de novo, mesmos limites.
async function responderChamada(id, estado, data, enviar) {
  try {
    if (!KiroPlugins.podeChamar(estado.permissoes, data.metodo)) throw new Error(`Sem permissão para ${data.metodo}.`);
    const valor = await executarMetodo(id, data.metodo, Array.isArray(data.args) ? data.args : []);
    if (JSON.stringify(valor ?? null).length > LIMITE_MENSAGEM) throw new Error('A resposta passou de 2 MB.');
    if (pluginsAtivos.get(id) === estado) enviar({ tipo: 'resposta', chamada: data.chamada, valor: valor ?? null });
  } catch (erro) {
    if (pluginsAtivos.get(id) === estado) enviar({ tipo: 'resposta', chamada: data.chamada, erro: erro.message });
  }
}
```

e em `atenderPlugin` troque o bloco final por
`if (data.tipo === 'chamada') return responderChamada(id, estado, data, m => estado.worker.postMessage(m));`.

Molduras:

```js
// ---- Molduras (etapa 4) ----
// A tela do plug-in roda num iframe sandbox sem allow-same-origin (origem opaca) e com a
// CSP da resposta cortando a rede. O plug-in é achado pela moldura que mandou a mensagem,
// nunca por um id escrito nela.
const urlDaTela = (id, arquivo) => window.cadernoDesktop ? `kiro-plugin://${id}/${arquivo}` : `/plugins/${id}/${arquivo}`;
const dadosDasMolduras = new Map();       // chave da moldura → data passado pelo bloco/painel
const molduraHtml = (id, arquivo, altura, chave) =>
  `<iframe class="plugin-moldura" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${escapeHtml(pluginsAtivos.get(id)?.manifesto?.name || id)}" data-plugin="${escapeHtml(id)}" data-arquivo="${escapeHtml(arquivo)}" data-chave="${escapeHtml(chave)}" style="height:${Number(altura) || KiroPlugins.ALTURA_DA_MOLDURA.padrao}px" src="${escapeHtml(urlDaTela(id, arquivo))}"></iframe>`;
const temaAtual = () => { const css = getComputedStyle(document.documentElement); return Object.fromEntries(KiroPlugins.VARIAVEIS_DO_TEMA.map(v => [v, css.getPropertyValue(v).trim()])); };
const molduraDe = janela => [...document.querySelectorAll('iframe.plugin-moldura')].find(f => f.contentWindow === janela);

window.addEventListener('message', ({ source, data }) => {
  const moldura = source && molduraDe(source);
  if (!moldura || !data || typeof data !== 'object') return;   // só mensagem de uma moldura nossa
  const id = moldura.dataset.plugin, estado = pluginsAtivos.get(id);
  if (!estado) return;
  const enviar = m => moldura.contentWindow?.postMessage(m, '*');
  if (data.tipo === 'pronto') enviar({ tipo: 'ativar', metodos: KiroPlugins.metodosPermitidos(estado.permissoes), data: dadosDasMolduras.get(moldura.dataset.chave) ?? null, tema: temaAtual() });
  else if (data.tipo === 'chamada') responderChamada(id, estado, data, enviar);
  else if (data.tipo === 'altura' && !moldura.closest('.plugin-pagina')) {
    const { min, max } = KiroPlugins.ALTURA_DA_MOLDURA;
    if (Number.isFinite(data.valor)) moldura.style.height = `${Math.min(max, Math.max(min, Math.round(data.valor)))}px`;
  } else if (data.tipo === 'link') {
    let url; try { url = new URL(String(data.url)); } catch { return; }
    // No app, window.open cai no setWindowOpenHandler, que abre http(s) no navegador do sistema.
    if (url.protocol === 'http:' || url.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer');
  }
});
// Troca de aparência: as telas abertas recebem as variáveis novas.
function avisarTemaAsMolduras() {
  const tema = temaAtual();
  for (const f of document.querySelectorAll('iframe.plugin-moldura')) f.contentWindow?.postMessage({ tipo: 'tema', tema }, '*');
}
```

Em `gravarAparencia` (≈2564), depois de `aplicarAparencia(a);` acrescente `avisarTemaAsMolduras();`.

Bloco — `htmlDoBloco(valor)` passa a receber `id` e `chave`; a chamada em `desenharBlocosDosPlugins` vira `htmlDoBloco(valor, id, chave)`:

```js
function htmlDoBloco(valor, id, chave) {
  if (valor && typeof valor.frame === 'string') {
    const m = KiroPlugins.validarMoldura(valor);
    if (!m.ok) return avisoDeBloco(m.erro);
    dadosDasMolduras.set(chave, m.data);
    // ponytail: redesenhar a nota recria a moldura (a tela recarrega); guardar o iframe vivo se algum plug-in precisar de estado.
    return molduraHtml(id, m.frame, m.height, chave);
  }
  …(resto igual)
}
```

Quando `conteudoDosBlocos` descarta uma chave (limite de 200) ou `desativarPlugin` limpa as do plug-in, apague também de `dadosDasMolduras` as mesmas chaves.

Painel — em `guardarPainel(id, painel, dados)`:

```js
function guardarPainel(id, painel, dados) {
  const chave = chaveDoPainel(id, painel);
  const alvo = document.querySelector(`${seletorDoPainel(id, painel)} .plugin-conteudo`);
  if (dados && typeof dados.frame === 'string') {
    const m = KiroPlugins.validarMoldura(dados);
    if (!m.ok) return guardarPainel(id, painel, { type: 'text', text: m.erro });
    dadosDasMolduras.set(chave, m.data);
    const viva = alvo?.querySelector(':scope > iframe.plugin-moldura');
    // Mesmo arquivo: a tela continua viva e só recebe os dados novos.
    if (viva && viva.dataset.arquivo === m.frame) { viva.contentWindow?.postMessage({ tipo: 'dados', data: m.data }, '*'); return; }
    conteudoDosPaineis.set(chave, molduraHtml(id, m.frame, m.height, chave));
  } else conteudoDosPaineis.set(chave, KiroPlugins.painelParaHtml(dados, { pluginId: id }));
  if (alvo) alvo.innerHTML = conteudoDosPaineis.get(chave);
}
```

`desativarPlugin`: além do que já faz, `for (const f of document.querySelectorAll(\`iframe.plugin-moldura[data-plugin="${CSS.escape(id)}"]\`)) f.remove();` e apague de `dadosDasMolduras` as chaves que começam com `${id}\n`.

`styles.css`:

```css
.plugin-moldura { display: block; width: 100%; border: 0; border-radius: var(--raio, 10px); background: transparent; color-scheme: normal; }
```

- [ ] **Step 2: Run** `node --test` → PASS (nada quebrou).
- [ ] **Step 3: Verificar no navegador** (`preview_start` `kiro-dev`, cofre de exemplo). Crie em `dev-vault/.kiro/plugins/teste-moldura/` (NÃO em `examples/`; apague ao fim) um plug-in `notes:read` cujo bloco devolve `{ frame: 'ataque.html', data: { oi: 1 }, height: 300 }` e cujo `ataque.html` + `ataque.js` fazem, depois de `await kiro.ready`, e escrevem o resultado de cada um num `<pre>` e por `kiro.notify`:
  - `fetch('/api/state')`, `fetch('https://api.github.com/zen')` → devem falhar;
  - `parent.document`, `top.location.href = 'https://example.com'`, `localStorage.length`, `document.cookie`, `window.open('https://example.com')`, `typeof RTCPeerConnection` → erro / `undefined` / sem efeito;
  - `new Image().src = 'https://example.com/x.png'` → bloqueado (conferir console: violação de CSP);
  - `location.href = 'https://example.com'` (navegar a própria moldura) → bloqueado pelo `frame-src`;
  - `kiro.notes.list()` → funciona; `kiro.tasks` → `undefined`;
  - `parent.postMessage({ tipo: 'chamada', chamada: 99, metodo: 'tasks.list', args: [] }, '*')` → resposta com erro "Sem permissão";
  - `kiro.data` → `{ oi: 1 }`; `kiro.resize(500)` → moldura com 500 px;
  - trocar o tema em Configurações → `getComputedStyle(document.documentElement).getPropertyValue('--acento')` muda na tela.
  Use `read_console_messages` e `javascript_tool` na página para conferir. Registre os resultados no relatório da tarefa.
- [ ] **Step 4: Commit** — `git commit -m "Plug-ins: telas isoladas em blocos e painéis"`.

---

### Task 4: Página cheia e item na barra lateral

**Files:**
- Modify: `index.html:20-26` (depois de `</nav>`)
- Modify: `app.js` — `render()` (~25–38), `ativarPlugin`/`desativarPlugin`/`atenderPlugin`, `pedirConsentimento` (~2701), `irPara` (~591)
- Modify: `styles.css`

**Interfaces:**
- Consumes (Task 3): `molduraHtml`, `urlDaTela`, `dadosDasMolduras`.
- Produces: view `plugin:<id>`; `desenharNavDosPlugins()`; `renderPaginaDoPlugin(id)`.

- [ ] **Step 1: Implement.**

`index.html`, logo após `</nav>`:

```html
        <nav id="nav-plugins" class="nav-plugins" aria-label="Plug-ins" hidden></nav>
```

`app.js`:

```js
// Plug-ins com `page` no manifesto ganham um item no grupo "Plug-ins" da barra lateral.
function desenharNavDosPlugins() {
  const nav = document.querySelector('#nav-plugins');
  if (!nav) return;
  const comPagina = [...pluginsAtivos].filter(([, e]) => e.manifesto?.page);
  nav.hidden = !comPagina.length;
  nav.innerHTML = comPagina.length ? `<p class="nav-grupo">Plug-ins</p>${comPagina.map(([id, e]) =>
    `<button class="nav-item${currentView === `plugin:${id}` ? ' active' : ''}" data-view="plugin:${escapeHtml(id)}"><span class="rotulo-icone" data-icone="plugin"></span> ${escapeHtml(e.manifesto.page.title)}</button>`).join('')}` : '';
  for (const b of nav.querySelectorAll('.nav-item')) b.onclick = () => { if (loaded) irPara(b.dataset.view); };
  // os ícones da barra lateral são preenchidos por quem trata [data-icone]; chame a mesma função aqui.
}
function renderPaginaDoPlugin(id) {
  const estado = pluginsAtivos.get(id), page = estado?.manifesto?.page;
  if (!page) return `<div class="empty">Este plug-in não está ativo.</div>`;
  const chave = `${id}\npage`;
  dadosDasMolduras.set(chave, null);
  return `<section class="plugin-pagina" data-plugin="${escapeHtml(id)}">${molduraHtml(id, page.file, 0, chave)}</section>`;
}
```

Procure como os `[data-icone]` do `index.html` viram SVG (função que usa `TRACOS`) e chame-a em `desenharNavDosPlugins` para o ícone `plugin` aparecer.

Em `render()`:

```js
  const paginaDoPlugin = currentView.startsWith('plugin:') ? currentView.slice(7) : null;
  if (paginaDoPlugin && !pluginsAtivos.get(paginaDoPlugin)?.manifesto?.page) currentView = 'today';
  document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x.dataset.view === currentView));
  …
  // A página cheia do plug-in não é recriada a cada redesenho: a tela guarda estado próprio.
  const viva = paginaDoPlugin && app.querySelector(`:scope > .plugin-pagina[data-plugin="${CSS.escape(paginaDoPlugin)}"]`);
  if (!viva) app.innerHTML = paginaDoPlugin ? renderPaginaDoPlugin(paginaDoPlugin) : views[currentView]();
```

(mantenha o resto de `render()`; garanta que `bindView()` não quebra quando a view é `plugin:<id>` — se ele despacha por `currentView`, não faça nada para `plugin:`). Adicione a classe `pagina-plugin-aberta` no `.app-shell` quando `paginaDoPlugin` for verdade, para o CSS dar a altura cheia.

Chame `desenharNavDosPlugins()` no fim de `atenderPlugin` quando `data.tipo === 'pronto'`, e em `desativarPlugin` (depois de `pluginsAtivos.delete(id)`); em `desativarPlugin`, se `currentView === \`plugin:${id}\``, faça `currentView = 'today'` e `if (loaded) render()`.

Consentimento — em `pedirConsentimento`, depois de `${itensDeChaves(m, segredosNovos)}`:

```js
    ${m.page ? `<p class="small-muted plugin-tela-propria">Tem uma tela própria (“${escapeHtml(m.page.title)}”), que aparece na barra lateral.</p>` : ''}
```

`styles.css`:

```css
.nav-plugins { margin-top: 12px; display: grid; gap: 2px; }
.nav-plugins .nav-grupo { margin: 0 0 4px 12px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.plugin-pagina { height: 100%; min-height: calc(100vh - 48px); display: flex; }
.plugin-pagina .plugin-moldura { flex: 1; height: auto !important; border-radius: 0; }
.app-shell.pagina-plugin-aberta #app { padding: 0; }
```

(ajuste seletores ao que existe em `styles.css` para `#app`/`.app-shell`; o objetivo é a moldura ocupar a área de conteúdo inteira.)

- [ ] **Step 2: Run** `node --test` → PASS.
- [ ] **Step 3: Verificar no navegador:** com um plug-in de teste em `dev-vault` declarando `page`, o grupo "Plug-ins" aparece com o item; clicar abre a tela cheia; salvar uma nota em outra aba do app e voltar não recarrega a tela (um contador na tela não zera enquanto a página está aberta e o app redesenha: dispare `render()` pelo `javascript_tool` e confira); desativar o plug-in em Configurações remove o item e volta para Hoje; o modal de ativação mostra a linha "Tem uma tela própria". Screenshot da tela cheia.
- [ ] **Step 4: Commit** — `git commit -m "Plug-ins: página cheia do plug-in na barra lateral"`.

---

### Task 5: Exemplo `habit-heatmap`, documentação e verificação final

**Files:**
- Create: `examples/plugins/habit-heatmap/manifest.json`, `index.js`, `heatmap.html`, `heatmap.js`
- Modify: `docs/plugins.md` (seção nova "Frames (custom UI)"; remover "Stage 4 — isolated frames" de "Not available yet" — se a seção ficar vazia, remova-a)
- Modify: `docs/KIRO-resumo-para-IA.md` (Plug-ins: parágrafo da etapa 4; trocar "fica para a etapa 4 só as molduras isoladas" pelo que existe agora)
- Test: `tests/plugins-molduras.test.cjs`

- [ ] **Step 1: Write the failing test:**

```js
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
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`manifest.json`:

```json
{
  "id": "habit-heatmap",
  "name": "Habit Heatmap",
  "version": "1.0.0",
  "author": "Kiro",
  "description": "Draws a heatmap of your habits, inside a note and on its own page.",
  "minKiro": "0.14.0",
  "permissions": ["habits:read"],
  "network": [],
  "page": { "title": "Habit Heatmap", "file": "heatmap.html" }
}
```

`index.js` (roda no worker):

```js
// ```kiro:habit-heatmap
// 12
// ```
// draws the last N weeks (default 12) in a frame. The same heatmap.html is the plugin page.
export default {
  activate(kiro) {
    kiro.block(source => {
      const semanas = Math.min(52, Math.max(1, parseInt(source, 10) || 12));
      return { frame: 'heatmap.html', data: { weeks: semanas }, height: 60 + 18 * 7 };
    });
  },
};
```

`heatmap.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 12px; background: transparent; color: var(--ink); font: 13px var(--fonte-interface, system-ui); }
    .grade { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 14px); gap: 4px; }
    .dia { width: 14px; height: 14px; border-radius: 3px; background: var(--panel-raised); }
    .dia[data-n="1"] { background: color-mix(in srgb, var(--acento) 35%, transparent); }
    .dia[data-n="2"] { background: color-mix(in srgb, var(--acento) 65%, transparent); }
    .dia[data-n="3"] { background: var(--acento); }
    #dica { min-height: 18px; margin-top: 8px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="grade" id="grade" role="img" aria-label="Habit heatmap"></div>
  <div id="dica"></div>
  <script src="heatmap.js"></script>
</body>
</html>
```

`heatmap.js` (roda na moldura):

```js
const grade = document.getElementById('grade');
const dica = document.getElementById('dica');
const iso = d => d.toISOString().slice(0, 10);

async function desenhar(semanas) {
  const habitos = await kiro.habits.list();
  const feitos = new Map();
  for (const h of habitos) for (const dia of h.days) feitos.set(dia, (feitos.get(dia) || 0) + 1);
  const total = habitos.length || 1;
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(hoje.getDate() - (semanas * 7 - 1) - hoje.getDay());
  grade.textContent = '';
  for (let d = new Date(inicio); d <= hoje; d.setDate(d.getDate() + 1)) {
    const dia = iso(d), n = feitos.get(dia) || 0;
    const celula = document.createElement('div');
    celula.className = 'dia';
    celula.dataset.n = String(n ? Math.min(3, Math.ceil((n / total) * 3)) : 0);
    celula.addEventListener('mouseenter', () => { dica.textContent = `${dia}: ${n} of ${habitos.length} habits`; });
    grade.append(celula);
  }
}

kiro.ready.then(k => {
  desenhar(k.data?.weeks || 26).catch(erro => { dica.textContent = erro.message; });
  k.onData(data => desenhar(data?.weeks || 26));
});
```

`docs/plugins.md` — nova seção "Frames (custom UI)" em inglês cobrindo: quando usar (interação/desenho livre; para listas e tabelas prefira painéis e blocos declarativos); retornar `{ frame, data, height }` de `kiro.block`/`kiro.panel`; `"page": { "title", "file" }` e o item "Plug-ins" na barra lateral; o que a tela pode (`kiro.ready`, a mesma API conforme as permissões, `kiro.data`, `kiro.onData`, `kiro.resize` 40–2000 px, `kiro.openLink` só http/https) e o que não pode (sem rede direta — use `kiro.fetch`; sem script inline; sem `localStorage`/cookies — use `kiro.storage`; sem formulário enviado, pop-up ou navegação; sem WebRTC); variáveis de tema disponíveis (`var(--acento)` etc., lista de `VARIAVEIS_DO_TEMA`); o exemplo `habit-heatmap`; a nota de que redesenhar a nota recarrega a tela do bloco.

- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Verificação final no navegador** (`kiro-dev`; o `dev/seed.cjs` copia `examples/plugins/*` para `dev-vault` só quando vazio — copie `examples/plugins/habit-heatmap` para `dev-vault/.kiro/plugins/` manualmente se preciso e ative em Configurações): bloco ```` ```kiro:habit-heatmap ```` numa nota de teste do `dev-vault` desenha o mapa com hover; o item "Habit Heatmap" na lateral abre a página; trocar o tema muda as cores na hora; console sem erros. Apague o plug-in `teste-moldura` e qualquer nota de teste criados. Screenshot.
- [ ] **Step 6: Commit** — `git commit -m "Plug-ins: exemplo habit-heatmap e documentação das telas"`.
