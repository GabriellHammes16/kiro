const test = require('node:test');
const assert = require('node:assert/strict');
const { modelosPessoais, expandirModelo } = require('../domain.js');

test('catálogo exige a tag explícita exata, normalizada, sem mutar as notas', () => {
  const notas = [
    { id: '1', tags: ['modelo'], body: '' },
    { id: '2', tags: [], body: '#modelo' },
    { id: '3', tags: ['modelos'], body: '' },
    { id: '4', tags: ['modelo/a'], body: '' },
    { id: '5', tags: ['MÓDELO'], body: '' },
  ];
  const antes = structuredClone(notas);
  assert.deepEqual(modelosPessoais(notas), [notas[0], notas[4]]);
  assert.deepEqual(notas, antes);
});

test('expande apenas title e date em uma passagem', () => {
  assert.equal(expandirModelo('# {{title}} / {{date}}', { title: 'Teste', date: '2026-10-24' }), '# Teste / 2026-10-24');
  assert.equal(expandirModelo('{{title}} {{title}} {{date}} {{date}}', { title: 'T', date: 'D' }), 'T T D D');
  assert.equal(expandirModelo('{{unknown}}', { title: 'T', date: 'D' }), '{{unknown}}');
  assert.equal(expandirModelo('{{title}}', { title: '$& {{date}}', date: 'D' }), '$& {{date}}');
  assert.equal(expandirModelo('', { title: 'T', date: 'D' }), '');
});

const fs = require('node:fs');
const vm = require('node:vm');
const fonte = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function fluxoModelos(opcoes = {}) {
  const nos = {};
  const doc = {};
  const no = s => nos[s] ||= { value: '', handlers: {}, attrs: {}, focus() { doc.activeElement = this; }, setCustomValidity(v) { this.erro = v; }, reportValidity() {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.handlers[k] = f; }, querySelectorAll() { return []; } };
  const ctx = { Kiro: require('../domain.js'), state: { vaultPath: 'dev', notes: [], folders: [] },
    templates: { study: { title: 'Resumo', body: ['Estudo'] }, meeting: { title: 'Reunião', body: ['Reunião'] }, daily: { title: 'Diária', body: ['Dia'] } },
    editing: { title: 'Anterior', body: 'não perder', folderId: 'destino' }, editorDirty: true,
    loaded: true, busy: false, failed: false, editorDaNota: null,
    $: no, document: doc, t: s => s, escapeHtml: s => String(s).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    today: () => '2026-10-24', status: (...args) => ctx.avisos.push(args), avisos: [],
    modal(titulo, html) { ctx.html = html; ctx.modalTitulo = titulo; no('#modal-root').firstChild = {}; },
    closeModal() { no('#modal-root').firstChild = null; return true; },
    notaVazia: extra => ({ title: '', body: '', tags: [], links: [], folderId: '', ...extra }),
    getNote: id => ctx.state.notes.find(n => n.id === id),
    salvarAntesDeTrocar: async () => { ctx.salvou++; return true; }, salvou: 0,
    abrirNota: async n => { ctx.editing = n; ctx.editorDirty = false; ctx.abertas.push(n); }, abertas: [], estadoDoc() {},
    confirm: () => true, ...opcoes,
  };
  vm.createContext(ctx);
  const inicio = fonte.indexOf('// ---- Modelos pessoais ----'), fim = fonte.indexOf('// ---- Fim dos modelos pessoais ----');
  assert.ok(inicio >= 0 && fim > inicio, 'fluxos de modelos presentes');
  vm.runInContext(fonte.slice(inicio, fim), ctx);
  const submeter = s => no(s).onsubmit({ preventDefault() {} });
  const selecionar = (chave = 'nota:m') => { ctx.criarNotaPorModelo(); no('#modelo-escolha').value = chave; return submeter('#modelo-selecao-form'); };
  const criar = (titulo = ' Nova ') => { no('#modelo-titulo').value = titulo; return submeter('#modelo-titulo-form'); };
  return { ctx, no, selecionar, criar, submeter };
}
const modelo = () => ({ id: 'm', title: 'Meu <modelo>', body: '# {{title}} {{date}}', tags: ['MÓDELO', 'estudo', 'modelos'], links: ['https://example.com'], folderId: 'origem', createdAt: 1, updatedAt: 2, file: 'fonte.md', custom: { x: 1 } });

test('modelos embutidos mantêm identidades e oferecem as seis áreas em português e inglês', () => {
  const idiomas = require('../idiomas.js');
  idiomas.registrar('en', require('../idiomas/en.js'));
  const p = fluxoModelos({ frase: s => s, t: idiomas.t });
  // Usa o catálogo real: os demais testes isolam o fluxo com modelos mínimos.
  vm.runInContext(fonte.slice(fonte.indexOf('const templates={'), fonte.indexOf('// ---- Modelos pessoais ----')), p.ctx);
  try {
    idiomas.definirIdioma('pt-BR');
    const pt = p.ctx.catalogoDeModelos();
    assert.deepEqual(Array.from(pt, m => m.chave), ['study', 'meeting', 'daily', 'minutes', 'lesson', 'session', 'legal', 'script', 'construction'].map(id => `embutido:${id}`));
    assert.match(pt.find(m => m.chave === 'embutido:lesson').body, /Objetivos de aprendizagem/);
    for (const m of pt.slice(3)) {
      const expandido = expandirModelo(m.body, { title: 'Minha nota', date: '2026-10-25' });
      assert.match(expandido, /^# Minha nota\n/);
      assert.match(expandido, /2026-10-25/);
      assert.doesNotMatch(expandido, /\{\{(?:title|date)\}\}/);
      assert.ok(expandido.split('## ').length >= 6);
    }
    idiomas.definirIdioma('en');
    const en = p.ctx.catalogoDeModelos();
    assert.equal(en.find(m => m.chave === 'embutido:minutes').titulo, 'Meeting minutes');
    assert.match(en.find(m => m.chave === 'embutido:construction').body, /Materials received/);
    assert.match(en.find(m => m.chave === 'embutido:study').body, /Main ideas/);
    assert.match(en.find(m => m.chave === 'embutido:daily').body, /What I learned/);
    assert.doesNotMatch(en.find(m => m.chave === 'embutido:lesson').body, /Objetivos|Avaliação/);
  } finally { idiomas.definirIdioma('pt-BR'); }
});

test('catálogo usa identidades e pastas, escapa nomes sem traduzir notas e fica no cofre atual', () => {
  const p = fluxoModelos(); p.ctx.state.notes = [modelo(), { ...modelo(), id: 'outro', folderId: '' }];
  p.ctx.state.folders = [{ id: 'origem', path: 'Estudos' }];
  const catalogo = p.ctx.catalogoDeModelos();
  assert.deepEqual(Array.from(catalogo, m => m.chave), ['embutido:study', 'embutido:meeting', 'embutido:daily', 'nota:m', 'nota:outro']);
  assert.equal(catalogo[3].pasta, 'Estudos'); p.ctx.criarNotaPorModelo(); assert.match(p.ctx.html, /Meu &lt;modelo>/);
  p.ctx.state.notes = []; assert.equal(p.ctx.catalogoDeModelos().length, 3);
});

test('cria cópia mínima dirty com arrays próprios, fonte intacta e pasta capturada', async () => {
  const p = fluxoModelos(), original = modelo(), antes = structuredClone(original);
  p.ctx.state.notes = [original]; p.ctx.state.folders = [{ id: 'destino' }];
  p.selecionar(); await p.criar();
  assert.deepEqual(JSON.parse(JSON.stringify(p.ctx.editing)), { title: 'Nova', body: '# Nova 2026-10-24', tags: ['estudo', 'modelos'], links: ['https://example.com'], folderId: 'destino' });
  assert.equal(p.ctx.editorDirty, true); assert.equal(p.ctx.salvou, 1); assert.deepEqual(original, antes);
  assert.notEqual(p.ctx.editing.tags, original.tags); assert.notEqual(p.ctx.editing.links, original.links);
});

test('cancelar seleção ou título não salva nem altera a nota; título aparado é obrigatório e limitado', async () => {
  const p = fluxoModelos(); const antes = p.ctx.editing;
  p.ctx.criarNotaPorModelo(); p.no('#modelo-cancelar').onclick();
  p.selecionar('embutido:study'); p.no('#modelo-cancelar').onclick();
  assert.equal(p.ctx.salvou, 0); assert.equal(p.ctx.editing, antes);
  p.selecionar('embutido:study');
  for (const invalido of ['   ', 'a'.repeat(201)]) { await p.criar(invalido); assert.ok(p.no('#modelo-titulo').erro); }
  assert.equal(p.ctx.salvou, 0); assert.equal(p.ctx.editing, antes);
});

test('falha protetora mantém nota e formulário preenchidos, inclusive rascunho sem título', async () => {
  const p = fluxoModelos(); p.ctx.editing.title = ''; const antes = p.ctx.editing;
  p.ctx.salvarAntesDeTrocar = async () => false;
  p.selecionar('embutido:study'); await p.criar('Tentativa');
  assert.equal(p.ctx.editing, antes); assert.equal(p.ctx.editing.body, 'não perder');
  assert.equal(p.no('#modelo-titulo').value, 'Tentativa'); assert.ok(p.no('#modal-root').firstChild); assert.equal(p.ctx.abertas.length, 0);
  assert.equal(p.ctx.document.activeElement, p.no('#modelo-titulo'));
});

test('relê fonte após salvar e aborta fonte removida, destagada ou cofre trocado', async () => {
  for (const mudar of [p => p.ctx.state.notes.splice(0), p => p.ctx.state.notes[0].tags = [], p => p.ctx.state.vaultPath = 'outro']) {
    const p = fluxoModelos(); p.ctx.state.notes = [modelo()]; p.selecionar();
    p.ctx.salvarAntesDeTrocar = async () => { mudar(p); return true; };
    await p.criar(); assert.equal(p.ctx.abertas.length, 0); assert.ok(p.ctx.avisos.length); assert.ok(p.no('#modal-root').firstChild);
  }
  const p = fluxoModelos(); p.ctx.state.notes = [modelo()]; p.selecionar();
  p.ctx.salvarAntesDeTrocar = async () => { p.ctx.state.notes[0] = { ...modelo(), body: 'Editado {{title}}', tags: ['modelo', 'nova'], links: ['https://new.example'] }; return true; };
  await p.criar(); assert.equal(p.ctx.editing.body, 'Editado Nova'); assert.deepEqual(Array.from(p.ctx.editing.tags), ['nova']);
  assert.equal(p.ctx.editing.folderId, '');
});

test('criar modelo pessoal protege rascunho antigo e abre exemplo marcado dirty', async () => {
  const p = fluxoModelos(); p.ctx.salvarAntesDeTrocar = async () => false;
  await p.ctx.criarModeloPessoal(); assert.equal(p.ctx.abertas.length, 0);
  p.ctx.salvarAntesDeTrocar = async () => true;
  await p.ctx.criarModeloPessoal(); assert.equal(p.ctx.editorDirty, true); assert.deepEqual(Array.from(p.ctx.editing.tags), ['modelo']);
  assert.match(p.ctx.editing.body, /\{\{title\}\}/); assert.match(p.ctx.editing.body, /\{\{date\}\}/);
});

test('editor confirma, pede título quando necessário e aplica em uma inserção desfazível', async () => {
  const p = fluxoModelos(); p.ctx.state.notes = [modelo()];
  const insercoes = [], area = { value: 'Antes', setSelectionRange(...v) { this.selecao = v; }, inserir(v) { insercoes.push(v); p.ctx.editing.body = v; } };
  p.ctx.editorDaNota = { editor: { area: () => area } }; p.ctx.editing.title = '';
  p.ctx.confirm = () => false; p.ctx.aplicarModeloNaNota('nota:m'); assert.equal(insercoes.length, 0);
  p.ctx.confirm = () => true; p.ctx.aplicarModeloNaNota('nota:m'); assert.match(p.ctx.html, /modelo-titulo/);
  await p.criar('Título pedido'); assert.deepEqual(insercoes, ['# Título pedido 2026-10-24']);
  assert.deepEqual(Array.from(area.selecao), [0, 5]); assert.equal(p.ctx.editing.title, 'Título pedido'); assert.equal(p.ctx.editorDirty, true);
});

test('diálogos de modelos têm nome acessível e Tab fica dentro do formulário', () => {
  const p = fluxoModelos(); p.ctx.criarNotaPorModelo();
  assert.equal(p.no('.modal').attrs['aria-label'], 'Criar nota por modelo');
  p.selecionar('embutido:study'); assert.equal(p.no('.modal').attrs['aria-label'], 'Título da nota');
  const primeiro = p.no('#close-modal'), ultimo = p.no('#modelo-criar');
  p.no('.modal').querySelectorAll = () => [primeiro, p.no('#modelo-titulo'), p.no('#modelo-cancelar'), ultimo];
  let preveniu = 0; ultimo.focus();
  p.no('.modal').handlers.keydown({ key: 'Tab', preventDefault() { preveniu++; } });
  assert.equal(p.ctx.document.activeElement, primeiro);
  p.no('.modal').handlers.keydown({ key: 'Tab', shiftKey: true, preventDefault() { preveniu++; } });
  assert.equal(p.ctx.document.activeElement, ultimo); assert.equal(preveniu, 2);
});

test('falha real de save bloqueia retry no título e preserva formulário e nota', async () => {
  const p = fluxoModelos(); p.ctx.state.notes = [modelo()];
  p.ctx.editing = { ...modelo(), body: 'Alterado {{title}}', tags: ['modelo'], links: [] };
  p.ctx.state.notes[0] = { ...p.ctx.editing };
  p.ctx.Kiro.validateState = () => {};
  p.ctx.structuredClone = structuredClone; p.ctx.setBusy = () => {};
  p.ctx.window = { cadernoDesktop: { saveState: async () => { throw Error('write failed'); } } };
  p.ctx.status = () => {}; p.ctx.render = () => {};
  p.ctx.estadoBase = null; p.ctx.failed = false;
  p.ctx.mensagemDoErro = () => 'Falha'; p.ctx.eventosDoCofre = () => {};
  p.ctx.mesclarComOCofre = async () => false;
  vm.runInContext(fonte.slice(fonte.indexOf('async function save('), fonte.indexOf('function escapeHtml')), p.ctx);
  vm.runInContext(fonte.slice(fonte.indexOf('async function salvarNota(){'), fonte.indexOf('async function extraAction(')), p.ctx);
  vm.runInContext(fonte.match(/async function salvarAntesDeTrocar\(\)\{[^\n]+/)[0], p.ctx);
  p.ctx.uid = () => 'copia'; p.ctx.gravarAbas = () => {}; p.ctx.abas = { ativo: 'rascunho' };
  p.ctx.KiroAbas = { trocarId: v => v, RASCUNHO: 'rascunho' };
  p.selecionar(); await p.criar('Nova');
  assert.equal(p.ctx.failed, true); assert.equal(p.no('#modelo-criar').disabled, true);
  assert.match(p.no('#modelo-titulo-aviso').textContent, /recupere o cofre/);
  assert.equal(p.no('#modelo-titulo').value, 'Nova'); assert.equal(p.ctx.editing.body, 'Alterado {{title}}');
  assert.equal(p.ctx.state.notes.length, 1); assert.equal(p.ctx.abertas.length, 0);
  p.no('#modelo-titulo').onsubmit?.(); await p.criar('Outra');
  assert.equal(p.no('#modelo-criar').disabled, true); assert.equal(p.ctx.state.notes.length, 1);
});

test('salvarNota real pode redesenhar sem perder o formulário e a cópia usa o modelo recém-salvo', async () => {
  for (const sucesso of [false, true]) {
    const p = fluxoModelos(), original = modelo();
    p.ctx.state.notes = [original]; p.ctx.editing = { ...original, body: 'Alterado {{title}}', tags: [...original.tags], links: [...original.links] };
    p.ctx.save = async () => sucesso;
    p.ctx.render = () => { assert.equal(p.no('#modelo-titulo').value, 'Nova'); assert.ok(p.no('#modal-root').firstChild); };
    vm.runInContext(fonte.slice(fonte.indexOf('async function salvarNota(){'), fonte.indexOf('async function extraAction(')), p.ctx);
    vm.runInContext(fonte.match(/async function salvarAntesDeTrocar\(\)\{[^\n]+/)[0], p.ctx);
    p.selecionar(); await p.criar('Nova');
    if (sucesso) { assert.equal(p.ctx.editing.body, 'Alterado Nova'); assert.equal(p.ctx.editorDirty, true); }
    else { assert.equal(p.ctx.editing.body, 'Alterado {{title}}'); assert.equal(p.ctx.abertas.length, 0); assert.ok(p.no('#modal-root').firstChild); }
    assert.equal(p.ctx.state.notes[0].body, 'Alterado {{title}}');
  }
});
