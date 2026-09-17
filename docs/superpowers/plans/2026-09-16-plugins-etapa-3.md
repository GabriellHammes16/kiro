# Sistema de plug-ins do Kiro — etapa 3 (rede)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kiro.fetch` com lista fechada de hosts, proteção contra a rede local, chaves de API guardadas fora do cofre e injetadas pelo Kiro, e auditoria de cada chamada.

**Architecture:** Três camadas, cada uma testável sozinha. (1) Validação pura em `plugins.js`: manifesto com `secrets`, pedido de rede e cabeçalhos. (2) Executor Node em `rede-plugins.cjs`: resolve e confere o endereço dentro do `lookup` da conexão, segue redirecionamentos revalidando, aplica limites; o transporte é injetável para teste. (3) Guarda de segredos em `segredos-plugins.cjs`: cifra no Electron com `safeStorage`, arquivo só-do-dono na web. O Electron (IPC) e o servidor (rota com checagem de origem) ligam as três; o worker ganha `kiro.fetch`; a aba Plug-ins ganha os campos de chave e as últimas chamadas.

**Tech Stack:** JavaScript puro, sem dependência nova; `node:https`, `node:dns`, `node:net`, `node:crypto`; Electron `safeStorage`; `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-15-plugins-design.md`, seção "Rede (etapa 3)". Etapas anteriores: `docs/superpowers/plans/2026-09-15-plugins-etapa-1.md` e `2026-09-16-plugins-etapa-2.md`.

## Global Constraints

- Sem framework, sem build, sem dependência nova.
- API pública do plug-in em inglês; código interno, comentários e interface em português do Brasil.
- Nunca operação genérica de arquivo, processo ou rede: só `kiro.fetch` com as regras da spec.
- O valor de um segredo nunca vai para a página, para o worker, para log, para o audit.log nem para mensagem de erro.
- Testes só em pasta temporária (`fs.mkdtemp`); nunca `C:\Projetos\Meu segundo cerebro\vault` nem `C:\Users\bielg\Documents\KUROI\vault`. Testes não fazem requisição real à internet: usam transporte e `lookup` falsos injetados.
- Nada de `confirm()` ou `alert()` nativos.
- Limites: 10 s por pedido, 1 MB de corpo enviado, 5 MB de resposta, 3 redirecionamentos.
- Arquivos com CRLF: Edit/Write, nunca heredoc do Bash. Commit por tarefa, sem push.
- Cada tarefa usa o PRÓPRIO arquivo de teste indicado, para agentes em paralelo não se atropelarem.

---

### Task 1: Validação pura (`plugins.js`)

**Files:**
- Modify: `plugins.js`
- Test: `tests/plugins-rede.test.cjs` (novo)

**Interfaces:**
- Produces:
  - `validarManifesto` passa a aceitar e validar `secrets` (lista, padrão `[]`), devolvendo-a normalizada no manifesto.
  - `precisaConsentir(registro, manifesto)` também devolve `true` quando o manifesto traz um segredo cujo `name` não está em `registro.secrets`.
  - `CABECALHOS_PROIBIDOS` (Set, minúsculas).
  - `validarPedidoDeRede(pedido, { hostsConcedidos, segredos })` → `{ ok: true, pedido: { url, host, method, headers, body, secret } }` ou `{ ok: false, erro }`, onde `segredos` é a lista do manifesto.

- [ ] **Step 1: Write the failing test**

```js
// tests/plugins-rede.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../plugins.js');

const base = { id: 'tradutor', name: 'Tradutor', version: '1.0.0', author: 'x', minKiro: '0.14.0', permissions: ['network'], network: ['api.deepl.com'] };
const segredo = { name: 'apiKey', label: 'DeepL API key', host: 'api.deepl.com', header: 'Authorization', format: 'DeepL-Auth-Key {value}' };
const validar = m => P.validarManifesto({ ...base, ...m }, { versaoDoKiro: '0.14.0' });

test('manifesto com secrets válido', () => {
  const r = validar({ secrets: [segredo] });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.manifesto.secrets, [segredo]);
  assert.deepEqual(validar({}).manifesto.secrets, []);
});

test('manifesto com secrets inválido é recusado', () => {
  assert.match(validar({ secrets: [{ ...segredo, host: 'outro.com' }] }).erro, /host/i);
  assert.match(validar({ secrets: [{ ...segredo, name: '1x' }] }).erro, /nome|name/i);
  assert.match(validar({ secrets: [{ ...segredo, format: 'sem valor' }] }).erro, /value/i);
  assert.match(validar({ secrets: [{ ...segredo, header: 'Cookie' }] }).erro, /cabeçalho|header/i);
  assert.match(validar({ secrets: [segredo, segredo] }).erro, /repetid|duplic/i);
  assert.match(validar({ secrets: 'x' }).erro, /secrets/i);
});

test('segredo novo pede consentimento de novo', () => {
  const registro = { enabled: true, permissions: ['network'], network: ['api.deepl.com'], secrets: [] };
  assert.equal(P.precisaConsentir(registro, { ...base, secrets: [segredo] }), true);
  assert.equal(P.precisaConsentir({ ...registro, secrets: ['apiKey'] }, { ...base, secrets: [segredo] }), false);
});

test('pedido de rede: só https, host concedido, sem cabeçalho proibido', () => {
  const ctx = { hostsConcedidos: ['api.deepl.com'], segredos: [segredo] };
  const ok = P.validarPedidoDeRede({ url: 'https://api.deepl.com/v2/translate', method: 'post', headers: { 'Content-Type': 'application/json' }, body: '{}', secret: 'apiKey' }, ctx);
  assert.equal(ok.ok, true, ok.erro);
  assert.equal(ok.pedido.method, 'POST');
  assert.equal(ok.pedido.host, 'api.deepl.com');
  assert.deepEqual(ok.pedido.headers, { 'content-type': 'application/json' });

  const recusa = (pedido, re) => assert.match(P.validarPedidoDeRede(pedido, ctx).erro, re);
  recusa({ url: 'http://api.deepl.com/' }, /https/i);
  recusa({ url: 'https://api.deepl.com:8443/' }, /porta/i);
  recusa({ url: 'https://evil.com/' }, /não liberado|concedid/i);
  recusa({ url: 'https://api.deepl.com.evil.com/' }, /não liberado|concedid/i);
  recusa({ url: 'https://user:pass@api.deepl.com/' }, /usuário|credencia/i);
  recusa({ url: 'https://127.0.0.1/' }, /IP|endereço/i);
  recusa({ url: 'https://[::1]/' }, /IP|endereço/i);
  recusa({ url: 'https://api.deepl.com/', method: 'TRACE' }, /método/i);
  recusa({ url: 'https://api.deepl.com/', headers: { Cookie: 'a=b' } }, /cabeçalho/i);
  recusa({ url: 'https://api.deepl.com/', headers: { Authorization: 'x' } }, /cabeçalho/i);
  recusa({ url: 'https://api.deepl.com/', body: 'x'.repeat(1024 * 1024 + 1) }, /1 MB|corpo/i);
  recusa({ url: 'https://api.deepl.com/', body: { a: 1 } }, /texto|corpo/i);
  recusa({ url: 'https://api.deepl.com/', secret: 'naoExiste' }, /segredo|chave/i);
  recusa({ url: 'nao é url' }, /URL|endereço/i);
});

test('segredo só vale para o host dele', () => {
  const outro = { ...segredo, name: 'k2', host: 'api.deepl.com' };
  const ctx = { hostsConcedidos: ['api.deepl.com', 'api.outra.com'], segredos: [outro] };
  assert.match(P.validarPedidoDeRede({ url: 'https://api.outra.com/', secret: 'k2' }, ctx).erro, /host|segredo|chave/i);
});
```

- [ ] **Step 2: Run** — `node --test tests/plugins-rede.test.cjs` → FAIL.

- [ ] **Step 3: Implement** em `plugins.js`, junto do que existe:

```js
  const CABECALHOS_PROIBIDOS = new Set(['cookie', 'cookie2', 'set-cookie', 'host', 'origin', 'referer', 'authorization', 'proxy-authorization', 'connection', 'content-length', 'transfer-encoding', 'te', 'upgrade', 'keep-alive', 'expect']);
  const METODOS_DE_REDE = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const LIMITE_CORPO = 1024 * 1024;
  const nomeDeSegredo = v => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(v);
  const nomeDeCabecalho = v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
  const ipLiteral = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
```

Em `validarManifesto`, depois da checagem de `network`:

```js
    if (bruto.secrets !== undefined && !Array.isArray(bruto.secrets)) return recusa('O campo secrets precisa ser uma lista.');
    const secrets = [];
    for (const s of bruto.secrets || []) {
      if (!s || typeof s !== 'object') return recusa('Cada item de secrets precisa ser um objeto.');
      if (!nomeDeSegredo(s.name)) return recusa(`Nome de segredo inválido: ${s.name}.`);
      if (secrets.some(x => x.name === s.name)) return recusa(`Segredo repetido: ${s.name}.`);
      if (!texto(s.label, 80)) return recusa(`O segredo ${s.name} precisa de label até 80 caracteres.`);
      if (!network.includes(s.host)) return recusa(`O host do segredo ${s.name} precisa estar em network.`);
      if (!nomeDeCabecalho(s.header) || (CABECALHOS_PROIBIDOS.has(s.header.toLowerCase()) && s.header.toLowerCase() !== 'authorization')) return recusa(`Cabeçalho inválido no segredo ${s.name}.`);
      if (typeof s.format !== 'string' || s.format.split('{value}').length !== 2 || s.format.length > 120) return recusa(`O format do segredo ${s.name} precisa ter {value} exatamente uma vez.`);
      secrets.push({ name: s.name, label: s.label, host: s.host, header: s.header, format: s.format });
    }
```

e inclua `secrets` no manifesto devolvido. Em `precisaConsentir`, acrescente
`|| (manifesto.secrets || []).some(s => !lista(registro?.secrets).includes(s.name))`.

```js
  function validarPedidoDeRede(pedido, { hostsConcedidos = [], segredos = [] } = {}) {
    const recusa = erro => ({ ok: false, erro });
    const p = pedido && typeof pedido === 'object' ? pedido : {};
    let url;
    try { url = new URL(String(p.url)); } catch { return recusa('Endereço (URL) inválido.'); }
    if (url.protocol !== 'https:') return recusa('Só endereços https são permitidos.');
    if (url.port && url.port !== '443') return recusa('Só a porta 443 é permitida.');
    if (url.username || url.password) return recusa('URL com usuário ou senha (credenciais) não é permitida.');
    const host = url.hostname.toLowerCase();
    if (ipLiteral(host)) return recusa('Use o nome do host, não um endereço IP.');
    if (!hostsConcedidos.includes(host)) return recusa(`Host não liberado: ${host}.`);
    const method = String(p.method || 'GET').toUpperCase();
    if (!METODOS_DE_REDE.has(method)) return recusa(`Método não permitido: ${method}.`);
    const headers = {};
    for (const [nome, valor] of Object.entries(p.headers && typeof p.headers === 'object' ? p.headers : {})) {
      const chave = String(nome).toLowerCase();
      if (!nomeDeCabecalho(chave) || CABECALHOS_PROIBIDOS.has(chave) || chave.startsWith('proxy-') || chave.startsWith('sec-')) return recusa(`Cabeçalho não permitido: ${nome}.`);
      headers[chave] = String(valor).slice(0, 4096);
    }
    if (p.body !== undefined && p.body !== null && typeof p.body !== 'string') return recusa('O corpo precisa ser texto.');
    const body = p.body ?? null;
    if (body && Buffer_byteLength(body) > LIMITE_CORPO) return recusa('O corpo passa de 1 MB.');
    let secret = null;
    if (p.secret !== undefined && p.secret !== null) {
      const s = segredos.find(x => x.name === p.secret);
      if (!s) return recusa(`Segredo (chave) não declarado: ${p.secret}.`);
      if (s.host !== host) return recusa(`O segredo ${s.name} só vale para o host ${s.host}.`);
      secret = s.name;
    }
    return { ok: true, pedido: { url: url.href, host, method, headers, body, secret } };
  }
  // Tamanho em bytes sem Buffer (roda também no navegador).
  const Buffer_byteLength = s => new TextEncoder().encode(s).length;
```

Exporte `CABECALHOS_PROIBIDOS` e `validarPedidoDeRede`. Ajuste os textos das mensagens até os testes baterem.

- [ ] **Step 4:** `node --test` inteiro → PASS (antes: 108).
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: validação de pedidos de rede e de segredos"`

---

### Task 2: Executor de rede (`rede-plugins.cjs`)

**Files:**
- Create: `rede-plugins.cjs`
- Test: `tests/rede.test.cjs` (novo)

**Interfaces:**
- Consumes: formato de pedido validado da Task 1 (`{ url, host, method, headers, body, secret }`) — a Task 2 NÃO chama `plugins.js`; recebe o pedido já validado e revalida só o que depende da rede.
- Produces:
  - `enderecoProibido(ip)` → boolean (IPv4 e IPv6).
  - `executarPedido(pedido, { hostsConcedidos, cabecalhoDoSegredo, lookup, requisitar, limites })` → `Promise<{ status, headers, text, bytes, redirecionamentos }>`.
    - `cabecalhoDoSegredo(host)` → `Promise<{ nome, valor } | null>` (a Task 3 fornece; o executor só o usa quando `pedido.secret` existe e o host bate).
    - `lookup` padrão: `dns.lookup` com `{ all: true }`; o executor embrulha e recusa endereço proibido.
    - `requisitar(opcoes)` padrão: `https.request` com `lookup` embrulhado; injetável para teste.
    - `limites` padrão: `{ tempo: 10000, resposta: 5 * 1024 * 1024, redirecionamentos: 3 }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/rede.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, Readable } = require('node:stream') && require('node:events');
const { Readable: Leitura } = require('node:stream');
const R = require('../rede-plugins.cjs');

test('endereços da rede local e reservados são proibidos', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1', 'ff02::1'])
    assert.equal(R.enderecoProibido(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(R.enderecoProibido(ip), false, ip);
});

// Transporte falso: responde conforme um roteiro, e chama o lookup para provar que ele roda na conexão.
function transporte(roteiro) {
  const vistos = [];
  const requisitar = (opcoes, aoResponder) => {
    const req = new (require('node:events'))();
    req.setTimeout = () => req; req.end = corpo => {
      vistos.push({ ...opcoes, corpo });
      opcoes.lookup(opcoes.hostname, { all: true }, (erro) => {
        if (erro) return req.emit('error', erro);
        const passo = roteiro.shift();
        const resposta = Leitura.from([Buffer.from(passo.text || '')]);
        resposta.statusCode = passo.status; resposta.headers = passo.headers || {};
        aoResponder(resposta);
      });
    };
    req.destroy = erro => { if (erro) req.emit('error', erro); };
    return req;
  };
  return { requisitar, vistos };
}
const lookupPublico = (host, opcoes, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
const pedido = extra => ({ url: 'https://api.deepl.com/v2/x', host: 'api.deepl.com', method: 'GET', headers: {}, body: null, secret: null, ...extra });

test('pedido simples devolve status, texto e só cabeçalhos permitidos', async () => {
  const t = transporte([{ status: 200, text: 'ok', headers: { 'content-type': 'text/plain', 'set-cookie': 'a=b', 'x-secreto': '1' } }]);
  const r = await R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: t.requisitar });
  assert.equal(r.status, 200);
  assert.equal(r.text, 'ok');
  assert.deepEqual(r.headers, { 'content-type': 'text/plain' });
});

test('host que resolve para a rede local é recusado na conexão', async () => {
  const t = transporte([{ status: 200, text: 'nao devia' }]);
  const lookupLocal = (host, opcoes, cb) => cb(null, [{ address: '192.168.0.10', family: 4 }]);
  await assert.rejects(R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupLocal, requisitar: t.requisitar }), /rede local|proibid/i);
});

test('redirecionamento só para host concedido, até o limite', async () => {
  const fora = transporte([{ status: 302, headers: { location: 'https://evil.com/' } }]);
  await assert.rejects(R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: fora.requisitar }), /redirecion/i);

  const dentro = transporte([{ status: 301, headers: { location: '/v2/y' } }, { status: 200, text: 'fim' }]);
  const r = await R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: dentro.requisitar });
  assert.equal(r.text, 'fim');
  assert.equal(r.redirecionamentos, 1);

  const laco = transporte(Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/de-novo' } })));
  await assert.rejects(R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: laco.requisitar }), /redirecion/i);
});

test('resposta acima do limite é cortada com erro', async () => {
  const t = transporte([{ status: 200, text: 'x'.repeat(2048) }]);
  await assert.rejects(R.executarPedido(pedido(), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: t.requisitar, limites: { tempo: 10000, resposta: 1024, redirecionamentos: 3 } }), /tamanho|limite|MB/i);
});

test('segredo vira cabeçalho só no host dele e não aparece no resultado', async () => {
  const t = transporte([{ status: 200, text: 'ok' }]);
  const cabecalhoDoSegredo = async host => host === 'api.deepl.com' ? { nome: 'authorization', valor: 'DeepL-Auth-Key SEGREDO123' } : null;
  const r = await R.executarPedido(pedido({ secret: 'apiKey' }), { hostsConcedidos: ['api.deepl.com'], lookup: lookupPublico, requisitar: t.requisitar, cabecalhoDoSegredo });
  assert.equal(t.vistos[0].headers.authorization, 'DeepL-Auth-Key SEGREDO123');
  assert.ok(!JSON.stringify(r).includes('SEGREDO123'));
});

test('segredo não segue para outro host num redirecionamento', async () => {
  const t = transporte([{ status: 302, headers: { location: 'https://cdn.deepl.com/a' } }, { status: 200, text: 'ok' }]);
  const cabecalhoDoSegredo = async () => ({ nome: 'authorization', valor: 'SEGREDO123' });
  await R.executarPedido(pedido({ secret: 'apiKey' }), { hostsConcedidos: ['api.deepl.com', 'cdn.deepl.com'], lookup: lookupPublico, requisitar: t.requisitar, cabecalhoDoSegredo, hostDoSegredo: 'api.deepl.com' });
  assert.equal(t.vistos[1].headers.authorization, undefined);
});
```

(O teste de transporte falso é um esboço: ajuste a forma do `requisitar` injetado para bater com a assinatura real de `https.request(opcoes, callback)` que você usar, mantendo o que cada teste prova.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

Requisitos (use `node:net` `isIP`, `node:dns`, `node:https`):
- `enderecoProibido(ip)`: desembrulhe `::ffff:a.b.c.d`; IPv4 proibido em `0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4`; IPv6 proibido em `::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32, 64:ff9b::/96` e qualquer IPv4 mapeado/compatível proibido. Endereço inválido também é proibido.
- `lookup` embrulhado: chama o `lookup` base com `{ all: true }`; se QUALQUER endereço devolvido for proibido, falha com `Error('O host aponta para a rede local; conexão recusada.')`; senão devolve o primeiro no formato que `https.request` espera (`cb(null, address, family)` ou a lista quando `opcoes.all`).
- Cada salto: revalida `https:`, porta 443 e host em `hostsConcedidos`; monta cabeçalhos do pedido + `user-agent: Kiro-Plugins`; adiciona o cabeçalho do segredo só se `pedido.secret` e o host do salto for o `hostDoSegredo` (padrão: host do pedido original); `rejectUnauthorized` fica no padrão (verdadeiro).
- Redirecionamento (301, 302, 303, 307, 308) com `location`: resolve relativo à URL atual; 303 e 301/302 com POST viram GET sem corpo; conta saltos; acima do limite, erro com "redirecionamentos".
- Tempo total com um único temporizador para a cadeia inteira; estouro destrói a requisição com erro "tempo".
- Lê o corpo em streaming e aborta ao passar do limite de resposta, com erro "tamanho".
- Resultado: `{ status, headers: <só content-type, content-length, etag, last-modified, cache-control, retry-after>, text: utf8, bytes, redirecionamentos }`. Mensagens de erro nunca incluem cabeçalhos nem o valor do segredo.

- [ ] **Step 4:** `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: executor de rede com proteção contra a rede local"`

---

### Task 3: Guarda de segredos (`segredos-plugins.cjs`)

**Files:**
- Create: `segredos-plugins.cjs`
- Test: `tests/segredos.test.cjs` (novo)

**Interfaces:**
- Produces: `criarGuardaDeSegredos({ arquivo, cifrar, decifrar })` → objeto com
  - `definir(cofre, pluginId, nome, valor)` → `Promise<void>` (valor string 1–4096; vazio é erro),
  - `remover(cofre, pluginId, nome)` → `Promise<void>`,
  - `estado(cofre, pluginId)` → `Promise<{ [nome]: true }>` (só quais existem, nunca valores),
  - `valor(cofre, pluginId, nome)` → `Promise<string|null>` (uso exclusivo do executor, no processo principal/servidor),
  - `removerDoPlugin(cofre, pluginId)` → `Promise<void>`.
  - `cifrar`/`decifrar`: funções `string → string` injetadas. No Electron: `safeStorage.encryptString` → base64 e o inverso. Na web: identidade (sem cifra, limitação documentada).
  - Chave de índice: `sha256(caminho absoluto normalizado do cofre) + ':' + pluginId + ':' + nome`.
  - Arquivo gravado de forma atômica, criado com modo `0o600` quando o sistema suportar.

- [ ] **Step 1: Write the failing test**

```js
// tests/segredos.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarGuardaDeSegredos } = require('../segredos-plugins.cjs');

async function guarda() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-segredos-'));
  const arquivo = path.join(dir, 'plugin-secrets.json');
  const g = criarGuardaDeSegredos({ arquivo, cifrar: v => Buffer.from(v).toString('base64'), decifrar: v => Buffer.from(v, 'base64').toString() });
  return { dir, arquivo, g };
}

test('define, lê, lista sem valor e remove', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await g.definir('C:/cofre', 'tradutor', 'apiKey', 'SEGREDO123');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), { apiKey: true });
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'apiKey'), 'SEGREDO123');
    assert.ok(!(await fs.readFile(arquivo, 'utf8')).includes('SEGREDO123'), 'o arquivo não guarda o valor em claro quando há cifra');
    assert.equal(await g.valor('C:/outro-cofre', 'tradutor', 'apiKey'), null, 'segredo é por cofre');
    await g.remover('C:/cofre', 'tradutor', 'apiKey');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), {});
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('valor vazio ou enorme é recusado; arquivo corrompido não derruba', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', ''), /vazi/i);
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', 'x'.repeat(4097)), /tamanho|4096/i);
    await fs.writeFile(arquivo, '{ quebrado');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), {});
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('remover do plug-in apaga só os dele', async () => {
  const { dir, g } = await guarda();
  try {
    await g.definir('C:/cofre', 'a', 'k', '1');
    await g.definir('C:/cofre', 'b', 'k', '2');
    await g.removerDoPlugin('C:/cofre', 'a');
    assert.deepEqual(await g.estado('C:/cofre', 'a'), {});
    assert.deepEqual(await g.estado('C:/cofre', 'b'), { k: true });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `segredos-plugins.cjs` conforme a interface (fila interna para gravações concorrentes não se atropelarem).
- [ ] **Step 4:** `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: guarda de segredos fora do cofre"`

---

### Task 4: Ligação — Electron, servidor, worker e auditoria

**Files:**
- Modify: `electron/main.cjs`, `electron/preload.cjs`, `server.mjs`, `plugin-worker.js`, `plugins.js` (só `METODOS`: `'fetch': 'network'`), `app.js` (seção de plug-ins)
- Test: `tests/plugins-ligacao-rede.test.cjs` (novo)

**Interfaces:**
- Consumes: Tasks 1, 2 e 3.
- Produces:
  - Worker: `kiro.fetch(url, init)` → `Promise<{ status, headers, text }>`, disponível só com `network` concedida (via `metodosPermitidos`).
  - Página → processo principal/servidor: `pluginApi.fetch(pluginId, pedido)`; no Electron `ipcMain.handle('plugins:fetch', (evento, pluginId, pedido))`, na web `POST /api/plugin-fetch` com `{ pluginId, pedido }`.
  - Segredos: `ipcMain.handle('plugins:secrets:state'|'plugins:secrets:set'|'plugins:secrets:remove')` e rotas `GET|POST|DELETE /api/plugin-secrets/<id>`; nenhuma rota devolve valor.

- [ ] **Step 1: Write the failing test** que prova, sem Electron:
  - a rota `POST /api/plugin-fetch` recusa com 403 um pedido com `Origin` de outro site e um pedido sem `Origin` e sem `Sec-Fetch-Site: same-origin` (use `servidorTemporario` no estilo de `tests/plugins.test.cjs`, com `KIRO_VAULT` num cofre temporário);
  - a rota recusa plug-in inexistente, desligado ou sem `network` concedida, e host não concedido (403/400 com mensagem), sem fazer requisição (injete o executor falso por variável de ambiente de teste `KIRO_REDE_FALSA=1`, que troca `requisitar` por um que falha o teste se chamado);
  - `GET /api/plugin-secrets/<id>` devolve só `{ nome: true }` e nunca o valor, mesmo depois de `POST` com valor;
  - no `app.js` e no `plugin-worker.js`, `fetch` aparece só via a API do plug-in (asserção de texto).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - Processo principal e servidor: carregam o plano do plug-in (manifesto válido + escolhas), exigem `enabled`, `network` concedida, montam `hostsConcedidos` a partir de `registro.network`, rodam `validarPedidoDeRede` (Task 1), depois `executarPedido` (Task 2) com `cabecalhoDoSegredo` que lê o valor na guarda (Task 3) e aplica `format`. Todo resultado e todo erro vão para o `AuditLog` do cofre (`record({ client: 'plugin', clientName: pluginId, action: 'network.fetch', target: host, status, … })`) sem corpo nem cabeçalhos.
  - Guarda de segredos: Electron com `safeStorage` (se `safeStorage.isEncryptionAvailable()` for falso, recuse gravar e diga por quê) em `app.getPath('userData')/plugin-secrets.json`; web em `%APPDATA%/Kiro/plugin-secrets.json` (Windows) ou `~/.config/Kiro/` com identidade.
  - Servidor: a rota nova exige mesma origem — `Origin` igual a `http://localhost:<porta>`/`http://127.0.0.1:<porta>`, ou ausente com `Sec-Fetch-Site: same-origin`; senão 403.
  - `desativarPlugin` e remoção do plug-in não apagam segredos sozinhos; a remoção explícita fica na interface (Task 5).
  - Hospedeiro (`app.js`): `executarMetodo` para `fetch` chama `pluginApi.fetch`, guarda as últimas 10 chamadas por plug-in em memória (`{ quando, metodo, host, status, bytes, ms }`) para a Task 5.
- [ ] **Step 4:** `node --test` inteiro → PASS. No navegador (`kiro-dev`): plug-in de teste temporário com `network: ["api.github.com"]` chama `kiro.fetch('https://api.github.com/zen')` e mostra o texto num aviso; chamada para host não liberado volta erro; `fetch` direto do worker continua bloqueado pela CSP. Apague o plug-in de teste e a entrada dele em `plugins.json` no fim. Esta é a única verificação que toca a internet, e só para `api.github.com`.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: kiro.fetch ligado no Electron e no servidor, com auditoria"`

---

### Task 5: Interface das chaves e das chamadas

**Files:**
- Modify: `app.js` (seção `// ---- Aba Plug-ins ----`), `styles.css` (fim, só variáveis de tema)
- Test: `tests/plugins-ligacao-rede.test.cjs` (acrescentar ao fim)

- [ ] **Step 1: Write the failing test** (texto do `app.js`): a aba usa `type="password"` com `autocomplete="off"` para segredo; nenhum caminho da aba lê valor de segredo; há área de "últimas chamadas".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — na linha de cada plug-in que declara `secrets`: um item por segredo com rótulo, host, estado ("Configurada"/"Não configurada"), campo de senha + "Salvar" (limpa o campo depois) e "Remover". Hosts de rede listados junto das permissões. Plug-in ativo com `network` mostra as últimas chamadas da sessão (hora, método, host, status, tamanho). O modal de consentimento lista os hosts e os segredos que o plug-in vai usar. Tudo escapado; nada de `confirm()`.
- [ ] **Step 4:** `node --test` inteiro → PASS. No navegador: definir e remover uma chave de teste num plug-in temporário que declara `secrets`; conferir no DOM e no tráfego (`read_network_requests`) que o valor nunca volta do servidor. Apague o plug-in de teste e a chave de teste.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: chaves e últimas chamadas nas Configurações"`

---

### Task 6: Exemplo e documentação

**Files:**
- Create: `examples/plugins/wikipedia-summary/manifest.json`, `examples/plugins/wikipedia-summary/index.js`
- Modify: `docs/plugins.md` (inglês), `docs/KIRO-resumo-para-IA.md` (português)
- Test: `tests/plugins-ligacao-rede.test.cjs` (acrescentar ao fim)

- [ ] **Step 1: Write the failing test** — o manifesto do exemplo valida com a versão do `package.json`, pede `network` só para `pt.wikipedia.org`, não declara `secrets`; `docs/plugins.md` cobre `kiro.fetch`, `secrets`, a proteção contra rede local e não marca a rede como "not available yet".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — o exemplo registra um bloco ` ```kiro:wikipedia-summary ` que recebe um título, chama `https://pt.wikipedia.org/api/rest_v1/page/summary/<título>` e devolve `{ html }` com título e resumo (texto escapado pelo próprio plug-in e higienizado pelo Kiro). Documentação: `kiro.fetch` (assinatura, retorno, métodos, limites, cabeçalhos proibidos, redirecionamentos, rede local), `secrets` (manifesto, como o usuário configura, que o plug-in nunca vê o valor, onde fica guardado por plataforma e a limitação da web), auditoria, e "Not available yet" só com as molduras (etapa 4).
- [ ] **Step 4:** `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: exemplo de rede e documentação da etapa 3"`

---

## Ordem e dependências

- Tasks 1, 2 e 3 são independentes (arquivos e testes próprios) e rodam em paralelo.
- Task 4 depende das três.
- Tasks 5 e 6 dependem da 4 e podem rodar em paralelo entre si (5 mexe em `app.js`/`styles.css`; 6 em `examples/` e `docs/`), cada uma acrescentando ao fim do mesmo arquivo de teste — combine por mensagem quem grava primeiro.
