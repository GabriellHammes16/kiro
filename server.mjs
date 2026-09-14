import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vaultModule from './vault.cjs';
import agentModule from './agent/index.cjs';

const { Vault } = vaultModule;
const root = dirname(fileURLToPath(import.meta.url));
// --dev: cofre de exemplo, recarga ao vivo e porta própria, para rodar junto do npm start.
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || (dev ? 4180 : 4173));
const vaultDirectory = process.env.KUROI_VAULT || join(root, dev ? 'dev-vault' : 'vault');
const vault = new Vault(vaultDirectory);
const devTools = dev ? (await import('./dev/devtools.mjs')).createDevTools(root) : null;
if (dev && !process.env.KUROI_VAULT) await (await import('./dev/seed.cjs')).default.semearSeVazio(vaultDirectory);
const agentConfig = new agentModule.AgentConfig(vaultDirectory);
const publicFiles = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/kuroi-logo-transparent.png': ['kuroi-logo-transparent.png', 'image/png'] };
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!allowedHosts.has(request.headers.host)) return send(response, 403, { error: 'Host não permitido.' });
  if (request.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(request.headers.origin)) return send(response, 403, { error: 'Origem não permitida.' });
  try {
    if (request.url === '/api/state' && request.method === 'GET') return send(response, 200, await vault.load());
    if (request.url === '/api/trash' && request.method === 'GET') return send(response, 200, await vault.trash());
    if (request.url === '/api/restore' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 4096) return send(response, 413, { error: 'Pedido grande demais.' }); }
      return send(response, 200, await vault.restore(JSON.parse(bruto)));
    }
    if (request.url === '/api/agent-config' && request.method === 'GET') return send(response, 200, await agentConfig.load());
    if (request.url === '/api/agent-config' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let bruto = ''; for await (const parte of request) { bruto += parte; if (bruto.length > 8192) return send(response, 413, { error: 'Configuração grande demais.' }); }
      return send(response, 200, await agentConfig.save(JSON.parse(bruto)));
    }
    if (request.url === '/api/state' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'Use JSON.' });
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 20 * 1024 * 1024) return send(response, 413, { error: 'Backup maior que 20 MB.' }); chunks.push(chunk); }
      return send(response, 200, await vault.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    }
    if (devTools && request.url === '/dev/events' && request.method === 'GET') return devTools.eventos(request, response);
    if (devTools && request.url === '/dev/reload.js' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(await devTools.script());
    }
    if (request.url === '/api/anexo' && request.method === 'POST') {
      // O tipo declarado só filtra o pedido; o Vault confere a imagem pelo conteúdo.
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(request.headers['content-type']?.split(';')[0])) return send(response, 415, { error: 'Envie uma imagem PNG, JPEG, GIF ou WebP.' });
      let tamanho = 0; const partes = [];
      for await (const parte of request) { tamanho += parte.length; if (tamanho > 20 * 1024 * 1024) return send(response, 413, { error: 'Imagem maior que 20 MB.' }); partes.push(parte); }
      let nome = ''; try { nome = decodeURIComponent(request.headers['x-kuroi-nome'] || ''); } catch { /* nome ilegível: a imagem recebe um nome gerado */ }
      return send(response, 200, await vault.saveAttachment({ name: nome, data: Buffer.concat(partes) }));
    }
    // Sem a query: a recarga de estilo pede styles.css?v=<hora> para furar o cache.
    const rota = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && rota.startsWith('/anexo/')) {
      try {
        const { data, type } = await vault.readAttachment(rota.slice('/anexo/'.length).split('/').map(decodeURIComponent).join('/'));
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'" });
        return response.end(data);
      } catch { return send(response, 404, { error: 'Imagem não encontrada.' }); }
    }
    // KaTeX embarcado: só os três tipos de arquivo que a página pede.
    const katex = rota.match(/^\/vendor\/katex\/(katex\.min\.(?:js|css)|fonts\/KaTeX_[A-Za-z0-9-]+\.woff2)$/);
    if (request.method === 'GET' && katex) {
      try {
        const corpo = await readFile(join(root, 'vendor', 'katex', ...katex[1].split('/')));
        const tipo = katex[1].endsWith('.js') ? 'text/javascript' : katex[1].endsWith('.css') ? 'text/css' : 'font/woff2';
        response.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': 'max-age=86400' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: 'Arquivo não encontrado.' }); }
    }
    // Fontes embarcadas: nome fixo, sem caminho, e só .woff2 de dentro de fonts/.
    if (request.method === 'GET' && /^\/fonts\/[a-z0-9-]+\.woff2$/.test(rota)) {
      try {
        const corpo = await readFile(join(root, 'fonts', rota.slice('/fonts/'.length)));
        response.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
        return response.end(corpo);
      } catch { return send(response, 404, { error: 'Fonte não encontrada.' }); }
    }
    const file = publicFiles[rota];
    if (request.method !== 'GET' || !file) return send(response, 404, { error: 'Não encontrado.' });
    let body = await readFile(join(root, file[0]));
    if (devTools && file[0] === 'index.html') body = devTools.injetar(body.toString('utf8'));
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch (error) { send(response, 400, { error: error.message }); }
}).listen(port, '127.0.0.1', () => console.log(dev ? `KUROI em desenvolvimento: http://localhost:${port} · cofre ${vaultDirectory}` : `KUROI em http://localhost:${port}`));
