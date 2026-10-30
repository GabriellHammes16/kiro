// Testes do backup e espelho automáticos (backup.cjs e agendador-backup.cjs).
// Tudo em pastas temporárias; nenhum cofre real nem pasta do usuário são tocados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Vault } = require('../vault.cjs');
const backup = require('../backup.cjs');
const { criarAgendadorDeBackup } = require('../agendador-backup.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');

async function pastaTemp(t, prefixo = 'kiro-bkp-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefixo));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

// Lê as entradas de um arquivo .zip clássico gerado por gravarZip.
async function lerZip(arquivo) {
  const buf = await fs.readFile(arquivo);
  const saida = new Map();
  let pos = 0;
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const metodo = buf.readUInt16LE(pos + 8);
    const crcEsperado = buf.readUInt32LE(pos + 14);
    const compLen = buf.readUInt32LE(pos + 18);
    const uncompLen = buf.readUInt32LE(pos + 22);
    const nomeLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const nome = buf.subarray(pos + 30, pos + 30 + nomeLen).toString('utf8');
    const inicioDados = pos + 30 + nomeLen + extraLen;
    const fatia = buf.subarray(inicioDados, inicioDados + compLen);
    const dados = metodo === 0 ? Buffer.from(fatia) : zlib.inflateRawSync(fatia);
    assert.equal(dados.length, uncompLen);
    assert.equal(backup.crc32(dados), crcEsperado);
    saida.set(nome, dados);
    pos = inicioDados + compLen;
  }
  return saida;
}

test('normalizarConfig aplica limites e valores padrão com segurança', () => {
  const cfg = backup.normalizarConfig({
    ligado: 'sim',
    destino: '  C:\\Drive  ',
    espelho: false,
    copias: {
      horas: { ligado: true, intervalo: 99, manter: 0 },
      diaria: { ligado: false, manter: 500 },
      semanal: { ligado: true, dia: 9, manter: -3 },
      mensal: { manter: 'abc' },
    },
  });
  assert.equal(cfg.ligado, false);
  assert.equal(cfg.destino, 'C:\\Drive');
  assert.equal(cfg.espelho, false);
  assert.deepEqual(cfg.copias.horas, { ligado: true, intervalo: 24, manter: 1 });
  assert.deepEqual(cfg.copias.diaria, { ligado: false, manter: 60 });
  assert.deepEqual(cfg.copias.semanal, { ligado: true, dia: 6, manter: 1 });
  assert.deepEqual(cfg.copias.mensal, { ligado: true, manter: 12 });
});

test('copiasAtrasadas respeita intervalos de horas, dia, semana e mês', () => {
  const cfg = backup.normalizarConfig({
    ligado: true,
    copias: {
      horas: { ligado: true, intervalo: 4, manter: 5 },
      diaria: { ligado: true, manter: 7 },
      semanal: { ligado: true, dia: 1, manter: 4 }, // segunda-feira
      mensal: { ligado: true, manter: 12 },
    },
  });
  // Quarta-feira, 14 de outubro de 2026, 15:00 local
  const agora = new Date(2026, 9, 14, 15, 0, 0);
  assert.deepEqual(backup.copiasAtrasadas(cfg, {}, agora), ['horas', 'diaria', 'semanal', 'mensal']);

  const ultimas = {
    horas: new Date(2026, 9, 14, 12, 0, 0).getTime(),   // há 3h (< 4h)
    diaria: new Date(2026, 9, 14, 8, 0, 0).getTime(),   // hoje cedo
    semanal: new Date(2026, 9, 12, 9, 0, 0).getTime(),  // segunda desta semana
    mensal: new Date(2026, 9, 1, 10, 0, 0).getTime(),   // dia 1 deste mês
  };
  assert.deepEqual(backup.copiasAtrasadas(cfg, ultimas, agora), []);

  // Passaram 5 horas e a última semanal foi antes de segunda-feira
  ultimas.horas = new Date(2026, 9, 14, 10, 0, 0).getTime();
  ultimas.semanal = new Date(2026, 9, 11, 22, 0, 0).getTime();
  assert.deepEqual(backup.copiasAtrasadas(cfg, ultimas, agora), ['horas', 'semanal']);
});

test('resolverRaiz bloqueia destinos perigosos e isola cofres com o mesmo nome', async t => {
  const base = await pastaTemp(t);
  const cofreA = path.join(base, 'a', 'meu-cofre');
  const cofreB = path.join(base, 'b', 'meu-cofre');
  const destino = path.join(base, 'drive');
  await fs.mkdir(cofreA, { recursive: true });
  await fs.mkdir(cofreB, { recursive: true });
  await fs.mkdir(destino, { recursive: true });

  await assert.rejects(() => backup.resolverRaiz(cofreA, ''), /pasta de destino/);
  await assert.rejects(() => backup.resolverRaiz(cofreA, 'relativo/drive'), /caminho completo/);
  await assert.rejects(() => backup.resolverRaiz(cofreA, path.join(cofreA, 'sub')), /dentro do cofre/);
  await assert.rejects(() => backup.resolverRaiz(cofreA, path.dirname(cofreA)), /dentro da pasta de destino/);

  const raizA = await backup.resolverRaiz(cofreA, destino);
  const raizB = await backup.resolverRaiz(cofreB, destino);
  assert.notEqual(raizA, raizB);
  assert.equal(await backup.resolverRaiz(cofreA, destino), raizA);
});

test('espelhar copia notas e anexos de forma incremental, omite caderno.json e ocultos e protege contra cofre vazio', async t => {
  const dirCofre = await pastaTemp(t);
  const dirDrive = await pastaTemp(t);
  const vault = new Vault(dirCofre);
  let estado = await vault.load();
  const anexo = await vault.saveAttachment({ name: 'foto.png', data: PNG });
  const agora = Date.now();
  estado = await vault.save({
    ...estado,
    folders: [{ id: 'f-estudos', title: 'Estudos', parentId: '', description: '', color: 'azul' }],
    notes: [
      { id: 'n-1', title: 'Nota Um', body: `Texto com ![[${anexo.path}]]`, tags: ['teste'], links: [], folderId: 'f-estudos', createdAt: agora, updatedAt: agora },
      { id: 'n-2', title: 'Nota Dois', body: 'Outra nota', tags: [], links: [], folderId: '', createdAt: agora, updatedAt: agora },
    ],
    tasks: [{ id: 't-1', title: 'Tarefa', due: '2026-10-30', priority: 'Média', noteId: '', done: false }],
  });

  const raiz = await backup.resolverRaiz(dirCofre, dirDrive);
  const r1 = await backup.espelhar(dirCofre, raiz);
  assert.equal(r1.copiados, 3); // 2 notas + 1 anexo
  assert.equal(r1.removidos, 0);

  // Segunda chamada sem alterações não recopia nada
  const r2 = await backup.espelhar(dirCofre, raiz);
  assert.equal(r2.copiados, 0);
  assert.equal(r2.removidos, 0);

  // caderno.json e pastas ocultas não entram no espelho
  await assert.rejects(() => fs.stat(path.join(raiz, 'espelho', 'caderno.json')));
  await assert.rejects(() => fs.stat(path.join(raiz, 'espelho', '.history')));

  // Apagar uma nota do cofre remove do espelho
  await vault.save({
    ...estado,
    notes: [estado.notes[0]],
  });
  const r3 = await backup.espelhar(dirCofre, raiz);
  assert.equal(r3.removidos, 1);

  // Se o cofre ficar totalmente vazio por acidente, o espelho não apaga a cópia
  const cofreVazio = await pastaTemp(t);
  await assert.rejects(() => backup.espelhar(cofreVazio, raiz), /parece vazio/);
});

test('gerarCopia cria .zip íntegro e rotacionar mantém apenas a quantidade escolhida', async t => {
  const dirCofre = await pastaTemp(t);
  const dirDrive = await pastaTemp(t);
  const vault = new Vault(dirCofre);
  let estado = await vault.load();
  const anexo = await vault.saveAttachment({ name: 'diagrama.png', data: PNG });
  const agoraMs = Date.now();
  await vault.save({
    ...estado,
    notes: [{ id: 'n-zip', title: 'Nota no Zip', body: 'Conteúdo importante '.repeat(20), tags: [], links: [], folderId: '', createdAt: agoraMs, updatedAt: agoraMs }],
    tasks: [{ id: 't-zip', title: 'Comprar café', due: '2026-10-30', priority: 'Baixa', noteId: '', done: false }],
  });

  const raiz = await backup.resolverRaiz(dirCofre, dirDrive);
  const datas = [
    new Date(2026, 9, 10, 12, 0),
    new Date(2026, 9, 11, 12, 0),
    new Date(2026, 9, 12, 12, 0),
  ];
  let ultima;
  for (const agora of datas) {
    ultima = await backup.gerarCopia(dirCofre, raiz, 'diaria', { agora, manter: 2, exclusivo: op => vault.exclusive(op) });
  }

  const arquivosNaPasta = (await fs.readdir(path.join(raiz, 'copias', 'diaria'))).sort();
  assert.deepEqual(arquivosNaPasta, ['kiro-2026-10-11.zip', 'kiro-2026-10-12.zip']);

  const entradas = await lerZip(ultima.arquivo);
  assert.ok(entradas.has('caderno.json'));
  assert.ok(entradas.has(anexo.path));
  assert.ok([...entradas.keys()].some(k => k.endsWith('.md')));
  assert.ok(![...entradas.keys()].some(k => k.startsWith('.history/') || k.startsWith('.trash/')));
});

test('agendador salva configuração fora do cofre, executa backup e registra erros', async t => {
  const dirCofre = await pastaTemp(t);
  const dirDrive = await pastaTemp(t);
  const dirConfig = await pastaTemp(t);
  const vault = new Vault(dirCofre);
  const estadoInicial = await vault.load();
  const agoraMs = Date.now();
  await vault.save({
    ...estadoInicial,
    notes: [{ id: 'n-ag', title: 'Agenda', body: 'Texto', tags: [], links: [], folderId: '', createdAt: agoraMs, updatedAt: agoraMs }],
  });

  const agendador = criarAgendadorDeBackup({
    arquivo: path.join(dirConfig, 'backup.json'),
    obterCofre: () => vault,
    atrasoInicialMs: 0,
    intervaloChecagemMs: 0,
    atrasoEspelhoMs: 20,
    relogio: () => new Date(2026, 9, 20, 10, 0, 0),
  });

  await agendador.salvarConfig({
    ligado: true,
    destino: dirDrive,
    espelho: true,
    copias: {
      horas: { ligado: false, intervalo: 6, manter: 4 },
      diaria: { ligado: true, manter: 3 },
      semanal: { ligado: false, dia: 0, manter: 4 },
      mensal: { ligado: false, manter: 12 },
    },
  });
  await agendador.aguardarFila();

  const status1 = await agendador.obterStatus();
  assert.ok(status1.estado.ultimoEspelho > 0);
  assert.ok(status1.estado.ultimasCopias.diaria > 0);
  assert.equal(status1.estado.ultimoErro, '');

  // Execução manual sob demanda
  const status2 = await agendador.executarAgora({ espelho: true, copia: true });
  assert.ok(status2.estado.ultimasCopias.manual > 0);
  agendador.parar();
});

test('modo nuvem: OAuth local, espelho incremental e rotação de .zip direto na API do Google Drive', async t => {
  const http = require('node:http');
  const dirCofre = await pastaTemp(t);
  const dirConfig = await pastaTemp(t);
  const vault = new Vault(dirCofre);
  let estado = await vault.load();
  const agoraMs = Date.now();
  estado = await vault.save({
    ...estado,
    notes: [
      { id: 'n-nuvem-1', title: 'Nota Nuvem 1', body: 'Conteúdo na nuvem', tags: [], links: [], folderId: '', createdAt: agoraMs, updatedAt: agoraMs },
      { id: 'n-nuvem-2', title: 'Nota Nuvem 2', body: 'Segunda nota', tags: [], links: [], folderId: '', createdAt: agoraMs, updatedAt: agoraMs },
    ],
  });

  // Simulador em memória da API do Google Drive v3 + OAuth2
  let seqId = 1;
  const arquivosDrive = new Map(); // id -> { id, name, mimeType, parents, appProperties, dados }
  const responderJson = (status, obj) => ({
    status,
    headers: {},
    body: Buffer.from(JSON.stringify(obj)),
    text: () => JSON.stringify(obj),
    json: () => obj,
  });

  const requisitarFalso = async (url, opcoes = {}) => {
    const u = new URL(url);
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
      return responderJson(200, { access_token: 'tok-acesso', refresh_token: 'tok-refresh' });
    }
    if (u.pathname === '/drive/v3/about') {
      return responderJson(200, { user: { emailAddress: 'gabriel@example.com' } });
    }
    if (u.pathname === '/drive/v3/files' && (!opcoes.method || opcoes.method === 'GET')) {
      const q = u.searchParams.get('q') || '';
      const parentMatch = q.match(/'([^']+)' in parents/);
      const parentId = parentMatch ? parentMatch[1] : '';
      const soPastas = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      const semPastas = q.includes("mimeType != 'application/vnd.google-apps.folder'");
      const nomeMatch = q.match(/name = '([^']+)'/);
      const lista = [...arquivosDrive.values()].filter(f => {
        if (parentId && !f.parents.includes(parentId)) return false;
        if (soPastas && f.mimeType !== 'application/vnd.google-apps.folder') return false;
        if (semPastas && f.mimeType === 'application/vnd.google-apps.folder') return false;
        if (nomeMatch && f.name !== nomeMatch[1]) return false;
        return true;
      });
      return responderJson(200, { files: lista });
    }
    if (u.pathname === '/drive/v3/files' && opcoes.method === 'POST') {
      const meta = JSON.parse(String(opcoes.body));
      const id = `drv-${seqId++}`;
      const item = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], appProperties: meta.appProperties || {} };
      arquivosDrive.set(id, item);
      return responderJson(200, item);
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      const textoCorpo = opcoes.body.toString('utf8');
      const jsonMatch = textoCorpo.match(/Content-Type: application\/json[^\r\n]*\r\n\r\n([\s\S]*?)\r\n--/);
      const meta = JSON.parse(jsonMatch[1]);
      if (opcoes.method === 'PATCH') {
        const id = decodeURIComponent(u.pathname.split('/').pop());
        const atual = arquivosDrive.get(id);
        atual.name = meta.name || atual.name;
        atual.appProperties = { ...atual.appProperties, ...(meta.appProperties || {}) };
        return responderJson(200, atual);
      }
      const id = `drv-${seqId++}`;
      const item = { id, name: meta.name, mimeType: 'application/octet-stream', parents: meta.parents || [], appProperties: meta.appProperties || {} };
      arquivosDrive.set(id, item);
      return responderJson(200, item);
    }
    if (u.pathname.startsWith('/drive/v3/files/') && opcoes.method === 'DELETE') {
      const id = decodeURIComponent(u.pathname.split('/').pop());
      arquivosDrive.delete(id);
      return responderJson(204, {});
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  };

  let dataAtual = new Date(2026, 9, 10, 10, 0, 0);
  const agendador = criarAgendadorDeBackup({
    arquivo: path.join(dirConfig, 'backup.json'),
    obterCofre: () => vault,
    cifrar: v => `cifrado:${v}`,
    decifrar: v => (v.startsWith('cifrado:') ? v.slice(8) : ''),
    requisitarDrive: requisitarFalso,
    abrirUrl: async urlAuth => {
      // Simula o navegador redirecionando de volta para o servidor local do Kiro
      const parsed = new URL(urlAuth);
      const redirectUri = parsed.searchParams.get('redirect_uri');
      const state = parsed.searchParams.get('state');
      await new Promise((resolve, reject) => {
        http.get(`${redirectUri}?code=cod-teste&state=${encodeURIComponent(state)}`, res => {
          res.resume();
          res.on('end', resolve);
        }).on('error', reject);
      });
    },
    atrasoInicialMs: 0,
    intervaloChecagemMs: 0,
    relogio: () => dataAtual,
  });

  // Conecta sem precisar informar Client ID nem Client Secret (usa as credenciais embutidas do Kiro)
  const aposConectar = await agendador.conectarGoogleDrive();
  assert.equal(aposConectar.nuvemConectada, true);
  assert.equal(aposConectar.config.nuvem.email, 'gabriel@example.com');
  assert.equal(aposConectar.config.modo, 'nuvem');

  // Liga o backup na nuvem com limite de 2 cópias diárias
  await agendador.salvarConfig({
    ligado: true,
    modo: 'nuvem',
    espelho: true,
    copias: {
      horas: { ligado: false, intervalo: 6, manter: 4 },
      diaria: { ligado: true, manter: 2 },
      semanal: { ligado: false, dia: 0, manter: 4 },
      mensal: { ligado: false, manter: 12 },
    },
  });
  await agendador.aguardarFila();

  const mdNoDrive = () => [...arquivosDrive.values()].filter(f => f.name.endsWith('.md'));
  const zipsNoDrive = () => [...arquivosDrive.values()].filter(f => f.name.endsWith('.zip')).map(f => f.name).sort();
  assert.equal(mdNoDrive().length, 2);
  assert.deepEqual(zipsNoDrive(), ['kiro-2026-10-10.zip']);

  // Apaga uma nota e avança 2 dias para testar remoção no espelho e rotação de .zip na nuvem
  await vault.save({ ...estado, notes: [estado.notes[0]] });
  dataAtual = new Date(2026, 9, 11, 10, 0, 0);
  await agendador.executarAgora({ espelho: true, copia: false });
  assert.equal(mdNoDrive().length, 1);
  assert.deepEqual(zipsNoDrive(), ['kiro-2026-10-10.zip', 'kiro-2026-10-11.zip']);

  dataAtual = new Date(2026, 9, 12, 10, 0, 0);
  await agendador.executarAgora({ espelho: false, copia: false });
  assert.deepEqual(zipsNoDrive(), ['kiro-2026-10-11.zip', 'kiro-2026-10-12.zip']);

  const urlPasta = await agendador.urlPastaNaNuvem();
  assert.match(urlPasta, /^https:\/\/drive\.google\.com\/drive\/folders\/drv-\d+$/);

  // Desligar o espelho apaga a pasta espelho no Drive
  await agendador.salvarConfig({ espelho: false });
  await agendador.aguardarFila();
  assert.equal([...arquivosDrive.values()].some(f => f.name === 'espelho'), false);

  agendador.parar();
});
