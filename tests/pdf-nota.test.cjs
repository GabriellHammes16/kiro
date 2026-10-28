const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function leitor({ falhar = false } = {}) {
  class Elemento extends EventTarget {
    constructor() { super(); this.dataset = {}; }
    matches(seletor) { return seletor === '.md-pdf'; }
    querySelectorAll() { return []; }
  }
  const raiz = new Elemento();
  raiz.dataset.pdf = 'Anexos/apostila.pdf';
  raiz.open = false;
  const classes = new Set();
  raiz.classList = { add: c => classes.add(c), remove: c => classes.delete(c) };
  const caixa = { isConnected: false };
  const total = { textContent: '' };
  raiz.querySelector = s => s === '.md-pdf-paginas' ? caixa : total;
  let pedidos = 0;
  const contexto = {
    Element: Elemento, window: {},
    document: { readyState: 'loading', addEventListener() {} },
    MutationObserver: class { observe() {} },
    pdfjsLib: {
      GlobalWorkerOptions: { workerPort: {} },
      getDocument() {
        pedidos++;
        return { promise: falhar && pedidos === 1 ? Promise.reject(new Error('Falha de leitura')) : Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
        }) };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pdf-nota.js'), 'utf8'), contexto);
  contexto.KiroPdf.ativar(raiz);
  const alternar = async aberta => { raiz.open = aberta; raiz.dispatchEvent(new Event('toggle')); await new Promise(r => setImmediate(r)); };
  return { alternar, pedidos: () => pedidos, comErro: () => classes.has('md-pdf-quebrado') };
}

test('PDF recolhido não lê o documento antes da expansão', () => {
  assert.equal(leitor().pedidos(), 0);
});

test('PDF expandido carrega uma vez e reabrir reaproveita as páginas', async () => {
  const pdf = leitor();
  await pdf.alternar(true);
  assert.equal(pdf.pedidos(), 1);
  await pdf.alternar(false);
  assert.equal(pdf.pedidos(), 1);
  await pdf.alternar(true);
  assert.equal(pdf.pedidos(), 1);
});

test('PDF com falha pode ser recolhido e aberto para tentar novamente', async () => {
  const pdf = leitor({ falhar: true });
  await pdf.alternar(true);
  assert.equal(pdf.comErro(), true);
  await pdf.alternar(false);
  await pdf.alternar(true);
  assert.equal(pdf.pedidos(), 2);
  assert.equal(pdf.comErro(), false);
});
