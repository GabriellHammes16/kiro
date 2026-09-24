# Hoje configurável — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Hoje passa a ser montada a partir de um layout gravado no cofre, que a pessoa edita (mostrar, esconder, ordenar, coluna, largura, opções) na própria Hoje e nas Configurações; cartões de plug-in entram no mesmo sistema e podem declarar opções.

**Architecture:** Um módulo puro `hoje.js` (formato do `abas.js`: `KiroHoje` no navegador, `module.exports` no Node) guarda todas as regras de layout. O `app.js` monta um catálogo (cartões nativos + painéis de plug-in), desenha a Hoje por `KiroHoje.faixas` e só chama funções de `KiroHoje` nas duas telas de edição. O layout vive em `.kiro/hoje.json` pelo `Vault`, exposto no Electron e no `server.mjs` como as escolhas dos plug-ins.

**Tech Stack:** JavaScript sem build, Electron, Node `node:test`, HTML5 drag & drop, atributo nativo `popover`.

**Spec:** `docs/superpowers/specs/2026-09-23-hoje-configuravel-design.md`

## Global Constraints

- Sem dependências novas; testes com `node --test tests/*.test.cjs` (`npm test`).
- Colunas: 1, 2 ou 3; padrão 2. Larguras: `normal` | `inteira`. No máximo 200 cartões no layout.
- Tipos de opção: `boolean`, `number`, `select`, `text` (até 80 caracteres).
- Opções de plug-in: até 12; `key` casa `/^[a-z][a-zA-Z0-9]{0,31}$/`; `label` 1–40 caracteres sem controle; `select` com 1–20 `choices` de até 40 caracteres; `width` ∈ `normal | full`.
- Todo texto vindo de plug-in entra na tela com `escapeHtml`.
- Layout gravado em `.kiro/hoje.json` (dentro do cofre), por `atomicWrite`.
- Janela ≤ 780 px: uma coluna na ordem de leitura; nada gravado por causa disso.
- Comentários e textos da interface em português, no tom do código ao redor.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- O app de desenvolvimento roda com `npm run dev` em http://localhost:4180 (cofre `dev-vault/`); mudanças em `app.js` recarregam a página sozinhas.

## Ajustes à especificação (decididos ao planejar)

- **Padrão e plug-ins:** `padrao(catalogo)` = `reconciliar(layoutVazio, catalogo)`. Como os plug-ins registram os painéis depois do primeiro desenho, eles entram por `reconciliar` na coluna com menos cartões visíveis (não "sempre à direita").
- **Nomes no `Vault`:** seguem o inglês do arquivo: `readHomeLayout()` / `writeHomeLayout(layout)`.
- **Assinatura:** `KiroPlugins.validarOpcoesDoPainel(options, width)`.
- **Opções nas Configurações:** o mesmo popover da Hoje, em vez de expandir na linha.
- **Restaurar padrão:** confirmação em dois cliques no próprio botão ("Restaurar padrão" → "Confirmar restauração"), sem modal — assim funciona também de dentro da janela de Configurações.
- **Frase do dia:** o cabeçalho passa a ser data (sobretítulo) + saudação (título); a frase vira o cartão `nativo:frase`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `hoje.js` (novo) | Modelo puro do layout |
| `tests/hoje-layout.test.cjs` (novo) | Testes do modelo |
| `plugins.js` | `validarOpcoesDoPainel` |
| `plugin-worker.js` | `kiro.panel` aceita o 4º argumento e o repassa no `pronto` |
| `tests/plugins.test.cjs` | Testes de `validarOpcoesDoPainel` e do exemplo `word-count` |
| `vault.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `server.mjs` | Ler/gravar `.kiro/hoje.json` |
| `tests/vault.test.cjs` | Ida e volta do layout |
| `index.html` | Carrega `hoje.js` |
| `app.js` | Catálogo, desenho por faixas, modo Personalizar, aba Hoje nas Configurações |
| `styles.css` | Faixas, colunas, ferramentas de edição |
| `examples/plugins/word-count/index.js` | Painel com a opção `limit` |
| `docs/plugins.md` | Seção "Panel options" |

---

### Task 1: Modelo puro `hoje.js`

**Files:**
- Create: `hoje.js`
- Test: `tests/hoje-layout.test.cjs`

**Interfaces:**
- Consumes: nada.
- Produces (tudo em `KiroHoje` no navegador / `require('../hoje.js')` no Node):
  - Layout: `{ colunas: number, cartoes: [{ id: string, coluna: number, largura: 'normal'|'inteira', opcoes: object }], ocultos: string[] }`
  - Entrada de catálogo aceita pelo modelo: `{ id: string, coluna?: number, largura?: 'normal'|'inteira', opcoes?: Declaracao[] }`
  - Declaração de opção: `{ key, type: 'boolean'|'number'|'select'|'text', label, default, min?, max?, choices? }`
  - `MIN_COLUNAS = 1`, `MAX_COLUNAS = 3`
  - `padrao(catalogo) → layout`
  - `reconciliar(layout, catalogo) → layout` (o mesmo objeto se nada entrou)
  - `mover(layout, id, { coluna?, antes? = null }) → layout`
  - `subir(layout, id, visiveis: Set<string>)`, `descer(layout, id, visiveis)`
  - `esconder(layout, id)`, `mostrar(layout, id)`
  - `definirLargura(layout, id, 'normal'|'inteira')`
  - `definirColunas(layout, n)`
  - `valorValido(declaracao, valor) → boolean`
  - `definirOpcao(layout, id, chave, valor, declaracoes[])`
  - `opcoesEfetivas(layout, id, declaracoes[]) → { [key]: valor }`
  - `limpar(bruto) → layout | null`
  - `faixas(layout, visiveis: Set<string>) → [{ tipo: 'inteira', id } | { tipo: 'colunas', colunas: string[][] }]`

- [ ] **Step 1: Escrever os testes**

Criar `tests/hoje-layout.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../hoje.js');

// Catálogo com a forma dos nativos do app: frase inteira no topo, duas colunas.
const NATIVOS = [
  { id: 'frase', coluna: 0, largura: 'inteira' },
  { id: 'habitos', coluna: 0 }, { id: 'agora', coluna: 0 },
  { id: 'continuar', coluna: 1 }, { id: 'caixa', coluna: 1 }, { id: 'revisar', coluna: 1 },
];
const ids = l => l.cartoes.map(c => c.id);
const todos = l => new Set(ids(l));
const LIMITE = { key: 'limite', type: 'number', label: 'Quantos', default: 0, min: 0, max: 50 };
const SEMANA = { key: 'semana', type: 'boolean', label: 'Semana', default: true };
const PASTA = { key: 'pasta', type: 'select', label: 'Pasta', default: 'todas', choices: ['todas', 'trabalho'] };

test('padrão reproduz a Hoje atual: frase inteira e duas colunas', () => {
  const l = H.padrao(NATIVOS);
  assert.equal(l.colunas, 2);
  assert.deepEqual(l.ocultos, []);
  assert.deepEqual(H.faixas(l, todos(l)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [['habitos', 'agora'], ['continuar', 'caixa', 'revisar']] },
  ]);
});

test('reconciliar: cartão novo vai para a coluna mais curta; nada novo devolve o mesmo objeto', () => {
  const l = H.padrao(NATIVOS);
  assert.equal(H.reconciliar(l, NATIVOS), l);
  const r = H.reconciliar(l, [...NATIVOS, { id: 'plugin:a:x' }]);
  assert.deepEqual(H.faixas(r, todos(r))[1].colunas, [['habitos', 'agora', 'plugin:a:x'], ['continuar', 'caixa', 'revisar']]);
  // Escondidos não contam para "mais curta".
  const e = H.reconciliar(H.esconder(H.esconder(l, 'habitos'), 'agora'), [...NATIVOS, { id: 'p' }]);
  assert.equal(e.cartoes.find(c => c.id === 'p').coluna, 0);
  // Coluna pedida pelo catálogo é respeitada; largura "inteira" vai para o fim.
  const c = H.reconciliar(l, [...NATIVOS, { id: 'q', coluna: 1 }, { id: 'w', largura: 'inteira' }]);
  assert.deepEqual(H.faixas(c, todos(c)).at(-1), { tipo: 'inteira', id: 'w' });
  assert.equal(c.cartoes.find(x => x.id === 'q').coluna, 1);
});

test('reconciliar mantém no layout o que sumiu do catálogo (plug-in desligado volta ao lugar)', () => {
  const l = H.reconciliar(H.padrao(NATIVOS), [...NATIVOS, { id: 'p' }]);
  const sem = H.reconciliar(l, NATIVOS);
  assert.ok(ids(sem).includes('p'));
  const visiveis = new Set(NATIVOS.map(n => n.id));
  assert.ok(!H.faixas(sem, visiveis).flatMap(f => f.tipo === 'inteira' ? [f.id] : f.colunas.flat()).includes('p'));
});

test('mover: para outra coluna, antes de um cartão ou para o fim', () => {
  const l = H.padrao(NATIVOS);
  const a = H.mover(l, 'habitos', { coluna: 1, antes: 'caixa' });
  assert.deepEqual(H.faixas(a, todos(a))[1].colunas, [['agora'], ['continuar', 'habitos', 'caixa', 'revisar']]);
  const b = H.mover(l, 'continuar', { coluna: 0 });
  assert.deepEqual(H.faixas(b, todos(b))[1].colunas, [['habitos', 'agora', 'continuar'], ['caixa', 'revisar']]);
  assert.equal(H.mover(l, 'nao-existe', { coluna: 0 }), l);
  assert.equal(H.mover(l, 'caixa', { coluna: 9 }).cartoes.find(c => c.id === 'caixa').coluna, 1);   // coluna fora: a última
});

test('subir e descer trocam com o vizinho visível da mesma coluna, pulando escondidos', () => {
  const l = H.padrao(NATIVOS);
  const d = H.descer(l, 'continuar', todos(l));
  assert.deepEqual(H.faixas(d, todos(d))[1].colunas[1], ['caixa', 'continuar', 'revisar']);
  const oculto = H.esconder(l, 'caixa');
  const vis = new Set(ids(oculto).filter(id => id !== 'caixa'));
  const p = H.descer(oculto, 'continuar', vis);
  assert.deepEqual(p.cartoes.filter(c => c.coluna === 1 && c.largura === 'normal').map(c => c.id), ['revisar', 'caixa', 'continuar']);
  assert.equal(H.subir(l, 'habitos', todos(l)).cartoes[0].id, 'habitos');   // atravessa a frase inteira
  assert.equal(H.subir(H.subir(l, 'habitos', todos(l)), 'habitos', todos(l)).cartoes[0].id, 'habitos');   // já no topo: nada muda
});

test('esconder e mostrar; esconder o que não existe não muda nada', () => {
  const l = H.padrao(NATIVOS);
  const e = H.esconder(l, 'revisar');
  assert.deepEqual(e.ocultos, ['revisar']);
  assert.ok(ids(e).includes('revisar'));   // guarda posição e opções
  assert.equal(H.esconder(e, 'revisar'), e);
  assert.equal(H.esconder(l, 'fantasma'), l);
  assert.deepEqual(H.mostrar(e, 'revisar').ocultos, []);
});

test('definirLargura: inteira quebra as colunas no lugar do cartão', () => {
  const l = H.definirLargura(H.padrao(NATIVOS), 'agora', 'inteira');
  assert.deepEqual(H.faixas(l, todos(l)), [
    { tipo: 'inteira', id: 'frase' },
    { tipo: 'colunas', colunas: [['habitos'], []] },
    { tipo: 'inteira', id: 'agora' },
    { tipo: 'colunas', colunas: [[], ['continuar', 'caixa', 'revisar']] },
  ]);
  assert.equal(H.definirLargura(l, 'agora', 'gigante'), l);
});

test('definirColunas: de 3 para 2 leva a terceira coluna para o fim da última', () => {
  let l = H.definirColunas(H.padrao(NATIVOS), 3);
  l = H.mover(l, 'caixa', { coluna: 2 });
  l = H.mover(l, 'revisar', { coluna: 2 });
  const dois = H.definirColunas(l, 2);
  assert.deepEqual(H.faixas(dois, todos(dois))[1].colunas, [['habitos', 'agora'], ['continuar', 'caixa', 'revisar']]);
  const um = H.definirColunas(dois, 1);
  assert.deepEqual(H.faixas(um, todos(um))[1].colunas, [['habitos', 'agora', 'continuar', 'caixa', 'revisar']]);
  assert.equal(H.definirColunas(um, 4), um);
  assert.equal(H.definirColunas(um, 1), um);
});

test('definirOpcao e opcoesEfetivas: só valor válido grava; padrão apaga a chave', () => {
  const l = H.padrao(NATIVOS);
  const a = H.definirOpcao(l, 'agora', 'limite', 5, [LIMITE]);
  assert.deepEqual(a.cartoes.find(c => c.id === 'agora').opcoes, { limite: 5 });
  assert.equal(H.definirOpcao(a, 'agora', 'limite', 99, [LIMITE]), a);        // fora da faixa
  assert.equal(H.definirOpcao(a, 'agora', 'limite', '5', [LIMITE]), a);       // tipo errado
  assert.equal(H.definirOpcao(a, 'agora', 'outra', 1, [LIMITE]), a);          // chave não declarada
  assert.deepEqual(H.definirOpcao(a, 'agora', 'limite', 0, [LIMITE]).cartoes.find(c => c.id === 'agora').opcoes, {});
  assert.deepEqual(H.opcoesEfetivas(a, 'agora', [LIMITE, SEMANA]), { limite: 5, semana: true });
  // Gravado inválido (declaração mudou numa versão nova do plug-in) volta ao padrão; chave velha some.
  const velho = { ...a, cartoes: a.cartoes.map(c => c.id === 'agora' ? { ...c, opcoes: { limite: 80, pasta: 'x', sobra: 1 } } : c) };
  assert.deepEqual(H.opcoesEfetivas(velho, 'agora', [LIMITE, PASTA]), { limite: 0, pasta: 'todas' });
});

test('valorValido cobre os quatro tipos', () => {
  assert.equal(H.valorValido(SEMANA, false), true);
  assert.equal(H.valorValido(SEMANA, 'false'), false);
  assert.equal(H.valorValido(LIMITE, 50), true);
  assert.equal(H.valorValido(LIMITE, NaN), false);
  assert.equal(H.valorValido(PASTA, 'trabalho'), true);
  assert.equal(H.valorValido(PASTA, 'casa'), false);
  const TEXTO = { key: 't', type: 'text', label: 'T', default: '' };
  assert.equal(H.valorValido(TEXTO, 'a'.repeat(80)), true);
  assert.equal(H.valorValido(TEXTO, 'a'.repeat(81)), false);
});

test('limpar: recusa lixo, corrige campos e descarta repetidos', () => {
  for (const lixo of [null, 1, 'x', [], {}, { cartoes: 'x' }]) assert.equal(H.limpar(lixo), null);
  const l = H.limpar({
    colunas: 7,
    cartoes: [
      { id: 'a', coluna: 1, largura: 'inteira', opcoes: { n: 1, o: { x: 1 } } },
      { id: 'a', coluna: 0 },
      { id: '', coluna: 0 }, null, 'b',
      { id: 'b', coluna: -1, largura: 'enorme', opcoes: [] },
    ],
    ocultos: ['b', 'b', 'fantasma'],
  });
  assert.deepEqual(l, {
    colunas: 2,
    cartoes: [{ id: 'a', coluna: 1, largura: 'inteira', opcoes: { n: 1 } }, { id: 'b', coluna: 0, largura: 'normal', opcoes: {} }],
    ocultos: ['b'],
  });
  const muitos = H.limpar({ colunas: 1, cartoes: Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, coluna: 0 })) });
  assert.equal(muitos.cartoes.length, 200);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/hoje-layout.test.cjs`
Expected: FAIL com `Cannot find module '../hoje.js'`.

- [ ] **Step 3: Implementar `hoje.js`**

```js
// Layout da tela Hoje: só o modelo, sem DOM. Imutável: toda função devolve um layout novo
// (ou o mesmo objeto, quando nada muda). Roda no navegador (KiroHoje) e no Node (testes).
//
// { colunas: 1–3, cartoes: [{ id, coluna, largura: 'normal'|'inteira', opcoes: {…} }, …], ocultos: [id…] }
// A ordem em `cartoes` é a ordem de leitura; `faixas` transforma isso no que a tela desenha.
// O catálogo ({ id, coluna?, largura?, opcoes? }) vem de fora: cartões do Kiro e dos plug-ins.
(function (root) {
  const MIN_COLUNAS = 1, MAX_COLUNAS = 3, PADRAO_COLUNAS = 2, MAX_CARTOES = 200;
  const LARGURAS = ['normal', 'inteira'];
  const vazio = () => ({ colunas: PADRAO_COLUNAS, cartoes: [], ocultos: [] });
  const copia = l => ({ colunas: l.colunas, cartoes: l.cartoes.map(c => ({ ...c, opcoes: { ...c.opcoes } })), ocultos: [...l.ocultos] });
  const primitivo = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const colunaValida = (c, colunas) => Number.isInteger(c) && c >= 0 && c < colunas;

  // Fim de uma coluna: logo depois do último cartão normal dela (ou no fim de tudo).
  function posicaoNoFim(cartoes, coluna) {
    for (let i = cartoes.length - 1; i >= 0; i--) if (cartoes[i].largura === 'normal' && cartoes[i].coluna === coluna) return i + 1;
    return cartoes.length;
  }

  // Quem está no catálogo e não está no layout entra: na coluna pedida ou na mais curta
  // (contando só os visíveis). Quem saiu do catálogo fica guardado, sem aparecer.
  function reconciliar(l, catalogo) {
    const noLayout = new Set(l.cartoes.map(c => c.id));
    const novos = catalogo.filter(e => !noLayout.has(e.id));
    if (!novos.length) return l;
    const r = copia(l);
    const noCatalogo = new Set(catalogo.map(e => e.id));
    for (const e of novos) {
      const largura = e.largura === 'inteira' ? 'inteira' : 'normal';
      let coluna = colunaValida(e.coluna, r.colunas) ? e.coluna : null;
      if (coluna === null) {
        const conta = Array.from({ length: r.colunas }, (_, i) => r.cartoes.filter(c => c.largura === 'normal' && c.coluna === i && noCatalogo.has(c.id) && !r.ocultos.includes(c.id)).length);
        coluna = conta.indexOf(Math.min(...conta));
      }
      r.cartoes.splice(largura === 'inteira' ? r.cartoes.length : posicaoNoFim(r.cartoes, coluna), 0, { id: e.id, coluna, largura, opcoes: {} });
    }
    return r;
  }
  const padrao = catalogo => reconciliar(vazio(), catalogo);

  // Leva o cartão para antes de `antes` (ou para o fim da coluna). Serve ao arraste e às setas.
  function mover(l, id, { coluna, antes = null } = {}) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1 || id === antes) return l;
    const r = copia(l);
    const [cartao] = r.cartoes.splice(i, 1);
    if (Number.isInteger(coluna)) cartao.coluna = Math.max(0, Math.min(r.colunas - 1, coluna));
    const j = antes === null ? -1 : r.cartoes.findIndex(c => c.id === antes);
    r.cartoes.splice(j !== -1 ? j : cartao.largura === 'inteira' ? r.cartoes.length : posicaoNoFim(r.cartoes, cartao.coluna), 0, cartao);
    return r;
  }

  // Vizinho na leitura: um cartão normal troca com o anterior/próximo visível da mesma coluna
  // ou com um cartão inteiro (atravessa a faixa); um cartão inteiro troca com qualquer visível.
  function trocar(l, id, visiveis, passo) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1) return l;
    const eu = l.cartoes[i];
    const conta = c => visiveis.has(c.id) && (eu.largura === 'inteira' || c.largura === 'inteira' || c.coluna === eu.coluna);
    let j = i + passo;
    while (j >= 0 && j < l.cartoes.length && !conta(l.cartoes[j])) j += passo;
    if (j < 0 || j >= l.cartoes.length) return l;
    const r = copia(l);
    [r.cartoes[i], r.cartoes[j]] = [r.cartoes[j], r.cartoes[i]];
    return r;
  }
  const subir = (l, id, visiveis) => trocar(l, id, visiveis, -1);
  const descer = (l, id, visiveis) => trocar(l, id, visiveis, 1);

  const esconder = (l, id) => !l.cartoes.some(c => c.id === id) || l.ocultos.includes(id) ? l : { ...copia(l), ocultos: [...l.ocultos, id] };
  const mostrar = (l, id) => l.ocultos.includes(id) ? { ...copia(l), ocultos: l.ocultos.filter(x => x !== id) } : l;

  function definirLargura(l, id, largura) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1 || !LARGURAS.includes(largura) || l.cartoes[i].largura === largura) return l;
    const r = copia(l);
    r.cartoes[i].largura = largura;
    return r;
  }

  // Menos colunas: os cartões normais que ficaram sem coluna vão para o fim da última, na ordem.
  function definirColunas(l, n) {
    if (!Number.isInteger(n) || n < MIN_COLUNAS || n > MAX_COLUNAS || n === l.colunas) return l;
    const r = copia(l);
    r.colunas = n;
    const sobram = r.cartoes.filter(c => c.largura === 'normal' && c.coluna >= n);
    r.cartoes = r.cartoes.filter(c => !sobram.includes(c));
    for (const c of r.cartoes) if (c.coluna >= n) c.coluna = n - 1;   // inteiros guardam uma coluna válida
    for (const c of sobram) { c.coluna = n - 1; r.cartoes.splice(posicaoNoFim(r.cartoes, n - 1), 0, c); }
    return r;
  }

  function valorValido(o, v) {
    if (o.type === 'boolean') return typeof v === 'boolean';
    if (o.type === 'number') return typeof v === 'number' && Number.isFinite(v) && (o.min === undefined || v >= o.min) && (o.max === undefined || v <= o.max);
    if (o.type === 'select') return Array.isArray(o.choices) && o.choices.includes(v);
    if (o.type === 'text') return typeof v === 'string' && v.length <= 80;
    return false;
  }

  // Só grava o que a declaração aceita; voltar ao padrão apaga a chave (o arquivo guarda só o que mudou).
  function definirOpcao(l, id, chave, valor, declaracao = []) {
    const o = declaracao.find(x => x.key === chave);
    const i = l.cartoes.findIndex(c => c.id === id);
    if (!o || i === -1 || !valorValido(o, valor)) return l;
    const r = copia(l);
    if (valor === o.default) delete r.cartoes[i].opcoes[chave];
    else r.cartoes[i].opcoes[chave] = valor;
    return r;
  }

  function opcoesEfetivas(l, id, declaracao = []) {
    const guardadas = l.cartoes.find(c => c.id === id)?.opcoes || {};
    return Object.fromEntries(declaracao.map(o => [o.key, Object.hasOwn(guardadas, o.key) && valorValido(o, guardadas[o.key]) ? guardadas[o.key] : o.default]));
  }

  // O que vem do disco não é confiável. Os valores das opções só são conferidos contra a
  // declaração em opcoesEfetivas: o layout é lido antes de os plug-ins registrarem os painéis.
  function limpar(bruto) {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto) || !Array.isArray(bruto.cartoes)) return null;
    const colunas = Number.isInteger(bruto.colunas) && bruto.colunas >= MIN_COLUNAS && bruto.colunas <= MAX_COLUNAS ? bruto.colunas : PADRAO_COLUNAS;
    const vistos = new Set(), cartoes = [];
    for (const c of bruto.cartoes) {
      if (cartoes.length >= MAX_CARTOES) break;
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || c.id.length > 200 || vistos.has(c.id)) continue;
      vistos.add(c.id);
      const opcoes = c.opcoes && typeof c.opcoes === 'object' && !Array.isArray(c.opcoes) ? Object.fromEntries(Object.entries(c.opcoes).filter(([, v]) => primitivo(v))) : {};
      cartoes.push({ id: c.id, coluna: colunaValida(c.coluna, colunas) ? c.coluna : 0, largura: LARGURAS.includes(c.largura) ? c.largura : 'normal', opcoes });
    }
    const ocultos = [...new Set(Array.isArray(bruto.ocultos) ? bruto.ocultos : [])].filter(id => vistos.has(id));
    return { colunas, cartoes, ocultos };
  }

  // O que a tela desenha: normais seguidos formam uma faixa de colunas; cada inteiro, uma faixa própria.
  function faixas(l, visiveis) {
    const r = [];
    for (const c of l.cartoes) {
      if (!visiveis.has(c.id)) continue;
      if (c.largura === 'inteira') { r.push({ tipo: 'inteira', id: c.id }); continue; }
      let f = r.at(-1);
      if (!f || f.tipo !== 'colunas') r.push(f = { tipo: 'colunas', colunas: Array.from({ length: l.colunas }, () => []) });
      f.colunas[Math.min(c.coluna, l.colunas - 1)].push(c.id);
    }
    return r;
  }

  const api = { MIN_COLUNAS, MAX_COLUNAS, padrao, reconciliar, mover, subir, descer, esconder, mostrar, definirLargura, definirColunas, valorValido, definirOpcao, opcoesEfetivas, limpar, faixas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroHoje = api;
})(globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/hoje-layout.test.cjs`
Expected: todos os testes PASS. Depois `npm test` inteiro: sem falhas.

- [ ] **Step 5: Commit**

```bash
git add hoje.js tests/hoje-layout.test.cjs
git commit -m "Hoje: modelo puro do layout configurável

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Opções declaradas nos painéis de plug-in

**Files:**
- Modify: `plugins.js` (nova função perto de `validarMoldura`, ~linha 48; exportar em `api`, ~linha 348)
- Modify: `plugin-worker.js:40-44` (`guardar`), `:57` (`panel`), `:75` (`listar`)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: helpers internos de `plugins.js` já existentes: `texto(v, max)` (linha 12) e `temControle(v)` (linha 34).
- Produces:
  - `KiroPlugins.validarOpcoesDoPainel(options, width) → { ok: true, opcoes: Declaracao[], largura: 'normal'|'inteira' } | { ok: false, erro: string }`
  - Registro `pronto` do worker: `panel: [{ id, label, options?, width? }]` (os dois últimos só se o plug-in os passou).

- [ ] **Step 1: Escrever os testes** (acrescentar ao fim de `tests/plugins.test.cjs`)

```js
test('validarOpcoesDoPainel: sem declaração vale painel sem opções e largura normal', () => {
  assert.deepEqual(P.validarOpcoesDoPainel(undefined, undefined), { ok: true, opcoes: [], largura: 'normal' });
  assert.deepEqual(P.validarOpcoesDoPainel(undefined, 'full'), { ok: true, opcoes: [], largura: 'inteira' });
});

test('validarOpcoesDoPainel aceita os quatro tipos e devolve só os campos conhecidos', () => {
  const r = P.validarOpcoesDoPainel([
    { key: 'limit', type: 'number', label: 'How many', default: 5, min: 1, max: 20, extra: 'x' },
    { key: 'folder', type: 'select', label: 'Folder', default: 'all', choices: ['all', 'work'] },
    { key: 'showDates', type: 'boolean', label: 'Show dates', default: true },
    { key: 'title', type: 'text', label: 'Heading', default: '' },
  ], 'normal');
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.largura, 'normal');
  assert.deepEqual(r.opcoes, [
    { key: 'limit', type: 'number', label: 'How many', default: 5, min: 1, max: 20 },
    { key: 'folder', type: 'select', label: 'Folder', default: 'all', choices: ['all', 'work'] },
    { key: 'showDates', type: 'boolean', label: 'Show dates', default: true },
    { key: 'title', type: 'text', label: 'Heading', default: '' },
  ]);
});

test('validarOpcoesDoPainel recusa declarações erradas', () => {
  const ok = { key: 'a', type: 'boolean', label: 'A', default: true };
  const recusa = (options, width) => assert.equal(P.validarOpcoesDoPainel(options, width).ok, false, JSON.stringify(options));
  recusa('x');
  recusa(Array.from({ length: 13 }, (_, i) => ({ ...ok, key: `k${i}` })));
  recusa([ok, ok]);                                            // chave repetida
  recusa([{ ...ok, key: 'Maiuscula' }]);
  recusa([{ ...ok, key: 'a'.repeat(33) }]);
  recusa([{ ...ok, type: 'color' }]);
  recusa([{ ...ok, label: '' }]);
  recusa([{ ...ok, label: 'x'.repeat(41) }]);
  recusa([{ ...ok, label: 'quebra\nlinha' }]);
  recusa([{ ...ok, default: 'true' }]);
  recusa([{ key: 'n', type: 'number', label: 'N', default: 30, min: 1, max: 20 }]);
  recusa([{ key: 'n', type: 'number', label: 'N', default: 1, max: Infinity }]);
  recusa([{ key: 's', type: 'select', label: 'S', default: 'z', choices: ['a'] }]);
  recusa([{ key: 's', type: 'select', label: 'S', default: 'a', choices: [] }]);
  recusa([{ key: 's', type: 'select', label: 'S', default: 'a', choices: Array.from({ length: 21 }, (_, i) => i ? `c${i}` : 'a') }]);
  recusa([{ key: 't', type: 'text', label: 'T', default: 'x'.repeat(81) }]);
  recusa(undefined, 'wide');
  recusa([null]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL com `P.validarOpcoesDoPainel is not a function`.

- [ ] **Step 3: Implementar em `plugins.js`**

Logo antes de `function validarMoldura(valor) {` (~linha 48):

```js
  // Opções de um painel (4º argumento de kiro.panel). O Kiro desenha o formulário; aqui só se
  // confere a declaração. Sem declaração: painel sem opções. `width: 'full'` é só a sugestão
  // inicial de largura — quem decide depois é a pessoa, na Hoje.
  const TIPOS_DE_OPCAO = ['boolean', 'number', 'select', 'text'];
  function validarOpcoesDoPainel(options, width) {
    const recusa = erro => ({ ok: false, erro });
    if (width !== undefined && width !== 'normal' && width !== 'full') return recusa('width precisa ser "normal" ou "full".');
    const largura = width === 'full' ? 'inteira' : 'normal';
    if (options === undefined) return { ok: true, opcoes: [], largura };
    if (!Array.isArray(options) || options.length > 12) return recusa('options precisa ser uma lista de até 12 opções.');
    const chaves = new Set(), opcoes = [];
    const finito = v => v === undefined || (typeof v === 'number' && Number.isFinite(v));
    for (const o of options) {
      if (!o || typeof o !== 'object') return recusa('Cada opção precisa ser um objeto.');
      if (typeof o.key !== 'string' || !/^[a-z][a-zA-Z0-9]{0,31}$/.test(o.key) || chaves.has(o.key)) return recusa(`Chave de opção inválida ou repetida: ${String(o.key).slice(0, 40)}.`);
      chaves.add(o.key);
      if (!TIPOS_DE_OPCAO.includes(o.type)) return recusa(`Tipo de opção desconhecido em ${o.key}.`);
      if (!texto(o.label, 40) || temControle(o.label)) return recusa(`O rótulo de ${o.key} é obrigatório e vai até 40 caracteres.`);
      const saida = { key: o.key, type: o.type, label: o.label, default: o.default };
      if (o.type === 'boolean' && typeof o.default !== 'boolean') return recusa(`O padrão de ${o.key} precisa ser true ou false.`);
      if (o.type === 'text' && (typeof o.default !== 'string' || o.default.length > 80)) return recusa(`O padrão de ${o.key} precisa ser um texto de até 80 caracteres.`);
      if (o.type === 'number') {
        if (typeof o.default !== 'number' || !Number.isFinite(o.default) || !finito(o.min) || !finito(o.max)
          || (o.min !== undefined && o.default < o.min) || (o.max !== undefined && o.default > o.max)) return recusa(`${o.key} precisa de um padrão numérico entre min e max.`);
        if (o.min !== undefined) saida.min = o.min;
        if (o.max !== undefined) saida.max = o.max;
      }
      if (o.type === 'select') {
        if (!Array.isArray(o.choices) || !o.choices.length || o.choices.length > 20
          || !o.choices.every(c => texto(c, 40) && !temControle(c)) || !o.choices.includes(o.default)) return recusa(`${o.key} precisa de 1 a 20 escolhas de texto, e o padrão entre elas.`);
        saida.choices = [...o.choices];
      }
      opcoes.push(saida);
    }
    return { ok: true, opcoes, largura };
  }
```

E acrescentar `validarOpcoesDoPainel` ao objeto `api` no fim do arquivo (~linha 348), depois de `validarMoldura`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/plugins.test.cjs`
Expected: PASS.

- [ ] **Step 5: O worker repassa a declaração**

Em `plugin-worker.js`, trocar `guardar`, a linha do `panel` e `listar`:

```js
function guardar(tipo, id, label, handler, extra) {
  if (typeof id !== 'string' || !id) throw new Error('O id do registro é obrigatório.');
  if (typeof handler !== 'function') throw new Error('O handler precisa ser uma função.');
  registros[tipo].set(id, { label: String(label || id), handler, extra });
}
```

```js
    // O 4º argumento ({ options, width }) é só dado: quem valida e desenha é a página.
    panel: (id, label, render, extra) => {
      let dados;
      try { dados = extra === undefined ? undefined : JSON.parse(JSON.stringify({ options: extra.options, width: extra.width })); }
      catch { throw new Error('As opções do painel precisam ser dados simples (sem funções).'); }
      guardar('panel', id, label, render, dados);
    },
```

```js
const listar = tipo => [...registros[tipo]].map(([id, { label, extra }]) => ({ id, label, ...extra }));
```

Atualizar o comentário do protocolo no topo do worker (linha 14): `panel: [{ id, label, options?, width? }]`.

- [ ] **Step 6: Rodar tudo**

Run: `npm test`
Expected: PASS (nenhum teste existente depende da forma do `listar`).

- [ ] **Step 7: Commit**

```bash
git add plugins.js plugin-worker.js tests/plugins.test.cjs
git commit -m "Plug-ins: painéis declaram opções e largura sugerida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Layout gravado em `.kiro/hoje.json`

**Files:**
- Modify: `vault.cjs:345-354` (ao lado de `readPluginChoices`)
- Modify: `electron/main.cjs:128-129`, `electron/preload.cjs:18-19`, `server.mjs:125-128`
- Test: `tests/vault.test.cjs`

**Interfaces:**
- Produces:
  - `vault.readHomeLayout() → Promise<object|null>` (`null` sem arquivo ou com JSON quebrado)
  - `vault.writeHomeLayout(layout) → Promise<layout>`
  - Electron: `window.cadernoDesktop.homeLayout()` / `window.cadernoDesktop.saveHomeLayout(layout)`
  - Web: `GET /api/home-layout` → objeto ou `null`; `POST /api/home-layout` com o layout (até 256 KB) → o layout.

- [ ] **Step 1: Escrever o teste** (fim de `tests/vault.test.cjs`)

```js
test('layout da Hoje: ida e volta em .kiro/hoje.json; sem arquivo ou quebrado, null', async t => {
  const vault = await setup(t);
  assert.equal(await vault.readHomeLayout(), null);
  const layout = { colunas: 3, cartoes: [{ id: 'nativo:habitos', coluna: 2, largura: 'normal', opcoes: { mostrarSemana: false } }], ocultos: [] };
  await vault.writeHomeLayout(layout);
  assert.deepEqual(await vault.readHomeLayout(), layout);
  assert.ok((await fs.readFile(path.join(vault.directory, '.kiro', 'hoje.json'), 'utf8')).endsWith('\n'));
  await fs.writeFile(path.join(vault.directory, '.kiro', 'hoje.json'), '{quebrado');
  assert.equal(await vault.readHomeLayout(), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/vault.test.cjs`
Expected: FAIL com `vault.readHomeLayout is not a function`.

- [ ] **Step 3: Implementar no `Vault`** (logo depois de `writePluginChoices`)

```js
  /** Layout da tela Hoje em .kiro/hoje.json. Quem valida é a página (hoje.js): aqui só se lê e grava. */
  async readHomeLayout(){
    const bruto=await optionalRead(path.join(this.directory,'.kiro','hoje.json'));
    if(!bruto)return null;
    try{return JSON.parse(bruto);}catch{return null;}
  }
  async writeHomeLayout(layout){
    await atomicWrite(path.join(this.directory,'.kiro','hoje.json'),`${JSON.stringify(layout,null,2)}\n`);
    return layout;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/vault.test.cjs`
Expected: PASS.

- [ ] **Step 5: Expor no Electron e no servidor**

`electron/main.cjs`, depois da linha 129:
```js
  ipcMain.handle('home:get', () => vault.readHomeLayout());
  ipcMain.handle('home:set', (_event, layout) => vault.writeHomeLayout(layout));
```

`electron/preload.cjs`, depois da linha 19:
```js
  homeLayout: () => ipcRenderer.invoke('home:get'),
  saveHomeLayout: layout => ipcRenderer.invoke('home:set', layout),
```

`server.mjs`, depois do bloco `/api/plugin-choices` (linha 128):
```js
    if (rota === '/api/home-layout') {
      if (request.method === 'GET') return send(response, 200, await vault.readHomeLayout());
      if (request.method === 'POST') return send(response, 200, await vault.writeHomeLayout(await lerJson(request, 256 * 1024)));
    }
```

- [ ] **Step 6: Conferir a rota no servidor de desenvolvimento**

Com `npm run dev` rodando (o `--watch` reinicia sozinho):
Run: `curl -s http://localhost:4180/api/home-layout`
Expected: `null`.

- [ ] **Step 7: Rodar tudo e commit**

Run: `npm test` → PASS.

```bash
git add vault.cjs electron/main.cjs electron/preload.cjs server.mjs tests/vault.test.cjs
git commit -m "Cofre: layout da Hoje em .kiro/hoje.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hoje desenhada pelo layout (catálogo, faixas, opções)

Sem modo de edição ainda: a Hoje fica visualmente igual à atual, mas montada por `KiroHoje`, com o layout lido e gravado no cofre e as opções chegando aos cartões e aos plug-ins.

**Files:**
- Modify: `index.html:39` (carregar `hoje.js`)
- Modify: `app.js` — `renderToday` (~47-52), `cardHabitos` (~100), `cardCaixaDeEntrada`/`cardParaRevisar` (~1100-1110), `reload` (~1085), `escolherOutroCofre` (~3841), `atenderPlugin` (~2778), `cardsDosPlugins`/`desenharPaineisDosPlugins`/`acaoDoPainel` (~2967-3015)
- Modify: `styles.css` (fim do arquivo)

**Interfaces:**
- Consumes: `KiroHoje.*` (Task 1), `KiroPlugins.validarOpcoesDoPainel` (Task 2), `cadernoDesktop.homeLayout/saveHomeLayout` e `/api/home-layout` (Task 3).
- Produces (usados nas Tasks 5 e 6):
  - `let hojeLayout` — layout atual (`null` até a primeira leitura)
  - `catalogoDaHoje() → [{ id, titulo, origem, coluna?, largura, opcoes: Declaracao[], render(opcoes) → html }]`
  - `layoutDaHoje() → layout` (reconciliado com o catálogo; grava se algo entrou)
  - `idsVisiveisDaHoje(layout, catalogo) → Set<string>`
  - `mudarHoje(fn: layout => layout)` — aplica, grava com atraso, redesenha a Hoje e a aba das Configurações
  - `personalizandoHoje: boolean` (declarado aqui, usado na Task 5)
  - `estado.paineis` de plug-in passa a ser `[{ id, label, opcoes, largura, erro }]`

- [ ] **Step 1: Carregar o módulo**

`index.html`, depois de `<script src="abas.js"></script>`:
```html
    <script src="hoje.js"></script>
```

- [ ] **Step 2: Ler e gravar o layout**

Em `app.js`, perto de `const pluginApi = {` (~linha 2697), acrescentar:

```js
// ---- Layout da Hoje (.kiro/hoje.json). As regras ficam em hoje.js; aqui só ler, gravar e desenhar. ----
const hojeApi = {
  ler: () => window.cadernoDesktop ? window.cadernoDesktop.homeLayout() : api('home-layout'),
  gravar: l => window.cadernoDesktop ? window.cadernoDesktop.saveHomeLayout(l) : api('home-layout', l),
};
let hojeLayout = null;          // null até a primeira leitura
let hojeGravavel = false;       // leitura falhou: usa o padrão sem sobrescrever o arquivo da pessoa
let hojeTimer = null;
let personalizandoHoje = false;
async function carregarHoje() {
  try { hojeLayout = KiroHoje.limpar(await hojeApi.ler()); hojeGravavel = true; }
  catch (erro) { hojeLayout = null; hojeGravavel = false; status(`Não foi possível ler o layout da Hoje: ${erro.message}`, true); }
}
function gravarHojeDepois() {
  if (!hojeGravavel) return;
  clearTimeout(hojeTimer);
  const alvo = hojeLayout;
  hojeTimer = setTimeout(() => hojeApi.gravar(alvo).catch(erro => status(`Não foi possível gravar o layout da Hoje: ${erro.message}`, true)), 400);
}
```

Em `reload` (~linha 1090), trocar `const saved=await loadFromVault();Kiro.validateState(saved);` por:
```js
    const saved=await loadFromVault();Kiro.validateState(saved);
    if(!loaded||manual)await carregarHoje();
```

Em `escolherOutroCofre` (~linha 3845), depois de `state=saved;loaded=true;failed=false;expanded=null;editing=null;` e antes de `render();`, inserir `await carregarHoje();personalizandoHoje=false;`.

- [ ] **Step 3: Painéis de plug-in guardam a declaração validada**

Em `atenderPlugin`, trocar a linha `estado.paineis = ...` por:
```js
    estado.paineis = (data.registros?.panel || []).map(r => {
      const v = KiroPlugins.validarOpcoesDoPainel(r.options, r.width);
      return { id: String(r.id), label: String(r.label || r.id), opcoes: v.ok ? v.opcoes : [], largura: v.ok ? v.largura : 'normal', erro: v.ok ? '' : `Opções do painel inválidas: ${v.erro}` };
    });
```

- [ ] **Step 4: Catálogo e cartões nativos com opções**

Substituir `renderToday` (e manter `fraseDoDia`/`saudacao` como estão) por:

```js
function renderToday() {
  const catalogo = catalogoDaHoje(), l = layoutDaHoje(catalogo);
  const porId = new Map(catalogo.map(c => [c.id, c]));
  const desenhar = id => {
    const c = porId.get(id);
    const html = c.render(KiroHoje.opcoesEfetivas(l, id, c.opcoes));
    return personalizandoHoje ? cartaoEmEdicao(c, l, html) : html;
  };
  const lista = KiroHoje.faixas(l, idsVisiveisDaHoje(l, catalogo));
  // Editando sem nenhum cartão normal: uma faixa de colunas vazia, para ter onde soltar.
  if (personalizandoHoje && !lista.some(f => f.tipo === 'colunas')) lista.push({ tipo: 'colunas', colunas: Array.from({ length: l.colunas }, () => []) });
  const faixas = lista.map(f => f.tipo === 'inteira'
    ? `<div class="hoje-faixa-inteira">${desenhar(f.id)}</div>`
    : `<div class="today-grid hoje-colunas" style="--hoje-colunas:${l.colunas}">${f.colunas.map((ids, i) => `<div class="stack" data-hoje-coluna="${i}">${ids.map(desenhar).join('')}</div>`).join('')}</div>`).join('');
  const botao = `<button type="button" class="secondary" data-hoje-acao="personalizar" aria-pressed="${personalizandoHoje}">${personalizandoHoje ? 'Concluir' : `${icone('realce')} Personalizar`}</button>`;
  return `${head(formatDate(today()), saudacao(), '', botao)}<div class="hoje-faixas${personalizandoHoje ? ' personalizando' : ''}">${faixas}</div>${personalizandoHoje ? rodapeDaPersonalizacao(catalogo, l) : ''}`;
}
// Cartões do Kiro e dos plug-ins num catálogo só: o layout decide onde e se aparecem.
const LIMITE_DA_LISTA = { key: 'limite', type: 'number', label: 'Quantos mostrar (0 = todos)', default: 0, min: 0, max: 50 };
const cortar = (lista, limite) => limite > 0 ? lista.slice(0, limite) : lista;
function catalogoDaHoje() {
  const nativos = [
    { id: 'nativo:frase', titulo: 'Frase do dia', coluna: 0, largura: 'inteira', opcoes: [],
      render: () => `<section class="card cartao-frase"><p class="frase-do-dia">${escapeHtml(fraseDoDia())}</p></section>` },
    { id: 'nativo:habitos', titulo: 'Hábitos', coluna: 0, opcoes: [{ key: 'mostrarSemana', type: 'boolean', label: 'Mostrar a semana', default: true }],
      render: o => cardHabitos(o) },
    { id: 'nativo:agora', titulo: 'Para fazer agora', coluna: 0, opcoes: [LIMITE_DA_LISTA], render: o => cardAgora(o) },
    { id: 'nativo:continuar', titulo: 'Continuar de onde parei', coluna: 1, opcoes: [],
      render: () => cardContinuar([...state.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0]) },
    { id: 'nativo:caixa', titulo: 'Caixa de entrada', coluna: 1, opcoes: [LIMITE_DA_LISTA], render: o => cardCaixaDeEntrada(o) },
    { id: 'nativo:revisar', titulo: 'Para revisar', coluna: 1, opcoes: [LIMITE_DA_LISTA], render: o => cardParaRevisar(o) },
  ].map(c => ({ largura: 'normal', origem: 'Kiro', ...c }));
  const dosPlugins = [];
  for (const [id, estado] of pluginsAtivos) for (const painel of estado.paineis || []) dosPlugins.push({
    id: `plugin:${id}:${painel.id}`, titulo: painel.label, origem: estado.manifesto?.name || id,
    largura: painel.largura, opcoes: painel.opcoes, render: () => cartaoDoPainel(id, painel),
  });
  return [...nativos, ...dosPlugins];
}
// Reconciliar na hora de desenhar: um plug-in recém-ativado ganha lugar e isso é gravado.
function layoutDaHoje(catalogo = catalogoDaHoje()) {
  const semArquivo = !hojeLayout;
  const novo = KiroHoje.reconciliar(hojeLayout || KiroHoje.padrao(catalogo), catalogo);
  if (semArquivo || novo !== hojeLayout) { hojeLayout = novo; gravarHojeDepois(); }
  return hojeLayout;
}
const idsVisiveisDaHoje = (l, catalogo) => new Set(catalogo.map(c => c.id).filter(id => !l.ocultos.includes(id)));
function cardAgora({ limite }) {
  const urgent = state.tasks.filter(t => !t.done && t.due <= today());
  return `<section class="card"><div class="card-head"><h2>Para fazer agora</h2><a data-go="tasks">Ver tarefas</a></div>${cortar(urgent, limite).map(taskRow).join("") || '<div class="empty">Nada urgente para hoje.</div>'}</section>`;
}
```

Observação sobre `layoutDaHoje`: sem arquivo (`hojeLayout === null`), o padrão é criado e gravado — assim a primeira mudança de plug-in já encontra o arquivo. Com arquivo, só grava quando `reconciliar` acrescentou algo.

Ajustes nos cartões existentes:
- `cardHabitos()` → `cardHabitos({ mostrarSemana = true } = {})`; na função `linha`, trocar `<div class="habito-semana">${dias}</div>` por `${mostrarSemana ? `<div class="habito-semana">${dias}</div>` : ''}`.
- `cardCaixaDeEntrada()` → `cardCaixaDeEntrada({ limite = 0 } = {})`; trocar `${notas.map(` por `${cortar(notas, limite).map(` (o contador no cabeçalho continua com `notas.length`).
- `cardParaRevisar()` → `cardParaRevisar({ limite = 0 } = {})`; trocar `lista('Soltas',loose)` por `lista('Soltas',cortar(loose,limite))` e `lista('Esquecidas',forgotten)` por `lista('Esquecidas',cortar(forgotten,limite))`.

- [ ] **Step 5: Cartão de plug-in e opções chegando ao `render`**

Substituir `cardsDosPlugins()` por `cartaoDoPainel`, e passar `options` nas duas chamadas de painel:

```js
function cartaoDoPainel(id, painel) {
  const nome = escapeHtml(pluginsAtivos.get(id)?.manifesto?.name || id);
  return `<section class="card plugin-painel" data-plugin="${escapeHtml(id)}" data-painel="${escapeHtml(painel.id)}"><div class="card-head"><h2>${escapeHtml(painel.label)}</h2><span class="plugin-fonte">${nome}</span></div><div class="plugin-conteudo">${conteudoDosPaineis.get(chaveDoPainel(id, painel.id)) || '<div class="empty">Carregando…</div>'}</div></section>`;
}
const painelDoPlugin = (id, painelId) => pluginsAtivos.get(id)?.paineis?.find(p => p.id === painelId);
const opcoesDoPainel = (id, painel) => KiroHoje.opcoesEfetivas(hojeLayout || { cartoes: [] }, `plugin:${id}:${painel.id}`, painel.opcoes);
```

Em `desenharPaineisDosPlugins`, dentro do `for`, trocar a chamada por:
```js
    const { plugin, painel } = card.dataset;
    const registro = painelDoPlugin(plugin, painel);
    if (!registro) continue;
    if (registro.erro) { guardarPainel(plugin, painel, { type: 'text', text: registro.erro }); continue; }
    chamarPlugin(plugin, { tipo: 'panel', id: painel }, { action: '', values: {}, options: opcoesDoPainel(plugin, registro) })
```
(o `.then`/`.catch` seguem iguais).

Em `acaoDoPainel`, trocar a chamada por:
```js
  const registro = painelDoPlugin(id, painel);
  if (!registro || registro.erro) return;
  chamarPlugin(id, { tipo: 'panel', id: painel }, { action: acao, values: values || {}, options: opcoesDoPainel(id, registro) })
```

Procurar outros usos: `grep -n "cardsDosPlugins" app.js` deve voltar vazio.

- [ ] **Step 6: `mudarHoje` e esqueletos das funções da Task 5**

Logo depois de `gravarHojeDepois`:
```js
// Toda mudança de layout passa por aqui, venha da Hoje ou das Configurações.
function mudarHoje(fn) {
  const antes = layoutDaHoje();
  const depois = fn(antes);
  if (depois === antes) return;
  hojeLayout = depois;
  gravarHojeDepois();
  if (currentView === 'today' && !paginaDoPlugin) render();
  const aba = $('#cfg-hoje');
  if (aba) aba.innerHTML = conteudoDaAbaHoje();
}
```

Para a Hoje já desenhar nesta task, acrescentar versões mínimas que a Task 5 e a Task 6 substituem:
```js
function cartaoEmEdicao(c, l, html) { return html; }
function rodapeDaPersonalizacao() { return ''; }
function conteudoDaAbaHoje() { return ''; }
```

- [ ] **Step 7: CSS das faixas** (fim de `styles.css`)

```css
/* ---- Hoje configurável: faixas de colunas e cartões de largura inteira ---- */
.hoje-faixas { display:grid; gap:var(--esp-5); }
/* No máximo N colunas; abaixo de ~280 px por coluna elas descem, na ordem de leitura. */
.content .today-grid.hoje-colunas { grid-template-columns:repeat(auto-fit, minmax(min(100%, max(280px, calc((100% - (var(--hoje-colunas) - 1) * var(--esp-5)) / var(--hoje-colunas)))), 1fr)); }
.hoje-colunas > .stack { align-content:start; }
.cartao-frase .frase-do-dia { margin:0; }
@media (max-width:780px) { .content .today-grid.hoje-colunas { grid-template-columns:1fr; } }
```

- [ ] **Step 8: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Conferir no navegador**

Abrir http://localhost:4180 (a página recarrega sozinha). Conferir:
1. A Hoje mostra: data e saudação no cabeçalho, captura rápida, a frase num cartão largo, Hábitos e Para fazer agora à esquerda, Continuar, Caixa de entrada e Para revisar à direita, e o painel do `word-count` (se ativo) na coluna mais curta.
2. `dev-vault/.kiro/hoje.json` foi criado com esse layout.
3. Editar à mão `"colunas": 1` no arquivo, recarregar pelas Configurações → Sistema → Recarregar: tudo numa coluna. Voltar para 2.
4. Janela estreita (< 780 px): uma coluna.
5. Console do navegador sem erros.

- [ ] **Step 10: Commit**

```bash
git add index.html app.js styles.css
git commit -m "Hoje: desenhada pelo layout do cofre, com opções nos cartões

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Modo Personalizar na Hoje

**Files:**
- Modify: `app.js` (substituir os esqueletos da Task 4; ouvintes globais perto dos `document.addEventListener('dragstart'…` existentes, ~linha 3811)
- Modify: `styles.css` (fim do arquivo)

**Interfaces:**
- Consumes: `hojeLayout`, `catalogoDaHoje`, `layoutDaHoje`, `idsVisiveisDaHoje`, `mudarHoje`, `personalizandoHoje` (Task 4); `KiroHoje.*` (Task 1).
- Produces (usados na Task 6):
  - `camposDeOpcoes(id, declaracoes, valores, prefixo) → html` — campos com `data-hoje-opcao="<key>"` e `data-hoje-id="<id>"`
  - `popoverDeOpcoes(c, l, prefixo, indice) → html` — botão `popovertarget` + `<div popover>`
  - `acaoDaHoje(acao, id, valor)` — tratador único de `[data-hoje-acao]`
  - Atributos: `data-hoje-acao` ∈ `personalizar | subir | descer | esquerda | direita | largura | esconder | mostrar | colunas | restaurar`

- [ ] **Step 1: Cartão em edição, formulário e rodapé**

Substituir os três esqueletos da Task 4 (`cartaoEmEdicao`, `rodapeDaPersonalizacao`; `conteudoDaAbaHoje` fica para a Task 6) por:

```js
const botaoDaHoje = (acao, conteudo, rotulo, extra = '') => `<button type="button" class="icon-button" data-hoje-acao="${acao}" aria-label="${rotulo}" title="${rotulo}"${extra}>${conteudo}</button>`;
// Formulário das opções: o Kiro desenha a partir da declaração; nenhum HTML vem do plug-in.
function camposDeOpcoes(id, declaracoes, valores) {
  return declaracoes.map(o => {
    const alvo = `data-hoje-id="${escapeHtml(id)}" data-hoje-opcao="${escapeHtml(o.key)}"`, v = valores[o.key];
    const campo = o.type === 'boolean' ? `<input type="checkbox" ${alvo} ${v ? 'checked' : ''} />`
      : o.type === 'number' ? `<input type="number" ${alvo} value="${v}" step="any"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''} />`
      : o.type === 'select' ? `<select ${alvo}>${o.choices.map(c => `<option value="${escapeHtml(c)}" ${c === v ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>`
      : `<input type="text" ${alvo} value="${escapeHtml(v)}" maxlength="80" />`;
    return `<label class="hoje-opcao"><span>${escapeHtml(o.label)}</span>${campo}</label>`;
  }).join('');
}
// Popover nativo: abre por cima sem modal e fecha com Esc ou clique fora.
function popoverDeOpcoes(c, l, prefixo, indice) {
  if (!c.opcoes.length) return '';
  const alvo = `hoje-op-${prefixo}-${indice}`;
  return `<button type="button" class="icon-button" popovertarget="${alvo}" aria-label="Opções de ${escapeHtml(c.titulo)}" title="Opções">${icone('detalhes')}</button><div popover id="${alvo}" class="hoje-opcoes" data-hoje-id="${escapeHtml(c.id)}"><h3>${escapeHtml(c.titulo)}</h3>${camposDeOpcoes(c.id, c.opcoes, KiroHoje.opcoesEfetivas(l, c.id, c.opcoes))}</div>`;
}
// No modo Personalizar o corpo do cartão fica inerte: dá para arrumar sem marcar hábito sem querer.
function cartaoEmEdicao(c, l, html) {
  const cartao = l.cartoes.find(x => x.id === c.id);
  const indice = catalogoDaHoje().findIndex(x => x.id === c.id);
  const corpo = html || `<section class="card"><div class="card-head"><h2>${escapeHtml(c.titulo)}</h2></div><div class="empty">Nada agora.</div></section>`;
  const lateral = cartao.largura === 'normal'
    ? `${botaoDaHoje('esquerda', '←', 'Coluna à esquerda', cartao.coluna === 0 ? ' disabled' : '')}${botaoDaHoje('direita', '→', 'Coluna à direita', cartao.coluna >= l.colunas - 1 ? ' disabled' : '')}`
    : '';
  return `<div class="hoje-cartao" data-hoje-id="${escapeHtml(c.id)}" draggable="true">
    <div class="hoje-ferramentas" role="toolbar" aria-label="${escapeHtml(c.titulo)}">
      <span class="hoje-alca" aria-hidden="true">⠿</span><span class="hoje-nome">${escapeHtml(c.titulo)}</span>
      ${botaoDaHoje('subir', '↑', 'Subir')}${botaoDaHoje('descer', '↓', 'Descer')}${lateral}
      ${botaoDaHoje('largura', cartao.largura === 'inteira' ? '⇥⇤' : '⇤⇥', cartao.largura === 'inteira' ? 'Largura normal' : 'Largura inteira')}
      ${popoverDeOpcoes(c, l, 'tela', indice)}
      ${botaoDaHoje('esconder', '×', `Esconder ${escapeHtml(c.titulo)}`)}
    </div>
    <div class="hoje-cartao-corpo" inert>${corpo}</div>
  </div>`;
}
function rodapeDaPersonalizacao(catalogo, l) {
  const escondidos = catalogo.filter(c => l.ocultos.includes(c.id));
  return `<div class="hoje-rodape">
    <div class="hoje-escondidos"><span class="small-muted">Cartões escondidos:</span>${escondidos.map(c => `<button type="button" class="chip" data-hoje-acao="mostrar" data-hoje-id="${escapeHtml(c.id)}">${icone('mais')} ${escapeHtml(c.titulo)}</button>`).join('') || '<span class="small-muted">nenhum</span>'}</div>
    <div class="hoje-colunas-escolha" role="group" aria-label="Colunas"><span class="small-muted">Colunas:</span>${[1, 2, 3].map(n => `<button type="button" class="chip" data-hoje-acao="colunas" data-valor="${n}" aria-pressed="${n === l.colunas}">${n}</button>`).join('')}</div>
    <button type="button" class="secondary cfg-pequeno" data-hoje-acao="restaurar">${icone('recarregar')} Restaurar padrão</button>
  </div>`;
}
```

- [ ] **Step 2: Ações dos botões**

```js
// Um tratador para a Hoje e para as Configurações. Depois de redesenhar, o foco volta ao mesmo
// botão do mesmo cartão: dá para mover várias vezes só com o teclado.
let hojePopoverAberto = null;
function acaoDaHoje(acao, id, valor, botao) {
  if (acao === 'personalizar') { personalizandoHoje = !personalizandoHoje; render(); $('[data-hoje-acao="personalizar"]')?.focus(); return; }
  if (acao === 'restaurar') {
    // Dois cliques no mesmo botão: o primeiro só pede confirmação (funciona até dentro das Configurações).
    if (botao && !botao.dataset.confirmando) { botao.dataset.confirmando = '1'; botao.textContent = 'Confirmar restauração'; return; }
    return mudarHoje(() => KiroHoje.padrao(catalogoDaHoje()));
  }
  const l = layoutDaHoje(), catalogo = catalogoDaHoje(), cartao = l.cartoes.find(c => c.id === id);
  const fns = {
    subir: () => KiroHoje.subir(l, id, idsVisiveisDaHoje(l, catalogo)),
    descer: () => KiroHoje.descer(l, id, idsVisiveisDaHoje(l, catalogo)),
    esquerda: () => KiroHoje.mover(l, id, { coluna: cartao.coluna - 1 }),
    direita: () => KiroHoje.mover(l, id, { coluna: cartao.coluna + 1 }),
    largura: () => KiroHoje.definirLargura(l, id, cartao.largura === 'inteira' ? 'normal' : 'inteira'),
    esconder: () => KiroHoje.esconder(l, id),
    mostrar: () => KiroHoje.mostrar(l, id),
    colunas: () => KiroHoje.definirColunas(l, Number(valor)),
  };
  if (!fns[acao] || (acao !== 'colunas' && !cartao)) return;
  mudarHoje(fns[acao]);
  const seletor = acao === 'colunas' ? `[data-hoje-acao="colunas"][data-valor="${valor}"]` : `[data-hoje-id="${CSS.escape(id)}"] [data-hoje-acao="${acao}"]`;
  document.querySelector(seletor)?.focus();
}
function mudarOpcaoDaHoje(id, chave, valor) {
  const c = catalogoDaHoje().find(x => x.id === id);
  if (!c) return;
  hojePopoverAberto = document.querySelector(`[popover][data-hoje-id="${CSS.escape(id)}"]:popover-open`)?.id || null;
  mudarHoje(l => KiroHoje.definirOpcao(l, id, chave, valor, c.opcoes));
  // Redesenhar troca o popover por um novo: reabre o mesmo, se estava aberto.
  if (hojePopoverAberto) document.getElementById(hojePopoverAberto)?.showPopover?.();
  if (id.startsWith('plugin:')) desenharPaineisDosPlugins();
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-hoje-acao]');
  if (!b || b.disabled) return;
  e.preventDefault();
  acaoDaHoje(b.dataset.hojeAcao, b.dataset.hojeId ?? b.closest('[data-hoje-id]')?.dataset.hojeId, b.dataset.valor, b);
});
document.addEventListener('change', e => {
  const campo = e.target.closest?.('[data-hoje-opcao]');
  if (!campo) return;
  e.stopPropagation();   // não marca a janela de Configurações como alterada: grava na hora
  if (campo.type === 'number' && campo.value === '') return;
  mudarOpcaoDaHoje(campo.dataset.hojeId, campo.dataset.hojeOpcao, campo.type === 'checkbox' ? campo.checked : campo.type === 'number' ? Number(campo.value) : campo.value);
});
```

Observação: `desenharPaineisDosPlugins` já é chamado por `enhanceView` a cada `render()` da Hoje; a chamada extra em `mudarOpcaoDaHoje` cobre a mudança feita pelas Configurações (a Hoje pode não estar redesenhando).

- [ ] **Step 3: Arrastar cartões**

Junto dos outros ouvintes de arraste (~linha 3811):

```js
// Arrastar cartões no modo Personalizar: solta antes do cartão sob o ponteiro (metade de cima)
// ou depois dele; numa coluna vazia, no fim dela.
function alvoDoCartao(e) {
  const coluna = e.target.closest?.('.hoje-faixas.personalizando [data-hoje-coluna]');
  const inteiro = e.target.closest?.('.hoje-faixas.personalizando .hoje-faixa-inteira .hoje-cartao');
  if (!coluna && !inteiro) return null;
  const depoisDe = (el) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  if (inteiro) {
    const ordem = layoutDaHoje().cartoes.map(c => c.id), i = ordem.indexOf(inteiro.dataset.hojeId);
    return { el: inteiro, antes: depoisDe(inteiro) ? ordem[i + 1] ?? null : inteiro.dataset.hojeId };
  }
  const acima = [...coluna.querySelectorAll(':scope > .hoje-cartao')].find(c => !depoisDe(c));
  return { el: coluna, coluna: Number(coluna.dataset.hojeColuna), antes: acima?.dataset.hojeId ?? null };
}
const limparAlvosDaHoje = () => document.querySelectorAll('.hoje-alvo').forEach(x => x.classList.remove('hoje-alvo'));
document.addEventListener('dragstart', e => {
  const c = e.target.closest?.('.hoje-cartao');
  if (!c) return;
  e.dataTransfer.setData('text/kiro-cartao', c.dataset.hojeId);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', e => {
  if (!e.dataTransfer.types.includes('text/kiro-cartao')) return;
  const alvo = alvoDoCartao(e);
  limparAlvosDaHoje();
  if (!alvo) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  alvo.el.classList.add('hoje-alvo');
});
document.addEventListener('drop', e => {
  if (!e.dataTransfer.types.includes('text/kiro-cartao')) return;
  const alvo = alvoDoCartao(e), id = e.dataTransfer.getData('text/kiro-cartao');
  limparAlvosDaHoje();
  if (!alvo || !id) return;
  e.preventDefault();
  mudarHoje(l => KiroHoje.mover(l, id, alvo.coluna === undefined ? { antes: alvo.antes } : { coluna: alvo.coluna, antes: alvo.antes }));
});
document.addEventListener('dragend', limparAlvosDaHoje);
```

- [ ] **Step 4: Sair do modo ao trocar de tela**

Em `irPara` (`app.js:1229`, `async function irPara(destino)`), como primeira linha do corpo: `if (destino !== 'today') personalizandoHoje = false;`

- [ ] **Step 5: CSS do modo** (fim de `styles.css`)

```css
.hoje-faixas.personalizando .hoje-colunas > .stack { min-height:96px; border:1px dashed var(--line); border-radius:12px; padding:var(--esp-3); }
.hoje-cartao { display:grid; gap:var(--esp-2); }
.hoje-ferramentas { display:flex; align-items:center; gap:var(--esp-1); flex-wrap:wrap; font-size:13px; }
.hoje-alca { cursor:grab; color:var(--muted); padding:0 var(--esp-1); }
.hoje-nome { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); }
.hoje-cartao-corpo { opacity:.85; }
.hoje-alvo { outline:2px solid var(--acento); outline-offset:2px; }
.hoje-rodape { display:flex; flex-wrap:wrap; gap:var(--esp-4); align-items:center; margin-top:var(--esp-5); }
.hoje-escondidos, .hoje-colunas-escolha { display:flex; flex-wrap:wrap; gap:var(--esp-2); align-items:center; }
.hoje-colunas-escolha [aria-pressed="true"] { background:var(--acento); color:var(--bg); }
.hoje-opcoes { border:1px solid var(--line); border-radius:12px; background:var(--panel-raised, var(--panel)); color:var(--ink); padding:var(--esp-4); min-width:240px; box-shadow:var(--shadow); }
.hoje-opcoes h3 { margin:0 0 var(--esp-3); font-size:14px; }
.hoje-opcao { display:flex; justify-content:space-between; align-items:center; gap:var(--esp-3); padding:var(--esp-1) 0; }
```

`.chip` ainda não existe em `styles.css`; acrescentar:
```css
.chip { border:1px solid var(--line); border-radius:999px; padding:4px 10px; background:transparent; color:var(--ink); font-size:13px; cursor:pointer; }
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test` → PASS.

- [ ] **Step 7: Conferir no navegador** (http://localhost:4180)

1. **Personalizar** liga o modo; clicar num hábito dentro do cartão não marca nada.
2. ↑ ↓ ← → movem o cartão e o foco continua no botão (apertar Enter repetidas vezes move de novo).
3. Arrastar Caixa de entrada para a coluna da esquerda, entre Hábitos e Para fazer agora: fica ali.
4. Largura inteira em Para fazer agora: vira faixa própria, quebrando as colunas.
5. Opções de Para fazer agora: mudar "Quantos mostrar" para 1 — o popover continua aberto e a lista encolhe ao Concluir.
6. Esconder Para revisar; ele aparece em "Cartões escondidos"; clicar traz de volta no mesmo lugar.
7. Colunas 3 → 1 → 2.
8. Restaurar padrão pede o segundo clique e volta ao início.
9. Opções do painel `word-count` (só depois da Task 7 terá opção; aqui conferir que ele move e esconde).
10. Recarregar a página: tudo como foi deixado (`dev-vault/.kiro/hoje.json` atualizado).
11. Ir para Notas no meio da edição e voltar: modo desligado.
12. Console sem erros.

- [ ] **Step 8: Commit**

```bash
git add app.js styles.css
git commit -m "Hoje: modo Personalizar com arraste, setas, largura, opções e escondidos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Aba "Hoje" nas Configurações

**Files:**
- Modify: `app.js` — `ABAS_CFG` (~3568), `showSettings` (~3631-3700), esqueleto `conteudoDaAbaHoje` (Task 4)
- Modify: `styles.css` (fim)

**Interfaces:**
- Consumes: `catalogoDaHoje`, `layoutDaHoje`, `mudarHoje`, `popoverDeOpcoes`, `acaoDaHoje` e os ouvintes globais de `[data-hoje-acao]`/`[data-hoje-opcao]` (Tasks 4 e 5).
- Produces: `conteudoDaAbaHoje() → html` dentro de `#cfg-hoje`; atributos `data-hoje-visivel`, `data-hoje-coluna-cfg`, `data-hoje-largura-cfg`.

- [ ] **Step 1: Registrar a aba**

`ABAS_CFG`: acrescentar `['hoje', 'Hoje', 'hoje']` logo depois de `['personalizacao', …]`.

Em `showSettings`, depois de `${painel('personalizacao', …)}`, acrescentar:
```js
    ${painel('hoje', `<div id="cfg-hoje">${conteudoDaAbaHoje()}</div>`)}
```

- [ ] **Step 2: Conteúdo da aba**

Substituir o esqueleto `conteudoDaAbaHoje`:

```js
// Mesma lista da Hoje, em linhas: cada controle chama KiroHoje por mudarHoje, que redesenha as duas telas.
function conteudoDaAbaHoje() {
  const catalogo = catalogoDaHoje(), l = layoutDaHoje(catalogo), porId = new Map(catalogo.map(c => [c.id, c]));
  const linhas = l.cartoes.filter(c => porId.has(c.id)).map(cartao => {
    const c = porId.get(cartao.id), visivel = !l.ocultos.includes(c.id), id = escapeHtml(c.id);
    const colunas = Array.from({ length: l.colunas }, (_, i) => `<option value="${i}" ${i === Math.min(cartao.coluna, l.colunas - 1) ? 'selected' : ''}>Coluna ${i + 1}</option>`).join('');
    return `<div class="cfg-linha hoje-cfg-linha" data-hoje-id="${id}">
      <label class="hoje-cfg-visivel"><input type="checkbox" data-hoje-visivel ${visivel ? 'checked' : ''} /><span class="cfg-texto"><span class="cfg-titulo">${escapeHtml(c.titulo)}</span><span class="small-muted">${escapeHtml(c.origem)}</span></span></label>
      <span class="hoje-cfg-controles">
        ${botaoDaHoje('subir', '↑', `Subir ${escapeHtml(c.titulo)}`)}${botaoDaHoje('descer', '↓', `Descer ${escapeHtml(c.titulo)}`)}
        <select data-hoje-coluna-cfg aria-label="Coluna de ${escapeHtml(c.titulo)}" ${cartao.largura === 'inteira' ? 'disabled' : ''}>${colunas}</select>
        <select data-hoje-largura-cfg aria-label="Largura de ${escapeHtml(c.titulo)}"><option value="normal" ${cartao.largura === 'normal' ? 'selected' : ''}>Normal</option><option value="inteira" ${cartao.largura === 'inteira' ? 'selected' : ''}>Inteira</option></select>
        ${popoverDeOpcoes(c, l, 'cfg', catalogo.indexOf(c))}
      </span>
    </div>`;
  }).join('');
  return `<section class="cfg-grupo">
    <header class="cfg-grupo-topo"><span class="cfg-texto"><span class="cfg-titulo">Tela Hoje</span><span class="small-muted">Quais cartões aparecem, em que ordem e onde. Também dá para arrumar direto na Hoje, em Personalizar.</span></span><button type="button" class="secondary cfg-pequeno" data-hoje-acao="restaurar">${icone('recarregar')} Restaurar padrão</button></header>
    <div class="cfg-linha">${'<span class="cfg-texto"><span class="cfg-titulo">Colunas</span></span>'}<span class="hoje-colunas-escolha">${[1, 2, 3].map(n => `<button type="button" class="chip" data-hoje-acao="colunas" data-valor="${n}" aria-pressed="${n === l.colunas}">${n}</button>`).join('')}</span></div>
    ${linhas}
    <p class="small-muted cfg-rodape">Guardado em <code>.kiro/hoje.json</code>, dentro do cofre.</p>
  </section>`;
}
```

- [ ] **Step 3: Controles da aba**

No ouvinte global de `change` da Task 5, antes do `const campo = …`, acrescentar:

```js
  const linha = e.target.closest?.('.hoje-cfg-linha');
  if (linha && e.target.matches('[data-hoje-visivel], [data-hoje-coluna-cfg], [data-hoje-largura-cfg]')) {
    e.stopPropagation();
    const id = linha.dataset.hojeId, alvo = e.target;
    if (alvo.matches('[data-hoje-visivel]')) mudarHoje(l => alvo.checked ? KiroHoje.mostrar(l, id) : KiroHoje.esconder(l, id));
    else if (alvo.matches('[data-hoje-coluna-cfg]')) mudarHoje(l => KiroHoje.mover(l, id, { coluna: Number(alvo.value) }));
    else mudarHoje(l => KiroHoje.definirLargura(l, id, alvo.value));
    document.querySelector(`#cfg-hoje [data-hoje-id="${CSS.escape(id)}"] ${alvo.matches('[data-hoje-visivel]') ? '[data-hoje-visivel]' : alvo.matches('[data-hoje-coluna-cfg]') ? '[data-hoje-coluna-cfg]' : '[data-hoje-largura-cfg]'}`)?.focus();
    return;
  }
```

Os botões ↑ ↓, colunas e Restaurar já funcionam pelo ouvinte de `click` da Task 5 (`[data-hoje-acao]`). Ajustar o foco em `acaoDaHoje`: o seletor usa `document.querySelector`, que acha primeiro o botão na Hoje (atrás do modal). Trocar por:
```js
  const raiz = botao?.closest('#cfg-hoje') || document;
  raiz.querySelector(seletor)?.focus();
```

- [ ] **Step 4: CSS** (fim de `styles.css`)

```css
.hoje-cfg-linha { gap:var(--esp-3); flex-wrap:wrap; }
.hoje-cfg-visivel { display:flex; align-items:center; gap:var(--esp-3); flex:1 1 220px; min-width:0; }
.hoje-cfg-controles { display:flex; align-items:center; gap:var(--esp-2); flex-wrap:wrap; }
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test` → PASS.

- [ ] **Step 6: Conferir no navegador**

1. Configurações → aba **Hoje** aparece com ícone, lista na ordem do layout.
2. Desmarcar Hábitos: some da Hoje atrás do modal; marcar de novo: volta.
3. ↑ ↓ reordenam e o foco fica no botão dentro do modal.
4. Coluna e largura pelos seletores; largura inteira desabilita o seletor de coluna.
5. Opções abre o popover por cima do modal; mudar "Quantos mostrar" atualiza a Hoje.
6. Colunas 1/2/3 e Restaurar padrão (dois cliques).
7. Fechar o modal não pergunta se quer descartar alterações.
8. Com a Hoje em Personalizar, mudar algo nas Configurações: a Hoje (atrás) acompanha.
9. Console sem erros.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "Configurações: aba Hoje com cartões, colunas, largura e opções

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Exemplo `word-count` com opção e documentação

**Files:**
- Modify: `examples/plugins/word-count/index.js`
- Modify: `docs/plugins.md` (seção `### kiro.panel` ~linha 135 e `## Panels` ~linha 407)
- Test: `tests/plugins.test.cjs`

**Interfaces:**
- Consumes: `KiroPlugins.validarOpcoesDoPainel` (Task 2); `render` recebe `{ action, values, options }` (Task 4).

- [ ] **Step 1: Escrever o teste** (fim de `tests/plugins.test.cjs`)

```js
test('exemplo word-count: o painel declara a opção limit e a respeita', async () => {
  const { pathToFileURL } = require('node:url');
  const arquivo = require('node:path').join(__dirname, '..', 'examples', 'plugins', 'word-count', 'index.js');
  const plugin = (await import(pathToFileURL(arquivo))).default;
  const paineis = [];
  const notas = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, title: `Nota ${i}`, body: 'palavra '.repeat(i + 1) }));
  await plugin.activate({
    command() {}, block() {}, notify() {},
    notes: { list: async () => notas, current: async () => null },
    panel: (id, label, render, extra) => paineis.push({ id, render, extra }),
  });
  const painel = paineis.find(p => p.id === 'longest');
  const v = P.validarOpcoesDoPainel(painel.extra?.options, painel.extra?.width);
  assert.equal(v.ok, true, v.erro);
  assert.deepEqual(v.opcoes.map(o => o.key), ['limit']);
  assert.equal((await painel.render({ action: '', values: {}, options: { limit: 3 } })).items.length, 3);
  assert.equal((await painel.render({ action: '', values: {}, options: { limit: 5 } })).items[0].title, 'Nota 7');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/plugins.test.cjs`
Expected: FAIL (`painel.extra` indefinido → `v.opcoes` vazio, `['limit']` esperado).

- [ ] **Step 3: Atualizar o exemplo**

Em `examples/plugins/word-count/index.js`, trocar o bloco do `kiro.panel` por:

```js
    // A panel returns data, never HTML: Kiro draws it with the current theme.
    // render() runs again every time the panel is refreshed, an action fires or
    // the user changes one of the panel's options. Options are declared below and
    // Kiro draws their form; render gets the current values in `options`.
    kiro.panel('longest', 'Longest notes', async ({ options } = {}) => {
      const notes = await kiro.notes.list({ limit: 50 });
      const ranked = notes
        .map(note => ({ note, count: words(note.body) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, options?.limit ?? 5);
      return {
        type: 'list',
        items: ranked.map(({ note, count }) => ({
          title: note.title,
          detail: `${count} words`,
          // "open:<noteId>" is reserved by Kiro: it opens that note.
          action: `open:${note.id}`,
        })),
      };
    }, {
      options: [{ key: 'limit', type: 'number', label: 'How many notes', default: 5, min: 1, max: 20 }],
    });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/plugins.test.cjs` → PASS. Depois `npm test` → PASS.

- [ ] **Step 5: Documentação**

Em `docs/plugins.md`, trocar o título e o primeiro parágrafo de `### kiro.panel(id, label, render)` por:

```markdown
### kiro.panel(id, label, render, { options, width })

Adds a card to the Today screen. `render` returns a panel description (see
below) — data, never HTML. It runs on load, on refresh, after every action the
user triggers inside the panel, and after the user changes one of the panel's
options, receiving `{ action, values, options }`.

The user decides where the card goes: they can hide it, move it between
columns and make it full width, from Today → Customize or Settings → Today.
`width: 'full'` is only the starting suggestion. See [Panel options](#panel-options).
```

E, logo antes de `## Blocks`, acrescentar:

````markdown
## Panel options

Declare the settings your panel needs and Kiro draws the form for them — in the
card's options popover on Today and in Settings → Today. You never build a
settings screen. `render` receives the current values in `options`, always
complete (defaults filled in).

```js
kiro.panel('longest', 'Longest notes', async ({ options }) => {
  /* use options.limit, options.folder, … */
}, {
  options: [
    { key: 'limit', type: 'number', label: 'How many', default: 5, min: 1, max: 20 },
    { key: 'folder', type: 'select', label: 'Folder', default: 'all', choices: ['all', 'work'] },
    { key: 'showDates', type: 'boolean', label: 'Show dates', default: true },
    { key: 'heading', type: 'text', label: 'Heading', default: '' },
  ],
  width: 'full',   // optional: 'normal' (default) or 'full'
});
```

| Field | Rule |
|---|---|
| `key` | `a-z` first, then letters and digits, up to 32 characters, unique |
| `type` | `boolean`, `number`, `select` or `text` |
| `label` | 1–40 characters |
| `default` | Required, of the option's type; `number` between `min` and `max` (both optional); `select` one of `choices`; `text` up to 80 characters |
| `choices` | `select` only: 1–20 strings of up to 40 characters |

Up to 12 options per panel. If the declaration is invalid, the card shows the
error instead of your panel and has no options; the rest of the plugin keeps
working. Values are stored in the vault (`.kiro/hoje.json`); a stored value that
no longer fits your declaration (you changed it in a new version) falls back to
the default.
````

- [ ] **Step 6: Conferir no navegador**

`npm run dev:reset` não é necessário: o `dev` copia os exemplos só se não existirem. Copiar o novo `index.js` para `dev-vault/.kiro/plugins/word-count/index.js` e recarregar. Na Hoje → Personalizar → Opções de "Longest notes": mudar "How many notes" para 2 → o cartão mostra 2 notas.

- [ ] **Step 7: Commit**

```bash
git add examples/plugins/word-count/index.js docs/plugins.md tests/plugins.test.cjs
git commit -m "Plug-ins: opções de painel no exemplo word-count e na documentação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Especificação alinhada e grafo atualizado

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-hoje-configuravel-design.md`

- [ ] **Step 1: Registrar na especificação os ajustes da seção "Ajustes à especificação" deste plano**

Acrescentar ao fim da especificação:

```markdown
## Ajustes feitos ao planejar

- `padrao(catalogo)` = `reconciliar(vazio, catalogo)`; cartões de plug-in entram na coluna com menos cartões visíveis.
- Métodos do `Vault` em inglês, como o resto do arquivo: `readHomeLayout` / `writeHomeLayout`.
- `KiroPlugins.validarOpcoesDoPainel(options, width)`.
- Nas Configurações, as opções abrem no mesmo popover da Hoje.
- "Restaurar padrão" confirma com um segundo clique no próprio botão.
- Cabeçalho da Hoje: data como sobretítulo e saudação como título; a frase é o cartão `nativo:frase`.
```

- [ ] **Step 2: Suíte completa**

Run: `npm test`
Expected: PASS, sem falhas.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-23-hoje-configuravel-design.md
git commit -m "Especificação: ajustes da Hoje configurável decididos no plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Atualizar o grafo**

Rodar `/graphify . --update` e atualizar os números em `CLAUDE.md` e `AGENTS.md` se mudarem (commit separado).
