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
