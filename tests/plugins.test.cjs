const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../plugins.js');

const base = { id: 'word-count', name: 'Word Count', version: '1.0.0', author: 'fulano', minKiro: '0.15.0', permissions: ['notes:read'], network: [] };
const validar = (mudanca = {}) => P.validarManifesto({ ...base, ...mudanca }, { versaoDoKiro: '0.15.0' });

test('manifesto válido é aceito e normalizado', () => {
  const r = validar();
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifesto.permissions, ['notes:read']);
  assert.deepEqual(r.manifesto.network, []);
});

test('manifesto inválido é recusado com motivo', () => {
  assert.match(validar({ id: 'Word Count' }).erro, /id/i);
  assert.match(validar({ version: '1' }).erro, /versão|version/i);
  assert.match(validar({ permissions: ['disk:read'] }).erro, /permiss/i);
  assert.match(validar({ minKiro: '9.0.0' }).erro, /Kiro/i);
  assert.match(validar({ network: ['*.exemplo.com'] }).erro, /endereço|host/i);
  assert.match(validar({ network: ['http://exemplo.com'] }).erro, /https/i);
  assert.match(P.validarManifesto('nada', { versaoDoKiro: '0.15.0' }).erro, /manifesto/i);
});

test('consentimento só é pedido quando o plug-in passa a pedir mais', () => {
  const registro = { enabled: true, permissions: ['notes:read'], network: [] };
  assert.equal(P.precisaConsentir(registro, base), false);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: ['notes:read', 'notes:write'] }), true);
  assert.equal(P.precisaConsentir(registro, { ...base, permissions: [] }), false);
  assert.equal(P.precisaConsentir(registro, { ...base, network: ['api.exemplo.com'] }), true);
});

test('rótulo de permissão sai em português', () => {
  assert.match(P.rotuloDaPermissao('notes:write'), /notas/i);
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');

async function cofreTemporario() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-plugins-'));
  const plugin = path.join(dir, '.kiro', 'plugins', 'word-count');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'manifest.json'), JSON.stringify(base));
  await fs.writeFile(path.join(plugin, 'index.js'), 'export default { async activate() {} };');
  return { dir, vault: new Vault(dir) };
}

test('o cofre lista plug-ins e serve só arquivos .js', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.equal(encontrados[0].id, 'word-count');
    assert.equal(encontrados[0].manifesto.name, 'Word Count');

    const codigo = await vault.readPluginFile('word-count', 'index.js');
    assert.match(codigo.toString('utf8'), /activate/);

    await assert.rejects(() => vault.readPluginFile('word-count', 'manifest.json'), /js/i);
    await assert.rejects(() => vault.readPluginFile('word-count', '../../caderno.json'), /inválido|Caminho/i);
    await assert.rejects(() => vault.readPluginFile('../outro', 'index.js'), /inválido|Caminho/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('escolhas do usuário vão e voltam de plugins.json', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    assert.deepEqual(await vault.readPluginChoices(), {});
    await vault.writePluginChoices({ 'word-count': { enabled: true, permissions: ['notes:read'], network: [] } });
    assert.equal((await vault.readPluginChoices())['word-count'].enabled, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('manifesto quebrado aparece como erro, sem derrubar a lista', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    await fs.writeFile(path.join(dir, '.kiro', 'plugins', 'word-count', 'manifest.json'), '{ isso não é json');
    const encontrados = await vault.listPlugins();
    assert.equal(encontrados.length, 1);
    assert.ok(encontrados[0].erro);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('o espaço do plug-in guarda dados e recusa passar de 1 MB', async () => {
  const { dir, vault } = await cofreTemporario();
  try {
    assert.deepEqual(await vault.readPluginData('word-count'), {});
    await vault.writePluginData('word-count', { total: 7 });
    assert.equal((await vault.readPluginData('word-count')).total, 7);
    await assert.rejects(() => vault.writePluginData('word-count', { grande: 'x'.repeat(1024 * 1024) }), /1 MB/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

const { spawn } = require('node:child_process');

async function servidorTemporario() {
  const { dir } = await cofreTemporario();
  const porta = 4300 + Math.floor(Math.random() * 500);
  const filho = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(porta), KIRO_VAULT: dir },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${porta}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  return { porta, dir, parar: async () => { filho.kill(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('a rota serve o código do plug-in com os cabeçalhos de segurança', async () => {
  const s = await servidorTemporario();
  try {
    const ok = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/index.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    assert.match(ok.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');

    const json = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/manifest.json`);
    assert.equal(json.status, 404);
    const fuga = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/..%2F..%2Fcaderno.json`);
    assert.equal(fuga.status, 404);
    // Caminho absoluto e pasta de outro plug-in também não passam.
    const absoluto = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/${encodeURIComponent('C:\\Windows\\win.ini')}`);
    assert.equal(absoluto.status, 404);
    const fundo = await fetch(`http://127.0.0.1:${s.porta}/plugins/word-count/sub/index.js`);
    assert.equal(fundo.status, 404);
  } finally { await s.parar(); }
});

test('a API entregue ao plug-in respeita as permissões', () => {
  const soLeitura = P.metodosPermitidos(['notes:read']);
  assert.ok(soLeitura.includes('notes.list'));
  assert.ok(!soLeitura.includes('notes.create'));
  assert.ok(soLeitura.includes('storage.get'), 'storage não depende de permissão');

  assert.equal(P.podeChamar(['notes:read'], 'notes.create'), false);
  assert.equal(P.podeChamar(['notes:read', 'notes:write'], 'notes.create'), true);
  assert.equal(P.podeChamar(['notes:read'], 'fs.readFile'), false, 'método fora da lista nunca passa');
  // Nem herdado do Object: só o que está em METODOS.
  assert.equal(P.podeChamar(['notes:read'], 'toString'), false);
  // Toda permissão exigida pelos métodos existe de verdade.
  for (const exigida of Object.values(P.METODOS)) if (exigida) assert.ok(P.PERMISSOES.includes(exigida), exigida);
});

test('o servidor entrega o worker e a parte pura para a página', async () => {
  const s = await servidorTemporario();
  try {
    for (const arquivo of ['/plugins.js', '/plugin-worker.js']) {
      const r = await fetch(`http://127.0.0.1:${s.porta}${arquivo}`);
      assert.equal(r.status, 200, arquivo);
      assert.match(r.headers.get('content-type'), /javascript/);
    }
  } finally { await s.parar(); }
});

test('o worker é de módulo e importa a parte pura por import', () => {
  const ler = arquivo => require('node:fs').readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
  const worker = ler('plugin-worker.js');
  // Worker clássico não serve: import() dinâmico do plug-in só funciona em worker de módulo.
  assert.match(worker, /^import '\.\/plugins\.js';/m);
  assert.ok(!/importScripts/.test(worker), 'importScripts não existe em worker de módulo');
  // A página cria o worker como módulo; a Tarefa 5 depende desta linha.
  assert.match(ler('index.html'), /<script src="plugins\.js"><\/script>/);
});

test('o plug-in de exemplo é válido e pede o mínimo', () => {
  const pasta = path.join(__dirname, '..', 'examples', 'plugins', 'word-count');
  const manifesto = JSON.parse(require('node:fs').readFileSync(path.join(pasta, 'manifest.json'), 'utf8'));
  const r = P.validarManifesto(manifesto, { versaoDoKiro: require('../package.json').version });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.manifesto.id, 'word-count');
  assert.deepEqual(r.manifesto.permissions, ['notes:read']);
  assert.deepEqual(r.manifesto.network, []);

  // O exemplo é material de referência: precisa exportar activate e só chamar
  // métodos que a permissão declarada libera.
  const codigo = require('node:fs').readFileSync(path.join(pasta, 'index.js'), 'utf8');
  assert.match(codigo, /export default/);
  assert.match(codigo, /activate\s*\(/);
  for (const metodo of codigo.match(/kiro\.[a-z]+\.[a-z]+/gi) || []) {
    assert.equal(P.podeChamar(r.manifesto.permissions, metodo.slice('kiro.'.length)), true, metodo);
  }
});

test('decide quais plug-ins carregar a partir da pasta e das escolhas', () => {
  const achados = [
    { id: 'word-count', manifesto: base },
    { id: 'quebrado', erro: 'manifest.json não é um JSON válido.' },
    { id: 'pede-mais', manifesto: { ...base, id: 'pede-mais', permissions: ['notes:read', 'notes:write'] } },
    { id: 'desligado', manifesto: { ...base, id: 'desligado' } },
    { id: 'outro-nome', manifesto: { ...base, id: 'nome-diferente' } },
  ];
  const escolhas = {
    'word-count': { enabled: true, permissions: ['notes:read'], network: [] },
    'pede-mais': { enabled: true, permissions: ['notes:read'], network: [] },
  };
  const plano = P.planoDeCarga(achados, escolhas, { versaoDoKiro: '0.15.0' });
  assert.deepEqual(plano.carregar.map(p => p.id), ['word-count']);
  assert.deepEqual(plano.carregar[0].permissoes, ['notes:read']);
  assert.equal(plano.pendentes.find(p => p.id === 'pede-mais').motivo, 'permissoes-novas');
  assert.equal(plano.pendentes.find(p => p.id === 'desligado').motivo, 'desligado');
  assert.equal(plano.problemas.find(p => p.id === 'quebrado').erro.length > 0, true);
  // Pasta com nome diferente do id do manifesto não carrega: a rota usa a pasta.
  assert.match(plano.problemas.find(p => p.id === 'outro-nome').erro, /id/i);
});

test('o hospedeiro do app.js confere a permissão concedida a cada chamada', () => {
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // assert.ok e não assert.match: o app.js inteiro no relatório de falha não ajuda ninguém.
  const tem = (expressao, motivo) => assert.ok(expressao.test(app), motivo);
  // Worker de módulo: sem isso o import() do plug-in não funciona.
  tem(/new Worker\('plugin-worker\.js', \{ type: 'module' \}\)/, 'o worker precisa ser criado como módulo');
  // A checagem usa as permissões concedidas pelo usuário, não as do manifesto.
  tem(/podeChamar\(estado\.permissoes, /, 'cada chamada reconfere a permissão concedida');
  tem(/LIMITE_ATIVACAO = 3000, LIMITE_CHAMADA = 5000/, 'os limites de tempo do plano');
});

test('painel declarativo vira marcação com o texto escapado', () => {
  const html = P.painelParaHtml({ type: 'list', items: [{ title: '<b>oi</b>', detail: 'x & y', action: 'open:1' }] }, { pluginId: 'word-count' });
  assert.match(html, /&lt;b&gt;oi&lt;\/b&gt;/);
  assert.match(html, /x &amp; y/);
  assert.match(html, /data-plugin="word-count"/);
  assert.match(html, /data-acao="open:1"/);
  assert.ok(!/<b>/.test(html));

  assert.match(P.painelParaHtml({ type: 'text', text: 'olá' }, { pluginId: 'p' }), /olá/);
  assert.match(P.painelParaHtml({ type: 'table', columns: ['A'], rows: [['1']] }, { pluginId: 'p' }), /<th[^>]*>A<\/th>/);
  assert.match(P.painelParaHtml({ type: 'nao-existe' }, { pluginId: 'p' }), /não reconhecido|inválido/i);
});

test('o painel escapa em todo canto: nada do plug-in vira marcação', () => {
  const veneno = '"><img src=x onerror=alert(1)>';
  const painel = tipo => P.painelParaHtml(tipo, { pluginId: veneno });
  // Fronteira de segurança: nem texto, nem ação, nem atributo escapam do escape.
  for (const dados of [
    { type: 'text', text: veneno },
    { type: 'list', items: [{ title: veneno, detail: veneno, action: veneno }] },
    { type: 'cards', items: [{ title: veneno, body: veneno, action: veneno }] },
    { type: 'table', columns: [veneno], rows: [[veneno]] },
    { type: 'form', submit: veneno, fields: [{ name: veneno, label: veneno, type: 'select', options: [veneno] }] },
    { type: 'stack', children: [{ type: 'text', text: veneno }] },
    { type: veneno },
  ]) {
    const html = painel(dados);
    // O texto escapado pode conter a palavra "onerror"; o que não pode é a marcação crua.
    assert.ok(!html.includes('<img'), `tag crua passou em ${dados.type}`);
    assert.ok(!html.includes(veneno), `o texto do plug-in saiu sem escape em ${dados.type}`);
  }
  // Tipo de campo do plug-in não vira atributo livre: só text, number ou select.
  const form = P.painelParaHtml({ type: 'form', submit: 'ok', fields: [{ name: 'n', label: 'n', type: 'file" onfocus="x' }] }, { pluginId: 'p' });
  assert.match(form, /type="text"/);
  assert.ok(!form.includes('onfocus'));
  // A pilha aceita filho quebrado sem derrubar o painel inteiro.
  assert.match(P.painelParaHtml({ type: 'stack', children: ['nada'] }, { pluginId: 'p' }), /não reconhecido/i);
});

test('os painéis e comandos do plug-in chegam à tela Hoje', () => {
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const tem = (expressao, motivo) => assert.ok(expressao.test(app), motivo);
  tem(/painelParaHtml/, 'o app desenha o painel pela parte pura');
  tem(/cartaoDoPainel/, 'a tela Hoje monta os cards dos plug-ins');
  // Ação reservada: abrir a nota é do Kiro, não do plug-in.
  tem(/open:/, 'a ação reservada open:<noteId> abre a nota');
});

test('Configurações têm a aba de plug-ins', () => {
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // assert.ok em vez de match: a falha não despeja o app.js inteiro no terminal.
  assert.ok(/\['plugins', 'Plug-ins', 'plugin'\]/.test(app), 'a aba existe');
  assert.ok(/\['integracoes', 'Integrações', 'link'\], \['plugins', 'Plug-ins'/.test(app), 'logo depois de Integrações');
  // Consentimento é modal do app, nunca a caixa nativa.
  const secao = app.slice(app.indexOf('// ---- Aba Plug-ins ----'), app.indexOf('// ---- Fim da aba Plug-ins ----'));
  assert.ok(secao.length > 0, 'a aba tem seção própria');
  assert.ok(!/\bconfirm\(|\balert\(/.test(secao), 'nada de confirm() ou alert() nativos');
  assert.ok(/rotuloDaPermissao/.test(secao), 'permissões em português');
  // A aba age na hora: mexer nela não pede "descartar alterações" ao fechar.
  assert.ok(/\[data-painel="plugins"\]/.test(app), 'a aba não marca o modal como alterado');
});

test('no aplicativo o worker vem do esquema, com a mesma CSP da versão web', () => {
  const ler = arquivo => require('node:fs').readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
  const main = ler('electron/main.cjs');
  const csp = "default-src 'none'; script-src 'self' kiro-plugin:; connect-src 'none'";
  assert.ok(ler('server.mjs').includes(csp), 'a versão web manda esta CSP com o worker');
  assert.ok(main.includes(`const CSP_DO_WORKER = "${csp}"`), 'o Electron manda a mesma');
  assert.ok(/'Content-Security-Policy': CSP_DO_WORKER/.test(main), 'e ela vai no cabeçalho do esquema');
  // Host reservado com ponto: id de plug-in não pode ter ponto, então não colide.
  assert.ok(/HOST_DO_KIRO = 'kiro\.app'/.test(main));
  assert.ok(/new Set\(\['plugin-worker\.js', 'plugins\.js', 'kiro-frame\.js'\]\)/.test(main), 'só os arquivos do Kiro saem do app');
  assert.ok(/corsEnabled: true/.test(main), 'o worker importa o plug-in de outro host: precisa de CORS');
  assert.ok(ler('app.js').includes("new Worker('kiro-plugin://kiro.app/plugin-worker.js', { type: 'module' })"));
});

test('o host reservado do worker nunca é id de plug-in válido', async () => {
  const { dir, vault } = await cofreTemporario();
  try { await assert.rejects(() => vault.readPluginFile('kiro.app', 'plugin-worker.js'), /inválido/i); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a CSP do index.html declara connect-src sem perder o resto', () => {
  const html = require('node:fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(/(^|; )connect-src 'self'(;|$)/.test(csp), 'connect-src explícito');
  for (const diretiva of ["default-src 'self'", "script-src 'self'", "worker-src 'self' blob: kiro-plugin:", "object-src 'none'", "base-uri 'none'", 'kiro-anexo:']) {
    assert.ok(csp.includes(diretiva), diretiva);
  }
});

test('abrir a pasta de plug-ins não aceita caminho da página', () => {
  const ler = arquivo => require('node:fs').readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
  assert.ok(ler('electron/preload.cjs').includes("openPluginsFolder: () => ipcRenderer.invoke('plugins:open')"));
  assert.ok(/ipcMain\.handle\('plugins:open', async \(\) => \{ const pasta = join\(vault\.directory, '\.kiro', 'plugins'\)/.test(ler('electron/main.cjs')));
  const app = ler('app.js');
  const secao = app.slice(app.indexOf('// ---- Aba Plug-ins ----'), app.indexOf('// ---- Fim da aba Plug-ins ----'));
  assert.ok(secao.includes('openPluginsFolder()'), 'o botão abre a pasta de plug-ins, não a raiz do cofre');
  assert.ok(/\n  plugin: '<path /.test(app), 'ícone próprio da aba');
});

test('plug-ins não aparecem em menu de botão direito; comandos rodam nas Configurações', () => {
  const app = require('node:fs').readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/rotulo: 'Plug-ins'/.test(app), 'o menu da nota não deve ter submenu de plug-ins');
  assert.ok(!/closest\?\.\('\.plugin-painel'\)[\s\S]{0,80}abrirMenuContexto/.test(app), 'o card não deve abrir menu de contexto');
  assert.ok(!/'plugin-comandos'/.test(app), 'o cabeçalho do card não deve ter botão de comandos');
  assert.ok(/data-comando-plugin=/.test(app), 'a aba Plug-ins deve ter botões de comando');
});

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

test('higienizador resiste a vetores de ataque conhecidos', () => {
  const limpo = P.higienizarHtml;
  // Nenhuma saída pode ter tag fora da lista, on*, style, xlink ou URL executável em atributo.
  const semVetor = saida => {
    for (const [, nome, attrs] of saida.matchAll(/<\/?([a-zA-Z]+)([^>]*)>/g)) {
      assert.ok(['p', 'br', 'hr', 'span', 'div', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text'].includes(nome), `tag ${nome} em ${saida}`);
      // Atributos só no formato canônico nome="valor", sem aspas nem < cruas no valor.
      assert.match(attrs, /^(\s[a-zA-Z-]+="[^"<>]*")*$/, `atributo fora do formato em ${saida}`);
      for (const [, chave, valor] of attrs.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)) {
        assert.ok(['class', 'title', 'alt', 'colspan', 'rowspan', 'href', 'src', 'width', 'height', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'points', 'text-anchor', 'font-size', 'transform', 'rel'].includes(chave), `atributo ${chave} em ${saida}`);
        if (chave === 'href') assert.match(valor, /^(https?:|#)/, `href em ${saida}`);
        if (chave === 'src') assert.match(valor, /^data:image\//, `src em ${saida}`);
      }
    }
    assert.ok(!/<(?![a-zA-Z/])/.test(saida), `< solto em ${saida}`);
  };
  const casos = [
    ['<img src=x onerror=alert(1)>', '<img>'],
    ['<img/src=x/onerror=alert(1)>', '<img>'],
    ['<img src="x"onerror="alert(1)">', '<img>'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#106;avascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#x6A;avascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#106avascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="java\tscript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="java&#9;script:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="  javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href=javascript:alert(1)>x</a>', '<a>x</a>'],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', '<a>x</a>'],
    ['<a href="https://ok" onclick="alert(1)">x</a>', '<a href="https://ok" rel="noopener noreferrer">x</a>'],
    ['<a href="https://x&quot; onclick=&quot;alert(1)">x</a>', '<a href="https://x&quot; onclick=&quot;alert(1)" rel="noopener noreferrer">x</a>'],
    ['<p>x</p onclick="alert(1)"><b>y</b>', '<p>x</p><b>y</b>'],
    ['</script><script>alert(1)</script>ok', 'ok'],
    ['<svg><script>alert(1)</script><rect width="1"/></svg>', '<svg><rect width="1"></rect></svg>'],
    ['<svg onload=alert(1)><a xlink:href="javascript:alert(1)"><text>t</text></a></svg>', '<svg><a><text>t</text></a></svg>'],
    ['<svg><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onload" to="alert(1)"/></svg>', '<svg></svg>'],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>', '<table></table>'],
    ['a < b > c', 'a &lt; b &gt; c'],
    ['<<script>alert(1)</script>', '&lt;'],
    ['<scr<script>ipt>alert(1)</script>', '&lt;scr'],
    ['<b><i>x', '<b><i>x</i></b>'],
    ['<div><span>x</div>y</span>', '<div><span>x</span></div>y'],
    ['&#60;script&#62;alert(1)&#60;/script&#62;', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['<p title="a&quot;><script>alert(1)</script>">t</p>', '<p title="a&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">t</p>'],
    ['<p class=\'x" onmouseover="alert(1)\'>t</p>', '<p class="x&quot; onmouseover=&quot;alert(1)">t</p>'],
    ['<rect fill="url(javascript:alert(1))"/>', '<rect></rect>'],
    ['<form action="https://x"><input name="p"><button formaction="javascript:alert(1)">b</button></form>', 'b'],
    ['<object data="x"><embed src="x"></object><template><img src=x onerror=alert(1)></template>ok', 'ok'],
    ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', ''],
    ['<script>never closed <p>x</p>', ''],
    ['<!--><img src=x onerror=alert(1)>-->', ''],
    ['<p>&#99999999999; &#xZZ; &#abc;</p>', '<p>&amp;#99999999999; &amp;#xZZ; &amp;#abc;</p>'],
    ['<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">', '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
    ['<img src="https://rastreio.example/pixel.png">', '<img>'],
  ];
  for (const [entrada, esperado] of casos) {
    const saida = limpo(entrada);
    assert.equal(saida, esperado, entrada);
    semVetor(saida);
  }
  assert.equal(limpo(null), '');
  assert.equal(limpo(undefined), '');
});

test('higienizador não trava com entrada patológica de 200 KB', () => {
  for (const entrada of ['<a '.repeat(70000), '<a x=a/'.repeat(30000), '<a b="'.repeat(35000), '<'.repeat(200000), '<p>'.repeat(70000), '<a x=y '.repeat(30000) + 'z']) {
    const inicio = Date.now();
    const saida = P.higienizarHtml(entrada);
    assert.ok(Date.now() - inicio < 1000, `lento: ${entrada.slice(0, 10)}`);
    assert.equal(typeof saida, 'string');
  }
  assert.ok(P.higienizarHtml('x'.repeat(300 * 1024)).length <= 200 * 1024);
});

test('eventos: o que mudou numa gravação e quem pode receber', () => {
  const antes = [{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 1 }];
  const depois = [{ id: 'a', updatedAt: 2 }, { id: 'b', updatedAt: 1 }, { id: 'c', updatedAt: 3 }];
  assert.deepEqual(P.eventosDaGravacao(antes, depois), { criadas: ['c'], alteradas: ['a'] });
  assert.deepEqual(P.eventosDaGravacao(depois, depois), { criadas: [], alteradas: [] });
  assert.deepEqual(P.eventosDaGravacao(null, undefined), { criadas: [], alteradas: [] });
  assert.equal(P.deveEntregar('save', ['notes:read']), true);
  assert.equal(P.deveEntregar('save', []), false);
  assert.equal(P.deveEntregar('create', ['tasks:read']), false);
  assert.equal(P.deveEntregar('day', []), true);
  assert.equal(P.deveEntregar('outro', ['notes:read']), false);
});

test('app: eventos têm anti-laço, não disparam na primeira carga e avisos de plug-in usam o aviso temporário', () => {
  const fs = require('node:fs'), path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'plugin-worker.js'), 'utf8');
  for (const nome of ['onSave', 'onCreate', 'onDay']) assert.match(worker, new RegExp(`${nome}\\b`));
  assert.match(app, /eventosDaGravacao/);
  assert.match(app, /PROFUNDIDADE_EVENTOS/);
  assert.match(app, /case 'notify': \{ avisoDePlugin\(/);
  assert.match(app, /aria-live/);
});

test('bloco kiro:<id> vira marcador com a fonte escapada', () => {
  const fs = require('node:fs'), path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'plugin-worker.js'), 'utf8');
  assert.match(app, /plugin-bloco/);
  assert.match(app, /higienizarHtml/);
  assert.match(app, /\^kiro:\[a-z0-9\]\[a-z0-9-\]\{1,39\}\$|kiro:\(\[a-z0-9\]/);
  assert.match(worker, /block: handler =>/);
  assert.match(worker, /block: \[\.\.\.registros\.block\.keys\(\)\]/);
  // Bloco que estoura o prazo vira aviso no bloco, não derruba o plug-in.
  assert.match(app, /registro\.tipo === 'event' \|\| registro\.tipo === 'block'/);
  // Link dentro do bloco nunca navega a janela: abre fora, com noopener.
  assert.match(app, /\.plugin-bloco a/);
});

test('documentação da etapa 2 está em dia', () => {
  const fs = require('node:fs'), path = require('node:path');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'plugins.md'), 'utf8');
  for (const termo of ['onSave', 'onCreate', 'onDay', 'kiro.block', 'sanitiz']) assert.ok(doc.includes(termo), `docs/plugins.md deve cobrir ${termo}`);
  assert.ok(!/onSave[^\n]*not available yet/i.test(doc), 'onSave não pode continuar marcado como indisponível');
  // Etapa 4 (molduras isoladas) já saiu: "Not available yet" não existe mais.
  assert.doesNotMatch(doc, /^## Not available yet/m);
  assert.doesNotMatch(doc, /Stage 4/);
});

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

