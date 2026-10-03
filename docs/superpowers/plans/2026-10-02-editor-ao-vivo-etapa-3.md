# Editor ao vivo — etapa 3 (plug-ins, Fluxo, limpeza e entrega) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blocos ```` ```kiro:<id> ```` desenhados no editor novo, o editor novo nos cartões de texto do Fluxo, as pendências da etapa 2, a remoção do editor antigo de blocos e o instalador 0.19.0.

**Architecture:** `editor-widgets.js` ganha o elemento `blocoPlugin` (vindo do `StateField` de blocos, como a fórmula `$$`) com um widget que recebe o HTML do app por `desenharBlocoPlugin(id, fonte)`; o app reaproveita o desenho de plug-ins da leitura com uma função de marcação única. `fluxo-tela.js` ganha a opção `montarEditor`, que o app implementa com `KiroEditor.montar`. O editor antigo (código morto desde a etapa 1) sai de `app.js` e `styles.css`.

**Tech Stack:** JS puro sem build, módulos UMD, CodeMirror 6 em `vendor/codemirror/codemirror.js` (global `CM`), Electron 44, testes `node:test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-10-02-editor-ao-vivo-etapa-3-design.md`

## Global Constraints

- Branch `editor-ao-vivo`; nenhum merge em `idiomas-etapa-1`/`main` sem o usuário aprovar o instalador.
- Sem dependências novas; sem etapa de build; o app continua abrindo com `index.html` (desktop) e `server.mjs` (web).
- Comentários e nomes em português, no estilo do arquivo; mensagens de commit "Editor: …" / "Fluxo: …" terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Toda frase nova de interface passa por `t('…')` e entra em `idiomas/en.js`; `tests/idiomas-cobertura.test.cjs` continua passando.
- Todo HTML vindo de plug-in passa pelo caminho já existente (`htmlDoBloco` → higienizador ou moldura); nada de HTML cru de plug-in no DOM.
- Desempenho: abrir a nota longa (67,6 KB) quente sem piora sobre 17 ms; digitar < 16 ms por tecla; abrir um cartão do Fluxo para editar < 50 ms com o CodeMirror carregado.
- Nunca matar processos `node.exe`/`electron.exe` que você não iniciou.

## Review Focus

1. Link `<a href>` dentro do HTML de um plug-in, desenhado no editor: nunca navega a janela do app; http(s) abre fora, o resto não faz nada (a leitura já faz isso em `bindCorpo`) — Task 1 (widget) e Task 5 (e2e).
2. Plug-in termina de desenhar depois (ou a moldura muda de altura): o editor mede de novo e o texto abaixo não fica sobreposto — Task 1 (`ResizeObserver` → `view.requestMeasure()`), Task 5 (e2e).
3. Botão direito numa palavra errada dentro de um cartão do Fluxo: escolher a sugestão troca a palavra antes de o cartão fechar (o menu do Kiro não rouba o foco — `montarNivel` faz `mousedown` `preventDefault`) — Task 3 e Task 5 (e2e).
4. Salvamento automático (o `.app-shell` fica `inert`) durante a edição de um cartão: grava o texto como hoje (o `textarea` fechava pelo `blur`), sem perder o que foi digitado — Task 3 (mesma regra: `focusout` sem destino dentro do cartão conclui gravando).
5. Corretor carregado depois de abrir o cartão: o sublinhado aparece no cartão (o aviso de carregamento redesenha também o editor do cartão) — Task 3.

---

### Task 1: Bloco de plug-in, Ctrl+Enter, Ctrl+clique e altura estimada (`editor-widgets.js`)

**Files:**
- Modify: `editor-widgets.js`
- Test: `tests/editor-widgets.test.cjs`

**Interfaces:**
- Consumes: `KiroEditor.linhasDaSelecao(state)`, `KiroEditor.marcacoesDoKiro(texto)` (já existem).
- Produces:
  - elemento `{ tipo: 'blocoPlugin', de, ate, id, fonte }` em `acharElementos` (inclusive com `soBlocos`); `de` = início da linha da cerca de abertura, `ate` = fim da linha da cerca de fechamento, `fonte` = linhas de dentro unidas por `'\n'`.
  - `trocasDasTarefas(state, numerosDeLinha, arvore?) → [{from,to,insert}]` (exportada).
  - opção nova de `extensao`: `desenharBlocoPlugin(id, fonte) → html` (o app implementa na Task 2).

- [ ] **Step 1: Testes que falham** — acrescente ao fim de `tests/editor-widgets.test.cjs`:

```js
test('bloco de plug-in: id, fonte, posições; não vira cabeçalho de código', () => {
  const texto = 'a\n```kiro:word-count\nx\ny\n```\nb';
  const { s, els } = achar(texto);
  const b = els.find(e => e.tipo === 'blocoPlugin');
  assert.equal(b.id, 'word-count');
  assert.equal(b.fonte, 'x\ny');
  assert.equal(fatia(s, b), '```kiro:word-count\nx\ny\n```');
  assert.ok(!els.some(e => e.tipo === 'cabecalhoCodigo'));
});

test('bloco de plug-in com \\r\\n: fonte com \\n e linhas certas', () => {
  const { s, els } = achar('a\r\n```kiro:x1\r\nfonte\r\nmais\r\n```', '\r\n');
  const b = els.find(e => e.tipo === 'blocoPlugin');
  assert.equal(b.fonte, 'fonte\nmais');
  assert.equal(s.doc.lineAt(b.de).number, 2);
  assert.equal(s.doc.lineAt(b.ate).number, 5);
});

test('bloco de plug-in: id inválido, sem fechamento ou recuado não é bloco; vazio tem fonte vazia', () => {
  for (const texto of ['```kiro:X\na\n```', '```kiro:a\na\n```', '```kiro:ok-id\nsem fim', '- ```kiro:ok-id\n  a\n  ```']) {
    assert.ok(!achar(texto).els.some(e => e.tipo === 'blocoPlugin'), texto);
  }
  assert.equal(achar('```kiro:ok-id\n```').els.find(e => e.tipo === 'blocoPlugin').fonte, '');
});

test('soBlocos inclui o bloco de plug-in', () => {
  const s = estado('```kiro:ok-id\nfonte\n```\n\n$$\nx\n$$');
  const arvore = CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
  const tipos = W.acharElementos(s, 0, s.doc.length, { arvore, soBlocos: true }).map(e => e.tipo);
  assert.deepEqual(tipos, ['blocoPlugin', 'formulaBloco']);
});

test('Ctrl+Enter: trocas das tarefas das linhas pedidas', () => {
  const s = estado('- [ ] a\ntexto\n- [x] b');
  const arvore = CM.language.ensureSyntaxTree(s, s.doc.length, 5000);
  assert.deepEqual(W.trocasDasTarefas(s, [1, 2, 3], arvore), [{ from: 3, to: 4, insert: 'x' }, { from: 17, to: 18, insert: ' ' }]);
  assert.deepEqual(W.trocasDasTarefas(s, [2], arvore), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/editor-widgets.test.cjs`
Expected: os 5 testes novos falham (`blocoPlugin` não achado; `W.trocasDasTarefas is not a function`).

- [ ] **Step 3: Reconhecer o bloco** — em `acharElementos`, no ramo `if (no.name === 'FencedCode')`, troque a linha `if (!/^kiro:/.test(info)) {` e o bloco dela por:

```js
          const plugin = /^kiro:([a-z0-9][a-z0-9-]{1,39})$/.exec(info);
          const fechada = no.node.getChildren('CodeMark').length > 1;
          // Mesma regra da leitura: cerca no início da linha, fechada, id válido.
          if (plugin) {
            if (fechada && primeira.from === no.from && primeira.text.startsWith('```')) {
              const fonte = ultima.number - primeira.number > 1 ? doc.sliceString(doc.line(primeira.number + 1).from, doc.line(ultima.number - 1).to) : '';
              els.push({ tipo: 'blocoPlugin', de: primeira.from, ate: ultima.to, id: plugin[1], fonte });
            }
          } else if (!/^kiro:/.test(info)) {
```

  e apague a linha `const fechada = no.node.getChildren('CodeMark').length > 1;` que havia dentro do bloco antigo (agora fica acima). O resto do bloco (citações, recuo, `cabecalhoCodigo`) continua igual. Ajuste o comentário do `return els.sort(...)` de `soBlocos` para "só blocos (código, plug-in e $$): não se sobrepõem entre si". No mapa `prioridade`, acrescente `blocoPlugin: 4`.

- [ ] **Step 4: `trocasDasTarefas`** — logo depois de `trocaDaLargura`:

```js
  // Ctrl+Enter: as tarefas das linhas pedidas (as do cursor ou da seleção).
  function trocasDasTarefas(state, numeros, arvore) {
    const changes = [];
    for (const n of numeros) {
      const l = state.doc.line(n);
      for (const el of acharElementos(state, l.from, l.to, { arvore, blocos: [] })) if (el.tipo === 'tarefa') changes.push(trocaDaTarefa(state, el));
    }
    return changes;
  }
```

  e inclua `trocasDasTarefas` no objeto `api` do fim do arquivo.

- [ ] **Step 5: Rodar os testes**

Run: `node --test tests/editor-widgets.test.cjs`
Expected: todos passam.

- [ ] **Step 6: O widget do bloco de plug-in** — em `extensao`:
  - `const BLOCOS = new Set(['formulaBloco', 'cabecalhoCodigo', 'blocoPlugin']);`
  - Altura estimada (a rolagem não pula): em `Formula` acrescente `get estimatedHeight() { return this.bloco ? 48 : -1; }`; em `CabecalhoDoCodigo`, `get estimatedHeight() { return 34; }`.
  - Nova classe, depois de `CabecalhoDoCodigo`:

```js
    class BlocoDePlugin extends V.WidgetType {
      constructor(id, fonte) { super(); this.id = id; this.fonte = fonte; }
      eq(o) { return o.id === this.id && o.fonte === this.fonte; }   // digitar em outro lugar não recria o desenho (nem a moldura)
      get estimatedHeight() { return 120; }
      toDOM(view) {
        const e = document.createElement('div');
        e.className = 'ed-plugin';
        e.innerHTML = opcoes.desenharBlocoPlugin ? opcoes.desenharBlocoPlugin(this.id, this.fonte) : '';
        e.addEventListener('mousedown', ev => {
          if (ev.button !== 0 || ev.target.closest('a, button, input, select, textarea, iframe')) return;
          ev.preventDefault();   // clicar no desenho mostra a fonte: cursor no início do bloco
          view.dispatch({ selection: { anchor: view.posAtDOM(e) } });
          view.focus();
        });
        // Link desenhado por plug-in nunca navega a janela: http(s) abre fora; o resto não faz nada.
        e.addEventListener('click', ev => {
          const a = ev.target.closest('a');
          if (!a) return;
          ev.preventDefault();
          const destino = a.getAttribute('href') || '';
          if (/^https?:\/\//i.test(destino)) opcoes.abrirSite?.(destino);
        });
        // O plug-in desenha depois (e a moldura muda de altura): o editor mede de novo.
        e._observador = new ResizeObserver(() => view.requestMeasure());
        e._observador.observe(e);
        return e;
      }
      destroy(dom) { dom._observador?.disconnect(); }
      ignoreEvent() { return true; }   // os cliques são tratados acima ou são do plug-in
    }
```

  - Em `desenharBlocos`, troque a linha do `widget` por:

```js
        const widget = el.tipo === 'formulaBloco' ? new Formula(el.tex, true)
          : el.tipo === 'blocoPlugin' ? new BlocoDePlugin(el.id, el.fonte)
          : new CabecalhoDoCodigo(el.linguagem, el.codigo);
```

- [ ] **Step 7: Ctrl+Enter e Ctrl+clique** — em `extensao`:
  - Antes de `const ext = …`:

```js
    // Ctrl+Enter (Cmd+Enter): marca/desmarca as tarefas das linhas do cursor ou da seleção, como no Obsidian.
    const teclas = S.Prec.high(V.keymap.of([{
      key: 'Mod-Enter',
      run: view => {
        const changes = trocasDasTarefas(view.state, [...linhasDaSelecao(view.state)]);
        if (!changes.length) return false;
        view.dispatch({ changes, userEvent: 'input' });
        return true;
      },
    }]));
```

  - `const ext = [campoDosBlocos, pluginEmLinha, cliques, teclas];`
  - Em `cliques.mousedown`, troque as duas primeiras condições e a da linha do cursor:

```js
        const comMod = e.ctrlKey || e.metaKey;   // Ctrl+clique abre o link mesmo na linha do cursor
        if (e.button !== 0 || e.shiftKey || e.altKey) return false;
```

  e `if (!comMod && linhasDaSelecao(view.state).has(linha.number)) return false;` no lugar da linha atual equivalente. Atualize o comentário acima de `cliques`: "Cliques em links fora da linha do cursor; com Ctrl/Cmd, em qualquer linha."
  - Atualize o comentário do topo do arquivo para incluir "bloco de plug-in".

- [ ] **Step 8: Testes completos**

Run: `npm test`
Expected: 0 fail.

- [ ] **Step 9: Commit**

```bash
git add editor-widgets.js tests/editor-widgets.test.cjs
git commit -m "Editor: bloco de plug-in desenhado, Ctrl+Enter marca tarefa, Ctrl+clique abre link na linha do cursor"
```

---

### Task 2: O app desenha o bloco de plug-in no editor (`app.js`)

**Files:**
- Modify: `app.js` (`renderizarMarkdown` ~2460, bloco "Blocos ```kiro:<id> nas notas" ~3915, `opcoesDoEditor` ~1859)
- Modify: `styles.css` (bloco das regras `.doc-corpo .cm-editor …` ~1339-1355)

**Interfaces:**
- Consumes: opção `desenharBlocoPlugin(id, fonte) → html` da Task 1.
- Produces: `htmlDoBlocoPlugin(id, fonte, atributos = '') → string` em `app.js` (usada pela leitura e pelo editor).

- [ ] **Step 1: Marcação única** — no bloco "Blocos ```kiro:<id> nas notas", depois de `conteudoDoBloco`:

```js
// A mesma marcação na leitura e no editor; desenharBlocosDosPlugins a completa depois.
function htmlDoBlocoPlugin(id, fonte, atributos = '') {
  agendarBlocosDosPlugins();
  const pronto = pluginsAtivos.has(id) && conteudoDosBlocos.has(`${id}\n${fonte}`);
  return `<figure class="plugin-bloco" data-plugin="${id}" data-fonte="${escapeHtml(fonte)}" ${atributos}><div class="plugin-bloco-conteudo" data-desenho="${pronto ? 'pronto' : 'aviso'}">${conteudoDoBloco(id, fonte)}</div></figure>`;
}
```

- [ ] **Step 2: A leitura usa a função** — em `renderizarMarkdown`, troque as duas linhas `saida.push(\`<figure class="plugin-bloco" …\`);` e `agendarBlocosDosPlugins();` do ramo `if (doPlugin)` por:

```js
        saida.push(htmlDoBlocoPlugin(doPlugin[1], fonteDoBloco, abrir(inicio, ate)));
```

  (`id` já vem validado pela regex `^kiro:([a-z0-9][a-z0-9-]{1,39})$`, por isso entra no atributo sem escapar, como hoje.)

- [ ] **Step 3: O editor usa a função** — em `opcoesDoEditor().widgets`, acrescente:

```js
      desenharBlocoPlugin: (id, fonte) => htmlDoBlocoPlugin(id, fonte),
```

- [ ] **Step 4: Estilo** — em `styles.css`, depois de `.doc-corpo .cm-editor .md-comentario …`:

```css
.doc-corpo .cm-editor .ed-plugin { cursor:pointer; }
.doc-corpo .cm-editor .ed-plugin .plugin-bloco { margin:0 0 14px; cursor:auto; }
```

- [ ] **Step 5: Testes** — Run: `npm test` — Expected: 0 fail.

- [ ] **Step 6: Verificar no navegador** — `npm run dev` (ou o servidor da porta 4180 se já estiver rodando — não pare servidores que você não iniciou), abrir no navegador automatizado uma nota com

````markdown
```kiro:kanban-tasks
```
````

  (o plug-in `kanban-tasks` está ativo no `dev-vault`): fora do cursor aparece a moldura do plug-in (ou o aviso "Carregando…" seguido do desenho); clicar no desenho fora da moldura mostra a fonte; digitar em outra linha não recarrega a moldura. Relate o que viu no relatório.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "Editor: blocos de plug-in desenhados no editor com a mesma marcação da leitura"
```

---

### Task 3: Editor novo nos cartões de texto do Fluxo

**Files:**
- Modify: `fluxo-tela.js` (`editar`, ~210-240)
- Modify: `editor-nota.js` (`montar`: opção `rotulo`)
- Modify: `app.js` (`opcoesDoEditor`, `iniciarOrtografia` ~497-508, a função que liga/desliga o corretor ~480, `montarFluxos` ~818)
- Modify: `styles.css` (regras `.doc-corpo .cm-…` e `.fluxo-editor`)

**Interfaces:**
- Consumes: `KiroEditor.montar(elemento, opcoes)` → `{ dom, texto(), focar(onde), destruir(), redesenharOrtografia(), definirOrtografia(ativa), palavraEm, trocarTrecho, area() }`; `KiroEditor.carregar()`; `opcoesDoEditor()`.
- Produces: opção `montarEditor(elemento, { texto }) → editor | null` de `KiroFluxoTela.montar`; opção `rotulo` de `KiroEditor.montar`; `opcoesDoEditor({ atual, menu })`.

- [ ] **Step 1: `rotulo` no editor** — em `editor-nota.js`, `montar(elemento, { texto, …, widgets, rotulo })` e, em `contentAttributes`, `'aria-label': rotulo || t('Conteúdo da nota')`.

- [ ] **Step 2: `opcoesDoEditor` para outro editor** — em `app.js`:

```js
function opcoesDoEditor({ atual = () => editorDaNota?.editor, menu = menuDaNota } = {}) {
```

  e dentro de `aoMenu` troque `const editor = editorDaNota.editor, area = editor.area();` por `const editor = atual(), area = editor.area();`, `...menuDaNota()` por `...menu()` e a última linha por:

```js
      const itens = menu();
      if (!itens.length) return;   // sem itens (cartão do Fluxo): o menu do navegador
      abrirMenuContexto(evento, area, itens);
```

  O corpo da nota continua chamando `opcoesDoEditor()` sem argumentos (comportamento igual).

- [ ] **Step 3: O editor do cartão no app** — em `app.js`, logo depois de `montarEditorDaNota`:

```js
// Cartão de texto do Fluxo: o mesmo editor do corpo da nota (corretor, fórmulas, links), sem o
// salvar da nota nem as sugestões de [[. Sem o CodeMirror carregado, o Fluxo usa o textarea.
let editorDoCartao = null;
function montarEditorDoCartao(elemento, { texto }) {
  if (!window.CM || !window.KiroEditor) return null;
  const base = opcoesDoEditor({ atual: () => editorDoCartao, menu: () => [] });
  const editor = KiroEditor.montar(elemento, { texto, rotulo: t('Texto do cartão'), ortografia: base.ortografia, widgets: base.widgets, aoMenu: base.aoMenu });
  editorDoCartao = editor;
  const destruir = editor.destruir;
  editor.destruir = () => { if (editorDoCartao === editor) editorDoCartao = null; destruir(); };
  setTimeout(iniciarOrtografia, 0);
  return editor;
}
```

  - Em `iniciarOrtografia`, troque o ouvinte por `KiroOrtografia.aoMudar(() => { editorDaNota?.editor.redesenharOrtografia(); editorDoCartao?.redesenharOrtografia(); });`.
  - Na linha `editorDaNota?.editor.definirOrtografia(corretorLigado);` (~480), acrescente logo abaixo `editorDoCartao?.definirOrtografia(corretorLigado);`.
  - Em `montarFluxos`, nas opções de `KiroFluxoTela.montar`, acrescente `montarEditor: montarEditorDoCartao,` e, antes do `for`, `KiroEditor.carregar().catch(() => {});   // o cartão abre com o editor novo já na primeira edição`.

- [ ] **Step 4: `fluxo-tela.js` usa a opção** — substitua a função `editar` inteira por:

```js
    // Editar texto: o editor do app (opcoes.montarEditor) ou, sem ele, um <textarea> no lugar do
    // conteúdo. Ao terminar, o cartão cresce se o texto renderizado não couber (nunca encolhe sozinho).
    function editar(idNo) {
      const c = no(idNo), el = elDoCartao(idNo);
      if (!c || c.type !== 'text' || !el) return;
      terminarEdicao();
      const conteudo = el.querySelector('.fluxo-conteudo');
      let campo = document.createElement('div');
      campo.className = 'fluxo-editor';
      conteudo.replaceChildren(campo);
      const ed = opcoes.montarEditor?.(campo, { texto: c.text }) || null;
      if (!ed) {
        campo = document.createElement('textarea');
        campo.className = 'fluxo-editor';
        campo.value = c.text;
        campo.setAttribute('aria-label', t('Texto do cartão'));
        conteudo.replaceChildren(campo);
      }
      const valor = () => (ed ? ed.texto() : campo.value);
      el.classList.add('editando');
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null;
        const texto = valor();
        ed?.destruir();
        const atual = no(idNo);
        if (!gravar || !atual || texto === atual.text) return void desenhar();
        let novo = F.editarCartao(canvas, idNo, { text: texto });
        const altura = alturaDoTexto(texto, atual.width);
        if (altura > atual.height) novo = F.redimensionar(novo, idNo, atual.width, encaixarPraCima(altura));
        mudar(novo);
      };
      editor = { concluir };
      campo.addEventListener('keydown', e => {
        e.stopPropagation();   // Delete, Ctrl+Z etc. são do texto, não do fluxo
        if (e.key === 'Escape') { e.preventDefault(); concluir(true); raiz.focus({ preventScroll: true }); }
      });
      // Sair do cartão grava (também quando o salvamento automático tira o foco: destino nulo).
      campo.addEventListener('focusout', e => { if (!campo.contains(e.relatedTarget)) concluir(true); });
      if (ed) ed.focar('fim'); else campo.focus();
    }
```

- [ ] **Step 5: CSS** — em `styles.css`, troque todas as ocorrências do prefixo `.doc-corpo .cm-` por `:is(.doc-corpo, .fluxo-editor) .cm-` (são 21; confira com `grep -c "\.doc-corpo \.cm-" styles.css` antes e `0` depois; inclua as regras `.ed-plugin` da Task 2). Depois da regra `.fluxo-editor { … }` (~1293), acrescente:

```css
div.fluxo-editor { overflow:auto; }
.fluxo-editor .cm-editor { height:100%; }
```

- [ ] **Step 6: Testes** — Run: `npm test` — Expected: 0 fail (o teste de cobertura de idiomas não pede frase nova: "Texto do cartão" já existe).

- [ ] **Step 7: Verificar no navegador** — num fluxo do `dev-vault` (ex.: `Exemplo.canvas`), dois cliques num cartão de texto: aparece o editor novo (`.fluxo-editor .cm-editor`), com o corretor ligado uma palavra errada fica sublinhada sem digitar, Esc grava e redesenha o cartão, Delete/Ctrl+Z dentro do texto não apagam/desfazem no Fluxo, clicar fora grava. Relate no relatório. Restaure o `.canvas` se o teste o alterou (`git status` limpo no `dev-vault` não vale: ele é ignorado — guarde uma cópia antes e devolva depois).

- [ ] **Step 8: Commit**

```bash
git add fluxo-tela.js editor-nota.js app.js styles.css
git commit -m "Fluxo: cartões de texto com o editor novo (corretor, fórmulas e links)"
```

---

### Task 4: Remover o editor antigo de blocos

**Files:**
- Modify: `app.js`, `styles.css`, `idiomas/en.js` (se frases ficarem sem uso)

**Interfaces:**
- Consumes: nada novo. Desde a etapa 1, o corpo da nota é o CodeMirror; `bindCorpo` não é chamada em lugar nenhum.
- Produces: nada (só remoção). Continuam: `renderizarMarkdown`, `buscarEtiqueta`, `seguirWikilink`, `abrirNoFim`, `colarImagens`, `abrirImagemInteira`/`fecharImagemInteira`, `copiarBloco`, `atualizarSugestoes`/`teclaNaSugestao`/`fecharSugestoes`, `podeCorrigir`/`esperarCorretor` (usados pelo menu global de outros campos), o `textarea` `doc-corpo-simples` de reserva.

- [ ] **Step 1: Confirmar o que está morto** — rode e guarde a saída no relatório:

```bash
grep -n "bindCorpo\|retomarBloco\|abrirNoPonto\|cursorNoBloco\|deslocarBlocos\|redimensionarImagem\|gravarLarguraDaImagem\|marcarTarefa(\|ajustarAltura\|montarCampo\|fecharBloco\|abrirBloco\|teclaNoBloco\|blocoAberto\|imagensNaFonte" app.js
```

- [ ] **Step 2: Remover** de `app.js`: `bindCorpo`, `retomarBloco`, `abrirNoPonto`, `cursorNoBloco`, `deslocarBlocos`, `redimensionarImagem`, `gravarLarguraDaImagem`, `marcarTarefa` (só a do corpo; `marcarTarefaDaNota` fica), `ajustarAltura`, `montarCampo`, `fecharBloco`, `abrirBloco`, `teclaNoBloco`, e `imagensNaFonte` se só elas a usarem. Nos que ficam:
  - `let … blocoAberto=null;` (~1437) e `blocoAberto=null;` (~1820): tirar `blocoAberto`.
  - `colarImagens` (~2894): `const destino = campo.inserir && editorDaNota?.editor.area() === campo ? campo : abrirNoFim();` e apagar a linha `fecharBloco();` e o comentário "Fecha o bloco…".
  - linhas ~2902/2931/3001 com `fecharBloco();`: apagar (verifique em qual função cada uma está; se a função inteira saiu, nada a fazer).
  - `wikilinkNoCursor(editorDaNota?.editor.area() ?? blocoAberto?.campo)` (~3149) → `wikilinkNoCursor(editorDaNota?.editor.area())`.
  - Comentários que citam o editor de blocos ("Edição no lugar", "teclaNoBloco a consulta primeiro"): reescrever para o editor atual ou apagar.
  - Repita o `grep` do Step 1: só podem sobrar ocorrências em comentários reescritos — o ideal é nenhuma.

- [ ] **Step 3: CSS** — em `styles.css`, apagar as regras que só servem a `.bloco-editor` / `.bloco-codigo` (linhas ~172, 223-225, 474, 483, 486, 490: tire só o seletor `.bloco-editor…` das listas que têm outros seletores; apague a regra quando ele for o único).

- [ ] **Step 4: Frases** — para cada `t('…')` que existia só no código removido, confira com `grep -n "<frase>" *.js` e tire a frase de `idiomas/en.js` se não aparece em mais nenhum lugar. Run: `node --test tests/idiomas-cobertura.test.cjs` — Expected: PASS.

- [ ] **Step 5: Testes** — Run: `npm test` — Expected: 0 fail.

- [ ] **Step 6: Verificar no navegador** — abrir uma nota, digitar, colar uma imagem (ou soltar), salvar (Ctrl+S), `[[` com sugestões, botão direito com menu: tudo como antes; console sem erros. Relate.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css idiomas/en.js
git commit -m "Editor: remove o editor antigo de blocos"
```

---

### Task 5: Verificação no app desktop e instalador (quem coordena)

**Files:**
- Modify: `package.json` (`"version": "0.19.0"`)

- [ ] **Step 1: Medir** — scripts de medição da etapa 2 (scratchpad): nota longa quente ≤ ~17 ms, < 16 ms por tecla, Hoje/Notas sem piora; cartão do Fluxo < 50 ms.
- [ ] **Step 2: e2e Electron** (`--dev-vault`, perfil separado):
  - nota com ```` ```kiro:kanban-tasks ```` (moldura) e ```` ```kiro:word-count ```` (HTML; ativar no perfil de teste e restaurar `dev-vault/.kiro/plugins.json` depois): desenhados fora do cursor; fonte com o cursor dentro; digitar fora não recria a moldura; texto abaixo do bloco não sobreposto depois do desenho; link `<a href="https://…">` no HTML do plug-in não navega a janela;
  - cartão do Fluxo: editor novo, palavra errada sublinhada sem digitar, botão direito → sugestão troca a palavra, Esc grava, cartão cresce, Ctrl+Z desfaz no texto;
  - Ctrl+Enter marca a tarefa da linha do cursor e Ctrl+Z desfaz; Ctrl+clique no `[[link]]` da linha do cursor abre a nota;
  - nada de `.bloco-editor` no DOM; `npm test` 0 fail.
- [ ] **Step 3: Revisão final do branch (etapa 3)** no modelo mais capaz; uma rodada de correções; re-revisão.
- [ ] **Step 4: Instalador** — `"version": "0.19.0"` em `package.json`; `npm run build:win`; instalar num perfil limpo e conferir: abre, edita, salva, corretor sublinha. Commit "Versão 0.19.0". Entregar ao usuário para teste; merge só com a aprovação dele.
