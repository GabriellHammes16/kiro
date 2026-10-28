'use strict';
// Todos os testes usam cofres temporários. Nada aqui toca o cofre do usuário.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createKiroAgent } = require('../agent/index.cjs');

async function montar(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-agent-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createKiroAgent({ vaultDirectory: directory });
}
const cliente = { clientId: 'teste', clientName: 'Suite' };
// assert.rejects com regex compara a mensagem; aqui o contrato é o código do erro.
const codigo = (...aceitos) => erro => aceitos.includes(erro.code) || (() => { throw erro; })();
// A exclusão vem desligada por padrão, como na tela de configurações.
const permitirExclusao = config => config.save({ permissions: { delete: true } });

test('create_note grava Markdown na pasta pedida e devolve o caminho', async t => {
  const { toolkit, directory } = await montar(t);
  const criada = await toolkit.call('create_note', {
    title: 'Ideias Mico', folder: 'Projetos/Mico', content: '# Ideias\n\nPrimeira ideia.', tags: ['ia', 'mico'],
  }, cliente);

  assert.equal(criada.success, true);
  assert.match(criada.note.path, /^Projetos\/Mico\/.+\.md$/);
  assert.equal(criada.note.folder, 'Projetos/Mico');
  const disco = await fs.readFile(path.join(directory, criada.note.path), 'utf8');
  assert.match(disco, /Primeira ideia\./);
  assert.match(disco, /title: Ideias Mico/);
});

test('read_note aceita id e caminho, e devolve conteúdo e metadados', async t => {
  const { toolkit } = await montar(t);
  const criada = await toolkit.call('create_note', { title: 'Python', folder: 'Estudos', content: 'Listas e dicionários.', tags: ['python'] }, cliente);

  const porId = await toolkit.call('read_note', { id: criada.note.id }, cliente);
  const porCaminho = await toolkit.call('read_note', { path: criada.note.path }, cliente);
  assert.equal(porId.content, 'Listas e dicionários.');
  assert.equal(porCaminho.id, criada.note.id);
  assert.equal(porId.metadata.folder, 'Estudos');
  assert.deepEqual(porId.metadata.tags, ['python']);
  assert.ok(porId.modifiedAt);
});

test('update_note acrescenta sem exigir reescrever a nota inteira', async t => {
  const { toolkit } = await montar(t);
  const criada = await toolkit.call('create_note', { title: 'Diário', content: 'Linha um.' }, cliente);

  await toolkit.call('update_note', { id: criada.note.id, content: 'Linha dois.', mode: 'append' }, cliente);
  await toolkit.call('update_note', { id: criada.note.id, content: 'Cabeçalho.', mode: 'prepend' }, cliente);
  const depois = await toolkit.call('read_note', { id: criada.note.id }, cliente);
  assert.equal(depois.content, 'Cabeçalho.\n\nLinha um.\n\nLinha dois.');

  await toolkit.call('update_note', { id: criada.note.id, content: 'Só isto.', mode: 'replace' }, cliente);
  assert.equal((await toolkit.call('read_note', { id: criada.note.id }, cliente)).content, 'Só isto.');
});

test('search_notes acha por título, conteúdo e tag, com trecho relevante', async t => {
  const { toolkit } = await montar(t);
  await toolkit.call('create_note', { title: 'Mico', folder: 'Projetos', content: 'Uma assistente pessoal capaz de lembrar contexto.', tags: ['ia'] }, cliente);
  await toolkit.call('create_note', { title: 'Compras', content: 'Arroz e feijão.' }, cliente);

  const achados = await toolkit.call('search_notes', { query: 'assistente pessoal' }, cliente);
  assert.equal(achados.total, 1);
  assert.equal(achados.results[0].title, 'Mico');
  assert.match(achados.results[0].snippet, /assistente pessoal/);

  // sem acento e com caixa diferente precisa achar igual
  assert.equal((await toolkit.call('search_notes', { query: 'FEIJAO' }, cliente)).total, 1);
  assert.equal((await toolkit.call('search_notes', { query: 'nada disso existe' }, cliente)).total, 0);
});

test('move_note move o arquivo no disco', async t => {
  const { toolkit, directory } = await montar(t);
  const criada = await toolkit.call('create_note', { title: 'Rotas', folder: 'Rascunhos', content: 'x' }, cliente);
  const antes = criada.note.path;

  const movida = await toolkit.call('move_note', { id: criada.note.id, folder: 'Estudos/Backend' }, cliente);
  assert.match(movida.note.path, /^Estudos\/Backend\//);
  await assert.rejects(fs.access(path.join(directory, antes)));
  await fs.access(path.join(directory, movida.note.path));
});

test('delete_note manda para a lixeira e restore_note traz de volta', async t => {
  const { toolkit, directory, config } = await montar(t);
  await permitirExclusao(config);
  const criada = await toolkit.call('create_note', { title: 'Temporária', content: 'Conteúdo que não pode sumir.' }, cliente);

  const apagada = await toolkit.call('delete_note', { id: criada.note.id }, cliente);
  assert.equal(apagada.recoverable, true);
  assert.ok(apagada.trashEntryId);
  await assert.rejects(fs.access(path.join(directory, criada.note.path)));

  const naLixeira = await toolkit.call('list_trash', {}, cliente);
  assert.equal(naLixeira.items.length, 1);

  await toolkit.call('restore_note', { entryId: apagada.trashEntryId }, cliente);
  const voltou = await toolkit.call('read_note', { id: criada.note.id }, cliente);
  assert.equal(voltou.content, 'Conteúdo que não pode sumir.');
});

test('pastas e links: create_folder, backlinks e links de saída', async t => {
  const { toolkit } = await montar(t);
  const pasta = await toolkit.call('create_folder', { path: 'Area/Sub' }, cliente);
  assert.equal(pasta.folder.path, 'Area/Sub');
  assert.deepEqual(pasta.created, ['Area', 'Area/Sub']);
  assert.equal((await toolkit.call('create_folder', { path: 'Area/Sub' }, cliente)).alreadyExisted, true);

  const destino = await toolkit.call('create_note', { title: 'Alvo', content: 'sou o alvo' }, cliente);
  const origem = await toolkit.call('create_note', { title: 'Origem', content: 'começo' }, cliente);
  await toolkit.call('create_note_link', { fromId: origem.note.id, toTitle: 'Alvo' }, cliente);

  const saindo = await toolkit.call('get_outgoing_links', { id: origem.note.id }, cliente);
  assert.equal(saindo.links.length, 1);
  assert.equal(saindo.links[0].resolved, true);

  const voltando = await toolkit.call('get_backlinks', { id: destino.note.id }, cliente);
  assert.equal(voltando.total, 1);
  assert.equal(voltando.backlinks[0].title, 'Origem');
});

test('link para nota com título repetido aponta para a nota pedida, não para a homônima', async t => {
  const { toolkit } = await montar(t);
  const bio = await toolkit.call('create_note', { title: 'Resumo', folder: 'Biologia', content: 'bio' }, cliente);
  const quimica = await toolkit.call('create_note', { title: 'Resumo', folder: 'Química', content: 'química' }, cliente);
  const origem = await toolkit.call('create_note', { title: 'Origem', content: 'começo' }, cliente);

  const criado = await toolkit.call('create_note_link', { fromId: origem.note.id, toId: quimica.note.id }, cliente);
  assert.match(criado.markup, /\|Resumo\]\]$/);   // o texto continua mostrando o título
  assert.equal((await toolkit.call('get_backlinks', { id: quimica.note.id }, cliente)).total, 1);
  assert.equal((await toolkit.call('get_backlinks', { id: bio.note.id }, cliente)).total, 0);
  // Pedir de novo a mesma nota não duplica; pedir a homônima cria outro link.
  assert.equal((await toolkit.call('create_note_link', { fromId: origem.note.id, toId: quimica.note.id }, cliente)).alreadyLinked, true);
  assert.equal((await toolkit.call('create_note_link', { fromId: origem.note.id, toId: bio.note.id }, cliente)).alreadyLinked, false);
  assert.equal((await toolkit.call('get_backlinks', { id: bio.note.id }, cliente)).total, 1);
});

test('tags podem ser somadas, removidas e usadas na busca', async t => {
  const { toolkit } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Estudo', content: 'texto', tags: ['ia'] }, cliente);
  await toolkit.call('add_tag', { id: nota.note.id, tags: ['revisar'] }, cliente);
  assert.deepEqual((await toolkit.call('read_note', { id: nota.note.id }, cliente)).metadata.tags.sort(), ['ia', 'revisar']);

  assert.equal((await toolkit.call('search_by_tag', { tags: ['revisar'] }, cliente)).total, 1);
  await toolkit.call('remove_tag', { id: nota.note.id, tags: ['revisar'] }, cliente);
  assert.equal((await toolkit.call('search_by_tag', { tags: ['revisar'] }, cliente)).total, 0);
});

test('nota diária é só leitura e não inventa arquivo', async t => {
  const { toolkit } = await montar(t);
  const vazia = await toolkit.call('get_daily_note', {}, cliente);
  assert.equal(vazia.exists, false);
  assert.equal(vazia.note, null);

  await toolkit.call('create_note', { title: vazia.date, content: 'hoje' }, cliente);
  const cheia = await toolkit.call('get_daily_note', {}, cliente);
  assert.equal(cheia.exists, true);
  assert.equal(cheia.note.content, 'hoje');
});

test('path traversal e escrita fora do cofre são recusados', async t => {
  const { toolkit, directory } = await montar(t);
  const perigosos = [
    '../fora.md',
    '..\\fora.md',
    'sub/../../fora.md',
    '/etc/passwd',
    'C:/Windows/system.ini',
    '.history/coisa.md',
    '.kiro/agent.json',
    '.trash/x.md',
    'caderno.json',
  ];
  for (const caminho of perigosos) {
    await assert.rejects(
      toolkit.call('read_note', { path: caminho }, cliente),
      codigo('INVALID_PATH', 'PATH_TRAVERSAL', 'RESERVED_PATH'),
      `deveria recusar ${caminho}`,
    );
  }
  for (const pasta of ['../fora', 'a/../../b', '/raiz', '.oculta']) {
    await assert.rejects(toolkit.call('create_folder', { path: pasta }, cliente), codigo('INVALID_PATH', 'PATH_TRAVERSAL', 'RESERVED_PATH'));
  }
  // nada escapou para o diretório acima do cofre
  const acima = await fs.readdir(path.dirname(directory));
  assert.ok(!acima.includes('fora.md'));
});

test('nomes inválidos de pasta e título são recusados', async t => {
  const { toolkit } = await montar(t);
  await assert.rejects(toolkit.call('create_folder', { path: 'CON' }, cliente), codigo('INVALID_NAME'));
  await assert.rejects(toolkit.call('create_folder', { path: 'nome<ruim>' }, cliente), codigo('INVALID_NAME'));
  await assert.rejects(toolkit.call('create_folder', { path: 'termina.' }, cliente), codigo('INVALID_NAME'));
  await assert.rejects(toolkit.call('create_note', { title: '   ' }, cliente), codigo('INVALID_NAME'));
  await assert.rejects(toolkit.call('create_note', { title: 'a'.repeat(300) }, cliente), codigo('INVALID_NAME', 'INVALID_INPUT'));
});

test('nome duplicado na mesma pasta não sobrescreve a nota existente', async t => {
  const { toolkit } = await montar(t);
  const primeira = await toolkit.call('create_note', { title: 'Igual', folder: 'P', content: 'original' }, cliente);
  await assert.rejects(
    toolkit.call('create_note', { title: 'Igual', folder: 'P', content: 'invasor' }, cliente),
    erro => erro.code === 'NOTE_EXISTS',
  );
  assert.equal((await toolkit.call('read_note', { id: primeira.note.id }, cliente)).content, 'original');
  // o mesmo título em outra pasta é permitido
  await toolkit.call('create_note', { title: 'Igual', folder: 'Q', content: 'outra pasta' }, cliente);
});

test('schema recusa campo desconhecido, tipo errado e obrigatório ausente', async t => {
  const { toolkit } = await montar(t);
  await assert.rejects(toolkit.call('create_note', { title: 'x', comando: 'rm -rf /' }, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('create_note', { title: 42 }, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('search_notes', {}, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('ferramenta_inventada', {}, cliente), codigo('UNKNOWN_TOOL'));
});

test('audit log registra quem, o quê e o resultado, sem conteúdo da nota', async t => {
  const { toolkit, audit, config } = await montar(t);
  await permitirExclusao(config);
  const criada = await toolkit.call('create_note', { title: 'Auditada', content: 'SEGREDO NO CORPO' }, { clientId: 'mico', clientName: 'Mico' });
  await toolkit.call('read_note', { id: criada.note.id }, { clientId: 'mico' });
  await toolkit.call('delete_note', { id: criada.note.id }, { clientId: 'mico' });
  await assert.rejects(toolkit.call('create_note', { title: '' }, { clientId: 'mico' }));

  const registros = await audit.read({ limit: 20 });
  const acoes = registros.map(r => r.action);
  assert.ok(acoes.includes('create_note'));
  assert.ok(acoes.includes('delete_note'));
  assert.ok(!acoes.includes('read_note'), 'leitura não polui o log de alterações');

  const criacao = registros.find(r => r.action === 'create_note' && r.status === 'success');
  assert.equal(criacao.client, 'mico');
  assert.equal(criacao.risk, 'write');
  assert.ok(criacao.revisionBefore && criacao.revisionAfter);
  assert.ok(criacao.revisionBefore !== criacao.revisionAfter);

  const falha = registros.find(r => r.status === 'error');
  assert.equal(falha.errorCode, 'INVALID_NAME');
  assert.ok(!JSON.stringify(registros).includes('SEGREDO NO CORPO'), 'o log não guarda conteúdo de nota');
});

test('permissões bloqueiam a operação desligada na configuração', async t => {
  const { toolkit, config } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Protegida', content: 'x' }, cliente);

  await config.save({ permissions: { delete: false } });
  await assert.rejects(toolkit.call('delete_note', { id: nota.note.id }, cliente), codigo('PERMISSION_DENIED'));

  await config.save({ permissions: { create: false } });
  await assert.rejects(toolkit.call('create_note', { title: 'Nova' }, cliente), codigo('PERMISSION_DENIED'));
  // leitura segue permitida
  assert.equal((await toolkit.call('read_note', { id: nota.note.id }, cliente)).title, 'Protegida');

  await config.save({ enabled: false });
  await assert.rejects(toolkit.call('read_note', { id: nota.note.id }, cliente), codigo('AGENT_DISABLED'));
});

test('catálogo declara risco e permissão de cada ferramenta', async t => {
  const { toolkit } = await montar(t);
  const lista = toolkit.list();
  const porNome = new Map(lista.map(f => [f.name, f]));
  assert.equal(porNome.get('read_note').risk, 'read');
  assert.equal(porNome.get('create_note').risk, 'write');
  assert.equal(porNome.get('delete_note').risk, 'destructive');
  assert.equal(porNome.get('delete_note').requiresConfirmation, true);
  assert.equal(porNome.get('read_note').requiresConfirmation, false);
  for (const f of lista) {
    assert.ok(f.description.length > 30, `${f.name} precisa de uma descrição útil ao modelo`);
    assert.ok(['read', 'write', 'destructive'].includes(f.risk));
    assert.ok(['read', 'create', 'update', 'delete'].includes(f.permission));
    assert.equal(f.inputSchema.type, 'object');
  }
  // nenhuma ferramenta genérica de sistema é exposta
  for (const proibida of ['read_any_file', 'write_any_file', 'run_shell', 'execute']) {
    assert.equal(porNome.has(proibida), false);
  }
});

test('eventos internos são emitidos para consumidores futuros', async t => {
  const { toolkit, events, config } = await montar(t);
  await permitirExclusao(config);
  const vistos = [];
  for (const nome of ['note.created', 'note.updated', 'note.deleted', 'note.moved', 'folder.created']) {
    events.on(nome, carga => vistos.push([nome, carga.source, carga.clientId]));
  }
  const nota = await toolkit.call('create_note', { title: 'Evento', folder: 'Pasta', content: 'a' }, cliente);
  await toolkit.call('update_note', { id: nota.note.id, content: 'b', mode: 'append' }, cliente);
  await toolkit.call('move_note', { id: nota.note.id, folder: 'Outra' }, cliente);
  await toolkit.call('delete_note', { id: nota.note.id }, cliente);

  const nomes = vistos.map(v => v[0]);
  assert.ok(nomes.includes('folder.created'));
  assert.ok(nomes.includes('note.created'));
  assert.ok(nomes.includes('note.updated'));
  assert.ok(nomes.includes('note.moved'));
  assert.ok(nomes.includes('note.deleted'));
  assert.ok(vistos.every(v => v[1] === 'agent' && v[2] === 'teste'));
});

test('nota da IA é indistinguível de nota feita à mão', async t => {
  const { toolkit, vault, directory } = await montar(t);
  // criada pelo agente
  const doAgente = await toolkit.call('create_note', { title: 'Do agente', folder: 'Mix', content: 'corpo', tags: ['t'] }, cliente);
  // criada como a interface cria: mexendo no estado e salvando pelo Vault
  const state = await vault.load();
  state.notes.push({ id: 'manual-1', title: 'Do usuário', body: 'corpo', links: [], tags: ['t'], folderId: state.folders.find(f => f.title === 'Mix').id, createdAt: Date.now(), updatedAt: Date.now() });
  const depois = await vault.save(state);
  const manual = depois.notes.find(n => n.id === 'manual-1');

  const chaves = bruto => bruto.split('\n---')[0].split('\n').filter(l => l.includes(':')).map(l => l.split(':')[0]).sort();
  const a = await fs.readFile(path.join(directory, doAgente.note.path), 'utf8');
  const b = await fs.readFile(path.join(directory, manual.file), 'utf8');
  assert.deepEqual(chaves(a), chaves(b), 'mesmo conjunto de campos no frontmatter');

  // e o agente enxerga a nota feita à mão como qualquer outra
  const lida = await toolkit.call('read_note', { path: manual.file }, cliente);
  assert.equal(lida.title, 'Do usuário');
});

test('list_notes e search_notes filtram por período (since/until em dias locais)', async t => {
  const { toolkit } = await montar(t);
  await toolkit.call('create_note', { title: 'Java hoje', content: 'Anotei sobre streams em Java.' }, cliente);
  const d = new Date(), dia = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const hoje = dia(d), ontem = dia(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)), amanha = dia(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  assert.equal((await toolkit.call('list_notes', { since: hoje, until: hoje }, cliente)).total, 1);
  assert.equal((await toolkit.call('list_notes', { since: ontem, until: ontem }, cliente)).total, 0);
  assert.equal((await toolkit.call('search_notes', { query: 'java', since: hoje }, cliente)).total, 1);
  assert.equal((await toolkit.call('search_notes', { query: 'java', since: amanha }, cliente)).total, 0);
  await assert.rejects(toolkit.call('list_notes', { since: '14/09/2026' }, cliente), codigo('INVALID_INPUT'));
});

// ---- Fluxo ----
const sobrepoe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function semSobreposicao(nodes) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    assert.ok(!sobrepoe(nodes[i], nodes[j]), `${nodes[i].id} e ${nodes[j].id} se sobrepõem`);
  }
}
async function gravarCanvas(directory, relativo, conteudo) {
  const destino = path.join(directory, relativo);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, '\t'));
}
const lerFluxo = (toolkit, alvo) => toolkit.call('read_fluxo', { ...alvo, positions: true }, cliente);

test('list_fluxos e read_fluxo: cartões, ligações e posições; cartão de nota vira "note" com o caminho', async t => {
  const { toolkit, directory } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Listas', folder: 'Estudos', content: 'x' }, cliente);
  await gravarCanvas(directory, 'Estudos/Python.canvas', {
    nodes: [
      { id: 'a', type: 'text', text: '# Python', x: 0, y: 0, width: 280, height: 60, color: '4' },
      { id: 'b', type: 'file', file: nota.note.path, x: 360, y: 0, width: 400, height: 280 },
      { id: 'c', type: 'link', url: 'https://docs.python.org/', x: 360, y: 300, width: 320, height: 100 },
      { id: 'd', type: 'file', file: 'anexos/foto.png', x: 800, y: 0, width: 320, height: 240 },
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', label: 'estruturas' }, { id: 'e2', fromNode: 'a', toNode: 'c' }],
  });

  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  assert.equal(fluxos.length, 1);
  assert.equal(fluxos[0].path, 'Estudos/Python.canvas');
  assert.equal(fluxos[0].title, 'Python');
  assert.equal(fluxos[0].folder, 'Estudos');
  assert.equal(fluxos[0].cards, 4);
  assert.equal(fluxos[0].links, 2);

  const lido = await toolkit.call('read_fluxo', { path: 'Estudos/Python.canvas' }, cliente);
  assert.deepEqual(lido.nodes, [
    { id: 'a', type: 'text', text: '# Python', color: '4' },
    { id: 'b', type: 'note', note: nota.note.path },
    { id: 'c', type: 'link', url: 'https://docs.python.org/' },
    { id: 'd', type: 'file', file: 'anexos/foto.png' },
  ]);
  assert.deepEqual(lido.edges, [{ id: 'e1', from: 'a', to: 'b', label: 'estruturas' }, { id: 'e2', from: 'a', to: 'c' }]);

  const comPosicoes = await lerFluxo(toolkit, { id: fluxos[0].id });
  assert.deepEqual(comPosicoes.nodes[2], { id: 'c', type: 'link', url: 'https://docs.python.org/', x: 360, y: 300, width: 320, height: 100 });
});

test('fluxo com arquivo corrompido aparece com error e não é lido; alvos inválidos são recusados', async t => {
  const { toolkit, directory } = await montar(t);
  await gravarCanvas(directory, 'Quebrado.canvas', '{ isto não é json');
  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  assert.equal(fluxos[0].cards, null);
  assert.match(fluxos[0].error, /JSON inválido/);
  await assert.rejects(toolkit.call('read_fluxo', { path: 'Quebrado.canvas' }, cliente), codigo('FLUXO_INVALID'));
  await assert.rejects(toolkit.call('read_fluxo', { path: '../fora.canvas' }, cliente), codigo('PATH_TRAVERSAL'));
  await assert.rejects(toolkit.call('read_fluxo', { path: 'Estudos/Python.md' }, cliente), codigo('INVALID_PATH'));
  await assert.rejects(toolkit.call('read_fluxo', { id: 'nao-existe' }, cliente), codigo('FLUXO_NOT_FOUND'));
  await assert.rejects(toolkit.call('read_fluxo', {}, cliente), codigo('INVALID_INPUT'));
});

test('create_fluxo grava o .canvas na pasta, troca os apelidos por ids reais e posiciona em árvore', async t => {
  const { toolkit, directory } = await montar(t);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Python', folder: 'Estudos',
    nodes: [
      { id: 'raiz', type: 'text', text: '# Python' },
      { id: 'tipos', type: 'text', text: '## Tipos' },
      { id: 'listas', type: 'text', text: 'Listas: `[1, 2, 3]`', color: '4' },
      { id: 'dic', type: 'text', text: 'Dicionários' },
    ],
    edges: [{ from: 'raiz', to: 'tipos' }, { from: 'tipos', to: 'listas', label: 'exemplo' }, { from: 'tipos', to: 'dic' }],
  }, cliente);

  assert.equal(criado.success, true);
  assert.equal(criado.fluxo.path, 'Estudos/Python.canvas');
  assert.deepEqual(Object.keys(criado.ids), ['raiz', 'tipos', 'listas', 'dic']);
  for (const real of Object.values(criado.ids)) assert.match(real, /^[0-9a-f]{16}$/);
  assert.match(await fs.readFile(path.join(directory, 'Estudos/Python.canvas'), 'utf8'), /^\{\n\t"nodes"/);

  const { nodes, edges } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  const no = a => nodes.find(n => n.id === criado.ids[a]);
  semSobreposicao(nodes);
  assert.ok(no('tipos').x > no('raiz').x + no('raiz').width);
  assert.equal(no('listas').x, no('dic').x);
  for (const n of nodes) assert.ok(n.x % 20 === 0 && n.y % 20 === 0, `${n.id} fora da grade`);
  assert.equal(no('listas').color, '4');
  assert.deepEqual(edges.map(e => [e.from, e.to, e.label]), [
    [criado.ids.raiz, criado.ids.tipos, undefined],
    [criado.ids.tipos, criado.ids.listas, 'exemplo'],
    [criado.ids.tipos, criado.ids.dic, undefined],
  ]);
});

test('create_fluxo respeita x/y dados e posiciona só quem veio sem posição', async t => {
  const { toolkit } = await montar(t);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Solto',
    nodes: [
      { id: 'fixo', type: 'text', text: 'Aqui', x: 1000, y: 500, width: 200, height: 80 },
      { id: 'livre', type: 'group', label: 'Grupo' },
    ],
  }, cliente);
  const { nodes } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  assert.deepEqual(nodes.find(n => n.id === criado.ids.fixo), { id: criado.ids.fixo, type: 'text', text: 'Aqui', x: 1000, y: 500, width: 200, height: 80 });
  const livre = nodes.find(n => n.id === criado.ids.livre);
  assert.equal(livre.label, 'Grupo');
  assert.equal(livre.width, 400);
  semSobreposicao(nodes);
});

test('create_fluxo com sourceNote liga a nota de origem à raiz e grava na pasta dela', async t => {
  const { toolkit } = await montar(t);
  const nota = await toolkit.call('create_note', { title: 'Listas', folder: 'Estudos/Python', content: '# Listas' }, cliente);
  const criado = await toolkit.call('create_fluxo', {
    title: 'Mapa de listas', sourceNote: 'Listas',
    nodes: [{ id: 'raiz', type: 'text', text: 'Listas' }, { id: 'a', type: 'text', text: 'append' }],
    edges: [{ from: 'raiz', to: 'a' }],
  }, cliente);
  assert.equal(criado.fluxo.path, 'Estudos/Python/Mapa de listas.canvas');
  const { nodes, edges } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  const origem = nodes.find(n => n.type === 'note');
  assert.equal(origem.note, nota.note.path);
  assert.ok(edges.some(e => e.from === origem.id && e.to === criado.ids.raiz));
  assert.ok(origem.x + origem.width <= nodes.find(n => n.id === criado.ids.raiz).x);
  semSobreposicao(nodes);
});

test('create_fluxo acha nota por caminho ou título e recusa tudo se alguma não existe', async t => {
  const { toolkit } = await montar(t);
  const a = await toolkit.call('create_note', { title: 'Resumo', folder: 'A', content: 'a' }, cliente);
  const b = await toolkit.call('create_note', { title: 'Resumo', folder: 'B', content: 'b' }, cliente);
  const criado = await toolkit.call('create_fluxo', { title: 'Notas', nodes: [
    { id: 'pelo-caminho', type: 'note', note: b.note.path },
    { id: 'pelo-titulo', type: 'note', note: 'Resumo' },
  ] }, cliente);
  const { nodes } = await lerFluxo(toolkit, { id: criado.fluxo.id });
  assert.equal(nodes.find(n => n.id === criado.ids['pelo-caminho']).note, b.note.path);
  assert.ok([a.note.path, b.note.path].includes(nodes.find(n => n.id === criado.ids['pelo-titulo']).note));

  await assert.rejects(toolkit.call('create_fluxo', { title: 'Faltando', nodes: [
    { id: 'x', type: 'note', note: 'Não existe' }, { id: 'y', type: 'note', note: 'Pasta/Outra.md' },
  ] }, cliente), erro => erro.code === 'NOTE_NOT_FOUND' && erro.details.missing.length === 2);
  assert.equal((await toolkit.call('list_fluxos', {}, cliente)).fluxos.length, 1);
});

test('create_fluxo recusa pedido inválido sem gravar nada', async t => {
  const { toolkit } = await montar(t);
  const um = [{ id: 'a', type: 'text', text: 'A' }];
  const casos = [
    { title: 'x', nodes: [] },
    { title: 'x', nodes: [...um, { id: 'a', type: 'text', text: 'B' }] },
    { title: 'x', nodes: um, edges: [{ from: 'a', to: 'b' }] },
    { title: 'x', nodes: um, edges: [{ from: 'a', to: 'a' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'x'.repeat(5001) }] },
    { title: 'x', nodes: [{ id: 'a', type: 'link', url: 'javascript:alert(1)' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', color: 'red; background:url(x)' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'imagem', text: 'A' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', x: 'longe' }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', x: 10 }] },
    { title: 'x', nodes: [{ id: 'a', type: 'text', text: 'A', extra: 1 }] },
    { title: 'x', nodes: um, root: 'b' },
    { title: 'x', nodes: Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, type: 'text', text: 'x' })) },
  ];
  for (const caso of casos) {
    await assert.rejects(toolkit.call('create_fluxo', caso, cliente), codigo('INVALID_INPUT'), JSON.stringify(caso).slice(0, 80));
  }
  for (const titulo of ['a/b', 'con', 'fim.', '']) {
    await assert.rejects(toolkit.call('create_fluxo', { title: titulo, nodes: um }, cliente), codigo('INVALID_NAME'), titulo);
  }
  assert.equal((await toolkit.call('list_fluxos', {}, cliente)).fluxos.length, 0);
});

test('create_fluxo recusa um segundo fluxo com o mesmo título na mesma pasta, sem mexer no primeiro', async t => {
  const { toolkit, directory } = await montar(t);
  await toolkit.call('create_fluxo', { title: 'Mapa', folder: 'Estudos', nodes: [{ id: 'a', type: 'text', text: 'Primeiro' }] }, cliente);
  const antes = await fs.readFile(path.join(directory, 'Estudos/Mapa.canvas'), 'utf8');
  for (const titulo of ['Mapa', 'mapa']) {
    await assert.rejects(toolkit.call('create_fluxo', { title: titulo, folder: 'Estudos', nodes: [{ id: 'a', type: 'text', text: 'Segundo' }] }, cliente), codigo('FLUXO_EXISTS'));
  }
  assert.equal(await fs.readFile(path.join(directory, 'Estudos/Mapa.canvas'), 'utf8'), antes);
  // Em outra pasta, o mesmo título pode.
  await toolkit.call('create_fluxo', { title: 'Mapa', nodes: [{ id: 'a', type: 'text', text: 'Raiz' }] }, cliente);
});

test('create_fluxo respeita a permissão de criar, é auditado e emite fluxo.created', async t => {
  const { toolkit, config, events, audit } = await montar(t);
  const vistos = [];
  events.on('fluxo.created', carga => vistos.push(carga));
  const criado = await toolkit.call('create_fluxo', { title: 'Evento', nodes: [{ id: 'a', type: 'text', text: 'A' }] }, cliente);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].id, criado.fluxo.id);
  assert.equal(vistos[0].source, 'agent');
  const registro = (await audit.read({ limit: 5 })).find(r => r.action === 'create_fluxo');
  assert.equal(registro.status, 'success');
  assert.equal(registro.target, 'Evento.canvas');

  await config.save({ permissions: { create: false } });
  await assert.rejects(toolkit.call('create_fluxo', { title: 'Negado', nodes: [{ id: 'a', type: 'text', text: 'A' }] }, cliente), codigo('PERMISSION_DENIED'));
});

async function fluxoBase(toolkit) {
  return toolkit.call('create_fluxo', {
    title: 'Base',
    nodes: [{ id: 'raiz', type: 'text', text: 'Raiz' }, { id: 'a', type: 'text', text: 'A', color: '2' }],
    edges: [{ from: 'raiz', to: 'a', label: 'liga' }],
  }, cliente);
}

test('update_fluxo põe cartões novos perto do pai sem mexer em nenhum existente', async t => {
  const { toolkit } = await montar(t);
  const base = await fluxoBase(toolkit);
  const antes = await lerFluxo(toolkit, { id: base.fluxo.id });
  const r = await toolkit.call('update_fluxo', {
    id: base.fluxo.id,
    add_nodes: [{ id: 'b', type: 'text', text: 'B' }, { id: 'b1', type: 'text', text: 'B1' }],
    add_edges: [{ from: base.ids.raiz, to: 'b' }, { from: 'b', to: 'b1' }],
  }, cliente);
  const depois = await lerFluxo(toolkit, { id: base.fluxo.id });
  for (const n of antes.nodes) assert.deepEqual(depois.nodes.find(x => x.id === n.id), n);
  const no = id => depois.nodes.find(n => n.id === id);
  const a = no(base.ids.a), b = no(r.ids.b), b1 = no(r.ids.b1);
  assert.equal(b.x, a.x);
  assert.ok(b.y >= a.y + a.height + 20);
  assert.ok(b1.x > b.x + b.width);
  semSobreposicao(depois.nodes);
  assert.equal(depois.edges.length, 3);
});

test('update_fluxo muda conteúdo e cor, remove cartões com as ligações e remove ligações', async t => {
  const { toolkit } = await montar(t);
  const base = await fluxoBase(toolkit);
  await toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'A editado', color: '' }] }, cliente);
  let lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  const a = lido.nodes.find(n => n.id === base.ids.a);
  assert.equal(a.text, 'A editado');
  assert.equal(a.color, undefined);

  // Texto bem maior sem height: a altura cresce para caber, em vez de ficar clipada.
  const textao = 'linha\n'.repeat(80);
  await toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: textao }] }, cliente);
  lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  const aCrescido = lido.nodes.find(n => n.id === base.ids.a);
  assert.ok(aCrescido.height > 60, `esperava altura maior que 60, veio ${aCrescido.height}`);

  await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, url: 'https://a.b' }] }, cliente), codigo('INVALID_INPUT'));

  await toolkit.call('update_fluxo', { id: base.fluxo.id, remove_edges: [lido.edges[0].id] }, cliente);
  lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  assert.equal(lido.edges.length, 0);
  assert.equal(lido.nodes.length, 2);

  await toolkit.call('update_fluxo', {
    id: base.fluxo.id,
    add_edges: [{ from: base.ids.raiz, to: base.ids.a }],
  }, cliente);
  await toolkit.call('update_fluxo', { id: base.fluxo.id, remove_nodes: [base.ids.a] }, cliente);
  lido = await lerFluxo(toolkit, { id: base.fluxo.id });
  assert.deepEqual(lido.nodes.map(n => n.id), [base.ids.raiz]);
  assert.equal(lido.edges.length, 0);
});

test('update_fluxo preserva campos que o Kiro não conhece num canvas vindo do Obsidian', async t => {
  const { toolkit, directory } = await montar(t);
  await gravarCanvas(directory, 'Obsidian.canvas', {
    nodes: [{ id: 'x1', type: 'text', text: 'Oi', x: 0, y: 0, width: 280, height: 60, obsidianExtra: { a: 1 } }],
    edges: [],
    metadata: { versao: '1.0' },
  });
  const { fluxos } = await toolkit.call('list_fluxos', {}, cliente);
  await toolkit.call('update_fluxo', { id: fluxos[0].id, add_nodes: [{ id: 'n', type: 'text', text: 'Novo' }] }, cliente);
  const disco = JSON.parse(await fs.readFile(path.join(directory, 'Obsidian.canvas'), 'utf8'));
  assert.deepEqual(disco.metadata, { versao: '1.0' });
  assert.deepEqual(disco.nodes[0].obsidianExtra, { a: 1 });
  assert.equal(disco.nodes.length, 2);
});

test('update_fluxo é tudo-ou-nada e recusa fluxo corrompido sem tocar no arquivo', async t => {
  const { toolkit, directory } = await montar(t);
  const base = await fluxoBase(toolkit);
  const arquivo = path.join(directory, 'Base.canvas');
  const bytes = await fs.readFile(arquivo, 'utf8');
  const revisao = (await toolkit.call('get_vault_info', {}, cliente)).revision;
  const recusados = [
    { add_nodes: [{ id: 'ok', type: 'text', text: 'ok' }], add_edges: [{ from: 'ok', to: 'nao-existe' }] },
    { remove_nodes: [base.ids.a], add_edges: [{ from: base.ids.raiz, to: base.ids.a }] },
    { add_nodes: [{ id: base.ids.a, type: 'text', text: 'apelido igual a um id existente' }] },
    { update_nodes: [{ id: 'nao-existe', text: 'x' }] },
    { remove_nodes: ['nao-existe'] },
    { remove_edges: ['nao-existe'] },
    { add_nodes: [{ id: 'n', type: 'note', note: 'Nota que não existe' }] },
    {},
  ];
  for (const pedido of recusados) {
    await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, ...pedido }, cliente), codigo('INVALID_INPUT', 'NOTE_NOT_FOUND'), JSON.stringify(pedido));
  }
  assert.equal(await fs.readFile(arquivo, 'utf8'), bytes);
  assert.equal((await toolkit.call('get_vault_info', {}, cliente)).revision, revisao);

  await gravarCanvas(directory, 'Quebrado.canvas', '{ quebrado');
  const quebrado = (await toolkit.call('list_fluxos', {}, cliente)).fluxos.find(f => f.error);
  await assert.rejects(toolkit.call('update_fluxo', { id: quebrado.id, add_nodes: [{ id: 'n', type: 'text', text: 'x' }] }, cliente), codigo('FLUXO_INVALID'));
  assert.equal(await fs.readFile(path.join(directory, 'Quebrado.canvas'), 'utf8'), '{ quebrado');
});

test('update_fluxo respeita a permissão de alterar e emite fluxo.updated', async t => {
  const { toolkit, config, events } = await montar(t);
  const base = await fluxoBase(toolkit);
  const vistos = [];
  events.on('fluxo.updated', carga => vistos.push(carga.id));
  await toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'x' }] }, cliente);
  assert.deepEqual(vistos, [base.fluxo.id]);
  await config.save({ permissions: { update: false } });
  await assert.rejects(toolkit.call('update_fluxo', { id: base.fluxo.id, update_nodes: [{ id: base.ids.a, text: 'y' }] }, cliente), codigo('PERMISSION_DENIED'));
});

test('tarefas: criar, listar, editar, mudar status e excluir pela API de agentes', async t => {
  const { toolkit, config, events } = await montar(t);
  const vistos = [];
  for (const nome of ['task.created', 'task.updated', 'task.deleted']) events.on(nome, c => vistos.push(nome));
  const nota = await toolkit.call('create_note', { title: 'Plano', content: 'x' }, cliente);

  const criada = await toolkit.call('create_task', { title: 'Ler capítulo 3', due: '2026-10-20', priority: 'Alta', description: 'Páginas 40 a 60', note: 'Plano' }, cliente);
  assert.equal(criada.success, true);
  assert.equal(criada.task.status, 'nao-comecado');
  assert.equal(criada.task.note.id, nota.note.id);

  const padrao = await toolkit.call('create_task', { title: 'Sem nada' }, cliente);
  assert.match(padrao.task.due, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(padrao.task.priority, 'Média');

  let r = await toolkit.call('set_task_status', { id: criada.task.id, status: 'andamento' }, cliente);
  assert.equal(r.task.status, 'andamento');
  r = await toolkit.call('set_task_status', { id: criada.task.id, status: 'pausado' }, cliente);
  assert.equal(r.task.status, 'pausado');
  r = await toolkit.call('set_task_status', { id: criada.task.id, status: 'concluido' }, cliente);
  assert.equal(r.task.done, true);
  r = await toolkit.call('set_task_status', { id: criada.task.id, status: 'andamento' }, cliente);
  assert.equal(r.task.done, false);
  assert.equal(r.task.status, 'andamento');

  r = await toolkit.call('update_task', { id: criada.task.id, title: 'Ler capítulo 4', description: '', note: '', priority: 'Baixa' }, cliente);
  assert.equal(r.task.title, 'Ler capítulo 4');
  assert.equal(r.task.description, '');
  assert.equal(r.task.note, null);
  assert.equal(r.task.priority, 'Baixa');

  const lista = await toolkit.call('list_tasks', { status: 'andamento' }, cliente);
  assert.deepEqual(lista.tasks.map(x => x.title), ['Ler capítulo 4']);
  assert.equal((await toolkit.call('list_tasks', {}, cliente)).tasks.length, 2);

  // Excluir vem desligado, como as notas; ligado, apaga em definitivo (tarefa não tem lixeira).
  await assert.rejects(toolkit.call('delete_task', { id: padrao.task.id }, cliente), codigo('PERMISSION_DENIED'));
  await permitirExclusao(config);
  const apagada = await toolkit.call('delete_task', { id: padrao.task.id }, cliente);
  assert.equal(apagada.deleted.title, 'Sem nada');
  assert.equal((await toolkit.call('list_tasks', {}, cliente)).tasks.length, 1);
  assert.deepEqual([...new Set(vistos)].sort(), ['task.created', 'task.deleted', 'task.updated']);
});

test('tarefas recorrentes pela API persistem próxima ocorrência sem duplicar ao reabrir', async t => {
  const { toolkit, vault } = await montar(t);
  const estado = await vault.load();
  await vault.save({ ...estado, tasks: [{ id: 'recorrente', title: 'Diária', due: '2026-10-25', priority: 'Média', done: false, repeat: { every: 'day' } }] });
  await toolkit.call('set_task_status', { id: 'recorrente', status: 'concluido' }, cliente);
  let salvo = await vault.load();
  assert.equal(salvo.tasks.length, 2);
  const proxima = salvo.tasks.find(t => t.id !== 'recorrente');
  assert.equal(proxima.due, '2026-10-26');
  assert.equal(salvo.tasks.find(t => t.id === 'recorrente').repeatNextId, proxima.id);
  await toolkit.call('set_task_status', { id: 'recorrente', status: 'andamento' }, cliente);
  await toolkit.call('update_task', { id: 'recorrente', status: 'concluido' }, cliente);
  assert.equal((await vault.load()).tasks.length, 2);
  await toolkit.call('update_task', { id: proxima.id, status: 'concluido' }, cliente);
  salvo = await vault.load();
  assert.equal(salvo.tasks.length, 3);
  assert.equal(salvo.tasks.find(t => !t.done).due, '2026-10-27');
});

test('tarefas: entradas inválidas são recusadas com motivo', async t => {
  const { toolkit } = await montar(t);
  await assert.rejects(toolkit.call('create_task', { title: '   ' }, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('create_task', { title: 'x', due: '20/10/2026' }, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('create_task', { title: 'x', priority: 'Urgente' }, cliente), codigo('INVALID_INPUT'));
  await assert.rejects(toolkit.call('create_task', { title: 'x', note: 'Nota que não existe' }, cliente), codigo('NOTE_NOT_FOUND', 'INVALID_INPUT'));
  await assert.rejects(toolkit.call('set_task_status', { id: 'nao-existe', status: 'pausado' }, cliente), codigo('TASK_NOT_FOUND'));
  await assert.rejects(toolkit.call('set_task_status', { id: 'x', status: 'feito' }, cliente), codigo('INVALID_INPUT'));
});
