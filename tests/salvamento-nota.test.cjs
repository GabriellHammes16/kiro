const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fonte = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');

// Só o trecho do salvamento, com o resto do aplicativo trocado por dublês.
function editor({ editando, notas = [] }) {
  const gravacoes = [];
  const ctx = vm.createContext({
    window: { addEventListener() {} }, document: { hasFocus: () => true, activeElement: null },
    setTimeout: () => 1, clearTimeout() {}, $: () => null, Date, gravacoes,
    t: s => s, uid: () => 'novo', status() {}, render() { ctx.redesenhos++; }, redesenhos: 0,
    busy: false, failed: false, loaded: true, editorDirty: true, editing: editando,
    state: { notes: notas }, abas: {}, editorDaNota: null, gravarAbas() {},
    KiroAbas: { trocarId: a => a, RASCUNHO: 'r' }, Kiro: { aplicarRenomeacaoDeLinks: s => ({ state: s }) },
    getNote: id => ctx.state.notes.find(n => n.id === id),
    tituloDoTexto: texto => texto.split('\n')[0], chaveDaNota: n => n.id,
    estadoDoc() { if (ctx.editorDirty) ctx.versaoDoEditor++; },
    ao_gravar: null,
    save: async (_o, _t, opcoes = {}) => { gravacoes.push(opcoes); await ctx.ao_gravar?.(); return true; },
  });
  const inicio = fonte.indexOf('const ESPERA_AUTOSAVE_NOTA'), fim = fonte.indexOf('async function extraAction(');
  assert.ok(inicio > 0 && fim > inicio);
  vm.runInContext(`${fonte.slice(inicio, fim).replace(/^const |^let /gm, 'var ')}\nthis.salvarNota=salvarNota;this.autosalvarNota=autosalvarNota;`, ctx);
  return ctx;
}
const nota = extra => ({ id: 'a', title: 'A', body: 'texto', tags: [], links: [], ...extra });

test('o salvamento automático grava sem redesenhar e com cópia parcial', async () => {
  const e = editor({ editando: nota(), notas: [nota()] });
  await e.autosalvarNota();
  assert.equal(e.editorDirty, false);
  assert.equal(e.redesenhos, 0);
  assert.equal(e.gravacoes[0].automatico, true);
  assert.equal(e.gravacoes[0].semRender, true);
});

test('o que é digitado durante a gravação continua pendente e não some', async () => {
  const e = editor({ editando: nota(), notas: [nota()] });
  e.ao_gravar = () => { e.editing.body = 'texto mais'; e.estadoDoc(); e.state = { notes: [nota()] }; };
  await e.autosalvarNota();
  assert.equal(e.editorDirty, true);
  assert.equal(e.editing.body, 'texto mais');
});

test('com o cursor no título, o automático espera; sem título, também', async () => {
  const noTitulo = editor({ editando: nota({ title: 'Novo nome' }), notas: [nota()] });
  noTitulo.document.activeElement = { id: 'doc-title' };
  await noTitulo.autosalvarNota();
  assert.equal(noTitulo.gravacoes.length, 0);
  const semTitulo = editor({ editando: nota({ id: undefined, title: '' }) });
  await semTitulo.autosalvarNota();
  assert.equal(semTitulo.gravacoes.length, 0);
});

test('nota sem título nunca prende: rascunho vazio some, escrito ganha título, salva volta ao anterior', async () => {
  const vazio = editor({ editando: nota({ id: undefined, title: '', body: ' ' }) });
  assert.equal(await vazio.salvarNota(), true);
  assert.equal(vazio.gravacoes.length, 0);
  assert.equal(vazio.editorDirty, false);
  const escrito = editor({ editando: nota({ id: undefined, title: '', body: 'Primeira linha\nresto' }) });
  assert.equal(await escrito.salvarNota(), true);
  assert.equal(escrito.state.notes[0].title, 'Primeira linha');
  const salva = editor({ editando: nota({ title: '' }), notas: [nota({ title: 'Antigo' })] });
  assert.equal(await salva.salvarNota(), true);
  assert.equal(salva.state.notes[0].title, 'Antigo');
});

test('fechar a janela tenta gravar e só pergunta quando não consegue', () => {
  assert.match(main, /will-prevent-unload/);
  assert.match(main, /janela:salvar-e-fechar/);
  assert.match(fonte, /aoPedirFechar\?\.\(async\(\)=>/);
});
