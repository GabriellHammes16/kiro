'use strict';
// Sobe o servidor MCP de verdade, por stdio, contra um cofre temporário.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const json = resultado => JSON.parse(resultado.content[0].text);

async function conectar(t, { capabilities = {} } = {}) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-mcp-'));
  const cliente = new Client({ name: 'kiro-test-client', version: '1.0.0' }, { capabilities });
  const transporte = new StdioClientTransport({
    command: process.execPath, args: [path.join(__dirname, '..', 'mcp', 'server.mjs'), '--vault', pasta], stderr: 'ignore',
  });
  t.after(async () => {
    await cliente.close().catch(() => {});
    await fs.rm(pasta, { recursive: true, force: true }).catch(() => {});
  });
  return { cliente, pasta, transporte };
}
const configurar = async (pasta, conf) => {
  await fs.mkdir(path.join(pasta, '.kiro'), { recursive: true });
  await fs.writeFile(path.join(pasta, '.kiro', 'agent.json'), JSON.stringify(conf));
};
const CONF = { enabled: true, mcp: { enabled: true }, permissions: { read: true, create: true, update: true, delete: false }, requireConfirmationForDestructive: true };
const erroDe = r => JSON.parse(r.content[0].text).error;

test('recursos MCP obedecem às mesmas permissões das ferramentas', async t => {
  const { cliente, pasta, transporte } = await conectar(t);
  await cliente.connect(transporte);
  const nota = json(await cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'Particular', content: 'PRIVADO' } })).note;
  const uris = ['kiro://vault', 'kiro://daily', `kiro://notes/${nota.id}`];
  assert.match((await cliente.readResource({ uri: uris[2] })).contents[0].text, /PRIVADO/);

  for (const conf of [{ ...CONF, permissions: { ...CONF.permissions, read: false } }, { ...CONF, enabled: false }]) {
    await configurar(pasta, conf);
    for (const uri of uris) await assert.rejects(cliente.readResource({ uri }), /permitir|desligada/, uri);
  }
});

test('interruptor do servidor MCP: desligado não lista nem executa nada', async t => {
  const { cliente, pasta, transporte } = await conectar(t);
  await cliente.connect(transporte);
  const nota = json(await cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'N', content: 'x' } })).note;
  await configurar(pasta, { ...CONF, mcp: { enabled: false } });

  assert.deepEqual((await cliente.listTools()).tools, []);
  assert.deepEqual((await cliente.listResources()).resources, []);
  const chamada = await cliente.callTool({ name: 'kiro_read_note', arguments: { id: nota.id } });
  assert.equal(chamada.isError, true);
  assert.equal(erroDe(chamada), 'MCP_DISABLED');
  await assert.rejects(cliente.readResource({ uri: `kiro://notes/${nota.id}` }), /desligado/);

  await configurar(pasta, CONF);
  assert.ok((await cliente.listTools()).tools.length > 0);
});

test('exclusão pede confirmação ao usuário pelo cliente e recusa quem não consegue perguntar', async t => {
  const comPergunta = await conectar(t, { capabilities: { elicitation: { form: {} } } });
  let resposta = { action: 'decline' };
  const perguntas = [];
  comPergunta.cliente.setRequestHandler(ElicitRequestSchema, async pedido => { perguntas.push(pedido.params.message); return resposta; });
  await comPergunta.cliente.connect(comPergunta.transporte);
  await configurar(comPergunta.pasta, { ...CONF, permissions: { ...CONF.permissions, delete: true } });
  const nota = json(await comPergunta.cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'Minha nota', content: 'x' } })).note;
  const excluir = () => comPergunta.cliente.callTool({ name: 'kiro_delete_note', arguments: { id: nota.id } });

  assert.equal(erroDe(await excluir()), 'CONFIRMATION_DECLINED');
  assert.match(perguntas[0], /Minha nota/);
  resposta = { action: 'accept', content: { confirmar: false } };
  assert.equal(erroDe(await excluir()), 'CONFIRMATION_DECLINED');
  resposta = { action: 'accept', content: { confirmar: true } };
  assert.equal(json(await excluir()).success, true);

  const semPergunta = await conectar(t);
  await semPergunta.cliente.connect(semPergunta.transporte);
  const outra = json(await semPergunta.cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'Outra', content: 'x' } })).note;
  await configurar(semPergunta.pasta, { ...CONF, permissions: { ...CONF.permissions, delete: true } });
  const recusa = await semPergunta.cliente.callTool({ name: 'kiro_delete_note', arguments: { id: outra.id } });
  assert.equal(erroDe(recusa), 'CONFIRMATION_UNAVAILABLE');
});

test('nota gigante volta como erro legível e o servidor continua de pé', async t => {
  const { cliente, transporte } = await conectar(t);
  await cliente.connect(transporte);
  for (const mb of [5, 11, 30]) {
    const r = await cliente.callTool({ name: 'kiro_create_note', arguments: { title: `G${mb}`, content: 'x'.repeat(mb * 1024 * 1024) } }, undefined, { timeout: 30000 });
    assert.equal(r.isError, true, `${mb} MB`);
    assert.match(r.content[0].text, /passa de 1000000/);
  }
  assert.equal(json(await cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'Depois', content: 'ok' } })).success, true);
});

test('mensagem acima do teto do transporte encerra o servidor em vez de travar o cliente', async t => {
  const { cliente, transporte } = await conectar(t);
  await cliente.connect(transporte);
  const inicio = Date.now();
  await assert.rejects(
    cliente.callTool({ name: 'kiro_create_note', arguments: { title: 'Enorme', content: 'x'.repeat(70 * 1024 * 1024) } }, undefined, { timeout: 60000 }),
    /Connection closed/,
  );
  assert.ok(Date.now() - inicio < 30000);
});

test('servidor MCP publica as ferramentas e opera o cofre por stdio', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-mcp-'));
  const cliente = new Client({ name: 'kiro-test-client', version: '1.0.0' }, { capabilities: {} });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'mcp', 'server.mjs'), '--vault', directory],
    stderr: 'ignore',
  });
  t.after(async () => {
    await cliente.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  });
  await cliente.connect(transporte);

  const { tools } = await cliente.listTools();
  const nomes = tools.map(f => f.name);
  for (const esperada of ['kiro_create_note', 'kiro_read_note', 'kiro_update_note', 'kiro_delete_note',
    'kiro_search_notes', 'kiro_list_notes', 'kiro_create_folder', 'kiro_list_folders', 'kiro_move_note',
    'kiro_get_backlinks', 'kiro_get_outgoing_links', 'kiro_get_recent_notes',
    'kiro_list_fluxos', 'kiro_read_fluxo', 'kiro_create_fluxo', 'kiro_update_fluxo', 'kiro_list_attachments', 'kiro_add_attachment',
    'kiro_list_tasks', 'kiro_create_task', 'kiro_update_task', 'kiro_set_task_status', 'kiro_delete_task']) {
    assert.ok(nomes.includes(esperada), `faltou a tool ${esperada}`);
  }
  // nenhuma ferramenta genérica de sistema é publicada
  assert.ok(!nomes.some(n => /shell|exec|any_file/.test(n)));

  const leitura = tools.find(f => f.name === 'kiro_read_note');
  assert.equal(leitura.annotations.readOnlyHint, true);
  assert.equal(tools.find(f => f.name === 'kiro_delete_note').annotations.destructiveHint, true);
  assert.equal(leitura.inputSchema.type, 'object');
  assert.equal(tools.find(f => f.name === 'kiro_list_attachments').annotations.readOnlyHint, true);

  // anexo por conteúdo, listado e posto num fluxo como cartão de arquivo recolhido
  const pdf = json(await cliente.callTool({ name: 'kiro_add_attachment', arguments: { name: 'livro.pdf', data_base64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') } }));
  assert.equal(pdf.type, 'pdf');
  assert.deepEqual(json(await cliente.callTool({ name: 'kiro_list_attachments', arguments: { type: 'pdf' } })).attachments.map(a => a.path), [pdf.path]);
  const mapa = json(await cliente.callTool({ name: 'kiro_create_fluxo', arguments: { title: 'Leitura', nodes: [{ id: 'p', type: 'file', file: pdf.path }] } }));
  const cartoes = json(await cliente.callTool({ name: 'kiro_read_fluxo', arguments: { id: mapa.fluxo.id } })).nodes;
  assert.deepEqual(cartoes, [{ id: mapa.ids.p, type: 'file', file: pdf.path, collapsed: true }]);

  // fluxo completo: criar, buscar, acrescentar e ler
  const criada = json(await cliente.callTool({
    name: 'kiro_create_note',
    arguments: { title: 'Ideias para o canal', folder: 'Projetos/Mico', content: 'Primeira ideia.', tags: ['canal'] },
  }));
  assert.equal(criada.success, true);
  assert.match(criada.note.path, /^Projetos\/Mico\//);

  const busca = json(await cliente.callTool({ name: 'kiro_search_notes', arguments: { query: 'primeira ideia' } }));
  assert.equal(busca.total, 1);

  json(await cliente.callTool({
    name: 'kiro_update_note',
    arguments: { id: criada.note.id, content: 'Segunda ideia.', mode: 'append' },
  }));
  const lida = json(await cliente.callTool({ name: 'kiro_read_note', arguments: { id: criada.note.id } }));
  assert.equal(lida.content, 'Primeira ideia.\n\nSegunda ideia.');

  // o arquivo existe mesmo no disco
  assert.match(await fs.readFile(path.join(directory, criada.note.path), 'utf8'), /Segunda ideia\./);

  // tarefas: criar ligada à nota, pôr em andamento, concluir — e ficam gravadas no cofre
  const tarefa = json(await cliente.callTool({ name: 'kiro_create_task', arguments: { title: 'Gravar vídeo', note: criada.note.path, priority: 'Alta' } }));
  assert.equal(tarefa.task.note.id, criada.note.id);
  assert.equal(json(await cliente.callTool({ name: 'kiro_set_task_status', arguments: { id: tarefa.task.id, status: 'andamento' } })).task.status, 'andamento');
  assert.equal(json(await cliente.callTool({ name: 'kiro_set_task_status', arguments: { id: tarefa.task.id, status: 'concluido' } })).task.done, true);
  const noDisco = JSON.parse(await fs.readFile(path.join(directory, 'caderno.json'), 'utf8')).tasks;
  assert.deepEqual(noDisco.map(x => [x.title, x.done, x.status]), [['Gravar vídeo', true, 'andamento']]);

  // erro de ferramenta volta legível, sem derrubar a conexão
  const recusa = await cliente.callTool({ name: 'kiro_read_note', arguments: { path: '../fora.md' } });
  assert.equal(recusa.isError, true);
  assert.equal(JSON.parse(recusa.content[0].text).error, 'PATH_TRAVERSAL');

  // exclusão vem desligada por padrão na configuração
  const semPermissao = await cliente.callTool({ name: 'kiro_delete_note', arguments: { id: criada.note.id } });
  assert.equal(semPermissao.isError, true);
  assert.equal(JSON.parse(semPermissao.content[0].text).error, 'PERMISSION_DENIED');

  // recursos de leitura
  const { resources } = await cliente.listResources();
  assert.ok(resources.some(r => r.uri === 'kiro://vault'));
  const cofre = JSON.parse((await cliente.readResource({ uri: 'kiro://vault' })).contents[0].text);
  assert.equal(cofre.noteCount, 1);

  // a auditoria registrou o cliente que se identificou no handshake
  const registros = (await fs.readFile(path.join(directory, '.kiro', 'audit.log'), 'utf8'))
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.ok(registros.some(r => r.action === 'create_note' && r.client === 'kiro-test-client' && r.status === 'success'));
  assert.ok(registros.some(r => r.action === 'delete_note' && r.status === 'error' && r.errorCode === 'PERMISSION_DENIED'));
});
