const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Vault } = require('../vault.cjs');
const domain = require('../domain.js');

test('áudio WAV e MP3 usam assinatura e leitura por intervalo', async t => {
  const vault=await cofre(t), wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.from('som')]);
  const caminho=(await vault.saveAttachment({name:'voz.wav',data:wav})).path;
  const lido=await vault.readAttachment(caminho);assert.equal(lido.type,'audio/wav');
  const parte=require('../vault.cjs').attachmentRange(lido.data,'bytes=2-5');assert.equal(parte.status,206);assert.deepEqual(parte.data,wav.subarray(2,6));
  assert.equal(require('../vault.cjs').attachmentRange(wav,'bytes=999-').status,416);
  assert.match((await vault.saveAttachment({name:'musica.mp3',data:Buffer.from('ID3\x04\x00\x00')})).path,/\.mp3$/);
  await assert.rejects(vault.saveAttachment({name:'falso.webm',data:Buffer.from('não é áudio')}));
});

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
  await assert.rejects(vault.saveAttachment({ data: Buffer.concat([PNG, Buffer.alloc(250 * 1024 * 1024)]) }), /250 MB/);
  for (const ruim of ['../fora.png', 'Anexos/../../fora.png', '.history/x.png', 'caderno.json', 'Anexos/.kiro-anexos', 'C:/Windows/x.png'])
    await assert.rejects(vault.readAttachment(ruim), `aceitou ${ruim}`);
});

test('pasta "Anexos" que já é do usuário continua sendo pasta de notas; imagens vão para outra', async t => {
  const vault = await cofre(t);
  await vault.save({ ...(await vault.load()), folders: [{ id: 'pasta-anexos', title: 'Anexos', parentId: '' }], notes: [nota({ folderId: 'pasta-anexos' })] });
  const { path: caminho } = await vault.saveAttachment({ data: PNG });
  assert.match(caminho, /^Anexos do Kiro\//);
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
  assert.equal(domain.isPdfPath('Anexos/Aula.PDF'), true);
  assert.deepEqual(domain.lerPdf('Anexos/Aula.pdf#page=4|500'), { arquivo: 'Anexos/Aula.pdf', pagina: 4, altura: 500 });
  assert.deepEqual(domain.wikiLinks('![[Anexos/Aula.pdf#page=2]] e [[Nota]]').map(l => l.target), ['Nota']);
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
  assert.equal((await fetch(base + '/api/anexo', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: 'oi' })).status, 415);
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

test('texto, tabela, M4A e MP4 são conferidos pelo conteúdo', async t => {
  const vault = await cofre(t);
  const txt = (await vault.saveAttachment({ name: 'notas.txt', data: Buffer.from('olá\nmundo') })).path;
  assert.match(txt, /\.txt$/);
  assert.equal((await vault.readAttachment(txt)).type, 'text/plain; charset=utf-8');
  const csv = (await vault.saveAttachment({ name: 'tabela.csv', data: Buffer.from('a,b\n1,2') })).path;
  assert.match(csv, /\.csv$/);
  assert.equal((await vault.readAttachment(csv)).type, 'text/csv; charset=utf-8');
  // Um .md não pode virar nota na árvore: é gravado como .txt.
  assert.match((await vault.saveAttachment({ name: 'ideia.md', data: Buffer.from('# oi') })).path, /\.txt$/);
  await assert.rejects(vault.saveAttachment({ name: 'falso.txt', data: Buffer.from([0x00, 0x01, 0xff]) }));
  await assert.rejects(vault.saveAttachment({ name: 'ruim.txt', data: Buffer.from([0xc3, 0x28]) }));
  await assert.rejects(vault.saveAttachment({ name: 'x.txt', data: Buffer.alloc(5 * 1024 * 1024 + 1, 0x61) }));
  assert.match((await vault.saveAttachment({ name: 'x.txt', data: Buffer.alloc(5 * 1024 * 1024, 0x61) })).path, /\.txt$/);
  const caixa = marca => Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp' + marca), Buffer.alloc(8)]);
  const m4a = (await vault.saveAttachment({ name: 'voz', data: caixa('M4A ') })).path;
  assert.match(m4a, /\.m4a$/);
  assert.equal((await vault.readAttachment(m4a)).type, 'audio/mp4');
  const mp4 = (await vault.saveAttachment({ name: 'filme', data: caixa('isom') })).path;
  assert.match(mp4, /\.mp4$/);
  assert.equal((await vault.readAttachment(mp4)).type, 'video/mp4');
  // Assinatura binária vence a extensão.
  assert.match((await vault.saveAttachment({ name: 'foto.txt', data: PNG })).path, /\.png$/);
  // Na leitura, o conteúdo é conferido de novo.
  await fs.writeFile(path.join(vault.directory, mp4), Buffer.from('nada'));
  await assert.rejects(vault.readAttachment(mp4));
  await fs.writeFile(path.join(vault.directory, txt), Buffer.from([0x00, 0x01]));
  await assert.rejects(vault.readAttachment(txt));
});
