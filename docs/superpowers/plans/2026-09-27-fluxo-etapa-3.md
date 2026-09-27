# Fluxo — Etapa 3 (IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma IA externa, via MCP, consegue listar, ler, criar e alterar fluxos: ela manda a estrutura (cartões e ligações) e o Kiro posiciona com o layout automático em árvore, ou encaixa cartões novos perto dos existentes sem mexer neles.

**Architecture:** As regras de posição são puras e ficam em `fluxo.js` (`tamanhoPadrao`, `raizDe`, `layout`, `inserirPerto`, e `novoId` passa a ser exportado). A Agent API (`agent/api.cjs`) ganha `listFluxos`, `readFluxo`, `createFluxo` e `updateFluxo`, todas pelo mesmo `#mutate` → `Vault.save` das notas (tudo-ou-nada, com nova tentativa em conflito). O catálogo (`agent/tools.cjs`) publica as quatro ferramentas; o MCP já publica tudo o que está no catálogo com o prefixo `kiro_`. O editor (`fluxo-tela.js`) só ganha o ajuste de altura dos cartões de texto na primeira abertura.

**Tech Stack:** JavaScript puro sem build, `node --test`, Electron 44 / servidor Node local. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-23-fluxo-design.md` — esta é a etapa 3 da seção "Etapas" (seções "Ferramentas para a IA" e "Layout automático"). As decisões das etapas 1 e 2 continuam valendo.

## Global Constraints

- Interface, código, comentários, mensagens de erro, descrições das ferramentas e commits em português do Brasil. Todo commit termina com uma linha em branco e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sem dependências novas; sem framework; sem build.
- O Kiro nunca chama IA por conta própria: só expõe ferramentas.
- Ferramentas: `list_fluxos` (`read`), `read_fluxo` (`read`), `create_fluxo` (`create`), `update_fluxo` (`update`). Risco: `read` para as duas primeiras, `write` para as duas últimas.
- Limites: 300 cartões por lista (`nodes`, `add_nodes`, `update_nodes`, `remove_nodes`) e 5.000 caracteres por campo de texto de cartão ou de rótulo.
- Toda chamada é tudo-ou-nada: qualquer erro vira `AgentError` com a mensagem do que corrigir, e nada é gravado.
- A gravação passa pelo mesmo `Vault.save` (via `#mutate`), com a mesma trava, a mesma checagem de revisão e o mesmo histórico.
- Layout: árvore da esquerda para a direita; 80 px entre colunas, 20 px entre irmãos; pai centrado no ramo; cartões fora da árvore numa fileira embaixo; tudo na grade de 20 px.
- Tamanhos padrão de um cartão sem tamanho: texto 280 × altura estimada (encaixada para cima na grade); nota 400×280; imagem 320×240; link 320×100; grupo 400×300.
- Ids reais: 16 caracteres hexadecimais, como os que a tela cria. O `id` que a IA manda é só um apelido; a resposta devolve `ids: { apelido: idReal }`.
- Link: só `http:` e `https:` (`safeUrl` do `domain.js`). Cor: `"1"`–`"6"` ou `#rrggbb` (`KiroFluxo.corValida`).
- Fluxo com `erro` (arquivo `.canvas` corrompido): a IA não lê nem altera (`FLUXO_INVALID`), e o arquivo continua intocado.

## Ajustes feitos ao planejar

- **`notasCitadas` não será criado.** O backlink ("Aparece nos fluxos") já é feito pelo `fluxosQueCitam` do `domain.js` desde a etapa 2.
- **"Só a primeira seta que chega a um cartão conta"** vira: busca em largura a partir da raiz, percorrendo as setas na ordem da lista. Cada cartão entra na árvore pela primeira seta que o alcança; as outras (ciclos, ligações cruzadas) são ignoradas no cálculo.
- **`read_fluxo`** devolve `type: "file"` com `file` para cartões de arquivo que não são nota (imagens), e `color` nas ligações quando houver.
- **`add_edges` / `edges` / `remove_edges`:** até 600 itens (uma árvore de 300 cartões já tem 299 ligações).
- **"Ajustada ao conteúdo real na primeira vez que o fluxo abre no Kiro"** = quando não há vista guardada para aquele fluxo no `localStorage` do cofre. Os cartões só crescem, e o ajuste fica fora do desfazer.
- **Sem fachada `kiro.fluxos.*`** na `KiroAgentApi`: ninguém a chamaria. As ferramentas chamam os métodos direto.

## Review Focus

1. **A IA altera um fluxo que está aberto no Kiro com uma mudança ainda não salva na tela.** Esperado: o salvamento do Kiro esbarra na revisão e mostra o aviso de sempre ("O cofre mudou em outro editor…"). Não sobrescreve o que a IA gravou e não descarta a edição em silêncio. Verificação manual na Task 6.
2. **Nota com o mesmo título em duas pastas, citada pela IA.** Esperado: por caminho, vai para a nota certa; por título, para uma das duas, e nunca para uma inexistente. Coberto na Task 4.
3. **Canvas feito no Obsidian, com campos que o Kiro não conhece, alterado pela IA.** Esperado: os campos extras voltam intactos. Coberto na Task 5.
4. **Pedido com parte válida e parte inválida** (ligação para apelido inexistente, texto longo demais, nota que não existe). Esperado: nada é gravado e a revisão do cofre não muda. Coberto nas Tasks 4 e 5.
5. **Texto de cartão vindo da IA com HTML ou `<script>`.** Esperado: aparece escapado, porque o cartão passa pelo `renderizarMarkdown`. Verificação manual na Task 6.

---

## Mapa de arquivos

| Arquivo | Papel nesta etapa |
|---|---|
| `fluxo.js` | `tamanhoPadrao`, `raizDe`, `layout`, `inserirPerto`; exportar `novoId` |
| `tests/fluxo.test.cjs` | Testes de layout e de `inserirPerto` |
| `agent/api.cjs` | `listFluxos`, `readFluxo`, `createFluxo`, `updateFluxo` e os validadores da entrada da IA |
| `agent/tools.cjs` | As quatro ferramentas no catálogo |
| `agent/events.cjs` | Eventos `fluxo.created` e `fluxo.updated` |
| `tests/agent.test.cjs` | Testes das ferramentas |
| `tests/mcp.test.cjs` | As quatro aparecem publicadas com `kiro_` |
| `fluxo-tela.js` | Altura dos cartões de texto ajustada na primeira abertura |
| `docs/agent-api.md`, `docs/mcp.md`, `README.md` | Documentação |

---

### Task 1: Layout automático em árvore (`fluxo.js`)

**Files:**
- Modify: `fluxo.js` (funções novas antes de `const api = …`; acrescentar ao `api`)
- Test: `tests/fluxo.test.cjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `alturaEstimada(texto)`, `ehImagem(caminho)`, `encaixar(v)` e `GRADE`, que já estão em `fluxo.js`.
- Produces (em `KiroFluxo` / `require('./fluxo.js')`):
  - `tamanhoPadrao(cartao: { type, text?, file? }) → { width, height }`
  - `raizDe(nodes, edges) → id | undefined`: o primeiro cartão sem seta chegando de outro cartão existente; se todos têm, o primeiro da lista.
  - `layout(nodes: { id, width, height }[], edges: { fromNode, toNode }[], { raiz }?) → Map<id, { x, y }>`

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/fluxo.test.cjs`)

```js
// ---- Etapa 3: layout ----
const caixa = (id, width = 280, height = 60) => ({ id, width, height });
const seta = (fromNode, toNode) => ({ fromNode, toNode });
const posicoesDe = mapa => Object.fromEntries([...mapa].map(([id, p]) => [id, p]));

test('tamanhoPadrao: texto 280 × altura estimada na grade; nota, imagem, link e grupo com os tamanhos da tela', () => {
  assert.deepEqual(F.tamanhoPadrao({ type: 'text', text: 'curto' }), { width: 280, height: 60 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'text', text: 'x'.repeat(100) }), { width: 280, height: 100 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'file', file: 'Estudos/Python.md' }), { width: 400, height: 280 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'file', file: 'anexos/foto.png' }), { width: 320, height: 240 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'link', url: 'https://a.b' }), { width: 320, height: 100 });
  assert.deepEqual(F.tamanhoPadrao({ type: 'group' }), { width: 400, height: 300 });
});

test('layout: colunas da esquerda para a direita, pai centrado no ramo, irmãos a 20 px, na grade', () => {
  const nodes = [caixa('r'), caixa('a', 280, 100), caixa('b'), caixa('a1', 280, 140), caixa('a2')];
  const edges = [seta('r', 'a'), seta('r', 'b'), seta('a', 'a1'), seta('a', 'a2')];
  // Ramo de a = 140 + 20 + 60 = 220; ramo de r = 220 + 20 + 60 = 300.
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), {
    r: { x: 0, y: 120 },
    a: { x: 360, y: 60 },
    b: { x: 360, y: 240 },
    a1: { x: 720, y: 0 },
    a2: { x: 720, y: 160 },
  });
});

test('layout: raiz implícita é o primeiro sem seta chegando; raiz explícita manda', () => {
  const nodes = [caixa('b'), caixa('a')];
  const edges = [seta('a', 'b')];
  assert.equal(F.raizDe(nodes, edges), 'a');
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), { a: { x: 0, y: 0 }, b: { x: 360, y: 0 } });
  // Com raiz "b", "a" não é alcançado pelas setas e vai para a fileira de baixo.
  assert.deepEqual(posicoesDe(F.layout(nodes, edges, { raiz: 'b' })), { b: { x: 0, y: 0 }, a: { x: 0, y: 140 } });
});

test('layout: ciclo não trava; só a primeira seta que alcança o cartão conta', () => {
  const nodes = [caixa('a'), caixa('b'), caixa('c')];
  const edges = [seta('a', 'b'), seta('b', 'c'), seta('c', 'a')];
  assert.equal(F.raizDe(nodes, edges), 'a');   // todos têm seta chegando: o primeiro
  assert.deepEqual(posicoesDe(F.layout(nodes, edges)), { a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, c: { x: 720, y: 0 } });
});

test('layout: cartões fora da árvore ficam numa fileira embaixo; vazio não quebra', () => {
  const nodes = [caixa('a'), caixa('b'), caixa('c'), caixa('d')];
  assert.deepEqual(posicoesDe(F.layout(nodes, [seta('a', 'b')])), {
    a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, c: { x: 0, y: 140 }, d: { x: 300, y: 140 },
  });
  assert.equal(F.layout([], []).size, 0);
});

test('layout: nenhum cartão se sobrepõe, mesmo com alturas fora da grade', () => {
  const nodes = [caixa('r', 280, 70), caixa('a', 280, 130), caixa('b', 280, 50), caixa('c', 280, 90),
    caixa('a1', 280, 110), caixa('a2', 280, 30), caixa('c1', 280, 250), caixa('solto', 280, 45)];
  const edges = [seta('r', 'a'), seta('r', 'b'), seta('r', 'c'), seta('a', 'a1'), seta('a', 'a2'), seta('c', 'c1')];
  const pos = F.layout(nodes, edges);
  const postos = nodes.map(n => ({ ...n, ...pos.get(n.id) }));
  for (let i = 0; i < postos.length; i++) for (let j = i + 1; j < postos.length; j++) {
    const [p, q] = [postos[i], postos[j]];
    assert.ok(!(p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height), `${p.id} e ${q.id} se sobrepõem`);
  }
  for (const p of postos) assert.ok(p.x % 20 === 0 && p.y % 20 === 0, `${p.id} fora da grade`);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL com `F.tamanhoPadrao is not a function` (e o mesmo para `layout`/`raizDe`).

- [ ] **Step 3: Implementar** (em `fluxo.js`, logo depois de `alturaEstimada` e antes de `const api = …`)

```js
  // ---- Layout automático (IA) ----
  const LARGURA_PADRAO = 280, ENTRE_COLUNAS = 80, ENTRE_IRMAOS = 20;
  const praCima = v => Math.ceil(v / GRADE) * GRADE;
  // Tamanho de um cartão que chega sem tamanho (da IA): o mesmo dos cartões criados na tela.
  function tamanhoPadrao(c) {
    if (c.type === 'text') return { width: LARGURA_PADRAO, height: praCima(alturaEstimada(c.text ?? '')) };
    if (c.type === 'file') return ehImagem(c.file) ? { width: 320, height: 240 } : { width: 400, height: 280 };
    if (c.type === 'link') return { width: 320, height: 100 };
    return { width: 400, height: 300 };
  }
  // Raiz implícita: o primeiro cartão sem seta chegando de outro; se todos têm, o primeiro.
  function raizDe(nodes, edges) {
    const ids = new Set(nodes.map(n => n.id));
    const chegam = new Set(edges.filter(e => e.fromNode !== e.toNode && ids.has(e.fromNode)).map(e => e.toNode));
    return (nodes.find(n => !chegam.has(n.id)) || nodes[0])?.id;
  }
  // Árvore da esquerda para a direita: cada nível é uma coluna (80 px entre colunas), irmãos
  // empilhados a 20 px, e o pai centrado na altura do ramo, então nada se sobrepõe. Busca em
  // largura a partir da raiz, nas setas em ordem: cada cartão entra pela primeira seta que o
  // alcança, e as outras (ciclos, ligações cruzadas) não contam. Quem a raiz não alcança vai
  // para uma fileira embaixo. Recebe cartões com width/height; devolve Map id → { x, y }.
  function layout(nodes, edges, { raiz } = {}) {
    const posicoes = new Map();
    if (!nodes.length) return posicoes;
    const porId = new Map(nodes.map(n => [n.id, n]));
    const inicio = porId.has(raiz) ? raiz : raizDe(nodes, edges);
    const filhos = new Map([[inicio, []]]), nivel = new Map([[inicio, 0]]), fila = [inicio];
    while (fila.length) {
      const pai = fila.shift();
      for (const e of edges) {
        if (e.fromNode !== pai || !porId.has(e.toNode) || nivel.has(e.toNode)) continue;
        nivel.set(e.toNode, nivel.get(pai) + 1);
        filhos.get(pai).push(e.toNode);
        filhos.set(e.toNode, []);
        fila.push(e.toNode);
      }
    }
    const larguras = [];
    for (const [id, k] of nivel) larguras[k] = Math.max(larguras[k] || 0, porId.get(id).width);
    const colunas = [0];
    for (let k = 1; k < larguras.length; k++) colunas[k] = colunas[k - 1] + larguras[k - 1] + ENTRE_COLUNAS;
    const alturas = new Map();
    const somaDosFilhos = id => filhos.get(id).reduce((t, f) => t + alturas.get(f), 0) + ENTRE_IRMAOS * Math.max(0, filhos.get(id).length - 1);
    const alturaDoRamo = id => {
      for (const f of filhos.get(id)) alturaDoRamo(f);
      alturas.set(id, Math.max(porId.get(id).height, somaDosFilhos(id)));
    };
    alturaDoRamo(inicio);
    const posicionar = (id, topo) => {
      const h = alturas.get(id);
      posicoes.set(id, { x: encaixar(colunas[nivel.get(id)]), y: encaixar(topo + (h - porId.get(id).height) / 2) });
      let y = topo + (h - somaDosFilhos(id)) / 2;
      for (const f of filhos.get(id)) { posicionar(f, y); y += alturas.get(f) + ENTRE_IRMAOS; }
    };
    posicionar(inicio, 0);
    const fileira = alturas.get(inicio) + ENTRE_COLUNAS;
    let x = 0;
    for (const n of nodes) {
      if (posicoes.has(n.id)) continue;
      posicoes.set(n.id, { x: encaixar(x), y: encaixar(fileira) });
      x += n.width + ENTRE_IRMAOS;
    }
    return posicoes;
  }
```

E no `api`, acrescentar ao fim da lista: `tamanhoPadrao, raizDe, layout`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/fluxo.test.cjs`
Expected: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs
git commit -m "Fluxo: layout automático em árvore e tamanho padrão dos cartões

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `inserirPerto` e `novoId` exportado (`fluxo.js`)

**Files:**
- Modify: `fluxo.js`
- Test: `tests/fluxo.test.cjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `ENTRE_COLUNAS`, `ENTRE_IRMAOS`, `praCima` e `encaixar` (Task 1).
- Produces (em `KiroFluxo`):
  - `inserirPerto(c: canvas, novos: { id, width, height, … }[], edges: { fromNode, toNode }[]) → cartao[]`: os novos com `x`/`y`, na ordem em que foram colocados. `c.nodes` não é alterado.
  - `novoId(usados: Set<string>) → string` (16 hex; não acrescenta ao conjunto).

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/fluxo.test.cjs`)

```js
// ---- Etapa 3: inserirPerto ----
const noEm = (id, x, y, width = 280, height = 60) => ({ id, type: 'text', text: id, x, y, width, height });
const baseInserir = () => ({ nodes: [noEm('A', 0, 0), noEm('B', 360, 0)], edges: [{ id: 'e1', fromNode: 'A', toNode: 'B' }] });
const onde = (lista, id) => { const n = lista.find(x => x.id === id); return { x: n.x, y: n.y }; };

test('inserirPerto: à direita do pai, abaixo dos irmãos, sem mexer nos existentes', () => {
  const c = baseInserir(), antes = structuredClone(c);
  const postos = F.inserirPerto(c, [caixa('N')], [...c.edges, seta('A', 'N')]);
  assert.deepEqual(onde(postos, 'N'), { x: 360, y: 80 });
  assert.deepEqual(c, antes);
});

test('inserirPerto: desce até achar lugar livre quando outro cartão ocupa a vaga', () => {
  const c = baseInserir();
  c.nodes.push(noEm('C', 360, 80, 280, 100));
  assert.deepEqual(onde(F.inserirPerto(c, [caixa('N')], [...c.edges, seta('A', 'N')]), 'N'), { x: 360, y: 200 });
});

test('inserirPerto: sem seta vai para baixo de tudo; canvas vazio começa em 0,0', () => {
  assert.deepEqual(onde(F.inserirPerto(baseInserir(), [caixa('M')], baseInserir().edges), 'M'), { x: 0, y: 140 });
  assert.deepEqual(onde(F.inserirPerto({ nodes: [], edges: [] }, [caixa('M')], []), 'M'), { x: 0, y: 0 });
});

test('inserirPerto: pai novo que vem depois do filho na lista é posto antes dele', () => {
  const c = baseInserir();
  const postos = F.inserirPerto(c, [caixa('F'), caixa('P')], [...c.edges, seta('A', 'P'), seta('P', 'F')]);
  assert.deepEqual(onde(postos, 'P'), { x: 360, y: 80 });
  assert.deepEqual(onde(postos, 'F'), { x: 720, y: 80 });
});

test('novoId: 16 hex e fora dos usados', () => {
  const usados = new Set(['a'.repeat(16)]);
  const id = F.novoId(usados);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.ok(!usados.has(id));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL com `F.inserirPerto is not a function` e `F.novoId is not a function`.

- [ ] **Step 3: Implementar** (em `fluxo.js`, logo depois de `layout`)

```js
  const sobrepoe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Cartões novos (com tamanho, sem posição) entram sem mexer em nenhum que já está no canvas:
  // à direita do cartão de onde sai a primeira seta que chega a eles, abaixo dos irmãos; sem
  // seta, embaixo de tudo. Descem na grade até achar lugar livre. Devolve os novos posicionados.
  function inserirPerto(c, novos, edges) {
    const postos = [...c.nodes], lugar = new Map(postos.map(n => [n.id, n])), saida = [];
    const chegam = new Map();
    for (const e of edges) { if (!chegam.has(e.toNode)) chegam.set(e.toNode, []); chegam.get(e.toNode).push(e.fromNode); }
    const paiDe = n => (chegam.get(n.id) || []).map(id => lugar.get(id)).find(Boolean);
    const pendentes = [...novos];
    while (pendentes.length) {
      // Primeiro quem já tem o pai no lugar: um filho não vai parar embaixo de tudo só por ter
      // vindo antes do pai na lista.
      const [novo] = pendentes.splice(Math.max(0, pendentes.findIndex(n => paiDe(n))), 1);
      const pai = paiDe(novo);
      let x, y;
      if (pai) {
        x = pai.x + pai.width + ENTRE_COLUNAS;
        const irmaos = edges.filter(e => e.fromNode === pai.id).map(e => lugar.get(e.toNode)).filter(Boolean);
        y = Math.max(pai.y, ...irmaos.map(n => n.y + n.height + ENTRE_IRMAOS));
      } else {
        x = postos.length ? Math.min(...postos.map(n => n.x)) : 0;
        y = postos.length ? Math.max(...postos.map(n => n.y + n.height)) + ENTRE_COLUNAS : 0;
      }
      const posto = { ...novo, x: encaixar(x), y: praCima(y) };
      for (let bate; (bate = postos.find(n => sobrepoe(n, posto)));) posto.y = praCima(bate.y + bate.height + ENTRE_IRMAOS);
      postos.push(posto); lugar.set(posto.id, posto); saida.push(posto);
    }
    return saida;
  }
```

E no `api`, acrescentar: `inserirPerto, novoId`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/fluxo.test.cjs`
Expected: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs
git commit -m "Fluxo: inserirPerto encaixa cartões novos sem mexer nos existentes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `list_fluxos` e `read_fluxo`

**Files:**
- Modify: `agent/api.cjs`
- Modify: `agent/tools.cjs`
- Test: `tests/agent.test.cjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `state.fluxos = [{ id, file, title, folderId, canvas | erro }]` (já vem do `Vault.load`).
- Produces (em `KiroAgentApi`):
  - `listFluxos() → { fluxos: [{ id, path, title, folder, cards, links, error? }] }` (`cards`/`links` são `null` em fluxo com erro)
  - `readFluxo({ id | path, positions? }) → { id, path, title, folder, cards, links, nodes, edges }`
  - privados que as Tasks 4 e 5 usam: `#acharFluxo(state, { id, path })`, `#fluxoLegivel(state, alvo)`, `#resumoFluxo(state, fluxo)`
  - função de módulo `cartaoParaIA(node, posicoes) → { id, type: 'text'|'note'|'file'|'link'|'group', text|note|file|url|label, color?, x?, y?, width?, height? }`
- Produces (erros): `FLUXO_NOT_FOUND`, `FLUXO_INVALID`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/agent.test.cjs`)

```js
// ---- Fluxo ----
const sobrepoe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function semSobreposicao(nodes) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    assert.ok(!sobrepoe(nodes[i], nodes[j]), `${nodes[i].id} e ${nodes[j].id} se sobrepõem`);
  }
}
async function gravarCanvas(directory, relativo, conteudo) {
  const destino = path.join(directory, relativo);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, '\t'));
}
const lerFluxo = (toolkit, alvo) => toolkit.call('read_fluxo', { ...alvo, positions: true }, cliente);

test('list_fluxos e read_fluxo: cartões, ligações e posições; cartão de nota vira "note" com o caminho', async t => {
  const { toolkit, directory } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Listas', folder: 'Estudos', content: 'x' }, cliente);
  await gravarCanvas(directory, 'Estudos/Python.canvas', {
    nodes: [
      { id: 'a', type: 'text', text: '# Python', x: 0, y: 0, width: 280, height: 60, color: '4' },
      { id: 'b', type: 'file', file: nota.note.path, x: 360, y: 0, width: 400, height: 280 },
      { id: 'c', type: 'link', url: 'https://docs.python.org/', x: 360, y: 300, width: 320, height: 100 },
      { id: 'd', type: 'file', file: 'anexos/foto.png', x: 800, y: 0, width: 320, height: 240 },
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', label: 'estruturas' }, { id: 'e2', fromNode: 'a', toNode: 'c' }],
  });

  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  assert.equal(fluxos.length, 1);
  assert.equal(fluxos[0].path, 'Estudos/Python.canvas');
  assert.equal(fluxos[0].title, 'Python');
  assert.equal(fluxos[0].folder, 'Estudos');
  assert.equal(fluxos[0].cards, 4);
  assert.equal(fluxos[0].links, 2);

  const lido = await toolkit.call('read_fluxo', { path: 'Estudos/Python.canvas' }, cliente);
  assert.deepEqual(lido.nodes, [
    { id: 'a', type: 'text', text: '# Python', color: '4' },
    { id: 'b', type: 'note', note: nota.note.path },
    { id: 'c', type: 'link', url: 'https://docs.python.org/' },
    { id: 'd', type: 'file', file: 'anexos/foto.png' },
  ]);
  assert.deepEqual(lido.edges, [{ id: 'e1', from: 'a', to: 'b', label: 'estruturas' }, { id: 'e2', from: 'a', to: 'c' }]);

  const comPosicoes = await lerFluxo(toolkit, { id: fluxos[0].id });
  assert.deepEqual(comPosicoes.nodes[2], { id: 'c', type: 'link', url: 'https://docs.python.org/', x: 360, y: 300, width: 320, height: 100 });
});

test('fluxo com arquivo corrompido aparece com error e não é lido; alvos inválidos são recusados', async t => {
  const { toolkit, directory } = await montar(t);
  await gravarCanvas(directory, 'Quebrado.canvas', '{ isto não é json');
  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  assert.equal(fluxos[0].cards, null);
  assert.match(fluxos[0].error, /JSON inválido/);
  await assert.rejects(toolkit.call('read_fluxo', { path: 'Quebrado.canvas' }, cliente), codigo('FLUXO_INVALID'));
  await assert.rejects(toolkit.call('read_fluxo', { path: '../fora.canvas' }, cliente), codigo('PATH_TRAVERSAL'));
  await assert.rejects(toolkit.call('read_fluxo', { path: 'Estudos/Python.md' }, cliente), codigo('INVALID_PATH'));
  await assert.rejects(toolkit.call('read_fluxo', { id: 'nao-existe' }, cliente), codigo('FLUXO_NOT_FOUND'));
  await assert.rejects(toolkit.call('read_fluxo', {}, cliente), codigo('INVALID_INPUT'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="fluxo" tests/agent.test.cjs`
Expected: FAIL com `UNKNOWN_TOOL` (`Ferramenta desconhecida: "list_fluxos"`).

- [ ] **Step 3: Implementar em `agent/api.cjs`**

No topo, junto dos outros `require`:

```js
const KiroFluxo = require('../fluxo.js');
```

Logo depois da função `recortar` (antes de `class KiroAgentApi`):

```js
// Cartão do canvas no formato que a IA lê. Cartão de arquivo .md é "note" com o caminho da
// nota; imagem e outros arquivos ficam "file".
function cartaoParaIA(n, posicoes) {
  const saida = { id: n.id };
  if (n.type === 'text') Object.assign(saida, { type: 'text', text: n.text });
  else if (n.type === 'file') Object.assign(saida, /\.md$/i.test(n.file) ? { type: 'note', note: n.file } : { type: 'file', file: n.file });
  else if (n.type === 'link') Object.assign(saida, { type: 'link', url: n.url });
  else Object.assign(saida, { type: 'group' }, n.label !== undefined ? { label: n.label } : {});
  if (n.color) saida.color = n.color;
  if (posicoes) Object.assign(saida, { x: n.x, y: n.y, width: n.width, height: n.height });
  return saida;
}
const setaParaIA = e => ({ id: e.id, from: e.fromNode, to: e.toNode, ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: e.color } : {}) });
```

Na classe, uma seção nova logo antes de `async describeVault()`:

```js
  // ----------------------------------------------------------------- fluxos

  #acharFluxo(state, { id, path: caminho }) {
    const fluxos = state.fluxos || [];
    if (id !== undefined && id !== null && String(id).trim()) {
      const alvo = String(id).trim();
      const achado = fluxos.find(f => f.id === alvo);
      if (achado) return achado;
      throw new AgentError('FLUXO_NOT_FOUND', `Nenhum fluxo com o id "${alvo}". Use list_fluxos.`);
    }
    if (caminho !== undefined && caminho !== null && String(caminho).trim()) {
      const relativo = vaultRelativePath(caminho, { campo: 'path', extensao: 'canvas' });
      const achado = fluxos.find(f => f.file && pathKey(f.file) === pathKey(relativo));
      if (achado) return achado;
      throw new AgentError('FLUXO_NOT_FOUND', `Nenhum fluxo em "${relativo}". Use list_fluxos.`);
    }
    throw new AgentError('INVALID_INPUT', 'Informe "id" ou "path" do fluxo.');
  }

  // Fluxo cujo .canvas não abriu: a IA não lê nem grava, para não piorar o arquivo.
  #fluxoLegivel(state, alvo) {
    const fluxo = this.#acharFluxo(state, alvo);
    if (fluxo.erro) {
      throw new AgentError('FLUXO_INVALID', `O arquivo "${fluxo.file}" não é um JSON Canvas válido (${fluxo.erro}). Ele precisa ser corrigido no Kiro ou no Obsidian antes.`);
    }
    return fluxo;
  }

  #resumoFluxo(state, f) {
    return {
      id: f.id,
      path: f.file || null,
      title: f.title,
      folder: this.#caminhoDaPasta(state, f.folderId),
      cards: f.canvas ? f.canvas.nodes.length : null,
      links: f.canvas ? f.canvas.edges.length : null,
      ...(f.erro ? { error: f.erro } : {}),
    };
  }

  async listFluxos() {
    const state = await this.load();
    const fluxos = [...(state.fluxos || [])].sort((a, b) => (a.file || a.title).localeCompare(b.file || b.title, 'pt-BR'));
    return { fluxos: fluxos.map(f => this.#resumoFluxo(state, f)) };
  }

  async readFluxo(args = {}) {
    const state = await this.load();
    const fluxo = this.#fluxoLegivel(state, args);
    return {
      ...this.#resumoFluxo(state, fluxo),
      nodes: fluxo.canvas.nodes.map(n => cartaoParaIA(n, args.positions === true)),
      edges: fluxo.canvas.edges.map(setaParaIA),
    };
  }
```

- [ ] **Step 4: Implementar em `agent/tools.cjs`**

Logo depois de `const alvoNota = …`:

```js
const alvoFluxo = {
  id: { type: 'string', description: 'Id do fluxo, de list_fluxos. Use este ou "path".' },
  path: { type: 'string', description: 'Caminho do fluxo relativo ao cofre, terminando em .canvas, por exemplo "Estudos/Python.canvas".' },
};
```

No array `FERRAMENTAS`, antes da entrada `get_vault_info`:

```js
  {
    name: 'list_fluxos',
    risk: 'read',
    permission: 'read',
    description: 'Lista os fluxos do cofre: mapas mentais e canvas de ideias, arquivos .canvas no formato JSON Canvas (compatível com o Obsidian). Devolve id, caminho, título, pasta e quantos cartões e ligações cada um tem. Um fluxo com "error" está com o arquivo corrompido e não pode ser lido nem alterado.',
    inputSchema: { type: 'object', properties: {} },
    run: (api, args, ctx) => api.listFluxos(args, ctx),
    target: () => 'vault',
  },
  {
    name: 'read_fluxo',
    risk: 'read',
    permission: 'read',
    description: 'Lê um fluxo pelo id ou pelo caminho. Devolve os cartões ({ id, type, text | note | url | label | file, color }) e as ligações ({ id, from, to, label }). Em cartões "note", o campo note é o caminho da nota do cofre que o cartão mostra (leia com read_note). Com positions: true, inclui x, y, width e height de cada cartão.',
    inputSchema: {
      type: 'object',
      properties: {
        ...alvoFluxo,
        positions: { type: 'boolean', default: false, description: 'true inclui posição e tamanho dos cartões.' },
      },
    },
    run: (api, args, ctx) => api.readFluxo(args, ctx),
    target: (args, resultado) => resultado?.path || args.path || args.id,
  },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/agent.test.cjs`
Expected: PASS em todos, inclusive "catálogo declara risco e permissão de cada ferramenta".

- [ ] **Step 6: Commit**

```bash
git add agent/api.cjs agent/tools.cjs tests/agent.test.cjs
git commit -m "Fluxo: ferramentas list_fluxos e read_fluxo para agentes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `create_fluxo`

**Files:**
- Modify: `agent/api.cjs`
- Modify: `agent/tools.cjs`
- Modify: `agent/events.cjs`
- Test: `tests/agent.test.cjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `KiroFluxo.tamanhoPadrao`, `raizDe`, `layout`, `novoId`, `ler`, `serializar`, `corValida` (Tasks 1 e 2); `#fluxoLegivel`, `#resumoFluxo` (Task 3); `#mutate`, `#garantirPasta` (já existem).
- Produces (em `KiroAgentApi`): `createFluxo({ title, folder?, nodes, edges?, root?, sourceNote? }) → { success, fluxo: resumo, ids: { apelido: idReal }, revisionBefore, revision }`
- Produces (funções de módulo em `api.cjs`, a Task 5 usa):
  - `MAX_TEXTO_CARTAO = 5000`
  - `objeto(valor, onde)`, `textoDoCartao(valor, campo, onde)`, `geometria(e, onde) → { x?, y?, width?, height? }`, `corDoCartao(valor, onde) → cor | undefined`
  - `apelido(e, onde, vistos: Set) → string`
  - `setaDaIA(e, onde, resolver: (ref) => idReal | undefined, dica) → { fromNode, toNode, label?, color? }`
  - `tituloDoFluxo(valor) → string`
- Produces (privados): `#notaPorReferencia(state, ref) → nota | undefined`, `#cartaoDaIA(state, e, onde, faltando: string[]) → cartão sem id (x/y só se vierem)`
- Produces (erros): `FLUXO_EXISTS`, `NOTE_NOT_FOUND` com `details.missing: string[]`.
- Produces (eventos): `fluxo.created` e `fluxo.updated` em `EVENT_NAMES`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/agent.test.cjs`)

```js
test('create_fluxo grava o .canvas na pasta, troca os apelidos por ids reais e posiciona em árvore', async t => {
  const { toolkit, directory } = await montar(t);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Python', folder: 'Estudos',
    nodes: [
      { id: 'raiz', type: 'text', text: '# Python' },
      { id: 'tipos', type: 'text', text: '## Tipos' },
      { id: 'listas', type: 'text', text: 'Listas: `[1, 2, 3]`', color: '4' },
      { id: 'dic', type: 'text', text: 'Dicionários' },
    ],
    edges: [{ from: 'raiz', to: 'tipos' }, { from: 'tipos', to: 'listas', label: 'exemplo' }, { from: 'tipos', to: 'dic' }],
  }, cliente);

  assert.equal(criado.success, true);
  assert.equal(criado.fluxo.path, 'Estudos/Python.canvas');
  assert.deepEqual(Object.keys(criado.ids), ['raiz', 'tipos', 'listas', 'dic']);
  for (const real of Object.values(criado.ids)) assert.match(real, /^[0-9a-f]{16}$/);
  assert.match(await fs.readFile(path.join(directory, 'Estudos/Python.canvas'), 'utf8'), /^\{\n\t"nodes"/);

  const { nodes, edges } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  const no = a => nodes.find(n => n.id === criado.ids[a]);
  semSobreposicao(nodes);
  assert.ok(no('tipos').x > no('raiz').x + no('raiz').width);
  assert.equal(no('listas').x, no('dic').x);
  for (const n of nodes) assert.ok(n.x % 20 === 0 && n.y % 20 === 0, `${n.id} fora da grade`);
  assert.equal(no('listas').color, '4');
  assert.deepEqual(edges.map(e => [e.from, e.to, e.label]), [
    [criado.ids.raiz, criado.ids.tipos, undefined],
    [criado.ids.tipos, criado.ids.listas, 'exemplo'],
    [criado.ids.tipos, criado.ids.dic, undefined],
  ]);
});

test('create_fluxo respeita x/y dados e posiciona só quem veio sem posição', async t => {
  const { toolkit } = await montar(t);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Solto',
    nodes: [
      { id: 'fixo', type: 'text', text: 'Aqui', x: 1000, y: 500, width: 200, height: 80 },
      { id: 'livre', type: 'group', label: 'Grupo' },
    ],
  }, cliente);
  const { nodes } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  assert.deepEqual(nodes.find(n => n.id === criado.ids.fixo), { id: criado.ids.fixo, type: 'text', text: 'Aqui', x: 1000, y: 500, width: 200, height: 80 });
  const livre = nodes.find(n => n.id === criado.ids.livre);
  assert.equal(livre.label, 'Grupo');
  assert.equal(livre.width, 400);
  semSobreposicao(nodes);
});

test('create_fluxo com sourceNote liga a nota de origem à raiz e grava na pasta dela', async t => {
  const { toolkit } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Listas', folder: 'Estudos/Python', content: '# Listas' }, cliente);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Mapa de listas', sourceNote: 'Listas',
    nodes: [{ id: 'raiz', type: 'text', text: 'Listas' }, { id: 'a', type: 'text', text: 'append' }],
    edges: [{ from: 'raiz', to: 'a' }],
  }, cliente);
  assert.equal(criado.fluxo.path, 'Estudos/Python/Mapa de listas.canvas');
  const { nodes, edges } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  const origem = nodes.find(n => n.type === 'note');
  assert.equal(origem.note, nota.note.path);
  assert.ok(edges.some(e => e.from === origem.id && e.to === criado.ids.raiz));
  assert.ok(origem.x + origem.width <= nodes.find(n => n.id === criado.ids.raiz).x);
  semSobreposicao(nodes);
});

test('create_fluxo acha nota por caminho ou título e recusa tudo se alguma não existe', async t => {
  const { toolkit } = await montar(t);
  const a = await toolkit.call('create_note', { title: 'Resumo', folder: 'A', content: 'a' }, cliente);
  const b = await toolkit.call('create_note', { title: 'Resumo', folder: 'B', content: 'b' }, cliente);
  const criado = await toolkit.call('create_fluxo', { title: 'Notas', nodes: [
    { id: 'pelo-caminho', type: 'note', note: b.note.path },
    { id: 'pelo-titulo', type: 'note', note: 'Resumo' },
  ] }, cliente);
  const { nodes } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  assert.equal(nodes.find(n => n.id === criado.ids['pelo-caminho']).note, b.note.path);
  assert.ok([a.note.path, b.note.path].includes(nodes.find(n => n.id === criado.ids['pelo-titulo']).note));

  await assert.rejects(toolkit.call('create_fluxo', { title: 'Faltando', nodes: [
    { id: 'x', type: 'note', note: 'Não existe' }, { id: 'y', type: 'note', note: 'Pasta/Outra.md' },
  ] }, cliente), erro => erro.code === 'NOTE_NOT_FOUND' && erro.details.missing.length === 2);
  assert.equal((await toolkit.call('list_fluxos', {}, cliente)).fluxos.length, 1);
});

test('create_fluxo recusa pedido inválido sem gravar nada', async t => {
  const { toolkit } = await montar(t);
  const um = [{ id: 'a', type: 'text', text: 'A' }];
  const casos = [
    { title: 'x', nodes: [] },
    { title: 'x', nodes: [...um, { id: 'a', type: 'text', text: 'B' }] },
    { title: 'x', nodes: um, edges: [{ from: 'a', to: 'b' }] },
    { title: 'x', nodes: um, edges: [{ from: 'a', to: 'a' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'x'.repeat(5001) }] },
    { title: 'x', nodes: [{ id: 'a', type: 'link', url: 'javascript:alert(1)' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', color: 'red; background:url(x)' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'imagem', text: 'A' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', x: 'longe' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', extra: 1 }] },
    { title: 'x', nodes: um, root: 'b' },
    { title: 'x', nodes: Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, type: 'text', text: 'x' })) },
  ];
  for (const caso of casos) {
    await assert.rejects(toolkit.call('create_fluxo', caso, cliente), codigo('INVALID_INPUT'), JSON.stringify(caso).slice(0, 80));
  }
  for (const titulo of ['a/b', 'con', 'fim.', '']) {
    await assert.rejects(toolkit.call('create_fluxo', { title: titulo, nodes: um }, cliente), codigo('INVALID_NAME'), titulo);
  }
  assert.equal((await toolkit.call('list_fluxos', {}, cliente)).fluxos.length, 0);
});

test('create_fluxo recusa um segundo fluxo com o mesmo título na mesma pasta, sem mexer no primeiro', async t => {
  const { toolkit, directory } = await montar(t);
  await toolkit.call('create_fluxo', { title: 'Mapa', folder: 'Estudos', nodes: [{ id: 'a', type: 'text', text: 'Primeiro' }] }, cliente);
  const antes = await fs.readFile(path.join(directory, 'Estudos/Mapa.canvas'), 'utf8');
  for (const titulo of ['Mapa', 'mapa']) {
    await assert.rejects(toolkit.call('create_fluxo', { title: titulo, folder: 'Estudos', nodes: [{ id: 'a', type: 'text', text: 'Segundo' }] }, cliente), codigo('FLUXO_EXISTS'));
  }
  assert.equal(await fs.readFile(path.join(directory, 'Estudos/Mapa.canvas'), 'utf8'), antes);
  // Em outra pasta, o mesmo título pode.
  await toolkit.call('create_fluxo', { title: 'Mapa', nodes: [{ id: 'a', type: 'text', text: 'Raiz' }] }, cliente);
});

test('create_fluxo respeita a permissão de criar, é auditado e emite fluxo.created', async t => {
  const { toolkit, config, events, audit } = await montar(t);
  const vistos = [];
  events.on('fluxo.created', carga => vistos.push(carga));
  const criado = await toolkit.call('create_fluxo', { title: 'Evento', nodes: [{ id: 'a', type: 'text', text: 'A' }] }, cliente);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].id, criado.fluxo.id);
  assert.equal(vistos[0].source, 'agent');
  const registro = (await audit.read({ limit: 5 })).find(r => r.action === 'create_fluxo');
  assert.equal(registro.status, 'success');
  assert.equal(registro.target, 'Evento.canvas');

  await config.save({ permissions: { create: false } });
  await assert.rejects(toolkit.call('create_fluxo', { title: 'Negado', nodes: [{ id: 'a', type: 'text', text: 'A' }] }, cliente), codigo('PERMISSION_DENIED'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="create_fluxo" tests/agent.test.cjs`
Expected: FAIL com `UNKNOWN_TOOL` (`Ferramenta desconhecida: "create_fluxo"`).

- [ ] **Step 3: Eventos** — em `agent/events.cjs`, trocar a linha `const NOMES = …` por:

```js
const NOMES = ['note.created', 'note.updated', 'note.deleted', 'note.moved', 'note.restored', 'folder.created', 'fluxo.created', 'fluxo.updated'];
```

- [ ] **Step 4: Validadores da entrada da IA** — em `agent/api.cjs`:

Trocar a linha que desestrutura o `domain` por:

```js
const { pathKey, normalize, wikiLinks, findLinkedNote, localDate, habitStats, tags: tagsDaNota, validFolderName, safeUrl } = domain;
```

Logo depois de `setaParaIA` (Task 3), acrescentar:

```js
// ---- Entrada da IA para fluxos. O schema só confere o topo; cada cartão é validado aqui.
const MAX_TEXTO_CARTAO = 5000;
const CAMPOS_DO_CARTAO = ['id', 'type', 'text', 'note', 'url', 'label', 'color', 'x', 'y', 'width', 'height'];

function objeto(valor, onde) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new AgentError('INVALID_INPUT', `${onde} deve ser um objeto.`);
  return valor;
}
function textoDoCartao(valor, campo, onde) {
  if (typeof valor !== 'string') throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" deve ser texto.`);
  if (valor.length > MAX_TEXTO_CARTAO) throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" passa de ${MAX_TEXTO_CARTAO} caracteres. Divida o conteúdo em mais cartões.`);
  return valor;
}
// Posição e tamanho: números finitos; tamanho a partir do mínimo do editor (80 × 40).
function geometria(e, onde) {
  const saida = {};
  for (const campo of ['x', 'y', 'width', 'height']) {
    if (e[campo] === undefined || e[campo] === null) continue;
    if (typeof e[campo] !== 'number' || !Number.isFinite(e[campo]) || Math.abs(e[campo]) > 1e6) {
      throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" deve ser um número.`);
    }
    saida[campo] = e[campo];
  }
  if ((saida.width !== undefined && saida.width < 80) || (saida.height !== undefined && saida.height < 40)) {
    throw new AgentError('INVALID_INPUT', `${onde}: largura mínima 80 e altura mínima 40.`);
  }
  return saida;
}
function corDoCartao(valor, onde) {
  if (valor === undefined || valor === null) return undefined;
  if (!KiroFluxo.corValida(valor)) throw new AgentError('INVALID_INPUT', `${onde}: "color" deve ser "1" a "6" (vermelho, laranja, amarelo, verde, ciano, roxo) ou #rrggbb.`);
  return valor;
}
function apelido(e, onde, vistos) {
  objeto(e, onde);
  if (typeof e.id !== 'string' || !e.id.trim() || e.id.length > 100) {
    throw new AgentError('INVALID_INPUT', `${onde}: "id" é obrigatório (um apelido seu, como "raiz" ou "ideia-1"; o Kiro troca pelo id real).`);
  }
  if (vistos.has(e.id)) throw new AgentError('INVALID_INPUT', `${onde}: o id "${e.id}" se repete.`);
  vistos.add(e.id);
  return e.id;
}
// Ligação pedida pela IA. `resolver` troca a referência (apelido ou id real) pelo id do cartão.
function setaDaIA(e, onde, resolver, dica) {
  objeto(e, onde);
  const extras = Object.keys(e).filter(k => !['from', 'to', 'label', 'color'].includes(k));
  if (extras.length) throw new AgentError('INVALID_INPUT', `${onde}: campo desconhecido "${extras[0]}". Aceitos: from, to, label, color.`);
  const de = typeof e.from === 'string' ? resolver(e.from) : undefined;
  const para = typeof e.to === 'string' ? resolver(e.to) : undefined;
  if (!de || !para) throw new AgentError('INVALID_INPUT', `${onde}: "from" e "to" precisam ser ${dica}.`);
  if (de === para) throw new AgentError('INVALID_INPUT', `${onde}: uma ligação não pode sair e chegar no mesmo cartão.`);
  const cor = corDoCartao(e.color, onde);
  const rotulo = e.label === undefined || e.label === null ? '' : textoDoCartao(e.label, 'label', onde);
  return { fromNode: de, toNode: para, ...(rotulo ? { label: rotulo } : {}), ...(cor ? { color: cor } : {}) };
}
// O título vira o nome do arquivo .canvas: mesmas regras de um nome de pasta.
function tituloDoFluxo(valor) {
  const titulo = noteTitle(valor);
  if (!validFolderName(titulo)) {
    throw new AgentError('INVALID_NAME', `"${titulo}" não serve como nome de arquivo. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.`);
  }
  return titulo;
}
```

- [ ] **Step 5: `createFluxo`** — em `agent/api.cjs`, na seção de fluxos (depois de `readFluxo`):

```js
  // Nota por caminho ("Estudos/Python.md") ou por título ("Python"), como um [[link]].
  #notaPorReferencia(state, ref) {
    const alvo = String(ref).trim().replace(/\.md$/i, '');
    return alvo ? findLinkedNote(state.notes, alvo) : undefined;
  }

  // Cartão pedido pela IA → cartão do canvas, sem id; x/y só se vierem. Nota que não existe
  // entra em `faltando`: a chamada inteira é recusada depois, com a lista toda.
  #cartaoDaIA(state, e, onde, faltando) {
    objeto(e, onde);
    const extras = Object.keys(e).filter(k => !CAMPOS_DO_CARTAO.includes(k));
    if (extras.length) throw new AgentError('INVALID_INPUT', `${onde}: campo desconhecido "${extras[0]}".`);
    let cartao;
    if (e.type === 'text') cartao = { type: 'text', text: textoDoCartao(e.text ?? '', 'text', onde) };
    else if (e.type === 'note') {
      const ref = textoDoCartao(e.note, 'note', onde);
      const nota = this.#notaPorReferencia(state, ref);
      if (!nota) faltando.push(ref);
      cartao = { type: 'file', file: nota?.file || ref };
    } else if (e.type === 'link') {
      const url = safeUrl(textoDoCartao(e.url, 'url', onde));
      if (!url) throw new AgentError('INVALID_INPUT', `${onde}: "url" precisa começar com http:// ou https://.`);
      cartao = { type: 'link', url };
    } else if (e.type === 'group') {
      cartao = { type: 'group', ...(e.label !== undefined && e.label !== null ? { label: textoDoCartao(e.label, 'label', onde) } : {}) };
    } else throw new AgentError('INVALID_INPUT', `${onde}: "type" deve ser text, note, link ou group.`);
    const cor = corDoCartao(e.color, onde);
    return { ...cartao, ...(cor ? { color: cor } : {}), ...KiroFluxo.tamanhoPadrao(cartao), ...geometria(e, onde) };
  }

  async createFluxo(args = {}, contexto = {}) {
    const titulo = tituloDoFluxo(args.title);
    const temPasta = args.folder !== undefined && args.folder !== null;
    const segmentos = temPasta ? folderSegments(args.folder) : [];
    if (!Array.isArray(args.nodes) || !args.nodes.length) throw new AgentError('INVALID_INPUT', 'Informe ao menos um cartão em "nodes".');

    const id = randomUUID();
    const { antes, depois, resultado } = await this.#mutate(state => {
      const faltando = [], vistos = new Set();
      const pedidos = args.nodes.map((e, i) => ({ apelido: apelido(e, `nodes[${i}]`, vistos), cartao: this.#cartaoDaIA(state, e, `nodes[${i}]`, faltando) }));
      const temOrigem = args.sourceNote !== undefined && args.sourceNote !== null;
      const origem = temOrigem ? this.#notaPorReferencia(state, textoDoCartao(args.sourceNote, 'sourceNote', 'sourceNote')) : null;
      if (temOrigem && !origem) faltando.push(args.sourceNote);
      if (faltando.length) {
        throw new AgentError('NOTE_NOT_FOUND', `Notas não encontradas: ${faltando.join(', ')}. Confira os caminhos com search_notes ou list_notes.`, { missing: faltando });
      }
      const temRaiz = args.root !== undefined && args.root !== null;
      if (temRaiz && !vistos.has(args.root)) throw new AgentError('INVALID_INPUT', '"root" deve ser o id de um dos cartões de "nodes".');

      // Sem pasta, o fluxo vai para a pasta da nota de origem.
      const { folderId, criadas } = temPasta || !origem ? this.#garantirPasta(state, segmentos) : { folderId: origem.folderId || '', criadas: [] };
      state.fluxos = state.fluxos || [];
      if (state.fluxos.some(f => (f.folderId || '') === folderId && pathKey(f.title) === pathKey(titulo))) {
        throw new AgentError('FLUXO_EXISTS', `Já existe o fluxo "${titulo}" nesta pasta. Use update_fluxo para alterá-lo ou escolha outro título.`);
      }

      const ocupados = new Set(), real = new Map();
      const reservar = () => { const novo = KiroFluxo.novoId(ocupados); ocupados.add(novo); return novo; };
      const nodes = pedidos.map(({ apelido: a, cartao }) => { const idReal = reservar(); real.set(a, idReal); return { id: idReal, ...cartao }; });
      const edges = (args.edges || []).map((e, i) => ({ id: reservar(), ...setaDaIA(e, `edges[${i}]`, ref => real.get(ref), 'ids de cartões de "nodes"') }));
      let raiz = temRaiz ? real.get(args.root) : undefined;
      if (origem) {
        const cartao = { id: reservar(), type: 'file', file: origem.file, ...KiroFluxo.tamanhoPadrao({ type: 'file', file: origem.file }) };
        edges.push({ id: reservar(), fromNode: cartao.id, toNode: raiz || KiroFluxo.raizDe(nodes, edges) });
        nodes.unshift(cartao);
        raiz = cartao.id;
      }
      // Quem veio sem x/y é posicionado pelo layout; quem veio com posição fica onde a IA pôs.
      if (nodes.some(n => n.x === undefined || n.y === undefined)) {
        const posicoes = KiroFluxo.layout(nodes, edges, { raiz });
        for (const n of nodes) if (n.x === undefined || n.y === undefined) Object.assign(n, posicoes.get(n.id));
      }
      const canvas = { nodes, edges };
      const lido = KiroFluxo.ler(KiroFluxo.serializar(canvas));
      if (lido.erro) throw new AgentError('INVALID_INPUT', lido.erro);
      state.fluxos.push({ id, title: titulo, folderId, canvas });
      return { criadas, ids: Object.fromEntries(real) };
    });

    const criado = (depois.fluxos || []).find(f => f.id === id);
    for (const pasta of resultado.criadas) {
      this.events.emitVaultEvent('folder.created', { id: pasta.id, path: this.#caminhoDaPasta(depois, pasta.id), source: 'agent', clientId: contexto.clientId });
    }
    this.events.emitVaultEvent('fluxo.created', { id, path: criado?.file, source: 'agent', clientId: contexto.clientId });
    return { success: true, fluxo: this.#resumoFluxo(depois, criado), ids: resultado.ids, revisionBefore: antes.revision, revision: depois.revision };
  }
```

- [ ] **Step 6: Ferramenta** — em `agent/tools.cjs`, depois da entrada `read_fluxo`:

```js
  {
    name: 'create_fluxo',
    risk: 'write',
    permission: 'create',
    description: 'Cria um fluxo (mapa mental ou canvas de ideias, arquivo .canvas compatível com o Obsidian). Você manda a estrutura e o Kiro posiciona: cartões sem x/y viram uma árvore da esquerda para a direita a partir de "root" (ou do primeiro cartão sem ligação chegando). Cada cartão tem um "id" que é um apelido seu; as ligações usam esses apelidos e a resposta traz os ids reais em "ids". Tipos: text (Markdown, com código e fórmulas), note (uma nota do cofre, por caminho ou título), link (URL http/https) e group (moldura com rótulo). Receita para transformar uma nota em mapa mental: leia a nota com read_note; faça um cartão por ideia, com texto curto; o título da nota vira a raiz, cada título (##) vira um ramo ligado à raiz e o que está sob ele vira filhos do ramo; cada bloco de código vira um cartão próprio; passe a nota em sourceNote, para o mapa ficar ligado a ela e ser gravado na mesma pasta. Até 300 cartões e 5.000 caracteres por cartão. Recusa um segundo fluxo com o mesmo título na mesma pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120, description: 'Título do fluxo. Vira o nome do arquivo .canvas.' },
        folder: { type: 'string', description: 'Pasta de destino relativa ao cofre. Sem isso, usa a pasta de sourceNote ou a raiz do cofre.' },
        nodes: {
          type: 'array', maxItems: 300, items: { type: 'object' },
          description: 'Cartões: { id, type: "text" | "note" | "link" | "group", text | note | url | label, color?, x?, y?, width?, height? }. color: "1" a "6" (vermelho, laranja, amarelo, verde, ciano, roxo) ou #rrggbb.',
        },
        edges: { type: 'array', maxItems: 600, items: { type: 'object' }, description: 'Ligações: { from, to, label?, color? }, com from/to sendo ids (apelidos) de "nodes".' },
        root: { type: 'string', description: 'Id (apelido) do cartão raiz da árvore.' },
        sourceNote: { type: 'string', description: 'Nota de origem (caminho ou título). Ganha um cartão ligado à raiz.' },
      },
      required: ['title', 'nodes'],
    },
    run: (api, args, ctx) => api.createFluxo(args, ctx),
    target: (args, resultado) => resultado?.fluxo?.path || args.title,
  },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test tests/agent.test.cjs tests/fluxo.test.cjs`
Expected: PASS em todos.

- [ ] **Step 8: Commit**

```bash
git add agent/api.cjs agent/tools.cjs agent/events.cjs tests/agent.test.cjs
git commit -m "Fluxo: ferramenta create_fluxo com layout automático e nota de origem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `update_fluxo`

**Files:**
- Modify: `agent/api.cjs`
- Modify: `agent/tools.cjs`
- Test: `tests/agent.test.cjs` (acrescentar ao fim)

**Interfaces:**
- Consumes: `KiroFluxo.inserirPerto`, `novoId`, `removerSetas`, `removerCartoes`, `editarCartao`, `ler`, `serializar`; `#fluxoLegivel`, `#resumoFluxo`, `cartaoParaIA` (Task 3); `objeto`, `textoDoCartao`, `geometria`, `corDoCartao`, `apelido`, `setaDaIA`, `#notaPorReferencia`, `#cartaoDaIA` (Task 4).
- Produces (em `KiroAgentApi`): `updateFluxo({ id | path, add_nodes?, add_edges?, update_nodes?, remove_nodes?, remove_edges? }) → { success, fluxo: resumo, ids: { apelido: idReal }, revisionBefore, revision }`
- Ordem das operações: `remove_edges` → `remove_nodes` (as ligações deles saem junto) → `update_nodes` → `add_nodes` → `add_edges`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/agent.test.cjs`)

```js
async function fluxoBase(toolkit) {
  return toolkit.call('create_fluxo', {
    title: 'Base',
    nodes: [{ id: 'raiz', type: 'text', text: 'Raiz' }, { id: 'a', type: 'text', text: 'A', color: '2' }],
    edges: [{ from: 'raiz', to: 'a', label: 'liga' }],
  }, cliente);
}

test('update_fluxo põe cartões novos perto do pai sem mexer em nenhum existente', async t => {
  const { toolkit } = await montar(t);
  const base = await fluxoBase(toolkit);
  const antes = await lerFluxo(toolkit, { id: base.fluxo.id });
  const r = await toolkit.call('update_fluxo', {
    id: base.fluxo.id,
    add_nodes: [{ id: 'b', type: 'text', text: 'B' }, { id: 'b1', type: 'text', text: 'B1' }],
    add_edges: [{ from: base.ids.raiz, to: 'b' }, { from: 'b', to: 'b1' }],
  }, cliente);
  const depois = await lerFluxo(toolkit, { id: base.fluxo.id });
  for (const n of antes.nodes) assert.deepEqual(depois.nodes.find(x => x.id === n.id), n);
  const no = id => depois.nodes.find(n => n.id === id);
  const a = no(base.ids.a), b = no(r.ids.b), b1 = no(r.ids.b1);
  assert.equal(b.x, a.x);
  assert.ok(b.y >= a.y + a.height + 20);
  assert.ok(b1.x > b.x + b.width);
  semSobreposicao(depois.nodes);
  assert.equal(depois.edges.length, 3);
});

test('update_fluxo muda conteúdo e cor, remove cartões com as ligações e remove ligações', async t => {
  const { toolkit } = await montar(t);
  const base = await fluxoBase(toolkit);
  await toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'A editado', color: '' }] }, cliente);
  let lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  const a = lido.nodes.find(n => n.id === base.ids.a);
  assert.equal(a.text, 'A editado');
  assert.equal(a.color, undefined);

  await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, url: 'https://a.b' }] }, cliente), codigo('INVALID_INPUT'));

  await toolkit.call('update_fluxo', { id: base.fluxo.id, remove_edges: [lido.edges[0].id] }, cliente);
  lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  assert.equal(lido.edges.length, 0);
  assert.equal(lido.nodes.length, 2);

  await toolkit.call('update_fluxo', {
    id: base.fluxo.id,
    add_edges: [{ from: base.ids.raiz, to: base.ids.a }],
  }, cliente);
  await toolkit.call('update_fluxo', { id: base.fluxo.id, remove_nodes: [base.ids.a] }, cliente);
  lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  assert.deepEqual(lido.nodes.map(n => n.id), [base.ids.raiz]);
  assert.equal(lido.edges.length, 0);
});

test('update_fluxo preserva campos que o Kiro não conhece num canvas vindo do Obsidian', async t => {
  const { toolkit, directory } = await montar(t);
  await gravarCanvas(directory, 'Obsidian.canvas', {
    nodes: [{ id: 'x1', type: 'text', text: 'Oi', x: 0, y: 0, width: 280, height: 60, obsidianExtra: { a: 1 } }],
    edges: [],
    metadata: { versao: '1.0' },
  });
  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  await toolkit.call('update_fluxo', { id: fluxos[0].id, add_nodes: [{ id: 'n', type: 'text', text: 'Novo' }] }, cliente);
  const disco = JSON.parse(await fs.readFile(path.join(directory, 'Obsidian.canvas'), 'utf8'));
  assert.deepEqual(disco.metadata, { versao: '1.0' });
  assert.deepEqual(disco.nodes[0].obsidianExtra, { a: 1 });
  assert.equal(disco.nodes.length, 2);
});

test('update_fluxo é tudo-ou-nada e recusa fluxo corrompido sem tocar no arquivo', async t => {
  const { toolkit, directory } = await montar(t);
  const base = await fluxoBase(toolkit);
  const arquivo = path.join(directory, 'Base.canvas');
  const bytes = await fs.readFile(arquivo, 'utf8');
  const revisao = (await toolkit.call('get_vault_info', {}, cliente)).revision;
  const recusados = [
    { add_nodes: [{ id: 'ok', type: 'text', text: 'ok' }], add_edges: [{ from: 'ok', to: 'nao-existe' }] },
    { remove_nodes: [base.ids.a], add_edges: [{ from: base.ids.raiz, to: base.ids.a }] },
    { add_nodes: [{ id: base.ids.a, type: 'text', text: 'apelido igual a um id existente' }] },
    { update_nodes: [{ id: 'nao-existe', text: 'x' }] },
    { remove_nodes: ['nao-existe'] },
    { remove_edges: ['nao-existe'] },
    { add_nodes: [{ id: 'n', type: 'note', note: 'Nota que não existe' }] },
    {},
  ];
  for (const pedido of recusados) {
    await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, ...pedido }, cliente), codigo('INVALID_INPUT', 'NOTE_NOT_FOUND'), JSON.stringify(pedido));
  }
  assert.equal(await fs.readFile(arquivo, 'utf8'), bytes);
  assert.equal((await toolkit.call('get_vault_info', {}, cliente)).revision, revisao);

  await gravarCanvas(directory, 'Quebrado.canvas', '{ quebrado');
  const quebrado = (await toolkit.call('list_fluxos', {}, cliente)).fluxos.find(f => f.error);
  await assert.rejects(toolkit.call('update_fluxo', { id: quebrado.id, add_nodes: [{ id: 'n', type: 'text', text: 'x' }] }, cliente), codigo('FLUXO_INVALID'));
  assert.equal(await fs.readFile(path.join(directory, 'Quebrado.canvas'), 'utf8'), '{ quebrado');
});

test('update_fluxo respeita a permissão de alterar e emite fluxo.updated', async t => {
  const { toolkit, config, events } = await montar(t);
  const base = await fluxoBase(toolkit);
  const vistos = [];
  events.on('fluxo.updated', carga => vistos.push(carga.id));
  await toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'x' }] }, cliente);
  assert.deepEqual(vistos, [base.fluxo.id]);
  await config.save({ permissions: { update: false } });
  await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'y' }] }, cliente), codigo('PERMISSION_DENIED'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="update_fluxo" tests/agent.test.cjs`
Expected: FAIL com `UNKNOWN_TOOL` (`Ferramenta desconhecida: "update_fluxo"`).

- [ ] **Step 3: Implementar** — em `agent/api.cjs`, na seção de fluxos (depois de `createFluxo`):

```js
  // update_nodes: muda conteúdo, cor, posição ou tamanho. O tipo do cartão não muda.
  #editarCartaoDaIA(state, c, e, onde, faltando, vivos) {
    objeto(e, onde);
    if (typeof e.id !== 'string' || !vivos.has(e.id)) throw new AgentError('INVALID_INPUT', `${onde}: nenhum cartão com o id "${e.id}" neste fluxo.`);
    const tipo = cartaoParaIA(c.nodes.find(n => n.id === e.id), false).type;
    const conteudo = { text: 'text', note: 'note', link: 'url', group: 'label' }[tipo];
    const extras = Object.keys(e).filter(k => !['id', 'color', 'x', 'y', 'width', 'height', conteudo].includes(k));
    if (extras.length) {
      throw new AgentError('INVALID_INPUT', `${onde}: "${extras[0]}" não se aplica a um cartão do tipo ${tipo}. O tipo não muda; para trocar, remova o cartão e crie outro.`);
    }
    const campos = geometria(e, onde);
    if (e.color !== undefined && e.color !== null) campos.color = e.color === '' ? undefined : corDoCartao(e.color, onde);
    const valor = conteudo && e[conteudo] !== undefined && e[conteudo] !== null ? textoDoCartao(e[conteudo], conteudo, onde) : undefined;
    if (valor !== undefined && tipo === 'text') campos.text = valor;
    if (valor !== undefined && tipo === 'group') campos.label = valor;
    if (valor !== undefined && tipo === 'link') {
      campos.url = safeUrl(valor);
      if (!campos.url) throw new AgentError('INVALID_INPUT', `${onde}: "url" precisa começar com http:// ou https://.`);
    }
    if (valor !== undefined && tipo === 'note') {
      const nota = this.#notaPorReferencia(state, valor);
      if (nota) campos.file = nota.file; else faltando.push(valor);
    }
    return KiroFluxo.editarCartao(c, e.id, campos);
  }

  async updateFluxo(args = {}, contexto = {}) {
    const listas = ['add_nodes', 'add_edges', 'update_nodes', 'remove_nodes', 'remove_edges'];
    if (!listas.some(k => Array.isArray(args[k]) && args[k].length)) {
      throw new AgentError('INVALID_INPUT', `Nada para alterar: informe ${listas.join(', ')}.`);
    }
    const { antes, depois, resultado } = await this.#mutate(state => {
      const fluxo = this.#fluxoLegivel(state, args);
      let c = fluxo.canvas;
      const existentes = new Set(c.nodes.map(n => n.id));
      const naoExistem = (lista, ids) => lista.filter(i => typeof i !== 'string' || !ids.has(i));
      const setasQueFaltam = naoExistem(args.remove_edges || [], new Set(c.edges.map(e => e.id)));
      if (setasQueFaltam.length) throw new AgentError('INVALID_INPUT', `remove_edges: estas ligações não existem neste fluxo: ${setasQueFaltam.join(', ')}.`);
      const cartoesQueFaltam = naoExistem(args.remove_nodes || [], existentes);
      if (cartoesQueFaltam.length) throw new AgentError('INVALID_INPUT', `remove_nodes: estes cartões não existem neste fluxo: ${cartoesQueFaltam.join(', ')}.`);
      c = KiroFluxo.removerCartoes(KiroFluxo.removerSetas(c, args.remove_edges || []), args.remove_nodes || []);

      const vivos = new Set(c.nodes.map(n => n.id)), faltando = [];
      (args.update_nodes || []).forEach((e, i) => { c = this.#editarCartaoDaIA(state, c, e, `update_nodes[${i}]`, faltando, vivos); });

      const vistos = new Set(), real = new Map(), ocupados = new Set([...c.nodes.map(n => n.id), ...c.edges.map(e => e.id)]);
      const reservar = () => { const novo = KiroFluxo.novoId(ocupados); ocupados.add(novo); return novo; };
      const novos = (args.add_nodes || []).map((e, i) => {
        const onde = `add_nodes[${i}]`, a = apelido(e, onde, vistos);
        if (existentes.has(a)) throw new AgentError('INVALID_INPUT', `${onde}: o id "${a}" já é de um cartão deste fluxo; escolha outro apelido.`);
        const cartao = this.#cartaoDaIA(state, e, onde, faltando);
        const idReal = reservar();
        real.set(a, idReal);
        return { id: idReal, ...cartao };
      });
      if (faltando.length) {
        throw new AgentError('NOTE_NOT_FOUND', `Notas não encontradas: ${faltando.join(', ')}. Confira os caminhos com search_notes ou list_notes.`, { missing: faltando });
      }
      const resolver = ref => real.get(ref) || (vivos.has(ref) ? ref : undefined);
      const setas = (args.add_edges || []).map((e, i) => ({ id: reservar(), ...setaDaIA(e, `add_edges[${i}]`, resolver, 'ids de cartões deste fluxo (de read_fluxo) ou apelidos de add_nodes') }));

      // Quem veio com x/y entra onde a IA pôs; os outros, perto do pai, sem mover ninguém.
      const semPosicao = novos.filter(n => n.x === undefined || n.y === undefined).map(({ x, y, ...n }) => n);
      c = { ...c, nodes: [...c.nodes, ...novos.filter(n => n.x !== undefined && n.y !== undefined)] };
      c = { ...c, nodes: [...c.nodes, ...KiroFluxo.inserirPerto(c, semPosicao, [...c.edges, ...setas])], edges: [...c.edges, ...setas] };
      const lido = KiroFluxo.ler(KiroFluxo.serializar(c));
      if (lido.erro) throw new AgentError('INVALID_INPUT', lido.erro);
      fluxo.canvas = c;
      return { id: fluxo.id, ids: Object.fromEntries(real) };
    });

    const atual = (depois.fluxos || []).find(f => f.id === resultado.id);
    this.events.emitVaultEvent('fluxo.updated', { id: resultado.id, path: atual?.file, source: 'agent', clientId: contexto.clientId });
    return { success: true, fluxo: this.#resumoFluxo(depois, atual), ids: resultado.ids, revisionBefore: antes.revision, revision: depois.revision };
  }
```

- [ ] **Step 4: Ferramenta** — em `agent/tools.cjs`, depois da entrada `create_fluxo`:

```js
  {
    name: 'update_fluxo',
    risk: 'write',
    permission: 'update',
    description: 'Altera um fluxo por operações, sem reescrevê-lo inteiro. Leia antes com read_fluxo para saber os ids. Ordem aplicada: remove_edges, remove_nodes (as ligações do cartão saem junto), update_nodes, add_nodes, add_edges. Cartões novos sem x/y ficam à direita do cartão de onde sai a primeira ligação que chega a eles, abaixo dos irmãos, sem mover nenhum cartão existente. Tudo-ou-nada: qualquer erro recusa a chamada inteira. Até 300 cartões por lista e 5.000 caracteres por cartão.',
    inputSchema: {
      type: 'object',
      properties: {
        ...alvoFluxo,
        add_nodes: { type: 'array', maxItems: 300, items: { type: 'object' }, description: 'Cartões novos, no formato de create_fluxo: { id (apelido seu), type, text | note | url | label, color?, x?, y?, width?, height? }.' },
        add_edges: { type: 'array', maxItems: 600, items: { type: 'object' }, description: 'Ligações novas { from, to, label?, color? }; from/to são ids de cartões do fluxo ou apelidos de add_nodes.' },
        update_nodes: { type: 'array', maxItems: 300, items: { type: 'object' }, description: '{ id, text | note | url | label, color?, x?, y?, width?, height? }. Muda só o que vier; color "" tira a cor. O tipo do cartão não muda.' },
        remove_nodes: { type: 'array', maxItems: 300, items: { type: 'string' }, description: 'Ids de cartões a remover.' },
        remove_edges: { type: 'array', maxItems: 600, items: { type: 'string' }, description: 'Ids de ligações a remover.' },
      },
    },
    run: (api, args, ctx) => api.updateFluxo(args, ctx),
    target: (args, resultado) => resultado?.fluxo?.path || args.path || args.id,
  },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS em todos (o skip de `segredos.test.cjs` no Windows continua).

- [ ] **Step 6: Commit**

```bash
git add agent/api.cjs agent/tools.cjs tests/agent.test.cjs
git commit -m "Fluxo: ferramenta update_fluxo por operações, com inserirPerto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Altura ajustada na primeira abertura (`fluxo-tela.js`) e verificação com a IA

**Files:**
- Modify: `fluxo-tela.js` (bloco "Desenho", bloco "Vista", `concluir` dentro de `editar`, fim de `montar`)

**Interfaces:**
- Consumes: `F.redimensionar`, `encaixarPraCima`, `enquadrarTudo`, `guardarVista`, `opcoes.aoMudar` (já existem).
- Produces: nada novo para fora; `KiroFluxoTela` continua `{ montar, desmontarTodos, ocupado }`.

- [ ] **Step 1: Medida reaproveitável** — em `fluxo-tela.js`, logo depois de `function desenhar() { … }` (antes de `// ---- Vista ----`):

```js
    // Altura que o Markdown de um cartão de texto ocupa na largura dele, mais a borda.
    function alturaDoTexto(texto, largura) {
      const medida = document.createElement('div');
      medida.className = 'fluxo-conteudo fluxo-medida';
      medida.style.width = `${largura}px`;
      medida.innerHTML = opcoes.markdown(texto);
      cartoes.appendChild(medida);
      const altura = Math.ceil(medida.scrollHeight) + 4;
      medida.remove();
      return altura;
    }
```

E em `concluir` (dentro de `editar`), trocar estas sete linhas:

```js
        const medida = document.createElement('div');
        medida.className = 'fluxo-conteudo fluxo-medida';
        medida.style.width = `${atual.width}px`;
        medida.innerHTML = opcoes.markdown(area.value);
        cartoes.appendChild(medida);
        const altura = Math.ceil(medida.scrollHeight) + 4;   // + a borda do cartão
        medida.remove();
```

por:

```js
        const altura = alturaDoTexto(area.value, atual.width);
```

- [ ] **Step 2: Saber se é a primeira abertura** — trocar o bloco:

```js
    if (!s.vista) {
      const salva = lerVistas(opcoes.chaveDaVista)[id];
      s.vista = F.vistaValida(salva) ? salva : F.enquadrar(canvas.nodes, ...tamanho());
    }
```

por:

```js
    // Sem vista guardada: é a primeira vez que este fluxo abre neste Kiro, neste cofre.
    let primeiraVez = false;
    if (!s.vista) {
      const salva = lerVistas(opcoes.chaveDaVista)[id];
      primeiraVez = !F.vistaValida(salva);
      s.vista = primeiraVez ? F.enquadrar(canvas.nodes, ...tamanho()) : salva;
    }
```

- [ ] **Step 3: Ajustar** — no fim de `montar`, logo depois de `desenhar(); aplicarVista();`:

```js
    // Primeira abertura: cartões de texto com altura estimada (da IA, de outro editor) crescem
    // até caber o conteúdo. Só crescem, e fora do desfazer, porque não é uma edição de quem usa.
    // A vista é guardada já, para isto não se repetir a cada abertura.
    // ponytail: um cartão que cresce pode encostar no de baixo; refazer o layout se incomodar.
    if (primeiraVez) {
      let ajustado = canvas;
      for (const c of canvas.nodes) {
        if (c.type !== 'text') continue;
        const altura = alturaDoTexto(c.text, c.width);
        if (altura > c.height) ajustado = F.redimensionar(ajustado, c.id, c.width, encaixarPraCima(altura));
      }
      if (ajustado !== canvas) { canvas = ajustado; desenhar(); enquadrarTudo(); opcoes.aoMudar(canvas); }
      else guardarVista();
    }
```

- [ ] **Step 4: Rodar a suíte**

Run: `npm test`
Expected: PASS (nada de `fluxo-tela.js` é testado no Node; a suíte confirma que nada mais quebrou).

- [ ] **Step 5: Verificar no app** (`npm run dev`, cofre `dev-vault/`)

1. Com o app aberto, em outro terminal, crie um fluxo pela Agent API:
   ```bash
   node -e "require('./agent/index.cjs').createKiroAgent({vaultDirectory:'dev-vault'}).toolkit.call('create_fluxo',{title:'Teste IA',nodes:[{id:'r',type:'text',text:'# Raiz'},{id:'a',type:'text',text:'Um texto bem comprido que passa de uma linha, com código:\n\n\`\`\`js\nconst x = 1;\nconst y = 2;\n\`\`\`'},{id:'h',type:'text',text:'<script>alert(1)</script> <b>negrito?</b>'}],edges:[{from:'r',to:'a'},{from:'r',to:'h'}]},{clientId:'manual'}).then(r=>console.log(r.fluxo))"
   ```
   Em até 5 s, "Teste IA" aparece na árvore. Ao abrir: árvore da esquerda para a direita; o cartão com código cresceu até caber o bloco; o `<script>` aparece como texto, sem alerta.
2. Feche e reabra o fluxo, depois diminua um cartão à mão, feche e reabra de novo: ele **não** volta a crescer.
3. Com o fluxo aberto, mova um cartão e, antes de o salvamento automático rodar, crie outra mudança pela IA:
   ```bash
   node -e "const k=require('./agent/index.cjs').createKiroAgent({vaultDirectory:'dev-vault'}).toolkit;k.call('list_fluxos',{},{}).then(({fluxos})=>k.call('update_fluxo',{id:fluxos.find(f=>f.title==='Teste IA').id,add_nodes:[{id:'n',type:'text',text:'Novo da IA'}]},{clientId:'manual'})).then(r=>console.log(r.fluxo))"
   ```
   Esperado: o Kiro mostra o aviso de que o cofre mudou em outro editor (o mesmo das notas) e nada é sobrescrito em silêncio. Depois de recarregar, o cartão "Novo da IA" aparece ao lado, sem mexer nos outros.

- [ ] **Step 6: Commit**

```bash
git add fluxo-tela.js
git commit -m "Fluxo: cartões de texto crescem até caber o conteúdo na primeira abertura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentação, MCP e grafo

**Files:**
- Modify: `docs/agent-api.md` (seção "Ferramentas", depois de "### Pastas, links e tags")
- Modify: `docs/mcp.md` (seção "Ferramentas publicadas")
- Modify: `README.md` (seção "## Fluxo")
- Modify: `tests/mcp.test.cjs:29-31`

- [ ] **Step 1: MCP publica as quatro** — em `tests/mcp.test.cjs`, trocar a lista esperada por:

```js
  for (const esperada of ['kiro_create_note', 'kiro_read_note', 'kiro_update_note', 'kiro_delete_note',
    'kiro_search_notes', 'kiro_list_notes', 'kiro_create_folder', 'kiro_list_folders', 'kiro_move_note',
    'kiro_get_backlinks', 'kiro_get_outgoing_links', 'kiro_get_recent_notes',
    'kiro_list_fluxos', 'kiro_read_fluxo', 'kiro_create_fluxo', 'kiro_update_fluxo']) {
```

Run: `node --test tests/mcp.test.cjs`
Expected: PASS (o servidor publica tudo o que está no catálogo).

- [ ] **Step 2: `docs/agent-api.md`** — depois da tabela de "### Pastas, links e tags" (antes de "### Schemas"):

````markdown
### Fluxos

Fluxos são arquivos `.canvas` no formato aberto JSON Canvas, compatível com o Obsidian.
A IA manda a estrutura (cartões e ligações) e o Kiro posiciona.

| Ferramenta | Risco | Permissão | O que faz |
|---|---|---|---|
| `list_fluxos` | read | read | Lista id, caminho, título, pasta e quantidade de cartões e ligações. Fluxo corrompido vem com `error`. |
| `read_fluxo` | read | read | Lê por `id` ou `path`: cartões `{ id, type, text \| note \| url \| label \| file, color }` e ligações `{ id, from, to, label }`. `positions: true` inclui `x`, `y`, `width`, `height`. |
| `create_fluxo` | write | create | Cria a partir de `{ title, folder?, nodes, edges?, root?, sourceNote? }`. Cartões sem posição viram uma árvore da esquerda para a direita. |
| `update_fluxo` | write | update | `add_nodes`, `add_edges`, `update_nodes`, `remove_nodes`, `remove_edges`. Cartões novos sem posição entram perto do pai, sem mexer nos existentes. |

- O `id` de cada cartão em `create_fluxo` e `add_nodes` é um apelido; as ligações usam os
  apelidos e a resposta devolve `ids: { apelido: idReal }`.
- `note` aceita caminho (`"Estudos/Python.md"`) ou título. Nota que não existe recusa a
  chamada inteira (`NOTE_NOT_FOUND`, com `details.missing`).
- Limites: 300 cartões por lista, 600 ligações e 5.000 caracteres por cartão.
- Tudo-ou-nada: qualquer erro vira `AgentError` e nada é gravado. Fluxo com o arquivo
  corrompido devolve `FLUXO_INVALID` e não é tocado.
- Eventos: `fluxo.created` e `fluxo.updated`.

Exemplo: "transforma a nota Listas num fluxo". O agente lê a nota com `read_note` e chama:

```jsonc
// create_fluxo
{ "title": "Listas (mapa)", "sourceNote": "Estudos/Python/Listas.md",
  "nodes": [
    { "id": "raiz", "type": "text", "text": "# Listas" },
    { "id": "criar", "type": "text", "text": "## Criar" },
    { "id": "ex1", "type": "text", "text": "```python\nxs = [1, 2, 3]\n```" },
    { "id": "metodos", "type": "text", "text": "## Métodos" },
    { "id": "append", "type": "text", "text": "`append` põe no fim" }
  ],
  "edges": [
    { "from": "raiz", "to": "criar" }, { "from": "criar", "to": "ex1" },
    { "from": "raiz", "to": "metodos" }, { "from": "metodos", "to": "append" }
  ] }
// resposta
{ "success": true, "fluxo": { "id": "…", "path": "Estudos/Python/Listas (mapa).canvas",
  "title": "Listas (mapa)", "folder": "Estudos/Python", "cards": 6, "links": 5 },
  "ids": { "raiz": "3f9c…", "criar": "a01b…", "ex1": "…", "metodos": "…", "append": "…" } }
```
````

- [ ] **Step 3: `docs/mcp.md`** — na lista de "## Ferramentas publicadas", trocar a última linha `` `kiro_get_vault_info`. `` por:

```markdown
`kiro_get_vault_info`, `kiro_list_fluxos`, `kiro_read_fluxo`, `kiro_create_fluxo`,
`kiro_update_fluxo`.
```

- [ ] **Step 4: `README.md`** — no fim da seção "## Fluxo", acrescentar o parágrafo:

```markdown
Uma IA conectada pelo MCP também cria e edita fluxos (`kiro_create_fluxo`, `kiro_update_fluxo`):
peça "transforma a nota X num mapa mental" e ela manda os cartões e as ligações; o Kiro organiza
tudo numa árvore da esquerda para a direita e, nas edições, encaixa os cartões novos sem mexer
nos que já estavam.
```

- [ ] **Step 5: Suíte final**

Run: `npm test`
Expected: PASS em todos (1 skip esperado no Windows).

- [ ] **Step 6: Commit**

```bash
git add docs/agent-api.md docs/mcp.md README.md tests/mcp.test.cjs
git commit -m "Fluxo: documentação das ferramentas de IA e etapa 3 no README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Atualizar o grafo** (pedido pelo `CLAUDE.md`)

Rodar `/graphify . --update`, atualizar os números de arquivos, nós, arestas e comunidades no `CLAUDE.md` como no commit `44a4efe`, e fazer o commit:

```bash
git add graphify-out CLAUDE.md
git commit -m "Graphify: números do grafo depois da etapa 3 do Fluxo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
