# Fluxo — Etapa 1 (arquivo e editor básico) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arquivos `.canvas` (JSON Canvas) aparecem na árvore de Pastas, abrem numa aba e podem ser editados: cartões de texto, setas, seleção, pan/zoom, grade e desfazer.

**Architecture:** `fluxo.js` é o modelo puro (ler/validar JSON Canvas, operações imutáveis, histórico e geometria), no mesmo formato do `abas.js`. O cofre (`vault.cjs`) carrega os `.canvas` em `state.fluxos` e os grava na mesma transação das notas. `fluxo-tela.js` é o editor visual (DOM + SVG), que não conhece o cofre: recebe o canvas e devolve o novo por `aoMudar`. O `app.js` só liga árvore, abas e salvamento.

**Tech Stack:** JavaScript puro sem build, `node --test`, Electron 44 / servidor Node local. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-23-fluxo-design.md` (esta é a etapa 1 da seção "Etapas").

## Global Constraints

- Interface, código, comentários, mensagens e commits em português do Brasil.
- Sem dependências novas; sem framework; sem etapa de build. Scripts carregados por `<script>` sob a CSP `script-src 'self'`.
- Formato de arquivo: JSON Canvas 1.0, extensão `.canvas`. Campos desconhecidos são preservados na leitura e na gravação.
- Gravação do `.canvas`: `JSON.stringify(canvas, null, '\t')`, e só quando o conteúdo mudou.
- Id do fluxo guardado no `caderno.json` (`fluxos: [{ id, path }]`), nunca dentro do `.canvas`.
- `.canvas` com JSON inválido: o cofre abre, o fluxo entra com `erro`, e o arquivo nunca é regravado.
- Nenhum cartão é apagado automaticamente.
- Posição e zoom de cada fluxo ficam no `localStorage`, por cofre (`kiro.fluxoVista:<vaultPath>`), nunca no arquivo.
- Grade de 20 px; zoom de 10% a 400%; histórico de desfazer com 100 passos, só enquanto o fluxo está aberto (a sessão sobrevive aos redesenhos do app, não ao fechamento da janela).
- Cores: `"1"`–`"6"` (vermelho, laranja, amarelo, verde, ciano, roxo) ou `#rrggbb`.
- Fora da etapa 1 (não implementar): cartões de nota/imagem/link com prévia, grupos editáveis, arrastar da árvore para o fluxo, colar, "Transformar em nota", renomeação de nota refletida nos cartões, lixeira de fluxos, "Aparece nos fluxos", ferramentas de IA, layout automático. Cartões `file`/`link`/`group` vindos do Obsidian são apenas **exibidos** (texto simples) e podem ser movidos, redimensionados e apagados.
- Nesta etapa, um fluxo que sai de `state.fluxos` **não** é apagado do disco (sem lixeira ainda, não se apaga nada).

## Review Focus

1. **Canvas feito no Obsidian com campos ou valores que o Kiro não conhece** (campo extra no topo, no cartão ou na seta; tipo de cartão desconhecido): os campos extras precisam voltar intactos ao gravar; um tipo desconhecido deixa o fluxo com `erro` e o arquivo intocado. Coberto na Task 4 e na Task 5.
2. **Salvamento disparado no meio de um arraste ou enquanto se digita num cartão:** a digitação e o arraste não podem se perder. O agendador adia enquanto `KiroFluxoTela.ocupado()`. Verificação manual na Task 7, passo 6.
3. **Releitura automática do cofre (a cada 5 s) com uma mudança de fluxo ainda não salva:** a mudança não pode ser descartada. `reload()` pula enquanto `fluxoPendente`. Verificação manual na Task 6, passo 8.
4. **Texto com HTML ou cor maliciosa dentro de um `.canvas` vindo de fora:** nada é injetado. `ler` recusa uma cor fora do formato e o texto passa pelo `renderizarMarkdown`, que já escapa. Coberto na Task 1 (teste da cor com `;`).
5. **Dois fluxos com o mesmo nome na mesma pasta, ou nomes que diferem só em maiúsculas** (o Windows os trata como o mesmo arquivo): o cofre recusa, sem gravar nada, e a interface avisa antes. Coberto na Task 5 e na Task 6.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `fluxo.js` (novo) | Modelo puro: ler/serializar, operações, histórico, geometria. `module.exports` no Node, `globalThis.KiroFluxo` no navegador |
| `fluxo-tela.js` (novo) | Editor visual. `globalThis.KiroFluxoTela` = `{ montar, desmontarTodos, ocupado }` |
| `tests/fluxo.test.cjs` (novo) | Testes do modelo e da validação do estado |
| `domain.js` | `validateState` aceita `fluxos` |
| `vault.cjs` | Carrega `.canvas` em `state.fluxos`; grava na transação; ids no `caderno.json` |
| `tests/vault.test.cjs` | Testes do cofre com fluxos |
| `app.js` | Árvore, abas, "Novo fluxo", renomear/mover, salvamento com espera, proteção da releitura |
| `index.html`, `server.mjs`, `package.json` | Carregar e servir os scripts novos; `fluxo.js` fora do asar |
| `styles.css` | Estilos do editor |
| `README.md` | Uma seção curta sobre o Fluxo |

---

### Task 1: Modelo — ler, serializar, operações e histórico

**Files:**
- Create: `fluxo.js`
- Create: `tests/fluxo.test.cjs`
- Modify: `index.html:39` (script), `server.mjs:23` (publicFiles), `package.json` (`asarUnpack`)

**Interfaces:**
- Consumes: nada.
- Produces (em `KiroFluxo` / `require('./fluxo.js')`):
  - `TIPOS`, `LADOS`, `CORES`, `GRADE` (20)
  - `ler(texto: string) → { canvas, avisos: string[] } | { erro: string }`
  - `serializar(canvas) → string`
  - `corValida(cor) → boolean` (aceita `undefined`)
  - `adicionarCartao(c, cartao) → { canvas, id }`
  - `moverCartoes(c, ids: string[], dx, dy) → canvas`
  - `redimensionar(c, id, width, height) → canvas` (mínimo 80×40)
  - `editarCartao(c, id, campos) → canvas` (campo `undefined` é removido)
  - `removerCartoes(c, ids) → canvas` (leva as setas ligadas)
  - `duplicarCartoes(c, ids, dx = 40, dy = 40) → { canvas, ids }`
  - `ligar(c, seta) → { canvas, id | null }`
  - `editarSeta(c, id, campos) → canvas`, `removerSetas(c, ids) → canvas`
  - `encaixar(v, grade = 20) → number`
  - `historicoVazio() → { antes: [], depois: [] }`, `empilhar(h, anterior) → h`, `desfazer(h, atual) → { historico, canvas } | null`, `refazer(h, atual) → { historico, canvas } | null`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/fluxo.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fluxo.js');

const cartao = (id, extra = {}) => ({ id, type: 'text', text: id, x: 0, y: 0, width: 200, height: 60, ...extra });
const canvas = (nodes = [], edges = []) => ({ nodes, edges });

test('ler aceita JSON Canvas válido e preserva campos desconhecidos', () => {
  const bruto = { nodes: [cartao('a', { extra: 1 })], edges: [], 'x-obsidian': { v: 2 } };
  const { canvas: c, avisos } = F.ler(JSON.stringify(bruto));
  assert.deepEqual(c, bruto);
  assert.deepEqual(avisos, []);
});

test('ler trata arquivo vazio e {} como canvas vazio', () => {
  assert.deepEqual(F.ler('').canvas, { nodes: [], edges: [] });
  assert.deepEqual(F.ler('{}').canvas, { nodes: [], edges: [] });
  assert.deepEqual(F.ler('﻿{}').canvas, { nodes: [], edges: [] });
});

test('ler recusa JSON quebrado, formato errado, tipo desconhecido e id repetido', () => {
  assert.match(F.ler('{nope').erro, /JSON inválido/);
  assert.match(F.ler('[]').erro, /JSON Canvas/);
  assert.match(F.ler('{"nodes":{}}').erro, /listas/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { type: 'video' })]))).erro, /tipo desconhecido/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a'), cartao('a')]))).erro, /repetido/);
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { width: -1 })]))).erro, /tamanho/);
  assert.match(F.ler(JSON.stringify(canvas([{ ...cartao('a'), text: undefined }]))).erro, /texto/);
});

test('ler recusa cor que não é "1"–"6" nem #rrggbb (nada de CSS injetado)', () => {
  assert.match(F.ler(JSON.stringify(canvas([cartao('a', { color: 'red;background:url(x)' })]))).erro, /cor/);
  assert.equal(F.ler(JSON.stringify(canvas([cartao('a', { color: '#A1b2C3' })]))).erro, undefined);
  assert.equal(F.ler(JSON.stringify(canvas([cartao('a', { color: '4' })]))).erro, undefined);
});

test('ler ignora, com aviso, seta para cartão inexistente', () => {
  const r = F.ler(JSON.stringify(canvas([cartao('a')], [{ id: 's', fromNode: 'a', toNode: 'zzz' }])));
  assert.deepEqual(r.canvas.edges, []);
  assert.equal(r.avisos.length, 1);
});

test('ler recusa seta com lado ou ponta inválidos', () => {
  const dois = [cartao('a'), cartao('b')];
  assert.match(F.ler(JSON.stringify(canvas(dois, [{ id: 's', fromNode: 'a', toNode: 'b', fromSide: 'meio' }]))).erro, /lado/);
  assert.match(F.ler(JSON.stringify(canvas(dois, [{ id: 's', fromNode: 'a', toNode: 'b', toEnd: 'seta' }]))).erro, /ponta/);
});

test('serializar usa tabulação e volta igual pelo ler', () => {
  const c = canvas([cartao('a')], []);
  const texto = F.serializar(c);
  assert.match(texto, /\n\t"nodes"/);
  assert.deepEqual(F.ler(texto).canvas, c);
});

test('adicionarCartao cria id novo de 16 hex; não muta o original', () => {
  const c = canvas([cartao('a')]);
  const { canvas: c2, id } = F.adicionarCartao(c, { type: 'text', text: '', x: 0, y: 0, width: 260, height: 60 });
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(c.nodes.length, 1);
  assert.equal(c2.nodes.at(-1).id, id);
});

test('mover, redimensionar (com mínimo) e editar cartão', () => {
  let c = canvas([cartao('a'), cartao('b')]);
  c = F.moverCartoes(c, ['a'], 20, -40);
  assert.deepEqual([c.nodes[0].x, c.nodes[0].y, c.nodes[1].x], [20, -40, 0]);
  c = F.redimensionar(c, 'a', 10, 10);
  assert.deepEqual([c.nodes[0].width, c.nodes[0].height], [80, 40]);
  c = F.editarCartao(c, 'a', { color: '2', text: 'novo' });
  assert.equal(c.nodes[0].color, '2');
  c = F.editarCartao(c, 'a', { color: undefined });
  assert.equal('color' in c.nodes[0], false);
});

test('removerCartoes leva junto as setas ligadas', () => {
  let c = canvas([cartao('a'), cartao('b'), cartao('c')], [{ id: 's1', fromNode: 'a', toNode: 'b' }, { id: 's2', fromNode: 'b', toNode: 'c' }]);
  c = F.removerCartoes(c, ['a']);
  assert.deepEqual(c.nodes.map(n => n.id), ['b', 'c']);
  assert.deepEqual(c.edges.map(e => e.id), ['s2']);
});

test('duplicarCartoes copia cartões e as setas entre eles, com ids novos', () => {
  const c = canvas([cartao('a'), cartao('b'), cartao('c')], [{ id: 's1', fromNode: 'a', toNode: 'b' }, { id: 's2', fromNode: 'b', toNode: 'c' }]);
  const r = F.duplicarCartoes(c, ['a', 'b']);
  assert.equal(r.canvas.nodes.length, 5);
  assert.equal(r.canvas.edges.length, 3);
  const nova = r.canvas.edges.at(-1);
  assert.deepEqual([nova.fromNode, nova.toNode], r.ids);
  assert.equal(r.canvas.nodes.at(-1).x, 40);
});

test('ligar recusa ligar um cartão a ele mesmo ou a cartão inexistente', () => {
  const c = canvas([cartao('a'), cartao('b')]);
  assert.equal(F.ligar(c, { fromNode: 'a', toNode: 'a' }).id, null);
  assert.equal(F.ligar(c, { fromNode: 'a', toNode: 'x' }).id, null);
  const r = F.ligar(c, { fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' });
  assert.match(r.id, /^[0-9a-f]{16}$/);
  assert.deepEqual(r.canvas.edges[0], { fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', id: r.id });
});

test('editarSeta e removerSetas', () => {
  let c = canvas([cartao('a'), cartao('b')], [{ id: 's', fromNode: 'a', toNode: 'b' }]);
  c = F.editarSeta(c, 's', { label: 'causa', toEnd: 'none' });
  assert.equal(c.edges[0].label, 'causa');
  c = F.editarSeta(c, 's', { label: undefined });
  assert.equal('label' in c.edges[0], false);
  assert.deepEqual(F.removerSetas(c, ['s']).edges, []);
});

test('encaixar arredonda para a grade de 20', () => {
  assert.equal(F.encaixar(29), 20);
  assert.equal(F.encaixar(31), 40);
  assert.equal(F.encaixar(-31), -40);
});

test('histórico: desfazer e refazer; mudança nova limpa o refazer; limite de 100', () => {
  const c0 = canvas(), c1 = canvas([cartao('a')]), c2 = canvas([cartao('a'), cartao('b')]);
  let h = F.empilhar(F.empilhar(F.historicoVazio(), c0), c1);   // atual = c2
  let r = F.desfazer(h, c2);
  assert.equal(r.canvas, c1);
  r = F.desfazer(r.historico, r.canvas);
  assert.equal(r.canvas, c0);
  assert.equal(F.desfazer(r.historico, r.canvas), null);
  const volta = F.refazer(r.historico, r.canvas);
  assert.equal(volta.canvas, c1);
  assert.deepEqual(F.empilhar(volta.historico, c1).depois, []);
  for (let i = 0; i < 150; i++) h = F.empilhar(h, c0);
  assert.equal(h.antes.length, 100);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL com `Cannot find module '../fluxo.js'`.

- [ ] **Step 3: Implementar `fluxo.js`**

```js
// Fluxo: o canvas de ideias do Kiro, no formato aberto JSON Canvas 1.0 (jsoncanvas.org).
// Só o modelo, sem DOM. Imutável: toda operação devolve um canvas novo. Campos que o Kiro
// não conhece passam intactos, para o arquivo continuar abrindo igual no Obsidian.
// Roda no navegador (KiroFluxo) e no Node (vault.cjs e testes).
(function (root) {
  const TIPOS = ['text', 'file', 'link', 'group'];
  const LADOS = ['top', 'right', 'bottom', 'left'];
  const PONTAS = ['none', 'arrow'];
  const CORES = ['1', '2', '3', '4', '5', '6'];
  const GRADE = 20;
  const LIMITE_HISTORICO = 100;
  const MINIMO = { width: 80, height: 40 };
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const str = v => typeof v === 'string';
  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // A cor vai para um atributo style: só os dois formatos da especificação passam.
  const corValida = c => c === undefined || CORES.includes(c) || (str(c) && /^#[0-9a-f]{6}$/i.test(c));

  function novoId(usados) {
    let id;
    do id = Array.from(root.crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    while (usados.has(id));
    return id;
  }
  const usados = c => new Set([...c.nodes.map(n => n.id), ...c.edges.map(e => e.id)]);

  function problemaDoCartao(n) {
    if (!obj(n) || !str(n.id) || !n.id) return 'Cartão sem id.';
    if (!TIPOS.includes(n.type)) return `Cartão ${n.id}: tipo desconhecido "${n.type}".`;
    if (![n.x, n.y, n.width, n.height].every(num) || n.width <= 0 || n.height <= 0) return `Cartão ${n.id}: posição ou tamanho inválido.`;
    if (!corValida(n.color)) return `Cartão ${n.id}: cor inválida.`;
    if (n.type === 'text' && !str(n.text)) return `Cartão ${n.id}: texto ausente.`;
    if (n.type === 'file' && !str(n.file)) return `Cartão ${n.id}: arquivo ausente.`;
    if (n.type === 'link' && !str(n.url)) return `Cartão ${n.id}: URL ausente.`;
    if (n.type === 'group' && n.label !== undefined && !str(n.label)) return `Cartão ${n.id}: rótulo inválido.`;
    return null;
  }
  function problemaDaSeta(e) {
    if (!obj(e) || !str(e.id) || !e.id || !str(e.fromNode) || !str(e.toNode)) return 'Seta sem id, fromNode ou toNode.';
    if ([e.fromSide, e.toSide].some(l => l !== undefined && !LADOS.includes(l))) return `Seta ${e.id}: lado inválido.`;
    if ([e.fromEnd, e.toEnd].some(p => p !== undefined && !PONTAS.includes(p))) return `Seta ${e.id}: ponta inválida.`;
    if (!corValida(e.color)) return `Seta ${e.id}: cor inválida.`;
    if (e.label !== undefined && !str(e.label)) return `Seta ${e.id}: rótulo inválido.`;
    return null;
  }

  // { canvas, avisos } ou { erro }. Seta para cartão que não existe sai, com aviso: o resto
  // do fluxo continua utilizável. Cartões e setas têm espaços de id separados, como na spec.
  function ler(texto) {
    let bruto;
    try { bruto = JSON.parse(String(texto).replace(/^﻿/, '').trim() || '{}'); }
    catch (e) { return { erro: `JSON inválido: ${e.message}` }; }
    if (!obj(bruto)) return { erro: 'O arquivo não é um JSON Canvas.' };
    const nodes = bruto.nodes ?? [], edges = bruto.edges ?? [];
    if (!Array.isArray(nodes) || !Array.isArray(edges)) return { erro: '"nodes" e "edges" precisam ser listas.' };
    const cartoes = new Set();
    for (const n of nodes) {
      const problema = problemaDoCartao(n);
      if (problema) return { erro: problema };
      if (cartoes.has(n.id)) return { erro: `Id de cartão repetido: ${n.id}.` };
      cartoes.add(n.id);
    }
    const setas = new Set(), avisos = [], validas = [];
    for (const e of edges) {
      const problema = problemaDaSeta(e);
      if (problema) return { erro: problema };
      if (setas.has(e.id)) return { erro: `Id de seta repetido: ${e.id}.` };
      setas.add(e.id);
      if (!cartoes.has(e.fromNode) || !cartoes.has(e.toNode)) { avisos.push(`A seta ${e.id} aponta para um cartão que não existe e foi ignorada.`); continue; }
      validas.push(e);
    }
    return { canvas: { ...bruto, nodes, edges: validas }, avisos };
  }
  const serializar = c => JSON.stringify(c, null, '\t');

  // Campo com valor undefined sai do item (ex.: tirar a cor).
  function mesclar(item, campos) {
    const r = { ...item };
    for (const [k, v] of Object.entries(campos)) { if (v === undefined) delete r[k]; else r[k] = v; }
    return r;
  }
  const mapearCartoes = (c, ids, fn) => ({ ...c, nodes: c.nodes.map(n => (ids.has(n.id) ? fn(n) : n)) });

  function adicionarCartao(c, cartao) {
    const id = novoId(usados(c));
    return { canvas: { ...c, nodes: [...c.nodes, { ...cartao, id }] }, id };
  }
  const moverCartoes = (c, ids, dx, dy) => mapearCartoes(c, new Set(ids), n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const redimensionar = (c, id, width, height) => mapearCartoes(c, new Set([id]), n => ({ ...n, width: Math.max(MINIMO.width, width), height: Math.max(MINIMO.height, height) }));
  const editarCartao = (c, id, campos) => mapearCartoes(c, new Set([id]), n => mesclar(n, campos));
  function removerCartoes(c, ids) {
    const fora = new Set(ids);
    return { ...c, nodes: c.nodes.filter(n => !fora.has(n.id)), edges: c.edges.filter(e => !fora.has(e.fromNode) && !fora.has(e.toNode)) };
  }
  function duplicarCartoes(c, ids, dx = GRADE * 2, dy = GRADE * 2) {
    const alvo = new Set(ids), ocupados = usados(c), novos = new Map();
    const reservar = () => { const id = novoId(ocupados); ocupados.add(id); return id; };
    for (const n of c.nodes) if (alvo.has(n.id)) novos.set(n.id, { ...n, id: reservar(), x: n.x + dx, y: n.y + dy });
    const setas = c.edges.filter(e => novos.has(e.fromNode) && novos.has(e.toNode))
      .map(e => ({ ...e, id: reservar(), fromNode: novos.get(e.fromNode).id, toNode: novos.get(e.toNode).id }));
    return { canvas: { ...c, nodes: [...c.nodes, ...novos.values()], edges: [...c.edges, ...setas] }, ids: [...novos.values()].map(n => n.id) };
  }
  function ligar(c, seta) {
    const existe = id => c.nodes.some(n => n.id === id);
    if (seta.fromNode === seta.toNode || !existe(seta.fromNode) || !existe(seta.toNode)) return { canvas: c, id: null };
    const id = novoId(usados(c));
    return { canvas: { ...c, edges: [...c.edges, { ...seta, id }] }, id };
  }
  const editarSeta = (c, id, campos) => ({ ...c, edges: c.edges.map(e => (e.id === id ? mesclar(e, campos) : e)) });
  const removerSetas = (c, ids) => { const fora = new Set(ids); return { ...c, edges: c.edges.filter(e => !fora.has(e.id)) }; };
  const encaixar = (v, grade = GRADE) => Math.round(v / grade) * grade;

  // Desfazer guarda canvas inteiros: são imutáveis, então cada passo custa só as referências.
  const historicoVazio = () => ({ antes: [], depois: [] });
  const empilhar = (h, anterior) => ({ antes: [...h.antes, anterior].slice(-LIMITE_HISTORICO), depois: [] });
  function desfazer(h, atual) {
    if (!h.antes.length) return null;
    return { historico: { antes: h.antes.slice(0, -1), depois: [...h.depois, atual] }, canvas: h.antes.at(-1) };
  }
  function refazer(h, atual) {
    if (!h.depois.length) return null;
    return { historico: { antes: [...h.antes, atual], depois: h.depois.slice(0, -1) }, canvas: h.depois.at(-1) };
  }

  const api = { TIPOS, LADOS, CORES, GRADE, corValida, ler, serializar, adicionarCartao, moverCartoes, redimensionar, editarCartao, removerCartoes, duplicarCartoes, ligar, editarSeta, removerSetas, encaixar, historicoVazio, empilhar, desfazer, refazer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroFluxo = api;
})(globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/fluxo.test.cjs`
Expected: PASS em todos os testes.

- [ ] **Step 5: Carregar e servir o script; tirá-lo do asar**

Em `index.html`, logo depois de `<script src="abas.js"></script>` (linha 39):

```html
    <script src="fluxo.js"></script>
```

Em `server.mjs:23`, dentro de `publicFiles`, depois da entrada de `'/abas.js'`:

```js
'/fluxo.js': ['fluxo.js', 'text/javascript'],
```

Em `package.json`, em `build.asarUnpack`, depois de `"domain.js"` (o `vault.cjs` fica fora do asar e passa a dar `require('./fluxo.js')`; sem isso, o instalador quebra ao abrir o cofre):

```json
      "fluxo.js",
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (nenhum teste antigo quebra).

- [ ] **Step 7: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs index.html server.mjs package.json
git commit -m "Fluxo: modelo puro do JSON Canvas (ler, operações e desfazer)"
```

---

### Task 2: Modelo — geometria da tela

**Files:**
- Modify: `fluxo.js` (funções novas e `api`)
- Test: `tests/fluxo.test.cjs`

**Interfaces:**
- Consumes: `LADOS`, `GRADE` da Task 1.
- Produces:
  - `ZOOM = { min: 0.1, max: 4 }`, `OPOSTO = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }`
  - `vistaValida(v) → boolean`; vista é `{ x, y, zoom }` (x/y = translação em px da tela)
  - `paraCanvas(v, px, py) → { x, y }`
  - `zoomEm(v, fator, px, py) → vista` (o ponto sob o cursor fica parado; zoom limitado)
  - `enquadrar(nodes, largura, altura, margem = 40) → vista` (zoom ≤ 1)
  - `pontoDoLado(n, lado) → { x, y }`
  - `ladoMaisProximo(n, p) → lado`
  - `ladosDaSeta(a, b) → [ladoDeA, ladoDeB]`
  - `caminhoDaSeta(p1, l1, p2, l2) → { d: string, meio: { x, y } }`
  - `geometriaDaSeta(nodes, seta) → { d, meio } | null`
  - `dentro(nodes, ret) → ids[]` (`ret` pode ter largura/altura negativas)

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/fluxo.test.cjs`)

```js
test('paraCanvas desfaz translação e zoom', () => {
  assert.deepEqual(F.paraCanvas({ x: 100, y: 50, zoom: 2 }, 300, 250), { x: 100, y: 100 });
});

test('zoomEm mantém o ponto sob o cursor e respeita os limites', () => {
  const v = { x: 10, y: 20, zoom: 1 };
  const z = F.zoomEm(v, 2, 110, 120);
  assert.deepEqual(F.paraCanvas(z, 110, 120), F.paraCanvas(v, 110, 120));
  assert.equal(z.zoom, 2);
  assert.equal(F.zoomEm(v, 100, 0, 0).zoom, F.ZOOM.max);
  assert.equal(F.zoomEm(v, 0.0001, 0, 0).zoom, F.ZOOM.min);
});

test('vistaValida recusa lixo do localStorage', () => {
  assert.equal(F.vistaValida({ x: 0, y: 0, zoom: 1 }), true);
  for (const v of [null, 'x', { x: 0, y: 0 }, { x: 0, y: 0, zoom: 9 }, { x: NaN, y: 0, zoom: 1 }]) assert.equal(F.vistaValida(v), false);
});

test('enquadrar centraliza tudo, sem ampliar além de 100%', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 100 }), cartao('b', { x: 300, y: 100, width: 100, height: 100 })];
  const v = F.enquadrar(nodes, 1000, 800);
  assert.equal(v.zoom, 1);
  const centro = F.paraCanvas(v, 500, 400);
  assert.deepEqual(centro, { x: 200, y: 100 });
  assert.ok(F.enquadrar(nodes, 200, 200).zoom < 1);
  assert.deepEqual(F.enquadrar([], 1000, 800), { x: 500, y: 400, zoom: 1 });
});

test('pontoDoLado, ladoMaisProximo e ladosDaSeta', () => {
  const n = cartao('a', { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(F.pontoDoLado(n, 'right'), { x: 200, y: 50 });
  assert.deepEqual(F.pontoDoLado(n, 'top'), { x: 100, y: 0 });
  assert.equal(F.ladoMaisProximo(n, { x: 500, y: 60 }), 'right');
  assert.equal(F.ladoMaisProximo(n, { x: 90, y: 400 }), 'bottom');
  const b = cartao('b', { x: 400, y: 0, width: 200, height: 100 });
  assert.deepEqual(F.ladosDaSeta(n, b), ['right', 'left']);
  assert.deepEqual(F.ladosDaSeta(b, n), ['left', 'right']);
  assert.deepEqual(F.ladosDaSeta(n, { ...b, x: 0, y: 400 }), ['bottom', 'top']);
});

test('caminhoDaSeta sai e chega pelos lados, com o meio entre as pontas', () => {
  const { d, meio } = F.caminhoDaSeta({ x: 0, y: 0 }, 'right', { x: 300, y: 0 }, 'left');
  assert.match(d, /^M0 0 C100 0 200 0 300 0$/);
  assert.deepEqual(meio, { x: 150, y: 0 });
});

test('geometriaDaSeta usa os lados gravados ou calcula; seta órfã dá null', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 100 }), cartao('b', { x: 400, y: 0, width: 100, height: 100 })];
  assert.match(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'b' }).d, /^M100 50 /);
  assert.match(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'b', fromSide: 'top' }).d, /^M50 0 /);
  assert.equal(F.geometriaDaSeta(nodes, { id: 's', fromNode: 'a', toNode: 'x' }), null);
});

test('dentro acha cartões que tocam o retângulo, em qualquer sentido de arraste', () => {
  const nodes = [cartao('a', { x: 0, y: 0 }), cartao('b', { x: 500, y: 500 })];
  assert.deepEqual(F.dentro(nodes, { x: 250, y: 100, width: -300, height: -200 }), ['a']);
  assert.deepEqual(F.dentro(nodes, { x: -10, y: -10, width: 1000, height: 1000 }), ['a', 'b']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL (`F.paraCanvas is not a function` etc.).

- [ ] **Step 3: Implementar** (em `fluxo.js`, antes de `const api = ...`)

```js
  // ---- Geometria da tela ----
  // Vista: translação (x, y) em pixels da tela e zoom. Ponto do canvas = (tela - x) / zoom.
  const ZOOM = { min: 0.1, max: 4 };
  const OPOSTO = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const limitarZoom = z => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
  const vistaValida = v => obj(v) && num(v.x) && num(v.y) && num(v.zoom) && v.zoom >= ZOOM.min && v.zoom <= ZOOM.max;
  const paraCanvas = (v, px, py) => ({ x: (px - v.x) / v.zoom, y: (py - v.y) / v.zoom });
  function zoomEm(v, fator, px, py) {
    const zoom = limitarZoom(v.zoom * fator), k = zoom / v.zoom;
    return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, zoom };
  }
  function enquadrar(nodes, largura, altura, margem = 40) {
    if (!nodes.length) return { x: largura / 2, y: altura / 2, zoom: 1 };
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    const x1 = Math.max(...nodes.map(n => n.x + n.width)), y1 = Math.max(...nodes.map(n => n.y + n.height));
    const zoom = limitarZoom(Math.min(1, (largura - 2 * margem) / (x1 - x0), (altura - 2 * margem) / (y1 - y0)));
    return { x: largura / 2 - ((x0 + x1) / 2) * zoom, y: altura / 2 - ((y0 + y1) / 2) * zoom, zoom };
  }
  function pontoDoLado(n, lado) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    return { top: { x: cx, y: n.y }, bottom: { x: cx, y: n.y + n.height }, left: { x: n.x, y: cy }, right: { x: n.x + n.width, y: cy } }[lado];
  }
  function ladoMaisProximo(n, p) {
    let melhor = 'right', menor = Infinity;
    for (const lado of LADOS) { const q = pontoDoLado(n, lado), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < menor) { menor = d; melhor = lado; } }
    return melhor;
  }
  function ladosDaSeta(a, b) {
    const dx = (b.x + b.width / 2) - (a.x + a.width / 2), dy = (b.y + b.height / 2) - (a.y + a.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  const NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  // Curva cúbica que sai perpendicular ao lado de origem e chega perpendicular ao de destino.
  function caminhoDaSeta(p1, l1, p2, l2) {
    const f = Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3);
    const c1 = { x: p1.x + NORMAL[l1][0] * f, y: p1.y + NORMAL[l1][1] * f };
    const c2 = { x: p2.x + NORMAL[l2][0] * f, y: p2.y + NORMAL[l2][1] * f };
    const r = v => Math.round(v * 10) / 10 + 0;   // + 0 troca -0 por 0 no texto
    const meio = { x: r((p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8), y: r((p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8) };
    return { d: `M${r(p1.x)} ${r(p1.y)} C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`, meio };
  }
  function geometriaDaSeta(nodes, e) {
    const a = nodes.find(n => n.id === e.fromNode), b = nodes.find(n => n.id === e.toNode);
    if (!a || !b) return null;
    const [la, lb] = ladosDaSeta(a, b);
    const l1 = e.fromSide || la, l2 = e.toSide || lb;
    return caminhoDaSeta(pontoDoLado(a, l1), l1, pontoDoLado(b, l2), l2);
  }
  function dentro(nodes, r) {
    const x0 = Math.min(r.x, r.x + r.width), x1 = Math.max(r.x, r.x + r.width);
    const y0 = Math.min(r.y, r.y + r.height), y1 = Math.max(r.y, r.y + r.height);
    return nodes.filter(n => n.x < x1 && n.x + n.width > x0 && n.y < y1 && n.y + n.height > y0).map(n => n.id);
  }
```

E trocar a linha `const api = { ... }` por:

```js
  const api = { TIPOS, LADOS, CORES, GRADE, ZOOM, OPOSTO, corValida, ler, serializar, adicionarCartao, moverCartoes, redimensionar, editarCartao, removerCartoes, duplicarCartoes, ligar, editarSeta, removerSetas, encaixar, historicoVazio, empilhar, desfazer, refazer, vistaValida, paraCanvas, zoomEm, enquadrar, pontoDoLado, ladoMaisProximo, ladosDaSeta, caminhoDaSeta, geometriaDaSeta, dentro };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/fluxo.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs
git commit -m "Fluxo: geometria da tela (vista, zoom, lados e curvas das setas)"
```

---

### Task 3: `validateState` aceita `fluxos`

**Files:**
- Modify: `domain.js:9-42` (`validateState`)
- Test: `tests/fluxo.test.cjs`

**Interfaces:**
- Consumes: nada.
- Produces: `state.fluxos` opcional; cada item `{ id, title, folderId?, file?, canvas }` ou `{ id, title, folderId?, file?, erro }`. O id não pode repetir o de uma nota (as abas misturam os dois). O nome **não** é validado aqui (um arquivo vindo de fora pode ter um nome que o Kiro não criaria); quem cria ou renomeia valida com `validFolderName`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar a `tests/fluxo.test.cjs`)

```js
const domain = require('../domain.js');
const estado = (fluxos, extra = {}) => ({ notes: [{ id: 'n1', title: 'Nota', body: '', links: [], updatedAt: 1 }], tasks: [], folders: [{ id: 'p1', title: 'Pasta', parentId: '' }], fluxos, ...extra });

test('validateState aceita fluxos ausentes, com canvas ou com erro', () => {
  assert.doesNotThrow(() => domain.validateState(estado(undefined)));
  assert.doesNotThrow(() => domain.validateState(estado([{ id: 'f1', title: 'Mapa', folderId: 'p1', canvas: { nodes: [], edges: [] } }])));
  assert.doesNotThrow(() => domain.validateState(estado([{ id: 'f1', title: 'Quebrado', erro: 'JSON inválido' }])));
});

test('validateState recusa fluxo malformado', () => {
  const ruins = [
    'x',
    [{ id: 'n1', title: 'Mesmo id da nota', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: '', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Sem canvas' }],
    [{ id: 'f1', title: 'Canvas torto', canvas: { nodes: {} , edges: [] } }],
    [{ id: 'f1', title: 'Pasta que não existe', folderId: 'p9', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Arquivo fora', file: '../x.canvas', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'Extensão errada', file: 'x.md', canvas: { nodes: [], edges: [] } }],
    [{ id: 'f1', title: 'A', canvas: { nodes: [], edges: [] } }, { id: 'f1', title: 'B', canvas: { nodes: [], edges: [] } }],
  ];
  for (const fluxos of ruins) assert.throws(() => domain.validateState(estado(fluxos)), /inválidos/, JSON.stringify(fluxos));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL no teste "recusa fluxo malformado" (hoje `fluxos` é ignorado).

- [ ] **Step 3: Implementar** — em `domain.js`, dentro de `validateState`, logo antes do `return value;` final:

```js
    if (value.fluxos !== undefined) {
      if (!Array.isArray(value.fluxos)) fail();
      // Abas guardam ids de nota e de fluxo misturados: um id não pode servir aos dois.
      const usados = new Set(value.notes.map(n => n.id));
      for (const f of value.fluxos) {
        if (!f || !id(f.id) || usados.has(f.id) || !text(f.title) || !f.title) fail();
        usados.add(f.id);
        if (f.erro !== undefined ? !text(f.erro) : !(f.canvas && typeof f.canvas === 'object' && Array.isArray(f.canvas.nodes) && Array.isArray(f.canvas.edges))) fail();
        if (f.file !== undefined && (!text(f.file) || /(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))/.test(f.file) || !/\.canvas$/i.test(f.file))) fail();
        if (f.folderId && (!id(f.folderId) || (value.folders && !value.folders.some(x => x.id === f.folderId)))) fail();
      }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add domain.js tests/fluxo.test.cjs
git commit -m "Fluxo: validação de state.fluxos"
```

---

### Task 4: Cofre lê os `.canvas`

**Files:**
- Modify: `vault.cjs` (topo: `require`; `read()`: montar `fluxos` e passá-los ao estado)
- Test: `tests/vault.test.cjs`

**Interfaces:**
- Consumes: `KiroFluxo.ler` (Task 1), `validateState` com fluxos (Task 3).
- Produces: `state.fluxos = [{ id, file, title, folderId, canvas }]` ou `{ id, file, title, folderId, erro }`, em ordem de caminho. O id vem de `caderno.json` (`fluxos: [{ id, path }]`); sem registro (ou com id já usado), vira `fluxo-<32 hex do sha256 do caminho>`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar a `tests/vault.test.cjs`)

```js
const escreverCanvas = async (vault, arquivo, conteudo) => {
  await fs.mkdir(path.dirname(path.join(vault.directory, arquivo)), { recursive: true });
  await fs.writeFile(path.join(vault.directory, arquivo), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
};
const umCartao = { id: 'a', type: 'text', text: 'Oi', x: 0, y: 0, width: 200, height: 60 };

test('fluxo: .canvas do disco entra em state.fluxos com título, pasta e canvas', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Ideias/Mapa.canvas', { nodes: [umCartao], edges: [] });
  const s = await vault.load();
  assert.equal(s.fluxos.length, 1);
  const f = s.fluxos[0];
  assert.equal(f.title, 'Mapa');
  assert.equal(f.file, 'Ideias/Mapa.canvas');
  assert.equal(f.folderId, s.folders.find(x => x.title === 'Ideias').id);
  assert.equal(f.canvas.nodes[0].text, 'Oi');
  assert.match(f.id, /^fluxo-[0-9a-f]{32}$/);
  assert.equal((await vault.load()).fluxos[0].id, f.id, 'id estável entre leituras');
});

test('fluxo: JSON inválido ou tipo desconhecido entra com erro, sem derrubar o cofre', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  await escreverCanvas(vault, 'Futuro.canvas', { nodes: [{ ...umCartao, type: 'video' }], edges: [] });
  const s = await vault.load();
  assert.equal(s.notes.length, 1);
  assert.match(s.fluxos.find(f => f.title === 'Quebrado').erro, /JSON inválido/);
  assert.match(s.fluxos.find(f => f.title === 'Futuro').erro, /tipo desconhecido/);
  assert.equal(s.fluxos.find(f => f.title === 'Quebrado').canvas, undefined);
});

test('fluxo: arquivos ocultos e fora de .canvas não viram fluxo', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, '.oculto/Mapa.canvas', { nodes: [], edges: [] });
  await escreverCanvas(vault, 'Mapa.json', { nodes: [], edges: [] });
  assert.deepEqual((await vault.load()).fluxos, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vault.test.cjs`
Expected: FAIL (`s.fluxos` é `undefined`).

- [ ] **Step 3: Implementar**

No topo de `vault.cjs`, depois do `require('./domain.js')`:

```js
const KiroFluxo = require('./fluxo.js');
```

Em `read()`, logo depois do laço `for(const note of notes){ ... }` e antes de `const paths=folderPaths(folders);`:

```js
    // Fluxos (.canvas): o id mora no caderno.json, porque o Obsidian descartaria um campo
    // extra dentro do arquivo. Arquivo movido por fora ganha id novo; nada se perde.
    const registrados=Array.isArray(data.fluxos)?data.fluxos:[], idsUsados=new Set(notes.map(n=>n.id));
    const fluxos=[...files].filter(([file])=>visible(file)&&/\.canvas$/i.test(file)).sort(([a],[b])=>a.localeCompare(b)).map(([file,value])=>{
      const salvo=registrados.find(r=>r&&r.path===file&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.id||''))?.id;
      const id=salvo&&!idsUsados.has(salvo)?salvo:`fluxo-${hash(file).slice(0,32)}`;
      idsUsados.add(id);
      const lido=KiroFluxo.ler(value.data.toString('utf8'));
      return {id,file,title:path.posix.basename(file).replace(/\.canvas$/i,''),folderId:byDisk.get(parentPath(file))?.id||'',...(lido.erro?{erro:lido.erro}:{canvas:lido.canvas})};
    });
```

E na linha que monta o estado, passar `fluxos`:

```js
    const state=validateState(withHabits({formatVersion:3,notes,tasks:data.tasks,routine:data.routine,habits:data.habits,habitLog:data.habitLog,folders,fluxos}));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (inclusive os testes antigos de cofre, agentes e MCP: `fluxos` chega como `[]` e passa intacto).

- [ ] **Step 5: Commit**

```bash
git add vault.cjs tests/vault.test.cjs
git commit -m "Fluxo: o cofre lê os arquivos .canvas"
```

---

### Task 5: Cofre grava os fluxos na mesma transação

**Files:**
- Modify: `vault.cjs` (`write()`)
- Test: `tests/vault.test.cjs`

**Interfaces:**
- Consumes: `state.fluxos` (Task 4), `KiroFluxo.ler`/`serializar`, `validFolderName` e `pathKey` do `domain.js`.
- Produces: as regras de gravação que a interface e, na etapa 3, a Agent API usam:
  - O arquivo é `<caminho da pasta>/<title>.canvas` (ou `<title>.canvas` na raiz). Mudar `title` renomeia; mudar `folderId` move.
  - O canvas é validado (`ler(serializar(canvas))`); canvas inválido recusa o salvamento inteiro.
  - Nome novo ou alterado precisa passar em `validFolderName`; conflito de nome (sem diferenciar maiúsculas) recusa com "Já existe um arquivo no destino".
  - Canvas igual ao lido regrava os **bytes originais**; diferente grava `serializar(canvas)`.
  - Fluxo com `erro` e fluxo ausente de `input.fluxos` seguem como arquivos comuns (preservados, e movidos junto com a pasta).
  - `caderno.json` ganha `fluxos: [{ id, path }]` com todos os fluxos, gravados ou preservados.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar a `tests/vault.test.cjs`)

```js
const pasta = { id: 'pasta-1', title: 'Ideias', parentId: '', description: '', color: '' };
async function comPasta(vault) { const s = await seed(vault); return vault.save({ ...s, folders: [pasta] }); }
const vazio = () => ({ nodes: [], edges: [] });

test('fluxo novo vira <pasta>/<título>.canvas com tabulação, e o id vai para o caderno.json', async t => {
  const vault = await setup(t); const s = await comPasta(vault);
  const salvo = await vault.save({ ...s, fluxos: [{ id: 'fluxo-novo', title: 'Plano', folderId: 'pasta-1', canvas: { nodes: [umCartao], edges: [] } }] });
  const texto = await fs.readFile(path.join(vault.directory, 'Ideias', 'Plano.canvas'), 'utf8');
  assert.match(texto, /\n\t"nodes"/);
  assert.equal(salvo.fluxos[0].id, 'fluxo-novo');
  const meta = JSON.parse(await fs.readFile(path.join(vault.directory, 'caderno.json'), 'utf8'));
  assert.deepEqual(meta.fluxos, [{ id: 'fluxo-novo', path: 'Ideias/Plano.canvas' }]);
});

test('renomear e mover um fluxo trocam o arquivo e mantêm o id', async t => {
  const vault = await setup(t); let s = await comPasta(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: '', canvas: vazio() }] });
  s = await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], title: 'Plano B', folderId: 'pasta-1' }] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Plano.canvas')));
  await fs.access(path.join(vault.directory, 'Ideias', 'Plano B.canvas'));
  assert.equal((await vault.load()).fluxos[0].id, 'fluxo-1');
});

test('renomear a pasta leva o fluxo junto, com o mesmo id', async t => {
  const vault = await setup(t); let s = await comPasta(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: 'pasta-1', canvas: vazio() }] });
  s = await vault.save({ ...s, folders: [{ ...pasta, title: 'Projetos' }] });
  assert.equal(s.fluxos[0].file, 'Projetos/Plano.canvas');
  assert.equal(s.fluxos[0].id, 'fluxo-1');
});

test('canvas sem mudança não é regravado; campos desconhecidos sobrevivem a uma edição', async t => {
  const vault = await setup(t); await seed(vault);
  const original = '{\n  "nodes": [{"id":"a","type":"text","text":"Oi","x":0,"y":0,"width":200,"height":60,"styleAttributes":{"shape":"pill"}}],\n  "edges": [],\n  "x-extra": 1\n}';
  await escreverCanvas(vault, 'Mapa.canvas', original);
  let s = await vault.load();
  s = await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, body: 'mudou' })) });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'), original);
  const c = s.fluxos[0].canvas;
  await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], canvas: { ...c, nodes: [...c.nodes, { ...umCartao, id: 'b' }] } }] });
  const gravado = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(gravado['x-extra'], 1);
  assert.deepEqual(gravado.nodes[0].styleAttributes, { shape: 'pill' });
  assert.equal(gravado.nodes.length, 2);
});

test('fluxo com erro nunca é regravado, nem se a interface mandar um canvas para ele', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  const s = await vault.load();
  const { erro, ...semErro } = s.fluxos[0];
  await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, body: 'x' })), fluxos: [{ ...semErro, canvas: vazio() }] });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Quebrado.canvas'), 'utf8'), '{nope');
});

test('fluxo fora de state.fluxos continua no disco (etapa 1 não apaga)', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Mapa.canvas', { nodes: [], edges: [] });
  const s = await vault.load();
  await vault.save({ ...s, fluxos: [] });
  const { fluxos, ...semFluxos } = s;
  await vault.save({ ...(await vault.load()), fluxos: undefined, notes: s.notes.map(n => ({ ...n, body: 'y' })) });
  await fs.access(path.join(vault.directory, 'Mapa.canvas'));
  assert.equal((await vault.load()).fluxos.length, 1);
  assert.ok(semFluxos);
});

test('nome inválido, canvas inválido e nome repetido recusam o salvamento inteiro', async t => {
  const vault = await setup(t); const s = await comPasta(vault);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'a/b', canvas: vazio() }] }), /inválido/);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Ok', canvas: { nodes: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0, width: 10, height: 10, color: 'red;' }], edges: [] } }] }), /cor/);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', canvas: vazio() }, { id: 'f2', title: 'mapa', canvas: vazio() }] }), /Já existe/);
  assert.deepEqual((await vault.load()).fluxos, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vault.test.cjs`
Expected: FAIL. O primeiro teste falha porque nenhum `.canvas` é gravado; o de renomear falha com "Já existe um arquivo no destino" ou deixa o arquivo antigo.

- [ ] **Step 3: Implementar em `write()`**

No topo de `vault.cjs`, acrescentar `validFolderName` ao `require('./domain.js')`:

```js
const { validateState, upgradeBackup, folderPaths, descendants, pathKey, folderColor, withHabits, validFolderName } = require('./domain.js');
```

Em `write()`, logo depois da linha `const noteFiles=new Set(before.state.notes.map(n=>n.file).filter(Boolean));`:

```js
    // Fluxos que este salvamento grava: os que vieram no input e não estão com erro. Os
    // demais (com erro, ou ausentes do input) seguem como arquivos comuns, preservados.
    const fluxosAntes=before.state.fluxos||[];
    const gravaveis=(input.fluxos||[]).filter(f=>f.canvas&&!fluxosAntes.find(x=>x.id===f.id)?.erro);
    const fluxoFiles=new Set(gravaveis.map(f=>fluxosAntes.find(x=>x.id===f.id)?.file).filter(Boolean));
```

No laço que copia os arquivos que não são nota, pular também os fluxos gravados aqui. Trocar:

```js
      if(noteFiles.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
```

(a primeira ocorrência, dentro de `for(const [file,value]of before.files)`) por:

```js
      if(noteFiles.has(file)||fluxoFiles.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
```

Logo depois do bloco `if(restoring){ ... }` e **antes** de `for(const note of nextNotes){`, gravar os fluxos (antes das notas, para `changes` já conter os caminhos novos dos `.canvas` quando os links das notas forem reescritos):

```js
    const registroDeFluxos=[];
    for(const fluxo of gravaveis){
      const old=fluxosAntes.find(f=>f.id===fluxo.id);
      const nome=`${fluxo.title}.canvas`;
      const file=fluxo.folderId?`${paths.get(fluxo.folderId)}/${nome}`:nome;
      if((!old||old.file!==file)&&!validFolderName(fluxo.title))throw new Error(`Nome de fluxo inválido: ${fluxo.title}`);
      const lido=KiroFluxo.ler(KiroFluxo.serializar(fluxo.canvas));
      if(lido.erro)throw new Error(`Fluxo "${fluxo.title}": ${lido.erro}`);
      const anterior=old&&before.files.get(old.file)?.data;
      const igual=anterior&&JSON.stringify(old.canvas)===JSON.stringify(fluxo.canvas);
      put(file,igual?anterior:KiroFluxo.serializar(fluxo.canvas));
      if(old)changes.set(pathKey(old.file),file);
      registroDeFluxos.push({id:fluxo.id,path:file});
    }
    for(const old of fluxosAntes)if(!gravaveis.some(f=>f.id===old.id)){const destino=remap(old.file);if(destino)registroDeFluxos.push({id:old.id,path:destino});}
```

Na linha que monta `metadata`, acrescentar `fluxos:registroDeFluxos` antes de `folders:`:

```js
    const metadata=JSON.stringify({formatVersion:3,tasks:input.tasks,habits:input.habits||[],habitLog:input.habitLog||{},fluxos:registroDeFluxos,folders:input.folders.map(f=>({id:f.id,title:f.title,parentId:f.parentId||'',path:paths.get(f.id),description:f.description||'',color:folderColor(f.color)}))},null,2);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS. Se "renomear a pasta leva o fluxo junto" falhar com "Já existe um arquivo no destino", confira se `fluxoFiles` está sendo checado no laço de cópia.

- [ ] **Step 5: Commit**

```bash
git add vault.cjs tests/vault.test.cjs
git commit -m "Fluxo: o cofre grava os fluxos na mesma transação das notas"
```

---

### Task 6: App — árvore, abas, "Novo fluxo" e editor só de visualização

Ao fim desta task, um `.canvas` (inclusive um feito no Obsidian) aparece na árvore, abre numa aba, mostra cartões e setas, e aceita pan, zoom e "enquadrar". Criar, renomear e mover fluxos funciona. A edição do conteúdo vem nas Tasks 7 a 9.

**Files:**
- Create: `fluxo-tela.js`
- Modify: `app.js` (vários pontos, listados nos passos), `index.html`, `server.mjs`, `styles.css`

**Interfaces:**
- Consumes: `KiroFluxo` (Tasks 1–2), `state.fluxos` (Tasks 4–5).
- Produces:
  - `KiroFluxoTela.montar(host, opcoes) → { desmontar(), ocupado() }`, com `opcoes = { id, titulo, canvas, markdown(texto) → html, icone(nome) → svg, menu(evento, itens), chaveDaVista, aoMudar(canvas) }`
  - `KiroFluxoTela.desmontarTodos()` (chamado no início de `render()`)
  - `KiroFluxoTela.ocupado() → boolean` (um gesto ou uma edição em andamento)
  - Em `app.js`: `getFluxo(id)`, `abrirFluxo(fluxo, opcoes)`, `novoFluxo(folderId)`, `mudarFluxo(id, canvas)`, a flag `fluxoPendente` e a interface interna `fluxoSessao` do `fluxo-tela.js` (`sessao(id)` com `{ vista, selecao, seta, historico, grade }`), que as Tasks 7–9 estendem.

- [ ] **Step 1: Criar `fluxo-tela.js` (render, vista, pan, zoom, enquadrar)**

```js
// Editor do Fluxo: desenha um canvas JSON Canvas e traduz ponteiro e teclado em operações do
// KiroFluxo. Não conhece o cofre: recebe o canvas e entrega o novo por `aoMudar`. O que é de
// tela (vista, seleção, desfazer) vive numa sessão por fluxo, que sobrevive aos redesenhos do
// app (cada salvamento redesenha a tela inteira).
(function (root) {
  const F = root.KiroFluxo;
  const sessoes = new Map();       // id do fluxo → { vista, selecao, seta, historico, grade }
  const montados = new Set();
  let contador = 0;                // ids únicos de <marker> quando dois fluxos estão abertos
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Cor predefinida vira atributo (o CSS dá o tom de cada tema); hex vira variável CSS.
  // `ler` já recusou qualquer outra coisa, mas a checagem fica aqui também: é onde vira style.
  const corData = cor => (F.CORES.includes(cor) ? ` data-fluxo-cor="${cor}"` : '');
  const corCss = cor => (/^#[0-9a-f]{6}$/i.test(cor || '') ? `--fluxo-cor:${cor};` : '');
  function sessao(id) {
    if (!sessoes.has(id)) sessoes.set(id, { vista: null, selecao: new Set(), seta: null, historico: F.historicoVazio(), grade: true });
    return sessoes.get(id);
  }
  function lerVistas(chave) { try { return JSON.parse(localStorage.getItem(chave)) || {}; } catch { return {}; } }
  function gravarVista(chave, id, vista) {
    try { const todas = lerVistas(chave); todas[id] = vista; localStorage.setItem(chave, JSON.stringify(todas)); } catch { /* janela privada: vale só nesta sessão */ }
  }

  function montar(host, opcoes) {
    const { id } = opcoes, s = sessao(id), n = ++contador;
    let canvas = opcoes.canvas, gesto = null, editor = null, espaco = false, timerVista = null;
    host.innerHTML = `<div class="fluxo" tabindex="0" role="application" aria-label="Fluxo ${esc(opcoes.titulo)}">
  <div class="fluxo-mundo">
    <svg class="fluxo-setas" aria-hidden="true"><defs><marker id="fluxo-ponta-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs><g class="fluxo-caminhos"></g><path class="fluxo-seta-previa" d=""/></svg>
    <div class="fluxo-cartoes"></div>
    <div class="fluxo-marca" hidden></div>
  </div>
  <div class="fluxo-barra"><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="Enquadrar tudo (Shift+1)">100%</button></div>
</div>`;
    const raiz = host.firstElementChild;
    const mundo = raiz.querySelector('.fluxo-mundo'), caminhos = raiz.querySelector('.fluxo-caminhos'), cartoes = raiz.querySelector('.fluxo-cartoes');
    const previa = raiz.querySelector('.fluxo-seta-previa'), marca = raiz.querySelector('.fluxo-marca'), rotuloZoom = raiz.querySelector('.fluxo-zoom');
    const ponta = `url(#fluxo-ponta-${n})`;
    const no = idNo => canvas.nodes.find(x => x.id === idNo);
    const elDoCartao = idNo => cartoes.querySelector(`[data-no="${CSS.escape(idNo)}"]`);
    const tamanho = () => { const r = raiz.getBoundingClientRect(); return [r.width, r.height]; };
    const pontoDaTela = e => { const r = raiz.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pontoDoCanvas = e => { const p = pontoDaTela(e); return F.paraCanvas(s.vista, p.x, p.y); };

    // ---- Desenho ----
    function conteudo(c) {
      if (c.type === 'text') return opcoes.markdown(c.text);
      if (c.type === 'file') return `<p class="fluxo-arquivo">${esc(c.file)}</p>`;
      if (c.type === 'link') return `<p class="fluxo-link">${esc(c.url)}</p>`;
      return '';
    }
    function cartaoHtml(c) {
      const alcas = F.LADOS.map(l => `<span class="fluxo-alca" data-lado="${l}"></span>`).join('') + '<span class="fluxo-canto" title="Arraste para redimensionar"></span>';
      const rotulo = c.type === 'group' ? `<span class="fluxo-grupo-rotulo">${esc(c.label)}</span>` : '';
      return `<div class="fluxo-cartao${s.selecao.has(c.id) ? ' selecionado' : ''}" data-no="${esc(c.id)}" data-tipo="${esc(c.type)}"${corData(c.color)} style="${corCss(c.color)}left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px">${rotulo}<div class="fluxo-conteudo">${conteudo(c)}</div>${alcas}</div>`;
    }
    function setaHtml(e, nodes) {
      const g = F.geometriaDaSeta(nodes, e);
      if (!g) return '';
      const fim = (e.toEnd ?? 'arrow') === 'arrow' ? ` marker-end="${ponta}"` : '';
      const inicio = e.fromEnd === 'arrow' ? ` marker-start="${ponta}"` : '';
      const rotulo = e.label ? `<text class="fluxo-seta-rotulo" x="${g.meio.x}" y="${g.meio.y}" text-anchor="middle" dominant-baseline="middle">${esc(e.label)}</text>` : '';
      return `<g class="fluxo-seta${s.seta === e.id ? ' selecionada' : ''}" data-seta="${esc(e.id)}"${corData(e.color)} style="${corCss(e.color)}"><path class="fluxo-seta-alvo" d="${g.d}"/><path class="fluxo-seta-linha" d="${g.d}"${fim}${inicio}/>${rotulo}</g>`;
    }
    const desenharSetas = (c = canvas) => { caminhos.innerHTML = c.edges.map(e => setaHtml(e, c.nodes)).join(''); };
    function desenhar() {
      // Seleção que aponta para algo que sumiu (desfazer, outra coluna) é descartada.
      for (const sel of s.selecao) if (!no(sel)) s.selecao.delete(sel);
      if (s.seta && !canvas.edges.some(e => e.id === s.seta)) s.seta = null;
      // Grupos primeiro: ficam atrás dos cartões.
      const ordem = c => (c.type === 'group' ? 0 : 1);
      cartoes.innerHTML = [...canvas.nodes].sort((a, b) => ordem(a) - ordem(b)).map(cartaoHtml).join('');
      desenharSetas();
    }

    // ---- Vista ----
    function aplicarVista() {
      const { x, y, zoom } = s.vista;
      mundo.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      raiz.style.backgroundSize = `${F.GRADE * zoom}px ${F.GRADE * zoom}px`;
      raiz.style.backgroundPosition = `${x}px ${y}px`;
      raiz.style.setProperty('--zoom', zoom);
      rotuloZoom.textContent = `${Math.round(zoom * 100)}%`;
    }
    function guardarVista() { clearTimeout(timerVista); timerVista = setTimeout(() => { timerVista = null; gravarVista(opcoes.chaveDaVista, id, s.vista); }, 300); }
    function enquadrarTudo() { s.vista = F.enquadrar(canvas.nodes, ...tamanho()); aplicarVista(); guardarVista(); }
    if (!s.vista) {
      const salva = lerVistas(opcoes.chaveDaVista)[id];
      s.vista = F.vistaValida(salva) ? salva : F.enquadrar(canvas.nodes, ...tamanho());
    }

    // ---- Gestos (ponteiro) ----
    // Cada gesto: { mover(g, e), soltar(g, e) }. As próximas partes do editor acrescentam os seus.
    const GESTOS = {
      pan: {
        mover(g, e) { const p = pontoDaTela(e); s.vista = { ...g.vista0, x: g.vista0.x + p.x - g.tela0.x, y: g.vista0.y + p.y - g.tela0.y }; aplicarVista(); },
        soltar() { guardarVista(); },
      },
    };
    function iniciar(e, g) { gesto = { ...g, tela0: pontoDaTela(e), vista0: { ...s.vista } }; raiz.setPointerCapture(e.pointerId); e.preventDefault(); }
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      return null;
    }
    raiz.addEventListener('pointerdown', e => {
      if (e.target.closest('.fluxo-barra, .fluxo-editor')) return;
      raiz.focus({ preventScroll: true });
      const g = escolherGesto(e);
      if (g) iniciar(e, g);
    });
    raiz.addEventListener('pointermove', e => { if (gesto) GESTOS[gesto.tipo].mover(gesto, e); });
    raiz.addEventListener('pointerup', e => { if (!gesto) return; const g = gesto; gesto = null; GESTOS[g.tipo].soltar(g, e); });
    raiz.addEventListener('pointercancel', () => { gesto = null; previa.classList.remove('ativa'); marca.hidden = true; desenhar(); aplicarVista(); });
    // Roda: rola (Shift = na horizontal); Ctrl+roda: zoom no cursor. Conteúdo longo de um
    // cartão rola dentro dele.
    raiz.addEventListener('wheel', e => {
      if (e.target.closest('.fluxo-editor')) return;
      const caixa = !e.ctrlKey && e.target.closest('.fluxo-conteudo');
      if (caixa && caixa.scrollHeight > caixa.clientHeight) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const p = pontoDaTela(e); s.vista = F.zoomEm(s.vista, Math.exp(-e.deltaY * 0.002), p.x, p.y); }
      else { const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY; s.vista = { ...s.vista, x: s.vista.x - dx, y: s.vista.y - dy }; }
      aplicarVista(); guardarVista();
    }, { passive: false });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if (e.key === ' ') { e.preventDefault(); espaco = true; raiz.classList.add('pan'); }
      else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); enquadrarTudo(); }
    });
    raiz.addEventListener('keyup', e => { if (e.key === ' ') { espaco = false; raiz.classList.remove('pan'); } });
    raiz.addEventListener('click', e => { if (e.target.closest('.fluxo-conteudo a')) e.preventDefault(); });
    raiz.querySelector('.fluxo-barra').addEventListener('click', e => {
      const acao = e.target.closest('[data-fluxo-acao]')?.dataset.fluxoAcao;
      if (acao === 'enquadrar') enquadrarTudo();
    });

    function desmontar() {
      if (!montados.has(inst)) return;
      montados.delete(inst);
      if (timerVista) { clearTimeout(timerVista); gravarVista(opcoes.chaveDaVista, id, s.vista); }
    }
    const inst = { desmontar, ocupado: () => !!gesto || !!editor };
    montados.add(inst);
    desenhar(); aplicarVista();
    return inst;
  }
  function desmontarTodos() { for (const m of [...montados]) m.desmontar(); }
  const ocupado = () => [...montados].some(m => m.ocupado());
  root.KiroFluxoTela = { montar, desmontarTodos, ocupado };
})(globalThis);
```

(`editor`, `previa` e `marca` já existem aqui porque o `pointercancel` e o `ocupado` os usam; as Tasks 7 e 8 passam a preenchê-los.)

- [ ] **Step 2: Carregar e servir o script**

`index.html`, logo depois de `<script src="fluxo.js"></script>`:

```html
    <script src="fluxo-tela.js"></script>
```

`server.mjs:23`, em `publicFiles`, depois de `'/fluxo.js'`:

```js
'/fluxo-tela.js': ['fluxo-tela.js', 'text/javascript'],
```

- [ ] **Step 3: Estilos** — acrescentar ao fim de `styles.css`:

```css
/* ---- Fluxo (canvas de ideias) ---- */
[data-fluxo-cor="1"] { --fluxo-cor:#e5484d; }
[data-fluxo-cor="2"] { --fluxo-cor:#f76b15; }
[data-fluxo-cor="3"] { --fluxo-cor:#e2a336; }
[data-fluxo-cor="4"] { --fluxo-cor:#46a758; }
[data-fluxo-cor="5"] { --fluxo-cor:#12a594; }
[data-fluxo-cor="6"] { --fluxo-cor:#8e4ec6; }
.cofre-nota-corpo.com-fluxo { padding:0; overflow:hidden; display:flex; }
.fluxo-host { flex:1 1 auto; min-width:0; min-height:0; display:flex; }
.fluxo { position:relative; flex:1 1 auto; min-height:60vh; overflow:hidden; outline:none; touch-action:none; user-select:none; background-color:var(--content-bg); background-image:radial-gradient(circle, var(--line) 1px, transparent 1.2px); }
.fluxo.pan, .fluxo.pan * { cursor:grab; }
.fluxo-mundo { position:absolute; left:0; top:0; width:0; height:0; transform-origin:0 0; }
.fluxo-setas { position:absolute; left:0; top:0; width:1px; height:1px; overflow:visible; }
.fluxo-seta-linha { fill:none; stroke:var(--fluxo-cor, var(--muted)); stroke-width:2; }
.fluxo-seta-alvo { fill:none; stroke:transparent; stroke-width:14; cursor:pointer; }
.fluxo-seta.selecionada .fluxo-seta-linha { stroke:var(--fluxo-cor, var(--acento)); stroke-width:3; }
.fluxo-seta-rotulo { fill:var(--ink); font-size:13px; paint-order:stroke; stroke:var(--content-bg); stroke-width:4px; pointer-events:none; }
.fluxo-seta-previa { fill:none; stroke:var(--acento); stroke-width:2; stroke-dasharray:6 4; pointer-events:none; }
.fluxo-seta-previa:not(.ativa) { display:none; }
.fluxo-cartao { position:absolute; box-sizing:border-box; border:2px solid var(--fluxo-cor, var(--line)); border-radius:10px; background:var(--panel); color:var(--ink); }
.fluxo-cartao[data-tipo="group"] { background:color-mix(in srgb, var(--fluxo-cor, var(--muted)) 8%, transparent); }
.fluxo-cartao.selecionado { box-shadow:0 0 0 2px var(--acento); }
.fluxo-conteudo { width:100%; height:100%; box-sizing:border-box; padding:10px 14px; overflow:auto; font-size:15px; line-height:1.5; }
.fluxo-conteudo > :first-child { margin-top:0; }
.fluxo-conteudo > :last-child { margin-bottom:0; }
.fluxo-arquivo, .fluxo-link { color:var(--muted); word-break:break-all; }
.fluxo-grupo-rotulo { position:absolute; bottom:100%; left:0; padding-bottom:4px; font-size:14px; color:var(--muted); white-space:nowrap; }
.fluxo-alca { position:absolute; width:12px; height:12px; border-radius:50%; background:var(--acento); opacity:0; transform:translate(-50%, -50%); cursor:crosshair; transition:opacity var(--rapido); }
.fluxo-alca[data-lado="top"] { left:50%; top:0; }
.fluxo-alca[data-lado="bottom"] { left:50%; top:100%; }
.fluxo-alca[data-lado="left"] { left:0; top:50%; }
.fluxo-alca[data-lado="right"] { left:100%; top:50%; }
.fluxo-cartao:hover > .fluxo-alca, .fluxo-cartao.selecionado > .fluxo-alca { opacity:1; }
.fluxo-canto { position:absolute; right:-4px; bottom:-4px; width:14px; height:14px; cursor:nwse-resize; }
.fluxo-marca { position:absolute; border:calc(1px / var(--zoom, 1)) dashed var(--acento); background:color-mix(in srgb, var(--acento) 10%, transparent); pointer-events:none; }
.fluxo-barra { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); display:flex; gap:4px; align-items:center; padding:4px; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
.fluxo-zoom { min-width:56px; border:0; background:none; color:var(--muted); font:inherit; cursor:pointer; }
.fluxo-erro { max-width:var(--leitura); margin:40px auto; padding:0 24px; color:var(--muted); }
.tree-tipo { flex:0 0 auto; margin-left:auto; padding-left:8px; font-size:10px; letter-spacing:.06em; color:var(--muted); }
```

- [ ] **Step 4: Ícone, estado inicial, busca e árvore em `app.js`**

Em `TRACOS` (linha ~307), acrescentar:

```js
  fluxo: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h2.5a2 2 0 0 1 2 2v5"/>',
```

Linha 3, estado inicial com `fluxos`:

```js
let state = { notes: [], tasks: [], habits: [], habitLog: {}, folders: [], fluxos: [] };
```

Depois de `function getNote(id) { ... }` (linha 24):

```js
function getFluxo(id) { return (state.fluxos || []).find(f => f.id === id); }
```

Depois de `const folderNotes = ...` (linha 301):

```js
const folderFluxos = id => (state.fluxos || []).filter(f => (f.folderId || "") === id).sort(byTitle);
```

Em `treeMarkup`: a pasta conta fluxos como filhos, e os fluxos vêm depois das notas. Trocar a linha de `temFilhos`:

```js
    const temFilhos = childFolders(folder.id).length || folderNotes(folder.id).length || folderFluxos(folder.id).length;
```

e trocar `return folders + notes;` por:

```js
  const ativo = KiroAbas.notaAtiva(abas);
  const fluxos = folderFluxos(parentId).map(f => `<div class="tree-row tree-fluxo${ativo === f.id ? " ativa" : ""}" data-action="abrir-fluxo" data-id="${f.id}" style="--depth:${depth}"><span class="twisty"></span><span class="tree-icone">${icone('fluxo')}</span><span class="tree-name" title="${escapeHtml(f.title)}">${escapeHtml(f.title)}</span><span class="tree-tipo">FLUXO</span></div>`).join("");
  return folders + notes + fluxos;
```

- [ ] **Step 5: Abas e coluna mostram o fluxo**

`tituloDaAba` (linha ~581): trocar a última linha por:

```js
  const nota = getNote(id);
  if (nota) return nota.title || 'Sem título';
  return getFluxo(id)?.title || 'Sem título';
```

`conteudoMetade(painel)`: logo na primeira linha da função:

```js
  const doFluxo = abas.paineis[painel]?.ativa;
  if (doFluxo && getFluxo(doFluxo)) return fluxoHostMarkup(getFluxo(doFluxo), painel);
```

`metadeMarkup(painel)`: marcar a coluna que mostra um fluxo:

```js
function metadeMarkup(painel) {
  const comFluxo = getFluxo(abas.paineis[painel]?.ativa) ? ' com-fluxo' : '';
  return `<section class="cofre-metade${abas.ativo === painel ? ' ativa' : ''}" data-painel="${painel}" style="flex-grow:${abas.larguras[painel]}">${barraDeAbas(painel)}<div class="cofre-nota-corpo${comFluxo}">${conteudoMetade(painel)}</div></section>`;
}
```

Depois de `metadeMarkup`, o markup e a montagem:

```js
// Coluna com um fluxo: o editor é montado depois do innerHTML (bindView → montarFluxos).
function fluxoHostMarkup(fluxo, painel) {
  if (fluxo.erro) return `<div class="fluxo-erro"><h2>${escapeHtml(fluxo.title)}</h2><p>Este fluxo não pôde ser lido e não será alterado pelo Kiro.</p><p><code>${escapeHtml(fluxo.erro)}</code></p></div>`;
  return `<div class="fluxo-host" data-fluxo="${escapeHtml(fluxo.id)}" data-painel="${painel}"></div>`;
}
function montarFluxos() {
  for (const host of document.querySelectorAll('.fluxo-host')) {
    const fluxo = getFluxo(host.dataset.fluxo);
    if (!fluxo?.canvas) continue;
    KiroFluxoTela.montar(host, {
      id: fluxo.id, titulo: fluxo.title, canvas: fluxo.canvas,
      markdown: renderizarMarkdown, icone,
      menu: (evento, itens) => abrirMenuContexto(evento, document.body, itens),
      chaveDaVista: 'kiro.fluxoVista:' + (state.vaultPath || ''),
      aoMudar: canvas => mudarFluxo(fluxo.id, canvas),
    });
  }
}
```

`renderCofre()`: as abas aceitam ids de fluxo. Trocar:

```js
  abas = KiroAbas.limpar(abas, state.notes.map(n => n.id));
```

por:

```js
  abas = KiroAbas.limpar(abas, [...state.notes.map(n => n.id), ...(state.fluxos || []).map(f => f.id)]);
```

`bindView()`, no ramo `studies`, logo depois de `bindPainelDireito();`:

```js
    montarFluxos();
```

`render()`: primeira linha da função:

```js
  KiroFluxoTela.desmontarTodos(); // grava o texto em edição no estado antes de a tela ser refeita
```

- [ ] **Step 6: Abrir, criar, renomear e mover fluxos**

`abrirPorId` (linha ~1215):

```js
function abrirPorId(id,opcoes){ const nota=getNote(id); if(nota)return abrirNota(nota,opcoes); const fluxo=getFluxo(id); return fluxo?abrirFluxo(fluxo,opcoes):Promise.resolve(); }
```

Logo depois de `abrirPorId`:

```js
// Abre um fluxo numa aba. A nota em edição é salva antes; um rascunho vazio some, como em abrirNota.
async function abrirFluxo(fluxo,{novaAba=false,painel,duplicar=false,colunaNova=false}={}){
  garantirAbasDoCofre();
  if(editing&&editorDirty&&!await salvarNota())return;
  if(editing&&!editing.id){const onde=abas.paineis.findIndex(p=>p.abas.includes(KiroAbas.RASCUNHO));if(onde!==-1)abas=KiroAbas.fechar(abas,onde,KiroAbas.RASCUNHO);}
  abas=KiroAbas.abrir(abas,fluxo.id,{novaAba,painel,duplicar,colunaNova});
  gravarAbas();
  editing=null;editorDirty=false;currentView='studies';render();
}
// Fluxo novo: "Sem título", "Sem título 1", … sem repetir nome (sem diferenciar maiúsculas) na pasta.
async function novoFluxo(folderId=''){
  if(busy||failed||!loaded)return;
  const usados=new Set((state.fluxos||[]).filter(f=>(f.folderId||'')===folderId).map(f=>Kiro.pathKey(f.title)));
  let title='Sem título',i=1;
  while(usados.has(Kiro.pathKey(title)))title=`Sem título ${i++}`;
  const fluxo={id:uid(),title,folderId,canvas:{nodes:[],edges:[]}};
  state.fluxos=[...(state.fluxos||[]),fluxo];
  if(folderId&&expanded)expanded.add(folderId);
  if(await save())await abrirFluxo(getFluxo(fluxo.id)||fluxo);
}
function fluxoModal(fluxo){
  modal('Renomear fluxo',`<form class="form" id="fluxo-form"><div class="field"><label for="fluxo-nome">Nome</label><input id="fluxo-nome" name="title" required value="${escapeHtml(fluxo.title)}" /><small class="small-muted">Vira o nome do arquivo .canvas: sem &lt; &gt; : " / \\ | ? * e sem ponto ou espaço no início ou no final.</small></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Salvar</button></div></form>`);
  $('#cancel').onclick=()=>closeModal();
  $('#fluxo-form').onsubmit=e=>{
    e.preventDefault();
    const title=new FormData(e.currentTarget).get('title').trim();
    if(!Kiro.validFolderName(title)){alert('Nome inválido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.');return;}
    const atual=getFluxo(fluxo.id);if(!atual)return void closeModal(true);
    if((state.fluxos||[]).some(f=>f.id!==atual.id&&(f.folderId||'')===(atual.folderId||'')&&Kiro.pathKey(f.title)===Kiro.pathKey(title))){alert('Já existe um fluxo com esse nome nesta pasta.');return;}
    state.fluxos=state.fluxos.map(f=>f.id===atual.id?{...f,title}:f);
    save();closeModal(true);
  };
}
async function moverFluxo(id,folderId){
  if(busy||failed||!loaded)return;
  const fluxo=getFluxo(id);
  if(!fluxo||(fluxo.folderId||'')===folderId)return;
  if((state.fluxos||[]).some(f=>f.id!==id&&(f.folderId||'')===folderId&&Kiro.pathKey(f.title)===Kiro.pathKey(fluxo.title)))return status('Já existe um fluxo com esse nome na pasta de destino.',true);
  if(folderId&&expanded)expanded.add(folderId);
  state.fluxos=state.fluxos.map(f=>f.id===id?{...f,folderId}:f);
  await save();
}
```

`action(...)`: acrescentar, junto das outras ações (depois de `if(type==="edit-note") ...`):

```js
if(type==="abrir-fluxo") abrirPorId(id,{novaAba:Boolean(evento?.ctrlKey||evento?.metaKey)});
```

`menuDaArvore(linha)`: antes do `if (linha.classList.contains('tree-note'))`, o menu de um fluxo:

```js
  if (linha.classList.contains('tree-fluxo')) {
    const fluxo = getFluxo(id);
    const destinos = [{ id: '', rotulo: 'Raiz do cofre' }, ...state.folders.slice().sort((a, b) => (a.path || a.title).localeCompare(b.path || b.title, 'pt-BR')).map(f => ({ id: f.id, rotulo: f.path || f.title }))];
    return [
      { rotulo: 'Abrir', icone: icone('fluxo'), acao: () => getFluxo(id) && abrirFluxo(getFluxo(id)) },
      // Fluxo com erro não é regravado pelo cofre: renomear ou mover não teriam efeito.
      ...(fluxo && !fluxo.erro ? [
        { rotulo: 'Renomear', icone: icone('renomear'), acao: () => getFluxo(id) && fluxoModal(getFluxo(id)) },
        { rotulo: 'Mover para', icone: icone('pastas'), filhos: destinos.map(d => ({ rotulo: d.rotulo, icone: icone(d.id ? 'pastas' : 'casa'), ativo: () => (getFluxo(id)?.folderId || '') !== d.id, acao: () => moverFluxo(id, d.id) })) },
      ] : []),
    ];
  }
```

e, no menu da pasta, depois de `{ rotulo: 'Nova nota aqui', ... }`:

```js
    { rotulo: 'Novo fluxo aqui', icone: icone('fluxo'), acao: () => novoFluxo(id) },
```

Botão de fluxo na raiz: em `renderCofre()`, dentro de `<span class="cofre-acoes">`, antes do botão `#add-folder`:

```html
        <button class="icon-button" id="add-fluxo" title="Novo fluxo">${icone('fluxo')}</button>
```

e em `bindView()`, junto de `#add-folder`:

```js
  document.querySelector('#add-fluxo')?.addEventListener('click',()=>novoFluxo(''));
```

- [ ] **Step 7: Salvamento com espera e proteção da releitura**

Perto das outras variáveis globais (linha ~1095, depois de `let expanded=null, ...`):

```js
// Mudança num fluxo vai direto para `state` e é gravada depois de uma pausa. Enquanto houver
// uma pendente, a releitura automática não roda (ela trocaria `state` e perderia a mudança).
let fluxoPendente=false, timerDoFluxo=null;
function mudarFluxo(id,canvas){
  state.fluxos=(state.fluxos||[]).map(f=>f.id===id?{...f,canvas}:f);
  fluxoPendente=true;status('Alterações não salvas');
  agendarFluxo();
}
function agendarFluxo(){
  clearTimeout(timerDoFluxo);
  timerDoFluxo=setTimeout(async()=>{
    // Não salvar no meio de um arraste ou de uma digitação: o salvamento redesenha a tela.
    if(KiroFluxoTela.ocupado()||busy)return agendarFluxo();
    if(failed)return;
    if(await save())fluxoPendente=false;
  },800);
}
```

`reload(manual)`: na primeira linha, acrescentar `fluxoPendente` e `KiroFluxoTela.ocupado()` às condições:

```js
  if(aguardandoCofre||busy||(!manual&&(failed||editorDirty||fluxoPendente||KiroFluxoTela.ocupado()||$('#modal-root').firstChild)))return;
  if(manual&&(failed||modalDirty||editorDirty||fluxoPendente)&&!confirm('Recarregar descarta alterações ainda não salvas nesta janela. Exporte seus dados ou copie o texto antes de continuar. Recarregar?'))return;
```

e, dentro do `try`, logo depois de `state=saved;loaded=true;failed=false;eventosDoCofre(null);`:

```js
    if(manual){fluxoPendente=false;clearTimeout(timerDoFluxo);}
```

`beforeunload` (linha ~4178): incluir `fluxoPendente`:

```js
window.addEventListener('beforeunload',e=>{if(busy||failed||modalDirty||editorDirty||fluxoPendente){e.preventDefault();e.returnValue='';}});
```

- [ ] **Step 8: Verificar no app**

Run: `npm test` → Expected: PASS.

Run: `npm run dev` (http://localhost:4180, cofre de exemplo). Conferir:
1. Pastas → botão direito numa pasta → "Novo fluxo aqui": aparece "Sem título" com a etiqueta FLUXO e abre numa aba com a grade de pontos. O arquivo `dev-vault/<pasta>/Sem título.canvas` existe e contém `{\n\t"nodes": [],\n\t"edges": []\n}`.
2. Criar um segundo: vira "Sem título 1".
3. Copiar para o cofre um `.canvas` feito no Obsidian, ou escrever à mão um com dois cartões de texto e uma seta, e recarregar (Configurações → Recarregar). Os cartões aparecem com Markdown renderizado e a seta ligando os dois. Ctrl+roda dá zoom no cursor, roda e Shift+roda rolam, espaço+arrastar e botão do meio movem a vista, e Shift+1 ou o botão de % enquadram tudo.
4. Fechar e reabrir a aba: a vista volta onde estava.
5. Renomear pelo menu da árvore: o arquivo muda de nome e a aba continua aberta. Mover para outra pasta: o arquivo muda de lugar.
6. Tentar renomear para `a/b` ou para o nome de outro fluxo da pasta: aparece o aviso e nada é gravado.
7. Um `.canvas` com `{nope`: aparece na árvore, abre com a mensagem de erro e o menu não oferece renomear nem mover.
8. **(Review Focus 3)** No console, rodar `mudarFluxo(state.fluxos[0].id, {...state.fluxos[0].canvas, nodes: []})` e, antes de 800 ms, editar o arquivo `.canvas` por fora. A releitura não roda enquanto `fluxoPendente` estiver ativo, e o salvamento seguinte recusa com "O cofre mudou em outro editor", como já acontece com as notas.
9. Abrir uma nota numa coluna e o fluxo em outra: a nota continua editável e o fluxo continua com pan e zoom.

- [ ] **Step 9: Commit**

```bash
git add fluxo-tela.js app.js index.html server.mjs styles.css
git commit -m "Fluxo: .canvas na árvore e nas abas, com pan, zoom e enquadrar"
```

---

### Task 7: Editor — cartões (criar, selecionar, mover, redimensionar, editar, apagar)

**Files:**
- Modify: `fluxo-tela.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `montar` da Task 6 (variáveis internas `s`, `canvas`, `gesto`, `editor`, `GESTOS`, `desenhar`, `desenharSetas`, `no`, `elDoCartao`, `pontoDoCanvas`, `pontoDaTela`, `tamanho`, `marca`, `cartoes`, `caminhos`, `raiz`).
- Produces (internas a `montar`, usadas pelas Tasks 8 e 9): `mudar(novo)`, `encaixar(v)`, `selecionar(ids)`, `marcarSelecao()`, `criarCartao(p) → id`, `editar(idNo)`, `terminarEdicao()`. `editor` passa a ser `{ concluir(gravar: boolean) }`.

- [ ] **Step 1: Funções de mudança, seleção e criação** — em `montar`, logo depois do bloco "Vista":

```js
    // ---- Mudanças ----
    function mudar(novo) {
      if (novo === canvas) return;
      s.historico = F.empilhar(s.historico, canvas);
      canvas = novo;
      desenhar();
      opcoes.aoMudar(canvas);
    }
    const encaixar = v => (s.grade ? F.encaixar(v) : Math.round(v));
    const encaixarPraCima = v => (s.grade ? Math.ceil(v / F.GRADE) * F.GRADE : Math.ceil(v));
    function marcarSelecao() {
      for (const el of cartoes.children) el.classList.toggle('selecionado', s.selecao.has(el.dataset.no));
      for (const el of caminhos.children) el.classList.toggle('selecionada', s.seta === el.dataset.seta);
    }
    function selecionar(ids) { s.selecao = new Set(ids); s.seta = null; marcarSelecao(); }
    function criarCartao(p) {
      const r = F.adicionarCartao(canvas, { type: 'text', text: '', x: encaixar(p.x - 130), y: encaixar(p.y - 30), width: 260, height: 60 });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      editar(r.id);
      return r.id;
    }
    // Editar texto: um <textarea> no lugar do conteúdo. Ao terminar, o cartão cresce se o
    // texto renderizado não couber (nunca encolhe sozinho).
    function editar(idNo) {
      const c = no(idNo), el = elDoCartao(idNo);
      if (!c || c.type !== 'text' || !el) return;
      terminarEdicao();
      const area = document.createElement('textarea');
      area.className = 'fluxo-editor';
      area.value = c.text;
      area.setAttribute('aria-label', 'Texto do cartão');
      el.querySelector('.fluxo-conteudo').replaceChildren(area);
      el.classList.add('editando');
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null;
        const atual = no(idNo);
        if (!gravar || !atual || area.value === atual.text) return void desenhar();
        let novo = F.editarCartao(canvas, idNo, { text: area.value });
        const medida = document.createElement('div');
        medida.className = 'fluxo-conteudo fluxo-medida';
        medida.style.width = `${atual.width}px`;
        medida.innerHTML = opcoes.markdown(area.value);
        cartoes.appendChild(medida);
        const altura = Math.ceil(medida.scrollHeight) + 4;   // + a borda do cartão
        medida.remove();
        if (altura > atual.height) novo = F.redimensionar(novo, idNo, atual.width, encaixarPraCima(altura));
        mudar(novo);
      };
      editor = { concluir };
      area.addEventListener('keydown', e => {
        e.stopPropagation();   // Delete, Ctrl+Z etc. são do texto, não do fluxo
        if (e.key === 'Escape') { e.preventDefault(); concluir(true); raiz.focus({ preventScroll: true }); }
      });
      area.addEventListener('blur', () => concluir(true));
      area.focus();
    }
    function terminarEdicao() { editor?.concluir(true); }
    function criarCartaoNoCentro() { const [w, h] = tamanho(); criarCartao(F.paraCanvas(s.vista, w / 2, h / 2)); }
```

- [ ] **Step 2: Gestos de mover, redimensionar e selecionar por retângulo**

Logo depois da declaração de `const GESTOS = { ... };`:

```js
    // Um toque sem arrastar (menos de 3 px na tela) não move nada nem vira passo de desfazer.
    const andou = (g, e) => g.andou || (g.andou = Math.hypot(pontoDaTela(e).x - g.tela0.x, pontoDaTela(e).y - g.tela0.y) >= 3);
    GESTOS.mover = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e), base = no(g.ids[0]);
        // Encaixa o cartão agarrado; os outros da seleção andam o mesmo tanto.
        g.dx = encaixar(base.x + p.x - g.p0.x) - base.x;
        g.dy = encaixar(base.y + p.y - g.p0.y) - base.y;
        g.previa = F.moverCartoes(canvas, g.ids, g.dx, g.dy);
        for (const idNo of g.ids) {
          const c = g.previa.nodes.find(x => x.id === idNo), el = elDoCartao(idNo);
          if (el) { el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; }
        }
        desenharSetas(g.previa);
      },
      soltar(g) { if (g.previa && (g.dx || g.dy)) mudar(g.previa); },
    };
    GESTOS.redimensionar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e), c = no(g.id);
        g.previa = F.redimensionar(canvas, g.id, encaixar(c.width + p.x - g.p0.x), encaixar(c.height + p.y - g.p0.y));
        const novo = g.previa.nodes.find(x => x.id === g.id), el = elDoCartao(g.id);
        if (el) { el.style.width = `${novo.width}px`; el.style.height = `${novo.height}px`; }
        desenharSetas(g.previa);
      },
      soltar(g) {
        const antes = no(g.id), depois = g.previa?.nodes.find(x => x.id === g.id);
        if (depois && (depois.width !== antes.width || depois.height !== antes.height)) mudar(g.previa);
      },
    };
    GESTOS.marcar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e);
        g.ret = { x: g.p0.x, y: g.p0.y, width: p.x - g.p0.x, height: p.y - g.p0.y };
        Object.assign(marca.style, { left: `${Math.min(g.p0.x, p.x)}px`, top: `${Math.min(g.p0.y, p.y)}px`, width: `${Math.abs(g.ret.width)}px`, height: `${Math.abs(g.ret.height)}px` });
        marca.hidden = false;
      },
      soltar(g) { marca.hidden = true; if (g.ret) selecionar([...new Set([...g.base, ...F.dentro(canvas.nodes, g.ret)])]); },
    };
```

Trocar `function escolherGesto(e) { ... }` inteira por:

```js
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      if (e.button !== 0) return null;
      const p = pontoDoCanvas(e), cartao = e.target.closest('.fluxo-cartao');
      if (cartao && e.target.closest('.fluxo-canto')) { selecionar([cartao.dataset.no]); return { tipo: 'redimensionar', id: cartao.dataset.no, p0: p }; }
      if (cartao) {
        const idNo = cartao.dataset.no;
        if (e.shiftKey) { const outra = new Set(s.selecao); if (outra.has(idNo)) outra.delete(idNo); else outra.add(idNo); selecionar([...outra]); return null; }
        if (!s.selecao.has(idNo)) selecionar([idNo]);
        return { tipo: 'mover', ids: [idNo, ...[...s.selecao].filter(x => x !== idNo)], p0: p };
      }
      const base = e.shiftKey ? [...s.selecao] : [];
      if (!e.shiftKey) selecionar([]);
      return { tipo: 'marcar', p0: p, base };
    }
```

- [ ] **Step 3: Dois cliques, teclado e botão da barra**

Depois dos listeners de `keyup`:

```js
    raiz.addEventListener('dblclick', e => {
      if (e.target.closest('.fluxo-barra, .fluxo-editor, .fluxo-seta')) return;
      const cartao = e.target.closest('.fluxo-cartao');
      if (cartao) editar(cartao.dataset.no);
      else criarCartao(pontoDoCanvas(e));
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selecao.size) { e.preventDefault(); e.stopPropagation(); mudar(F.removerCartoes(canvas, [...s.selecao])); }
      else if (e.key === 'Enter' && s.selecao.size === 1) { e.preventDefault(); editar([...s.selecao][0]); }
      else if (e.key === 'Escape') selecionar([]);
    });
```

Na barra: trocar a linha do `host.innerHTML` que monta `.fluxo-barra` por:

```js
  <div class="fluxo-barra"><button type="button" class="icon-button" data-fluxo-acao="cartao" title="Adicionar cartão (ou dois cliques no fundo)" aria-label="Adicionar cartão">${opcoes.icone('mais')}</button><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="Enquadrar tudo (Shift+1)">100%</button></div>
```

e no listener de clique da barra acrescentar:

```js
      if (acao === 'cartao') criarCartaoNoCentro();
```

Trocar `desmontar` para gravar o texto em edição:

```js
    function desmontar() {
      if (!montados.has(inst)) return;
      terminarEdicao();
      montados.delete(inst);
      if (timerVista) { clearTimeout(timerVista); gravarVista(opcoes.chaveDaVista, id, s.vista); }
    }
```

- [ ] **Step 4: Estilos da edição** — acrescentar ao bloco do Fluxo em `styles.css`:

```css
.fluxo-editor { display:block; width:100%; height:100%; box-sizing:border-box; resize:none; border:0; padding:0; background:transparent; color:inherit; font:inherit; line-height:inherit; outline:none; user-select:text; }
.fluxo-cartao.editando { box-shadow:0 0 0 2px var(--acento); }
.fluxo-cartao.editando > .fluxo-alca { display:none; }
.fluxo-medida { position:absolute; left:0; top:0; height:auto; visibility:hidden; pointer-events:none; }
```

- [ ] **Step 5: Rodar a suíte**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verificar no app** (`npm run dev`)

1. Dois cliques no fundo criam um cartão já em edição. Digitar `# Título` e texto com um bloco de código, depois Esc: o cartão renderiza e cresce para caber.
2. O botão + da barra cria um cartão no centro da vista.
3. Arrastar um cartão move em passos de 20 px e as setas acompanham. Shift+clique junta cartões na seleção, e arrastar um deles move todos. Arrastar no fundo desenha o retângulo de seleção.
4. O canto inferior direito redimensiona (mínimo 80×40).
5. Delete apaga a seleção junto com as setas ligadas. Enter edita o cartão selecionado.
6. **(Review Focus 2)** Começar a digitar num cartão e continuar por mais de 1 s: o salvamento não acontece enquanto a edição está aberta, o texto não some e o cursor não sai do lugar. Ao sair (Esc), o status passa por "Salvando…" e depois "Salvo no cofre". Repetir segurando um arraste por 2 s: o cartão não pula.
7. O `.canvas` no disco mostra o cartão com os campos `id`, `type`, `text`, `x`, `y`, `width` e `height`.

- [ ] **Step 7: Commit**

```bash
git add fluxo-tela.js styles.css
git commit -m "Fluxo: criar, selecionar, mover, redimensionar, editar e apagar cartões"
```

---

### Task 8: Editor — setas

**Files:**
- Modify: `fluxo-tela.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 7 (`mudar`, `encaixar`, `selecionar`, `marcarSelecao`, `editar`, `editor`, `GESTOS`), `F.OPOSTO`, `F.ligar`, `F.ladoMaisProximo`, `F.pontoDoLado`, `F.caminhoDaSeta`, `F.geometriaDaSeta`.
- Produces (internas): `selecionarSeta(id)` e `editarRotulo(id)`, usadas pelo menu da Task 9.

- [ ] **Step 1: Gesto de ligar e seleção de seta** — depois de `GESTOS.marcar = { ... };`:

```js
    function selecionarSeta(idSeta) { s.selecao = new Set(); s.seta = idSeta; marcarSelecao(); }
    GESTOS.ligar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const inicio = F.pontoDoLado(no(g.de), g.lado);
        previa.setAttribute('d', F.caminhoDaSeta(inicio, g.lado, pontoDoCanvas(e), F.OPOSTO[g.lado]).d);
        previa.classList.add('ativa');
      },
      soltar(g, e) {
        previa.classList.remove('ativa');
        if (!g.andou) return;
        const origem = no(g.de), saida = F.pontoDoLado(origem, g.lado);
        const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fluxo-cartao');
        if (alvo && raiz.contains(alvo)) {
          const destino = no(alvo.dataset.no);
          if (!destino || destino.id === origem.id) return;
          return void mudar(F.ligar(canvas, { fromNode: origem.id, fromSide: g.lado, toNode: destino.id, toSide: F.ladoMaisProximo(destino, saida) }).canvas);
        }
        // Soltar no vazio: cartão novo já ligado e em edição (o gesto mais rápido do mapa mental).
        const p = pontoDoCanvas(e), lado = F.OPOSTO[g.lado], largura = 260, altura = 60;
        const x = lado === 'left' ? p.x : lado === 'right' ? p.x - largura : p.x - largura / 2;
        const y = lado === 'top' ? p.y : lado === 'bottom' ? p.y - altura : p.y - altura / 2;
        const passo = F.adicionarCartao(canvas, { type: 'text', text: '', x: encaixar(x), y: encaixar(y), width: largura, height: altura });
        const ligado = F.ligar(passo.canvas, { fromNode: origem.id, fromSide: g.lado, toNode: passo.id, toSide: lado });
        s.selecao = new Set([passo.id]);
        mudar(ligado.canvas);   // um passo só de desfazer para cartão + seta
        editar(passo.id);
      },
    };
```

Trocar `escolherGesto` inteira por (alças e setas vêm antes dos cartões):

```js
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      if (e.button !== 0) return null;
      const p = pontoDoCanvas(e), cartao = e.target.closest('.fluxo-cartao'), alca = e.target.closest('.fluxo-alca'), seta = e.target.closest('.fluxo-seta');
      if (cartao && alca) return { tipo: 'ligar', de: cartao.dataset.no, lado: alca.dataset.lado };
      if (seta) { selecionarSeta(seta.dataset.seta); return null; }
      if (cartao && e.target.closest('.fluxo-canto')) { selecionar([cartao.dataset.no]); return { tipo: 'redimensionar', id: cartao.dataset.no, p0: p }; }
      if (cartao) {
        const idNo = cartao.dataset.no;
        if (e.shiftKey) { const outra = new Set(s.selecao); if (outra.has(idNo)) outra.delete(idNo); else outra.add(idNo); selecionar([...outra]); return null; }
        if (!s.selecao.has(idNo)) selecionar([idNo]);
        return { tipo: 'mover', ids: [idNo, ...[...s.selecao].filter(x => x !== idNo)], p0: p };
      }
      const base = e.shiftKey ? [...s.selecao] : [];
      if (!e.shiftKey) selecionar([]);
      return { tipo: 'marcar', p0: p, base };
    }
```

- [ ] **Step 2: Rótulo da seta e Delete**

Depois de `terminarEdicao`:

```js
    // Rótulo: um <input> sobre o meio da curva. Enter ou sair gravam; Esc desiste. Vazio tira o rótulo.
    function editarRotulo(idSeta) {
      const seta = canvas.edges.find(x => x.id === idSeta), g = seta && F.geometriaDaSeta(canvas.nodes, seta);
      if (!g) return;
      terminarEdicao();
      const campo = document.createElement('input');
      campo.className = 'fluxo-editor fluxo-rotulo-editor';
      campo.value = seta.label || '';
      campo.setAttribute('aria-label', 'Rótulo da seta');
      Object.assign(campo.style, { left: `${g.meio.x}px`, top: `${g.meio.y}px` });
      mundo.appendChild(campo);
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null; campo.remove();
        const label = campo.value.trim() || undefined;
        if (gravar && label !== seta.label) mudar(F.editarSeta(canvas, idSeta, { label }));
      };
      editor = { concluir };
      campo.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); concluir(e.key === 'Enter'); raiz.focus({ preventScroll: true }); }
      });
      campo.addEventListener('blur', () => concluir(true));
      campo.focus(); campo.select();
    }
```

Depois do listener de `dblclick` da Task 7:

```js
    raiz.addEventListener('dblclick', e => { const seta = e.target.closest('.fluxo-seta'); if (seta) editarRotulo(seta.dataset.seta); });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz || !s.seta || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      e.preventDefault(); e.stopPropagation();
      mudar(F.removerSetas(canvas, [s.seta]));
    });
```

- [ ] **Step 3: Estilo do campo de rótulo** — acrescentar ao bloco do Fluxo em `styles.css`:

```css
.fluxo-rotulo-editor { position:absolute; width:180px; height:auto; transform:translate(-50%, -50%); padding:4px 8px; border:1px solid var(--acento); border-radius:6px; background:var(--panel); text-align:center; font-size:13px; }
```

- [ ] **Step 4: Rodar a suíte**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verificar no app** (`npm run dev`)

1. Passar o mouse num cartão mostra 4 alças. Arrastar de uma até outro cartão cria a seta, que chega pelo lado mais próximo.
2. Arrastar de uma alça até o vazio cria um cartão novo, já ligado e em edição. Ctrl+Z vem na Task 9; por ora, conferir no `.canvas` que o cartão e a seta foram gravados juntos.
3. Clicar na seta a seleciona (linha mais grossa) e Delete a apaga.
4. Dois cliques na seta abrem o rótulo. Enter grava, Esc desiste e rótulo vazio remove.
5. Soltar uma alça sobre o próprio cartão não cria nada.
6. Com o fluxo aberto em duas colunas (arrastar a aba para a borda), as pontas de seta aparecem nas duas colunas (os ids de `<marker>` não colidem).

- [ ] **Step 6: Commit**

```bash
git add fluxo-tela.js styles.css
git commit -m "Fluxo: ligar cartões com setas, com rótulo"
```

---

### Task 9: Editor — desfazer, menus, cores e grade

**Files:**
- Modify: `fluxo-tela.js`
- Modify: `app.js` (ícones `desfazer`/`refazer`)

**Interfaces:**
- Consumes: Tasks 7 e 8; `opcoes.menu(evento, itens)` (itens no formato do `abrirMenuContexto`: `{ rotulo, icone (svg), acao, ativo?, filhos?, separador? }`); `opcoes.icone(nome)`.
- Produces: `desfazer()`, `refazer()` e os menus de fundo, cartão e seta.

- [ ] **Step 1: Ícones** — em `TRACOS` (`app.js`):

```js
  desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  refazer: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
```

- [ ] **Step 2: Desfazer e refazer** — em `fluxo-tela.js`, depois de `mudar`:

```js
    function voltar(fn) {
      const r = fn(s.historico, canvas);
      if (!r) return;
      terminarEdicao();
      s.historico = r.historico; canvas = r.canvas;
      desenhar(); opcoes.aoMudar(canvas);
    }
    const desfazer = () => voltar(F.desfazer), refazer = () => voltar(F.refazer);
```

(`terminarEdicao` pode chamar `mudar`, que empilha. Por isso ela roda **depois** de `fn` já ter calculado o passo e **antes** de aplicá-lo. Uma edição aberta é gravada e desfeita pelo mesmo Ctrl+Z seguinte, que é o comportamento esperado.)

Teclado, depois dos outros `keydown`:

```js
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz || !(e.ctrlKey || e.metaKey)) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); desfazer(); }
      else if (tecla === 'y' || (tecla === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); refazer(); }
    });
```

- [ ] **Step 3: Menus** — depois de `editarRotulo`:

```js
    // ---- Menus do botão direito ----
    const NOMES_DAS_CORES = { '': 'Sem cor', 1: 'Vermelho', 2: 'Laranja', 3: 'Amarelo', 4: 'Verde', 5: 'Ciano', 6: 'Roxo' };
    const bolinha = cor => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" class="fluxo-bolinha"${corData(cor)} style="${corCss(cor)}"/></svg>`;
    const itensDaCor = aplicar => ['', ...F.CORES].map(cor => ({ rotulo: NOMES_DAS_CORES[cor], icone: bolinha(cor), acao: () => aplicar(cor || undefined) }));
    function menuDoFundo(p) {
      return [
        { rotulo: 'Adicionar cartão', icone: opcoes.icone('mais'), acao: () => criarCartao(p) },
        { separador: true },
        { rotulo: 'Desfazer', icone: opcoes.icone('desfazer'), ativo: () => s.historico.antes.length > 0, acao: desfazer },
        { rotulo: 'Refazer', icone: opcoes.icone('refazer'), ativo: () => s.historico.depois.length > 0, acao: refazer },
        { separador: true },
        { rotulo: 'Encaixar na grade', icone: s.grade ? opcoes.icone('marcado') : '', acao: () => { s.grade = !s.grade; } },
        { rotulo: 'Enquadrar tudo', icone: opcoes.icone('expandir'), acao: enquadrarTudo },
      ];
    }
    function menuDoCartao(idNo) {
      if (!s.selecao.has(idNo)) selecionar([idNo]);
      const ids = [...s.selecao];
      return [
        { rotulo: 'Cor', icone: bolinha(no(idNo)?.color), filhos: itensDaCor(cor => mudar(ids.reduce((c, x) => F.editarCartao(c, x, { color: cor }), canvas))) },
        { rotulo: 'Duplicar', icone: opcoes.icone('copiar'), acao: () => { const r = F.duplicarCartoes(canvas, ids); s.selecao = new Set(r.ids); mudar(r.canvas); } },
        ...(ids.length === 1 && no(idNo)?.type === 'text' ? [{ rotulo: 'Editar texto', icone: opcoes.icone('renomear'), acao: () => editar(idNo) }] : []),
        { separador: true },
        { rotulo: ids.length > 1 ? `Excluir ${ids.length} cartões` : 'Excluir', icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerCartoes(canvas, ids)) },
      ];
    }
    function menuDaSeta(idSeta) {
      selecionarSeta(idSeta);
      const muda = campos => mudar(F.editarSeta(canvas, idSeta, campos));
      return [
        { rotulo: 'Cor', icone: bolinha(canvas.edges.find(x => x.id === idSeta)?.color), filhos: itensDaCor(cor => muda({ color: cor })) },
        { rotulo: 'Direção', icone: opcoes.icone('direita'), filhos: [
          { rotulo: 'Ponta no fim (→)', icone: '→', acao: () => muda({ fromEnd: undefined, toEnd: undefined }) },
          { rotulo: 'Pontas nos dois lados (↔)', icone: '↔', acao: () => muda({ fromEnd: 'arrow', toEnd: undefined }) },
          { rotulo: 'Sem pontas (—)', icone: '—', acao: () => muda({ fromEnd: undefined, toEnd: 'none' }) },
        ] },
        { rotulo: 'Editar rótulo', icone: opcoes.icone('renomear'), acao: () => editarRotulo(idSeta) },
        { separador: true },
        { rotulo: 'Excluir', icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerSetas(canvas, [idSeta])) },
      ];
    }
    raiz.addEventListener('contextmenu', e => {
      if (e.target.closest('.fluxo-editor, .fluxo-barra')) return;
      e.stopPropagation();
      terminarEdicao();
      const cartao = e.target.closest('.fluxo-cartao'), seta = e.target.closest('.fluxo-seta');
      opcoes.menu(e, cartao ? menuDoCartao(cartao.dataset.no) : seta ? menuDaSeta(seta.dataset.seta) : menuDoFundo(pontoDoCanvas(e)));
    });
```

(`JSON Canvas` define `toEnd` padrão `arrow` e `fromEnd` padrão `none`: "Ponta no fim" apaga os dois campos, e o arquivo fica igual ao que o Obsidian grava.)

- [ ] **Step 4: Estilo da bolinha** — acrescentar ao bloco do Fluxo em `styles.css`:

```css
.fluxo-bolinha { fill:var(--fluxo-cor, none); stroke:var(--muted); }
```

- [ ] **Step 5: Rodar a suíte**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verificar no app** (`npm run dev`)

1. Criar, mover, ligar e apagar alguns cartões. Ctrl+Z desfaz cada passo, e Ctrl+Y ou Ctrl+Shift+Z refazem. O desfazer continua funcionando depois de um salvamento (a tela foi redesenhada, mas a sessão continua).
2. Botão direito no fundo abre o menu com Adicionar cartão, Desfazer/Refazer (cinza quando não há passo), Encaixar na grade ✓ e Enquadrar tudo. Desligar a grade faz os cartões moverem sem saltos de 20 px.
3. Botão direito num cartão: a cor pinta a borda, e em vários selecionados pinta todos. Duplicar copia os cartões e as setas entre eles. Excluir funciona.
4. Botão direito numa seta: a cor pinta a linha e a ponta, e Direção troca → / ↔ / —. Editar rótulo e Excluir funcionam.
5. Abrir o `.canvas` gravado: `color` é `"1"`–`"6"` e as pontas usam `fromEnd`/`toEnd` só quando diferem do padrão.
6. Se o Obsidian estiver instalado, abrir o mesmo cofre nele: o fluxo aparece com as mesmas cores, setas e rótulos.

- [ ] **Step 7: Commit**

```bash
git add fluxo-tela.js app.js styles.css
git commit -m "Fluxo: desfazer, menus do botão direito, cores e direção das setas"
```

---

### Task 10: Documentação e grafo

**Files:**
- Modify: `README.md`
- Regenerate: `graphify-out/`

- [ ] **Step 1: README** — acrescentar uma seção curta, junto das outras funcionalidades:

```markdown
### Fluxo

Canvas de ideias para mapas mentais: cartões de texto em Markdown (com código e fórmulas),
setas com rótulo e cor, pan, zoom e desfazer. Cada fluxo é um arquivo `.canvas` no formato
aberto [JSON Canvas](https://jsoncanvas.org), compatível com o Obsidian. Crie um pelo botão
direito numa pasta ("Novo fluxo aqui") ou pelo botão de fluxo no topo da árvore.

Atalhos dentro do fluxo: dois cliques no fundo criam um cartão; arraste de uma alça para ligar
(soltar no vazio cria um cartão já ligado); Ctrl+roda dá zoom; espaço+arrastar move a vista;
Shift+1 enquadra tudo; Delete apaga; Ctrl+Z/Ctrl+Y desfazem e refazem.
```

- [ ] **Step 2: Atualizar o grafo do projeto** (pedido pelo `CLAUDE.md`)

Run: `/graphify . --update`
Expected: `graphify-out/GRAPH_REPORT.md` passa a citar `fluxo.js` e `fluxo-tela.js`.

- [ ] **Step 3: Suíte final**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md graphify-out
git commit -m "Fluxo: documentação e grafo do projeto atualizados"
```
