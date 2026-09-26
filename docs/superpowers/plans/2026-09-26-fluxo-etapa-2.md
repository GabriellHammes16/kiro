# Fluxo — Etapa 2 (integração com o cofre) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Fluxo conversa com o resto do cofre: cartões de nota (com prévia), imagem, link e grupo; arrastar nota da árvore; colar; "Transformar em nota"; o caminho do cartão acompanha a nota quando ela muda de pasta; excluir fluxo manda para a lixeira (e restaurar volta); e o painel da direita da nota mostra "Aparece nos fluxos".

**Architecture:** As regras puras novas ficam em `fluxo.js` (renomear caminhos, conteúdo de grupo, caixa, altura estimada, caminho seguro, é-imagem) e `domain.js` (`fluxosQueCitam`). O `vault.cjs` reescreve os caminhos dos cartões com o mesmo mapa `changes` das notas e arquiva fluxos excluídos na lixeira. O `fluxo-tela.js` continua sem conhecer o cofre: tudo o que precisa do app entra por `opcoes` (nota por caminho, URL do anexo, escolher nota, escolher imagem, pedir link, guardar imagem, transformar em nota, avisar). O `app.js` implementa essas `opcoes` e a interface da lixeira, da árvore e do painel.

**Tech Stack:** JavaScript sem build, Electron / servidor Node local, `node --test`. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-23-fluxo-design.md` — esta é a etapa 2 da seção "Etapas" (as decisões da etapa 1, inclusive a seção "Ajustes feitos ao planejar" se houver, continuam valendo).

## Global Constraints

- Interface, código, comentários, mensagens e commits em português do Brasil. Todo commit termina com uma linha em branco e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sem dependências novas; sem framework; sem build. Scripts carregados por `<script>` sob a CSP `script-src 'self'`.
- Formato: JSON Canvas 1.0 (`.canvas`). Campos desconhecidos são preservados. Gravação `JSON.stringify(canvas, null, '\t')`, e só quando o conteúdo mudou.
- Cartão de nota ou imagem: `"type": "file"` com `"file"` = caminho relativo ao cofre (`"Investimento/O básico.md"`, `"anexos/foto.png"`). Cartão de link: `"type": "link"` com `"url"`. Grupo: `"type": "group"` com `"label"` opcional.
- Nota apagada: o cartão continua e mostra "Nota não encontrada". Nenhum cartão é apagado automaticamente.
- Nota renomeada ou movida: o `file` de todo cartão que apontava para o caminho antigo é reescrito (o mesmo mapa `changes` que o `rewritePaths` usa).
- Fluxo que sai do estado vai para a lixeira como as notas e pode ser restaurado. **`input.fluxos === undefined` significa "quem salvou não mexe em fluxos" (ex.: backup antigo): nada é excluído.** Só uma lista explícita sem o fluxo o exclui.
- Colar: texto vira cartão de texto; URL sozinha vira cartão de link; imagem vai para os anexos pelo mesmo caminho do editor de notas (`guardarImagem` → `saveAttachment` ou `/api/anexo`, limite `LIMITE_DE_IMAGEM` = 20 MB) e vira cartão de imagem.
- Dois cliques num cartão de nota abrem a nota na outra metade; num cartão de link, abrem o navegador (`http:`/`https:` apenas).
- Imagens: só caminhos relativos ao cofre, sem `..` e sem começar em `/`, `\` ou letra de unidade, e só as extensões que o Kiro já trata como imagem (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`).
- Tamanhos iniciais: nota 400×280, imagem 320×240, link 320×100, grupo em volta da seleção com margem de 40 (ou 400×300 vazio), texto colado 320 × altura estimada (≈40 caracteres por linha, 24 px por linha, mínimo 60, máximo 600).
- Fora da etapa 2 (não implementar): `layout`, `inserirPerto`, ferramentas de IA, links `[[…]]` clicáveis dentro de cartões de texto, página web embutida.

## Review Focus

1. **Nota que muda de pasta (ou pasta renomeada):** o cartão que aponta para ela passa a apontar para o caminho novo no `.canvas`, e o fluxo sem outro cartão afetado mantém os bytes. Coberto na Task 2.
2. **Backup antigo importado (sem `fluxos`) ou salvamento que não traz a lista:** nenhum fluxo é excluído nem vai para a lixeira. Coberto na Task 3.
3. **Restaurar da lixeira um fluxo cujo nome já foi reusado na mesma pasta:** recusa com mensagem e nada muda; o fluxo continua na lixeira. Coberto na Task 3.
4. **`.canvas` vindo de fora com cartão de imagem apontando para `../..` ou caminho absoluto:** não vira `<img>`; aparece como texto. Coberto na Task 1 (`caminhoSeguro`) e verificado na Task 5.
5. **Colar ou escolher imagem enquanto o salvamento automático redesenha a tela:** o cartão novo entra no canvas mais recente, sem desfazer o que já estava lá. Coberto na Task 6 (`canvasAtual`) e verificado na Task 7.

---

## Mapa de arquivos

| Arquivo | Papel nesta etapa |
|---|---|
| `fluxo.js` | `renomearArquivos`, `caminhoSeguro`, `ehImagem`, `contidos`, `caixaDe`, `alturaEstimada` |
| `domain.js` | `fluxosQueCitam(state, nota)` |
| `tests/fluxo.test.cjs` | Testes das funções puras novas |
| `vault.cjs` | Cartões seguem a nota; lixeira e restauração de fluxos |
| `tests/vault.test.cjs` | Testes do cofre |
| `fluxo-tela.js` | Desenho dos cartões de nota/imagem/link/grupo; criar, arrastar da árvore, colar, grupo, transformar em nota |
| `app.js` | `opcoes` novas do editor; excluir fluxo; lixeira; "Aparece nos fluxos"; `irParaNota` que devolve a nota; ícone `imagem` |
| `styles.css` | Estilos dos cartões novos |
| `README.md` | Seção Fluxo atualizada |

---

### Task 1: Regras puras novas (`fluxo.js` e `domain.js`)

**Files:**
- Modify: `fluxo.js` (funções novas antes de `const api = …`; acrescentar ao `api`)
- Modify: `domain.js` (função nova; acrescentar ao `api`)
- Test: `tests/fluxo.test.cjs`

**Interfaces:**
- Produces (em `KiroFluxo`):
  - `renomearArquivos(c, destino: (caminho) => string | undefined) → canvas` (o mesmo objeto se nada mudou)
  - `caminhoSeguro(caminho) → boolean`
  - `ehImagem(caminho) → boolean`
  - `contidos(nodes, grupo) → ids[]`
  - `caixaDe(nodes, margem = 40) → { x, y, width, height }`
  - `alturaEstimada(texto) → number`
- Produces (em `Kiro` / `require('./domain.js')`): `fluxosQueCitam(state, nota) → fluxo[]`

- [ ] **Step 1: Escrever os testes** (acrescentar ao fim de `tests/fluxo.test.cjs`; `cartao`, `canvas` e `domain` já existem no arquivo)

```js
test('renomearArquivos troca o caminho dos cartões de arquivo; sem mudança devolve o mesmo objeto', () => {
  const c = canvas([cartao('t'), { id: 'n', type: 'file', file: 'A/nota.md', x: 0, y: 0, width: 400, height: 280 }, { id: 'i', type: 'file', file: 'anexos/x.png', x: 0, y: 0, width: 10, height: 10 }]);
  const mapa = { 'A/nota.md': 'B/nota.md' };
  const r = F.renomearArquivos(c, f => mapa[f]);
  assert.equal(r.nodes[1].file, 'B/nota.md');
  assert.equal(r.nodes[2], c.nodes[2]);
  assert.equal(F.renomearArquivos(c, () => undefined), c);
  assert.equal(F.renomearArquivos(c, f => f), c);
});

test('caminhoSeguro recusa subir pastas, raiz do disco e vazio', () => {
  for (const ok of ['anexos/x.png', 'A/B/nota.md', 'x.png']) assert.equal(F.caminhoSeguro(ok), true, ok);
  for (const ruim of ['', '../x.png', 'a/../../x.png', '/etc/x.png', '\\x.png', 'C:/x.png', 'c:\\x.png', undefined, 3]) assert.equal(F.caminhoSeguro(ruim), false, String(ruim));
});

test('ehImagem usa as mesmas extensões das notas', () => {
  for (const s of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.avif', 'g.bmp']) assert.equal(F.ehImagem(s), true, s);
  for (const n of ['a.md', 'a.svg', 'png', '', undefined]) assert.equal(F.ehImagem(n), false, String(n));
});

test('contidos acha só os cartões inteiramente dentro do grupo', () => {
  const g = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 400 };
  const dentro = cartao('a', { x: 20, y: 20, width: 100, height: 60 });
  const metade = cartao('b', { x: 450, y: 20, width: 100, height: 60 });
  const fora = cartao('c', { x: 900, y: 900 });
  assert.deepEqual(F.contidos([g, dentro, metade, fora], g), ['a']);
});

test('caixaDe envolve os cartões com margem', () => {
  const nodes = [cartao('a', { x: 0, y: 0, width: 100, height: 50 }), cartao('b', { x: 200, y: 100, width: 100, height: 50 })];
  assert.deepEqual(F.caixaDe(nodes), { x: -40, y: -40, width: 380, height: 230 });
  assert.deepEqual(F.caixaDe(nodes, 0), { x: 0, y: 0, width: 300, height: 150 });
});

test('alturaEstimada: ~40 caracteres por linha, 24 px por linha, entre 60 e 600', () => {
  assert.equal(F.alturaEstimada('curto'), 60);
  assert.equal(F.alturaEstimada('a'.repeat(120)), 72 + 24);           // 3 linhas de texto + margem de uma linha
  assert.equal(F.alturaEstimada('um\ndois\ntres\nquatro'), 4 * 24 + 24);
  assert.equal(F.alturaEstimada('a'.repeat(10000)), 600);
});

test('fluxosQueCitam: cartão com o caminho da nota (sem diferenciar maiúsculas) ou [[link]] em cartão de texto', () => {
  const notas = [{ id: 'n1', title: 'Alvo', body: '', file: 'A/alvo-n1.md', links: [], updatedAt: 1 }, { id: 'n2', title: 'Outra', body: '', file: 'outra-n2.md', links: [], updatedAt: 1 }];
  const f = (id, nodes) => ({ id, title: id, canvas: { nodes, edges: [] } });
  const state = { notes: notas, fluxos: [
    f('f1', [{ id: 'a', type: 'file', file: 'a/ALVO-N1.md', x: 0, y: 0, width: 1, height: 1 }]),
    f('f2', [cartao('b', { text: 'veja [[Alvo]] aqui' })]),
    f('f3', [cartao('c', { text: '[[Outra]]' })]),
    { id: 'f4', title: 'Quebrado', erro: 'JSON inválido' },
  ] };
  assert.deepEqual(domain.fluxosQueCitam(state, notas[0]).map(x => x.id), ['f1', 'f2']);
  assert.deepEqual(domain.fluxosQueCitam({ notes: notas }, notas[0]), []);
  assert.deepEqual(domain.fluxosQueCitam(state, { title: 'Rascunho' }), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL (`F.renomearArquivos is not a function`, `domain.fluxosQueCitam is not a function`).

- [ ] **Step 3: Implementar em `fluxo.js`** (logo antes de `const api = …`)

```js
  // ---- Cofre ----
  // Cartão de arquivo acompanha a nota quando ela muda de pasta: `destino(caminho)` devolve o
  // caminho novo ou undefined (fica como está). Sem mudança, volta o mesmo objeto.
  function renomearArquivos(c, destino) {
    let mudou = false;
    const nodes = c.nodes.map(n => {
      if (n.type !== 'file') return n;
      const novo = destino(n.file);
      if (!novo || novo === n.file) return n;
      mudou = true;
      return { ...n, file: novo };
    });
    return mudou ? { ...c, nodes } : c;
  }
  // Só caminho relativo ao cofre vira <img>: nada de subir pastas nem começar na raiz do disco.
  const caminhoSeguro = f => str(f) && f.length > 0 && !/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(f);
  // As mesmas extensões que o domain.js trata como imagem nas notas.
  const ehImagem = f => str(f) && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(f.trim());
  // Cartões inteiramente dentro de um grupo (menos o próprio): andam com ele.
  const contidos = (nodes, g) => nodes.filter(n => n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).map(n => n.id);
  function caixaDe(nodes, margem = GRADE * 2) {
    const x0 = Math.min(...nodes.map(n => n.x)) - margem, y0 = Math.min(...nodes.map(n => n.y)) - margem;
    const x1 = Math.max(...nodes.map(n => n.x + n.width)) + margem, y1 = Math.max(...nodes.map(n => n.y + n.height)) + margem;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  // Altura inicial de um cartão de texto: ~40 caracteres por linha, 24 px por linha, mais uma
  // linha de margem; o editor ajusta ao conteúdo real quando o texto é editado.
  function alturaEstimada(texto) {
    const linhas = String(texto).split('\n').reduce((soma, l) => soma + Math.max(1, Math.ceil(l.length / 40)), 0);
    return Math.min(600, Math.max(60, (linhas + 1) * 24));
  }
```

Acrescentar `renomearArquivos, caminhoSeguro, ehImagem, contidos, caixaDe, alturaEstimada` ao objeto `api`.

(Conferência dos testes de `alturaEstimada`: `'curto'` → 1 linha → 48 → mínimo 60; 120 caracteres → 3 linhas → 96; 4 linhas curtas → 120; 10 000 caracteres → 600.)

- [ ] **Step 4: Implementar em `domain.js`** (perto de `mentions`, e acrescentar `fluxosQueCitam` ao `api` no fim do arquivo)

```js
  // Fluxos que citam a nota: um cartão de arquivo com o caminho dela ou um [[link]] para ela
  // num cartão de texto. Fluxo com erro (sem canvas) não conta. Base do "Aparece nos fluxos".
  function fluxosQueCitam(state, nota) {
    if (!nota || !nota.id) return [];
    const arquivo = nota.file ? pathKey(nota.file) : '';
    const cita = n => (n.type === 'file' && arquivo && typeof n.file === 'string' && pathKey(n.file) === arquivo)
      || (n.type === 'text' && typeof n.text === 'string' && wikiLinks(n.text).some(l => findLinkedNote(state.notes, l.target)?.id === nota.id));
    return (state.fluxos || []).filter(f => f.canvas && f.canvas.nodes.some(cita));
  }
```

(`pathKey`, `wikiLinks` e `findLinkedNote` já existem em `domain.js`; confira que as três estão definidas antes do ponto em que você colocar a função, ou coloque-a logo depois de `mentions`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/fluxo.test.cjs` → PASS. Depois `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add fluxo.js domain.js tests/fluxo.test.cjs
git commit -F - <<'EOF'
Fluxo: regras puras da etapa 2 (caminhos, grupos, imagem, citações)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Cartões acompanham a nota que muda de pasta

**Files:**
- Modify: `vault.cjs` (`write()`, no laço `for(const fluxo of gravaveis)`)
- Test: `tests/vault.test.cjs`

**Interfaces:**
- Consumes: `KiroFluxo.renomearArquivos` (Task 1); o mapa `changes` de `write()` (chave `pathKey(caminhoAntigo)` → caminho novo), já preenchido pelas notas (`nextNotes`) e pelos arquivos copiados antes do laço dos fluxos.

- [ ] **Step 1: Escrever os testes** (fim de `tests/vault.test.cjs`; `setup`, `seed`, `note`, `fs`, `path` já existem)

```js
test('fluxo: cartão de nota acompanha a nota quando a pasta é renomeada e quando a nota muda de pasta', async t => {
  const vault = await setup(t);
  let s = await seed(vault, [note({ id: 'n1', title: 'Alvo' })]);   // a pasta ainda não existe: validateState recusaria folderId 'p1'
  s = await vault.save({ ...s, folders: [{ id: 'p1', title: 'Ideias', parentId: '', description: '', color: '' }], notes: s.notes.map(n => ({ ...n, folderId: 'p1' })) });
  const arquivo = s.notes[0].file;
  const outro = { id: 'x', type: 'text', text: 'solto', x: 0, y: 0, width: 200, height: 60 };
  s = await vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', folderId: '', canvas: { nodes: [{ id: 'c', type: 'file', file: arquivo, x: 0, y: 0, width: 400, height: 280 }], edges: [] } }, { id: 'f2', title: 'Sem nota', folderId: '', canvas: { nodes: [outro], edges: [] } }] });
  const bytesF2 = await fs.readFile(path.join(vault.directory, 'Sem nota.canvas'));
  // Renomear a pasta
  s = await vault.save({ ...s, folders: [{ ...s.folders[0], title: 'Projetos' }] });
  const novo = s.notes[0].file;
  assert.match(novo, /^Projetos\//);
  const lido = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(lido.nodes[0].file, novo);
  assert.deepEqual(await fs.readFile(path.join(vault.directory, 'Sem nota.canvas')), bytesF2);
  // Mover a nota para a raiz
  s = await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, folderId: '' })) });
  assert.equal(JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8')).nodes[0].file, s.notes[0].file);
  assert.doesNotMatch(s.notes[0].file, /\//);
});

test('fluxo: nota apagada não apaga o cartão', async t => {
  const vault = await setup(t);
  let s = await seed(vault);
  const arquivo = s.notes[0].file;
  s = await vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', folderId: '', canvas: { nodes: [{ id: 'c', type: 'file', file: arquivo, x: 0, y: 0, width: 400, height: 280 }], edges: [] } }] });
  s = await vault.save({ ...s, notes: [] });
  const lido = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(lido.nodes.length, 1);
  assert.equal(lido.nodes[0].file, arquivo);
});
```

(Se `seed(vault, notes)` do arquivo tiver outra assinatura, adapte a criação da nota inicial mantendo o que o teste verifica: uma nota numa pasta, referida por um cartão, e o caminho novo depois de renomear a pasta e de mover a nota.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vault.test.cjs`
Expected: FAIL no primeiro teste (o cartão continua com o caminho antigo).

- [ ] **Step 3: Implementar** — em `write()`, no laço `for(const fluxo of gravaveis){ … }`, trocar as linhas que validam, comparam e gravam o canvas para usar o canvas com caminhos atualizados:

```js
      // Cartões de nota acompanham a nota que mudou de pasta (o mesmo `changes` do rewritePaths).
      const canvas=KiroFluxo.renomearArquivos(fluxo.canvas,f=>changes.get(pathKey(f)));
      const lido=KiroFluxo.ler(KiroFluxo.serializar(canvas));
      if(lido.erro)throw new Error(`Fluxo "${fluxo.title}": ${lido.erro}`);
      const anterior=old&&before.files.get(old.file)?.data;
      const igual=anterior&&JSON.stringify(old.canvas)===JSON.stringify(canvas);
      put(file,igual?anterior:KiroFluxo.serializar(canvas));
```

(`changes.get` devolve o caminho novo inclusive quando ele é igual ao antigo; `renomearArquivos` ignora esse caso, então um fluxo sem nota movida volta o mesmo objeto e mantém os bytes.)

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vault.test.cjs` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add vault.cjs tests/vault.test.cjs
git commit -F - <<'EOF'
Fluxo: cartão de nota acompanha a nota que muda de pasta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Excluir fluxo manda para a lixeira; restaurar volta com o mesmo id

**Files:**
- Modify: `vault.cjs` (`write()`, `trash()`, `restore()`)
- Test: `tests/vault.test.cjs` (acrescentar; e trocar o teste da etapa 1 "fluxo fora de state.fluxos continua no disco (etapa 1 não apaga)")

**Interfaces:**
- Produces:
  - `input.fluxos` como lista: um fluxo de antes que não está nela é **excluído** (arquivo sai do lugar e vai para a lixeira). `input.fluxos === undefined`: nenhum fluxo é excluído.
  - Entrada de lixeira `{ kind: 'fluxo', id, title, originalPath, folders: [], notes: [], fluxos: [{ id, title, file }], ancestors, files, directories, deletedAt }`.
  - `vault.trash()` lista também `kind: 'fluxo'` (e esconde a entrada se o id já está no cofre).
  - `vault.restore({ entryId, revision })` para um fluxo: o arquivo volta ao caminho original (pasta de antes, se ainda existir) e o id volta para o registro do `caderno.json`.

- [ ] **Step 1: Escrever os testes**

Trocar o teste existente `fluxo fora de state.fluxos continua no disco (etapa 1 não apaga)` por:

```js
test('fluxo: salvamento sem a lista de fluxos (backup antigo) não exclui nenhum', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Mapa.canvas', { nodes: [], edges: [] });
  const s = await vault.load();
  const { fluxos, ...semFluxos } = s;
  await vault.save({ ...semFluxos, notes: s.notes.map(n => ({ ...n, body: 'y' })) });
  await fs.access(path.join(vault.directory, 'Mapa.canvas'));
  assert.equal((await vault.load()).fluxos.length, fluxos.length);
});
```

E acrescentar:

```js
test('fluxo: excluir manda para a lixeira; restaurar volta no mesmo lugar, com o mesmo id e o mesmo conteúdo', async t => {
  const vault = await setup(t); let s = await seed(vault);
  s = await vault.save({ ...s, folders: [{ id: 'p1', title: 'Ideias', parentId: '', description: '', color: '' }] });
  const conteudo = { nodes: [{ id: 'a', type: 'text', text: 'Oi', x: 0, y: 0, width: 200, height: 60 }], edges: [] };
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: 'p1', canvas: conteudo }] });
  s = await vault.save({ ...s, fluxos: [] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Ideias', 'Plano.canvas')));
  const lixeira = await vault.trash();
  const item = lixeira.find(i => i.kind === 'fluxo');
  assert.equal(item.title, 'Plano');
  const restaurado = await vault.restore({ entryId: item.entryId, revision: s.revision });
  const f = restaurado.fluxos.find(x => x.id === 'fluxo-1');
  assert.equal(f.file, 'Ideias/Plano.canvas');
  assert.deepEqual(f.canvas, conteudo);
  assert.equal((await vault.trash()).some(i => i.kind === 'fluxo'), false);
});

test('fluxo: restaurar recusa se o nome já foi reusado na mesma pasta, e nada muda', async t => {
  const vault = await setup(t); let s = await seed(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: '', canvas: { nodes: [], edges: [] } }] });
  s = await vault.save({ ...s, fluxos: [] });
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-2', title: 'plano', folderId: '', canvas: { nodes: [], edges: [] } }] });
  const item = (await vault.trash()).find(i => i.kind === 'fluxo');
  await assert.rejects(vault.restore({ entryId: item.entryId, revision: s.revision }), /Já existe/);
  const depois = await vault.load();
  assert.deepEqual(depois.fluxos.map(f => f.id), ['fluxo-2']);
  assert.ok((await vault.trash()).some(i => i.kind === 'fluxo'));
});

test('fluxo com erro pode ser excluído: o arquivo vai intacto para a lixeira', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  const s = await vault.load();
  await vault.save({ ...s, fluxos: [] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Quebrado.canvas')));
  const item = (await vault.trash()).find(i => i.kind === 'fluxo');
  const volta = await vault.restore({ entryId: item.entryId, revision: (await vault.load()).revision });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Quebrado.canvas'), 'utf8'), '{nope');
  assert.match(volta.fluxos[0].erro, /JSON inválido/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vault.test.cjs`
Expected: FAIL (o fluxo com lista vazia continua no disco; `trash()` não traz `kind: 'fluxo'`).

- [ ] **Step 3: Implementar em `write()`**

Logo depois da linha que define `fluxoFiles`:

```js
    // Fluxos excluídos: só quando o input traz a lista. undefined = quem salvou não mexe em
    // fluxos (ex.: backup antigo) e nada é excluído. O arquivo sai do lugar e vai para a lixeira.
    const excluidos=input.fluxos===undefined?[]:fluxosAntes.filter(f=>!input.fluxos.some(x=>x.id===f.id));
    const arquivosExcluidos=new Set(excluidos.map(f=>f.file));
```

No laço que copia os arquivos que não são nota (`for(const [file,value]of before.files)`), pular também os excluídos:

```js
      if(noteFiles.has(file)||fluxoFiles.has(file)||arquivosExcluidos.has(file)||FOLDER_MARKERS.includes(path.posix.basename(file)))continue;
```

No bloco `if(restoring){ … }`, os fluxos arquivados são copiados como os outros arquivos (nada muda ali). Depois do laço `for(const old of fluxosAntes)if(!gravaveis.some(…))…`, trocar esse laço por um que ignora os excluídos e registra os restaurados:

```js
    for(const old of fluxosAntes)if(!gravaveis.some(f=>f.id===old.id)&&!arquivosExcluidos.has(old.file)){const destino=remap(old.file);if(destino)registroDeFluxos.push({id:old.id,path:destino});}
    // Fluxo restaurado da lixeira: volta com o id de antes, se ninguém o usa agora.
    for(const f of restoring?.entry.fluxos||[]){
      const destino=restoring.map(f.file,paths);
      if(destino&&!registroDeFluxos.some(r=>r.id===f.id||pathKey(r.path)===pathKey(destino))&&!input.notes.some(n=>n.id===f.id))registroDeFluxos.push({id:f.id,path:destino});
    }
```

Depois do laço que arquiva as notas excluídas (`for(const note of deletedNotes)…`), arquivar os fluxos excluídos que não estavam numa pasta apagada (esses já vão junto com a pasta):

```js
    for(const fluxo of excluidos)if(!roots.some(root=>descendants(beforeFolders,root.id).has(fluxo.folderId))){
      const folder=beforeFolders.find(f=>f.id===fluxo.folderId);
      await this.archive(transaction,{kind:'fluxo',id:fluxo.id,title:fluxo.title,originalPath:fluxo.file,folders:[],notes:[],fluxos:[{id:fluxo.id,title:fluxo.title,file:fluxo.file}],ancestors:folder?[...ancestors(folder),folder]:[]},before);
    }
```

(`archive` com `kind` diferente de `'folder'` cobre só `originalPath`, e esse arquivo não é de nota: ele entra em `entry.files`. Confira lendo `archive`.)

- [ ] **Step 4: Implementar em `trash()` e `restore()`**

Em `trash()`, a linha que pula entradas já presentes no cofre passa a olhar os fluxos também:

```js
      if(current.folders.some(f=>f.id===entry.id)||current.notes.some(n=>n.id===entry.id)||(current.fluxos||[]).some(f=>f.id===entry.id))continue;
```

Em `restore()`, logo depois da checagem `Este item já está no cofre.`:

```js
    if((input.fluxos||[]).some(f=>f.id===entry.id))throw new Error('Este item já está no cofre.');
```

(O arquivo `.canvas` volta pelo `restoring.files`/`restoring.map`, que já copiam e remapeiam os arquivos da entrada; o registro do id é o laço novo do Step 3. Como `input` é o estado de antes, o fluxo restaurado não está em `input.fluxos` e não é tratado como excluído: `excluidos` só considera fluxos de `before.state.fluxos`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/vault.test.cjs` → PASS. `npm test` → PASS (inclusive agent/MCP, que passam o estado com `fluxos` intacto).

- [ ] **Step 6: Commit**

```bash
git add vault.cjs tests/vault.test.cjs
git commit -F - <<'EOF'
Fluxo: excluir manda para a lixeira e restaurar volta com o mesmo id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Interface — excluir fluxo, lixeira e "Aparece nos fluxos"

**Files:**
- Modify: `app.js` (`menuDaArvore`, função nova `excluirFluxo`, `showTrash`, `painelVoltaMarkup`)
- Modify: `styles.css` (fim do bloco do Fluxo)

**Interfaces:**
- Consumes: Task 3 (lista de fluxos sem o excluído → lixeira; `trash()` com `kind: 'fluxo'`); `Kiro.fluxosQueCitam` (Task 1); `abrirPorId` (abre nota ou fluxo).

- [ ] **Step 1: Excluir pelo menu da árvore**

Em `menuDaArvore(linha)`, no ramo `if (linha.classList.contains('tree-fluxo'))`, acrescentar ao fim da lista devolvida (para todo fluxo, inclusive os com erro):

```js
      { separador: true },
      { rotulo: 'Excluir', icone: icone('lixeira'), acao: () => excluirFluxo(id) },
```

Perto de `moverFluxo`:

```js
// Excluir: o arquivo vai para a lixeira (Configurações → Sistema → Lixeira) e pode voltar.
async function excluirFluxo(id){
  if(busy||failed||!loaded)return;
  const fluxo=getFluxo(id);
  if(!fluxo||!confirm(`Excluir o fluxo "${fluxo.title}"? Ele vai para a lixeira e pode ser restaurado.`))return;
  if(!await gravarFluxoPendente())return;
  state.fluxos=(state.fluxos||[]).filter(f=>f.id!==id);
  await save();
}
```

(As abas desse fluxo fecham sozinhas no próximo `render`, porque `KiroAbas.limpar` só mantém ids que existem.)

- [ ] **Step 2: Lixeira mostra fluxos**

Em `showTrash`, trocar o `detalhe` e o ícone:

```js
    const detalhe=i=>i.kind==='folder'
      ? `pasta · ${i.noteCount} nota${i.noteCount===1?'':'s'}${i.folderCount>1?` · ${i.folderCount-1} subpasta${i.folderCount===2?'':'s'}`:''}`
      : i.kind==='fluxo'?'fluxo':'nota';
```

e, no `modal('Lixeira', …)`, `icone(i.kind==='folder'?'pastas':i.kind==='fluxo'?'fluxo':'nota')`.

- [ ] **Step 3: "Aparece nos fluxos" no painel da direita**

No fim de `painelVoltaMarkup()`, antes do fechamento da string devolvida, acrescentar uma seção (a lista usa `painel-item` e `data-painel-titulo` para o filtro existente funcionar, e `data-abrir-nota`, que o painel já trata com `abrirPorId` — ids de fluxo incluídos):

```js
  const fluxos = Kiro.fluxosQueCitam(state, editing);
  const fluxosHtml = fluxos.map(f => `<div class="painel-item" data-painel-titulo="${escapeHtml(f.title)}"><button type="button" class="painel-fluxo" data-abrir-nota="${escapeHtml(f.id)}">${icone('fluxo')} ${escapeHtml(f.title)}</button></div>`).join('') || '<p class="small-muted">Nenhum.</p>';
```

e a seção `<section class="painel-secao"><h3>Aparece nos fluxos (${fluxos.length})</h3>${fluxosHtml}</section>` depois da de menções não vinculadas.

- [ ] **Step 4: Estilo** (fim do bloco do Fluxo em `styles.css`)

```css
.painel-fluxo { display:flex; align-items:center; gap:6px; width:100%; padding:4px 6px; border:0; border-radius:6px; background:none; color:var(--ink); font:inherit; text-align:left; cursor:pointer; }
.painel-fluxo:hover, .painel-fluxo:focus-visible { background:color-mix(in srgb, var(--line) 45%, transparent); }
```

- [ ] **Step 5: Rodar a suíte**

Run: `node --check app.js` e `npm test` → PASS.

- [ ] **Step 6: Verificar no app** (`npm run dev`, controlador)

1. Botão direito num fluxo → Excluir → confirma → some da árvore, a aba fecha, o arquivo sai do cofre.
2. Configurações → Sistema → Lixeira: o fluxo aparece com ícone de fluxo e "fluxo"; Restaurar traz de volta e ele abre igual.
3. Um fluxo com um cartão cujo texto tem `[[Nome da nota]]`: abrir essa nota → painel da direita → Links de volta → "Aparece nos fluxos (1)" → clicar abre o fluxo.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -F - <<'EOF'
Fluxo: excluir para a lixeira, restaurar e "Aparece nos fluxos" no painel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Editor — desenhar e abrir cartões de nota, imagem, link e grupo

**Files:**
- Modify: `fluxo-tela.js` (`conteudo`, `dblclick`, `escolherGesto`, função nova `editarGrupo`, menu do cartão)
- Modify: `app.js` (`montarFluxos` passa `opcoes` novas; funções `notaPorArquivo`, `abrirNotaDoFluxo`)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `F.ehImagem`, `F.caminhoSeguro`, `F.contidos` (Task 1).
- Produces (novas `opcoes` de `KiroFluxoTela.montar`, usadas também pelas Tasks 6–8):
  - `nota(arquivo) → { titulo, html } | null`
  - `urlDoArquivo(arquivo) → string`
  - `abrirNota(arquivo)`
  - `abrirLink(url)`
- Produces (internas de `montar`): `editarGrupo(idNo)`, `comConteudo(ids) → ids` (grupos levam o que está dentro).

- [ ] **Step 1: Desenho** — em `fluxo-tela.js`, trocar `function conteudo(c) { … }` por:

```js
    function conteudo(c) {
      if (c.type === 'text') return opcoes.markdown(c.text);
      if (c.type === 'file') {
        if (F.ehImagem(c.file)) {
          // Só caminho relativo ao cofre vira <img>: um .canvas de fora não aponta para ../ nem para o disco.
          if (!F.caminhoSeguro(c.file)) return `<p class="fluxo-arquivo">${esc(c.file)}</p>`;
          return `<img class="fluxo-imagem" src="${esc(opcoes.urlDoArquivo(c.file))}" alt="${esc(c.file.split('/').pop())}" draggable="false">`;
        }
        const nota = opcoes.nota(c.file);
        if (!nota) return `<p class="fluxo-ausente">Nota não encontrada<br><small>${esc(c.file)}</small></p>`;
        return `<div class="fluxo-nota-titulo">${esc(nota.titulo)}</div><div class="fluxo-nota-previa">${nota.html}</div>`;
      }
      if (c.type === 'link') {
        const titulo = c.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
        return `<p class="fluxo-link-titulo">${esc(titulo)}</p><p class="fluxo-link">${esc(c.url)}</p>`;
      }
      return '';
    }
```

(`nota.html` vem do `renderizarMarkdown` do app, que já escapa o texto da nota.)

- [ ] **Step 2: Grupo leva o que está dentro; rótulo do grupo**

Logo depois de `function selecionar(ids) { … }`:

```js
    // Arrastar um grupo leva junto os cartões que estão inteiramente dentro dele.
    function comConteudo(ids) {
      const todos = new Set(ids);
      for (const idNo of ids) { const c = no(idNo); if (c?.type === 'group') for (const dentro of F.contidos(canvas.nodes, c)) todos.add(dentro); }
      return [...todos];
    }
```

Em `escolherGesto`, na linha que devolve o gesto de mover, trocar `ids: [idNo, ...[...s.selecao].filter(x => x !== idNo)]` por `ids: comConteudo([idNo, ...[...s.selecao].filter(x => x !== idNo)])` (o primeiro id continua sendo o cartão agarrado).

Depois de `function editarRotulo(idSeta) { … }`:

```js
    // Rótulo do grupo: um <input> sobre a borda de cima. Enter ou sair gravam; Esc desiste.
    function editarGrupo(idNo) {
      const c = no(idNo);
      if (!c || c.type !== 'group') return;
      terminarEdicao();
      const campo = document.createElement('input');
      campo.className = 'fluxo-editor fluxo-grupo-editor';
      campo.value = c.label || '';
      campo.setAttribute('aria-label', 'Nome do grupo');
      Object.assign(campo.style, { left: `${Number(c.x)}px`, top: `${Number(c.y)}px` });
      mundo.appendChild(campo);
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null; campo.remove();
        const label = campo.value.trim() || undefined;
        if (gravar && label !== c.label) mudar(F.editarCartao(canvas, idNo, { label }));
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

- [ ] **Step 3: Dois cliques por tipo** — trocar o primeiro listener de `dblclick` (o que cria cartão ou chama `editar`) por:

```js
    raiz.addEventListener('dblclick', e => {
      if (e.target.closest('.fluxo-barra, .fluxo-editor, .fluxo-seta')) return;
      const cartao = e.target.closest('.fluxo-cartao');
      if (!cartao) return void criarCartao(pontoDoCanvas(e));
      const c = no(cartao.dataset.no);
      if (c?.type === 'file' && !F.ehImagem(c.file)) return void opcoes.abrirNota(c.file);
      if (c?.type === 'link') return void opcoes.abrirLink(c.url);
      if (c?.type === 'group') return void editarGrupo(c.id);
      editar(cartao.dataset.no);
    });
```

No `menuDoCartao`, depois do item "Editar texto", acrescentar (um único cartão selecionado):

```js
        ...(ids.length === 1 && no(idNo)?.type === 'group' ? [{ rotulo: 'Renomear grupo', icone: opcoes.icone('renomear'), acao: () => editarGrupo(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'file' && !F.ehImagem(no(idNo).file) ? [{ rotulo: 'Abrir nota', icone: opcoes.icone('nota'), acao: () => opcoes.abrirNota(no(idNo).file) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'link' ? [{ rotulo: 'Abrir link', icone: opcoes.icone('link'), acao: () => opcoes.abrirLink(no(idNo).url) }] : []),
```

- [ ] **Step 4: `opcoes` no app** — em `app.js`, perto de `montarFluxos`:

```js
// Cartão de arquivo aponta para a nota pelo caminho no cofre (sem diferenciar maiúsculas).
const notaPorArquivo = arquivo => state.notes.find(n => n.file && Kiro.pathKey(n.file) === Kiro.pathKey(arquivo || ''));
// "Na outra metade": uma coluna que já existe ao lado do fluxo, ou uma nova à direita dele.
function abrirNotaDoFluxo(arquivo, painel) {
  const nota = notaPorArquivo(arquivo);
  if (!nota) return status('Nota não encontrada no cofre.', true);
  const outra = painel + 1 < abas.paineis.length ? painel + 1 : painel - 1;
  if (outra >= 0 && outra !== painel) return abrirNota(nota, { painel: outra, novaAba: true, duplicar: true });
  if (!cabeOutraColuna()) return abrirNota(nota, { painel, novaAba: true, duplicar: true });
  return abrirNota(nota, { colunaNova: true, painel: painel + 1, duplicar: true });
}
function abrirLinkDoFluxo(url) {
  const seguro = Kiro.safeUrl(url);
  if (!seguro) return status('Esse link não é http nem https.', true);
  window.open(seguro, '_blank', 'noopener,noreferrer');
}
```

E, no objeto `opcoes` de `KiroFluxoTela.montar` dentro de `montarFluxos`, acrescentar:

```js
      urlDoArquivo: urlDoAnexo,
      nota: arquivo => { const n = notaPorArquivo(arquivo); return n ? { titulo: n.title || 'Sem título', html: renderizarMarkdown(n.body.slice(0, 2000)) } : null; },
      abrirNota: arquivo => abrirNotaDoFluxo(arquivo, Number(host.dataset.painel)),
      abrirLink: abrirLinkDoFluxo,
```

- [ ] **Step 5: Estilos** (fim do bloco do Fluxo em `styles.css`)

```css
.fluxo-conteudo:has(> .fluxo-imagem) { padding:0; overflow:hidden; }
.fluxo-imagem { display:block; width:100%; height:100%; object-fit:contain; border-radius:8px; }
.fluxo-nota-titulo { font-weight:700; margin-bottom:6px; }
.fluxo-nota-previa { font-size:13px; color:var(--muted); }
.fluxo-nota-previa :is(h1,h2,h3) { font-size:14px; margin:6px 0; }
.fluxo-ausente { margin:0; color:var(--muted); font-style:italic; }
.fluxo-link-titulo { margin:0 0 4px; font-weight:600; word-break:break-all; }
.fluxo-grupo-editor { position:absolute; width:220px; height:auto; transform:translateY(-110%); padding:4px 8px; border:1px solid var(--acento); border-radius:6px; background:var(--panel); font-size:14px; }
```

- [ ] **Step 6: Rodar a suíte**

Run: `node --check fluxo-tela.js app.js` e `npm test` → PASS.

- [ ] **Step 7: Verificar no app** (controlador) — escrever à mão no cofre de desenvolvimento um `.canvas` com: um cartão `file` apontando para uma nota existente, um para nota inexistente, um `file` de imagem existente em `anexos/`, um `file` `"../../x.png"`, um `link` e um `group` em volta de dois cartões. Conferir: prévia da nota; "Nota não encontrada"; a imagem aparece; o caminho com `..` aparece como texto; título do link sem protocolo; dois cliques na nota abrem-na em outra coluna; dois cliques no link chamam o navegador; arrastar o grupo leva os dois cartões; dois cliques no grupo editam o nome.

- [ ] **Step 8: Commit**

```bash
git add fluxo-tela.js app.js styles.css
git commit -F - <<'EOF'
Fluxo: cartões de nota, imagem, link e grupo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Editor — criar cartões de nota, imagem, link e grupo

**Files:**
- Modify: `fluxo-tela.js` (barra, menu do fundo, funções de criação)
- Modify: `app.js` (`irParaNota` devolve a nota; `escolherImagem`; `pedirLink`; ícone `imagem`; `opcoes` novas)

**Interfaces:**
- Consumes: Task 5 (`opcoes` e `comConteudo`), `F.caixaDe`, `F.alturaEstimada`.
- Produces (novas `opcoes`):
  - `escolherNota() → Promise<{ arquivo, titulo } | null>`
  - `escolherImagem() → Promise<string | null>` (caminho do anexo gravado)
  - `pedirLink() → Promise<string | null>` (URL http/https)
  - `canvasAtual() → canvas` (o canvas deste fluxo em `state` agora)
  - `aviso(texto, erro?)`
- Produces (internas de `montar`, usadas pelas Tasks 7–8): `adicionarNo(base, p) → id`, `centroDaVista() → { x, y }`, `colarTexto(texto, p)`.

- [ ] **Step 1: Funções de criação** — em `fluxo-tela.js`, depois de `criarCartao`:

```js
    const centroDaVista = () => { const [w, h] = tamanho(); return F.paraCanvas(s.vista, w / 2, h / 2); };
    // Novo cartão centrado em p. Depois de um await (modal, gravação de imagem) o app pode ter
    // redesenhado a tela e este editor já não ser o montado: aí vale o canvas que está no estado.
    function adicionarNo(base, p) {
      if (!montados.has(inst)) canvas = opcoes.canvasAtual() || canvas;
      const r = F.adicionarCartao(canvas, { ...base, x: encaixar(p.x - base.width / 2), y: encaixar(p.y - base.height / 2) });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      return r.id;
    }
    async function adicionarNota(p) { const nota = await opcoes.escolherNota(); if (nota) adicionarNo({ type: 'file', file: nota.arquivo, width: 400, height: 280 }, p); }
    async function adicionarImagem(p) { const caminho = await opcoes.escolherImagem(); if (caminho) adicionarNo({ type: 'file', file: caminho, width: 320, height: 240 }, p); }
    async function adicionarLink(p) { const url = await opcoes.pedirLink(); if (url) adicionarNo({ type: 'link', url, width: 320, height: 100 }, p); }
    function criarGrupo(p) {
      const sel = canvas.nodes.filter(n => s.selecao.has(n.id));
      const caixa = sel.length ? F.caixaDe(sel) : { x: p.x - 200, y: p.y - 150, width: 400, height: 300 };
      const r = F.adicionarCartao(canvas, { type: 'group', label: 'Grupo', x: encaixar(caixa.x), y: encaixar(caixa.y), width: encaixarPraCima(caixa.width), height: encaixarPraCima(caixa.height) });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      editarGrupo(r.id);
    }
    // Texto colado: URL sozinha vira link; o resto, cartão de texto com altura estimada.
    function colarTexto(texto, p) {
      const limpo = String(texto).trim();
      if (!limpo) return;
      if (/^https?:\/\/\S+$/i.test(limpo)) return void adicionarNo({ type: 'link', url: limpo, width: 320, height: 100 }, p);
      adicionarNo({ type: 'text', text: limpo, width: 320, height: F.alturaEstimada(limpo) }, p);
    }
```

Trocar `function criarCartaoNoCentro() { … }` por `function criarCartaoNoCentro() { criarCartao(centroDaVista()); }`.

(`inst` e `montados` já existem; `adicionarNo` só roda depois de `montar` terminar, quando `inst` já foi declarado.)

- [ ] **Step 2: Barra e menu do fundo**

Na linha do `host.innerHTML` que monta `.fluxo-barra`, depois do botão `cartao`, acrescentar:

```js
<button type="button" class="icon-button" data-fluxo-acao="nota" title="Adicionar nota do cofre" aria-label="Adicionar nota do cofre">${opcoes.icone('nota')}</button><button type="button" class="icon-button" data-fluxo-acao="imagem" title="Adicionar imagem" aria-label="Adicionar imagem">${opcoes.icone('imagem')}</button>
```

No listener de clique da barra:

```js
      if (acao === 'nota') adicionarNota(centroDaVista());
      if (acao === 'imagem') adicionarImagem(centroDaVista());
```

Trocar `function menuDoFundo(p) { … }` por:

```js
    function menuDoFundo(p) {
      return [
        { rotulo: 'Adicionar cartão', icone: opcoes.icone('mais'), acao: () => criarCartao(p) },
        { rotulo: 'Adicionar nota do cofre', icone: opcoes.icone('nota'), acao: () => adicionarNota(p) },
        { rotulo: 'Adicionar imagem', icone: opcoes.icone('imagem'), acao: () => adicionarImagem(p) },
        { rotulo: 'Adicionar link', icone: opcoes.icone('link'), acao: () => adicionarLink(p) },
        { rotulo: s.selecao.size ? 'Agrupar seleção' : 'Criar grupo', icone: opcoes.icone('pastas'), acao: () => criarGrupo(p) },
        { separador: true },
        { rotulo: 'Desfazer', icone: opcoes.icone('desfazer'), ativo: () => s.historico.antes.length > 0, acao: desfazer },
        { rotulo: 'Refazer', icone: opcoes.icone('refazer'), ativo: () => s.historico.depois.length > 0, acao: refazer },
        { rotulo: 'Colar', icone: opcoes.icone('colar'), acao: () => navigator.clipboard.readText().then(t => colarTexto(t, p), () => opcoes.aviso('Não foi possível ler a área de transferência.', true)) },
        { separador: true },
        { rotulo: 'Encaixar na grade', icone: s.grade ? opcoes.icone('marcado') : '', acao: () => { s.grade = !s.grade; } },
        { rotulo: 'Enquadrar tudo', icone: opcoes.icone('expandir'), acao: enquadrarTudo },
      ];
    }
```

- [ ] **Step 3: `irParaNota` que devolve a nota** — em `app.js`, trocar `function irParaNota(){` e o `abrir` dele para aceitar `{ escolher }` e devolver uma Promise:

```js
// Com { escolher: true } não abre a nota: devolve { arquivo, titulo } (ou null se fechar), para
// o Fluxo criar um cartão dela. Sem opções, continua abrindo a nota como sempre.
function irParaNota({ escolher = false } = {}){
  if(!loaded||failed||busy||$('#modal-root').firstChild)return Promise.resolve(null);
  return new Promise(resolve=>{
```

dentro dele, trocar `const abrir=n=>{if(n&&closeModal(true))abrirNota(n);};` por:

```js
  let respondeu=false;
  const responder=valor=>{if(!respondeu){respondeu=true;resolve(valor);}};
  const abrir=n=>{if(!n||!closeModal(true))return;if(escolher)responder(n.file?{arquivo:n.file,titulo:n.title||'Sem título'}:null);else{responder(null);abrirNota(n);}};
  // Fechar sem escolher (Esc, ×, fora) também responde: o modal some do #modal-root.
  new MutationObserver((_,obs)=>{if(!$('#modal-root').firstChild){obs.disconnect();responder(null);}}).observe($('#modal-root'),{childList:true});
```

e fechar a Promise (`});`) no fim da função, depois de `desenhar();campo.focus();`. O título do modal passa a ser `escolher?'Adicionar nota ao fluxo':'Ir para nota'`. `ACOES_DOS_ATALHOS.irPara` continua chamando `irParaNota()`.

- [ ] **Step 4: Escolher imagem e pedir link** — em `app.js`, perto de `guardarImagem`:

```js
// Seletor de arquivos do sistema → anexo do cofre (mesmo caminho da imagem colada). Devolve o caminho.
function escolherImagemDoSistema() {
  return new Promise(resolve => {
    const campo = document.createElement('input');
    campo.type = 'file'; campo.accept = TIPOS_DE_IMAGEM.join(',');
    campo.addEventListener('cancel', () => resolve(null));
    campo.addEventListener('change', async () => {
      const arquivo = campo.files?.[0];
      if (!arquivo) return resolve(null);
      resolve(await guardarImagemDoFluxo(arquivo));
    });
    campo.click();
  });
}
// Mesmo limite e mesmo aviso da imagem colada numa nota; devolve o caminho ou null.
async function guardarImagemDoFluxo(arquivo) {
  if (arquivo.size > LIMITE_DE_IMAGEM) { status(`${arquivo.name || 'A imagem'} passa de 20 MB.`, true); return null; }
  try { return (await guardarImagem(arquivo)).path; }
  catch (erro) { status('Não foi possível guardar a imagem: ' + erro.message, true); return null; }
}
function pedirLinkDoFluxo() {
  if ($('#modal-root').firstChild) return Promise.resolve(null);
  return new Promise(resolve => {
    let respondeu = false;
    const responder = v => { if (!respondeu) { respondeu = true; resolve(v); } };
    modal('Adicionar link', `<form class="form" id="fluxo-link-form"><div class="field"><label for="fluxo-link-url">Endereço</label><input id="fluxo-link-url" required placeholder="https://…" autocomplete="off" /></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Adicionar</button></div></form>`);
    const campo = $('#fluxo-link-url');
    campo.addEventListener('input', e => e.stopPropagation());
    new MutationObserver((_, obs) => { if (!$('#modal-root').firstChild) { obs.disconnect(); responder(null); } }).observe($('#modal-root'), { childList: true });
    $('#cancel').onclick = () => closeModal(true);
    $('#fluxo-link-form').onsubmit = e => {
      e.preventDefault();
      const url = Kiro.safeUrl(campo.value.trim());
      if (!url) return status('Use um endereço que comece com http:// ou https://.', true);
      responder(url); closeModal(true);
    };
    campo.focus();
  });
}
```

(`TIPOS_DE_IMAGEM` e `LIMITE_DE_IMAGEM` já existem no `app.js`; confira os nomes com `grep`.)

- [ ] **Step 5: Ícone e `opcoes`** — no mapa de ícones (onde estão `fluxo:`, `link:`), acrescentar:

```js
  imagem: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L6 19.5"/>',
```

No objeto `opcoes` de `montarFluxos`:

```js
      escolherNota: () => irParaNota({ escolher: true }),
      escolherImagem: escolherImagemDoSistema,
      pedirLink: pedirLinkDoFluxo,
      canvasAtual: () => getFluxo(fluxo.id)?.canvas,
      aviso: (texto, erro) => status(texto, erro),
```

- [ ] **Step 6: Rodar a suíte**

Run: `node --check fluxo-tela.js app.js` e `npm test` → PASS.

- [ ] **Step 7: Verificar no app** (controlador)

1. Barra: botão de nota abre "Adicionar nota ao fluxo"; escolher uma nota cria o cartão com a prévia no centro; Esc fecha sem criar nada; Ctrl+O continua abrindo a nota normalmente.
2. Botão direito no fundo → Adicionar link → `https://jsoncanvas.org` → cartão de link; `ftp://x` é recusado com aviso.
3. Selecionar dois cartões → botão direito no fundo → "Agrupar seleção" → grupo em volta, com o nome em edição.
4. Menu do fundo → Colar com uma URL na área de transferência → cartão de link; com texto → cartão de texto.
5. **(Review Focus 5)** Adicionar nota do cofre e esperar mais de 2 s com o modal aberto antes de escolher (o salvamento automático de uma mudança anterior redesenha a tela): o cartão novo entra, e a mudança anterior continua lá.

- [ ] **Step 8: Commit**

```bash
git add fluxo-tela.js app.js
git commit -F - <<'EOF'
Fluxo: adicionar nota do cofre, imagem, link e grupo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Editor — arrastar nota da árvore e colar

**Files:**
- Modify: `fluxo-tela.js` (listeners `dragover`, `dragleave`, `drop`, `paste`; `colarImagens`)
- Modify: `app.js` (`opcoes` `arquivoDaNota` e `guardarImagem`)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `adicionarNo`, `centroDaVista`, `colarTexto` (Task 6); o tipo de arraste da árvore `'text/kiro-nota'` (o `dragstart` da árvore já grava o id da nota nele).
- Produces (novas `opcoes`): `arquivoDaNota(id) → string | null`, `guardarImagem(File) → Promise<string | null>`.

- [ ] **Step 1: Arrastar da árvore** — em `fluxo-tela.js`, junto dos outros listeners:

```js
    // Nota arrastada da árvore vira cartão no ponto onde foi solta. stopPropagation: senão a
    // área das colunas (bindDragDeAbas) trataria o mesmo arraste e abriria a nota numa coluna.
    const eNota = e => e.dataTransfer?.types.includes('text/kiro-nota');
    raiz.addEventListener('dragover', e => {
      if (!eNota(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      raiz.classList.add('soltando');
    });
    raiz.addEventListener('dragleave', e => { if (!raiz.contains(e.relatedTarget)) raiz.classList.remove('soltando'); });
    raiz.addEventListener('drop', e => {
      if (!eNota(e)) return;
      e.preventDefault(); e.stopPropagation();
      raiz.classList.remove('soltando');
      const arquivo = opcoes.arquivoDaNota(e.dataTransfer.getData('text/kiro-nota'));
      if (arquivo) adicionarNo({ type: 'file', file: arquivo, width: 400, height: 280 }, pontoDoCanvas(e));
    });
```

(Confira em `app.js` que o `dragover`/`drop` de `bindDragDeAbas` está registrado em `.cofre-metades`, um ancestral do fluxo, na fase de bolha: o `stopPropagation` daqui o impede de agir. Se estiver em captura, registre estes com `{ capture: true }` em `raiz` e explique no relatório.)

- [ ] **Step 2: Colar** — idem:

```js
    // Colar com o fluxo em foco (fora da edição de um cartão): imagem → anexo → cartão de imagem;
    // URL sozinha → link; texto → cartão de texto. Tudo no centro da vista.
    async function colarImagens(arquivos, p) {
      for (const [i, arquivo] of arquivos.entries()) {
        const caminho = await opcoes.guardarImagem(arquivo);
        if (caminho) adicionarNo({ type: 'file', file: caminho, width: 320, height: 240 }, { x: p.x + i * F.GRADE * 2, y: p.y + i * F.GRADE * 2 });
      }
    }
    raiz.addEventListener('paste', e => {
      if (editor || e.target !== raiz || !e.clipboardData) return;
      const imagens = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
      if (imagens.length) { e.preventDefault(); return void colarImagens(imagens, centroDaVista()); }
      const texto = e.clipboardData.getData('text/plain');
      if (texto.trim()) { e.preventDefault(); colarTexto(texto, centroDaVista()); }
    });
```

- [ ] **Step 3: `opcoes` e estilo** — em `montarFluxos` (`app.js`):

```js
      arquivoDaNota: id => getNote(id)?.file || null,
      guardarImagem: guardarImagemDoFluxo,
```

`styles.css` (bloco do Fluxo):

```css
.fluxo.soltando { box-shadow:inset 0 0 0 2px var(--acento); }
```

- [ ] **Step 4: Rodar a suíte**

Run: `node --check fluxo-tela.js app.js` e `npm test` → PASS.

- [ ] **Step 5: Verificar no app** (controlador)

1. Arrastar uma nota da árvore para dentro do fluxo: o fundo destaca; soltar cria o cartão da nota ali, e a nota **não** abre numa coluna.
2. Arrastar uma nota para outra coluna (fora do fluxo) continua abrindo a nota lá.
3. Clicar no fundo do fluxo, colar uma URL → cartão de link; colar um parágrafo → cartão de texto com altura razoável; colar uma imagem (captura de tela) → a imagem vai para os anexos e aparece como cartão.
4. Colar dentro de um cartão em edição continua colando no texto do cartão.

- [ ] **Step 6: Commit**

```bash
git add fluxo-tela.js app.js styles.css
git commit -F - <<'EOF'
Fluxo: arrastar nota da árvore e colar texto, link ou imagem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: "Transformar em nota"

**Files:**
- Modify: `fluxo-tela.js` (menu do cartão; função `transformarEmNota`)
- Modify: `app.js` (`tituloDoTexto` extraído de `capturar`; `transformarCartaoEmNota`; `opcoes`)

**Interfaces:**
- Consumes: `gravarFluxoPendente`, `save`, `getNote`, `getFluxo`, `KiroFluxo.editarCartao`.
- Produces (nova `opcao`): `transformarEmNota(idNo, texto)`.

- [ ] **Step 1: Título do texto sem duplicar** — em `app.js`, extrair de `capturar` a expressão do título:

```js
// Título de uma nota nascida de um texto (captura, cartão do fluxo): a primeira linha sem sintaxe.
const tituloDoTexto = texto => (textoPlano(texto.split('\n')[0]).replace(/(^|\s)#(?=[\p{L}\p{N}_/-])/gu, '$1') || texto).slice(0, 80);
```

e em `capturar` usar `title: tituloDoTexto(body)` no lugar da expressão.

- [ ] **Step 2: O app cria a nota e troca o cartão** — perto de `excluirFluxo`:

```js
// Cartão de texto → nota na pasta do fluxo, e o cartão vira o cartão dessa nota, no mesmo lugar e
// tamanho. Duas gravações: a nota precisa existir para ter caminho no cofre.
async function transformarCartaoEmNota(fluxoId, idNo, texto) {
  if (busy || failed || !loaded || !getFluxo(fluxoId)?.canvas) return;
  if (!await gravarFluxoPendente()) return;
  const id = uid(), agora = Date.now();
  state.notes.unshift({ id, title: tituloDoTexto(texto), body: texto, links: [], tags: [], createdAt: agora, updatedAt: agora, folderId: getFluxo(fluxoId).folderId || '' });
  if (!await save()) return;
  const nota = getNote(id), fluxo = getFluxo(fluxoId);
  if (!nota?.file || !fluxo?.canvas || !fluxo.canvas.nodes.some(n => n.id === idNo)) return;
  state.fluxos = state.fluxos.map(f => f.id === fluxoId ? { ...f, canvas: KiroFluxo.editarCartao(f.canvas, idNo, { type: 'file', text: undefined, file: nota.file }) } : f);
  if (await save()) status('Cartão transformado em nota');
}
```

E nas `opcoes` de `montarFluxos`: `transformarEmNota: (idNo, texto) => transformarCartaoEmNota(fluxo.id, idNo, texto),`.

- [ ] **Step 3: O editor oferece a ação** — em `fluxo-tela.js`, depois de `editarGrupo`:

```js
    // O app cria a nota e troca o cartão numa gravação própria (que redesenha a tela); o passo
    // de desfazer guardado aqui volta ao cartão de texto (a nota criada continua no cofre).
    function transformarEmNota(idNo) {
      const c = no(idNo);
      if (!c || c.type !== 'text' || !c.text.trim()) return;
      terminarEdicao();
      s.historico = F.empilhar(s.historico, canvas);
      opcoes.transformarEmNota(idNo, no(idNo).text);
    }
```

No `menuDoCartao`, depois de "Editar texto":

```js
        ...(ids.length === 1 && no(idNo)?.type === 'text' && no(idNo).text.trim() ? [{ rotulo: 'Transformar em nota', icone: opcoes.icone('nota'), acao: () => transformarEmNota(idNo) }] : []),
```

- [ ] **Step 4: Rodar a suíte**

Run: `node --check fluxo-tela.js app.js` e `npm test` → PASS (a captura rápida continua coberta pelos testes que já existem).

- [ ] **Step 5: Verificar no app** (controlador)

1. Num fluxo dentro de uma pasta, cartão de texto `# Ideia nova\nDetalhes` → botão direito → "Transformar em nota": aparece a nota "Ideia nova" na mesma pasta, e o cartão vira o cartão dela, no mesmo lugar e tamanho, com a prévia.
2. O `.canvas` tem o cartão com `"type": "file"`, `"file"` = caminho da nota e sem `"text"`.
3. Ctrl+Z volta o cartão de texto; a nota continua existindo.
4. Captura rápida (Ctrl+Espaço) continua criando a nota com o mesmo título de antes.

- [ ] **Step 6: Commit**

```bash
git add fluxo-tela.js app.js
git commit -F - <<'EOF'
Fluxo: transformar cartão de texto em nota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Documentação

**Files:**
- Modify: `README.md` (seção `## Fluxo`)

- [ ] **Step 1: README** — acrescentar ao fim da seção `## Fluxo`:

```markdown
Cartões podem ser notas do cofre (com prévia; dois cliques abrem a nota ao lado), imagens,
links e grupos. Arraste uma nota da árvore para dentro do fluxo, ou cole: texto vira cartão,
um endereço vira link e uma imagem vai para os anexos. Um cartão de texto pode virar nota
("Transformar em nota"), e quando uma nota muda de pasta o cartão acompanha. Excluir um fluxo
manda o arquivo para a lixeira, de onde ele pode ser restaurado. No painel da direita de uma
nota, "Aparece nos fluxos" lista os fluxos que a citam.
```

- [ ] **Step 2: Suíte e commit**

Run: `npm test` → PASS.

```bash
git add README.md
git commit -F - <<'EOF'
Fluxo: etapa 2 no README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(O grafo do projeto — `/graphify . --update` e os números do `CLAUDE.md`/`AGENTS.md` — é atualizado pelo controlador depois da integração; `graphify-out/` está no `.gitignore`.)
