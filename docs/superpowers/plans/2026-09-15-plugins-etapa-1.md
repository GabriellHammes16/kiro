# Sistema de plug-ins do Kiro — etapa 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carregar plug-ins de terceiros do cofre, isolados num worker, com permissões declaradas e consentimento, oferecendo comandos, avisos e painéis declarativos.

**Architecture:** O código do plug-in roda num Web Worker do Kiro (`plugin-worker.js`), que importa o `index.js` do plug-in por uma rota controlada pelo app e conversa com a página por mensagens. A parte pura (validação, permissões, painel, escape) fica em `plugins.js`, testável no Node como o `domain.js`. O acesso ao cofre reaproveita o estado e as funções que o `app.js` já usa.

**Tech Stack:** JavaScript puro, sem build e sem dependência nova. Node `node --test` para os testes. Electron 44 e o servidor local do projeto.

**Spec:** `docs/superpowers/specs/2026-09-15-plugins-design.md`

## Global Constraints

- Sem framework, sem TypeScript, sem etapa de build, sem dependência nova.
- API pública do plug-in em inglês; código interno, comentários e interface do Kiro em português do Brasil.
- Nunca criar operação genérica: nada de ler arquivo por caminho livre, escrever arquivo por caminho livre ou executar comando.
- Testes só em cofre temporário (`fs.mkdtemp`); nunca tocar `C:\Projetos\Meu segundo cerebro\vault` nem `%USERPROFILE%\Documents\KUROI\vault`.
- Nada de `confirm()` ou `alert()` nativos: confirmação é modal do próprio app.
- Permissões válidas, exatamente estas: `notes:read`, `notes:write`, `tasks:read`, `tasks:write`, `habits:read`, `habits:write`, `folders:write`, `network`.
- Pasta dos plug-ins: `.kiro/plugins/<id>/`, com `manifest.json` e `index.js`. Escolhas do usuário em `.kiro/plugins.json`.
- Limites: ativação 3 s, chamada 5 s, mensagem 2 MB, `storage` 1 MB por plug-in.
- Arquivos com CRLF: use as ferramentas Edit/Write, nunca heredoc do Bash.
- Commit a cada tarefa; nunca `git push`.

---

### Task 1: Parte pura dos plug-ins (`plugins.js`)

**Files:**
- Create: `plugins.js`
- Create: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: nada.
- Produces: `globalThis.KiroPlugins` no navegador e `module.exports` no Node, com
  `PERMISSOES` (array), `validarManifesto(bruto, { versaoDoKiro })` → `{ ok: true, manifesto }` ou `{ ok: false, erro }`,
  `comparar(concedidas, pedidas)` → `{ novas: [], removidas: [] }`,
  `precisaConsentir(registro, manifesto)` → boolean,
  `rotuloDaPermissao(nome)` → string em português.

- [ ] **Step 1: Write the failing test**

```js
// tests/plugins.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../plugins.js');

const base = { id: 'word-count', name: 'Word Count', version: '1.0.0', author: 'fulano', minKiro: '0.15.0', permissions: ['notes:read'], network: [] };
const validar = (mudanca = {}) => P.validarManifesto({ ...base, ...mudanca }, { versaoDoKiro: '0.15.0' });

test('manifesto válido é aceito e normalizado', () => {
  const r = validar();
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifesto.permissions, ['notes:read']);
  assert.deepEqual(r.manifesto.network, []);
});

test('manifesto inválido é recusado com motivo', () => {
  assert.match(validar({ id: 'Word Count' }).erro, /id/i);
  assert.match(validar({ version: '1' }).erro, /versão|version/i);
  assert.match(validar({ permissions: ['disk:read'] }).erro, /permiss/i);
  assert.match(validar({ minKiro: '9.0.0' }).erro, /Kiro/i);
  assert.match(validar({ network: ['*.exemplo.com'] }).erro, /endereço|host/i);
  assert.match(validar({ network: ['http://exemplo.com'] }).erro, /https/i);
  assert.match(P.validarManifesto('nada', { versaoDoKiro: '0.15.0' }).erro, /manifesto/i);
});

test('consentimento só é pedido quando o plug-in passa a pedir mais', () => {
  const registro = { enabled: true, permissions: ['notes:read'], network: [] };
  assert.equal(P.precisaConsentir(registro, base), false);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: ['notes:read', 'notes:write'] }), true);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: [] }), false);
  assert.equal(P.precisaConsentir(registro, { ...base, network: ['api.exemplo.com'] }), true);
});

test('rótulo de permissão sai em português', () => {
  assert.match(P.rotuloDaPermissao('notes:write'), /notas/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `Cannot find module '../plugins.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins.js — parte pura do sistema de plug-ins: validação, permissões e
// montagem de painel. Roda no navegador e no Node, como o domain.js.
(function (root) {
  const PERMISSOES = ['notes:read', 'notes:write', 'tasks:read', 'tasks:write', 'habits:read', 'habits:write', 'folders:write', 'network'];
  const ROTULOS = {
    'notes:read': 'ler suas notas', 'notes:write': 'criar e alterar notas',
    'tasks:read': 'ver suas tarefas', 'tasks:write': 'criar e alterar tarefas',
    'habits:read': 'ver seus hábitos', 'habits:write': 'criar e alterar hábitos',
    'folders:write': 'criar e renomear pastas', network: 'acessar a internet',
  };
  const texto = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const versao = v => typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
  const partes = v => v.split('.').map(Number);
  // Compara versões no formato maior.menor.correcao: -1, 0 ou 1.
  function compararVersoes(a, b) {
    const [x, y] = [partes(a), partes(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  const lista = v => Array.isArray(v) ? v : [];
  // Host exato, sem curinga e sem caminho: "api.exemplo.com".
  const hostValido = v => typeof v === 'string' && /^[a-z0-9.-]{3,253}$/i.test(v) && !v.includes('*') && v.includes('.');

  function validarManifesto(bruto, { versaoDoKiro } = {}) {
    const recusa = erro => ({ ok: false, erro });
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return recusa('O manifesto precisa ser um objeto JSON.');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(bruto.id || '')) return recusa('O campo id deve ter de 2 a 40 caracteres, em minúsculas, números e hífen.');
    for (const campo of ['name', 'author']) if (!texto(bruto[campo], 200)) return recusa(`O campo ${campo} é obrigatório e vai até 200 caracteres.`);
    if (bruto.description !== undefined && !texto(bruto.description, 200)) return recusa('A descrição vai até 200 caracteres.');
    if (!versao(bruto.version)) return recusa('A versão deve ser no formato 1.0.0.');
    if (!versao(bruto.minKiro)) return recusa('O campo minKiro deve ser no formato 1.0.0.');
    if (versaoDoKiro && compararVersoes(bruto.minKiro, versaoDoKiro) > 0) return recusa(`Este plug-in precisa do Kiro ${bruto.minKiro} ou mais novo.`);
    const permissions = lista(bruto.permissions);
    const estranha = permissions.find(p => !PERMISSOES.includes(p));
    if (estranha) return recusa(`Permissão desconhecida: ${estranha}.`);
    const network = lista(bruto.network);
    const ruim = network.find(h => !hostValido(h));
    if (ruim !== undefined) return recusa(`Endereço de rede inválido: ${ruim}. Use o host exato, como api.exemplo.com.`);
    if (typeof bruto.network === 'string' && /^https?:/.test(bruto.network)) return recusa('Use só o host, sem https://.');
    if (network.some(h => /^https?:/i.test(h))) return recusa('Use só o host, sem https://.');
    if (network.length && !permissions.includes('network')) return recusa('Para usar rede, declare a permissão network.');
    return { ok: true, manifesto: { id: bruto.id, name: bruto.name, author: bruto.author, description: bruto.description || '', version: bruto.version, minKiro: bruto.minKiro, permissions, network } };
  }

  const comparar = (concedidas, pedidas) => ({
    novas: lista(pedidas).filter(p => !lista(concedidas).includes(p)),
    removidas: lista(concedidas).filter(p => !lista(pedidas).includes(p)),
  });
  // Só pergunta de novo quando o plug-in passou a pedir mais do que já tinha.
  const precisaConsentir = (registro, manifesto) =>
    comparar(registro?.permissions, manifesto.permissions).novas.length > 0 ||
    comparar(registro?.network, manifesto.network).novas.length > 0;
  const rotuloDaPermissao = nome => ROTULOS[nome] || nome;

  const api = { PERMISSOES, validarManifesto, compararVersoes, comparar, precisaConsentir, rotuloDaPermissao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroPlugins = api;
})(globalThis);
```

Detalhe do teste `http://exemplo.com`: `hostValido` recusa por causa do `/` e dos `:`; a mensagem cita `https` na checagem seguinte. Ajuste a ordem se a mensagem sair diferente do que o teste espera.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add plugins.js tests/plugins.test.cjs
git commit -m "Plug-ins: validação de manifesto e permissões"
```

---

### Task 2: Leitura dos plug-ins no cofre (`vault.cjs`)

**Files:**
- Modify: `vault.cjs` (perto de `readAttachment`, linha ~303)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `Vault#safePath`, `atomicWrite`, `pathExists` do próprio `vault.cjs`.
- Produces: `Vault#listPlugins()` → `Promise<[{ id, manifesto|erro }]>`;
  `Vault#readPluginFile(id, arquivo)` → `Promise<Buffer>` só para `.js`;
  `Vault#readPluginChoices()` → `Promise<object>`; `Vault#writePluginChoices(obj)` → `Promise<object>`;
  `Vault#readPluginData(id)` / `Vault#writePluginData(id, obj)` para `kiro.storage`.

- [ ] **Step 1: Write the failing test**

```js
// acrescente em tests/plugins.test.cjs
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');

async function cofreTemporario() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-plugins-'));
  const plugin = path.join(dir, '.kiro', 'plugins', 'word-count');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'manifest.json'), JSON.stringify(base));
  await fs.writeFile(path.join(plugin, 'index.js'), 'export default { async activate() {} };');
  return { dir, vault: new Vault(dir) };
}

test('o cofre lista plug-ins e serve só arquivos .js', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.equal(encontrados[0].id, 'word-count');
    assert.equal(encontrados[0].manifesto.name, 'Word Count');

    const codigo = await vault.readPluginFile('word-count', 'index.js');
    assert.match(codigo.toString('utf8'), /activate/);

    await assert.rejects(() => vault.readPluginFile('word-count', 'manifest.json'), /js/i);
    await assert.rejects(() => vault.readPluginFile('word-count', '../../caderno.json'), /inválido|Caminho/i);
    await assert.rejects(() => vault.readPluginFile('../outro', 'index.js'), /inválido|Caminho/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('escolhas do usuário vão e voltam de plugins.json', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    assert.deepEqual(await vault.readPluginChoices(), {});
    await vault.writePluginChoices({ 'word-count': { enabled: true, permissions: ['notes:read'], network: [] } });
    assert.equal((await vault.readPluginChoices())['word-count'].enabled, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('manifesto quebrado aparece como erro, sem derrubar a lista', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    await fs.writeFile(path.join(dir, '.kiro', 'plugins', 'word-count', 'manifest.json'), '{ isso não é json');
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.ok(encontrados[0].erro);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `vault.listPlugins is not a function`.

- [ ] **Step 3: Write minimal implementation**

Acrescente ao `vault.cjs`, logo depois de `readAttachment`, e lembre que `.kiro` já é
área interna (o `scan()` ignora entradas ocultas na raiz):

```js
  /** Plug-ins ficam em <cofre>/.kiro/plugins/<id>/. Só o que está nessa pasta é servido. */
  pluginPath(id, arquivo = '') {
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id || '')) throw new Error('Identificador de plug-in inválido.');
    if (arquivo && !/^[a-z0-9][a-z0-9._-]{0,60}$/i.test(arquivo)) throw new Error('Caminho de plug-in inválido.');
    return path.join(this.directory, '.kiro', 'plugins', id, arquivo);
  }
  async listPlugins() {
    const raiz = path.join(this.directory, '.kiro', 'plugins');
    let entradas = [];
    try { entradas = await fs.readdir(raiz, { withFileTypes: true }); } catch (erro) { if (erro.code === 'ENOENT') return []; throw erro; }
    const achados = [];
    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entrada.isDirectory()) continue;
      try {
        const bruto = await fs.readFile(this.pluginPath(entrada.name, 'manifest.json'), 'utf8');
        achados.push({ id: entrada.name, manifesto: JSON.parse(bruto) });
      } catch (erro) {
        achados.push({ id: entrada.name, erro: erro instanceof SyntaxError ? 'manifest.json não é um JSON válido.' : erro.message });
      }
    }
    return achados;
  }
  /** Só código: o worker do Kiro importa .js e mais nada. */
  async readPluginFile(id, arquivo) {
    if (!/\.js$/i.test(arquivo || '')) throw new Error('Só arquivos .js de plug-in são servidos.');
    const alvo = this.pluginPath(id, arquivo);
    const info = await fs.stat(alvo);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Arquivo de plug-in inválido.');
    return fs.readFile(alvo);
  }
  async readPluginChoices() {
    const bruto = await optionalRead(path.join(this.directory, '.kiro', 'plugins.json'));
    try { const dado = JSON.parse(bruto || '{}'); return dado && typeof dado === 'object' && !Array.isArray(dado) ? dado : {}; }
    catch { return {}; }
  }
  async writePluginChoices(escolhas) {
    await atomicWrite(path.join(this.directory, '.kiro', 'plugins.json'), `${JSON.stringify(escolhas, null, 2)}\n`);
    return escolhas;
  }
  /** Espaço do próprio plug-in (kiro.storage), com teto de 1 MB. */
  async readPluginData(id) {
    const bruto = await optionalRead(this.pluginPath(id, 'data.json'));
    try { return JSON.parse(bruto || '{}'); } catch { return {}; }
  }
  async writePluginData(id, dados) {
    const texto = `${JSON.stringify(dados, null, 2)}\n`;
    if (Buffer.byteLength(texto) > 1024 * 1024) throw new Error('O plug-in passou de 1 MB de dados guardados.');
    await atomicWrite(this.pluginPath(id, 'data.json'), texto);
    return dados;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add vault.cjs tests/plugins.test.cjs
git commit -m "Plug-ins: leitura da pasta do cofre e escolhas do usuário"
```

---

### Task 3: Rota que entrega o código do plug-in

**Files:**
- Modify: `server.mjs` (perto de `publicFiles`, linha ~18, e do roteamento, linha ~86)
- Modify: `electron/main.cjs` (perto de `protocol.registerSchemesAsPrivileged`, linha 10, e de `protocol.handle('kiro-anexo')`, linha ~47)
- Modify: `index.html` (meta CSP, linha 6)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `Vault#readPluginFile` da Task 2.
- Produces: no app instalado, `kiro-plugin://<id>/<arquivo>.js`; na web, `GET /plugins/<id>/<arquivo>.js`.
  Ambos respondem com `Content-Type: text/javascript`, `X-Content-Type-Options: nosniff` e
  `Content-Security-Policy: default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'`.

- [ ] **Step 1: Write the failing test**

```js
// acrescente em tests/plugins.test.cjs
const { spawn } = require('node:child_process');

async function servidorTemporario() {
  const { dir } = await cofreTemporario();
  const porta = 4300 + Math.floor(Math.random() * 500);
  const filho = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(porta), KIRO_VAULT: dir },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${porta}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  return { porta, dir, parar: async () => { filho.kill(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('a rota serve o código do plug-in com os cabeçalhos de segurança', async () => {
  const s = await servidorTemporario();
  try {
    const ok = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/index.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    assert.match(ok.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');

    const json = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/manifest.json`);
    assert.equal(json.status, 404);
    const fuga = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/..%2F..%2Fcaderno.json`);
    assert.equal(fuga.status, 404);
  } finally { await s.parar(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL — a rota devolve 404 e o `content-type` não bate.

- [ ] **Step 3: Write minimal implementation**

No `server.mjs`, antes da linha `const file = publicFiles[rota];`:

```js
    // Código de plug-in: só .js de dentro de .kiro/plugins, com a rede do worker cortada.
    if (rota.startsWith('/plugins/')) {
      const partes = rota.slice('/plugins/'.length).split('/');
      if (request.method !== 'GET' || partes.length !== 2) return send(response, 404, { error: 'Não encontrado.' });
      try {
        const corpo = await vault.readPluginFile(decodeURIComponent(partes[0]), decodeURIComponent(partes[1]));
        response.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'",
          'Cache-Control': 'no-cache',
        });
        return response.end(corpo);
      } catch { return send(response, 404, { error: 'Plug-in não encontrado.' }); }
    }
```

No `electron/main.cjs`, acrescente o esquema na linha 10:

```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'kiro-anexo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'kiro-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
```

e, ao lado do `protocol.handle('kiro-anexo', …)`:

```js
  // <id> é o host da URL: kiro-plugin://word-count/index.js
  protocol.handle('kiro-plugin', async request => {
    try {
      const url = new URL(request.url);
      const arquivo = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const corpo = await vault.readPluginFile(url.hostname, arquivo);
      return new Response(corpo, { headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'",
      } });
    } catch { return new Response('Plug-in não encontrado.', { status: 404 }); }
  });
```

No `index.html`, a CSP passa a permitir o worker:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self' blob: kiro-plugin:; style-src 'self' 'unsafe-inline'; img-src 'self' data: kiro-anexo:; object-src 'none'; base-uri 'none'" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs`
Expected: PASS, 8 testes. Rode `node --test` inteiro: os 76 antigos continuam passando.

- [ ] **Step 5: Commit**

```bash
git add server.mjs electron/main.cjs index.html tests/plugins.test.cjs
git commit -m "Plug-ins: rota do código com CSP que corta a rede do worker"
```

---

### Task 4: O worker e a ponte de mensagens

**Files:**
- Create: `plugin-worker.js`
- Modify: `plugins.js` (acrescentar o desenho da ponte)
- Modify: `server.mjs` (`publicFiles`: servir `plugins.js` e `plugin-worker.js`)
- Modify: `index.html` (carregar `plugins.js` antes do `app.js`)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `PERMISSOES` da Task 1; a rota da Task 3.
- Produces: em `plugins.js`, `metodosPermitidos(permissoes)` → lista de nomes de método liberados,
  `podeChamar(permissoes, metodo)` → boolean. No worker, o protocolo de mensagens:
  página → worker `{ tipo: 'ativar', id, url, permissoes }`, `{ tipo: 'resposta', chamada, valor|erro }`, `{ tipo: 'acao', registro, dados }`;
  worker → página `{ tipo: 'pronto', registros }`, `{ tipo: 'chamada', chamada, metodo, args }`, `{ tipo: 'erro', mensagem }`.

- [ ] **Step 1: Write the failing test**

```js
// acrescente em tests/plugins.test.cjs
test('a API entregue ao plug-in respeita as permissões', () => {
  const soLeitura = P.metodosPermitidos(['notes:read']);
  assert.ok(soLeitura.includes('notes.list'));
  assert.ok(!soLeitura.includes('notes.create'));
  assert.ok(soLeitura.includes('storage.get'), 'storage não depende de permissão');

  assert.equal(P.podeChamar(['notes:read'], 'notes.create'), false);
  assert.equal(P.podeChamar(['notes:read', 'notes:write'], 'notes.create'), true);
  assert.equal(P.podeChamar(['notes:read'], 'fs.readFile'), false, 'método fora da lista nunca passa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `P.metodosPermitidos is not a function`.

- [ ] **Step 3: Write minimal implementation**

Em `plugins.js`, antes do objeto `api`:

```js
  // Cada método da API pede uma permissão; storage e interface não pedem nada.
  const METODOS = {
    'notes.list': 'notes:read', 'notes.get': 'notes:read', 'notes.current': 'notes:read', 'notes.search': 'notes:read',
    'notes.create': 'notes:write', 'notes.update': 'notes:write', 'notes.trash': 'notes:write', 'notes.move': 'notes:write',
    'tasks.list': 'tasks:read', 'tasks.create': 'tasks:write', 'tasks.update': 'tasks:write',
    'habits.list': 'habits:read', 'habits.mark': 'habits:write',
    'folders.create': 'folders:write',
    'storage.get': '', 'storage.set': '', 'notify': '',
  };
  const metodosPermitidos = permissoes => Object.keys(METODOS).filter(m => !METODOS[m] || (permissoes || []).includes(METODOS[m]));
  const podeChamar = (permissoes, metodo) => Object.prototype.hasOwnProperty.call(METODOS, metodo) && (!METODOS[metodo] || (permissoes || []).includes(METODOS[metodo]));
```

e acrescente `METODOS, metodosPermitidos, podeChamar` ao objeto `api`.

`plugin-worker.js` (código do Kiro, não do plug-in):

```js
// Worker de plug-in: importa o código de terceiro, monta o objeto `kiro` conforme
// as permissões concedidas e conversa com a página só por mensagem. Sem DOM, sem
// disco e sem rede — a rede é cortada pela CSP da resposta que serve este arquivo.
importScripts('plugins.js');
const { metodosPermitidos } = globalThis.KiroPlugins;
let pendentes = new Map(), proxima = 1, registros = { command: new Map(), panel: new Map() };

function chamar(metodo, args) {
  const chamada = proxima++;
  postMessage({ tipo: 'chamada', chamada, metodo, args });
  return new Promise((resolve, reject) => pendentes.set(chamada, { resolve, reject }));
}
function montarApi(permissoes) {
  const kiro = {
    command: (id, label, handler) => { registros.command.set(id, handler); },
    panel: (id, label, render) => { registros.panel.set(id, render); },
  };
  for (const metodo of metodosPermitidos(permissoes)) {
    const [grupo, nome] = metodo.includes('.') ? metodo.split('.') : [null, metodo];
    const fn = (...args) => chamar(metodo, args);
    if (!grupo) kiro[nome] = fn;
    else (kiro[grupo] = kiro[grupo] || {})[nome] = fn;
  }
  return kiro;
}
onmessage = async ({ data }) => {
  try {
    if (data.tipo === 'ativar') {
      const modulo = await import(data.url);
      const plugin = modulo.default || modulo;
      if (typeof plugin.activate !== 'function') throw new Error('O plug-in precisa exportar activate(kiro).');
      await plugin.activate(montarApi(data.permissoes));
      postMessage({ tipo: 'pronto', registros: {
        command: [...registros.command.keys()], panel: [...registros.panel.keys()],
      } });
    } else if (data.tipo === 'resposta') {
      const pendente = pendentes.get(data.chamada);
      pendentes.delete(data.chamada);
      if (pendente) data.erro ? pendente.reject(new Error(data.erro)) : pendente.resolve(data.valor);
    } else if (data.tipo === 'acao') {
      const alvo = registros[data.registro.tipo]?.get(data.registro.id);
      const valor = alvo ? await alvo(data.dados) : null;
      postMessage({ tipo: 'resposta', chamada: data.chamada, valor });
    }
  } catch (erro) { postMessage({ tipo: 'erro', chamada: data.chamada, mensagem: String(erro && erro.message || erro) }); }
};
```

Observação para quem implementar: `importScripts` só existe em worker clássico. Crie o
worker com `new Worker('plugin-worker.js')` (clássico) e use `import(url)` dinâmico para
o plug-in, que é módulo. Se o ambiente reclamar, troque para worker de módulo
(`{ type: 'module' }`) e importe `plugins.js` com `import`.

Em `server.mjs`, acrescente a `publicFiles`:

```js
  '/plugins.js': ['plugins.js', 'text/javascript'], '/plugin-worker.js': ['plugin-worker.js', 'text/javascript'],
```

Em `index.html`, antes do `app.js`:

```html
    <script src="plugins.js"></script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add plugins.js plugin-worker.js server.mjs index.html tests/plugins.test.cjs
git commit -m "Plug-ins: worker isolado e ponte de mensagens"
```

---

### Task 5: Hospedeiro no `app.js`

**Files:**
- Modify: `app.js` (seção nova antes de `// ---- Aparência ----`, linha ~1990)
- Modify: `electron/preload.cjs` e `server.mjs` conforme a API de dados exigir
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `KiroPlugins.podeChamar`, `Vault#listPlugins`, `Vault#readPluginChoices`, o worker da Task 4.
- Produces: `carregarPlugins()`, `ativarPlugin(id)`, `desativarPlugin(id)`,
  `pluginsAtivos` (Map `id → { manifesto, worker, comandos, paineis, erro }`),
  `chamarPlugin(id, registro, dados)` → Promise.

- [ ] **Step 1: Write the failing test**

O hospedeiro é código de navegador; o que dá para testar no Node é a decisão pura de
quais plug-ins entram. Acrescente em `plugins.js` e teste:

```js
// tests/plugins.test.cjs
test('decide quais plug-ins carregar a partir da pasta e das escolhas', () => {
  const achados = [
    { id: 'word-count', manifesto: base },
    { id: 'quebrado', erro: 'manifest.json não é um JSON válido.' },
    { id: 'pede-mais', manifesto: { ...base, id: 'pede-mais', permissions: ['notes:read', 'notes:write'] } },
  ];
  const escolhas = {
    'word-count': { enabled: true, permissions: ['notes:read'], network: [] },
    'pede-mais': { enabled: true, permissions: ['notes:read'], network: [] },
  };
  const plano = P.planoDeCarga(achados, escolhas, { versaoDoKiro: '0.15.0' });
  assert.deepEqual(plano.carregar.map(p => p.id), ['word-count']);
  assert.equal(plano.pendentes.find(p => p.id === 'pede-mais').motivo, 'permissoes-novas');
  assert.equal(plano.problemas.find(p => p.id === 'quebrado').erro.length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `P.planoDeCarga is not a function`.

- [ ] **Step 3: Write minimal implementation**

Em `plugins.js`:

```js
  /**
   * Decide o que carregar: só plug-in ativado, com manifesto válido e permissões
   * já concedidas. O resto volta como pendente (espera consentimento) ou problema.
   */
  function planoDeCarga(achados, escolhas, { versaoDoKiro } = {}) {
    const plano = { carregar: [], pendentes: [], problemas: [] };
    for (const achado of achados || []) {
      if (achado.erro) { plano.problemas.push({ id: achado.id, erro: achado.erro }); continue; }
      const { ok, manifesto, erro } = validarManifesto(achado.manifesto, { versaoDoKiro });
      if (!ok) { plano.problemas.push({ id: achado.id, erro }); continue; }
      if (manifesto.id !== achado.id) { plano.problemas.push({ id: achado.id, erro: 'O id do manifesto é diferente do nome da pasta.' }); continue; }
      const registro = (escolhas || {})[achado.id];
      if (!registro || !registro.enabled) { plano.pendentes.push({ id: achado.id, manifesto, motivo: 'desligado' }); continue; }
      if (precisaConsentir(registro, manifesto)) { plano.pendentes.push({ id: achado.id, manifesto, motivo: 'permissoes-novas' }); continue; }
      plano.carregar.push({ id: achado.id, manifesto, permissoes: manifesto.permissions });
    }
    return plano;
  }
```

No `app.js`, o hospedeiro (resumo do que implementar, com os limites do contrato):

```js
// ---- Plug-ins ----
// O código de terceiro roda num worker; aqui só atendemos pedidos, sempre
// conferindo a permissão de novo: o worker é território do plug-in.
const pluginsAtivos = new Map();
const LIMITE_ATIVACAO = 3000, LIMITE_CHAMADA = 5000;

async function carregarPlugins() {
  for (const id of [...pluginsAtivos.keys()]) desativarPlugin(id);
  const [achados, escolhas] = await Promise.all([api('plugins'), api('plugin-choices')]);
  const plano = KiroPlugins.planoDeCarga(achados, escolhas, { versaoDoKiro: VERSAO });
  planoDosPlugins = plano;
  for (const alvo of plano.carregar) await ativarPlugin(alvo);
  render();
}

async function ativarPlugin({ id, manifesto, permissoes }) {
  const worker = new Worker('plugin-worker.js');
  // `permissoes` é o que o usuário concedeu, não o que o manifesto pede: é ele que vale na checagem.
  const estado = { manifesto, permissoes, worker, comandos: new Map(), paineis: new Map(), erro: '' };
  pluginsAtivos.set(id, estado);
  worker.onmessage = ({ data }) => atenderPlugin(id, data);
  worker.onerror = erro => falharPlugin(id, erro.message);
  worker.postMessage({ tipo: 'ativar', id, url: urlDoPlugin(id), permissoes });
  estado.prazo = setTimeout(() => falharPlugin(id, 'O plug-in não respondeu na ativação.'), LIMITE_ATIVACAO);
}

async function atenderPlugin(id, data) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  if (data.tipo === 'pronto') { clearTimeout(estado.prazo); guardarRegistros(estado, data.registros); render(); return; }
  if (data.tipo === 'erro') return falharPlugin(id, data.mensagem);
  if (data.tipo !== 'chamada') return;
  try {
    if (!KiroPlugins.podeChamar(estado.permissoes, data.metodo)) throw new Error(`Sem permissão para ${data.metodo}.`);
    const valor = await executarMetodo(id, data.metodo, data.args);
    estado.worker.postMessage({ tipo: 'resposta', chamada: data.chamada, valor });
  } catch (erro) {
    estado.worker.postMessage({ tipo: 'resposta', chamada: data.chamada, erro: erro.message });
  }
}

function desativarPlugin(id) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  clearTimeout(estado.prazo);
  estado.worker.terminate();
  pluginsAtivos.delete(id);
}
function falharPlugin(id, mensagem) {
  const estado = pluginsAtivos.get(id);
  desativarPlugin(id);
  problemasDosPlugins.set(id, mensagem);
  status(`Plug-in ${estado?.manifesto?.name || id}: ${mensagem}`, true);
  render();
}
```

`executarMetodo` traduz cada nome do contrato para o que o app já faz: `notes.list`
devolve `state.notes` mapeado para `{ id, title, body, tags, folder }`; `notes.current`
devolve a nota aberta (`editing`) ou `null`; `notes.create` e `notes.update` passam pelo
mesmo caminho de salvamento que a interface usa; `storage.get`/`storage.set` vão para
`readPluginData`/`writePluginData`. `urlDoPlugin(id)` devolve `kiro-plugin://<id>/index.js`
no Electron e `/plugins/<id>/index.js` na web.

`VERSAO` é a versão do Kiro, usada para comparar com `minKiro`. Ela ainda não existe no
`app.js`: exponha `version` do `package.json` junto das outras rotas (`api('version')` na
web e `cadernoDesktop.version()` no Electron, via `app.getVersion()`), e guarde em
`let VERSAO = '0.0.0'` preenchido no carregamento, antes de `carregarPlugins()`.

No servidor e no preload, exponha `plugins`, `plugin-choices`, `plugin-data` seguindo o
mesmo padrão das rotas e dos `ipcMain.handle` que já existem.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs` — PASS, 10 testes.
Depois, no navegador: `preview_start` com `kiro-dev`, console sem erro e
`pluginsAtivos.size === 0` num cofre sem plug-in.

- [ ] **Step 5: Commit**

```bash
git add plugins.js app.js server.mjs electron/preload.cjs electron/main.cjs tests/plugins.test.cjs
git commit -m "Plug-ins: hospedeiro que carrega, atende e encerra workers"
```

---

### Task 6: Comandos, avisos e painéis declarativos

**Files:**
- Modify: `plugins.js` (montagem do painel)
- Modify: `app.js` (desenhar painel, expor comandos)
- Modify: `styles.css` (estilo do painel de plug-in)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: registros da Task 5.
- Produces: `KiroPlugins.painelParaHtml(dados, { pluginId })` → string HTML com texto escapado;
  no `app.js`, os comandos do plug-in aparecem na paleta (Ctrl+O já existe para notas; use o menu de comandos) e os painéis viram cards na tela Hoje.

- [ ] **Step 1: Write the failing test**

```js
test('painel declarativo vira marcação com o texto escapado', () => {
  const html = P.painelParaHtml({ type: 'list', items: [{ title: '<b>oi</b>', detail: 'x & y', action: 'open:1' }] }, { pluginId: 'word-count' });
  assert.match(html, /&lt;b&gt;oi&lt;\/b&gt;/);
  assert.match(html, /x &amp; y/);
  assert.match(html, /data-plugin="word-count"/);
  assert.match(html, /data-acao="open:1"/);
  assert.ok(!/<b>/.test(html));

  assert.match(P.painelParaHtml({ type: 'text', text: 'olá' }, { pluginId: 'p' }), /olá/);
  assert.match(P.painelParaHtml({ type: 'table', columns: ['A'], rows: [['1']] }, { pluginId: 'p' }), /<th[^>]*>A<\/th>/);
  assert.match(P.painelParaHtml({ type: 'nao-existe' }, { pluginId: 'p' }), /não reconhecido|inválido/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `P.painelParaHtml is not a function`.

- [ ] **Step 3: Write minimal implementation**

Em `plugins.js`:

```js
  const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /**
   * O plug-in manda dados, nunca HTML: aqui eles viram marcação com o texto
   * escapado, usando as classes do próprio Kiro para herdar tema e skin.
   */
  function painelParaHtml(dados, { pluginId } = {}) {
    const attrs = acao => acao ? ` data-plugin="${escapar(pluginId)}" data-acao="${escapar(acao)}" role="button" tabindex="0"` : '';
    const d = dados && typeof dados === 'object' ? dados : {};
    switch (d.type) {
      case 'text': return `<p class="plugin-texto">${escapar(d.text)}</p>`;
      case 'list': return `<ul class="plugin-lista">${(d.items || []).map(i => `<li class="plugin-item"${attrs(i.action)}><span class="plugin-titulo">${escapar(i.title)}</span>${i.detail ? `<span class="small-muted">${escapar(i.detail)}</span>` : ''}</li>`).join('')}</ul>`;
      case 'cards': return `<div class="plugin-cards">${(d.items || []).map(i => `<article class="plugin-card"${attrs(i.action)}><h4>${escapar(i.title)}</h4><p>${escapar(i.body)}</p></article>`).join('')}</div>`;
      case 'table': return `<div class="plugin-tabela-rolagem"><table class="plugin-tabela"><thead><tr>${(d.columns || []).map(c => `<th scope="col">${escapar(c)}</th>`).join('')}</tr></thead><tbody>${(d.rows || []).map(l => `<tr>${(l || []).map(c => `<td>${escapar(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'form': return `<form class="plugin-form" data-plugin="${escapar(pluginId)}" data-acao="${escapar(d.submit)}">${(d.fields || []).map(f => `<label class="field"><span>${escapar(f.label)}</span>${f.type === 'select' ? `<select name="${escapar(f.name)}">${(f.options || []).map(o => `<option value="${escapar(o)}">${escapar(o)}</option>`).join('')}</select>` : `<input name="${escapar(f.name)}" type="${f.type === 'number' ? 'number' : 'text'}" />`}</label>`).join('')}<button class="primary" type="submit">Enviar</button></form>`;
      case 'stack': return `<div class="plugin-pilha">${(d.children || []).map(c => painelParaHtml(c, { pluginId })).join('')}</div>`;
      default: return `<p class="cfg-aviso">Formato de painel não reconhecido: ${escapar(d.type)}.</p>`;
    }
  }
```

No `app.js`: desenhe cada painel registrado como um card na tela Hoje, com o nome do
plug-in no cabeçalho; um clique em `[data-acao]` chama `chamarPlugin(id, { tipo: 'panel', id: painelId }, { action, values })`
e redesenha com o retorno. Os comandos entram no menu de comandos e podem ser chamados
pelo botão direito no card do plug-in.

Em `styles.css`, acrescente o bloco `.plugin-*` usando as variáveis existentes
(`--esp-*`, `--raio-card`, `--line`, `--acento`), no mesmo padrão dos outros cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs` — PASS, 11 testes.
No navegador: um painel de exemplo aparece na tela Hoje e o clique chama o plug-in.

- [ ] **Step 5: Commit**

```bash
git add plugins.js app.js styles.css tests/plugins.test.cjs
git commit -m "Plug-ins: comandos e painéis declarativos"
```

---

### Task 7: Aba Plug-ins nas Configurações

**Files:**
- Modify: `app.js` (`ABAS_CFG` ~linha 2019 e `showSettings`)
- Modify: `styles.css`
- Test: verificação no navegador (Browser pane)

**Interfaces:**
- Consumes: `planoDeCarga` (Task 5), `rotuloDaPermissao` (Task 1), `ativarPlugin`/`desativarPlugin`.
- Produces: aba `plugins` em `ABAS_CFG`, com ícone `codigo`.

- [ ] **Step 1: Write the failing test**

Este é código de interface; o teste é a verificação no navegador, descrita no passo 4.
Antes de implementar, acrescente ao `tests/plugins.test.cjs` a garantia de que a aba existe:

```js
test('Configurações têm a aba de plug-ins', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /\['plugins', 'Plug-ins'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL — a aba ainda não existe.

- [ ] **Step 3: Write minimal implementation**

Em `ABAS_CFG`, depois de `integracoes`:

```js
['plugins', 'Plug-ins', 'codigo'],
```

O painel lista cada plug-in encontrado, na ordem: ativos, aguardando permissão,
desligados e com problema. Cada linha mostra nome, autor, versão, descrição e as
permissões em português (`KiroPlugins.rotuloDaPermissao`). O interruptor liga e desliga.
Ligar um plug-in que pede permissão nova abre um modal de confirmação com a lista do que
ele vai poder fazer, no mesmo formato do modal de exclusão que já existe (`.primary`,
sem `confirm()` nativo). Um botão "Abrir pasta de plug-ins" reaproveita `window.cadernoDesktop.openVault()`.
Quem tem problema mostra o motivo em `.cfg-aviso`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plugins.test.cjs` — PASS.
No navegador, com o plug-in de exemplo da Task 8 na pasta do cofre de desenvolvimento:
abrir Configurações → Plug-ins, ativar, confirmar as permissões, ver o painel aparecer,
desativar e ver o painel sumir. Console sem erro.

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css tests/plugins.test.cjs
git commit -m "Plug-ins: aba nas Configurações com consentimento"
```

---

### Task 8: Plug-in de exemplo e documentação

**Files:**
- Create: `dev-vault/.kiro/plugins/word-count/manifest.json`
- Create: `dev-vault/.kiro/plugins/word-count/index.js`
- Create: `docs/plugins.md`
- Modify: `docs/KIRO-resumo-para-IA.md`
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: toda a API das tarefas anteriores.
- Produces: o exemplo que serve de molde e a documentação em inglês para quem escreve plug-in.

- [ ] **Step 1: Write the failing test**

```js
test('o plug-in de exemplo é válido e pede o mínimo', () => {
  const manifesto = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dev-vault', '.kiro', 'plugins', 'word-count', 'manifest.json'), 'utf8'));
  const r = P.validarManifesto(manifesto, { versaoDoKiro: require('../package.json').version });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.manifesto.permissions, ['notes:read']);
  assert.deepEqual(r.manifesto.network, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL — o arquivo do exemplo ainda não existe.

- [ ] **Step 3: Write minimal implementation**

`manifest.json`:

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "author": "Kiro",
  "description": "Counts words in the open note and lists the longest ones.",
  "minKiro": "0.15.0",
  "permissions": ["notes:read"],
  "network": []
}
```

`index.js`:

```js
// Example plugin for Kiro. Copy this folder to <vault>/.kiro/plugins/ to start your own.
const words = text => (String(text || '').trim().match(/\S+/g) || []).length;

export default {
  async activate(kiro) {
    kiro.command('count', 'Count words in the open note', async () => {
      const note = await kiro.notes.current();
      kiro.notify(note ? `${words(note.body)} words in "${note.title}"` : 'Open a note first.');
    });

    kiro.panel('longest', 'Longest notes', async () => {
      const notes = await kiro.notes.list({ limit: 50 });
      const ranked = notes.map(n => ({ n, w: words(n.body) })).sort((a, b) => b.w - a.w).slice(0, 5);
      return {
        type: 'list',
        items: ranked.map(({ n, w }) => ({ title: n.title, detail: `${w} words`, action: `open:${n.id}` })),
      };
    });
  },
};
```

`docs/plugins.md`, em inglês, cobrindo: pasta e arquivos, campos do manifesto, lista de
permissões com o que cada uma libera, a API disponível na etapa 1, o vocabulário de
painel, os limites de tempo e tamanho, o que o plug-in nunca alcança (disco, rede sem
permissão, tela do Kiro) e como depurar (console do app, mensagens de erro na aba Plug-ins).
No `docs/KIRO-resumo-para-IA.md`, acrescente um parágrafo curto em português sobre o sistema.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test` inteiro — todos passam, incluindo os 76 antigos.
No navegador, com o cofre de desenvolvimento: ativar o `word-count`, rodar o comando e
ver a contagem; ver o painel "Longest notes" com as cinco notas e clicar numa para abrir.

- [ ] **Step 5: Commit**

```bash
git add dev-vault/.kiro/plugins docs/plugins.md docs/KIRO-resumo-para-IA.md tests/plugins.test.cjs
git commit -m "Plug-ins: exemplo word-count e documentação para autores"
```

---

## Ordem e dependências

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. As tarefas 1 e 2 podem ser feitas em paralelo por
agentes diferentes (arquivos distintos); a 3 depende da 2; a 6 e a 7 dependem da 5.
Nenhuma tarefa mexe no mesmo trecho de arquivo que outra tarefa em andamento, com uma
exceção: `plugins.js` é tocado nas tarefas 1, 4, 5 e 6, então essas quatro são sequenciais.
