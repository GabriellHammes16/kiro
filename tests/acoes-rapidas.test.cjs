const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrarAcoes } = require('../domain.js');

const acoes = [
  { id: 'nota', titulo: 'Nova nota', categoria: 'Notas' },
  { id: 'tarefa', titulo: 'Nova tarefa', categoria: 'Tarefas' },
  { id: 'fluxo', titulo: 'Novo fluxo', categoria: 'Fluxos' },
  { id: 'revisao', titulo: 'Revisão', categoria: 'Notas' },
  { id: 'plugin', titulo: 'Resumo', categoria: 'Plugin' },
  { id: 'partial', titulo: 'taref', categoria: 'Geral' },
];

test('filtra por termos normalizados e preserva a ordem de entrada', () => {
  assert.deepEqual(filtrarAcoes(acoes, 'nov'), acoes.slice(0, 3));
  assert.deepEqual(filtrarAcoes(acoes, 'nova'), acoes.slice(0, 2));
  assert.deepEqual(filtrarAcoes(acoes, 'revisao'), [acoes[3]]);
  assert.deepEqual(filtrarAcoes(acoes, 'plugin resumo'), [acoes[4]]);
  assert.deepEqual(filtrarAcoes([{ id: 'x', titulo: 'Resumo', categoria: 'Plugin' }], 'a'), []);
  assert.deepEqual(filtrarAcoes([{ id: 'x', titulo: 'taref', categoria: 'Geral' }], 'tarefa'), []);
  assert.deepEqual(filtrarAcoes(acoes, 'xyz'), []);
});

test('prioriza rótulo iniciado pela busca, limita a 12 e não altera a entrada', () => {
  const entrada = Array.from({ length: 14 }, (_, i) => ({
    id: String(i), titulo: i === 0 ? 'Abrir nova nota' : i === 13 ? 'Nova nota especial' : `Ação nova ${i}`, categoria: 'Geral',
  }));
  const copia = structuredClone(entrada);
  const filtradas = filtrarAcoes(entrada, 'nova');
  assert.equal(filtradas.length, 12);
  assert.equal(filtradas[0], entrada[13]);
  assert.deepEqual(entrada, copia);
});
test('catálogo inclui criar modelo pessoal e nota por modelo sem executar ao pesquisar', () => {
  const chamadas = [];
  const p = paleta({ criarModeloPessoal: () => chamadas.push('modelo'), criarNotaPorModelo: () => chamadas.push('nota-modelo') });
  p.ctx.abrirAcoesRapidas(); p.nos['#acoes-busca'].value = 'modelo'; p.nos['#acoes-busca'].emitir('input');
  assert.deepEqual(chamadas, []);
  assert.match(p.nos['#acoes-lista'].innerHTML, /Criar modelo pessoal/); assert.match(p.nos['#acoes-lista'].innerHTML, /Criar nota por modelo/);
  const catalogo = p.ctx.catalogoDeAcoes();
  catalogo.find(a => a.id === 'criarModelo').executar(); catalogo.find(a => a.id === 'notaPorModelo').executar();
  assert.deepEqual(chamadas, ['modelo', 'nota-modelo']);
});

const fs = require('node:fs');
const vm = require('node:vm');
const fonte = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function paleta(opcoes = {}) {
  class No {
    constructor() { this.handlers = {}; this.attrs = {}; this.value = ''; this.isConnected = true; }
    addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }
    emitir(k, props = {}) { const e = { key: '', preventDefault() {}, stopPropagation() {}, ...props }; for (const fn of this.handlers[k] || []) fn(e); return e; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    focus() { doc.activeElement = this; }
    querySelector() { return null; }
  }
  const nos = Object.fromEntries(['#modal-root', '.modal', '#acoes-busca', '#acoes-lista', '#close-modal'].map(s => [s, new No()]));
  const anterior = new No(), doc = { activeElement: anterior };
  let chamadas = [], fechou = 0;
  const ctx = { Kiro: require('../domain.js'), document: doc, $: s => nos[s], t: s => s,
    escapeHtml: s => String(s).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    busy: false, failed: false, loaded: true, gravandoAtalho: false, aguardandoCofre: false,
    pluginsAtivos: new Map(), ...opcoes,
    modal() { nos['#modal-root'].firstChild = nos['.modal']; },
    closeModal() { nos['#modal-root'].firstChild = null; fechou++; vm.runInContext('{ const fechar = aoFecharAcoesRapidas; aoFecharAcoesRapidas = null; fechar?.(); }', ctx); return true; },
    abrirNota: () => chamadas.push('nota'), notaVazia: () => ({}), taskModal: () => chamadas.push('tarefa'), novoFluxo() {}, capturaRapida() {}, extraAction() {}, irParaNota() {}, showSettings() {},
    rodarComandoDoPlugin: (...args) => chamadas.push(args),
  };
  vm.createContext(ctx);
  const inicio = fonte.indexOf('// ---- Ações rápidas ----'), fim = fonte.indexOf('// ---- Fim das ações rápidas ----');
  assert.ok(inicio >= 0 && fim > inicio, 'implementação da paleta presente');
  vm.runInContext(fonte.slice(inicio, fim), ctx);
  return { ctx, nos, anterior, doc, chamadas, fechou: () => fechou };
}

test('paleta respeita os bloqueios e não toca a nota ao abrir ou pesquisar', () => {
  for (const opcoes of [{ busy: true }, { failed: true }, { loaded: false }, { gravandoAtalho: true }, { aguardandoCofre: true }]) {
    const p = paleta(opcoes); p.ctx.abrirAcoesRapidas(); assert.ok(!p.nos['#modal-root'].firstChild);
  }
  const p = paleta(); p.nos['#modal-root'].firstChild = {}; p.ctx.abrirAcoesRapidas(); assert.equal(p.doc.activeElement, p.anterior);
  p.nos['#modal-root'].firstChild = null; p.ctx.abrirAcoesRapidas();
  assert.equal(p.doc.activeElement, p.nos['#acoes-busca']);
  let parou = false; p.nos['#acoes-busca'].value = 'tarefa'; p.nos['#acoes-busca'].emitir('input', { stopPropagation() { parou = true; } });
  assert.ok(parou); assert.deepEqual(p.chamadas, []);
  p.ctx.closeModal(); assert.equal(p.doc.activeElement, p.anterior);
});

test('setas selecionam e Enter executa só uma vez; composição não executa', () => {
  const p = paleta(); p.ctx.abrirAcoesRapidas(); const campo = p.nos['#acoes-busca'];
  campo.emitir('keydown', { key: 'Enter', isComposing: true }); assert.deepEqual(p.chamadas, []);
  campo.emitir('keydown', { key: 'ArrowDown' });
  assert.equal(campo.attrs['aria-activedescendant'], 'acao-rapida-1');
  campo.emitir('keydown', { key: 'Enter' }); campo.emitir('keydown', { key: 'Enter' });
  assert.deepEqual(p.chamadas, ['tarefa']); assert.equal(p.fechou(), 1);
  assert.notEqual(p.doc.activeElement, p.anterior);
});

test('Tab e Shift+Tab ficam no diálogo', () => {
  const p = paleta(); p.ctx.abrirAcoesRapidas(); let preveniu = 0;
  p.nos['.modal'].emitir('keydown', { key: 'Tab', preventDefault() { preveniu++; } });
  assert.equal(p.doc.activeElement, p.nos['#close-modal']);
  p.nos['.modal'].emitir('keydown', { key: 'Tab', shiftKey: true, preventDefault() { preveniu++; } });
  assert.equal(p.doc.activeElement, p.nos['#acoes-busca']); assert.equal(preveniu, 2);
});

test('comando de plugin listado é escapado e revalidado ao executar', () => {
  for (const remover of [p => p.ctx.pluginsAtivos.clear(), p => p.ctx.pluginsAtivos.get('p').comandos = []]) {
    const p = paleta(); p.ctx.pluginsAtivos.set('p', { manifesto: { name: '<Plugin>' }, comandos: [{ id: 'c', label: '<Comando>' }] });
    p.ctx.abrirAcoesRapidas(); const campo = p.nos['#acoes-busca']; campo.value = 'plugin'; campo.emitir('input');
    assert.ok(p.nos['#acoes-lista'].innerHTML.includes('&lt;Plugin>'));
    remover(p); campo.emitir('keydown', { key: 'Enter' }); assert.deepEqual(p.chamadas, []);
  }
});

test('novo fluxo só cria e grava depois do salvamento protetor', async () => {
  for (const permitido of [false, true]) {
    const chamadas = [], state = { fluxos: [] };
    const ctx = { busy: false, failed: false, loaded: true, state, Kiro: { pathKey: s => s }, t: s => s, uid: () => 'f',
      salvarAntesDeTrocar: async () => { chamadas.push('proteger'); return permitido; },
      save: async () => { chamadas.push('gravar'); return true; },
      getFluxo: () => state.fluxos[0], abrirFluxo: async () => chamadas.push('abrir'),
    };
    vm.createContext(ctx);
    vm.runInContext(fonte.slice(fonte.indexOf('async function novoFluxo('), fonte.indexOf('function fluxoModal(')), ctx);
    await ctx.novoFluxo();
    assert.deepEqual(chamadas, permitido ? ['proteger', 'gravar', 'abrir'] : ['proteger']);
    assert.equal(state.fluxos.length, permitido ? 1 : 0);
  }
});

test('plugin ainda ativo executa uma vez; instância substituída não executa', () => {
  for (const substituir of [false, true]) {
    const p = paleta(); const estado = { manifesto: { name: 'Plugin' }, comandos: [{ id: 'c', label: 'Executar' }] };
    p.ctx.pluginsAtivos.set('p', estado); const acao = p.ctx.catalogoDeAcoes().find(a => a.id === 'plugin:p:c');
    if (substituir) p.ctx.pluginsAtivos.set('p', { ...estado });
    acao.executar(); assert.deepEqual(p.chamadas, substituir ? [] : [['p', 'c']]);
  }
});

test('fechamento real da paleta limpa o callback e restaura o foco sem descarte', () => {
  const p = paleta();
  p.ctx.document.querySelector = s => p.nos[s];
  p.ctx.modalDirty = false;
  p.ctx.confirm = () => { throw new Error('busca nao deve pedir descarte'); };
  Object.defineProperty(p.nos['#modal-root'], 'innerHTML', { set() { this.firstChild = null; } });
  vm.runInContext(fonte.slice(fonte.indexOf('function closeModal('), fonte.indexOf('function taskModal(')), p.ctx);
  p.ctx.abrirAcoesRapidas(); p.nos['#acoes-busca'].value = 'pesquisa'; p.nos['#acoes-busca'].emitir('input');
  assert.equal(p.ctx.closeModal(), true);
  assert.equal(p.doc.activeElement, p.anterior);
  assert.equal(vm.runInContext('aoFecharAcoesRapidas', p.ctx), null);
});

function tecladoGlobal(p) {
  const listeners = [];
  p.doc.addEventListener = (tipo, fn, captura) => { if (tipo === 'keydown') listeners.push({ fn, captura: !!captura }); };
  p.doc.querySelector = s => p.nos[s] || null;
  p.ctx.atalhos = { acoesRapidas: 'Ctrl+Shift+K' };
  p.ctx.currentView = 'studies'; p.ctx.editing = {};
  let aberturas = 0, efeitoEditor = 0;
  const abrir = p.ctx.abrirAcoesRapidas;
  p.ctx.abrirAcoesRapidas = () => { aberturas++; abrir(); };
  vm.runInContext(fonte.slice(fonte.indexOf('const ACOES_DOS_ATALHOS='), fonte.indexOf("window.addEventListener('beforeunload'")), p.ctx);
  return {
    enviar(props, campo = false) {
      const e = { key: 'k', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, isComposing: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, ...props };
      for (const l of listeners.filter(l => l.captura)) l.fn(e);
      if (!e.parou && campo && p.nos['#acoes-busca'].emitir('keydown', e).parou) e.parou = true;
      if (!e.parou && !campo) efeitoEditor++;
      if (!e.parou) for (const l of listeners.filter(l => !l.captura)) l.fn(e);
      return e;
    }, aberturas: () => aberturas, efeitoEditor: () => efeitoEditor,
  };
}

test('atalho remapeado captura antes do editor e abre uma única vez', () => {
  const p = paleta(), teclado = tecladoGlobal(p);
  const evento = teclado.enviar({});
  assert.equal(teclado.efeitoEditor(), 0);
  assert.equal(teclado.aberturas(), 1);
  assert.equal(evento.defaultPrevented, true);
  assert.ok(p.nos['#modal-root'].firstChild);
  p.ctx.closeModal(); p.ctx.atalhos.acoesRapidas = 'Ctrl+K';
  teclado.enviar({ shiftKey: false }); assert.equal(teclado.aberturas(), 2);
  p.ctx.closeModal(); teclado.enviar({});
  assert.equal(teclado.aberturas(), 2); assert.equal(teclado.efeitoEditor(), 1);
});

test('captura respeita gravação, escolha de cofre, composição e bloqueios de abertura', () => {
  for (const opcoes of [{ gravandoAtalho: true }, { aguardandoCofre: true }, { busy: true }, { failed: true }, { loaded: false }]) {
    const p = paleta(opcoes), teclado = tecladoGlobal(p); teclado.enviar({});
    assert.ok(!p.nos['#modal-root'].firstChild);
  }
  const p = paleta(), teclado = tecladoGlobal(p); teclado.enviar({ isComposing: true });
  assert.equal(teclado.aberturas(), 0);
});

test('Escape de composição na busca não chega ao fechamento global', () => {
  const p = paleta(), teclado = tecladoGlobal(p); p.ctx.abrirAcoesRapidas();
  teclado.enviar({ key: 'Escape', ctrlKey: false, shiftKey: false, isComposing: true }, true);
  assert.equal(p.fechou(), 0); assert.ok(p.nos['#modal-root'].firstChild);
  teclado.enviar({ key: 'Escape', ctrlKey: false, shiftKey: false }, true);
  assert.equal(p.fechou(), 1);
});
