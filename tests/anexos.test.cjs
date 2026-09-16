const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Vault } = require('../vault.cjs');
const domain = require('../domain.js');

// PNG válido de 1x1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
const nota = (extra = {}) => ({ id: 'nota-1', title: 'Com imagem', body: 'Texto', links: [], tags: [], folderId: '', updatedAt: Date.now(), ...extra });
async function cofre(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-anexos-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new Vault(directory);
}

test('imagem colada vai para Anexos sem virar pasta, sem mudar a revisão e sem ir para o histórico', async t => {
  const vault = await cofre(t);
  const antes = await vault.save({ ...(await vault.load()), notes: [nota()] });
  const { path: caminho } = await vault.saveAttachment({ name: 'image.png', data: PNG });
  assert.match(caminho, /^Anexos\/colado-\d{8}-\d{6}-[0-9a-f]{6}\.png$/);
  assert.deepEqual(await fs.readFile(path.join(vault.directory, caminho)), PNG);

  const depois = await vault.load();
  assert.equal(depois.revision, antes.revision, 'colar não pode gerar conflito com a nota aberta');
  assert.deepEqual(depois.folders, []);

  const salvo = await vault.save({ ...depois, notes: [nota({ body: `Olha: ![[${caminho}|320]]` })] });
  assert.equal(salvo.notes[0].body, `Olha: ![[${caminho}|320]]`);
  assert.deepEqual(await fs.readFile(path.join(vault.directory, caminho)), PNG);
  for (const entrada of await fs.readdir(path.join(vault.directory, '.history')))
    await assert.rejects(fs.access(path.join(vault.directory, '.history', entrada, 'Anexos')));

  const lido = await vault.readAttachment(caminho);
  assert.equal(lido.type, 'image/png');
  assert.deepEqual(lido.data, PNG);
});

test('nome de arquivo arrastado vira slug; conteúdo e caminhos perigosos são recusados', async t => {
  const vault = await cofre(t);
  assert.match((await vault.saveAttachment({ name: 'Diagrama Final (v2).png', data: PNG })).path, /^Anexos\/diagrama-final-v2-[0-9a-f]{6}\.png$/);
  assert.match((await vault.saveAttachment({ name: '../../fora.png', data: PNG })).path, /^Anexos\/fora-[0-9a-f]{6}\.png$/);
  await assert.rejects(vault.saveAttachment({ name: 'x.png', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }), /não é uma imagem/);
  await assert.rejects(vault.saveAttachment({ name: 'x.png', data: Buffer.alloc(0) }), /vazia/);
  await assert.rejects(vault.saveAttachment({ data: Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]) }), /20 MB/);
  for (const ruim of ['../fora.png', 'Anexos/../../fora.png', '.history/x.png', 'caderno.json', 'Anexos/.kiro-anexos', 'C:/Windows/x.png'])
    await assert.rejects(vault.readAttachment(ruim), `aceitou ${ruim}`);
});

test('pasta "Anexos" que já é do usuário continua sendo pasta de notas; imagens vão para outra', async t => {
  const vault = await cofre(t);
  await vault.save({ ...(await vault.load()), folders: [{ id: 'pasta-anexos', title: 'Anexos', parentId: '' }], notes: [nota({ folderId: 'pasta-anexos' })] });
  const { path: caminho } = await vault.saveAttachment({ data: PNG });
  assert.match(caminho, /^Anexos do KIRO\//);
  const depois = await vault.load();
  assert.deepEqual(depois.folders.map(f => f.title), ['Anexos']);
  assert.equal(depois.notes[0].folderId, depois.folders[0].id);
});

test('não dá para criar pasta com o nome da pasta de imagens', async t => {
  const vault = await cofre(t);
  await vault.saveAttachment({ data: PNG });
  await assert.rejects(vault.save({ ...(await vault.load()), folders: [{ id: 'nova', title: 'Anexos', parentId: '' }] }), /guarda as imagens/);
});

test('imagem embutida não conta como ligação entre notas', () => {
  assert.deepEqual(domain.wikiLinks('![[Anexos/a.png|300]] e [[Nota]] e ![[Outra nota]]').map(l => l.target), ['Nota', 'Outra nota']);
  assert.equal(domain.isImagePath('Anexos/Print.PNG'), true);
  assert.equal(domain.isImagePath('Anexos/x.svg'), false);
});

test('servidor recebe imagem colada e só devolve imagens de dentro do cofre', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-anexos-http-'));
  const port = 14000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), KIRO_VAULT: directory }, windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null) { const parou = new Promise(resolve => child.once('exit', resolve)); child.kill(); await parou; }
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('Servidor não iniciou')), 8000);
    child.stdout.once('data', () => { clearTimeout(limite); resolve(); });
    child.once('exit', code => { clearTimeout(limite); reject(new Error(`Servidor terminou: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base + '/api/anexo', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'oi' })).status, 415);
  assert.equal((await fetch(base + '/api/anexo', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: 'https://evil.example' }, body: PNG })).status, 403);

  const enviada = await fetch(base + '/api/anexo', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Kiro-Nome': encodeURIComponent('Captura de tela.png') }, body: PNG });
  assert.equal(enviada.status, 200);
  const { path: caminho } = await enviada.json();
  assert.match(caminho, /^Anexos\/captura-de-tela-[0-9a-f]{6}\.png$/);

  const imagem = await fetch(base + '/anexo/' + caminho.split('/').map(encodeURIComponent).join('/'));
  assert.equal(imagem.status, 200);
  assert.equal(imagem.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imagem.arrayBuffer()), PNG);
  for (const ruim of ['/anexo/..%2Fcaderno.json', '/anexo/caderno.json', '/anexo/%2E%2E/x.png', '/anexo/.history/x.png'])
    assert.equal((await fetch(base + ruim)).status, 404, ruim);
});
