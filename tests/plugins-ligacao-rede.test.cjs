const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const raiz = path.join(__dirname, '..');
const ler = arquivo => require('node:fs').readFileSync(path.join(raiz, arquivo), 'utf8');
const segredo = { name: 'apiKey', label: 'Chave de teste', host: 'api.exemplo.com', header: 'Authorization', format: 'Bearer {value}' };
const manifesto = (id, extra) => ({ id, name: id, version: '1.0.0', author: 'x', minKiro: '0.1.0', permissions: ['network'], network: ['api.exemplo.com'], ...extra });

// Servidor de verdade num cofre temporário, com a rede falsa (KIRO_REDE_FALSA=1)
// e o arquivo de chaves também na pasta temporária.
async function servidor() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-ligacao-rede-'));
  const cofre = path.join(dir, 'cofre');
  const plugins = {
    'rede-teste': manifesto('rede-teste', { secrets: [segredo] }),
    'desligado': manifesto('desligado'),
    'sem-rede': manifesto('sem-rede', { permissions: ['notes:read'], network: [] }),
  };
  for (const [id, m] of Object.entries(plugins)) {
    await fs.mkdir(path.join(cofre, '.kiro', 'plugins', id), { recursive: true });
    await fs.writeFile(path.join(cofre, '.kiro', 'plugins', id, 'manifest.json'), JSON.stringify(m));
    await fs.writeFile(path.join(cofre, '.kiro', 'plugins', id, 'index.js'), 'export default { activate() {} };');
  }
  await fs.writeFile(path.join(cofre, '.kiro', 'plugins.json'), JSON.stringify({
    'rede-teste': { enabled: true, permissions: ['network'], network: ['api.exemplo.com'], secrets: ['apiKey'] },
    'desligado': { enabled: false, permissions: ['network'], network: ['api.exemplo.com'] },
    'sem-rede': { enabled: true, permissions: ['notes:read'], network: [] },
  }));
  const porta = 5200 + Math.floor(Math.random() * 400); // fora de 5060 e 5061, que o fetch recusa ("bad port")
  const filho = spawn(process.execPath, ['server.mjs'], {
    cwd: raiz,
    env: { ...process.env, PORT: String(porta), KIRO_VAULT: cofre, KIRO_REDE_FALSA: '1', KIRO_SEGREDOS_ARQUIVO: path.join(dir, 'plugin-secrets.json') },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  const mesmaOrigem = { Origin: base };
  const pedir = (rota, { method = 'GET', corpo, cabecalhos = mesmaOrigem } = {}) => fetch(`${base}${rota}`, {
    method, headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos }, body: corpo ? JSON.stringify(corpo) : undefined,
  }).then(async r => ({ status: r.status, corpo: await r.json() }));
  return { dir, cofre, base, pedir, parar: async () => { filho.kill(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('a rota de fetch exige mesma origem', async () => {
  const s = await servidor();
  try {
    const corpo = { pluginId: 'rede-teste', pedido: { url: 'https://api.exemplo.com/' } };
    assert.equal((await s.pedir('/api/plugin-fetch', { method: 'POST', corpo, cabecalhos: { Origin: 'http://evil.com' } })).status, 403);
    assert.equal((await s.pedir('/api/plugin-fetch', { method: 'POST', corpo, cabecalhos: {} })).status, 403);
    assert.equal((await s.pedir('/api/plugin-fetch', { method: 'POST', corpo, cabecalhos: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await s.pedir('/api/plugin-secrets/rede-teste', { cabecalhos: {} })).status, 403);
    assert.equal((await s.pedir('/api/plugin-secrets/rede-teste', { cabecalhos: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.equal((await s.pedir('/api/plugin-secrets/rede-teste', { cabecalhos: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  } finally { await s.parar(); }
});

test('a rota recusa plug-in inexistente, desligado, sem network ou host não concedido, sem tocar a rede', async () => {
  const s = await servidor();
  try {
    const tentar = (pluginId, pedido) => s.pedir('/api/plugin-fetch', { method: 'POST', corpo: { pluginId, pedido } });
    const recusas = [
      [await tentar('nao-existe', { url: 'https://api.exemplo.com/' }), 403],
      [await tentar('desligado', { url: 'https://api.exemplo.com/' }), 403],
      [await tentar('sem-rede', { url: 'https://api.exemplo.com/' }), 403],
      [await tentar('rede-teste', { url: 'https://evil.com/' }), 400],
      [await tentar('rede-teste', { url: 'https://api.exemplo.com/', headers: { Cookie: 'a=b' } }), 400],
      [await tentar('rede-teste', { url: 'https://api.exemplo.com/', secret: 'apiKey' }), 502], // chave não configurada
    ];
    for (const [r, esperado] of recusas) {
      assert.equal(r.status, esperado, JSON.stringify(r.corpo));
      assert.ok(r.corpo.error, 'recusa vem com mensagem');
      assert.ok(!/KIRO_REDE_FALSA/.test(r.corpo.error), 'a recusa acontece antes do transporte');
    }
    assert.match(recusas[3][0].corpo.error, /não liberado/);
    assert.match(recusas[5][0].corpo.error, /não está configurada/);

    // Pedido válido chega ao transporte falso, que falha sem conexão real.
    const valido = await tentar('rede-teste', { url: 'https://api.exemplo.com/x' });
    assert.equal(valido.status, 502);
    assert.match(valido.corpo.error, /KIRO_REDE_FALSA/);

    const auditoria = await fs.readFile(path.join(s.cofre, '.kiro', 'audit.log'), 'utf8');
    const linhas = auditoria.trim().split('\n').map(l => JSON.parse(l)).filter(l => l.action === 'network.fetch');
    assert.equal(linhas.length, 7, 'toda chamada, com sucesso ou erro, vai para a auditoria');
    const ultima = linhas.at(-1);
    assert.equal(ultima.client, 'plugin');
    assert.equal(ultima.clientName, 'rede-teste');
    assert.equal(ultima.target, 'api.exemplo.com');
    assert.equal(ultima.status, 'error');
    assert.equal(ultima.method, 'GET');
    assert.equal(typeof ultima.durationMs, 'number');
    assert.ok(!/a=b/.test(auditoria), 'cabeçalho do pedido não vai para a auditoria');
  } finally { await s.parar(); }
});

test('as rotas de chaves nunca devolvem o valor', async () => {
  const s = await servidor();
  try {
    const rota = '/api/plugin-secrets/rede-teste';
    const gravado = await s.pedir(rota, { method: 'POST', corpo: { name: 'apiKey', value: 'VALOR-SECRETO-123' } });
    assert.equal(gravado.status, 200, JSON.stringify(gravado.corpo));
    assert.ok(!JSON.stringify(gravado.corpo).includes('VALOR-SECRETO-123'));
    const lido = await s.pedir(rota);
    assert.deepEqual(lido.corpo, { apiKey: true });

    // Com a chave configurada, o pedido chega ao transporte e o erro não carrega o valor.
    const r = await s.pedir('/api/plugin-fetch', { method: 'POST', corpo: { pluginId: 'rede-teste', pedido: { url: 'https://api.exemplo.com/', secret: 'apiKey' } } });
    assert.match(r.corpo.error, /KIRO_REDE_FALSA/);
    assert.ok(!JSON.stringify(r.corpo).includes('VALOR-SECRETO-123'));
    assert.ok(!(await fs.readFile(path.join(s.cofre, '.kiro', 'audit.log'), 'utf8')).includes('VALOR-SECRETO-123'));

    assert.equal((await s.pedir(rota, { method: 'POST', corpo: { name: 'naoDeclarada', value: 'x' } })).status, 400);
    assert.equal((await s.pedir('/api/plugin-secrets/nao-existe', { method: 'POST', corpo: { name: 'apiKey', value: 'x' } })).status, 403);

    const removido = await s.pedir(rota, { method: 'DELETE', corpo: { name: 'apiKey' } });
    assert.deepEqual(removido.corpo, {});
  } finally { await s.parar(); }
});

test('fetch do plug-in só passa pela API do Kiro', () => {
  const P = require('../plugins.js');
  assert.equal(P.METODOS.fetch, 'network');
  assert.ok(P.metodosPermitidos(['network']).includes('fetch'));
  assert.ok(!P.metodosPermitidos([]).includes('fetch'));

  const worker = ler('plugin-worker.js');
  assert.ok(!/\bfetch\s*\(/.test(worker), 'o worker nunca chama fetch de verdade');

  const app = ler('app.js');
  assert.match(app, /case 'fetch': return fetchDoPlugin\(id, a, b\);/, 'executarMetodo atende fetch');
  const corpo = app.slice(app.indexOf('async function fetchDoPlugin'), app.indexOf('async function executarMetodo'));
  assert.match(corpo, /pluginApi\.fetch\(id, pedido\)/);
  assert.ok(!/[^.]\bfetch\(/.test(corpo), 'o hospedeiro não faz a requisição do plug-in por conta própria');
  assert.match(corpo, /slice\(0, 10\)/, 'guarda só as últimas 10 chamadas');
  assert.match(app, /secrets: \(m\.secrets \|\| \[\]\)\.map\(s => s\.name\)/, 'ativar grava as chaves concedidas');
  assert.match(app, /fetch: \(id, pedido\) => window\.cadernoDesktop \? window\.cadernoDesktop\.pluginFetch\(id, pedido\) : api\('plugin-fetch', \{ pluginId: id, pedido \}\)/);

  const preload = ler('electron/preload.cjs');
  assert.match(preload, /ipcRenderer\.invoke\('plugins:fetch'/);
  // Nenhum IPC de chave devolve valor: não existe canal de leitura de valor.
  assert.ok(!/secrets:(get|value|valor)/.test(preload + ler('electron/main.cjs')));
});

test('aba Plug-ins: campo de chave de senha, valor nunca lido de volta e últimas chamadas', () => {
  const app = ler('app.js');
  const aba = app.slice(app.indexOf('// ---- Aba Plug-ins ----'), app.indexOf('// ---- Fim da aba Plug-ins ----'));
  assert.match(aba, /type="password"[^>]*autocomplete="off"[^>]*spellcheck="false"/, 'campo de senha sem preenchimento automático');
  assert.match(aba, /<label for="/, 'cada campo tem rótulo associado');
  assert.match(aba, /aria-live="polite"/);
  assert.match(aba, /Configurada/);
  assert.match(aba, /Não configurada/);
  assert.match(aba, /pluginApi\.gravarChave\(/);
  assert.match(aba, /pluginApi\.removerChave\(/);
  // O valor só sai do campo para o envio: nunca é guardado nem vira HTML.
  const usosDoValor = aba.match(/\.value\b/g) || [];
  assert.equal(usosDoValor.length, 2, 'lê o campo uma vez para enviar e limpa uma vez');
  assert.match(aba, /campo\.value = ''/);
  assert.ok(!/\b(confirm|alert)\(/.test(aba), 'nada de caixa nativa');
  assert.match(aba, /Últimas chamadas/);
  assert.match(aba, /chamadasDeRede\.get\(/);
  assert.match(aba, /segredosNovos/, 'aguardando permissão mostra qual chave é nova');
});

test('documentação da rede descreve as capacidades atuais', () => {
  const doc = ler('docs/plugins.md');
  for (const trecho of ['kiro.fetch(url', '"secrets"', 'local network', 'audit.log', 'plugin-secrets.json'])
    assert.ok(doc.includes(trecho), `docs/plugins.md fala de ${trecho}`);
  const pendente = doc.slice(doc.indexOf('## Not available yet'));
  assert.ok(!/kiro\.fetch|Stage 3/i.test(pendente), 'a rede não está mais em "Not available yet"');
  assert.ok(!/not available yet\*? \(stage 3\)/i.test(doc));
});
