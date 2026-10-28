const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function montar(desktop) {
  const folhas = [], chamadas = [], avisos = [];
  const ctx = { Kiro: require('../domain.js'), t: s => s, state: { notes: [] },
    editing: { title: '<img src=x onerror=alert(1)>', body: '# Rascunho\n\n**Texto** <script>alert(1)</script>\n\n```kiro:teste\n<script>não executar</script>\n```' }, editorDirty: true,
    window: { cadernoDesktop: desktop, print: () => chamadas.push('web') },
    document: { title: 'Kiro', fonts: { ready: Promise.resolve() },
      createElement: () => ({ querySelectorAll: () => [], remove() { folhas.splice(folhas.indexOf(this), 1); } }),
      body: { appendChild: folha => { folhas.push(folha); chamadas.push(folha.innerHTML); } },
    },
    status: (...v) => avisos.push(v),
    htmlDoBlocoPlugin: () => assert.fail('imprimir não pode executar plug-in'),
    icone: () => '', infoDaTarefaCitada: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(app.match(/function escapeHtml[^\n]+/)[0], ctx);
  vm.runInContext(app.slice(app.indexOf('const desescapar ='), app.indexOf('// ---- Blocos de código ----')), ctx);
  return { ctx, folhas, chamadas, avisos };
}

test('imprime rascunho com HTML escapado, sem executar plug-ins nem alterar a nota', async () => {
  const p = montar(), antes = structuredClone(p.ctx.editing);
  await p.ctx.imprimirNota();
  assert.equal(p.chamadas[1], 'web');
  const html = p.chamadas[0];
  assert.match(html, /<strong>Texto<\/strong>/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<pre><code>&lt;script&gt;não executar/);
  assert.doesNotMatch(html, /<(?:script|iframe|img)\b/);
  assert.deepEqual(p.ctx.editing, antes);
  assert.equal(p.ctx.editorDirty, true);
  assert.equal(p.ctx.document.title, 'Kiro');
  assert.equal(p.folhas.length, 0);
});
test('tabela colada aparece na leitura e na impressão sem interpretar HTML das células', async () => {
  const p=montar();p.ctx.editing.body='Introdução\n| Nome | Texto |\n| --- | --- |\n| Ana | & <script>alert(1)</script> \\| ok<br>linha |';
  await p.ctx.imprimirNota();const html=p.chamadas[0];
  assert.match(html,/<table\b/);assert.match(html,/<th scope="col">Nome<\/th>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\| ok<br>linha/);assert.doesNotMatch(html,/<script>/);
});

test('desktop escolhe PDF ou impressão nativa e limpa estado após falha/cancelamento', async () => {
  let pdf = 0, impressao = 0;
  const p = montar({ exportNotePdf: async () => { pdf++; return false; }, printNote: async () => { impressao++; throw Error('falha'); } });
  await p.ctx.imprimirNota(true);
  assert.equal(pdf, 1); assert.equal(impressao, 0); assert.equal(p.avisos.length, 0);
  await p.ctx.imprimirNota();
  assert.equal(impressao, 1); assert.equal(p.avisos.length, 1); assert.equal(p.folhas.length, 0);
  assert.equal(p.ctx.document.title, 'Kiro');
  await p.ctx.imprimirNota(true);
  assert.equal(pdf, 2);
});

test('dois cliques não abrem dois diálogos; links perigosos permanecem texto', async () => {
  let terminar, pedidos = 0;
  const p = montar({ printNote: () => { pedidos++; return new Promise(r => { terminar = r; }); } });
  p.ctx.editing.body = '[x](javascript:alert) [ok](https://example.com) [[<img src=x>]]';
  const primeira = p.ctx.imprimirNota();
  await p.ctx.imprimirNota();
  await new Promise(r => setImmediate(r));
  assert.equal(pedidos, 1);
  assert.doesNotMatch(p.chamadas[0], /href="javascript:|<img\b/);
  assert.match(p.chamadas[0], /href="https:\/\/example.com\//);
  terminar(); await primeira;
});

test('IPC exporta somente a janela principal e só grava após escolher destino', async () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const handlers = {}, gravados = [];
  let cancelar = true, dialogos = 0, exportacoes = 0;
  const quadro = {}, sender = { mainFrame: quadro, printToPDF: async () => { exportacoes++; return Buffer.from('%PDF-teste'); } };
  const ctx = { ipcMain: { handle: (k, fn) => { handlers[k] = fn; } }, frase: s => s, t: s => s,
    BrowserWindow: { fromWebContents: () => ({}) },
    dialog: { showSaveDialog: async (_janela, opcoes) => { dialogos++; assert.equal(opcoes.defaultPath, 'titulo--.pdf'); return { canceled: cancelar, filePath: 'destino.pdf' }; } },
    atomicWrite: async (...v) => gravados.push(v),
  };
  vm.runInNewContext(fonte.slice(fonte.indexOf("  ipcMain.handle('nota:imprimir'"), fonte.indexOf("  ipcMain.handle('vault:trash'")), ctx);
  await assert.rejects(handlers['nota:pdf']({ sender, senderFrame: {} }, 'titulo'), /inválido/);
  assert.equal(dialogos, 0);
  assert.equal(await handlers['nota:pdf']({ sender, senderFrame: quadro }, 'titulo<>'), false);
  assert.equal(exportacoes, 0); assert.equal(gravados.length, 0);
  cancelar = false;
  assert.equal(await handlers['nota:pdf']({ sender, senderFrame: quadro }, 'titulo<>'), true);
  assert.equal(exportacoes, 1); assert.equal(gravados[0][0], 'destino.pdf');
  assert.equal(gravados[0][1].toString(), '%PDF-teste');
});
