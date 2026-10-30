// Conexão direta com a API do Google Drive (OAuth 2.0 + Drive v3 REST API), sem dependências.
// Usa o escopo 'drive.file': o Kiro só enxerga e gerencia as pastas e arquivos que ele mesmo
// criou no Google Drive do usuário, sem pedir acesso ao restante do Drive.
const http = require('node:http');
const https = require('node:https');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
// Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
const frase = f => f;

const ESCOPO_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const MIME_PASTA = 'application/vnd.google-apps.folder';
const TIMEOUT_REDE_MS = 60 * 1000;

const base64Url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Faz uma chamada HTTPS e devolve { status, headers, body (Buffer), json() }. */
function requisicaoHttps(url, { method = 'GET', headers = {}, body = null, timeout = TIMEOUT_REDE_MS } = {}) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const corpoBuf = body === null || body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const cabecalhos = { ...headers };
    if (corpoBuf && !cabecalhos['Content-Length'] && !cabecalhos['content-length']) {
      cabecalhos['Content-Length'] = String(corpoBuf.length);
    }
    const req = https.request({
      protocol: alvo.protocol,
      hostname: alvo.hostname,
      port: alvo.port || 443,
      path: alvo.pathname + alvo.search,
      method,
      headers: cabecalhos,
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => {
        const buffer = Buffer.concat(partes);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: buffer,
          text: () => buffer.toString('utf8'),
          json: () => JSON.parse(buffer.toString('utf8') || '{}'),
        });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error(frase('A conexão com o Google Drive demorou demais.'))));
    req.on('error', () => reject(new Error(frase('Não foi possível conectar ao Google Drive. Verifique sua internet.'))));
    if (corpoBuf) req.write(corpoBuf);
    req.end();
  });
}

/** Troca um refresh_token por um access_token válido na API OAuth2 do Google. */
async function obterAccessToken({ clientId, clientSecret, refreshToken }, requisitar = requisicaoHttps) {
  if (!clientId || !refreshToken) throw new Error(frase('Conecte sua conta do Google Drive antes de fazer o backup na nuvem.'));
  const params = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (clientSecret) params.set('client_secret', clientSecret);
  const res = await requisitar('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(frase('A autorização do Google Drive expirou ou foi revogada. Conecte a conta novamente.'));
  }
  const dados = res.json();
  if (!dados.access_token) throw new Error(frase('Resposta inválida do Google ao renovar a sessão.'));
  return dados.access_token;
}

/**
 * Abre um servidor local temporário em 127.0.0.1 para receber o retorno do login Google (OAuth 2.0 + PKCE).
 * Devolve { urlAutorizacao, aguardarConclusao, cancelar }.
 */
async function iniciarFluxoOAuth({ clientId, clientSecret = '', requisitar = requisicaoHttps, timeoutMs = 180 * 1000 }) {
  const idLimpo = typeof clientId === 'string' ? clientId.trim() : '';
  const secretLimpo = typeof clientSecret === 'string' ? clientSecret.trim() : '';
  if (!idLimpo) throw new Error(frase('Informe o Client ID do Google Cloud para conectar.'));

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const estadoOAuth = base64Url(randomBytes(16));

  let resolverPromessa, rejeitarPromessa;
  const promessa = new Promise((resolve, reject) => { resolverPromessa = resolve; rejeitarPromessa = reject; });

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Não encontrado.');
      }
      const erro = url.searchParams.get('error');
      const codigo = url.searchParams.get('code');
      const estadoRecebido = url.searchParams.get('state');
      const responderHtml = (titulo, mensagem) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title><style>body{font-family:system-ui,sans-serif;background:#14161a;color:#e8eaed;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{max-width:420px;padding:28px;border-radius:12px;background:#1e2128;border:1px solid #2f3440;text-align:center}h1{font-size:1.2rem;margin:0 0 8px}p{color:#9aa0a6;margin:0}</style></head><body><div><h1>${titulo}</h1><p>${mensagem}</p></div></body></html>`);
      };
      if (erro || !codigo || estadoRecebido !== estadoOAuth) {
        responderHtml('Conexão cancelada', 'Você pode fechar esta janela e tentar novamente no Kiro.');
        fechar();
        return rejeitarPromessa(new Error(frase('A autorização no Google Drive foi cancelada.')));
      }
      const porta = servidor.address().port;
      const redirectUri = `http://127.0.0.1:${porta}/oauth2callback`;
      const params = new URLSearchParams({
        code: codigo,
        client_id: idLimpo,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (secretLimpo) params.set('client_secret', secretLimpo);
      const tokenRes = await requisitar('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (tokenRes.status < 200 || tokenRes.status >= 300) {
        responderHtml('Falha ao conectar', 'Verifique se o Client ID e o Client Secret estão corretos no Kiro.');
        fechar();
        return rejeitarPromessa(new Error(frase('O Google recusou a troca do código. Confira o Client ID e o Client Secret.')));
      }
      const tokens = tokenRes.json();
      if (!tokens.refresh_token && !tokens.access_token) {
        responderHtml('Falha ao conectar', 'O Google não devolveu uma chave de acesso.');
        fechar();
        return rejeitarPromessa(new Error(frase('O Google não devolveu a permissão necessária.')));
      }
      // Busca o e-mail da conta conectada para mostrar na tela.
      let email = '';
      try {
        const sobre = await requisitar('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (sobre.status === 200) {
          const u = sobre.json().user || {};
          email = u.emailAddress || u.displayName || '';
        }
      } catch { /* e-mail é apenas informativo */ }

      responderHtml('Conta Google conectada ao Kiro!', 'Você já pode fechar esta aba e voltar para o Kiro.');
      fechar();
      resolverPromessa({
        refreshToken: tokens.refresh_token || '',
        accessToken: tokens.access_token || '',
        email,
      });
    } catch (e) {
      fechar();
      rejeitarPromessa(e);
    }
  });

  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });

  const porta = servidor.address().port;
  const redirectUri = `http://127.0.0.1:${porta}/oauth2callback`;
  const authParams = new URLSearchParams({
    client_id: idLimpo,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPO_DRIVE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: estadoOAuth,
  });

  const timer = setTimeout(() => {
    fechar();
    rejeitarPromessa(new Error(frase('Tempo esgotado aguardando a confirmação no navegador.')));
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  function fechar() {
    clearTimeout(timer);
    try { servidor.close(); } catch { /* já fechado */ }
  }

  return {
    urlAutorizacao: `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`,
    aguardarConclusao: () => promessa,
    cancelar: () => { fechar(); rejeitarPromessa(new Error(frase('Conexão cancelada.'))); },
  };
}

// ---- Operações de pastas e arquivos na API Drive v3 ----
const escaparQuery = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function criarClienteDrive(accessToken, requisitar = requisicaoHttps) {
  const aut = { Authorization: `Bearer ${accessToken}` };

  async function listarFilhos(parentId, extras = '') {
    const itens = [];
    let pageToken = '';
    do {
      const q = `'${escaparQuery(parentId)}' in parents and trashed = false${extras ? ` and (${extras})` : ''}`;
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken, files(id, name, mimeType, size, appProperties, createdTime)',
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await requisitar(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: aut });
      if (res.status < 200 || res.status >= 300) throw new Error(frase('Erro ao listar arquivos no Google Drive.'));
      const dados = res.json();
      if (Array.isArray(dados.files)) itens.push(...dados.files);
      pageToken = dados.nextPageToken || '';
    } while (pageToken);
    return itens;
  }

  async function garantirPasta(nome, parentId = 'root', appProperties = undefined) {
    const q = `mimeType = '${MIME_PASTA}' and name = '${escaparQuery(nome)}'`;
    const achadas = await listarFilhos(parentId, q);
    if (achadas.length) return achadas[0].id;
    const meta = { name: nome, mimeType: MIME_PASTA, parents: [parentId] };
    if (appProperties) meta.appProperties = appProperties;
    const res = await requisitar('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { ...aut, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(meta),
    });
    if (res.status < 200 || res.status >= 300) throw new Error(frase('Não foi possível criar a pasta de backup no Google Drive.'));
    return res.json().id;
  }

  async function enviarOuAtualizarArquivo({ fileId = '', parentId, nome, mimeType = 'application/octet-stream', dados, appProperties = {} }) {
    const fronteira = `kiro_${randomBytes(12).toString('hex')}`;
    const meta = { name: nome, appProperties };
    if (!fileId && parentId) meta.parents = [parentId];
    const p1 = Buffer.from(
      `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${fronteira}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      'utf8'
    );
    const p2 = Buffer.from(`\r\n--${fronteira}--`, 'utf8');
    const corpo = Buffer.concat([p1, Buffer.isBuffer(dados) ? dados : Buffer.from(dados), p2]);
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
    const res = await requisitar(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { ...aut, 'Content-Type': `multipart/related; boundary=${fronteira}` },
      body: corpo,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(frase('Falha ao enviar arquivo para o Google Drive.'));
    return res.json();
  }

  async function excluirArquivo(fileId) {
    const res = await requisitar(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: aut,
    });
    if (res.status >= 400 && res.status !== 404) throw new Error(frase('Não foi possível remover uma cópia antiga no Google Drive.'));
  }

  return { listarFilhos, garantirPasta, enviarOuAtualizarArquivo, excluirArquivo };
}

/** Garante a pasta Kiro/<nome-do-cofre> no Google Drive e devolve o ID dela. */
async function garantirRaizNaNuvem(cliente, cofreDir) {
  const pastaKiro = await cliente.garantirPasta('Kiro', 'root');
  const nomeCofre = path.basename(path.resolve(cofreDir)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'cofre';
  return cliente.garantirPasta(nomeCofre, pastaKiro, { kiroCofre: nomeCofre });
}

/**
 * Remove a subpasta `espelho` no Google Drive quando o espelho contínuo está desligado,
 * evitando que arquivos avulsos continuem aparecendo nos "Arquivos sugeridos" do Drive.
 */
async function limparEspelhoNaNuvem(cliente, pastaCofreId) {
  const q = `mimeType = '${MIME_PASTA}' and name = 'espelho'`;
  const achadas = await cliente.listarFilhos(pastaCofreId, q);
  for (const p of achadas) await cliente.excluirArquivo(p.id);
  return achadas.length;
}

/**
 * Sincroniza as notas (.md) do cofre para a subpasta `espelho` no Google Drive.
 * Usa `appProperties.kiroMtime` e `kiroSize` para enviar apenas o que mudou.
 */
async function espelharNaNuvem(cliente, pastaCofreId, arquivosOrigem) {
  const notasOrigem = arquivosOrigem.filter(f => f.rel.toLowerCase().endsWith('.md'));
  const pastaEspelhoId = await cliente.garantirPasta('espelho', pastaCofreId);
  const cachePastas = new Map([['', pastaEspelhoId]]);

  async function pastaParaRel(relDir) {
    if (cachePastas.has(relDir)) return cachePastas.get(relDir);
    const partes = relDir.split('/').filter(Boolean);
    let atual = pastaEspelhoId, caminhoAcumulado = '';
    for (const p of partes) {
      caminhoAcumulado = caminhoAcumulado ? `${caminhoAcumulado}/${p}` : p;
      if (cachePastas.has(caminhoAcumulado)) {
        atual = cachePastas.get(caminhoAcumulado);
      } else {
        atual = await cliente.garantirPasta(p, atual);
        cachePastas.set(caminhoAcumulado, atual);
      }
    }
    return atual;
  }

  // Lista todos os arquivos que já estão no espelho do Drive (gerenciados por esta pasta).
  const existentes = new Map();
  async function varrerDrive(parentId, prefixo = '') {
    const filhos = await cliente.listarFilhos(parentId);
    for (const f of filhos) {
      const rel = prefixo ? `${prefixo}/${f.name}` : f.name;
      if (f.mimeType === MIME_PASTA) {
        cachePastas.set(rel, f.id);
        await varrerDrive(f.id, rel);
      } else {
        existentes.set(rel.toLowerCase(), { ...f, rel });
      }
    }
  }
  await varrerDrive(pastaEspelhoId);

  if (!notasOrigem.length && existentes.size > 0) {
    throw new Error(frase('O cofre parece vazio; o espelho não foi alterado para não apagar a cópia.'));
  }

  let copiados = 0, removidos = 0;
  const manter = new Set();

  for (const f of notasOrigem) {
    const chave = f.rel.toLowerCase();
    manter.add(chave);
    const atual = existentes.get(chave);
    const mtimeStr = String(Math.round(f.mtimeMs));
    const sizeStr = String(f.size);
    if (atual && atual.appProperties?.kiroSize === sizeStr && Math.abs(Number(atual.appProperties?.kiroMtime || 0) - Math.round(f.mtimeMs)) < 2000) {
      continue;
    }
    let dados;
    try { dados = await fs.readFile(f.abs); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const dirRel = path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel);
    const parentId = await pastaParaRel(dirRel);
    const mime = 'text/markdown; charset=UTF-8';
    await cliente.enviarOuAtualizarArquivo({
      fileId: atual ? atual.id : '',
      parentId,
      nome: path.posix.basename(f.rel),
      mimeType: mime,
      dados,
      appProperties: { kiroMtime: mtimeStr, kiroSize: sizeStr },
    });
    copiados++;
  }

  for (const [chave, arq] of existentes.entries()) {
    if (!manter.has(chave)) {
      await cliente.excluirArquivo(arq.id);
      removidos++;
    }
  }
  return { copiados, removidos, total: notasOrigem.length };
}

/**
 * Envia um arquivo .zip de cópia para `copias/<tipo>/` no Google Drive e apaga as cópias além de `manter`.
 */
async function enviarCopiaParaNuvem(cliente, pastaCofreId, tipo, nomeArquivoZip, bufferZip, manter) {
  const pastaCopiasId = await cliente.garantirPasta('copias', pastaCofreId);
  const pastaTipoId = await cliente.garantirPasta(tipo, pastaCopiasId);
  const existentes = await cliente.listarFilhos(pastaTipoId, `mimeType != '${MIME_PASTA}'`);
  const mesmoNome = existentes.find(f => f.name === nomeArquivoZip);

  await cliente.enviarOuAtualizarArquivo({
    fileId: mesmoNome ? mesmoNome.id : '',
    parentId: pastaTipoId,
    nome: nomeArquivoZip,
    mimeType: 'application/zip',
    dados: bufferZip,
    appProperties: { kiroTipo: tipo },
  });

  const todas = (await cliente.listarFilhos(pastaTipoId, `mimeType != '${MIME_PASTA}'`))
    .filter(f => /^kiro-[\d_-]+\.zip$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const apagar = todas.slice(0, Math.max(0, todas.length - manter));
  for (const arq of apagar) await cliente.excluirArquivo(arq.id);
  return { enviadas: 1, apagadas: apagar.map(a => a.name) };
}

module.exports = {
  ESCOPO_DRIVE,
  obterAccessToken,
  iniciarFluxoOAuth,
  criarClienteDrive,
  garantirRaizNaNuvem,
  limparEspelhoNaNuvem,
  espelharNaNuvem,
  enviarCopiaParaNuvem,
};
