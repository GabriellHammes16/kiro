# Abas e tela dividida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abas por metade e tela dividida (duas metades) na tela de Pastas, com uma nota em edição por vez.

**Architecture:** Um modelo puro e imutável (`abas.js`, global `KiroAbas`) guarda metades, abas e proporção; `app.js` desenha o modelo, liga o editor único (`editing`) só na metade ativa e desenha a outra em leitura. O estado vai para o `localStorage` por cofre e é sempre passado por `KiroAbas.limpar` antes de usar.

**Tech Stack:** JavaScript puro (sem build), Electron 44, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-19-abas-e-divisao-design.md`

## Global Constraints

- Sem framework, sem TypeScript, sem build, sem dependência nova.
- Código, comentários, interface e commits em português do Brasil.
- Não usar `confirm()`/`alert()` nativos em código novo.
- Testes só em pastas temporárias; nunca tocar `C:\Projetos\Meu segundo cerebro\vault` nem `%USERPROFILE%\Documents\KUROI\vault`. Verificação no navegador só com o cofre de exemplo (`dev-vault/`, servidor `kiro-dev` na porta 4180).
- Não versionar `kuroi-2026-09-12.json`. Não fazer push.
- Commits terminam com uma linha em branco e `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Suíte: `node --test` na raiz (hoje 170 testes: 169 passam, 1 pulado).
- Só na tela de Pastas (`currentView === 'studies'`); as outras telas não mudam.
- No máximo duas metades; uma nota editável por vez; proporção entre 0,2 e 0,8, cada lado ≥ 320 px; abaixo de 900 px as metades empilham; abaixo de 780 px não há divisão.
- Memória em `localStorage`, por cofre, nunca no cofre.

---

### Task 1: Modelo puro das abas (`abas.js`)

**Files:**
- Create: `abas.js`
- Create: `tests/abas.test.cjs`
- Modify: `index.html` (carregar `abas.js` antes de `app.js`)
- Modify: `server.mjs:22` (`publicFiles` ganha `'/abas.js': ['abas.js', 'text/javascript']`)

**Interfaces:**
- Produces (Node: `require('../abas.js')`; navegador: `KiroAbas`):
  - `RASCUNHO = 'kiro:rascunho'`
  - `vazio() → { paineis: [{ abas: [], ativa: null }], ativo: 0, proporcao: 0.5 }`
  - `abrir(e, id, { novaAba = false, painel } = {}) → estado`
  - `ativar(e, painel, id) → estado`
  - `fechar(e, painel, id) → estado`
  - `fecharOutras(e, painel, id) → estado`
  - `mover(e, de, id, para) → estado`
  - `trocarId(e, antigo, novo) → estado`
  - `limpar(e, idsExistentes) → estado` (`idsExistentes`: array ou Set de strings)
  - `proporcao(e, p) → estado`
  - `notaAtiva(e) → string | null`

- [ ] **Step 1: Write the failing test** — `tests/abas.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../abas.js');

const um = (...abas) => ({ paineis: [{ abas, ativa: abas.at(-1) ?? null }], ativo: 0, proporcao: 0.5 });

test('vazio tem uma metade sem abas', () => {
  assert.deepEqual(A.vazio(), { paineis: [{ abas: [], ativa: null }], ativo: 0, proporcao: 0.5 });
  assert.equal(A.notaAtiva(A.vazio()), null);
});

test('abrir troca a aba ativa; com novaAba insere à direita da ativa', () => {
  let e = A.abrir(A.vazio(), 'a');
  assert.deepEqual(e.paineis[0], { abas: ['a'], ativa: 'a' });
  e = A.abrir(e, 'b');                                   // troca a ativa
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
  e = A.abrir(e, 'c', { novaAba: true });
  e = A.ativar(e, 0, 'b');
  e = A.abrir(e, 'd', { novaAba: true });                // à direita de b
  assert.deepEqual(e.paineis[0].abas, ['b', 'd', 'c']);
  assert.equal(A.notaAtiva(e), 'd');
});

test('abrir id já aberto ativa a aba e a metade dele, sem duplicar', () => {
  let e = A.mover(A.abrir(A.abrir(A.vazio(), 'a'), 'b', { novaAba: true }), 0, 'b', 1);
  e = A.ativar(e, 0, 'a');
  e = A.abrir(e, 'b', { novaAba: true });
  assert.equal(e.ativo, 1);
  assert.deepEqual(e.paineis.map(p => p.abas), [['a'], ['b']]);
});

test('fechar ativa a vizinha da direita, senão a da esquerda', () => {
  let e = um('a', 'b', 'c');
  e = A.ativar(e, 0, 'b');
  e = A.fechar(e, 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['a', 'c'], ativa: 'c' });
  e = A.fechar(e, 0, 'c');
  assert.deepEqual(e.paineis[0], { abas: ['a'], ativa: 'a' });
  e = A.fechar(e, 0, 'a');
  assert.deepEqual(e.paineis[0], { abas: [], ativa: null });
  assert.equal(e.paineis.length, 1);                     // a única metade fica, vazia
});

test('fechar aba não ativa mantém a ativa', () => {
  const e = A.fechar(A.ativar(um('a', 'b', 'c'), 0, 'c'), 0, 'a');
  assert.deepEqual(e.paineis[0], { abas: ['b', 'c'], ativa: 'c' });
});

test('mover cria a segunda metade, mover a última aba desfaz a divisão', () => {
  let e = um('a', 'b');
  e = A.mover(e, 0, 'b', 1);
  assert.deepEqual(e.paineis, [{ abas: ['a'], ativa: 'a' }, { abas: ['b'], ativa: 'b' }]);
  assert.equal(e.ativo, 1);
  assert.deepEqual(A.mover(e, 1, 'b', 1), e);           // mesmo lado: nada muda
  e = A.mover(e, 1, 'b', 0);
  assert.deepEqual(e.paineis, [{ abas: ['a', 'b'], ativa: 'b' }]);
  assert.equal(e.ativo, 0);
});

test('mover a única aba da esquerda para a direita deixa uma metade só', () => {
  const e = A.mover(um('a'), 0, 'a', 1);
  assert.deepEqual(e.paineis, [{ abas: ['a'], ativa: 'a' }]);
  assert.equal(e.ativo, 0);
});

test('fechar a última aba de um lado junta as metades', () => {
  let e = A.mover(um('a', 'b'), 0, 'b', 1);
  e = A.fechar(e, 0, 'a');
  assert.deepEqual(e.paineis, [{ abas: ['b'], ativa: 'b' }]);
  assert.equal(e.ativo, 0);
});

test('fecharOutras deixa só a aba pedida naquela metade', () => {
  const e = A.fecharOutras(um('a', 'b', 'c'), 0, 'b');
  assert.deepEqual(e.paineis[0], { abas: ['b'], ativa: 'b' });
});

test('trocarId troca o rascunho pelo id salvo', () => {
  const e = A.trocarId(A.abrir(A.vazio(), A.RASCUNHO), A.RASCUNHO, 'n1');
  assert.deepEqual(e.paineis[0], { abas: ['n1'], ativa: 'n1' });
});

test('limpar recusa lixo, tira ids inexistentes e repetidos e junta metade vazia', () => {
  for (const lixo of [null, 'x', 1, [], {}, { paineis: [] }, { paineis: 'x' }, { paineis: [{}, {}, {}] }]) assert.deepEqual(A.limpar(lixo, ['a']), A.vazio());
  const sujo = { paineis: [{ abas: ['a', 'x', 'a', 7], ativa: 'x' }, { abas: ['x'], ativa: 'x' }], ativo: 1, proporcao: 9 };
  assert.deepEqual(A.limpar(sujo, ['a']), { paineis: [{ abas: ['a'], ativa: 'a' }], ativo: 0, proporcao: 0.8 });
  // o mesmo id nas duas metades: fica na primeira
  const dup = { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['a', 'b'], ativa: 'a' }], ativo: 1, proporcao: 0.5 };
  assert.deepEqual(A.limpar(dup, new Set(['a', 'b'])), { paineis: [{ abas: ['a'], ativa: 'a' }, { abas: ['b'], ativa: 'b' }], ativo: 1, proporcao: 0.5 });
  assert.deepEqual(A.limpar(um(A.RASCUNHO), []), um(A.RASCUNHO));   // rascunho não some
});

test('proporção fica entre 0,2 e 0,8', () => {
  assert.equal(A.proporcao(A.vazio(), 0.1).proporcao, 0.2);
  assert.equal(A.proporcao(A.vazio(), 0.95).proporcao, 0.8);
  assert.equal(A.proporcao(A.vazio(), 'x').proporcao, 0.5);
});
```

- [ ] **Step 2: Run** `node --test tests/abas.test.cjs` → FAIL (`Cannot find module '../abas.js'`).

- [ ] **Step 3: Implement** — `abas.js`:

```js
// Abas e tela dividida da tela de Pastas: só o modelo, sem DOM. Imutável: toda
// função devolve um estado novo. Roda no navegador (KiroAbas) e no Node (testes).
(function (root) {
  const RASCUNHO = 'kiro:rascunho';   // nota nova ainda sem id
  const vazio = () => ({ paineis: [{ abas: [], ativa: null }], ativo: 0, proporcao: 0.5 });
  const limitar = p => (Number.isFinite(p) ? Math.min(0.8, Math.max(0.2, p)) : 0.5);
  const copia = e => ({ ...e, paineis: e.paineis.map(p => ({ abas: [...p.abas], ativa: p.ativa })) });
  const ondeEsta = (e, id) => e.paineis.findIndex(p => p.abas.includes(id));

  // Metade vazia, com duas metades, some; a ativa de cada metade sempre existe nela.
  function arrumar(e) {
    const r = copia(e);
    for (const p of r.paineis) if (!p.abas.includes(p.ativa)) p.ativa = p.abas.at(-1) ?? null;
    if (r.paineis.length === 2) {
      const vazia = r.paineis.findIndex(p => !p.abas.length);
      if (vazia !== -1) { r.paineis.splice(vazia, 1); r.ativo = 0; }
    }
    if (r.ativo >= r.paineis.length) r.ativo = 0;
    return r;
  }

  function ativar(e, painel, id) {
    const r = copia(e);
    if (!r.paineis[painel]?.abas.includes(id)) return e;
    r.paineis[painel].ativa = id;
    r.ativo = painel;
    return r;
  }

  function abrir(e, id, { novaAba = false, painel } = {}) {
    const ja = ondeEsta(e, id);
    if (ja !== -1) return ativar(e, ja, id);
    const r = copia(e);
    const i = painel === undefined || !r.paineis[painel] ? r.ativo : painel;
    const p = r.paineis[i];
    const pos = p.abas.indexOf(p.ativa);
    if (novaAba || pos === -1) p.abas.splice(pos + 1, 0, id);
    else p.abas[pos] = id;
    p.ativa = id;
    r.ativo = i;
    return r;
  }

  function fechar(e, painel, id) {
    const p = e.paineis[painel];
    if (!p || !p.abas.includes(id)) return e;
    const r = copia(e), alvo = r.paineis[painel], pos = alvo.abas.indexOf(id);
    alvo.abas.splice(pos, 1);
    if (alvo.ativa === id) alvo.ativa = alvo.abas[pos] ?? alvo.abas[pos - 1] ?? null;
    return arrumar(r);
  }

  function fecharOutras(e, painel, id) {
    if (!e.paineis[painel]?.abas.includes(id)) return e;
    const r = copia(e);
    r.paineis[painel] = { abas: [id], ativa: id };
    r.ativo = painel;
    return r;
  }

  function mover(e, de, id, para) {
    if (de === para || !e.paineis[de]?.abas.includes(id) || (para !== 0 && para !== 1)) return e;
    // A única aba da única metade não tem para onde ir.
    if (e.paineis.length === 1 && e.paineis[0].abas.length === 1) return e;
    const r = copia(e);
    const origem = r.paineis[de];
    origem.abas.splice(origem.abas.indexOf(id), 1);
    if (!r.paineis[para]) r.paineis[para] = { abas: [], ativa: null };
    r.paineis[para].abas.push(id);
    r.paineis[para].ativa = id;
    r.ativo = para;
    return arrumar(r);
  }

  function trocarId(e, antigo, novo) {
    const r = copia(e);
    for (const p of r.paineis) {
      p.abas = p.abas.map(x => (x === antigo ? novo : x));
      if (p.ativa === antigo) p.ativa = novo;
    }
    return r;
  }

  // O que vem do localStorage é tratado como não confiável.
  function limpar(e, idsExistentes) {
    const existe = new Set(idsExistentes || []);
    if (!e || typeof e !== 'object' || !Array.isArray(e.paineis) || !e.paineis.length || e.paineis.length > 2) return vazio();
    const vistos = new Set();
    const paineis = e.paineis.map(p => {
      const abas = (Array.isArray(p?.abas) ? p.abas : []).filter(id => typeof id === 'string' && (existe.has(id) || id === RASCUNHO) && !vistos.has(id) && vistos.add(id));
      return { abas, ativa: abas.includes(p?.ativa) ? p.ativa : abas.at(-1) ?? null };
    });
    const ativo = Number.isInteger(e.ativo) && e.ativo >= 0 && e.ativo < paineis.length ? e.ativo : 0;
    return arrumar({ paineis, ativo, proporcao: limitar(e.proporcao) });
  }

  const proporcao = (e, p) => ({ ...copia(e), proporcao: limitar(Number(p)) });
  const notaAtiva = e => e.paineis[e.ativo]?.ativa ?? null;

  const api = { RASCUNHO, vazio, abrir, ativar, fechar, fecharOutras, mover, trocarId, limpar, proporcao, notaAtiva };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroAbas = api;
})(globalThis);
```

Confira que `Number('x')` vira `NaN` em `proporcao` e cai em 0,5 (`limitar` usa `Number.isFinite`). Em `limpar`, `limitar(e.proporcao)` recebe o valor cru: 9 vira 0,8.

`index.html`: acrescente `<script src="abas.js"></script>` logo antes de `<script src="app.js"></script>`. `server.mjs`: acrescente `'/abas.js': ['abas.js', 'text/javascript']` ao objeto `publicFiles` (linha 22). O Electron carrega `index.html` por `file://`, então não precisa de mais nada.

- [ ] **Step 4: Run** `node --test tests/abas.test.cjs` → PASS; depois `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git add abas.js tests/abas.test.cjs index.html server.mjs && git commit` com a mensagem `Abas: modelo das abas e da tela dividida`.

---

### Task 2: Barra de abas numa metade (sem divisão ainda)

**Files:**
- Modify: `app.js` — `renderCofre` (~468), `bindView` (bloco `studies`), `abrirNota` (~667), `salvarNota` (~2060, onde `editing` ganha id), clique nas notas da árvore (`data-action="edit-note"`, `action()`), `render`
- Modify: `styles.css` (fim do arquivo)

**Interfaces:**
- Consumes (Task 1): `KiroAbas.*`, `KiroAbas.RASCUNHO`.
- Produces (usado na Task 3):
  - `let abas` (estado do modelo, sempre limpo)
  - `gravarAbas()` — salva `abas` em `localStorage['kiro.abas:' + (state.vaultPath || '')]`
  - `idDaAba(nota)` — `nota.id || KiroAbas.RASCUNHO`
  - `barraDeAbas(painel)` — HTML da barra da metade `painel` (`<div class="abas-barra" data-painel="0" role="tablist">`, abas `<button class="aba" role="tab" data-painel data-aba="<id>" draggable="true" aria-selected>` com `<span class="aba-titulo">` e `<span class="aba-fechar" data-fechar-aba role="button" aria-label="Fechar aba">×</span>`, e `<button class="icon-button aba-nova" data-nova-aba="<painel>" aria-label="Nova aba">`)
  - `abrirNota(nota, { novaAba = false, painel } = {})`
  - `abrirPorId(id, opcoes)` — acha a nota em `state.notes` e chama `abrirNota`

**Comportamento:**
- Estado: `let abas = KiroAbas.vazio();` carregado uma vez no primeiro `renderCofre` depois do cofre lido, de `localStorage['kiro.abas:' + state.vaultPath]` com `JSON.parse` em `try`. Em todo `renderCofre`: `abas = KiroAbas.limpar(abas, state.notes.map(n => n.id))`. Grave (`gravarAbas`) a cada mudança do modelo.
- `abrirNota(nota, opcoes)`: se `editing && editorDirty` e `salvarNota()` falhar, não faz nada (igual a hoje). Senão `abas = KiroAbas.abrir(abas, idDaAba(nota), opcoes)`, `editing = cópia da nota` (como hoje), `gravarAbas()`, `currentView = 'studies'`, `render()`. Chamadas antigas sem opções continuam iguais: trocam a aba ativa.
- Nota nova (`notaVazia()`, sem id) usa `KiroAbas.RASCUNHO`. Em `salvarNota`, logo depois de `editing = salva` quando a nota era nova: `abas = KiroAbas.trocarId(abas, KiroAbas.RASCUNHO, salva.id); gravarAbas();`.
- Ao entrar em Pastas sem `editing` e com aba ativa (`KiroAbas.notaAtiva(abas)` existe em `state.notes`), abra essa nota em edição (`editing` = cópia), para as abas voltarem depois de recarregar ou de ir a outra tela e voltar. Se a ativa for o rascunho e não houver `editing`, feche essa aba.
- `renderCofre`: a área `section.cofre-nota` passa a ter `barraDeAbas(0)` em cima e, embaixo, o editor (`renderEditor()`) se houver `editing`, senão o vazio de hoje.
- Clique na aba: `abrirPorId(id, { painel })` (ativa sem duplicar). Clique no × ou botão do meio (`auxclick`, `button === 1`) na aba: se for a nota em edição com alterações, salve antes (`salvarNota`; se falhar, não fecha). `abas = KiroAbas.fechar(...)`; a nova ativa é aberta em edição (ou `editing = null` se ficou sem abas); `render()`.
- + da barra: `abrirNota(notaVazia(), { novaAba: true, painel })`.
- Árvore: clique numa nota → `abrirPorId(id)`. Ctrl/Cmd+clique ou botão do meio → `abrirPorId(id, { novaAba: true })`. Procure onde `data-action="edit-note"` é tratado em `action()` e passe o evento para saber da tecla.
- Excluir nota (vai para a lixeira): o `limpar` do próximo `renderCofre` tira a aba; se era a nota em `editing`, o código de exclusão atual já zera `editing` — confirme.
- Estilo: barra com altura 38 px, fundo `var(--sidebar-bg)`, borda inferior `var(--line)`; aba com no máximo 200 px, título com reticências, × aparece na ativa e no hover; aba ativa com fundo `var(--content-bg)` e texto `var(--ink)`; foco visível. Use as variáveis do tema, nada de cor fixa.

- [ ] **Step 1: Implement** conforme acima.
- [ ] **Step 2: Run** `node --test` → PASS.
- [ ] **Step 3: Verificar no navegador** (`kiro-dev`, `dev-vault`): abrir nota pela árvore troca a aba; Ctrl+clique abre aba nova; clicar numa aba troca; × fecha e ativa a vizinha; + abre nota nova (rascunho) e, depois de dar título e salvar, a aba passa a ter o id; recarregar a página volta às mesmas abas; ir ao Hoje e voltar mantém as abas; nota excluída some da aba. Registre as evidências no relatório (`javascript_tool` + screenshot).
- [ ] **Step 4: Commit** — `Abas: barra de abas na tela de Pastas`.

---

### Task 3: Tela dividida

**Files:**
- Modify: `app.js`, `styles.css`
- Modify: `docs/KIRO-resumo-para-IA.md` (parágrafo sobre abas e divisão, na seção da interface)

**Interfaces:**
- Consumes (Task 2): `abas`, `gravarAbas`, `idDaAba`, `barraDeAbas(painel)`, `abrirNota(nota, { novaAba, painel })`, `abrirPorId(id, opcoes)`.

**Comportamento:**
- Com `abas.paineis.length === 2`, `section.cofre-nota` vira `<div class="cofre-metades" style="--proporcao:<p>">` com duas `<section class="cofre-metade" data-painel="0|1">` separadas por `<div class="metades-divisor" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Divisão entre as notas">`. A metade `abas.ativo` recebe `renderEditor()` (o editor único, ids `#doc-*` só existem ali); a outra recebe `<article class="doc-leitura" data-painel>` com o título e `renderizarMarkdown(nota.body)` da versão salva (`getNote(id)`). A metade ativa tem a classe `ativa`.
- Clicar na metade em leitura (fora de link e fora da barra de abas): `abrirPorId(ativaDaquelaMetade, { painel })` — isso salva a nota em edição antes (a regra de `abrirNota`). Links `[[…]]` na leitura: abrem na própria metade (`abrirPorId(idDoLink, { painel })`, sem `novaAba`). Links externos e blocos de plug-in continuam como no editor (use o mesmo tratamento de clique que a leitura do editor usa para `a.wikilink`; procure `wikilink` no `app.js`).
- Blocos de plug-in e fórmulas na metade de leitura: chame `agendarBlocosDosPlugins()` depois do `render()`, como o editor já faz.
- Arrastar aba: `dragstart` guarda `{ painel, id }` em `evento.dataTransfer` (`text/x-kiro-aba`). Sobre `.cofre-nota`: se o ponteiro está na metade direita da área (ou sobre a metade 1), destaque o destino (`classe .destino-direita`) → soltar faz `mover(de, id, 1)`; sobre a barra de abas ou a metade da esquerda → `mover(de, id, 0)`. Depois de mover, a aba movida fica ativa em edição (`abrirPorId`).
- Botão direito na aba: `abrirMenuContexto(evento, null, itens)` com "Abrir à direita" (metade 0) / "Abrir à esquerda" (metade 1), "Fechar", "Fechar as outras". Confira a assinatura de `abrirMenuContexto` (~2036) e o formato de `itens` usado por `menuDaNota()` antes de montar.
- Divisória: arrastar (pointer events, `setPointerCapture`), setas ← → ±0,02, dois cliques voltam a 0,5; aplica `KiroAbas.proporcao` e grava. Largura mínima de cada lado 320 px: converta pixels para proporção com a largura atual de `.cofre-metades` e aplique `Math.max/Math.min` antes de chamar `KiroAbas.proporcao`.
- CSS: `.cofre-metades { display:grid; grid-template-columns: calc(var(--proporcao) * 100%) auto 1fr; }` (a divisória na coluna do meio, 7 px, com a linha de 2 px `var(--acento)` no hover/arraste, igual à `.cofre-divisor`). `@media (max-width:900px)` empilha (`grid-template-columns:1fr`, divisória escondida). `@media (max-width:780px)`: se houver duas metades, mostre só a ativa (`.cofre-metade:not(.ativa){display:none}`).
- `docs/KIRO-resumo-para-IA.md`: 3–5 linhas sobre abas por metade, divisão por arrastar ou menu, uma nota em edição por vez, memória por cofre no `localStorage` e o arquivo `abas.js`.

- [ ] **Step 1: Implement** conforme acima.
- [ ] **Step 2: Run** `node --test` → PASS.
- [ ] **Step 3: Verificar no navegador** (`kiro-dev`): arrastar uma aba para a direita divide (use `DragEvent` com `DataTransfer` no `javascript_tool` se o arraste real não for possível, e diga isso no relatório); menu "Abrir à direita" divide; clicar na metade em leitura troca a edição e salva a outra (edite um texto, troque de lado, confira que salvou); link na leitura abre na própria metade; divisória ajusta e dois cliques voltam ao meio; fechar a última aba de um lado junta; recarregar volta dividido; a 850 px empilha. Screenshot da tela dividida.
- [ ] **Step 4: Commit** — `Abas: tela dividida com duas metades`.
