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

test('plug-ins: destaque claro com texto branco usa o fundo forte sem mudar a preferência do tema', () => {
  const original = { '--acento': '#B8A9FF', '--acento-forte': '#6E5BD6', '--primario-texto': '#FFFFFF' };
  const { temaAtual } = carregar(['temaAtual'], {
    Kiro, KiroPlugins: { VARIAVEIS_DO_TEMA: Object.keys(original) },
    document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: key => original[key] }),
  });
  const tema = temaAtual();
  assert.ok(Kiro.contraste(tema['--primario-texto'], tema['--acento']) >= 4.5);
  assert.equal(original['--acento'], '#B8A9FF');
  original['--primario-texto'] = '#000000';
  assert.equal(temaAtual()['--acento'], original['--acento']);
});

test('papel de parede: o piso de cada paleta mantém texto legível sobre imagens brancas e pretas', () => {
  const { opacidadeMinimaDoPapel } = carregar(['opacidadeMinimaDoPapel'], { Kiro });
  const css = fs.readFileSync(require.resolve('../temas.css'), 'utf8');
  for (const bloco of css.matchAll(/^\.tema-([\w-]+)\s*\{([^}]+)\}/gm)) {
    const cores = Object.fromEntries([...bloco[2].matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})\b/g)].map(m => [m[1], m[2]]));
    if (!cores['content-bg']) continue;
    const textos = [cores.ink, cores.muted], p = opacidadeMinimaDoPapel(cores['content-bg'], textos);
    assert.ok(p > 0 && p <= 100, bloco[1]);
    for (const tras of [0, 255]) {
      const fundo = '#' + [1, 3, 5].map(i => Math.round(parseInt(cores['content-bg'].slice(i, i + 2), 16) * p / 100 + tras * (1 - p / 100)).toString(16).padStart(2, '0')).join('');
      for (const texto of textos) assert.ok(Kiro.contraste(texto, fundo) >= 4.5, `${bloco[1]}: ${texto}/${fundo}`);
      if (Kiro.luminancia(cores.ink) > .5) {
        const paper = '#' + [1, 3, 5].map(i => Math.round(parseInt(fundo.slice(i, i + 2), 16) * .93 + 255 * .07).toString(16).padStart(2, '0')).join('');
        for (const texto of textos) assert.ok(Kiro.contraste(texto, paper) >= 4.5, `${bloco[1]}: Paper ${texto}/${paper}`);
      }
    }
  }
});

test('destaques: texto e estados dos botões mantêm contraste nas amostras e em cores livres', () => {
  const { pintarAcento } = carregar(['pintarAcento'], { contraste: Kiro.contraste });
  const amostras = [...fonte.slice(fonte.indexOf('const ACENTOS'), fonte.indexOf('function lerAparencia')).matchAll(/#[\dA-F]{6}/g)].map(m => m[0]);
  for (const cor of [...amostras, '#000000', '#FFFFFF', '#777777', '#808080', '#123456']) {
    const tokens = {};
    pintarAcento({ setProperty: (nome, valor) => { tokens[nome] = valor; } }, cor);
    for (const nome of ['--acento', '--acento-forte', '--acento-escuro']) {
      let fundo = tokens[nome];
      if (fundo.startsWith('color-mix')) {
        const [, hex, percent, mistura] = fundo.match(/(#[\dA-F]{6}) (\d+)%, (black|white)/);
        fundo = '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * percent / 100 + (mistura === 'white' ? 255 : 0) * (1 - percent / 100)).toString(16).padStart(2, '0')).join('');
      }
      assert.ok(Kiro.contraste(tokens['--primario-texto'], fundo) >= 4.5, `${cor}: ${nome}`);
    }
  }
});

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
    const gradiente = css.match(new RegExp(`--${nome}:([^;]+)`))[1].replace('var(--vidro-realce)', css.match(/--vidro-realce:([^;]+)/)[1]);
    for (const cor of gradiente.match(/#[0-9A-F]{8}/g)) bases.push(compor(cor, compor(token('vidro-base-painel'), '#FFFFFF')));
  }
  for (const fundo of bases) for (const texto of ['#FFFFFF', '#D1D1D6', '#F2F2F7']) assert.ok(Kiro.contraste(texto, fundo) >= 4.5, `${texto} sobre ${fundo}`);
  assert.match(css, /html\.tema-liquid-glass \.app-shell:not\(\.cofre-aberto\) \{ background:var\(--vidro-fundo-legivel\)/);
  assert.match(css, /html\.tema-liquid-glass \.app-shell:not\(\.cofre-aberto\) > \.content \{ background:transparent/);
});

test('Glass original: véu padrão mantém o texto legível no desktop branco, sem desfoque do sistema', () => {
  const css = fs.readFileSync(require.resolve('../temas.css'), 'utf8');
  const bloco = css.match(/html\.tema-liquid-glass:not\(\.vidro-escuro\) \{([^}]+)\}/)[1];
  const [, piso, fator] = css.match(/\.vidro-nativo:not\(\.vidro-escuro\) body \{ background:color-mix\(in srgb, #0A0A0C calc\((\d+)% \+ var\(--vidro-opacidade, 65%\) \* ([\d.]+)\)/);
  const veu = (Number(piso) + 65 * Number(fator)) / 100; // 65% = transparência padrão (35)
  const cinza = Math.round(255 * (1 - veu) + 10 * veu);
  const hex = v => '#' + Math.round(v).toString(16).padStart(2, '0').repeat(3);
  for (const texto of ['#FFFFFF', '#E5E5EA']) assert.ok(Kiro.contraste(texto, hex(cinza)) >= 4.5, `${texto} sobre o véu`);
  const tintas = bloco.match(/--vidro-(?:realce|superficie-forte):[^;]+/g).join().match(/#FFFFFF[0-9A-F]{2}/g);
  assert.ok(tintas.length >= 6);
  for (const tinta of tintas) {
    const alpha = parseInt(tinta.slice(7), 16) / 255;
    assert.ok(Kiro.contraste('#FFFFFF', hex(255 * alpha + cinza * (1 - alpha))) >= 4.5, `branco sobre ${tinta}`);
  }
});

test('Glass: nunca pede o material "none", que deixa a janela transparente opaca no Windows', () => {
  assert.doesNotMatch(fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8'), /setBackgroundMaterial\([^)]*none/);
});
