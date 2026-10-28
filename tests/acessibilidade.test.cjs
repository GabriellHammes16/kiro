const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Kiro = require('../domain.js');
const fonte = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function carregar(nomes, contexto) {
  const trechos = nomes.map(nome => {
    const inicio = fonte.search(new RegExp(`(?:async )?function ${nome}\\(`));
    assert.ok(inicio >= 0, nome);
    return fonte.slice(inicio, fonte.indexOf('\n}', inicio) + 2);
  });
  return vm.runInNewContext(`${trechos.join('\n')}; ({${nomes.join(',')}})`, contexto);
}
const t = (texto, dados = {}) => texto.replace(/\{(\w+)\}/g, (_, chave) => dados[chave]);

test('interface: preferência carregada e inválida afetam só escala dos controles', () => {
  const propriedades = new Map();
  const { aplicarTamanhoDaInterface } = carregar(['aplicarTamanhoDaInterface'], {
    lerPreferencia: () => '150',
    document: { documentElement: { style: { setProperty: (chave, valor) => propriedades.set(chave, valor) } } },
  });
  assert.equal(aplicarTamanhoDaInterface(), 150);
  assert.equal(propriedades.get('--escala-interface'), '1.5');
  for (const valor of ['ruim', '999', Infinity, null]) assert.equal(aplicarTamanhoDaInterface(valor), 100);
  const css = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
  assert.match(css, /--fs-interface:calc\(14px \* var\(--escala-interface, 1\)\)/);
  assert.match(css, /\.doc-corpo \{ font-size:17px;/);
  assert.match(fonte, /localStorage\.setItem\('kiro\.tamanhoInterface', String\(tamanho\)\)/);
});

test('tarefas e hábitos: anúncio aguarda persistência e não esconde falhas', async () => {
  const state = { tasks: [{ id: 't', title: 'Estudar', done: false }], habits: [{ id: 'h', title: 'Ler', frequency: { type: 'daily' } }], habitLog: {} };
  const mensagens = [];
  let salvar, sucesso = true;
  const api = carregar(['alternarTarefa', 'marcarHabito'], {
    state, Kiro, busy: false, failed: false, loaded: true, t, today: () => '2026-10-25', rotuloDoDia: d => d,
    criarProximas() {}, status: m => mensagens.push(m),
    save: () => new Promise(resolve => { salvar = () => { mensagens.push('Salvo no cofre'); resolve(sucesso); }; }),
    updateCount() {}, editorDaNota: null,
  });
  for (const [acao, esperada] of [
    [() => api.alternarTarefa('t'), 'Tarefa Estudar concluída.'],
    [() => api.alternarTarefa('t'), 'Tarefa Estudar reaberta.'],
    [() => api.marcarHabito('h'), 'Hábito Ler marcado em 2026-10-25.'],
    [() => api.marcarHabito('h'), 'Hábito Ler desmarcado em 2026-10-25.'],
  ]) {
    mensagens.length = 0;
    const pendente = acao(); assert.equal(mensagens.length, 0);
    salvar(); await pendente; assert.equal(mensagens.at(-1), esperada);
  }
  sucesso = false; mensagens.length = 0;
  const pendente = api.alternarTarefa('t'); salvar(); await pendente;
  assert.deepEqual(mensagens, ['Salvo no cofre']);
});

test('sequência é celebrada apenas após salvar o dia atual', async () => {
  const state = { habits: [{ id: 'h', title: 'Ler', frequency: { type: 'daily' } }], habitLog: { h: ['2026-10-24'] } };
  const mensagens = [];
  let sucesso = false;
  const { marcarHabito } = carregar(['marcarHabito'], { state, Kiro, busy: false, failed: false, loaded: true, t, today: () => '2026-10-25', rotuloDoDia: d => d, save: async () => sucesso, status: m => mensagens.push(m), celebrarSequencia: (titulo, n) => mensagens.push(`${titulo}:${n}`) });
  await marcarHabito('h'); assert.deepEqual(mensagens, []);
  state.habitLog.h = ['2026-10-24']; sucesso = true;
  await marcarHabito('h'); assert.deepEqual(mensagens, ['Ler:2']);
});

test('Hoje oculta notas de pastas selecionadas e suas descendentes', () => {
  const state = { folders: [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c' }], notes: [{ id: '1', folderId: 'a' }, { id: '2', folderId: 'b' }, { id: '3', folderId: 'c' }] };
  const { notasVisiveisNaHoje } = carregar(['notasVisiveisNaHoje'], { state, Kiro, hojeLayout: { pastasOcultas: ['a'] } });
  assert.deepEqual(Array.from(notasVisiveisNaHoje(), n => n.id), ['3']);
});

test('grafo: lista segue filtros, navegação e escapa títulos', () => {
  const { listaDasLigacoes } = carregar(['listaDasLigacoes', 'escapeHtml'], { t });
  const dados = {
    nos: [{ id: 'a', tipo: 'nota', rotulo: '<Plano>' }, { id: 'b', tipo: 'tarefa', tarefaId: 't1', rotulo: 'Estudar' }, { id: 'c', tipo: 'fantasma', rotulo: 'Futura' }],
    arestas: [{ de: 'a', para: 'b' }, { de: 'a', para: 'c' }, { de: 'a', para: 'fora' }],
  };
  const html = listaDasLigacoes(dados);
  assert.match(html, /data-action="edit-note" data-id="a"/);
  assert.match(html, /data-action="edit-task" data-id="t1"/);
  assert.match(html, /&lt;Plano&gt;/);
  assert.match(html, /Futura \(Nota inexistente\)/);
  const buscado = listaDasLigacoes(dados, no => no.id === 'b');
  assert.match(buscado, /Estudar/); assert.ok(!buscado.includes('Futura'));
  assert.match(listaDasLigacoes({ ...dados, arestas: [] }), /Nenhuma ligação com os filtros atuais/);
});

test('Glass: composição no desktop branco mantém contraste mesmo sem véu global', () => {
  const css = fs.readFileSync(require.resolve('../temas.css'), 'utf8');
  const token = nome => css.match(new RegExp(`--${nome}:(#[0-9A-F]{8})`))[1];
  const compor = (frente, fundo) => {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const alpha = parseInt(frente.slice(7, 9), 16) / 255;
    return '#' + rgb(frente).map((v, i) => Math.round(v * alpha + rgb(fundo)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  };
  const bases = [compor(token('vidro-fundo-legivel'), '#FFFFFF')];
  for (const nome of ['vidro-superficie', 'vidro-superficie-forte']) {
    const gradiente = css.match(new RegExp(`--${nome}:([^;]+)`))[1];
    for (const cor of gradiente.match(/#[0-9A-F]{8}/g)) bases.push(compor(cor, compor(token('vidro-base-painel'), '#FFFFFF')));
  }
  for (const fundo of bases) for (const texto of ['#FFFFFF', '#D1D1D6', '#F2F2F7']) assert.ok(Kiro.contraste(texto, fundo) >= 4.5, `${texto} sobre ${fundo}`);
  assert.match(css, /html\.tema-liquid-glass\.com-papel-de-parede[^}]+background:var\(--vidro-fundo-legivel\)/);
});
