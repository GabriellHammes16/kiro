'use strict';
// Sobe o servidor MCP de verdade, por stdio, contra um cofre temporário.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const json = resultado => JSON.parse(resultado.content[0].text);

test('servidor MCP publica as ferramentas e opera o cofre por stdio', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kuroi-mcp-'));
  const cliente = new Client({ name: 'kuroi-test-client', version: '1.0.0' }, { capabilities: {} });
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
  for (const esperada of ['kuroi_create_note', 'kuroi_read_note', 'kuroi_update_note', 'kuroi_delete_note',
    'kuroi_search_notes', 'kuroi_list_notes', 'kuroi_create_folder', 'kuroi_list_folders', 'kuroi_move_note',
    'kuroi_get_backlinks', 'kuroi_get_outgoing_links', 'kuroi_get_recent_notes']) {
    assert.ok(nomes.includes(esperada), `faltou a tool ${esperada}`);
  }
  // nenhuma ferramenta genérica de sistema é publicada
  assert.ok(!nomes.some(n => /shell|exec|any_file/.test(n)));

  const leitura = tools.find(f => f.name === 'kuroi_read_note');
  assert.equal(leitura.annotations.readOnlyHint, true);
  assert.equal(tools.find(f => f.name === 'kuroi_delete_note').annotations.destructiveHint, true);
  assert.equal(leitura.inputSchema.type, 'object');

  // fluxo completo: criar, buscar, acrescentar e ler
  const criada = json(await cliente.callTool({
    name: 'kuroi_create_note',
    arguments: { title: 'Ideias para o canal', folder: 'Projetos/Mico', content: 'Primeira ideia.', tags: ['canal'] },
  }));
  assert.equal(criada.success, true);
  assert.match(criada.note.path, /^Projetos\/Mico\//);

  const busca = json(await cliente.callTool({ name: 'kuroi_search_notes', arguments: { query: 'primeira ideia' } }));
  assert.equal(busca.total, 1);

  json(await cliente.callTool({
    name: 'kuroi_update_note',
    arguments: { id: criada.note.id, content: 'Segunda ideia.', mode: 'append' },
  }));
  const lida = json(await cliente.callTool({ name: 'kuroi_read_note', arguments: { id: criada.note.id } }));
  assert.equal(lida.content, 'Primeira ideia.\n\nSegunda ideia.');

  // o arquivo existe mesmo no disco
  assert.match(await fs.readFile(path.join(directory, criada.note.path), 'utf8'), /Segunda ideia\./);

  // erro de ferramenta volta legível, sem derrubar a conexão
  const recusa = await cliente.callTool({ name: 'kuroi_read_note', arguments: { path: '../fora.md' } });
  assert.equal(recusa.isError, true);
  assert.equal(JSON.parse(recusa.content[0].text).error, 'PATH_TRAVERSAL');

  // exclusão vem desligada por padrão na configuração
  const semPermissao = await cliente.callTool({ name: 'kuroi_delete_note', arguments: { id: criada.note.id } });
  assert.equal(semPermissao.isError, true);
  assert.equal(JSON.parse(semPermissao.content[0].text).error, 'PERMISSION_DENIED');

  // recursos de leitura
  const { resources } = await cliente.listResources();
  assert.ok(resources.some(r => r.uri === 'kuroi://vault'));
  const cofre = JSON.parse((await cliente.readResource({ uri: 'kuroi://vault' })).contents[0].text);
  assert.equal(cofre.noteCount, 1);

  // a auditoria registrou o cliente que se identificou no handshake
  const registros = (await fs.readFile(path.join(directory, '.kuroi', 'audit.log'), 'utf8'))
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.ok(registros.some(r => r.action === 'create_note' && r.client === 'kuroi-test-client' && r.status === 'success'));
  assert.ok(registros.some(r => r.action === 'delete_note' && r.status === 'error' && r.errorCode === 'PERMISSION_DENIED'));
});
