# Idiomas e corretor — etapa 1 — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interface do Kiro em português do Brasil ou inglês, escolhida nas Configurações, e corretor ortográfico (português + inglês juntos) com ligar/desligar e sugestões no menu do botão direito.

**Architecture:** Um módulo puro `idiomas.js` (UMD, como `hoje.js`) guarda o idioma atual e traduz com `t('frase em português')`; cada idioma é um arquivo `idiomas/<código>.js` que mapeia a frase em português para a tradução, carregado só quando escolhido. O corretor é o do Chromium: o processo principal ativa `pt-BR` + `en-US` depois que a página carrega, liga/desliga por IPC e devolve à página a palavra errada e as sugestões no botão direito; um módulo puro `corretor.js` monta esses itens do menu.

**Tech Stack:** JavaScript sem build (scripts clássicos no navegador, CommonJS no Node), Electron 44, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-idiomas-e-corretor-design.md`

## Global Constraints

- Idiomas desta etapa: `pt-BR` (padrão, sem arquivo) e `en`. Códigos exatos: `'pt-BR'`, `'en'`. `locale()`: `'pt-BR'` e `'en-US'`.
- Corretor: `['pt-BR', 'en-US']` sempre ativos juntos; sem ajuste por idioma.
- Preferências no `localStorage`: `kiro.idioma` (código) e `kiro.corretor` (`'0'` = desligado; ausente ou qualquer outro valor = ligado). Todo acesso ao `localStorage` dentro de `try { } catch { }`, como o resto do `app.js`.
- Ficam em português: `agent/`, `mcp/`, logs do servidor, `docs/`, plug-ins de exemplo.
- Nenhuma dependência nova; nenhuma etapa de build. Arquivos novos de navegador no formato UMD de `hoje.js`.
- Código, nomes e comentários em português, no estilo do arquivo que se edita.
- Commits no estilo do repositório (`Idiomas: …`), terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` passa ao fim de cada task.

### Regras de tradução (valem para toda task que troca texto por `t()`)

1. Texto que a pessoa vê vira `t('frase exata em português')`. Isso inclui conteúdo de elementos, `title`, `placeholder`, `aria-label`, `alt` com texto, `confirm()`, `alert()`, `prompt()`, `status(...)`, `modal('Título', …)` e rótulos de menu (`rotulo:`).
2. **Nunca** template literal dentro de `t()` ou `frase()`. Partes variáveis viram marcadores: `` `Ir para "${destino.alvo}"` `` → `t('Ir para "{alvo}"', { alvo: destino.alvo })`. O teste de cobertura falha com `` t(` ``.
3. Texto guardado em constante no topo do arquivo (listas como `ABAS_CFG`, `SKINS`, `DETALHES`) é avaliado antes do idioma carregar: marque na declaração com `frase('…')` (não traduz, só registra) e traduza no uso com `t(rotulo)`.
4. HTML fica fora da frase: `'<p>A lixeira está vazia.</p>'` → `` `<p>${t('A lixeira está vazia.')}</p>` ``. `escapeHtml` continua onde já estava; `t()` não escapa nada.
5. Plural: mantenha o `?:` que já existe, cada ramo com a própria frase: `n === 1 ? t('1 nota') : t('{n} notas', { n })`.
6. Não traduza: nomes de arquivo, chaves, ids, classes CSS, atalhos (`Ctrl+O`), a marca `Kiro`, sintaxe Markdown (`**`, `[[`), textos que vão para o cofre como dado (exceto o título padrão de nota nova, que usa `t('Sem título')`), mensagens de `console.*`.
7. Cada frase nova entra em `idiomas/en.js`, na seção com o comentário do arquivo de origem (`// app.js — …`). Mesma frase usada em vários lugares: uma entrada só.
8. Glossário do inglês (use sempre o mesmo termo): cofre → vault · nota → note · pasta → folder · nota diária / Diária → daily note / Daily · Hoje → Today · Caixa de entrada → Inbox · Lixeira → Trash · etiqueta → tag · tarefa → task · hábito → habit · Grafo → Graph · Fluxo → Flow · cartão → card · anexo → attachment · Configurações → Settings · Aparência → Appearance · Papel de parede → Wallpaper · tema → theme · skin → skin · plug-in → plugin · permissão → permission · chave (de API) → key · Mencionada em → Mentioned in · Restaurar → Restore · Arquivar → Archive. Inglês de interface: curto, frases no imperativo em botões ("Open folder"), sentence case ("Open trash", não "Open Trash").
9. Depois de trocar os textos, rode `npm test` (o teste de cobertura aponta frase faltando, sobrando ou com marcador diferente) e confira no navegador, em inglês, a área que mudou.

## Review Focus

- Valor de marcador que contém chaves (nota chamada `{quando}`) — o texto final mostra o título literal, sem substituir de novo. Teste na Task 2.
- Frase igual a um nome de `Object.prototype` (`'constructor'`, `'toString'`) — `t()` devolve a própria frase, nunca uma função. Teste na Task 2.
- Trocar de idioma com uma nota aberta e alterações não salvas — o texto digitado continua lá (a troca usa o mesmo `render()` que o salvamento já chama com a nota aberta). Verificação manual na Task 3, passo final.
- `localStorage` indisponível (janela privada) ou com código desconhecido em `kiro.idioma` — o app abre no idioma do sistema, sem erro. Teste de `escolherIdioma` na Task 2.
- A página manda ao processo principal uma "palavra" gigante, com quebra de linha ou que não é texto — o principal ignora. Teste de `palavraValida`/`palavraParaDicionario` na Task 2 e inspeção na Task 4.

---

### Task 0: Medição de referência (feita por quem coordena, não por um subagente)

**Files:** nenhum arquivo do projeto muda.

- [ ] **Step 1: Subir o modo de desenvolvimento**

Run: `npm run dev` (em segundo plano; abre `http://127.0.0.1:4180` com o `dev-vault`).

- [ ] **Step 2: Medir com o navegador automatizado (skill `browser-automation`)**

Abra `http://127.0.0.1:4180`, espere o status "Cofre atualizado" e avalie na página:

```js
(() => {
  const medir = vista => { currentView = vista; const t0 = performance.now(); for (let i = 0; i < 20; i++) render(); return +((performance.now() - t0) / 20).toFixed(2); };
  const r = { hoje: medir('today'), notas: medir('notes'), pastas: medir('studies'), abertura: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd) };
  currentView = 'today'; render();
  return r;
})()
```

Repita 3 vezes e anote a mediana de cada número no fim deste plano, em "Medições". Pare o servidor.

---

### Task 1: Spike — dicionários do corretor sem rede

Pergunta: no Windows, o Electron 44 usa o corretor do sistema ou baixa dicionários Hunspell? Se baixa, ele aceita `.bdic` copiados de antemão para `userData/Dictionaries` sem tentar a rede?

**Files:**
- Create (só no rascunho, fora do repositório): `<scratchpad>/spike-corretor/main.cjs`
- Create (se o caminho (a) abaixo valer): `dicionarios/*.bdic`, `dicionarios/LEIA-ME.txt`

- [ ] **Step 1: Escrever o script do spike no rascunho**

```js
// <scratchpad>/spike-corretor/main.cjs — rodar com: npx electron <scratchpad>/spike-corretor/main.cjs [--offline]
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const offline = process.argv.includes('--offline');
app.setPath('userData', path.join(__dirname, offline ? 'perfil-offline' : 'perfil'));
app.whenReady().then(async () => {
  const s = session.defaultSession;
  if (offline) {
    // Copia os .bdic baixados na rodada online e corta a rede do download.
    const origem = path.join(__dirname, 'perfil', 'Dictionaries'), destino = path.join(app.getPath('userData'), 'Dictionaries');
    fs.mkdirSync(destino, { recursive: true });
    for (const f of fs.readdirSync(origem)) fs.copyFileSync(path.join(origem, f), path.join(destino, f));
    s.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
  }
  console.log('disponíveis:', s.availableSpellCheckerLanguages.filter(l => /^(pt|en)/.test(l)).join(', '));
  for (const ev of ['spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure', 'spellcheck-dictionary-initialized'])
    s.on(ev, (_e, lingua) => console.log(ev, lingua));
  s.setSpellCheckerLanguages(['pt-BR', 'en-US']);
  const w = new BrowserWindow({ width: 600, height: 200 });
  w.webContents.on('context-menu', (_e, p) => { console.log('palavra:', p.misspelledWord, 'sugestões:', p.dictionarySuggestions); });
  await w.loadURL('data:text/html,<textarea id=a style="font:20px monospace;width:560px" autofocus>casa errrado house wrongg</textarea>');
  setTimeout(() => {
    // Botão direito sobre "errrado" (x ≈ 90 px com a fonte de 20 px monoespaçada).
    w.webContents.sendInputEvent({ type: 'mouseDown', x: 90, y: 16, button: 'right', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x: 90, y: 16, button: 'right', clickCount: 1 });
  }, 5000);
  setTimeout(() => { console.log('Dictionaries:', fs.existsSync(path.join(app.getPath('userData'), 'Dictionaries')) ? fs.readdirSync(path.join(app.getPath('userData'), 'Dictionaries')).join(', ') : '(nenhuma pasta)'); app.quit(); }, 8000);
});
```

- [ ] **Step 2: Rodar online e anotar**

Run: `npx electron "<scratchpad>/spike-corretor/main.cjs"`
Anote: idiomas disponíveis; se houve `download-begin`/`success`; a palavra e as sugestões do botão direito; os arquivos em `Dictionaries`. Se o clique não cair sobre a palavra, ajuste `x` até `palavra: errrado` aparecer.

- [ ] **Step 3: Rodar offline e anotar**

Run: `npx electron "<scratchpad>/spike-corretor/main.cjs" --offline`
Esperado para o caminho (a): nenhum `download-begin`, `initialized` para os dois idiomas e `palavra: errrado` com sugestões.

- [ ] **Step 4: Decidir e registrar**

- **(a) Baixou online e funcionou offline com a cópia:** copie os `.bdic` de `perfil/Dictionaries` para `dicionarios/` no repositório. Crie `dicionarios/LEIA-ME.txt` com: origem (`https://chromium.googlesource.com/chromium/deps/hunspell_dictionaries/`), nome de cada arquivo e o aviso de licença de cada dicionário copiado dos `README_*.txt` desse repositório (pt_BR: VERO; en_US: SCOWL). Commit: `Idiomas: dicionários do corretor (pt-BR e en-US) embutidos`.
- **(b) Nenhum download e o corretor funcionou (corretor do Windows):** não crie `dicionarios/`. A Task 4 funciona igual (a cópia é pulada quando a pasta não existe).
- **(c) Offline não funcionou:** PARE e reporte a quem coordena: pela spec, a decisão volta para o dono (ficaria o download do Google).

Escreva a conclusão (a/b/c, nomes dos arquivos, tamanhos) no relatório da task.

---

### Task 2: Módulos puros `idiomas.js` e `corretor.js`

**Files:**
- Create: `idiomas.js`
- Create: `corretor.js`
- Test: `tests/idiomas.test.cjs`

**Interfaces:**
- Produces (`KiroIdiomas`, no navegador em `globalThis.KiroIdiomas`; no Node por `require('../idiomas.js')`):
  - `PADRAO: 'pt-BR'`
  - `IDIOMAS: Array<{ codigo: string, nome: string, locale: string }>` — `[{ codigo: 'pt-BR', nome: 'Português', locale: 'pt-BR' }, { codigo: 'en', nome: 'English', locale: 'en-US' }]`
  - `t(frase: string, valores?: object): string`
  - `frase(f: string): string` — identidade; só marca a frase para o teste de cobertura
  - `idioma(): string` · `locale(): string`
  - `definirIdioma(codigo: string): string` — código efetivo (desconhecido → `'pt-BR'`)
  - `registrar(codigo: string, frases: object): void`
  - `carregar(codigo: string, importar?: (codigo) => Promise<void>): Promise<void>` — em `pt-BR`, desconhecido ou já registrado resolve sem importar; no navegador o padrão insere `<script src="idiomas/<codigo>.js">`
  - `detectar(preferido: string): string` — `'en-GB'` → `'en'`; `'pt-PT'` → `'pt-BR'`; outro → `'pt-BR'`
  - `escolherIdioma(salvo: string|null, doSistema: string): string` — salvo válido vence; senão `detectar(doSistema)`
  - `formatarData(data: Date, opcoes: object): string` — `Intl.DateTimeFormat` guardado por idioma + opções
  - `comparar(a: string, b: string): number` — `Intl.Collator(locale(), { numeric: true })` guardado por idioma
- Produces (`KiroCorretor`, mesmo formato UMD):
  - `itensDoCorretor(dados: { palavra?: string, sugestoes?: string[] }, acoes: { trocar(s), adicionar(p), t(f, v) }): Array<item de menu>` — `[]` sem palavra; senão até 5 sugestões (ou "Sem sugestões" desabilitado) e "Adicionar "{palavra}" ao dicionário". Sem separador no fim (quem junta põe).
  - `palavraValida(v): boolean` — texto de 1 a 100 caracteres, sem `\r`/`\n`
  - `palavraParaDicionario(v): boolean` — `palavraValida` e sem espaço

- [ ] **Step 1: Escrever os testes**

```js
// tests/idiomas.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../idiomas.js');
const C = require('../corretor.js');

const EN = { 'Sem título': 'Untitled', 'editada {quando}': 'edited {quando}', 'Olá, {nome}': 'Hi, {nome}' };
test.beforeEach(() => { I.registrar('en', EN); I.definirIdioma('pt-BR'); });

test('em português t() devolve a própria frase, com os marcadores trocados', () => {
  assert.equal(I.t('Sem título'), 'Sem título');
  assert.equal(I.t('editada {quando}', { quando: 'ontem' }), 'editada ontem');
});

test('em inglês t() traduz; sem tradução, cai no português', () => {
  I.definirIdioma('en');
  assert.equal(I.t('Sem título'), 'Untitled');
  assert.equal(I.t('Olá, {nome}', { nome: 'Ana' }), 'Hi, Ana');
  assert.equal(I.t('Frase que ninguém traduziu'), 'Frase que ninguém traduziu');
});

test('valor com chaves não é substituído de novo', () => {
  I.definirIdioma('en');
  assert.equal(I.t('editada {quando}', { quando: '{nome}' }), 'edited {nome}');
});

test('marcador sem valor fica como está', () => {
  assert.equal(I.t('Olá, {nome}', {}), 'Olá, {nome}');
});

test('frase com nome de Object.prototype não vira função', () => {
  I.definirIdioma('en');
  assert.equal(I.t('constructor'), 'constructor');
  assert.equal(I.t('toString'), 'toString');
});

test('frase() só marca: devolve a entrada', () => {
  assert.equal(I.frase('Aparência'), 'Aparência');
});

test('código desconhecido cai no padrão', () => {
  assert.equal(I.definirIdioma('xx'), 'pt-BR');
  assert.equal(I.idioma(), 'pt-BR');
  assert.equal(I.locale(), 'pt-BR');
  I.definirIdioma('en');
  assert.equal(I.locale(), 'en-US');
});

test('detectar e escolherIdioma: salvo válido vence, senão o sistema, senão português', () => {
  assert.equal(I.detectar('en-GB'), 'en');
  assert.equal(I.detectar('EN'), 'en');
  assert.equal(I.detectar('pt-PT'), 'pt-BR');
  assert.equal(I.detectar('ja-JP'), 'pt-BR');
  assert.equal(I.detectar(undefined), 'pt-BR');
  assert.equal(I.escolherIdioma('en', 'pt-BR'), 'en');
  assert.equal(I.escolherIdioma('xx', 'en-US'), 'en');
  assert.equal(I.escolherIdioma(null, 'fr-FR'), 'pt-BR');
});

test('carregar: português e idioma já registrado não importam nada; o resto importa uma vez', async () => {
  const pedidos = [];
  const importar = async codigo => { pedidos.push(codigo); };
  await I.carregar('pt-BR', importar);
  await I.carregar('en', importar);            // já registrado no beforeEach
  await I.carregar('xx', importar);            // desconhecido
  assert.deepEqual(pedidos, []);
});

test('carregar: idioma ainda não registrado chama o importador; a falha dele chega a quem pediu', async () => {
  delete require.cache[require.resolve('../idiomas.js')];
  const limpo = require('../idiomas.js');   // instância nova, sem 'en' registrado
  const pedidos = [];
  await limpo.carregar('en', async codigo => { pedidos.push(codigo); });
  assert.deepEqual(pedidos, ['en']);
  await assert.rejects(limpo.carregar('en', async () => { throw new Error('falhou'); }), /falhou/);
});

test('formatarData e comparar seguem o idioma e o cache é refeito na troca', () => {
  const data = new Date('2026-09-28T12:00:00');
  const opcoes = { day: 'numeric', month: 'long' };
  assert.equal(I.formatarData(data, opcoes), '28 de setembro');
  I.definirIdioma('en');
  assert.equal(I.formatarData(data, opcoes), 'September 28');
  assert.ok(I.comparar('Nota 2', 'Nota 10') < 0, 'numérico');
  I.definirIdioma('pt-BR');
  assert.ok(I.comparar('ábaco', 'bola') < 0, 'acento não joga para o fim');
});

test('itensDoCorretor: sem palavra, nada; com palavra, sugestões e adicionar', () => {
  const feito = [];
  const acoes = { trocar: s => feito.push(['trocar', s]), adicionar: p => feito.push(['adicionar', p]), t: I.t };
  assert.deepEqual(C.itensDoCorretor({ palavra: '' }, acoes), []);
  assert.deepEqual(C.itensDoCorretor(null, acoes), []);
  const itens = C.itensDoCorretor({ palavra: 'errrado', sugestoes: ['errado', 'errada', 'erro', 'ferrado', 'serrado', 'aterrado'] }, acoes);
  assert.deepEqual(itens.map(i => i.rotulo), ['errado', 'errada', 'erro', 'ferrado', 'serrado', 'Adicionar "errrado" ao dicionário']);
  itens[0].acao(); itens[5].acao();
  assert.deepEqual(feito, [['trocar', 'errado'], ['adicionar', 'errrado']]);
});

test('itensDoCorretor: sem sugestões mostra um item desabilitado; lixo na lista é ignorado', () => {
  const acoes = { trocar() {}, adicionar() {}, t: I.t };
  const itens = C.itensDoCorretor({ palavra: 'xyzq', sugestoes: [null, '', 3] }, acoes);
  assert.equal(itens[0].rotulo, 'Sem sugestões');
  assert.equal(itens[0].ativo(), false);
  assert.equal(itens.length, 2);
});

test('palavraValida e palavraParaDicionario recusam o que não é palavra curta', () => {
  assert.equal(C.palavraValida('errado'), true);
  assert.equal(C.palavraValida('a gente'), true);
  assert.equal(C.palavraValida(''), false);
  assert.equal(C.palavraValida('x'.repeat(101)), false);
  assert.equal(C.palavraValida('duas\nlinhas'), false);
  assert.equal(C.palavraValida(42), false);
  assert.equal(C.palavraParaDicionario('Kiro'), true);
  assert.equal(C.palavraParaDicionario('a gente'), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/idiomas.test.cjs`
Expected: FAIL com `Cannot find module '../idiomas.js'`.

- [ ] **Step 3: Escrever `idiomas.js`**

```js
// Idioma da interface: só o modelo, sem DOM. A frase em português é a chave: cada idioma
// registra { 'frase em português': 'tradução' } (idiomas/<código>.js) e t() devolve a
// tradução ou, sem ela, a própria frase. Roda no navegador (KiroIdiomas) e no Node (testes
// e processo principal do Electron).
(function (root) {
  const PADRAO = 'pt-BR';
  const IDIOMAS = [
    { codigo: 'pt-BR', nome: 'Português', locale: 'pt-BR' },
    { codigo: 'en', nome: 'English', locale: 'en-US' },
  ];
  const tabelas = new Map();        // código → Map(frase → tradução)
  let atual = PADRAO, tabela = null;
  let formatadores = new Map(), comparador = null;

  const suportado = codigo => IDIOMAS.some(i => i.codigo === codigo);
  const base = codigo => codigo.toLowerCase().split('-')[0];
  // Idioma do sistema → código suportado: exato ('en') ou pela língua ('en-GB' → 'en').
  function detectar(preferido) {
    const p = String(preferido || '').toLowerCase();
    const exato = IDIOMAS.find(i => i.codigo.toLowerCase() === p);
    if (exato) return exato.codigo;
    return IDIOMAS.find(i => base(i.codigo) === base(p))?.codigo || PADRAO;
  }
  const escolherIdioma = (salvo, doSistema) => (suportado(salvo) ? salvo : detectar(doSistema));

  function registrar(codigo, frases) {
    tabelas.set(codigo, new Map(Object.entries(frases)));
    if (codigo === atual) tabela = tabelas.get(codigo);
  }
  function definirIdioma(codigo) {
    const novo = suportado(codigo) ? codigo : PADRAO;
    if (novo !== atual) { formatadores = new Map(); comparador = null; }
    atual = novo;
    tabela = novo === PADRAO ? null : tabelas.get(novo) || null;
    return atual;
  }
  const idioma = () => atual;
  const locale = () => IDIOMAS.find(i => i.codigo === atual).locale;

  // Uma passada só: o valor de um marcador nunca é lido como outro marcador.
  function t(frase, valores) {
    const texto = (tabela && tabela.get(frase)) || frase;
    return valores ? texto.replace(/\{(\w+)\}/g, (marca, nome) => (Object.hasOwn(valores, nome) ? String(valores[nome]) : marca)) : texto;
  }
  // Marca a frase para o teste de cobertura sem traduzir agora (listas avaliadas antes do idioma carregar).
  const frase = f => f;

  function carregarScript(codigo) {
    return new Promise((ok, falha) => {
      const script = document.createElement('script');
      script.src = `idiomas/${codigo}.js`;
      script.onload = () => ok();
      script.onerror = () => falha(new Error('Não foi possível carregar o idioma'));
      document.head.appendChild(script);
    });
  }
  // Em português não há arquivo; os outros idiomas são lidos uma vez, só quando escolhidos.
  async function carregar(codigo, importar = carregarScript) {
    if (codigo === PADRAO || !suportado(codigo) || tabelas.has(codigo)) return;
    await importar(codigo);
  }

  // Criar um Intl.DateTimeFormat ou um Collator custa caro: um por idioma (e por opções), refeitos na troca.
  function formatarData(data, opcoes) {
    const chave = JSON.stringify(opcoes);
    let formatador = formatadores.get(chave);
    if (!formatador) formatadores.set(chave, (formatador = new Intl.DateTimeFormat(locale(), opcoes)));
    return formatador.format(data);
  }
  function comparar(a, b) {
    if (!comparador) comparador = new Intl.Collator(locale(), { numeric: true });
    return comparador.compare(a, b);
  }

  const api = { PADRAO, IDIOMAS, t, frase, idioma, locale, definirIdioma, registrar, carregar, detectar, escolherIdioma, formatarData, comparar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroIdiomas = api;
})(globalThis);
```

- [ ] **Step 4: Escrever `corretor.js`**

```js
// Corretor ortográfico: os itens que entram no topo do menu do botão direito quando a palavra
// sob o clique está errada, e a validação do que a página manda ao processo principal.
// Só o modelo, sem DOM. Roda no navegador (KiroCorretor) e no Node (testes e main.cjs).
(function (root) {
  const MAX_SUGESTOES = 5;
  // Troca: texto curto numa linha só (sugestão pode ter espaço: "a gente").
  const palavraValida = v => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[\r\n]/.test(v);
  // Dicionário do usuário: uma palavra só.
  const palavraParaDicionario = v => palavraValida(v) && !/\s/.test(v);

  function itensDoCorretor(dados, { trocar, adicionar, t }) {
    const palavra = typeof dados?.palavra === 'string' ? dados.palavra : '';
    if (!palavra) return [];
    const sugestoes = (Array.isArray(dados.sugestoes) ? dados.sugestoes : []).filter(s => typeof s === 'string' && s).slice(0, MAX_SUGESTOES);
    return [
      ...(sugestoes.length ? sugestoes.map(s => ({ rotulo: s, acao: () => trocar(s) })) : [{ rotulo: t('Sem sugestões'), ativo: () => false }]),
      { rotulo: t('Adicionar "{palavra}" ao dicionário', { palavra }), acao: () => adicionar(palavra) },
    ];
  }

  const api = { itensDoCorretor, palavraValida, palavraParaDicionario };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroCorretor = api;
})(globalThis);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/idiomas.test.cjs`
Expected: PASS (todos).

- [ ] **Step 6: Suite inteira e commit**

Run: `npm test` — Expected: nenhum `fail`.

```bash
git add idiomas.js corretor.js tests/idiomas.test.cjs
git commit -m "Idiomas: módulos puros de tradução e do corretor"
```

---

### Task 3: Idioma na página — carregar, trocar e seletor nas Configurações

**Files:**
- Create: `idiomas/en.js`
- Create: `tests/idiomas-cobertura.test.cjs`
- Modify: `index.html` (scripts)
- Modify: `server.mjs:23` (`publicFiles`)
- Modify: `app.js` — topo do arquivo, `formatDate`/`dateLabel` (linhas ~21–22), `rotuloDoDia` (~150), datas da linha ~281, `byTitle` (~311), `destinosDePasta` (~1319), pastas e `quando` da lixeira (~3140, ~3156), hora do registro de rede (~4116), `iniciar()` (~4891), aba Sistema em `showSettings` (~4427), ligações da janela de Configurações (perto de `$('#cfg-mencoes')`, ~4495)

**Interfaces:**
- Consumes: tudo de `KiroIdiomas` (Task 2).
- Produces:
  - em `app.js`: `const { t, frase } = KiroIdiomas;` na primeira linha; `traduzirFixos()`; `trocarIdioma(codigo): Promise<void>`
  - `idiomas/en.js`: UMD que, no navegador, chama `KiroIdiomas.registrar('en', frases)` e, no Node, exporta `frases`
  - `tests/idiomas-cobertura.test.cjs`: a regra "toda frase usada existe em `en.js` e nada sobra"

- [ ] **Step 1: Teste de cobertura**

```js
// tests/idiomas-cobertura.test.cjs
// Toda frase passada a t() ou frase() — e todo texto visível do index.html — precisa estar em
// idiomas/en.js; nada pode sobrar lá; os marcadores {…} precisam bater.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const FONTES = ['app.js', 'fluxo-tela.js', 'corretor.js', 'domain.js', 'plugins.js', 'vault.cjs', 'electron/main.cjs', 'server.mjs', 'segredos-plugins.cjs', 'ligacao-rede-plugins.cjs', 'rede-plugins.cjs'];
const CHAMADA = /(?<![\w$.])(?:t|frase)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const TEMPLATE = /(?<![\w$.])(?:t|frase)\(\s*`/g;
const IGNORAR_NO_INDEX = new Set(['Kiro', 'Ctrl+O']);

function frasesDoCodigo() {
  const frases = new Map();   // frase → primeiro arquivo onde aparece
  for (const f of FONTES) {
    const codigo = ler(f);
    for (const m of codigo.matchAll(CHAMADA)) {
      const texto = m[2].replace(/\\(['"\\])/g, '$1');
      if (!frases.has(texto)) frases.set(texto, f);
    }
  }
  return frases;
}
function frasesDoIndex() {
  const corpo = ler('index.html').split('<body>')[1].split('<script')[0];
  const achadas = [
    ...[...corpo.matchAll(/>([^<>]+)</g)].map(m => m[1].trim()),
    ...[...corpo.matchAll(/(?:title|aria-label|alt)="([^"]+)"/g)].map(m => m[1].trim()),
  ];
  return achadas.filter(s => s && !IGNORAR_NO_INDEX.has(s));
}
const marcadores = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('nenhum t() ou frase() com template literal', () => {
  for (const f of FONTES) {
    const achado = [...ler(f).matchAll(TEMPLATE)];
    assert.equal(achado.length, 0, `${f}: use marcadores {nome}, não template literal, em t()/frase()`);
  }
});

test('inglês: toda frase usada existe, nada sobra, marcadores batem', () => {
  const en = require('../idiomas/en.js');
  const usadas = frasesDoCodigo();
  for (const s of frasesDoIndex()) if (!usadas.has(s)) usadas.set(s, 'index.html');
  const faltando = [...usadas].filter(([s]) => !Object.hasOwn(en, s)).map(([s, f]) => `${f}: ${s}`);
  assert.deepEqual(faltando, [], 'frases sem tradução em idiomas/en.js');
  const sobrando = Object.keys(en).filter(s => !usadas.has(s));
  assert.deepEqual(sobrando, [], 'frases em idiomas/en.js que o código não usa mais');
  const errados = Object.entries(en).filter(([pt, tr]) => marcadores(pt) !== marcadores(tr)).map(([pt]) => pt);
  assert.deepEqual(errados, [], 'marcadores {…} diferentes entre o português e a tradução');
  const vazias = Object.entries(en).filter(([, tr]) => typeof tr !== 'string' || !tr.trim()).map(([pt]) => pt);
  assert.deepEqual(vazias, [], 'tradução vazia');
});

test('a página carrega idiomas.js e corretor.js antes do app, e o servidor os entrega', () => {
  const index = ler('index.html');
  assert.ok(index.indexOf('src="idiomas.js"') > -1 && index.indexOf('src="idiomas.js"') < index.indexOf('src="app.js"'));
  assert.ok(index.indexOf('src="corretor.js"') > -1 && index.indexOf('src="corretor.js"') < index.indexOf('src="app.js"'));
  const servidor = ler('server.mjs');
  for (const f of ["'/idiomas.js'", "'/idiomas/en.js'", "'/corretor.js'"]) assert.ok(servidor.includes(f), `server.mjs entrega ${f}`);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/idiomas-cobertura.test.cjs`
Expected: FAIL (`Cannot find module '../idiomas/en.js'`).

- [ ] **Step 3: Criar `idiomas/en.js` com os textos do `index.html`**

```js
// Inglês. Chave: a frase em português exatamente como está no código (t('…') / frase('…'))
// ou no index.html. O teste tests/idiomas-cobertura.test.cjs confere que nada falta nem sobra.
(function (root) {
  const frases = {
    // index.html
    'Ir para nota (Ctrl+O)': 'Go to note (Ctrl+O)',
    'Ir para nota': 'Go to note',
    'Recolher barra lateral': 'Collapse sidebar',
    'Recolher barra lateral (Ctrl+\\)': 'Collapse sidebar (Ctrl+\\)',
    'Nova nota': 'New note',
    'Nota diária': 'Daily note',
    'Diária': 'Daily',
    'Navegação principal': 'Main navigation',
    'Hoje': 'Today',
    'Notas': 'Notes',
    'Tarefas': 'Tasks',
    'Pastas': 'Folders',
    'Grafo': 'Graph',
    'Plug-ins': 'Plugins',
    'Trocar de cofre': 'Switch vault',
    'Lixeira': 'Trash',
    'Configurações': 'Settings',
    'Carregando…': 'Loading…',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = frases;
  else root.KiroIdiomas.registrar('en', frases);
})(globalThis);
```

Rode o teste de cobertura: a lista "faltando" mostra exatamente as frases do `index.html` que o regex encontrou. Acerte `en.js` até bater com essa lista (sem inventar frases que o teste não pediu). Atenção à barra invertida em `Ctrl+\`: no HTML é um caractere; na chave JS é `'\\'`.

- [ ] **Step 4: Carregar os scripts e entregá-los no servidor**

`index.html`, logo antes de `<script src="domain.js"></script>`:

```html
    <script src="idiomas.js"></script>
    <script src="corretor.js"></script>
```

`server.mjs:23`, dentro de `publicFiles`, junto das outras entradas `.js`:

```js
'/idiomas.js': ['idiomas.js', 'text/javascript'], '/idiomas/en.js': ['idiomas/en.js', 'text/javascript'], '/corretor.js': ['corretor.js', 'text/javascript'],
```

Run: `node --test tests/idiomas-cobertura.test.cjs` — Expected: PASS.

- [ ] **Step 5: `t` e `frase` no `app.js`, datas e ordenação**

Primeira linha do `app.js`:

```js
const { t, frase } = KiroIdiomas;
```

Troque cada `'pt-BR'` fixo (confira com `grep -n "pt-BR" app.js`; o único que fica é nenhum):

```js
function formatDate(date) { return KiroIdiomas.formatarData(new Date(`${date}T12:00:00`), { weekday:"long", day:"numeric", month:"long" }); }
function dateLabel(date) { return date === today() ? t("Hoje") : KiroIdiomas.formatarData(new Date(`${date}T12:00:00`), { day:"2-digit", month:"short" }); }
```

```js
const rotuloDoDia = dia => KiroIdiomas.formatarData(new Date(`${dia}T12:00`), { weekday:'long', day:'numeric', month:'short' });
```

Linha ~281: `const dia=d=>KiroIdiomas.formatarData(d,{day:"numeric",month:"short"});`

Linha ~311: `const byTitle = (a,b) => KiroIdiomas.comparar(a.title, b.title);`

Linha ~1319 e ~3140: `.sort((a, b) => KiroIdiomas.comparar(a.path || a.title, b.path || b.title))` (a ordem de pastas passa a ser numérica, como a de notas: "Pasta 2" antes de "Pasta 10").

Linha ~3156: `const quando=ms=>KiroIdiomas.formatarData(new Date(ms),{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});`

Linha ~4116: `KiroIdiomas.formatarData(new Date(c.quando), { hour: '2-digit', minute: '2-digit', second: '2-digit' })` no lugar de `new Date(c.quando).toLocaleTimeString('pt-BR')`.

`"Hoje"` de `dateLabel` entrou como `t("Hoje")` — já está em `en.js`.

- [ ] **Step 6: Textos fixos do `index.html` e partida**

Perto de `status()` (linha ~1448), acrescente:

```js
// Textos do index.html (barra lateral e status): o original em português fica guardado para a
// próxima troca de idioma. O que o app redesenha depois (contagem, rótulo da lateral) é dele.
const originaisDoIndex = new WeakMap();
function traduzirFixos() {
  for (const raiz of document.querySelectorAll('.sidebar, #save-status')) {
    const passo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let no = passo.nextNode(); no; no = passo.nextNode()) {
      const original = originaisDoIndex.get(no) ?? no.nodeValue;
      const limpo = original.trim();
      if (!limpo) continue;
      originaisDoIndex.set(no, original);
      no.nodeValue = original.replace(limpo, t(limpo));
    }
    for (const el of raiz.querySelectorAll('[title], [aria-label]')) for (const [atributo, chave] of [['title', 'ptTitle'], ['aria-label', 'ptAria']]) {
      if (!el.hasAttribute(atributo)) continue;
      el.dataset[chave] ??= el.getAttribute(atributo);
      el.setAttribute(atributo, t(el.dataset[chave]));
    }
  }
  document.documentElement.lang = KiroIdiomas.locale();
}
// Idioma salvo, ou o do sistema. Falhou o arquivo: segue em português e avisa.
async function prepararIdioma() {
  let salvo = null;
  try { salvo = localStorage.getItem('kiro.idioma'); } catch { /* janela privada: segue o sistema */ }
  const codigo = KiroIdiomas.escolherIdioma(salvo, navigator.language);
  try { await KiroIdiomas.carregar(codigo); KiroIdiomas.definirIdioma(codigo); }
  catch { status(t('Não foi possível carregar o idioma'), true); }
  aplicarIdiomaNaPagina();
}
function aplicarIdiomaNaPagina() {
  traduzirFixos();
  aplicarLateralCompacta();   // o rótulo do botão da lateral é dele
  window.cadernoDesktop?.definirIdioma?.(KiroIdiomas.idioma());
}
async function trocarIdioma(codigo) {
  try { await KiroIdiomas.carregar(codigo); }
  catch { status(t('Não foi possível carregar o idioma'), true); return; }
  KiroIdiomas.definirIdioma(codigo);
  try { localStorage.setItem('kiro.idioma', KiroIdiomas.idioma()); } catch { /* janela privada: vale só nesta sessão */ }
  aplicarIdiomaNaPagina();
  if (loaded) { updateCount(); render(); }
}
```

Em `iniciar()` (linha ~4891), primeira linha do corpo: `await prepararIdioma();`

Se `aplicarLateralCompacta` estiver definida com `const`/`let` depois do ponto de uso, confirme que só é chamada em tempo de execução (dentro de funções) — é o caso aqui.

Acrescente a `en.js`, seção `// app.js — idioma`: `'Não foi possível carregar o idioma': 'Could not load the language'`.

- [ ] **Step 7: Seletor na aba Sistema**

Em `showSettings`, no `painel('sistema', …)`, antes do `<section class="cfg-grupo">` do Cofre:

```js
<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Idioma'), t('Idioma dos menus, botões e avisos. Suas notas não mudam.'))}</header>
      <label class="cfg-linha">${texto(t('Idioma da interface'))}<select id="cfg-idioma" class="cfg-select">${KiroIdiomas.IDIOMAS.map(i => `<option value="${i.codigo}" ${i.codigo === KiroIdiomas.idioma() ? 'selected' : ''}>${escapeHtml(i.nome)}</option>`).join('')}</select></label>
    </section>
```

Procure no `styles.css` como os outros `<select>` das Configurações são estilizados (`grep -n "select" styles.css`) e use a mesma classe; se nenhuma existir, deixe sem classe.

Junto de `$('#cfg-mencoes')?.addEventListener(…)`:

```js
  $('#cfg-idioma')?.addEventListener('change', async e => {
    e.stopPropagation();   // senão o "change" marca a janela como alterada
    modalDirty = false;
    await trocarIdioma(e.target.value);
    closeModal(true);
    showSettings('sistema');   // a janela reabre já no idioma novo
  });
```

Acrescente a `en.js` (seção `// app.js — idioma`): `'Idioma': 'Language'`, `'Idioma dos menus, botões e avisos. Suas notas não mudam.': 'Language of menus, buttons and messages. Your notes don't change.'`, `'Idioma da interface': 'Interface language'`.

- [ ] **Step 8: Testes e verificação no navegador**

Run: `npm test` — Expected: nenhum `fail`.

Com `npm run dev` e o navegador automatizado (ou à mão): Configurações → Sistema → Idioma → English. Esperado: a barra lateral muda para "Today / Notes / Tasks / Folders / Graph", as datas da Hoje ficam em inglês, a janela reabre na aba Sistema com "Language". Recarregue a página: continua em inglês. Volte para Português: tudo volta. Abra uma nota, digite algo sem salvar, troque o idioma: o texto digitado continua lá.

- [ ] **Step 9: Commit**

```bash
git add idiomas/en.js tests/idiomas-cobertura.test.cjs index.html server.mjs app.js
git commit -m "Idiomas: carregar, trocar e escolher o idioma nas Configurações"
```

---

### Task 4: Corretor no app — ligar/desligar e sugestões no botão direito

**Files:**
- Modify: `electron/main.cjs` (topo, `createWindow`, `whenReady`)
- Modify: `electron/preload.cjs`
- Modify: `app.js` — aba Editor em `showSettings` (~4422), ligação junto de `$('#cfg-mencoes')`, `contextmenu` do editor (~2872), fim do arquivo (ouvinte geral)
- Modify: `idiomas/en.js`
- Test: `tests/idiomas-corretor.test.cjs`

**Interfaces:**
- Consumes: `KiroCorretor.itensDoCorretor`, `palavraValida`, `palavraParaDicionario` (Task 2); `abrirMenuContexto(evento, area, itens, opcoes)` e `menuDaNota()` já existentes em `app.js`; `t` (Task 3); pasta `dicionarios/` (Task 1, pode não existir).
- Produces (preload, em `window.cadernoDesktop`): `definirCorretor(ligado: boolean)`, `aoMenuDoCorretor(fn: (dados: { palavra: string, sugestoes: string[] }) => void)`, `trocarPalavra(s: string)`, `adicionarAoDicionario(p: string)`, `definirIdioma(codigo: string)` (este último usado pela Task 3 com `?.` e tratado no main pela Task 11).

- [ ] **Step 1: Teste por inspeção (mesmo estilo de `tests/plugins.test.cjs`)**

```js
// tests/idiomas-corretor.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('main: pt-BR e en-US juntos, só os que existem, depois que a página carrega', () => {
  const main = ler('electron/main.cjs');
  assert.ok(main.includes("const IDIOMAS_DO_CORRETOR = ['pt-BR', 'en-US'];"));
  assert.ok(/availableSpellCheckerLanguages/.test(main));
  assert.ok(/webContents\.once\('did-finish-load'/.test(main), 'os dicionários entram depois da janela carregar');
  assert.ok(/setSpellCheckerLanguages\(/.test(main));
});

test('main: canais do corretor validam o que a página manda', () => {
  const main = ler('electron/main.cjs');
  assert.ok(/ipcMain\.on\('corretor:definir', \(event, ligado\) => event\.sender\.session\.setSpellCheckerEnabled\(ligado === true\)\)/.test(main));
  assert.ok(/ipcMain\.on\('corretor:trocar'[^\n]*palavraValida\(palavra\)[^\n]*replaceMisspelling\(palavra\)/.test(main));
  assert.ok(/ipcMain\.on\('corretor:adicionar'[^\n]*palavraParaDicionario\(palavra\)[^\n]*addWordToSpellCheckerDictionary\(palavra\)/.test(main));
  assert.ok(/on\('context-menu'[\s\S]{0,300}send\('corretor:menu'/.test(main), 'o botão direito devolve palavra e sugestões à página');
});

test('preload expõe só os canais do corretor e do idioma', () => {
  const preload = ler('electron/preload.cjs');
  for (const trecho of ["definirCorretor: ligado => ipcRenderer.send('corretor:definir', ligado === true)", "trocarPalavra: palavra => ipcRenderer.send('corretor:trocar', palavra)", "adicionarAoDicionario: palavra => ipcRenderer.send('corretor:adicionar', palavra)", "definirIdioma: codigo => ipcRenderer.send('idioma:definir', codigo)"])
    assert.ok(preload.includes(trecho), trecho);
  assert.ok(/aoMenuDoCorretor: fn => ipcRenderer\.on\('corretor:menu', \(_evento, dados\) => fn\(dados\)\)/.test(preload));
});

test('página: interruptor do corretor e Shift+botão direito deixa o menu nativo', () => {
  const app = ler('app.js');
  assert.ok(app.includes("lerPreferencia('corretor') !== '0'"), 'ligado por padrão');
  assert.ok(app.includes('id="cfg-corretor"'));
  assert.ok(/if \(evento\.shiftKey\) return;/.test(app), 'Shift + botão direito: menu do navegador');
});
```

Run: `node --test tests/idiomas-corretor.test.cjs` — Expected: FAIL.

- [ ] **Step 2: Processo principal**

`electron/main.cjs`, junto dos outros `require` do topo:

```js
const { palavraValida, palavraParaDicionario } = require('../corretor.js');
// Corretor: português e inglês juntos (a palavra vale se estiver certa em um dos dois).
const IDIOMAS_DO_CORRETOR = ['pt-BR', 'en-US'];
```

Confirme que `cp` (ou `copyFile`), `readdir`, `mkdir` e `existsSync` estão importados (`readdir`, `mkdir` e `existsSync` já estão; acrescente `copyFile` ao `require('node:fs/promises')` existente).

Nova função, antes de `createWindow`:

```js
// Dicionários embutidos (dicionarios/*.bdic) vão para a pasta onde o Chromium os procura, então
// ele não baixa nada. Sem a pasta (corretor do sistema), só ativa os idiomas.
async function prepararCorretor(sessao) {
  const embutidos = join(__dirname, '..', 'dicionarios');
  if (existsSync(embutidos)) {
    const destino = join(app.getPath('userData'), 'Dictionaries');
    await mkdir(destino, { recursive: true });
    for (const arquivo of (await readdir(embutidos)).filter(a => a.endsWith('.bdic')))
      if (!existsSync(join(destino, arquivo))) await copyFile(join(embutidos, arquivo), join(destino, arquivo));
  }
  sessao.setSpellCheckerLanguages(IDIOMAS_DO_CORRETOR.filter(i => sessao.availableSpellCheckerLanguages.includes(i)));
}
```

Em `createWindow`, depois de `window.loadFile(…)`:

```js
  // Depois da página, para não atrasar a abertura.
  window.webContents.once('did-finish-load', () => prepararCorretor(window.webContents.session).catch(() => { /* sem corretor, o app segue */ }));
  // Botão direito num campo de texto: a página abre o próprio menu com a palavra e as sugestões.
  window.webContents.on('context-menu', (_evento, p) => {
    if (p.isEditable) window.webContents.send('corretor:menu', { palavra: p.misspelledWord || '', sugestoes: (p.dictionarySuggestions || []).slice(0, 5) });
  });
```

Em `whenReady`, junto de `ipcMain.on('janela:cores', …)`:

```js
  ipcMain.on('corretor:definir', (event, ligado) => event.sender.session.setSpellCheckerEnabled(ligado === true));
  ipcMain.on('corretor:trocar', (event, palavra) => { if (palavraValida(palavra)) event.sender.replaceMisspelling(palavra); });
  ipcMain.on('corretor:adicionar', (event, palavra) => { if (palavraParaDicionario(palavra)) event.sender.session.addWordToSpellCheckerDictionary(palavra); });
```

- [ ] **Step 3: Preload**

Acrescente ao objeto de `exposeInMainWorld`:

```js
  definirCorretor: ligado => ipcRenderer.send('corretor:definir', ligado === true),
  aoMenuDoCorretor: fn => ipcRenderer.on('corretor:menu', (_evento, dados) => fn(dados)),
  trocarPalavra: palavra => ipcRenderer.send('corretor:trocar', palavra),
  adicionarAoDicionario: palavra => ipcRenderer.send('corretor:adicionar', palavra),
  definirIdioma: codigo => ipcRenderer.send('idioma:definir', codigo),
```

- [ ] **Step 4: Interruptor na aba Editor**

No `app.js`, perto de `lerPreferencia` (linha ~460):

```js
// Corretor ortográfico: preferência desta instalação, ligado por padrão. Desligado, o html
// ganha spellcheck="false" (vale para todos os campos, no app e no navegador) e, no app,
// os dicionários saem da memória.
let corretorLigado = lerPreferencia('corretor') !== '0';
function aplicarCorretor() {
  if (corretorLigado) document.documentElement.removeAttribute('spellcheck');
  else document.documentElement.setAttribute('spellcheck', 'false');
  window.cadernoDesktop?.definirCorretor?.(corretorLigado);
}
```

Chame `aplicarCorretor();` junto de `aplicarAparencia();` no bloco de partida (linha ~4879).

Em `showSettings`, no `painel('editor', …)`, depois da linha do "Mostrar “Mencionada em”":

```js
      <label class="cfg-linha cfg-chave">${texto(t('Corretor ortográfico'), t('Sublinha palavras erradas em português e em inglês, ao mesmo tempo. Botão direito sobre a palavra mostra as sugestões.'))}<input type="checkbox" id="cfg-corretor" ${corretorLigado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
```

Junto de `$('#cfg-mencoes')?.addEventListener(…)`:

```js
  $('#cfg-corretor')?.addEventListener('change', e => {
    e.stopPropagation();
    modalDirty = false;
    corretorLigado = e.target.checked;
    try { localStorage.setItem('kiro.corretor', corretorLigado ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
    aplicarCorretor();
  });
```

- [ ] **Step 5: Sugestões no menu do botão direito**

Perto de `abrirMenuContexto` (linha ~3090), depois dela:

```js
// Corretor no app: num campo de texto o menu nativo não é bloqueado, para o processo principal
// descobrir a palavra sob o clique; ele devolve palavra e sugestões e o menu do Kiro abre com
// elas no topo. Sem resposta em 400 ms, abre o menu de sempre.
let menuDoCorretor = null, limiteDoCorretor = 0;
const CAMPO_DE_TEXTO = 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""]';
const podeCorrigir = evento => Boolean(window.cadernoDesktop?.aoMenuDoCorretor && corretorLigado && evento.target.closest?.(CAMPO_DE_TEXTO));
function esperarCorretor(evento, area, itens) {
  menuDoCorretor = { x: evento.clientX, y: evento.clientY, area, itens };
  clearTimeout(limiteDoCorretor);
  limiteDoCorretor = setTimeout(() => abrirMenuDoCorretor({ palavra: '' }), 400);
}
function abrirMenuDoCorretor(dados) {
  const pendente = menuDoCorretor;
  menuDoCorretor = null;
  clearTimeout(limiteDoCorretor);
  if (!pendente) return;
  const doCorretor = KiroCorretor.itensDoCorretor(dados, { trocar: s => window.cadernoDesktop.trocarPalavra(s), adicionar: p => window.cadernoDesktop.adicionarAoDicionario(p), t });
  const itens = doCorretor.length && pendente.itens.length ? [...doCorretor, { separador: true }, ...pendente.itens] : [...doCorretor, ...pendente.itens];
  if (itens.length) abrirMenuContexto({ clientX: pendente.x, clientY: pendente.y, preventDefault() {} }, pendente.area, itens);
}
window.cadernoDesktop?.aoMenuDoCorretor?.(abrirMenuDoCorretor);
```

No editor (linha ~2872), troque o ouvinte por:

```js
  // O botão direito já abriu o bloco no mousedown; o menu age sobre ele. Shift + botão direito
  // deixa o menu do navegador (na versão web, é onde ficam as sugestões de ortografia).
  corpo.addEventListener('contextmenu', evento => {
    if (evento.shiftKey) return;
    const area = blocoAberto?.campo ?? abrirNoPonto(evento);
    if (podeCorrigir(evento)) return esperarCorretor(evento, area, menuDaNota());
    abrirMenuContexto(evento, area);
  });
```

No fim do `app.js`, antes de `iniciar();` ou junto dos outros ouvintes globais de `contextmenu`:

```js
// Campos de texto sem menu próprio (títulos, buscas, cartões): no app, só as sugestões do corretor.
document.addEventListener('contextmenu', e => { if (!e.defaultPrevented && !e.shiftKey && !menuDoCorretor && podeCorrigir(e)) esperarCorretor(e, e.target, []); });
```

`montarNivel` já aceita item sem `icone` e item com `ativo: () => false`; não precisa mudar.

Acrescente a `en.js`, seção `// corretor.js e app.js — corretor`:

```js
    'Sem sugestões': 'No suggestions',
    'Adicionar "{palavra}" ao dicionário': 'Add "{palavra}" to dictionary',
    'Corretor ortográfico': 'Spell check',
    'Sublinha palavras erradas em português e em inglês, ao mesmo tempo. Botão direito sobre a palavra mostra as sugestões.': 'Underlines misspelled words in Portuguese and English at the same time. Right-click a word to see suggestions.',
```

- [ ] **Step 6: Testes**

Run: `npm test` — Expected: nenhum `fail`.

- [ ] **Step 7: Verificação no app (Electron)**

Run: `npm run desktop:dev`. Numa nota, escreva `casa errrado house wrongg`. Esperado: `errrado` e `wrongg` sublinhados, `casa` e `house` não. Botão direito em `errrado`: o menu do Kiro abre com sugestões ("errado"…), "Adicionar "errrado" ao dicionário", separador e os itens de sempre; escolher "errado" troca a palavra e Ctrl+Z desfaz. Botão direito numa palavra certa: o menu de sempre. Configurações → Editor → desligar o corretor: os sublinhados somem sem recarregar; religar: voltam. Se a Task 1 concluiu (a), confirme que `%APPDATA%/kiro/Dictionaries` (pasta de `userData`) tem os `.bdic` copiados.

- [ ] **Step 8: Commit**

```bash
git add electron/main.cjs electron/preload.cjs app.js idiomas/en.js tests/idiomas-corretor.test.cjs
git commit -m "Idiomas: corretor ortográfico com ligar/desligar e sugestões no botão direito"
```

---

### Tasks 5–9: Traduzir o `app.js` em cinco partes

Cada parte é uma task própria (implementar, testar, revisar, commit). Todas seguem as **Regras de tradução** do topo. As fronteiras são funções, não números de linha (as linhas mudam com as tasks anteriores):

| Task | Começa em (inclusive) | Termina antes de | Mensagem de commit |
|---|---|---|---|
| 5 | início do arquivo | `function bindAbas(painel) {` | `Idiomas: app.js em inglês (1/5 — Hoje, abas e painéis)` |
| 6 | `function bindAbas(painel) {` | `function lerImagem(dentro) {` | `Idiomas: app.js em inglês (2/5 — notas, editor e grafo)` |
| 7 | `function lerImagem(dentro) {` | `let menuAberto = null;` | `Idiomas: app.js em inglês (3/5 — imagens, blocos e menus da nota)` |
| 8 | `let menuAberto = null;` | `function coresDaJanela() {` | `Idiomas: app.js em inglês (4/5 — menus, lixeira e plug-ins)` |
| 9 | `function coresDaJanela() {` | fim do arquivo | `Idiomas: app.js em inglês (5/5 — Configurações e boas-vindas)` |

**Files (cada task):**
- Modify: `app.js` (só a parte da task)
- Modify: `idiomas/en.js` (uma seção `// app.js — parte N` com as frases da parte)

**Interfaces:**
- Consumes: `t`, `frase` (primeira linha do `app.js`); `KiroIdiomas.formatarData`/`comparar` para qualquer data ou ordenação que aparecer.
- Produces: nada novo; só texto traduzível.

**Passos de cada task (N = 5…9):**

- [ ] **Step 1: Inventário da parte**

Liste os textos visíveis da parte. Ajuda (não é completo — leia a parte inteira):

```bash
awk '/^function bindAbas\(painel\) \{/{f=1} /^function lerImagem\(dentro\) \{/{f=0} f' app.js | grep -nE "'[A-ZÀ-Úa-zà-ú][^']*[a-zà-ú][^']*'|\"[A-ZÀ-Ú][^\"]*\"|>[^<>\$]*[a-zà-ú]{2,}[^<>]*<" | head -400
```

(Troque as duas âncoras pelas da sua task. Na Task 5, comece do início: `awk 'NR==1{f=1} /^function bindAbas\(painel\) \{/{f=0} f' app.js`. Na Task 9, vá até o fim: `awk '/^function coresDaJanela\(\) \{/{f=1} f' app.js`.)

Frases já trocadas por tasks anteriores (com `t(`) não entram de novo.

- [ ] **Step 2: Trocar os textos por `t()`/`frase()` e escrever o inglês em `en.js`**

Exemplos do que muda (formas reais do `app.js`):

```js
// antes
modal('Lixeira', itens.length ? … : '<p>A lixeira está vazia.</p>');
// depois
modal(t('Lixeira'), itens.length ? … : `<p>${t('A lixeira está vazia.')}</p>`);
```

```js
// antes
{ rotulo: `Ir para "${destino.alvo}"`, icone: icone('ir-para'), acao: … },
// depois
{ rotulo: t('Ir para "{alvo}"', { alvo: destino.alvo }), icone: icone('ir-para'), acao: … },
```

```js
// antes (constante no topo, avaliada antes do idioma carregar)
const ABAS_CFG = [['personalizacao', 'Aparência', 'realce'], …];
// … `<span>${rotulo}</span>`
// depois
const ABAS_CFG = [['personalizacao', frase('Aparência'), 'realce'], …];
// … `<span>${t(rotulo)}</span>`
```

```js
// antes
status('Não foi possível ler o cofre: '+error.message,true);
// depois (a mensagem do erro vem de outro módulo; a Task 11 cuida dela)
status(t('Não foi possível ler o cofre: {erro}', { erro: error.message }), true);
```

```js
// antes
let title='Sem título',i=1;
// depois — nota nova nasce com o título no idioma atual
let title=t('Sem título'),i=1;
```

Busca por texto (ex.: `nota.title || 'Sem título'`) é só exibição: `t('Sem título')`.

- [ ] **Step 3: Rodar os testes**

Run: `npm test`
Expected: nenhum `fail`. O teste de cobertura lista frases faltando/sobrando/com marcador diferente — corrija até passar. Testes antigos que procuram texto em português no `app.js` (`grep -rn "includes('" tests/`) podem quebrar se a frase mudou de forma; ajuste a frase no código para manter o texto em português idêntico dentro de `t('…')`, nunca o teste.

- [ ] **Step 4: Conferir em inglês**

Com `npm run dev`, em English, passe pelas telas da parte (a tabela diz quais) e confirme que não sobrou português visível nelas. Anote no relatório qualquer texto que ficou de propósito (e por quê, pelas Regras 6).

- [ ] **Step 5: Commit** com a mensagem da tabela.

```bash
git add app.js idiomas/en.js
git commit -m "<mensagem da tabela>"
```

---

### Task 10: Traduzir o editor do Fluxo (`fluxo-tela.js`)

**Files:**
- Modify: `fluxo-tela.js`
- Modify: `idiomas/en.js` (seção `// fluxo-tela.js`)

**Interfaces:**
- Consumes: `KiroIdiomas` global (o `fluxo-tela.js` é carregado depois de `idiomas.js`).

- [ ] **Step 1: `t` no módulo**

Logo depois de `const F = root.KiroFluxo;`:

```js
  const t = (frase, valores) => root.KiroIdiomas.t(frase, valores);
```

(Função, não cópia: o idioma pode mudar depois do módulo carregar — `KiroIdiomas.t` já lê o idioma atual a cada chamada, então `const { t } = root.KiroIdiomas` também funcionaria; use a forma acima por clareza.)

- [ ] **Step 2: Inventário e troca**

```bash
grep -nE "'[A-ZÀ-Úa-zà-ú][^']*[a-zà-ú][^']*'|>[^<>\$]*[a-zà-ú]{2,}[^<>]*<|title=\"|aria-label=\"" fluxo-tela.js
```

Troque cada texto visível seguindo as **Regras de tradução** e escreva o inglês em `en.js`. Não traduza nomes de cores/ids usados como dado (`'1'`–`'6'`, nomes de lado `'top'` etc.).

- [ ] **Step 3: Testes e conferência**

Run: `npm test` — Expected: nenhum `fail`.
Com `npm run dev` em English: abra um Fluxo do `dev-vault` (`Exemplo.canvas`), passe pela barra de ferramentas, menus e dicas: sem português visível.

- [ ] **Step 4: Commit**

```bash
git add fluxo-tela.js idiomas/en.js
git commit -m "Idiomas: editor do Fluxo em inglês"
```

---

### Task 11: Mensagens que vêm de outros módulos e janelas do processo principal

Mensagens de erro e validação nascem em `domain.js`, `plugins.js`, `vault.cjs`, `server.mjs`, `segredos-plugins.cjs`, `ligacao-rede-plugins.cjs`, `rede-plugins.cjs` e `electron/main.cjs`, e chegam à tela como `error.message` (às vezes com o prefixo do IPC do Electron). Esses módulos também rodam no Node; eles só **marcam** as frases fixas com `frase()`, e a página traduz na exibição.

**Files:**
- Modify: os oito módulos acima
- Modify: `app.js` (pontos que mostram `error.message` ou mensagens desses módulos)
- Modify: `idiomas/en.js` (seção `// mensagens de outros módulos`)
- Test: `tests/idiomas.test.cjs` (acrescentar um teste)

**Interfaces:**
- Produces: em `app.js`, `mensagemDoErro(erro: Error|string): string` — tira o prefixo do IPC e traduz.

- [ ] **Step 1: Teste da limpeza do prefixo**

A limpeza fica em `idiomas.js` como função pura. Acrescente a `tests/idiomas.test.cjs`:

```js
test('semPrefixoDoIpc tira o prefixo que o Electron põe nos erros', () => {
  assert.equal(I.semPrefixoDoIpc("Error invoking remote method 'vault:save': Error: O cofre mudou."), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc("Error invoking remote method 'x': O cofre mudou."), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc('O cofre mudou.'), 'O cofre mudou.');
  assert.equal(I.semPrefixoDoIpc(undefined), '');
});
```

Run: `node --test tests/idiomas.test.cjs` — Expected: FAIL (`I.semPrefixoDoIpc is not a function`).

Em `idiomas.js`, antes de `const api`:

```js
  // Erro que atravessa o IPC do Electron chega como "Error invoking remote method 'canal': Error: …".
  const semPrefixoDoIpc = mensagem => String(mensagem ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
```

e acrescente `semPrefixoDoIpc` ao objeto `api`. Rode de novo — Expected: PASS.

- [ ] **Step 2: Marcar as frases fixas nos módulos**

Em cada um dos oito módulos, no topo (dentro do IIFE quando houver um), uma linha:

```js
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;
```

e envolva **só as mensagens fixas que chegam à pessoa** (`throw new Error('…')`, `return { erro: '…' }` e semelhantes mostrados na interface): `throw new Error(frase('O cofre mudou em outro editor. Exporte suas alterações e recarregue antes de salvar.'))`. Mensagens montadas com variáveis ficam como estão (seguem em português — limitação aceita). Mensagens que só vão para log, para a API do agente ou para o MCP ficam como estão.

Inventário:

```bash
grep -nE "Error\('|erro: '|mensagem: '" domain.js plugins.js vault.cjs server.mjs segredos-plugins.cjs ligacao-rede-plugins.cjs rede-plugins.cjs electron/main.cjs
```

Em `plugins.js`, as frases de validação do manifesto aparecem na aba Plug-ins: todas fixas entram.

- [ ] **Step 3: Traduzir na exibição**

Em `app.js`, perto de `status()`:

```js
// Mensagem de erro de outro módulo (cofre, domínio, plug-ins, processo principal): as frases
// fixas marcadas com frase() lá têm tradução; as montadas com dados seguem em português.
const mensagemDoErro = erro => t(KiroIdiomas.semPrefixoDoIpc(erro?.message ?? erro));
```

Troque cada `error.message` / `e.message` mostrado na tela por `mensagemDoErro(error)` (`grep -n "\.message" app.js`), inclusive dentro de frases com marcador: `t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(error) })`. A limpeza manual do prefixo nas boas-vindas (`String(e.message).replace(/^Error invoking remote method …/, '')`) passa a ser `mensagemDoErro(e)`. Mensagens de validação de plug-in mostradas na aba Plug-ins (`grep -n "motivo\|erro" app.js` na parte dos plug-ins) passam por `t()` no ponto em que são exibidas.

- [ ] **Step 4: Janelas do processo principal no idioma escolhido**

`electron/main.cjs`, junto dos outros `require`:

```js
const KiroIdiomas = require('../idiomas.js');
KiroIdiomas.registrar('en', require('../idiomas/en.js'));
const { t } = KiroIdiomas;
```

Em `whenReady`, junto dos canais do corretor:

```js
  ipcMain.on('idioma:definir', (_event, codigo) => KiroIdiomas.definirIdioma(String(codigo || '')));
```

Troque os textos das janelas do sistema por `t()`: `title` e `buttonLabel` do `showOpenDialog` em `vault:setup` e `vault:choose`. (A caixa de erro de partida `showErrorBox('Não foi possível abrir o Kiro', …)` roda antes da página dizer o idioma: fica em português.)

Acrescente as traduções a `en.js`.

- [ ] **Step 5: Testes e conferência**

Run: `npm test` — Expected: nenhum `fail`.
Com `npm run dev` em English: renomeie uma pasta para um nome inválido (ex.: `CON`) e confira a mensagem em inglês; na aba Plug-ins, um plug-in com manifesto inválido (crie um em `dev-vault/.kiro/plugins/teste/manifest.json` com `{}` e apague depois) mostra o motivo em inglês. No app (`npm run desktop:dev`) em English: Configurações → Sistema → "Choose another vault" abre a janela do sistema com título em inglês (cancele).

- [ ] **Step 6: Commit**

```bash
git add domain.js plugins.js vault.cjs server.mjs segredos-plugins.cjs ligacao-rede-plugins.cjs rede-plugins.cjs electron/main.cjs app.js idiomas.js idiomas/en.js tests/idiomas.test.cjs
git commit -m "Idiomas: mensagens do cofre, do domínio e dos plug-ins em inglês"
```

---

### Task 12: Verificação final, versão e instalador (feita por quem coordena)

**Files:**
- Modify: `package.json`, `package-lock.json` (versão)

- [ ] **Step 1: Suite inteira**

Run: `npm test` — Expected: nenhum `fail` (antes da etapa: 293 pass, 1 skipped).

- [ ] **Step 2: Medição comparada**

Repita a Task 0 (três vezes, mediana), em português e em inglês. Anote em "Medições". Critério: nenhum número pior que a referência além da variação entre as três rodadas. Se piorar, investigue antes de seguir.

- [ ] **Step 3: Passeio em inglês**

Com `npm run dev`, em English, percorra: Hoje (e Personalizar), Notas, uma nota (editar, menu do botão direito, "Mentioned in"), Tarefas, Pastas (árvore, menu), Grafo, um Fluxo, Lixeira, todas as abas das Configurações, busca das Configurações ("language", "spell"), Ir para nota (Ctrl+O). Anote qualquer português que sobrou e corrija (com `t()` + `en.js` + `npm test`) antes de seguir.

- [ ] **Step 4: Versão e instalador**

```bash
npm version 0.18.0 --no-git-tag-version
npm run build:win
```

Confira que `dist/Kiro-Setup-0.18.0.exe` existe e que o pacote leva `idiomas.js`, `idiomas/en.js`, `corretor.js` e (se a Task 1 concluiu (a)) `dicionarios/`:

```bash
npx --no-install asar list dist/win-unpacked/resources/app.asar | grep -E "idiomas|corretor|dicionarios"
```

Abra `dist/win-unpacked/Kiro.exe`, troque para English, escreva uma palavra errada numa nota e confira sublinhado e sugestões.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "Versão 0.18.0"
```

---

## Medições

| Rodada | Hoje (ms) | Notas (ms) | Pastas (ms) | Abertura (ms) |
|---|---|---|---|---|
| Referência (Task 0) | | | | |
| Final, português (Task 12) | | | | |
| Final, inglês (Task 12) | | | | |
