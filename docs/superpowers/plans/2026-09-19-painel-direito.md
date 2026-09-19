# Painel da direita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel à direita das colunas (tela de Pastas) com Links de volta, Links de saída, Sumário e Etiquetas da nota em edição.

**Architecture:** As regras de conteúdo são funções puras no `domain.js` (testadas no Node); `app.js` desenha o painel dentro de `renderCofre`, liga os cliques e guarda a preferência no `localStorage`.

**Tech Stack:** JavaScript puro (sem build), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-19-painel-direito-design.md`

## Global Constraints

- Sem framework, sem TypeScript, sem build, sem dependência nova.
- Código, comentários, interface e commits em português do Brasil.
- Não usar `confirm()`/`alert()` nativos em código novo.
- Testes só em pastas temporárias; nunca tocar `C:\Projetos\Meu segundo cerebro\vault` nem `C:\Users\bielg\Documents\KUROI\vault`. Verificação no navegador só com o cofre de exemplo (`dev-vault/`, servidor `kiro-dev`, porta 4180); restaurar o que mudar nele.
- Não versionar `kuroi-2026-09-12.json`. Não fazer push.
- Commits terminam com uma linha em branco e `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Suíte: `node --test` na raiz (hoje 183 testes: 182 passam, 1 pulado).
- Nunca descartar uma edição não salva (`editing` com `editorDirty`).

---

### Task 1: Funções puras e atalho

**Files:**
- Modify: `domain.js` (antes de `const api = {`, e acrescentar os nomes ao objeto `api`; `ATALHOS_EDITAVEIS` ganha uma linha)
- Modify: `tests/atalhos.test.cjs` (o padrão passa a incluir `painelDireito`)
- Create: `tests/painel.test.cjs`

**Interfaces (Produces, em `Kiro.*` no navegador e `require('../domain.js')` no Node):**
- `mencoesNaoVinculadas(notas, nota) → [{ nota, trecho }]`
- `vincularMencao(corpo, titulo) → string`
- `sumario(corpo) → [{ nivel, texto, indice }]`
- `arvoreDeEtiquetas(notas) → [{ nome, caminho, total, filhos }]`
- `ATALHOS_EDITAVEIS` com `['painelDireito', 'Painel da direita', 'Links, sumário e etiquetas da nota, na tela de Pastas.', 'Ctrl+Shift+L']` no fim.

- [ ] **Step 1: Write the failing test** — `tests/painel.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../domain.js');

const n = (id, title, body, tags = []) => ({ id, title, body, tags, links: [], folderId: '' });

test('menções não vinculadas: sem acento e maiúsculas, palavra inteira, fora de links', () => {
  const alvo = n('a', 'Fotossíntese', '');
  const notas = [
    alvo,
    n('b', 'B', 'A fotossintese acontece nas folhas.'),
    n('c', 'C', 'Veja [[Fotossíntese]] depois.'),
    n('d', 'D', 'Fotossínteses são várias.'),
    n('e', 'E', 'Sobre FOTOSSÍNTESE:\nlinha 2'),
  ];
  const achadas = K.mencoesNaoVinculadas(notas, alvo);
  assert.deepEqual(achadas.map(m => [m.nota.id, m.trecho]), [['b', 'A fotossintese acontece nas folhas.'], ['e', 'Sobre FOTOSSÍNTESE:']]);
  assert.deepEqual(K.mencoesNaoVinculadas([n('x', 'IA', ''), n('y', 'Y', 'IA em tudo')], n('x', 'IA', '')), []);   // título curto
});

test('vincular a menção troca só a primeira ocorrência solta', () => {
  assert.equal(K.vincularMencao('A fotossintese acontece', 'Fotossíntese'), 'A [[Fotossíntese|fotossintese]] acontece');
  assert.equal(K.vincularMencao('Veja Fotossíntese aqui', 'Fotossíntese'), 'Veja [[Fotossíntese]] aqui');
  assert.equal(K.vincularMencao('Veja [[Fotossíntese]] e Fotossíntese', 'Fotossíntese'), 'Veja [[Fotossíntese]] e [[Fotossíntese]]');
  assert.equal(K.vincularMencao('Nada aqui', 'Fotossíntese'), 'Nada aqui');
});

test('sumário: títulos fora de código, com nível e ordem', () => {
  const corpo = '# A\ntexto\n## B\n```\n# não\n```\n### C ##\n#tag\n# C#\n~~~\n## também não\n~~~';
  assert.deepEqual(K.sumario(corpo), [
    { nivel: 1, texto: 'A', indice: 0 },
    { nivel: 2, texto: 'B', indice: 1 },
    { nivel: 3, texto: 'C', indice: 2 },
    { nivel: 1, texto: 'C#', indice: 3 },
  ]);
  assert.deepEqual(K.sumario(''), []);
});

test('árvore de etiquetas: aninhadas por barra, cada nota conta uma vez', () => {
  const notas = [n('1', 'Um', '', ['estudo/python']), n('2', 'Dois', '', ['estudo']), n('3', 'Três', 'Veja #estudo/js e #ideia')];
  assert.deepEqual(K.arvoreDeEtiquetas(notas), [
    { nome: 'estudo', caminho: 'estudo', total: 3, filhos: [
      { nome: 'js', caminho: 'estudo/js', total: 1, filhos: [] },
      { nome: 'python', caminho: 'estudo/python', total: 1, filhos: [] },
    ] },
    { nome: 'ideia', caminho: 'ideia', total: 1, filhos: [] },
  ]);
});
```

Em `tests/atalhos.test.cjs`, no teste "padrões incluem o atalho da barra lateral", o `deepEqual` passa a esperar também `painelDireito: 'Ctrl+Shift+L'`.

- [ ] **Step 2: Run** `node --test tests/painel.test.cjs tests/atalhos.test.cjs` → FAIL.

- [ ] **Step 3: Implement** em `domain.js`, antes de `const api = {`:

```js
  // ---- Painel da direita: menções não vinculadas, sumário e árvore de etiquetas ----
  // Compara sem maiúsculas nem acentos, caractere a caractere, mantendo o tamanho do
  // texto: os índices achados valem no texto original.
  const umPraUm = c => { const s = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return s.length === c.length ? s : c; };
  const semAcento = texto => [...texto].map(umPraUm).join('');
  const LETRA = /[\p{L}\p{N}_]/u;
  // Posições onde o título aparece como palavra inteira fora de [[links]].
  function ocorrenciasSoltas(corpo, titulo) {
    const alvo = semAcento(String(titulo || '').trim());
    if (alvo.length < 3) return [];
    const texto = semAcento(String(corpo || '').replace(/\[\[[^\]\n]*\]\]/g, m => ' '.repeat(m.length)));
    const achadas = [];
    for (let i = texto.indexOf(alvo); i !== -1; i = texto.indexOf(alvo, i + 1)) {
      const antes = texto[i - 1], depois = texto[i + alvo.length];
      if ((antes && LETRA.test(antes)) || (depois && LETRA.test(depois))) continue;
      achadas.push(i);
    }
    return achadas;
  }
  function mencoesNaoVinculadas(notas, nota) {
    return notas.filter(n => n.id !== nota.id).flatMap(n => {
      const corpo = n.body || '';
      const [i] = ocorrenciasSoltas(corpo, nota.title);
      if (i === undefined) return [];
      const ini = corpo.lastIndexOf('\n', i) + 1, fim = corpo.indexOf('\n', i);
      return [{ nota: n, trecho: corpo.slice(ini, fim === -1 ? undefined : fim).trim() }];
    });
  }
  function vincularMencao(corpo, titulo) {
    const t = String(titulo || '').trim();
    const [i] = ocorrenciasSoltas(corpo, t);
    if (i === undefined) return corpo;
    const original = corpo.slice(i, i + t.length);
    return corpo.slice(0, i) + (original === t ? `[[${t}]]` : `[[${t}|${original}]]`) + corpo.slice(i + t.length);
  }
  // Títulos Markdown (# a ######) fora de blocos de código cercados.
  function sumario(corpo) {
    const itens = [];
    let cerca = null;
    for (const linha of String(corpo || '').split('\n')) {
      const c = /^\s{0,3}(`{3,}|~{3,})/.exec(linha);
      if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = null; continue; }
      if (cerca) continue;
      const h = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(linha);
      if (h && h[2].trim()) itens.push({ nivel: h[1].length, texto: h[2].trim(), indice: itens.length });
    }
    return itens;
  }
  // Etiquetas aninhadas por "/": cada nó conta as notas dele e das filhas, sem repetir nota.
  function arvoreDeEtiquetas(notas) {
    const raiz = new Map();
    for (const nota of notas) for (const tag of tags(nota)) {
      let nivel = raiz, caminho = '';
      for (const parte of String(tag).split('/').filter(Boolean)) {
        caminho = caminho ? `${caminho}/${parte}` : parte;
        if (!nivel.has(parte)) nivel.set(parte, { nome: parte, caminho, notas: new Set(), filhos: new Map() });
        const no = nivel.get(parte);
        no.notas.add(nota.id);
        nivel = no.filhos;
      }
    }
    const saida = mapa => [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map(no => ({ nome: no.nome, caminho: no.caminho, total: no.notas.size, filhos: saida(no.filhos) }));
    return saida(raiz);
  }
```

Acrescente `mencoesNaoVinculadas, vincularMencao, sumario, arvoreDeEtiquetas` ao objeto `api`. Em `ATALHOS_EDITAVEIS`, acrescente no fim a linha `['painelDireito', 'Painel da direita', 'Links, sumário e etiquetas da nota, na tela de Pastas.', 'Ctrl+Shift+L']`. Confira que `tags` (a função do `domain.js` que junta `note.tags` e `#etiquetas` do corpo) já está definida antes deste bloco.

- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Commit** — `Painel: menções, sumário e etiquetas no domínio`.

---

### Task 2: O painel na tela de Pastas

**Files:**
- Modify: `app.js` (`renderCofre` e o bloco `studies` de `bindView`; barra de abas; `ACOES_DOS_ATALHOS`; ícones em `TRACOS`)
- Modify: `styles.css` (fim do arquivo)
- Modify: `docs/KIRO-resumo-para-IA.md` (3–4 linhas sobre o painel)

**Interfaces:**
- Consumes (Task 1): `Kiro.mencoesNaoVinculadas`, `Kiro.vincularMencao`, `Kiro.sumario`, `Kiro.arvoreDeEtiquetas`, atalho `painelDireito`.
- Existentes a reusar: `Kiro.mentions(notas, nota)`, `Kiro.wikiLinks(corpo)`, `Kiro.findLinkedNote(notas, alvo)`, `textoPlano(md)`, `seguirWikilink`/`abrirNota(nota, opcoes)`/`abrirPorId`, `notaVazia({ title })`, `buscarEtiqueta(texto)`, `save(origem)`, `status(msg, erro)`, `lerPreferencia`, `icone(nome)`, o padrão da divisória da árvore (`ligarDivisorDaArvore`, `.cofre-divisor`).

**Comportamento (spec: `docs/superpowers/specs/2026-09-19-painel-direito-design.md`):**
- Estado: `let painelDireito = { aberto: false, aba: 'volta', largura: 300 }` lido de `localStorage['kiro.painelDireito']` (JSON em `try`, validado: `aba ∈ {volta, saida, sumario, etiquetas}`, `largura` 220–520). Gravar a cada mudança.
- `renderCofre`: com o painel aberto, depois de `colunasMarkup()` vem `<aside class="painel-direito" style="width:${largura}px" aria-label="Painel da direita">` com: uma divisória na borda esquerda (`role="separator"`, arrastar, setas, dois cliques → 300); um topo com 4 botões-ícone (`aria-pressed` no ativo, `title`/`aria-label`: "Links de volta", "Links de saída", "Sumário", "Etiquetas"); e o conteúdo da aba.
- Botão ◨ (`data-painel-direito`, `aria-pressed`, título "Painel da direita (Ctrl+Shift+L)" com a tecla vinda de `teclaDe('painelDireito')`) no fim da barra de abas da **última** coluna, depois do ⌄. `ACOES_DOS_ATALHOS.painelDireito` alterna o painel (só age na tela de Pastas).
- Conteúdo, sempre sobre `editing` (sem nota: vazio curto "Abra uma nota para ver …"):
  - **volta**: campo de filtro (`<input type="search" placeholder="Filtrar">`); "Menções vinculadas (n)" com `Kiro.mentions(state.notes, editing)` e o trecho (a primeira linha do corpo onde há um link que resolve para `editing`, em `textoPlano`, até 160 caracteres); "Menções não vinculadas (n)" com `Kiro.mencoesNaoVinculadas(state.notes, editing)` e um botão "Vincular" por item. Tudo escapado com `escapeHtml`. Clicar no título de um item abre a nota (`abrirPorId`). Vincular: se a outra nota for `editing` com `editorDirty`, `status('Salve a nota aberta antes de vincular.', true)`; senão troca o `body` dela por `Kiro.vincularMencao(...)`, `updatedAt: Date.now()`, `await save()` e redesenha. O filtro é só visual (esconde itens cujo título não contém o texto, sem redesenhar a nota).
  - **saida**: `Kiro.wikiLinks(editing.body)` sem repetir o alvo (comparar com `Kiro.pathKey`), cada um com `Kiro.findLinkedNote`; inexistente com classe `ausente` e o texto "não existe ainda". Clicar: existente → `abrirPorId(id)`; inexistente → `abrirNota(notaVazia({ title: alvo }))`.
  - **sumario**: `Kiro.sumario(editing.body)`, recuo por `nivel`. Clicar: o `indice`-ésimo elemento `h1,h2,h3,h4,h5,h6` dentro de `#doc-corpo` → `scrollIntoView({ block: 'start', behavior: 'smooth' })` (se não existir, não faz nada).
  - **etiquetas**: `Kiro.arvoreDeEtiquetas(state.notes)` em lista aninhada (`<details open>` por nó com filhos), com o total à direita. Clicar no nome → `buscarEtiqueta('#' + caminho)` (confira o formato que `buscarEtiqueta` espera, pelo uso em `bindLeitura`).
- Janela < 900 px: `.painel-direito` e o botão ◨ escondidos por CSS.
- Estilo: fundo `var(--sidebar-bg)`, cartões/linhas discretos como os da árvore, cabeçalhos de seção em caixa-alta pequena como `.nav-grupo`, itens com hover, foco visível; nada de cor fixa nova.
- Ícones novos em `TRACOS` (24×24, traço como os outros): `link-volta`, `link-saida`, `sumario`, `etiqueta` (se `etiqueta`/`link` já existirem, reuse), `painel-direito`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `node --test` → PASS.
- [ ] **Step 3: Verificar no navegador** (`kiro-dev`, largura ≥ 1280 com `resize_window`, reset no fim): abrir/fechar pelo ◨ e por Ctrl+Shift+L; cada aba com conteúdo certo para "Plano de estudos"; filtro; Vincular numa nota de teste (crie duas notas de teste no `dev-vault` e apague no fim) confirmando o corpo salvo; link inexistente abre nota nova; sumário rola; etiqueta abre a busca; largura ajusta e é lembrada; recarregar mantém aberto/aba/largura; < 900 px some. Screenshot.
- [ ] **Step 4: Commit** — `Painel: links, sumário e etiquetas à direita da tela de Pastas`.
