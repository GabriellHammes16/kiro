# Sistema de plug-ins do Kiro — etapa 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plug-ins reagem a eventos do cofre (`onSave`, `onCreate`, `onDay`) e estendem o Markdown com blocos `kiro:<id>` cujo HTML é higienizado; comandos saem do botão direito e passam a ser rodados só em Configurações; os temas são conferidos com a interface nova.

**Architecture:** O higienizador é código puro em `plugins.js` (lista de permitidos, sem DOM, testável no Node). Eventos e blocos seguem o protocolo de mensagens da etapa 1: o worker registra os handlers e a página dispara `acao` com `registro.tipo` `event` ou `block`. O desenho dos blocos é assíncrono: o `renderizarMarkdown` emite um marcador e o hospedeiro preenche depois.

**Tech Stack:** JavaScript puro, sem build e sem dependência nova; `node --test`; Electron 44 e o servidor local.

**Spec:** `docs/superpowers/specs/2026-09-15-plugins-design.md` (seções "Blocos de Markdown", "Higienização do HTML", "API pública"). Etapa 1 implementada em `docs/superpowers/plans/2026-09-15-plugins-etapa-1.md`.

## Global Constraints

- Sem framework, sem TypeScript, sem build, sem dependência nova.
- API pública do plug-in em inglês; código interno, comentários e interface em português do Brasil.
- Nunca operação genérica de arquivo ou processo. Plug-in continua sem DOM, sem disco e sem rede.
- Testes só em cofre temporário (`fs.mkdtemp`); nunca `C:\Projetos\Meu segundo cerebro\vault` nem `%USERPROFILE%\Documents\KUROI\vault`. O cofre de exemplo `dev-vault` pode ser usado e recriado.
- Nada de `confirm()` ou `alert()` nativos.
- Protocolo de mensagens da etapa 1 (cabeçalho de `plugin-worker.js`) não muda de forma incompatível: só ganha tipos novos de `registro`.
- Limites: chamada 5 s; evento 5 s; bloco 5 s; HTML de bloco até 200 KB antes da limpeza.
- Arquivos com CRLF: Edit/Write, nunca heredoc do Bash. Commit por tarefa, sem push.

---

### Task A: Comandos só nas Configurações

**Files:**
- Modify: `app.js` — `comandosDosPlugins` e o item "Plug-ins" do menu da nota (~linha 1879), `menuDoPlugin` e o `contextmenu` do card (~2185–2224), o botão `plugin-comandos` em `cardsDosPlugins` (~2135), e a seção `// ---- Aba Plug-ins ----` (~2397).
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `rodarComandoDoPlugin(id, comando)`, `pluginsAtivos`.
- Produces: na aba Plug-ins, cada plug-in ativo com comandos mostra um botão por comando (`data-comando-plugin="<id>"`, `data-comando="<comandoId>"`). Nenhum menu de botão direito lista plug-ins.

- [ ] **Step 1: Write the failing test**

```js
test('plug-ins não aparecem em menu de botão direito; comandos rodam nas Configurações', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/rotulo: 'Plug-ins'/.test(app), 'o menu da nota não deve ter submenu de plug-ins');
  assert.ok(!/closest\?\.\('\.plugin-painel'\)[\s\S]{0,80}abrirMenuContexto/.test(app), 'o card não deve abrir menu de contexto');
  assert.ok(!/'plugin-comandos'/.test(app), 'o cabeçalho do card não deve ter botão de comandos');
  assert.ok(/data-comando-plugin=/.test(app), 'a aba Plug-ins deve ter botões de comando');
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test tests/plugins.test.cjs` → FAIL.

- [ ] **Step 3: Implement**

Remova o item `...(comandosDosPlugins().length ? [...]` do menu da nota, a função `comandosDosPlugins`, `menuDoPlugin`, o listener de `contextmenu` do card e o `extraButton('plugin-comandos', …)`. Plug-in só de comandos deixa de gerar card na tela Hoje (a linha "Plug-in só de comandos também aparece…" sai).

Na aba Plug-ins, dentro da linha de cada plug-in ativo com comandos:

```js
const comandos = (pluginsAtivos.get(id)?.comandos || [])
  .map(c => `<button type="button" class="secondary cfg-pequeno" data-comando-plugin="${escapeHtml(id)}" data-comando="${escapeHtml(c.id)}">${icone('plugin')} ${escapeHtml(c.label)}</button>`)
  .join('');
// … na linha: comandos ? `<div class="cfg-botoes plugin-comandos-cfg">${comandos}</div>` : ''
```

e no tratamento de clique da aba:

```js
const botao = evento.target.closest('[data-comando-plugin]');
if (botao) { rodarComandoDoPlugin(botao.dataset.comandoPlugin, botao.dataset.comando); return; }
```

A nota aberta continua aberta por baixo do modal de Configurações, então `kiro.notes.current()` segue funcionando a partir da aba.

- [ ] **Step 4:** `node --test` inteiro → PASS. No navegador (`kiro-dev`): botão direito na nota sem "Plug-ins"; card do Word Count sem botão no cabeçalho; com uma nota aberta, Configurações → Plug-ins → "Count words in the open note" mostra a contagem.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: comandos só nas Configurações"`

---

### Task B: Conferência dos temas e skins

**Files:**
- Modify (só se houver defeito): `temas.css`, `styles.css`
- Test: `tests/temas.test.cjs` (acrescentar, não reescrever)

**Interfaces:**
- Consumes: `Kiro.TEMAS`, `Kiro.SKINS`, as classes `.plugin-*` e `.tema-opcao`.
- Produces: nenhum contrato novo; defeitos corrigidos e um teste que trava o que foi encontrado.

- [ ] **Step 1: Inspecionar de verdade.** No navegador (`kiro-dev`), para cada um dos 18 temas e para as skins `padrao`, `terminal`, `sharp`, `compacto` e `paper`, aplique a combinação pelo mesmo caminho da interface (`gravarAparencia`) e confira: tela Hoje com o card do plug-in, uma nota aberta, Configurações nas abas Personalização e Plug-ins, menu de contexto. Procure texto ilegível, borda invisível, foco invisível, ícone sumido, card do plug-in sem fundo, layout quebrado. Registre também `getComputedStyle` das variáveis principais para confirmar que a troca de classe aplica.
- [ ] **Step 2: Write the failing test** para cada defeito real encontrado (por exemplo: toda regra `.plugin-*` usa só variáveis, nenhuma cor fixa; toda cor fixa nova em `styles.css` tem motivo). Se nada estiver quebrado, o teste trava a garantia mais útil: nenhuma regra `.plugin-*` com cor hexadecimal fixa.
- [ ] **Step 3:** corrija só o que falhou, no arquivo onde a regra mora.
- [ ] **Step 4:** `node --test` inteiro → PASS; screenshot de três combinações contrastantes (ex.: `alto-contraste`+`sharp`, `sakura-night`+`suave`, `wired-dreams`+`terminal`). Restaure o `localStorage['kiro.aparencia']` original no fim.
- [ ] **Step 5: Commit** — `git commit -m "Temas: conferência com a interface de plug-ins"` (se não houver mudança de código, relate sem commit).

---

### Task C: Higienizador de HTML (`plugins.js`)

**Files:**
- Modify: `plugins.js`
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: nada.
- Produces: `KiroPlugins.higienizarHtml(html)` → string segura. Sem DOM: funciona no Node e no navegador.

- [ ] **Step 1: Write the failing test**

```js
test('higienizador mantém o permitido e remove o perigoso', () => {
  const limpo = P.higienizarHtml;
  assert.equal(limpo('<p>oi <strong>forte</strong></p>'), '<p>oi <strong>forte</strong></p>');
  assert.equal(limpo('<script>alert(1)</script><p>x</p>'), '<p>x</p>');
  assert.equal(limpo('<img src="x" onerror="alert(1)">'), '<img>');
  assert.equal(limpo('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(limpo('<a href="https://kiro.app" target="_blank">x</a>'), '<a href="https://kiro.app" rel="noopener noreferrer">x</a>');
  assert.equal(limpo('<iframe src="https://x"></iframe><b>ok</b>'), '<b>ok</b>');
  assert.equal(limpo('<div style="position:fixed">x</div>'), '<div>x</div>');
  assert.equal(limpo('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'), '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>');
  assert.equal(limpo('<img src="data:image/png;base64,AAAA">'), '<img src="data:image/png;base64,AAAA">');
  assert.equal(limpo('<img src="data:text/html;base64,AAAA">'), '<img>');
  assert.equal(limpo('<p>a &lt; b</p>'), '<p>a &lt; b</p>');
  assert.equal(limpo('<P ONCLICK="x">y</P>'), '<p>y</p>');
  assert.equal(limpo('<style>body{}</style><p>z</p>'), '<p>z</p>');
  assert.equal(limpo('<!-- <script>x</script> --><p>c</p>'), '<p>c</p>');
  assert.equal(limpo('<svg><foreignObject><p>x</p></foreignObject></svg>'), '<svg></svg>');
});
```

- [ ] **Step 2: Run** → FAIL com `P.higienizarHtml is not a function`.

- [ ] **Step 3: Implement**

Tokenizador simples: texto entre tags é re-escapado; cada tag é lida por regex, o nome passa por lista de permitidos, cada atributo por lista de permitidos e validação de valor. Conteúdo de `script`, `style`, `iframe`, `object`, `embed`, `template`, `noscript`, `foreignObject`, `textarea`, `title` é descartado inteiro, com a tag. Comentários e `<!DOCTYPE>` somem. Tags fora da lista somem, mas o texto de dentro fica (exceto as de conteúdo descartado). Tags vazias (`br, hr, img`) saem sem fechamento; as demais são fechadas na ordem, e fechamentos sem abertura correspondente são ignorados.

```js
  const TAGS = new Set(['p','br','hr','span','div','strong','em','b','i','u','s','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','a','img','svg','g','path','rect','circle','line','polyline','polygon','text']);
  const VAZIAS = new Set(['br','hr','img']);
  const DESCARTAR = new Set(['script','style','iframe','object','embed','template','noscript','foreignobject','textarea','title']);
  const ATRIBUTOS = new Set(['class','title','alt','colspan','rowspan','href','src','width','height','viewbox','d','fill','stroke','stroke-width','x','y','x1','y1','x2','y2','cx','cy','r','points','text-anchor','font-size','transform']);
  // SVG diferencia maiúsculas: devolvemos o nome canônico.
  const CANONICO = { viewbox: 'viewBox' };
  const decodificar = v => v.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
  function valorPermitido(nome, valor) {
    const v = decodificar(valor).replace(/[\u0000-\u0020]/g, '').toLowerCase();
    if (nome === 'href') return /^(https?:|#)/.test(v);
    if (nome === 'src') return /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(v);
    return !/(javascript|vbscript|data):|expression\(|url\(/.test(v);
  }
  function higienizarHtml(html) {
    const entrada = String(html ?? '').slice(0, 200 * 1024).replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
    const saida = [], abertas = [];
    let descartando = null;
    const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|([^<]+)|(<)/g;
    for (const m of entrada.matchAll(re)) {
      const [bruto, nomeBruto, atributos, texto] = m;
      if (texto !== undefined || m[4]) {
        if (!descartando) saida.push(escapar(decodificar(texto ?? '<')));
        continue;
      }
      const nome = nomeBruto.toLowerCase(), fechando = bruto.startsWith('</');
      if (descartando) { if (fechando && nome === descartando) descartando = null; continue; }
      if (DESCARTAR.has(nome)) { if (!fechando && !/\/>$/.test(bruto)) descartando = nome; continue; }
      if (!TAGS.has(nome)) continue;
      if (fechando) {
        const i = abertas.lastIndexOf(nome);
        if (i < 0) continue;
        while (abertas.length > i) saida.push(`</${abertas.pop()}>`);
        continue;
      }
      const attrs = [];
      for (const a of (atributos || '').matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        const chave = a[1].toLowerCase();
        const valor = a[2] ?? a[3] ?? a[4] ?? '';
        if (!ATRIBUTOS.has(chave) || !valorPermitido(chave, valor)) continue;
        attrs.push(` ${CANONICO[chave] || chave}="${escapar(decodificar(valor))}"`);
      }
      if (nome === 'a' && attrs.some(a => a.startsWith(' href='))) attrs.push(' rel="noopener noreferrer"');
      saida.push(`<${nome}${attrs.join('')}>`);
      if (!VAZIAS.has(nome) && !/\/>$/.test(bruto)) abertas.push(nome);
      else if (!VAZIAS.has(nome)) saida.push(`</${nome}>`);
    }
    while (abertas.length) saida.push(`</${abertas.pop()}>`);
    return saida.join('');
  }
```

Exporte `higienizarHtml` em `api`. `escapar` já existe desde a etapa 1. Ajuste o código até os casos do teste baterem exatamente; se algum caso do teste estiver errado em relação à especificação, corrija o teste e diga no relatório.

- [ ] **Step 4:** `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: higienizador de HTML com lista de permitidos"`

---

### Task D: Eventos `onSave`, `onCreate` e `onDay`

**Files:**
- Modify: `plugin-worker.js` (registro e disparo dos handlers)
- Modify: `app.js` (seção `// ---- Plug-ins ----` e o ponto onde uma gravação termina, `save()` na linha ~7)
- Modify: `plugins.js` (decisão pura de quais eventos entregar)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: protocolo da etapa 1; `podeChamar`; `notaParaPlugin` do `app.js`.
- Produces:
  - Worker: `kiro.onSave(handler)`, `kiro.onCreate(handler)`, `kiro.onDay(handler)`; `pronto.registros` ganha `event: ['save'|'create'|'day']`.
  - Página → worker: `{ tipo: 'acao', chamada, registro: { tipo: 'event', id: 'save'|'create'|'day' }, dados }`.
  - `KiroPlugins.eventosDaGravacao(antes, depois)` → `{ criadas: [id], alteradas: [id] }` comparando `updatedAt`/existência de notas.
  - `KiroPlugins.deveEntregar(evento, permissoes)` → `false` para `save`/`create` sem `notes:read`; `day` é sempre entregue.

- [ ] **Step 1: Write the failing test**

```js
test('eventos: o que mudou numa gravação e quem pode receber', () => {
  const antes = [{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 1 }];
  const depois = [{ id: 'a', updatedAt: 2 }, { id: 'b', updatedAt: 1 }, { id: 'c', updatedAt: 3 }];
  assert.deepEqual(P.eventosDaGravacao(antes, depois), { criadas: ['c'], alteradas: ['a'] });
  assert.deepEqual(P.eventosDaGravacao(depois, depois), { criadas: [], alteradas: [] });
  assert.equal(P.deveEntregar('save', ['notes:read']), true);
  assert.equal(P.deveEntregar('save', []), false);
  assert.equal(P.deveEntregar('create', ['tasks:read']), false);
  assert.equal(P.deveEntregar('day', []), true);
  assert.equal(P.deveEntregar('outro', ['notes:read']), false);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`plugins.js`:

```js
  function eventosDaGravacao(antes, depois) {
    const anterior = new Map((antes || []).map(n => [n.id, n.updatedAt]));
    const criadas = [], alteradas = [];
    for (const n of depois || []) {
      if (!anterior.has(n.id)) criadas.push(n.id);
      else if (anterior.get(n.id) !== n.updatedAt) alteradas.push(n.id);
    }
    return { criadas, alteradas };
  }
  const deveEntregar = (evento, permissoes) =>
    evento === 'day' ? true : (evento === 'save' || evento === 'create') && (permissoes || []).includes('notes:read');
```

`plugin-worker.js`: `registros` ganha `event: new Map()`; `kiro.onSave = h => registros.event.set('save', h)` (idem `create`, `day`); o `pronto` passa `event: [...registros.event.keys()]`; o tratamento de `acao` já busca `registros[registro.tipo]`, então só confira que `event` entra. Um handler de evento que lançar erro devolve `resposta` com `erro`, sem derrubar o worker.

`app.js`:
- Guarde as notas antes de cada gravação que a interface ou um plug-in fizer, e depois de `save()` concluir calcule `eventosDaGravacao`.
- Para cada plug-in ativo com o evento registrado e `deveEntregar` verdadeiro, chame `chamarPlugin(id, { tipo: 'event', id: 'save' }, { note: notaParaPlugin(nota) })` para cada alterada, e `create` para cada criada. Máximo de 20 notas por evento por gravação.
- **Anti-laço:** uma gravação feita por um plug-in durante o próprio handler de evento não dispara evento de volta para ele (marque a origem da gravação com o id do plug-in em curso e pule esse plug-in no cálculo). Além disso, eventos em cascata param no 3º nível de profundidade.
- Gravação vinda de recarga externa (outro editor, agente MCP) também dispara, com o mesmo cálculo, quando o `reload()` troca `state`.
- `day`: guarde `kiro.ultimoDia` (dia local) por plug-in em `sessionStorage`; ao ativar e no intervalo de 5 s que já existe, se o dia mudou, dispare `day` com `{ date }`.
- Erro ou tempo estourado num evento: aviso na barra de status com o nome do plug-in; o plug-in continua ativo.

- [ ] **Step 4:** `node --test` inteiro → PASS. No navegador (`kiro-dev`): crie um plug-in de teste temporário em `dev-vault/.kiro/plugins/teste-eventos` com `notes:read` + `notes:write` que, no `onSave`, acrescenta uma tag `visto` à nota salva; ative pelas Configurações; salve uma nota e confira a tag e que o salvamento não entrou em laço (uma única gravação extra). Depois apague o plug-in de teste e a entrada dele em `plugins.json`.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: eventos onSave, onCreate e onDay com proteção contra laço"`

---

### Task E: Blocos de Markdown `kiro:<id>`

**Files:**
- Modify: `app.js` (`renderizarMarkdown`, ~linha 1172, e a seção de plug-ins)
- Modify: `plugin-worker.js` (`kiro.block`)
- Modify: `styles.css` (estado do bloco)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `higienizarHtml` (Task C); `painelParaHtml` (etapa 1); protocolo com `registro.tipo = 'block'`, `id = 'render'`.
- Produces: `kiro.block(handler)`; no Markdown, a cerca ` ```kiro:<id> ` vira `<figure class="plugin-bloco" data-plugin="<id>" data-pos … data-fim …>` com a fonte guardada.

- [ ] **Step 1: Write the failing test**

```js
test('bloco kiro:<id> vira marcador com a fonte escapada', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /plugin-bloco/);
  assert.match(app, /higienizarHtml/);
  assert.match(app, /\^kiro:\[a-z0-9\]\[a-z0-9-\]\{1,39\}\$|kiro:\(\[a-z0-9\]/);
});
```

(O desenho em si é verificado no navegador, no passo 4; `renderizarMarkdown` depende de DOM do app.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

Em `renderizarMarkdown`, antes do tratamento genérico da cerca:

```js
      const doPlugin = cerca[1].trim().match(/^kiro:([a-z0-9][a-z0-9-]{1,39})$/);
      if (doPlugin) {
        saida.push(`<figure class="plugin-bloco" data-plugin="${doPlugin[1]}" data-fonte="${escapeHtml(corpo.join('\n'))}" ${abrir(inicio, ate)}><div class="plugin-bloco-conteudo empty">${pluginsAtivos.has(doPlugin[1]) ? 'Carregando…' : `Plug-in ${escapeHtml(doPlugin[1])} não está ativo.`}</div></figure>`);
        avancar(ate - i);
        i = j + 1;
        continue;
      }
```

No hospedeiro, depois de cada desenho da nota, para cada `.plugin-bloco` cujo plug-in está ativo e registrou `block`: `chamarPlugin(id, { tipo: 'block', id: 'render' }, { source })`. O retorno `{ html }` passa por `KiroPlugins.higienizarHtml`; um retorno de painel (`{ type: … }`) passa por `painelParaHtml`. Guarde por `(id, fonte)` num `Map` para o redesenho não piscar e não chamar de novo sem mudança de texto. Erro vira texto de aviso dentro do bloco. O bloco continua editável como os de código: ao clicar para editar, mostra a fonte Markdown, como o `code-area` já faz.

`plugin-worker.js`: `kiro.block = handler => registros.block.set('render', handler)`, `registros.block = new Map()`, e `pronto` passa `block: [...registros.block.keys()]`.

- [ ] **Step 4:** `node --test` inteiro → PASS. No navegador: estenda o exemplo `examples/plugins/word-count` com `kiro.block(async text => ({ html: \`<p><strong>${words(text)}</strong> words in this block</p>\` }))` (copie para `dev-vault/.kiro/plugins/word-count/`), escreva numa nota um bloco ` ```kiro:word-count ` com algum texto e confira o desenho; escreva um bloco cujo plug-in devolva `<img src=x onerror=alert(1)>` num plug-in de teste temporário e confira que o `onerror` não chega ao DOM. Apague o plug-in de teste.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: blocos de Markdown kiro:<id> com HTML higienizado"`

---

### Task F: Documentação e exemplo da etapa 2

**Files:**
- Modify: `docs/plugins.md` (inglês), `docs/KIRO-resumo-para-IA.md` (português), `examples/plugins/word-count/index.js` (se a Task E já não tiver incluído o bloco)
- Test: `tests/plugins.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
test('documentação da etapa 2 está em dia', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'plugins.md'), 'utf8');
  for (const termo of ['onSave', 'onCreate', 'onDay', 'kiro.block', 'sanitiz']) assert.ok(doc.includes(termo), `docs/plugins.md deve cobrir ${termo}`);
  assert.ok(!/onSave[^\n]*not available yet/i.test(doc), 'onSave não pode continuar marcado como indisponível');
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** documente os três eventos (quando disparam, payload, permissão exigida, anti-laço, limites), o bloco `kiro:<id>` (sintaxe, retorno `{ html }` ou painel, a lista exata de tags e atributos permitidos), e deixe só a rede como "not available yet". Acrescente o parágrafo equivalente em português no resumo.
- [ ] **Step 4:** `node --test` inteiro → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Plug-ins: documentação da etapa 2"`

---

## Ordem e dependências

- A (app.js, aba e menus), B (CSS) e C (plugins.js) são independentes entre si e podem rodar em paralelo.
- D depende de C estar commitado (mexe em `plugins.js`) e de A (mexe no `app.js`).
- E depende de C (usa `higienizarHtml`) e de D (mexe nos mesmos trechos de `plugin-worker.js` e `app.js`).
- F vem por último.
