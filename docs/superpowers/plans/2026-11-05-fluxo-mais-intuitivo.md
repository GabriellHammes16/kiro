# Fluxo mais intuitivo: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** copiar e colar balões pelo teclado, criar o próximo balão sem o mouse, colocar PDF no Fluxo para ler ali ou ampliar, cartões que crescem com o texto e guias de alinhamento.

**Architecture:** as contas ficam em `fluxo.js` (modelo puro, testado no Node). A tela (`fluxo-tela.js`) só traduz teclado e ponteiro nessas operações. O app (`app.js`) entrega o que depende dele por `opcoes`: atalhos e janela do PDF.

**Tech Stack:** JavaScript sem build, `node:test`, PDF.js já embarcado (`pdf-nota.js`).

**Spec:** a descrição aprovada na conversa, reproduzida abaixo.

## O que foi aprovado

- **Copiar e colar:** `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+D` e `Ctrl+A` funcionam com um ou vários cartões. As setas entre os copiados vão junto. O colado aparece perto do mouse e também pode ir para outro fluxo. As setas do teclado movem a seleção.
- **Criar balões:** `Ctrl+Enter` cria o próximo e `Ctrl+Shift+Enter` cria um ligado ao atual. Os dois podem ser trocados nas Configurações. `Enter` continua quebrando linha.
- **PDF:** entra colando, arrastando do computador ou pelo botão da barra. O cartão mostra as páginas, com rolagem ali mesmo. **Ampliar** abre grande sobre o Kiro e `Esc` fecha. "Abrir no leitor do sistema" fica no botão direito.
- **Intuitivo:** dica com o Fluxo vazio, cartão que cresce com o texto até ser redimensionado à mão, guias de alinhamento ao arrastar.
- **Fora desta rodada:** busca no Fluxo, minimapa, exportar como imagem, citar trecho do PDF.

## Global Constraints

- Sem dependência nova. Sem etapa de build.
- O arquivo continua sendo JSON Canvas válido: campo novo só com nome próprio do Kiro, e campos desconhecidos passam intactos.
- CSS usa as variáveis do tema, nunca cor fixa (`docs/temas.md`, "Regras para componentes"). Cantos das skins Sharp e Terminal já são tratados por regra global.
- Toda frase nova passa por `t()` e ganha tradução em `idiomas/en.js`; confira com `node --test tests/idiomas-cobertura.test.cjs`.
- Mudança de tela entra no histórico por `mudar()`: um gesto do usuário é um passo de desfazer.
- Preserve o fim de linha de cada arquivo (`git diff --stat` não pode mostrar o arquivo inteiro como alterado).
- Commits só no branch `feat/protecao-do-texto-e-navegacao`, adicionando os arquivos por caminho. Sem push. Termine a mensagem com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Copiar um grupo: os cartões inteiramente dentro dele vão junto, e colar mantém o grupo atrás deles.
2. `Ctrl+V` repetido sem mexer o mouse: cada colagem sai deslocada, não exatamente em cima da anterior.
3. Copiar cartões e depois copiar texto em outro programa: `Ctrl+V` cola o texto de fora, não os cartões antigos.
4. PDF apagado ou corrompido: o cartão mostra o nome e o estado quebrado do `.md-pdf`, sem erro e sem travar os outros cartões.
5. Salvar, mover ou editar outro cartão com um PDF aberto: o PDF não pisca nem volta para a página 1.

---

### Task 1: Operações do modelo

**Files:**
- Modify: `fluxo.js`
- Test: `tests/fluxo.test.cjs`

**Interfaces:**
- Produces, todas exportadas em `api`:
  - `ehPdf(f: string) -> boolean`
  - `copiarCartoes(c, ids) -> { nodes, edges }`: cópia profunda (`structuredClone`) dos cartões e só das setas com as duas pontas entre eles.
  - `colarCartoes(c, trecho, x, y) -> { canvas, ids }`: ids novos, o canto superior esquerdo do conjunto vai para `(x, y)`, setas religadas, grupos no início de `nodes` e os demais no fim.
  - `textoDoTrecho(trecho) -> string`: textos, caminhos, URLs e rótulos unidos por `\n\n`. Sem nenhum, `Cartões do Kiro`.
  - `lugarLivre(c, base) -> { x, y }`: desce `base.y` até o retângulo não sobrepor nenhum cartão que não seja grupo, com `y` arredondado para cima na grade.
  - `guiasDeAlinhamento(caixa, outros, tolerancia) -> { dx, dy, linhas }`: `linhas` é uma lista de `{ eixo: 'x' | 'y', pos, de, ate }`.

- [ ] **Step 1: Escreva os testes que falham**

```js
test('ehPdf reconhece a extensão sem diferenciar maiúsculas', () => {
  assert.equal(F.ehPdf('a/b.PDF'), true);
  assert.equal(F.ehPdf('a/b.md'), false);
  assert.equal(F.ehPdf(undefined), false);
});

test('tamanhoPadrao de PDF é 480 por 640', () => {
  assert.deepEqual(F.tamanhoPadrao({ type: 'file', file: 'a.pdf' }), { width: 480, height: 640 });
});

test('copiarCartoes leva só as setas entre os copiados', () => {
  const c = canvas([cartao('a'), cartao('b'), cartao('c')], [
    { id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'b', toNode: 'c' },
  ]);
  const t = F.copiarCartoes(c, ['a', 'b']);
  assert.deepEqual(t.nodes.map(n => n.id), ['a', 'b']);
  assert.deepEqual(t.edges.map(e => e.id), ['e1']);
});

test('colarCartoes cria ids novos, religa as setas e põe o conjunto no ponto', () => {
  const c = canvas([cartao('a', { x: 100, y: 100 }), cartao('b', { x: 400, y: 200 })], [{ id: 'e1', fromNode: 'a', toNode: 'b' }]);
  const r = F.colarCartoes(c, F.copiarCartoes(c, ['a', 'b']), 1000, 2000);
  assert.equal(r.ids.length, 2);
  assert.equal(r.canvas.nodes.length, 4);
  const [n1, n2] = r.ids.map(id => r.canvas.nodes.find(n => n.id === id));
  assert.deepEqual([n1.x, n1.y, n2.x, n2.y], [1000, 2000, 1300, 2100]);
  const seta = r.canvas.edges.at(-1);
  assert.deepEqual([seta.fromNode, seta.toNode], r.ids);
  assert.notEqual(seta.id, 'e1');
});

test('colarCartoes mantém o grupo atrás dos cartões', () => {
  const grupo = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500 };
  const c = canvas([cartao('x'), grupo, cartao('a', { x: 10, y: 10 })]);
  const r = F.colarCartoes(c, F.copiarCartoes(c, ['g', 'a']), 0, 0);
  assert.equal(r.canvas.nodes[0].type, 'group');
  assert.equal(r.canvas.nodes.at(-1).type, 'text');
});

test('colarCartoes não altera o trecho, que pode ser colado de novo', () => {
  const c = canvas([cartao('a')]);
  const t = F.copiarCartoes(c, ['a']);
  const r1 = F.colarCartoes(c, t, 40, 40);
  const r2 = F.colarCartoes(r1.canvas, t, 80, 80);
  assert.equal(new Set(r2.canvas.nodes.map(n => n.id)).size, 3);
  assert.equal(t.nodes[0].id, 'a');
});

test('textoDoTrecho junta os conteúdos e nunca sai vazio', () => {
  assert.equal(F.textoDoTrecho({ nodes: [cartao('a', { text: 'um' }), { id: 'l', type: 'link', url: 'https://x.y' }] }), 'um\n\nhttps://x.y');
  assert.equal(F.textoDoTrecho({ nodes: [{ id: 'g', type: 'group' }] }), 'Cartões do Kiro');
});

test('lugarLivre desce até sair de cima de outro cartão e ignora grupos', () => {
  const c = canvas([cartao('a', { x: 0, y: 100, width: 200, height: 100 }), { id: 'g', type: 'group', x: 0, y: 0, width: 900, height: 900 }]);
  assert.deepEqual(F.lugarLivre(c, { x: 0, y: 120, width: 200, height: 60 }), { x: 0, y: 220 });
  assert.deepEqual(F.lugarLivre(c, { x: 500, y: 120, width: 200, height: 60 }), { x: 500, y: 120 });
});

test('guiasDeAlinhamento encaixa bordas e centros dentro da tolerância', () => {
  const outro = { x: 100, y: 500, width: 200, height: 100 };
  const r = F.guiasDeAlinhamento({ x: 103, y: 0, width: 200, height: 100 }, [outro], 6);
  assert.equal(r.dx, -3);
  assert.equal(r.dy, 0);
  assert.deepEqual(r.linhas.filter(l => l.eixo === 'x').map(l => l.pos).sort((a, b) => a - b), [100, 200, 300]);
  assert.deepEqual(F.guiasDeAlinhamento({ x: 120, y: 0, width: 200, height: 100 }, [outro], 6), { dx: 0, dy: 0, linhas: [] });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/fluxo.test.cjs`
Expected: FAIL, com `F.ehPdf is not a function`.

- [ ] **Step 3: Implemente em `fluxo.js`**

`tamanhoPadrao` testa `ehPdf` antes do caso de arquivo comum. `colarCartoes` usa a mesma reserva de ids de `duplicarCartoes`. `guiasDeAlinhamento` compara esquerda, centro e direita em x, e topo, centro e base em y; escolhe o menor deslocamento dentro da tolerância em cada eixo; depois gera uma linha para cada coincidência exata após o deslocamento, com `de` e `ate` cobrindo a caixa e o outro cartão no eixo oposto.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/fluxo.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs
git commit -m "feat(fluxo): operacoes de copiar, colar, lugar livre e guias"
```

### Task 2: Atalhos editáveis de criar balão

**Files:**
- Modify: `domain.js` (`ATALHOS_EDITAVEIS`), `app.js` (dispatcher de teclado, `montarFluxos`), `idiomas/en.js`
- Test: `tests/atalhos.test.cjs`

**Interfaces:**
- Produces: ids `fluxoProximo` (padrão `Ctrl+Enter`) e `fluxoLigado` (padrão `Ctrl+Shift+Enter`), e `opcoes.atalho(id) -> string` entregue à tela.

- [ ] **Step 1: Escreva o teste que falha**

```js
test('os atalhos de criar balão têm padrão e podem ser trocados', () => {
  assert.equal(PADRAO.fluxoProximo, 'Ctrl+Enter');
  assert.equal(PADRAO.fluxoLigado, 'Ctrl+Shift+Enter');
  assert.equal(atalhosValidos({ fluxoProximo: 'Alt+N' }).fluxoProximo, 'Alt+N');
  assert.equal(combinacaoDoEvento({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Enter');
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/atalhos.test.cjs`
Expected: FAIL em `PADRAO.fluxoProximo`.

- [ ] **Step 3: Implemente**

Adicione as duas entradas a `ATALHOS_EDITAVEIS`, com títulos `Fluxo: criar o próximo balão` e `Fluxo: criar balão ligado ao atual`. No dispatcher de teclado de `app.js`, ignore os ids que começam com `fluxo` ao procurar `acao`: quem os trata é a tela do Fluxo, e o `Ctrl+Enter` de marcar tarefa nas notas continua igual. Em `montarFluxos`, entregue `atalho: id => atalhos[id]`.

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/atalhos.test.cjs tests/acoes-rapidas.test.cjs tests/idiomas-cobertura.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add domain.js app.js idiomas/en.js tests/atalhos.test.cjs
git commit -m "feat(atalhos): criar balao no fluxo com atalhos editaveis"
```

### Task 3: Copiar, colar e mover pelo teclado

**Files:**
- Modify: `fluxo-tela.js`, `idiomas/en.js`
- Test: `tests/fluxo-tela-fonte.test.cjs` (criar)

**Interfaces:**
- Consumes: `F.copiarCartoes`, `F.colarCartoes`, `F.textoDoTrecho`.

Decisões de comportamento:
- Variável de módulo `areaDoFluxo = { trecho, texto }`, fora de `montar`, para colar em outro fluxo. Ela só vale se o `text/plain` da área de transferência for igual a `texto`. Vale até o Kiro fechar.
- Eventos `copy` e `cut` em `raiz`, com a mesma guarda do `paste` já existente (`editor` ou `e.target !== raiz` saem sem agir). Sem seleção, saem sem `preventDefault`. Com seleção, gravam `text/plain` com `textoDoTrecho`. Os ids passam por `comConteudo`.
- `Ctrl+X` remove em um passo de desfazer, com `removerCartoes`.
- `paste`: antes do tratamento atual, se o `text/plain` for igual a `areaDoFluxo.texto`, cola o trecho. A posição é o mouse (guardado em `pointermove` de `raiz`) ou o centro da vista, com o canto do conjunto ajustado para o centro ficar nesse ponto e com `encaixar`. Se o ponto for igual ao da colagem anterior, soma `F.GRADE * 2` em x e y a cada repetição. Os colados ficam selecionados.
- O item **Colar** do menu do fundo usa a mesma função, no ponto do clique.
- Teclas em `raiz` com `e.target === raiz`: `Ctrl+A` seleciona tudo, `Ctrl+D` duplica com `comConteudo`, e as setas movem a seleção em `F.GRADE` (com `Shift`, `F.GRADE * 5`). Sem seleção, as setas não fazem nada e não chamam `preventDefault`.
- Setas seguidas com menos de 500 ms entre si são um só passo de desfazer.
- `menuDoCartao` ganha **Copiar** e **Recortar**, antes de **Duplicar**, usando `document.execCommand('copy')` e `document.execCommand('cut')` com `raiz` em foco. O **Duplicar** do menu passa a usar a mesma função do `Ctrl+D`.

- [ ] **Step 1: Escreva o teste que falha**

A tela não roda no Node, então este teste garante as guardas no código. O comportamento é conferido ao vivo na Task 7.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonte = fs.readFileSync(path.join(__dirname, '../fluxo-tela.js'), 'utf8');

test('copiar e recortar respeitam o texto em edição', () => {
  for (const evento of ['copy', 'cut']) {
    const i = fonte.indexOf(`raiz.addEventListener('${evento}'`);
    assert.ok(i > 0, evento);
    assert.match(fonte.slice(i, i + 160), /editor \|\| e\.target !== raiz/);
  }
});

test('a área do fluxo só vale quando o texto copiado ainda é o mesmo', () => {
  assert.match(fonte, /areaDoFluxo\?\.texto === /);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs`
Expected: FAIL em `copy`.

- [ ] **Step 3: Implemente em `fluxo-tela.js`, conforme as decisões acima**

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs tests/fluxo.test.cjs tests/idiomas-cobertura.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add fluxo-tela.js idiomas/en.js tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): copiar, colar, duplicar e mover pelo teclado"
```

### Task 4: Criar balões pelo teclado e dica do Fluxo vazio

**Files:**
- Modify: `fluxo-tela.js`, `styles.css`, `idiomas/en.js`
- Test: `tests/fluxo-tela-fonte.test.cjs`

**Interfaces:**
- Consumes: `opcoes.atalho(id)`, `F.lugarLivre`, `F.ligar`.
- Produces: `criarVizinho(idBase, ligado: boolean)` dentro de `montar`.

Decisões de comportamento:
- `criarVizinho` sem base usa `criarCartaoNoCentro`.
- Próximo: a posição é `lugarLivre` a partir de `{ x: base.x, y: base.y + base.height + F.GRADE, width: base.width, height: 60 }`, com a largura da base se ela for texto e 260 nos outros tipos.
- Ligado: a posição parte de `{ x: base.x + base.width + 80, y: base.y, width: 260, height: 60 }`, com seta `right` para `left`. Cartão e seta são um só passo de desfazer, como em `GESTOS.ligar`.
- O cartão novo já abre em edição.
- A base é o cartão em edição ou o único selecionado. Com vários ou nenhum selecionado, não há base.
- A comparação é sempre `Kiro.combinacaoDoEvento(e) === opcoes.atalho('fluxoProximo')`, por meio de `root.Kiro`.
- Durante a edição, um segundo ouvinte `aoCriarVizinho` escuta `keydown` do campo em captura (`true`), senão o `Ctrl+Enter` do CodeMirror marca tarefa antes. Ao bater o atalho: `preventDefault`, `stopPropagation`, `concluir(true)` e `criarVizinho`. O ouvinte existente não muda.
- `Enter` no cartão selecionado continua abrindo a edição, e dentro do campo continua quebrando linha.
- Dica: `<div class="fluxo-dica">` em `raiz`, ligada em `desenhar()` por `hidden = canvas.nodes.length > 0`. Texto: `Dois cliques para criar um cartão` e, em outra linha, `Cole ou arraste um PDF ou uma imagem para cá`. CSS: centralizada, `pointer-events:none`, `color:var(--muted)`.

- [ ] **Step 1: Escreva o teste que falha**

```js
test('o atalho de criar balão é lido antes do editor, em captura', () => {
  assert.ok(fonte.includes("opcoes.atalho?.('fluxoProximo')"));
  assert.match(fonte, /campo\.addEventListener\('keydown', aoCriarVizinho, true\)/);
});

test('Enter sozinho não cria balão', () => {
  assert.doesNotMatch(fonte, /e\.key === 'Enter'[^\n]*criarVizinho/);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs`
Expected: FAIL no primeiro teste novo.

- [ ] **Step 3: Implemente conforme as decisões acima**

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs tests/idiomas-cobertura.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add fluxo-tela.js styles.css idiomas/en.js tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): criar baloes pelo teclado e dica do fluxo vazio"
```

### Task 5: Cartão que cresce com o texto e guias de alinhamento

**Files:**
- Modify: `fluxo-tela.js`, `styles.css`
- Test: `tests/fluxo-tela-fonte.test.cjs`

**Interfaces:**
- Consumes: `F.guiasDeAlinhamento`.
- Produces: campo `kiroAlturaFixa: true` no cartão de texto do JSON Canvas. O Obsidian ignora esse campo.

Decisões de comportamento:
- `GESTOS.redimensionar.soltar`: se a altura de um cartão de texto mudou, grave `kiroAlturaFixa: true` com `F.editarCartao`, no mesmo passo de desfazer.
- `editar()`: se o cartão não tem `kiroAlturaFixa`, guarde a altura inicial e, a cada `input` no campo (em `requestAnimationFrame`, no máximo uma medição por quadro), ajuste `el.style.height` para o maior valor entre a altura inicial, `alturaDoTexto` e a rolagem do `.cm-scroller` ou do `textarea` mais 24 px, arredondado com `encaixarPraCima`. Redesenhe as setas com a altura nova. Nunca fica menor que a altura inicial.
- `concluir`: grava a altura final calculada do mesmo jeito, no mesmo passo de desfazer do texto. Com `kiroAlturaFixa`, a altura não muda e o texto rola dentro do cartão.
- `GESTOS.mover.mover`: depois do encaixe na grade, calcule a caixa do que está sendo movido com `F.caixaDe(nos, 0)` e chame `F.guiasDeAlinhamento(caixa, outros, 6 / s.vista.zoom)`, em que `outros` são os cartões fora de `g.ids`, sem grupos. Some `dx` e `dy` ao deslocamento: a guia vence a grade. Desenhe cada linha como `<div class="fluxo-guia">` num `<div class="fluxo-guias">` dentro de `.fluxo-mundo`. Uma função `limparGuias()` limpa em `soltar` e no `pointercancel`.
- CSS: `.fluxo-guia { position:absolute; pointer-events:none; background:var(--acento); }`, com espessura `calc(1px / var(--zoom, 1))`.

- [ ] **Step 1: Escreva o teste que falha**

```js
test('redimensionar à mão fixa a altura e a edição a respeita', () => {
  assert.match(fonte, /kiroAlturaFixa: true/);
  assert.match(fonte, /\.kiroAlturaFixa/);
});

test('as guias são limpas ao soltar e ao cancelar o gesto', () => {
  assert.ok((fonte.match(/limparGuias\(\)/g) || []).length >= 2);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs`
Expected: FAIL em `kiroAlturaFixa`.

- [ ] **Step 3: Implemente conforme as decisões acima**

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs tests/fluxo.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add fluxo-tela.js styles.css tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): cartao que cresce com o texto e guias de alinhamento"
```

### Task 6: PDF no cartão, com leitura e Ampliar

**Files:**
- Modify: `fluxo-tela.js`, `app.js` (`montarFluxos`, tela inteira da imagem), `styles.css`, `idiomas/en.js`
- Test: `tests/fluxo-tela-fonte.test.cjs`

**Interfaces:**
- Consumes: `F.ehPdf`, `F.tamanhoPadrao`, `F.caminhoSeguro`, `pdf-nota.js` (ativa sozinho qualquer `.md-pdf` que entre no documento).
- Produces: `opcoes.ampliarPdf(arquivo, pagina)` e `opcoes.abrirPdfNoSistema(arquivo)`.

Decisões de comportamento:
- `conteudo(c)`: PDF com `caminhoSeguro` vira `<details open class="md-pdf fluxo-pdf" data-pdf="…" data-pagina="…"><summary class="md-pdf-topo fluxo-pdf-topo">nome e botão .fluxo-pdf-ampliar</summary><div class="md-pdf-paginas"></div></details>`. Caminho inseguro cai no `<p class="fluxo-arquivo">`, como a imagem.
- O `<summary>` não recolhe: `click` com `preventDefault` em `raiz`.
- CSS: `.fluxo-pdf` ocupa toda a altura do cartão, sem margem, e `.md-pdf-paginas` usa `flex:1; min-height:0`.
- `pointerdown`: no botão Ampliar sai sem gesto, para o clique chegar. Sobre `.md-pdf-paginas`, seleciona o cartão e sai sem `setPointerCapture`, para a barra de rolagem funcionar. Arrastar pelo topo move o cartão.
- `wheel`: sem Ctrl, sobre `.md-pdf-paginas`, sai sem `preventDefault`. Com Ctrl, faz zoom do Fluxo.
- Duplo clique no cartão de PDF amplia. O `dblclick` e o item **Abrir nota** deixam de tratar PDF como nota.
- Menu do cartão de PDF: **Ampliar** e **Abrir no leitor do sistema**.
- Sem piscar: em `desenhar()`, antes do `innerHTML`, guarde o `.fluxo-pdf` de cada cartão e o `scrollTop` das páginas. Depois, se o cartão continua e o caminho é o mesmo, recoloque o elemento antigo e restaure a rolagem.
- Na remontagem da tela inteira (`render()`): um ouvinte de `scroll` em captura guarda a página atual em `s.paginasDoPdf` (Map por id do cartão). `data-pagina` nasce desse valor.
- Entrada: `dragover` e `drop` aceitam `Files`, filtrados por `opcoes.imagensColadas(e.dataTransfer)`, com `stopPropagation`. Arquivo de tipo não aceito: `opcoes.aviso(t('Arraste um PDF ou uma imagem.'), true)`. Colagem, arraste e botão usam `F.tamanhoPadrao({ type: 'file', file: caminho })`, centrando no ponto.
- Barra e menu: o rótulo vira `Adicionar imagem ou PDF`.
- `app.js`: `abrirPdfInteiro(arquivo, pagina)` usa `telaDeImagem`, `aoTeclarNaImagem` e `fecharImagemInteira`. O conteúdo é o `htmlDoPdf({ arquivo, pagina, altura })` com `open`, e `altura` é a altura da janela menos 80. O clique só fecha quando `e.target` é a própria tela.
- `abrirPdfNoSistema` usa `window.cadernoDesktop.openAttachment`. No navegador, o item não aparece.

- [ ] **Step 1: Escreva o teste que falha**

```js
test('PDF não é tratado como nota', () => {
  assert.match(fonte, /F\.ehPdf\(c\.file\)/);
  assert.doesNotMatch(fonte, /type === 'file' && !F\.ehImagem\(no\(idNo\)\.file\) \?/);
});

test('o PDF reaproveita o elemento para não piscar ao redesenhar', () => {
  const i = fonte.indexOf('function desenhar()');
  assert.match(fonte.slice(i, i + 900), /fluxo-pdf/);
});

test('rolar as páginas não é capturado pelo Fluxo', () => {
  const i = fonte.indexOf("raiz.addEventListener('wheel'");
  assert.match(fonte.slice(i, i + 300), /md-pdf-paginas/);
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs`
Expected: FAIL em `F.ehPdf`.

- [ ] **Step 3: Implemente conforme as decisões acima**

- [ ] **Step 4: Rode e veja passar**

Run: `node --test tests/fluxo-tela-fonte.test.cjs tests/fluxo.test.cjs tests/idiomas-cobertura.test.cjs tests/temas.test.cjs`
Expected: PASS, sem falhas.

- [ ] **Step 5: Commit**

```bash
git add fluxo-tela.js app.js styles.css idiomas/en.js tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): pdf no cartao, com leitura e ampliar"
```

### Task 7: Verificação no app real

Fica com quem coordena a execução, depois da revisão de todas as tarefas.

**Files:**
- Script fora do repositório, na pasta temporária da sessão, usando `--dev-vault` e um `--user-data-dir` próprio. Nunca o cofre real.

- [ ] **Step 1: Rode o app e confira pelo Chrome DevTools Protocol**

Cada item passa com o resultado medido no app:
1. Selecionar 2 cartões ligados, `Ctrl+C` e `Ctrl+V`: surgem 2 cartões e 1 seta. `Ctrl+Z` desfaz em um passo.
2. `Ctrl+V` duas vezes sem mexer o mouse: posições diferentes.
3. Copiar cartões, trocar o texto da área de transferência e colar: vira cartão de texto.
4. Copiar num fluxo e colar em outro.
5. `Ctrl+Enter` e `Ctrl+Shift+Enter` digitando num cartão: criam o vizinho, e o segundo vem com seta. `Enter` só quebra a linha.
6. Trocar o atalho nas Configurações e conferir que o novo funciona e o antigo não.
7. Digitar muitas linhas: o cartão cresce. Redimensionar à mão e digitar de novo: a altura fica.
8. Arrastar um cartão perto do alinhamento de outro: a guia aparece, encaixa e some ao soltar.
9. PDF de teste no cartão: páginas aparecem, a rolagem funciona, Ampliar abre, `Esc` fecha, mover outro cartão não reinicia a rolagem.
10. PDF apagado do disco: o cartão fica quebrado, sem erro no console.

- [ ] **Step 2: Olhe fotos da tela em tema Liquid Glass Claro e Escuro e no tema Kiro**

Confirme legibilidade da dica, das guias e do cartão de PDF.

- [ ] **Step 3: Rode tudo**

Run: `npm test`
Expected: nenhuma falha.

- [ ] **Step 4: Atualize a documentação, se necessário**

Se `docs/temas.md` ou `docs/KIRO-resumo-para-IA.md` descreverem o Fluxo de um modo que ficou errado, corrija. Commit só desses arquivos, se mudarem.
