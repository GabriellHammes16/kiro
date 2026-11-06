const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Readable } = require('node:stream');
const P = require('../previa-link.js');
const { buscarPrevia } = require('../ligacao-previa.cjs');

test('lerPrevia usa og:title, og:description e og:image relativa', () => {
  const html = '<html><head><title>Outro</title><meta property="og:title" content="Título OG"><meta property="og:description" content="Descrição OG"><meta property="og:image" content="/a.png"></head></html>';
  assert.deepEqual(P.lerPrevia(html, 'https://site.com/p'), { titulo: 'Título OG', descricao: 'Descrição OG', imagem: 'https://site.com/a.png' });
});

test('lerPrevia cai em <title>, twitter e meta description', () => {
  const html = '<title>\n  Só o título  </title><meta name="description" content="Por nome"><meta name="twitter:image" content="https://cdn.site.com/i.jpg">';
  assert.deepEqual(P.lerPrevia(html, 'https://site.com/'), { titulo: 'Só o título', descricao: 'Por nome', imagem: 'https://cdn.site.com/i.jpg' });
});

test('lerPrevia decodifica entidades e corta o tamanho', () => {
  const html = `<meta content="Tom &amp; Jerry &quot;ao vivo&quot; &#39;x&#39; &#233; &#xE9; &lt;b&gt;" property="og:title"><meta property="og:description" content="${'a'.repeat(400)}">`;
  const r = P.lerPrevia(html, 'https://site.com/');
  assert.equal(r.titulo, 'Tom & Jerry "ao vivo" \'x\' é é <b>');
  assert.equal(r.descricao.length, 300);
  assert.equal(P.lerPrevia(`<title>${'t'.repeat(300)}</title>`, 'https://site.com/').titulo.length, 200);
});

test('lerPrevia recusa imagem http: e data:', () => {
  for (const img of ['http://site.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)'])
    assert.equal(P.lerPrevia(`<meta property="og:image" content="${img}">`, 'https://site.com/').imagem, null, img);
});

test('lerPrevia sem nada devolve campos nulos', () => {
  assert.deepEqual(P.lerPrevia('<p>oi</p>', 'https://site.com/'), { titulo: null, descricao: null, imagem: null });
});

// Transporte falso no padrão de tests/rede.test.cjs: um roteiro de respostas por URL pedida.
function transporte(roteiro) {
  const pedidos = [];
  const requisitar = (opcoes, aoResponder) => {
    const req = new EventEmitter();
    req.destroy = () => req;
    req.end = () => {
      pedidos.push(opcoes);
      opcoes.lookup(opcoes.hostname, { all: true }, erro => {
        if (erro) return req.emit('error', erro);
        const passo = roteiro.shift();
        const resposta = Readable.from([passo.corpo ?? Buffer.from(passo.text || '')]);
        resposta.statusCode = passo.status;
        resposta.headers = passo.headers || {};
        aoResponder(resposta);
      });
    };
    return req;
  };
  return { requisitar, pedidos };
}
const lookup = (host, opcoes, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const vaultFalso = () => { const gravados = []; return { gravados, saveAttachment: async a => { gravados.push(a); return { path: 'Anexos/capa-abc123.png' }; } }; };
const pagina = '<meta property="og:title" content="Olá"><meta property="og:image" content="/capa.png">';

test('buscarPrevia devolve null para content-type que não é HTML', async () => {
  const t = transporte([{ status: 200, text: '{}', headers: { 'content-type': 'application/json' } }]);
  assert.equal(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/', requisitar: t.requisitar, lookup }), null);
});

test('buscarPrevia devolve null quando o servidor dá 500', async () => {
  const t = transporte([{ status: 500, text: pagina, headers: { 'content-type': 'text/html' } }]);
  assert.equal(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/', requisitar: t.requisitar, lookup }), null);
});

test('buscarPrevia devolve null para host da rede local, sem lançar', async () => {
  const t = transporte([]);
  const local = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  assert.equal(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/', requisitar: t.requisitar, lookup: local }), null);
  assert.equal(await buscarPrevia({ vault: vaultFalso(), url: 'ftp://site.com/', requisitar: t.requisitar, lookup }), null);
});

test('buscarPrevia baixa a imagem, grava no cofre e devolve o caminho', async () => {
  const t = transporte([
    { status: 200, text: pagina, headers: { 'content-type': 'text/html; charset=utf-8' } },
    { status: 200, corpo: PNG, headers: { 'content-type': 'image/png' } },
  ]);
  const vault = vaultFalso();
  const r = await buscarPrevia({ vault, url: 'https://site.com/p', requisitar: t.requisitar, lookup });
  assert.deepEqual(r, { titulo: 'Olá', descricao: null, imagem: 'Anexos/capa-abc123.png' });
  assert.equal(t.pedidos[0].headers['user-agent'], 'Kiro');
  assert.equal(t.pedidos[1].path, '/capa.png');
  assert.equal(vault.gravados.length, 1);
  assert.ok(vault.gravados[0].data.equals(PNG));
});

test('buscarPrevia: imagem que o cofre recusa vira imagem null, o resto fica', async () => {
  const t = transporte([
    { status: 200, text: pagina, headers: { 'content-type': 'text/html' } },
    { status: 200, text: 'não sou imagem', headers: { 'content-type': 'image/png' } },
  ]);
  const vault = { saveAttachment: async () => { throw new Error('recusada'); } };
  assert.deepEqual(await buscarPrevia({ vault, url: 'https://site.com/p', requisitar: t.requisitar, lookup }), { titulo: 'Olá', descricao: null, imagem: null });
});

test('buscarPrevia: imagem que falha no download vira imagem null', async () => {
  const t = transporte([
    { status: 200, text: pagina, headers: { 'content-type': 'text/html' } },
    { status: 404, text: '', headers: { 'content-type': 'text/html' } },
  ]);
  assert.deepEqual(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/p', requisitar: t.requisitar, lookup }), { titulo: 'Olá', descricao: null, imagem: null });
});

test('buscarPrevia devolve null quando a página não tem nada para mostrar', async () => {
  const t = transporte([{ status: 200, text: '<p>oi</p>', headers: { 'content-type': 'text/html' } }]);
  assert.equal(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/', requisitar: t.requisitar, lookup }), null);
});

test('rota /api/previa: só a própria página; falha de rede volta como null', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-previa-'));
  const porta = 5600 + Math.floor(Math.random() * 300);
  const filho = require('node:child_process').spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(porta), KIRO_VAULT: path.join(dir, 'cofre'), KIRO_REDE_FALSA: '1', KIRO_SEGREDOS_ARQUIVO: path.join(dir, 's.json'), KIRO_BACKUP_ARQUIVO: path.join(dir, 'b.json') },
  });
  const base = `http://127.0.0.1:${porta}`;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const pedir = (cabecalhos, corpo) => fetch(`${base}/api/previa`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhos }, body: JSON.stringify(corpo) });
    const de_fora = await pedir({ Origin: 'http://evil.com' }, { url: 'https://site.com/' });
    assert.equal(de_fora.status, 403);
    const sem_origem = await pedir({}, { url: 'https://site.com/' });
    assert.equal(sem_origem.status, 403);
    const ok = await pedir({ Origin: base }, { url: 'https://site.com/' });
    assert.equal(ok.status, 200);
    assert.equal(await ok.json(), null);
    assert.equal(await (await pedir({ Origin: base }, { url: 42 })).json(), null);
    assert.equal((await fetch(`${base}/previa-link.js`)).status, 200);
  } finally { filho.kill(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('buscarPrevia: página maior que o limite é cortada, e o título do começo vale', async () => {
  const grande = Buffer.concat([Buffer.from('<meta property="og:title" content="Vídeo grande">'), Buffer.alloc(1.5 * 1024 * 1024, 0x61)]);
  const t = transporte([{ status: 200, corpo: grande, headers: { 'content-type': 'text/html', 'content-length': String(grande.length) } }]);
  assert.deepEqual(await buscarPrevia({ vault: vaultFalso(), url: 'https://site.com/', requisitar: t.requisitar, lookup }), { titulo: 'Vídeo grande', descricao: null, imagem: null });
});

test('buscarPrevia: content-type de imagem com corpo de PDF não é gravado', async () => {
  const t = transporte([
    { status: 200, text: pagina, headers: { 'content-type': 'text/html' } },
    { status: 200, corpo: Buffer.from('%PDF-1.7\n'), headers: { 'content-type': 'image/png' } },
  ]);
  const vault = vaultFalso();
  assert.deepEqual(await buscarPrevia({ vault, url: 'https://site.com/p', requisitar: t.requisitar, lookup }), { titulo: 'Olá', descricao: null, imagem: null });
  assert.equal(vault.gravados.length, 0);
});

test('buscarPrevia: no YouTube só o título, sem baixar a imagem', async () => {
  const t = transporte([{ status: 200, text: pagina, headers: { 'content-type': 'text/html' } }]);
  const vault = vaultFalso();
  assert.deepEqual(await buscarPrevia({ vault, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', requisitar: t.requisitar, lookup }), { titulo: 'Olá', descricao: null, imagem: null });
  assert.equal(t.pedidos.length, 1);
  assert.equal(vault.gravados.length, 0);
});
