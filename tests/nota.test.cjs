const test = require('node:test');
const assert = require('node:assert/strict');
const { mentions, linkQuery, linkSuggestions, reescreverLinksPorTitulo, aplicarRenomeacaoDeLinks, parseWikiLink, blocosDaNota, resolverAncoraNaNota, buscarNoTexto, substituirNoTexto, substituirTodosNoTexto, validarFavoritos, ehFavorito, alternarFavorito, criarGrupoFavorito, removerGrupoFavorito, compilarConsulta, avaliarConsulta, filtrarNotasPorConsulta, posicaoParaLinha, linhaParaPosicao } = require('../domain.js');

const nota = (id, title, body = '') => ({ id, title, body, tags: [], links: [], folderId: '', updatedAt: 0 });

test('CSV coerente vira tabela com aspas, quebras e barras preservadas; prosa fica igual', () => {
  const {csvParaTabela,celulasTabela,wikiLinks}=require('../domain.js');
  const tabela=csvParaTabela('Nome,Texto\r\nAna,"uma | duas\nlinhas ""citadas"""');
  assert.equal(tabela,'| Nome | Texto |\n| --- | --- |\n| Ana | uma \\| duas<br>linhas "citadas" |');
  assert.deepEqual(celulasTabela(tabela.split('\n')[2]),['Ana','uma \\| duas<br>linhas "citadas"']);
  assert.equal(csvParaTabela('uma frase longa, outra frase longa\nmais uma frase, outra frase qualquer'),null);
  assert.equal(csvParaTabela('a,b\nc,d,e'),null);assert.equal(csvParaTabela('a,b\nc,"sem fechar'),null);
  assert.deepEqual(wikiLinks('![[Anexos/som.webm]] [[Nota]]').map(l=>l.target),['Nota']);
});

test('menções: só quem tem [[link]] que resolve para a nota, sem ela mesma e sem imagens', () => {
  const alvo = nota('a', 'Álgebra');
  const notas = [alvo, nota('b', 'Cita', 'Veja [[algebra|a matéria]]'), nota('c', 'Própria'), nota('d', 'Imagem', '![[Álgebra.png]] [[Outra]]')];
  notas[0].body = 'Eu mesma: [[Álgebra]]';
  assert.deepEqual(mentions(notas, alvo).map(n => n.id), ['b']);
});

test('sugestão: consulta só dentro de [[ aberto e ordem começa-com antes de contém', () => {
  assert.equal(linkQuery('texto [[Alg'), 'Alg');
  assert.equal(linkQuery('texto [['), '');
  assert.equal(linkQuery('[[Feito]] depois'), null);
  assert.equal(linkQuery('sem link'), null);
  assert.equal(linkQuery('imagem ![[fot'), null);
  const notas = ['Geometria analítica', 'Análise', 'Cálculo de análise', 'Outra'].map((t, i) => nota(String(i), t));
  assert.deepEqual(linkSuggestions(notas, 'anal'), ['Análise', 'Geometria analítica', 'Cálculo de análise']);
  assert.equal(linkSuggestions(notas.concat(notas.map((n, i) => nota('x' + i, n.title + ' 2')), [nota('z', 'Z')]), '').length, 8);
});

test('renomear nota atualiza [[links]] em notas e fluxos preservando apelidos, âncoras e código', () => {
  const corpo = [
    'Veja [[Álgebra]], [[algebra|a matéria]] e [[Álgebra#Vetores|ver vetores]].',
    'Em código `[[Álgebra]]` e imagem ![[Álgebra.png]] não mudam.',
    '```',
    '[[Álgebra]] dentro de cerca também não muda.',
    '```',
  ].join('\n');
  const r = reescreverLinksPorTitulo(corpo, 'Álgebra', 'Álgebra Linear');
  assert.equal(r.trocas, 3);
  assert.ok(r.corpo.includes('Veja [[Álgebra Linear]], [[Álgebra Linear|a matéria]] e [[Álgebra Linear#Vetores|ver vetores]].'));
  assert.ok(r.corpo.includes('`[[Álgebra]]`'));
  assert.ok(r.corpo.includes('![[Álgebra.png]]'));
  assert.ok(r.corpo.includes('[[Álgebra]] dentro de cerca'));

  const estado = {
    notes: [
      nota('n1', 'Álgebra Linear', 'Auto: [[Álgebra]]'),
      nota('n2', 'Estudo', 'Ref: [[Álgebra#Base]]'),
    ],
    fluxos: [
      { id: 'f1', title: 'Mapa', canvas: { nodes: [{ id: 'c1', type: 'text', text: 'Cartão [[Álgebra|alg]]' }], edges: [] } },
    ],
  };
  const aplicado = aplicarRenomeacaoDeLinks(estado, 'n1', 'Álgebra', 'Álgebra Linear');
  assert.equal(aplicado.notasAfetadas, 2);
  assert.equal(aplicado.fluxosAfetados, 1);
  assert.equal(aplicado.totalLinks, 3);
  assert.equal(aplicado.state.notes[0].body, 'Auto: [[Álgebra Linear]]');
  assert.equal(aplicado.state.notes[1].body, 'Ref: [[Álgebra Linear#Base]]');
  assert.equal(aplicado.state.fluxos[0].canvas.nodes[0].text, 'Cartão [[Álgebra Linear|alg]]');
});

test('links para subtítulos e blocos: parseWikiLink, resolverAncoraNaNota e sugestões com #', () => {
  assert.deepEqual(parseWikiLink('Python#Listas|ver'), { target: 'Python', anchor: 'Listas', blockId: '', ref: '#Listas' });
  assert.deepEqual(parseWikiLink('Python#^def-1'), { target: 'Python', anchor: '', blockId: 'def-1', ref: '#^def-1' });
  assert.deepEqual(parseWikiLink('#Introdução'), { target: '', anchor: 'Introdução', blockId: '', ref: '#Introdução' });

  const corpo = '# Introdução\nTexto inicial ^bloco-1\n```\n# Falso\n^falso-bloco\n```\n## Listas e Tuplas\nMais texto ^fim-2';
  assert.deepEqual(blocosDaNota(corpo).map(b => b.id), ['bloco-1', 'fim-2']);
  const sec = resolverAncoraNaNota(corpo, '#listas e tuplas');
  assert.equal(sec.tipo, 'titulo');
  assert.equal(sec.nivel, 2);
  assert.equal(sec.texto, 'Listas e Tuplas');
  const blk = resolverAncoraNaNota(corpo, '#^fim-2');
  assert.equal(blk.tipo, 'bloco');
  assert.equal(blk.id, 'fim-2');
  assert.equal(resolverAncoraNaNota(corpo, '#Falso'), null);
  assert.equal(resolverAncoraNaNota(corpo, '#^falso-bloco'), null);

  const nPy = nota('p', 'Python', corpo);
  assert.deepEqual(linkSuggestions([nPy], 'Python#li'), ['Python#Listas e Tuplas']);
  assert.deepEqual(linkSuggestions([nPy], 'Python#^f'), ['Python#^fim-2']);
  assert.deepEqual(linkSuggestions([], '#intro', 8, nPy), ['#Introdução']);
});

test('localizar e substituir na nota: busca case-insensitive, case-sensitive e trocas', () => {
  const texto = 'Café com leite e café expresso.\nOutro CAFÉ.';
  const semCaso = buscarNoTexto(texto, 'café');
  assert.equal(semCaso.length, 3);
  assert.deepEqual(semCaso[0], { de: 0, ate: 4 });
  const comCaso = buscarNoTexto(texto, 'café', { diferenciarMaiusculas: true });
  assert.equal(comCaso.length, 1);
  assert.deepEqual(comCaso[0], { de: 17, ate: 21 });

  const uma = substituirNoTexto(texto, comCaso[0], 'chá');
  assert.equal(uma.texto, 'Café com leite e chá expresso.\nOutro CAFÉ.');
  const todas = substituirTodosNoTexto(texto, 'café', 'chá');
  assert.equal(todas.trocas, 3);
  assert.equal(todas.texto, 'chá com leite e chá expresso.\nOutro chá.');
});

test('favoritos: validar, alternar e grupos', () => {
  let fav = validarFavoritos(null);
  assert.deepEqual(fav, { itens: [] });
  fav = alternarFavorito(fav, { tipo: 'nota', alvo: 'n1', titulo: 'Nota 1' });
  assert.equal(ehFavorito(fav, 'nota', 'n1'), true);
  fav = criarGrupoFavorito(fav, 'Estudos', 'g1');
  assert.equal(fav.itens.length, 2);
  fav = alternarFavorito(fav, { tipo: 'nota', alvo: 'n1' });
  assert.equal(ehFavorito(fav, 'nota', 'n1'), false);
  fav = removerGrupoFavorito(fav, 'g1');
  assert.deepEqual(fav, { itens: [] });
});

test('linguagem de consulta rica: path:, file:, tag:, content:, frases, negação, OR e parênteses', () => {
  const pastas = [
    { id: 'f1', title: 'Estudos', parentId: '' },
    { id: 'f2', title: 'Java', parentId: 'f1' },
  ];
  const notas = [
    { id: '1', title: 'Coleções em Java', body: 'Uso de ArrayList e Map #backend', tags: ['java'], folderId: 'f2' },
    { id: '2', title: 'Receita de Pão', body: 'Farinha e água #culinaria', tags: ['casa'], folderId: '' },
    { id: '3', title: ' Guia Python ', body: 'Listas e dicionários #backend #python', tags: ['estudo'], folderId: 'f1' },
  ];
  assert.deepEqual(filtrarNotasPorConsulta(notas, pastas, 'path:estudos/java').map(n => n.id), ['1']);
  assert.deepEqual(filtrarNotasPorConsulta(notas, pastas, 'tag:#backend -file:python').map(n => n.id), ['1']);
  assert.deepEqual(filtrarNotasPorConsulta(notas, pastas, '(tag:casa OR tag:java) -content:farinha').map(n => n.id), ['1']);
  assert.deepEqual(filtrarNotasPorConsulta(notas, pastas, '"arraylist e map"').map(n => n.id), ['1']);
});

test('conversão entre posição e linha para sincronia de rolagem', () => {
  const doc = 'linha 1\nlinha 2\nlinha 3';
  assert.equal(posicaoParaLinha(doc, 0), 0);
  assert.equal(posicaoParaLinha(doc, 10), 1);
  assert.equal(linhaParaPosicao(doc, 1), 8);
});

test('seletor do editor usa o catálogo compartilhado e passa a identidade do modelo pessoal', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const fonte = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
  const nos = {}, chamadas = [];
  const ctx = { $: s => nos[s] ||= { value: '', focus() {}, addEventListener() {} },
    editing: { title: 'Atual', body: 'Corpo', tags: [], links: [], folderId: '' },
    document: { querySelectorAll: () => [], querySelector: () => ({ classList: { toggle() {} } }) }, editorDirty: false, estadoDoc() {},
    modoFoco: false, metaFoco: 0, atualizarFoco() {}, t: s => s,
    aplicarModeloNaNota: chave => chamadas.push(chave),
    montarEditorDaNota: async () => null, bindBuscaNaNota() {}, desenharLinksDoc() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fonte.slice(fonte.indexOf('function bindEditor(){'), fonte.indexOf('// O corpo da nota é um editor CodeMirror')), ctx);
  ctx.bindEditor();
  const seletor = ctx.$('#doc-template'); seletor.value = 'nota:pessoal'; seletor.onchange({ target: seletor });
  assert.deepEqual(chamadas, ['nota:pessoal']); assert.equal(seletor.value, '');
  seletor.onchange({ target: seletor }); assert.equal(chamadas.length, 1);
  assert.match(fonte.slice(fonte.indexOf('function renderEditor(){'), fonte.indexOf('function estadoDoc(){')), /const modelos=opcoesDeModelos\(\)/);
});
